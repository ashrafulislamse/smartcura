import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';
import 'package:uuid/uuid.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/message_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/loading_overlay.dart';

/// Chat Consultation Screen — real conversation messaging.
///
/// Wired to real backend data:
/// - The conversation id arrives as the route `extra` (a String), pushed from
///   the messages inbox or the video call control bar.
/// - [conversationMessagesProvider] reads `GET /conversations/{id}/messages`.
/// - [sendMessageProvider] posts via `POST /conversations/{id}/messages` with
///   an Idempotency-Key (added automatically by the API client).
/// - [markConversationRead] marks the conversation read up to the latest
///   sequence number when the screen is viewed.
/// - A 5-second [Timer.periodic] invalidates the messages provider to poll for
///   new messages (Socket.IO is not yet wired, so polling is the interim
///   transport).
///
/// All four resource states (loading, error, empty, loaded) are rendered
/// distinctly. Patient name is resolved from [doctorPatientDetailProvider]
/// using the conversation's patient profile id — never hardcoded.
class ChatConsultationScreen extends ConsumerStatefulWidget {
  const ChatConsultationScreen({super.key});

  @override
  ConsumerState<ChatConsultationScreen> createState() =>
      _ChatConsultationScreenState();
}

/// An optimistic outgoing message shown while the poll has not yet returned the
/// server-side copy. Rendered as a doctor bubble with a "Sending…" indicator.
class _PendingMessage {
  _PendingMessage({
    required this.clientCorrelationId,
    required this.text,
    required this.createdAt,
  });
  final String clientCorrelationId;
  final String text;
  final DateTime createdAt;
}

class _ChatConsultationScreenState
    extends ConsumerState<ChatConsultationScreen> {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final Uuid _uuid = const Uuid();

  String? _conversationId;
  Timer? _pollTimer;
  bool _markedRead = false;
  bool _didExtractExtra = false;

  /// Optimistic outgoing messages shown while the 5-second poll has not yet
  /// reflected the newly-sent text on the server. Each entry is removed once
  /// a server message with the same [clientCorrelationId] appears.
  final List<_PendingMessage> _pendingMessages = [];

  @override
  void initState() {
    super.initState();
    // Poll for new messages every 5 seconds (interim until Socket.IO is wired).
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (!mounted || _conversationId == null) return;
      ref.invalidate(conversationMessagesProvider((_conversationId!, null)));
    });
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_didExtractExtra) return;
    _didExtractExtra = true;
    // Deep links land here as /chat-consultation?id=<uuid>; in-app navigation
    // pushes the id via `extra`. Query param first, extra as fallback.
    final state = GoRouterState.of(context);
    final queryId = state.uri.queryParameters['id'];
    if (queryId != null && queryId.isNotEmpty) {
      _conversationId = queryId;
      return;
    }
    final extra = state.extra;
    if (extra is String) {
      _conversationId = extra;
    } else if (extra is Map<String, dynamic>) {
      _conversationId = extra['conversationId'] as String?;
    }
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // Helpers

  DateTime? _parseTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso);
  }

  String _formatTime(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '';
    return DateFormat.Hm().format(dt);
  }

  String _formatDateSeparator(DateTime dt) {
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));
    final dateOnly = DateTime(dt.year, dt.month, dt.day);
    if (dateOnly == today) return 'Today';
    if (dateOnly == yesterday) return 'Yesterday';
    return DateFormat('MMM d, yyyy').format(dt);
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: const Duration(milliseconds: 300),
          curve: Curves.easeOut,
        );
      }
    });
  }

  /// Mark the conversation as read up to the latest message sequence once.
  Future<void> _markReadIfNeeded(MessageList list) async {
    if (_markedRead || list.data.isEmpty) return;
    _markedRead = true;
    final maxSeq =
        list.data.map((m) => m.sequenceNo).reduce((a, b) => a > b ? a : b);
    try {
      await markConversationRead(
        ref,
        conversationId: _conversationId!,
        throughSequenceNo: maxSeq,
      );
      // Refresh the inbox so unread counts update.
      ref.invalidate(doctorInboxProvider(null));
    } catch (_) {
      // Read-receipt failures are non-fatal; the next poll will retry.
      _markedRead = false;
    }
  }

  // --------------------------------------------------------------------------
  // Actions

  Future<void> _sendMessage() async {
    final content = _messageController.text.trim();
    if (content.isEmpty || _conversationId == null) return;

    _messageController.clear();
    final correlationId = _uuid.v4();
    final pending = _PendingMessage(
      clientCorrelationId: correlationId,
      text: content,
      createdAt: DateTime.now(),
    );

    if (mounted) {
      setState(() => _pendingMessages.add(pending));
      _scrollToBottom();
    }

    final notifier = ref.read(sendMessageProvider.notifier);
    final ok = await notifier.call(
      conversationId: _conversationId!,
      clientCorrelationId: correlationId,
      textContent: content,
    );

    if (!mounted) return;

    if (ok) {
      // Refresh the message list; the optimistic bubble stays until the poll
      // returns a server message with the same correlation id.
      ref.invalidate(conversationMessagesProvider((_conversationId!, null)));
      _scrollToBottom();
    } else {
      setState(() => _pendingMessages
          .removeWhere((p) => p.clientCorrelationId == correlationId));
      final error = ref.read(sendMessageProvider).error;
      final msg = error is ApiError
          ? error.displayMessage
          : 'Could not send message. Please try again.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg)),
      );
      // Restore the text so the user can retry without retyping.
      _messageController.text = content;
    }
    // Reset the send state for the next message.
    ref.read(sendMessageProvider.notifier).reset();
  }

  /// Remove any optimistic bubbles that have now landed in the server list.
  void _prunePendingMessages(MessageList list) {
    if (_pendingMessages.isEmpty) return;
    final serverIds =
        list.data.map((m) => m.clientCorrelationId).whereType<String>().toSet();
    final removed = _pendingMessages
        .where((p) => serverIds.contains(p.clientCorrelationId))
        .toList();
    if (removed.isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      setState(() => _pendingMessages
          .removeWhere((p) => serverIds.contains(p.clientCorrelationId)));
    });
  }

  // --------------------------------------------------------------------------
  // Build

  @override
  Widget build(BuildContext context) {
    final conversationId = _conversationId;

    if (conversationId == null || conversationId.isEmpty) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: _buildAppBar(null),
        body: const ErrorView(
          message: 'No conversation was selected.',
          isForbidden: true,
        ),
      );
    }

    final messagesAsync =
        ref.watch(conversationMessagesProvider((conversationId, null)));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: _buildAppBar(messagesAsync),
      body: Column(
        children: [
          Expanded(
            child: messagesAsync.when(
              data: (list) {
                _prunePendingMessages(list);
                if (list.data.isEmpty && _pendingMessages.isEmpty) {
                  return _buildEmpty();
                }
                // Mark read once the messages are visible.
                _markReadIfNeeded(list);
                _scrollToBottom();
                return _buildMessageList(list.data);
              },
              loading: () => const LoadingOverlay(label: 'Loading messages...'),
              error: (err, _) {
                final apiError = err is ApiError ? err : toApiError(err);
                return ErrorView(
                  message: apiError.displayMessage,
                  isForbidden: apiError.isForbidden,
                  onRetry: () => ref.invalidate(
                      conversationMessagesProvider((conversationId, null))),
                );
              },
            ),
          ),
          _buildInputArea(),
        ],
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Sub-builders

  PreferredSizeWidget _buildAppBar(AsyncValue<MessageList>? messagesAsync) {
    // Resolve the patient name from the conversation data if available.
    String patientName = 'Patient';
    String? patientId;

    final conversationId = _conversationId;
    if (conversationId != null && messagesAsync != null) {
      // The message list does not carry the patient profile id directly, but
      // the conversation inbox does. Read the inbox to find this conversation.
      final inbox = ref.read(doctorInboxProvider(null)).valueOrNull;
      if (inbox != null) {
        for (final conv in inbox.data) {
          if (conv.conversationId == conversationId) {
            patientId = conv.patientProfileId;
            break;
          }
        }
      }
      if (patientId != null) {
        final patient =
            ref.read(doctorPatientDetailProvider(patientId)).valueOrNull;
        patientName = patient?.displayName ?? 'Patient';
      }
    }

    return AppBar(
      backgroundColor: AppColors.surface,
      elevation: 0,
      systemOverlayStyle: SystemUiOverlayStyle.dark,
      leading: IconButton(
        icon: const Icon(Icons.arrow_back_ios_new, color: AppColors.gray900),
        onPressed: () => Navigator.of(context).maybePop(),
      ),
      title: Row(
        children: [
          _buildOnlineAvatar(patientName),
          const SizedBox(width: DesignTokens.spaceSm + 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  patientName,
                  style: const TextStyle(
                    color: AppColors.gray900,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Row(
                  children: [
                    Container(
                      width: 6,
                      height: 6,
                      decoration: const BoxDecoration(
                        color: AppColors.success,
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 6),
                    const Text(
                      'Online',
                      style: TextStyle(
                        color: AppColors.success,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
      actions: [
        Container(
          margin: const EdgeInsets.only(right: 4),
          decoration: BoxDecoration(
            color: AppColors.primary.withValues(alpha: 0.1),
            shape: BoxShape.circle,
          ),
          child: IconButton(
            icon: const Icon(Icons.call, color: AppColors.primary),
            onPressed: () => _navigateToCall(),
          ),
        ),
        IconButton(
          icon: const Icon(Icons.videocam, color: AppColors.gray900),
          onPressed: () => _navigateToCall(),
        ),
      ],
    );
  }

  void _navigateToCall() {
    final conversationId = _conversationId;
    if (conversationId == null) return;
    // The video screen expects a consultation id (it calls
    // `GET /consultations/{id}` and `POST /consultations/{id}/room-token`), not
    // a conversation id. Resolve the consultation id from the doctor inbox,
    // which carries both `conversation_id` and `consultation_id` on each row.
    final inbox = ref.read(doctorInboxProvider(null)).valueOrNull;
    String? consultationId;
    if (inbox != null) {
      for (final conv in inbox.data) {
        if (conv.conversationId == conversationId) {
          consultationId = conv.consultationId;
          break;
        }
      }
    }
    if (consultationId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
              'No consultation linked to this conversation. Start one from the appointment first.'),
        ),
      );
      return;
    }
    context.push('/video-consultation', extra: consultationId);
  }

  Widget _buildOnlineAvatar(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    String initials;
    if (parts.isEmpty || parts.first.isEmpty) {
      initials = '?';
    } else if (parts.length == 1) {
      initials = parts.first.substring(0, 1).toUpperCase();
    } else {
      initials = (parts.first.substring(0, 1) + parts[1].substring(0, 1))
          .toUpperCase();
    }
    return Stack(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            gradient: AppColors.primaryGradient,
            shape: BoxShape.circle,
          ),
          alignment: Alignment.center,
          child: Text(
            initials,
            style: const TextStyle(
              color: AppColors.white,
              fontSize: 15,
              fontWeight: FontWeight.w700,
            ),
          ),
        ),
        Positioned(
          bottom: 0,
          right: 0,
          child: Container(
            width: 12,
            height: 12,
            decoration: BoxDecoration(
              color: AppColors.success,
              shape: BoxShape.circle,
              border: Border.all(color: AppColors.white, width: 2),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildEmpty() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.chat_bubble_outline_rounded,
              size: 64, color: AppColors.gray300),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            'No messages yet',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: AppColors.gray700,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceXs),
          Text(
            'Start the conversation by sending a message below.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray500,
                ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildMessageList(List<Message> messages) {
    final pending = _pendingMessages;
    final itemCount = messages.length + pending.length;
    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      itemCount: itemCount,
      itemBuilder: (context, index) {
        if (index < messages.length) {
          final msg = messages[index];
          // Insert a date separator when the day changes.
          final prev = index > 0 ? messages[index - 1] : null;
          final showSeparator = prev == null ||
              _parseTimestamp(prev.createdAt)?.day !=
                  _parseTimestamp(msg.createdAt)?.day;
          return Column(
            children: [
              if (showSeparator) _buildDateSeparator(msg.createdAt),
              if (showSeparator) const SizedBox(height: DesignTokens.spaceMd),
              msg.isMe ? _buildDoctorMessage(msg) : _buildPatientMessage(msg),
              const SizedBox(height: DesignTokens.spaceMd),
            ],
          );
        }
        final pendingIndex = index - messages.length;
        final msg = pending[pendingIndex];
        final prev = index > 0 && index - 1 < messages.length
            ? messages[index - 1]
            : null;
        final showSeparator = prev == null ||
            _parseTimestamp(prev.createdAt)?.day != msg.createdAt.day;
        return Column(
          children: [
            if (showSeparator)
              _buildDateSeparator(msg.createdAt.toIso8601String()),
            if (showSeparator) const SizedBox(height: DesignTokens.spaceMd),
            _buildPendingMessage(msg),
            const SizedBox(height: DesignTokens.spaceMd),
          ],
        );
      },
    );
  }

  Widget _buildDateSeparator(String? iso) {
    final dt = _parseTimestamp(iso);
    final label = dt != null ? _formatDateSeparator(dt) : '';
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceSm + 4,
            vertical: DesignTokens.spaceXs),
        decoration: BoxDecoration(
          color: AppColors.gray100,
          borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: AppColors.gray500,
          ),
        ),
      ),
    );
  }

  Widget _buildPatientMessage(Message msg) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        _buildSmallAvatar(),
        const SizedBox(width: DesignTokens.spaceSm + 4),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(DesignTokens.radiusLg),
                    topRight: Radius.circular(DesignTokens.radiusLg),
                    bottomRight: Radius.circular(DesignTokens.radiusLg),
                    bottomLeft: Radius.circular(4),
                  ),
                  border: Border.all(color: AppColors.gray200),
                  boxShadow: const [
                    BoxShadow(
                      color: AppColors.shadowLight,
                      blurRadius: 10,
                      offset: Offset(0, 2),
                    ),
                  ],
                ),
                child: Text(
                  msg.textContent ?? '',
                  style: const TextStyle(
                    fontSize: 15,
                    color: AppColors.gray900,
                    height: 1.4,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(left: 4, top: 4),
                child: Text(
                  _formatTime(msg.createdAt),
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.gray500,
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildDoctorMessage(Message msg) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                decoration: const BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(DesignTokens.radiusLg),
                    topRight: Radius.circular(DesignTokens.radiusLg),
                    bottomLeft: Radius.circular(DesignTokens.radiusLg),
                    bottomRight: Radius.circular(4),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.shadowPrimary,
                      blurRadius: 10,
                      offset: Offset(0, 2),
                    ),
                  ],
                ),
                child: Text(
                  msg.textContent ?? '',
                  style: const TextStyle(
                    fontSize: 15,
                    color: AppColors.white,
                    height: 1.4,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(right: 4, top: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _formatTime(msg.createdAt),
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.gray500,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(
                      msg.readAt != null
                          ? Icons.done_all_rounded
                          : Icons.check_rounded,
                      size: 14,
                      color: msg.readAt != null
                          ? AppColors.primary
                          : AppColors.gray400,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSmallAvatar() {
    return Container(
      width: 32,
      height: 32,
      decoration: const BoxDecoration(
        gradient: AppColors.primaryGradient,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: const Icon(Icons.person_rounded, color: AppColors.white, size: 16),
    );
  }

  Widget _buildPendingMessage(_PendingMessage msg) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                decoration: const BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(DesignTokens.radiusLg),
                    topRight: Radius.circular(DesignTokens.radiusLg),
                    bottomLeft: Radius.circular(DesignTokens.radiusLg),
                    bottomRight: Radius.circular(4),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.shadowPrimary,
                      blurRadius: 10,
                      offset: Offset(0, 2),
                    ),
                  ],
                ),
                child: Text(
                  msg.text,
                  style: const TextStyle(
                    fontSize: 15,
                    color: AppColors.white,
                    height: 1.4,
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(right: 4, top: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      _formatTime(msg.createdAt.toIso8601String()),
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.gray500,
                      ),
                    ),
                    const SizedBox(width: 4),
                    const SizedBox(
                      width: 12,
                      height: 12,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        color: AppColors.gray400,
                      ),
                    ),
                    const SizedBox(width: 4),
                    const Text(
                      'Sending…',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.gray500,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildInputArea() {
    final sendState = ref.watch(sendMessageProvider);
    final isSending = sendState.loading;
    return Container(
      padding: const EdgeInsets.fromLTRB(
          DesignTokens.spaceMd, 12, DesignTokens.spaceMd, DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        boxShadow: const [
          BoxShadow(
            color: AppColors.shadowLight,
            blurRadius: 10,
            offset: Offset(0, -2),
          ),
        ],
        border: Border(
          top: BorderSide(color: AppColors.gray200),
        ),
      ),
      child: SafeArea(
        child: Row(
          children: [
            IconButton(
              icon: const Icon(Icons.add_circle_outline,
                  color: AppColors.gray400, size: 28),
              onPressed: () {
                // Attachment support is a future enhancement.
              },
            ),
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceMd),
                decoration: BoxDecoration(
                  color: AppColors.background,
                  borderRadius: BorderRadius.circular(DesignTokens.radius2xl),
                ),
                child: TextField(
                  controller: _messageController,
                  textCapitalization: TextCapitalization.sentences,
                  decoration: const InputDecoration(
                    hintText: 'Type a message...',
                    hintStyle: TextStyle(color: AppColors.gray400),
                    border: InputBorder.none,
                  ),
                  style: const TextStyle(
                    fontSize: 15,
                    color: AppColors.gray900,
                  ),
                  onSubmitted: isSending ? null : (_) => _sendMessage(),
                ),
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm),
            Container(
              width: 40,
              height: 40,
              decoration: const BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: AppColors.shadowPrimary,
                    blurRadius: 8,
                    offset: Offset(0, 2),
                  ),
                ],
              ),
              child: IconButton(
                icon: isSending
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.white,
                        ),
                      )
                    : const Icon(Icons.send, color: AppColors.white, size: 20),
                onPressed: isSending ? null : _sendMessage,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
