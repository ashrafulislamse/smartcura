import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/message_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/state_view.dart';

/// Doctor Chat Screen
///
/// One-on-one chat with a doctor. Wired to real backend:
/// - [conversationMessagesProvider] for the message list (GET /conversations/{id}/messages)
/// - [sendMessageProvider] for sending (POST /conversations/{id}/messages)
/// - [markConversationReadProvider] for read receipts (PUT /conversations/{id}/read)
/// - Polls every 5 seconds until Socket.IO is implemented
class DoctorChatScreen extends ConsumerStatefulWidget {
  final String conversationId;

  const DoctorChatScreen({
    super.key,
    required this.conversationId,
  });

  @override
  ConsumerState<DoctorChatScreen> createState() => _DoctorChatScreenState();
}

class _DoctorChatScreenState extends ConsumerState<DoctorChatScreen>
    with TickerProviderStateMixin {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  Timer? _pollTimer;
  bool _showTypingIndicator = false;
  late AnimationController _typingController;

  @override
  void initState() {
    super.initState();
    _typingController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat();
    _startPolling();
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    _typingController.dispose();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      if (mounted) {
        ref.invalidate(conversationMessagesProvider(widget.conversationId));
      }
    });
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: DesignTokens.animationNormal,
          curve: Curves.easeOut,
        );
      }
    });
  }

  void _markAsRead(List<Message> messages) {
    if (messages.isEmpty) return;
    final maxSeq = messages.fold<int>(
        0, (max, m) => m.sequenceNo > max ? m.sequenceNo : max);
    ref
        .read(markConversationReadProvider(
          (conversationId: widget.conversationId, throughSequenceNo: maxSeq),
        ).future)
        .catchError((_) {});
  }

  Future<void> _sendMessage() async {
    final text = _messageController.text.trim();
    if (text.isEmpty) return;

    _messageController.clear();
    setState(() => _showTypingIndicator = true);

    await ref.read(sendMessageProvider.notifier).sendText(
          conversationId: widget.conversationId,
          text: text,
        );

    if (mounted) {
      setState(() => _showTypingIndicator = false);
      ref.invalidate(conversationMessagesProvider(widget.conversationId));
      _scrollToBottom();
    }
  }

  String _formatTime(String isoTimestamp) {
    try {
      final dt = DateTime.parse(isoTimestamp).toLocal();
      final hour = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
      final minute = dt.minute.toString().padLeft(2, '0');
      final period = dt.hour >= 12 ? 'PM' : 'AM';
      return '$hour:$minute $period';
    } catch (_) {
      return '';
    }
  }

  String _formatDate(String isoTimestamp) {
    try {
      final dt = DateTime.parse(isoTimestamp).toLocal();
      final now = DateTime.now();
      if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
        return 'Today';
      }
      final yesterday = now.subtract(const Duration(days: 1));
      if (dt.year == yesterday.year &&
          dt.month == yesterday.month &&
          dt.day == yesterday.day) {
        return 'Yesterday';
      }
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }

  List<dynamic> _buildGroupedItems(List<Message> messages) {
    final items = <dynamic>[];
    String? lastDate;
    for (final msg in messages) {
      final dateLabel = _formatDate(msg.createdAt);
      if (dateLabel.isNotEmpty && dateLabel != lastDate) {
        items.add(dateLabel);
        lastDate = dateLabel;
      }
      items.add(msg);
    }
    return items;
  }

  @override
  Widget build(BuildContext context) {
    final messagesAsync =
        ref.watch(conversationMessagesProvider(widget.conversationId));

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: messagesAsync.when(
                loading: () => _buildShimmerChat(),
                error: (error, _) => ErrorView(
                  message: _errorMessage(error),
                  onRetry: () => ref.invalidate(
                      conversationMessagesProvider(widget.conversationId)),
                ),
                data: (messages) {
                  if (messages.isEmpty) {
                    return _buildEmptyChat();
                  }
                  WidgetsBinding.instance.addPostFrameCallback((_) {
                    _markAsRead(messages);
                    _scrollToBottom();
                  });
                  return _buildChatArea(messages);
                },
              ),
            ),
            _buildInputArea(),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          bottom: BorderSide(color: AppColors.gray100),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceMd,
              vertical: DesignTokens.spaceSm + 4),
          child: Row(
            children: [
              GestureDetector(
                onTap: () => context.pop(),
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.gray100,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.arrow_back,
                      size: 20, color: AppColors.textPrimary),
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm + 4),
              AvatarWidget(
                name: 'Dr',
                size: 44,
                gradient: AppColors.primaryGradient,
              ),
              const SizedBox(width: DesignTokens.spaceSm + 4),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Doctor',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        fontFamily: 'Manrope',
                        letterSpacing: DesignTokens.letterSpacingTight,
                      ),
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
                        const SizedBox(width: DesignTokens.spaceXs + 2),
                        const Text(
                          'Online',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textSecondary,
                            fontFamily: 'Manrope',
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              GestureDetector(
                onTap: () {},
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.gray100,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.videocam_outlined,
                    color: AppColors.primary,
                    size: 20,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildChatArea(List<Message> messages) {
    final items = _buildGroupedItems(messages);

    return ListView.builder(
      controller: _scrollController,
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      itemCount: items.length + 1,
      itemBuilder: (context, index) {
        if (index == items.length) {
          return _showTypingIndicator
              ? _buildTypingIndicator()
              : const SizedBox(height: 80);
        }
        final item = items[index];
        if (item is String) {
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
            child: _buildDateSeparator(item),
          );
        }
        final msg = item as Message;
        final timeStr = _formatTime(msg.createdAt);
        return Padding(
          padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
          child: msg.isMe
              ? _buildPatientMessage(msg.textContent ?? '', timeStr,
                  isRead: msg.readAt != null)
              : _buildDoctorMessage(msg.textContent ?? '', timeStr),
        );
      },
    );
  }

  Widget _buildEmptyChat() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.chat_bubble_outline,
                size: 64, color: AppColors.gray300),
            const SizedBox(height: DesignTokens.spaceMd),
            const Text(
              'No messages yet',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
                fontFamily: 'Manrope',
              ),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            const Text(
              'Send a message to start the conversation with your doctor.',
              style: TextStyle(
                fontSize: 14,
                color: AppColors.gray500,
                fontFamily: 'Manrope',
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDateSeparator(String label) {
    return Center(
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceSm + 4,
            vertical: DesignTokens.spaceXs + 2),
        decoration: BoxDecoration(
          color: AppColors.gray100,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        ),
        child: Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary,
            fontFamily: 'Manrope',
          ),
        ),
      ),
    );
  }

  Widget _buildTypingIndicator() {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          AvatarWidget(
            name: 'Dr',
            size: 32,
            gradient: AppColors.primaryGradient,
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Flexible(
            child: Container(
              padding: const EdgeInsets.all(DesignTokens.spaceSm + 6),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [AppColors.primary, AppColors.primaryLight],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.only(
                  topLeft: Radius.circular(DesignTokens.radiusXs),
                  topRight: Radius.circular(DesignTokens.radiusLg),
                  bottomLeft: Radius.circular(DesignTokens.radiusLg),
                  bottomRight: Radius.circular(DesignTokens.radiusLg),
                ),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildTypingDot(0),
                  const SizedBox(width: DesignTokens.spaceXs),
                  _buildTypingDot(1),
                  const SizedBox(width: DesignTokens.spaceXs),
                  _buildTypingDot(2),
                ],
              ),
            ),
          ),
          const SizedBox(width: 60),
        ],
      ),
    );
  }

  Widget _buildTypingDot(int dotIndex) {
    return AnimatedBuilder(
      animation: _typingController,
      builder: (context, child) {
        final progress = (_typingController.value * 3 - dotIndex).abs();
        final scale = progress < 1.0 ? 1.0 - progress * 0.4 : 0.6;
        return Transform.scale(
          scale: scale,
          child: Container(
            width: 8,
            height: 8,
            decoration: const BoxDecoration(
              color: AppColors.white,
              shape: BoxShape.circle,
            ),
          ),
        );
      },
    );
  }

  Widget _buildDoctorMessage(String message, String time) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        AvatarWidget(
          name: 'Dr',
          size: 32,
          gradient: AppColors.primaryGradient,
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.all(DesignTokens.spaceSm + 6),
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [AppColors.primary, AppColors.primaryLight],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(DesignTokens.radiusXs),
                    topRight: Radius.circular(DesignTokens.radiusLg),
                    bottomLeft: Radius.circular(DesignTokens.radiusLg),
                    bottomRight: Radius.circular(DesignTokens.radiusLg),
                  ),
                ),
                child: Text(
                  message,
                  style: const TextStyle(
                    fontSize: 14,
                    color: AppColors.white,
                    height: DesignTokens.lineHeightNormal,
                    fontFamily: 'Manrope',
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceXs),
              Padding(
                padding: const EdgeInsets.only(left: 4),
                child: Text(
                  time,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textSecondary,
                    fontFamily: 'Manrope',
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 60),
      ],
    );
  }

  Widget _buildPatientMessage(String message, String time,
      {bool isRead = false}) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        const SizedBox(width: 60),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                padding: const EdgeInsets.all(DesignTokens.spaceSm + 6),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(DesignTokens.radiusLg),
                    topRight: Radius.circular(DesignTokens.radiusLg),
                    bottomLeft: Radius.circular(DesignTokens.radiusLg),
                    bottomRight: Radius.circular(DesignTokens.radiusXs),
                  ),
                  border: Border.all(color: AppColors.gray200),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.shadow,
                      blurRadius: DesignTokens.elevationSm,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Text(
                  message,
                  style: const TextStyle(
                    fontSize: 14,
                    color: AppColors.textPrimary,
                    height: DesignTokens.lineHeightNormal,
                    fontFamily: 'Manrope',
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceXs),
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      time,
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.textSecondary,
                        fontFamily: 'Manrope',
                      ),
                    ),
                    const SizedBox(width: DesignTokens.spaceXs),
                    Icon(
                      isRead ? Icons.done_all : Icons.done,
                      size: 14,
                      color:
                          isRead ? AppColors.primary : AppColors.textSecondary,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Container(
          width: 32,
          height: 32,
          decoration: const BoxDecoration(
            color: AppColors.gray100,
            shape: BoxShape.circle,
          ),
          child: const Center(
            child: Text(
              'Me',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: AppColors.textSecondary,
                fontFamily: 'Manrope',
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildShimmerChat() {
    return ListView(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      children: List.generate(6, (index) {
        final isMe = index % 2 == 0;
        return Padding(
          padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
          child: Row(
            mainAxisAlignment:
                isMe ? MainAxisAlignment.end : MainAxisAlignment.start,
            children: [
              if (!isMe) ...[
                Container(
                  width: 32,
                  height: 32,
                  decoration: const BoxDecoration(
                    color: AppColors.gray100,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
              ],
              Container(
                width: 200,
                height: 48,
                decoration: BoxDecoration(
                  color: AppColors.gray100,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                ),
              ),
              if (isMe) ...[
                const SizedBox(width: DesignTokens.spaceSm),
                Container(
                  width: 32,
                  height: 32,
                  decoration: const BoxDecoration(
                    color: AppColors.gray100,
                    shape: BoxShape.circle,
                  ),
                ),
              ],
            ],
          ),
        );
      }),
    );
  }

  Widget _buildInputArea() {
    final sendState = ref.watch(sendMessageProvider);
    final isSending = sendState.isLoading;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        boxShadow: [
          BoxShadow(
            color: AppColors.shadow,
            blurRadius: DesignTokens.elevationSm,
            offset: Offset(0, -1),
          ),
        ],
      ),
      padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceSm + 4,
          vertical: DesignTokens.spaceSm + 2),
      child: SafeArea(
        top: false,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Container(
              width: 44,
              height: 44,
              margin: const EdgeInsets.only(right: DesignTokens.spaceSm),
              decoration: const BoxDecoration(
                color: AppColors.gray100,
                shape: BoxShape.circle,
              ),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: () {},
                  borderRadius: BorderRadius.circular(22),
                  child: const Center(
                    child: Icon(Icons.add,
                        color: AppColors.textSecondary, size: 24),
                  ),
                ),
              ),
            ),
            Expanded(
              child: Container(
                constraints: const BoxConstraints(
                  minHeight: 44,
                  maxHeight: 120,
                ),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(22),
                  border: Border.all(color: AppColors.gray200),
                ),
                padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceMd,
                    vertical: DesignTokens.spaceSm + 2),
                child: TextField(
                  controller: _messageController,
                  maxLines: null,
                  textInputAction: TextInputAction.newline,
                  decoration: const InputDecoration(
                    hintText: 'Type your message...',
                    hintStyle: TextStyle(
                      fontSize: 16,
                      color: AppColors.textDisabled,
                      fontWeight: FontWeight.w400,
                      fontFamily: 'Manrope',
                    ),
                    border: InputBorder.none,
                    contentPadding: EdgeInsets.zero,
                    isDense: true,
                  ),
                  style: const TextStyle(
                    fontSize: 16,
                    color: AppColors.textPrimary,
                    fontWeight: FontWeight.w400,
                    height: DesignTokens.lineHeightNormal,
                    fontFamily: 'Manrope',
                  ),
                ),
              ),
            ),
            Container(
              width: 44,
              height: 44,
              margin: const EdgeInsets.only(left: DesignTokens.spaceSm),
              decoration: const BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
              ),
              child: Material(
                color: Colors.transparent,
                child: InkWell(
                  onTap: isSending ? null : _sendMessage,
                  borderRadius: BorderRadius.circular(22),
                  child: Center(
                    child: isSending
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppColors.white,
                            ),
                          )
                        : const Icon(Icons.send,
                            color: AppColors.white, size: 20),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _errorMessage(Object? error) {
    if (error == null) return 'Something went wrong';

    if (error is DioException) {
      final apiError = error.error as ApiError?;
      if (apiError != null) return _apiErrorMessage(apiError);
      return _dioExceptionMessage(error);
    }

    if (error is ApiError) return _apiErrorMessage(error);

    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return error.toString();
  }

  String _apiErrorMessage(ApiError e) {
    if (e.isForbidden) {
      return 'You don\'t have permission to access this conversation.';
    }
    if (e.isUnauthenticated) {
      return 'Your session has expired. Please sign in again.';
    }
    if (e.isNotFound) {
      return 'This conversation could not be found. It may have been removed.';
    }
    if (e.isServer) {
      return 'The server is having trouble. Please try again in a moment.';
    }
    if (e.isNetwork) {
      return 'Cannot reach SmartCura. Check your internet connection and try again.';
    }
    return e.userMessage;
  }

  String _dioExceptionMessage(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return 'The request timed out. Please try again.';
      case DioExceptionType.connectionError:
        return 'Cannot reach SmartCura. Check your internet connection.';
      case DioExceptionType.cancel:
        return 'The request was cancelled.';
      default:
        return 'Something went wrong. Please try again.';
    }
  }
}
