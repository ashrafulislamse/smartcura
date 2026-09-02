import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/message_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';

/// In-call chat panel for a video consultation.
///
/// Loads the consultation's conversation, displays messages, and lets the
/// patient send text messages through the existing messaging infrastructure.
class VideoConsultationChatPanel extends ConsumerStatefulWidget {
  final String consultationId;
  final String doctorName;
  final String? doctorImageUrl;
  final String patientName;
  final VoidCallback onClose;

  const VideoConsultationChatPanel({
    super.key,
    required this.consultationId,
    required this.doctorName,
    this.doctorImageUrl,
    required this.patientName,
    required this.onClose,
  });

  @override
  ConsumerState<VideoConsultationChatPanel> createState() =>
      _VideoConsultationChatPanelState();
}

class _VideoConsultationChatPanelState
    extends ConsumerState<VideoConsultationChatPanel> {
  final _textController = TextEditingController();
  final _scrollController = ScrollController();
  String? _conversationId;
  bool _loading = true;
  String? _error;
  List<Message> _messages = [];
  bool _sending = false;

  @override
  void initState() {
    super.initState();
    _loadConversation();
  }

  @override
  void dispose() {
    _textController.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _loadConversation() async {
    try {
      final dio = ref.read(apiClientProvider);
      final response = await dio.get<dynamic>(
        ApiEndpoints.consultationConversation(widget.consultationId),
      );
      final conversation = ConversationMapper.fromJson(
        response.data as Map<String, dynamic>,
      );
      if (mounted) {
        setState(() {
          _conversationId = conversation.conversationId;
          _loading = false;
        });
      }
      await _loadMessages();
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      if (mounted) {
        setState(() {
          _loading = false;
          _error = apiError?.isNotFound == true
              ? 'Chat is not available for this consultation yet.'
              : (apiError?.userMessage ?? 'Could not load chat.');
        });
      }
    }
  }

  Future<void> _loadMessages() async {
    if (_conversationId == null) return;
    try {
      final dio = ref.read(apiClientProvider);
      final response = await dio.get<dynamic>(
        ApiEndpoints.conversationMessages(_conversationId!),
        queryParameters: {'page_size': 100},
      );
      final messages = MessageListMapper.fromJson(
        response.data as Map<String, dynamic>,
      );
      if (mounted) {
        setState(() => _messages = messages);
        _scrollToBottom();
      }
    } on DioException catch (e) {
      debugPrint('[ChatPanel] load messages error: $e');
    }
  }

  Future<void> _sendMessage() async {
    final text = _textController.text.trim();
    if (text.isEmpty || _conversationId == null || _sending) return;

    setState(() => _sending = true);
    final notifier = ref.read(sendMessageProvider.notifier);
    final message = await notifier.sendText(
      conversationId: _conversationId!,
      text: text,
    );
    if (mounted) {
      _textController.clear();
      setState(() => _sending = false);
      if (message != null) {
        setState(() => _messages = [..._messages, message]);
        _scrollToBottom();
      }
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        _scrollController.animateTo(
          _scrollController.position.maxScrollExtent,
          duration: DesignTokens.animationFast,
          curve: Curves.easeOut,
        );
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height * 0.65,
      decoration: BoxDecoration(
        color: AppColors.gray900,
        borderRadius: const BorderRadius.only(
          topLeft: Radius.circular(DesignTokens.radius2xl),
          topRight: Radius.circular(DesignTokens.radius2xl),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          children: [
            // Handle and header.
            Container(
              padding: const EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceSm,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
              ),
              decoration: BoxDecoration(
                color: AppColors.gray800.withValues(alpha: 0.5),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(DesignTokens.radius2xl),
                  topRight: Radius.circular(DesignTokens.radius2xl),
                ),
              ),
              child: Column(
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.white.withValues(alpha: 0.3),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  Row(
                    children: [
                      AvatarWidget(
                        imageUrl: widget.doctorImageUrl,
                        name: widget.doctorName,
                        size: 40,
                      ),
                      const SizedBox(width: DesignTokens.spaceMd),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Chat with ${widget.doctorName}',
                              style: const TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: AppColors.white,
                              ),
                            ),
                            const Text(
                              'Messages during consultation',
                              style: TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 12,
                                color: AppColors.gray400,
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: widget.onClose,
                        icon: const Icon(Icons.close, color: AppColors.white),
                        tooltip: 'Close chat',
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // Messages.
            Expanded(
              child: _loading
                  ? const Center(
                      child:
                          CircularProgressIndicator(color: AppColors.primary),
                    )
                  : _error != null && _messages.isEmpty
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(DesignTokens.spaceLg),
                            child: Text(
                              _error!,
                              textAlign: TextAlign.center,
                              style: const TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 14,
                                color: AppColors.gray400,
                                height: 1.5,
                              ),
                            ),
                          ),
                        )
                      : ListView.builder(
                          controller: _scrollController,
                          padding: const EdgeInsets.all(DesignTokens.spaceMd),
                          itemCount: _messages.length,
                          itemBuilder: (context, index) {
                            final message = _messages[index];
                            final showDate = index == 0 ||
                                !_sameDay(
                                  _messages[index - 1].createdAt,
                                  message.createdAt,
                                );
                            return Column(
                              children: [
                                if (showDate)
                                  _buildDateLabel(message.createdAt),
                                _buildMessageBubble(message),
                              ],
                            );
                          },
                        ),
            ),

            // Input.
            Container(
              padding: EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                MediaQuery.of(context).padding.bottom + DesignTokens.spaceMd,
              ),
              decoration: BoxDecoration(
                color: AppColors.gray800.withValues(alpha: 0.5),
                border: Border(
                  top: BorderSide(
                    color: AppColors.white.withValues(alpha: 0.1),
                  ),
                ),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _textController,
                      enabled: _conversationId != null && !_loading,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        color: AppColors.white,
                      ),
                      decoration: InputDecoration(
                        hintText: 'Type a message...',
                        hintStyle: TextStyle(
                          fontFamily: 'Manrope',
                          color: AppColors.gray400.withValues(alpha: 0.7),
                        ),
                        filled: true,
                        fillColor: AppColors.gray700.withValues(alpha: 0.5),
                        border: OutlineInputBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusFull),
                          borderSide: BorderSide.none,
                        ),
                        contentPadding: const EdgeInsets.symmetric(
                          horizontal: DesignTokens.spaceMd,
                          vertical: DesignTokens.spaceSm,
                        ),
                      ),
                      textInputAction: TextInputAction.send,
                      onSubmitted: (_) => _sendMessage(),
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm),
                  IconButton(
                    onPressed: _sending ? null : _sendMessage,
                    icon: _sending
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppColors.primary,
                            ),
                          )
                        : const Icon(Icons.send, color: AppColors.primary),
                    tooltip: 'Send message',
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDateLabel(String timestamp) {
    final date = DateTime.parse(timestamp).toLocal();
    final now = DateTime.now();
    String label;
    if (date.year == now.year &&
        date.month == now.month &&
        date.day == now.day) {
      label = 'Today';
    } else if (date.year == now.year &&
        date.month == now.month &&
        date.day == now.day - 1) {
      label = 'Yesterday';
    } else {
      label = DateFormat('MMM d, yyyy').format(date);
    }
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
      child: Center(
        child: Container(
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd,
            vertical: DesignTokens.spaceXs,
          ),
          decoration: BoxDecoration(
            color: AppColors.gray700.withValues(alpha: 0.5),
            borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
          ),
          child: Text(
            label,
            style: const TextStyle(
              fontFamily: 'Manrope',
              fontSize: 11,
              fontWeight: FontWeight.w500,
              color: AppColors.gray400,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildMessageBubble(Message message) {
    final isMe = message.isMe;
    final alignment = isMe ? CrossAxisAlignment.end : CrossAxisAlignment.start;
    final bgColor = isMe ? AppColors.primary : AppColors.gray700;
    final textColor = isMe ? AppColors.white : AppColors.white;
    final time = DateTime.parse(message.createdAt).toLocal();
    final timeText = DateFormat('h:mm a').format(time);

    return Align(
      alignment: isMe ? Alignment.centerRight : Alignment.centerLeft,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.75,
        ),
        child: Column(
          crossAxisAlignment: alignment,
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              decoration: BoxDecoration(
                color: bgColor,
                borderRadius: BorderRadius.only(
                  topLeft: const Radius.circular(DesignTokens.radiusLg),
                  topRight: const Radius.circular(DesignTokens.radiusLg),
                  bottomLeft: Radius.circular(
                    isMe ? DesignTokens.radiusLg : DesignTokens.radiusXs,
                  ),
                  bottomRight: Radius.circular(
                    isMe ? DesignTokens.radiusXs : DesignTokens.radiusLg,
                  ),
                ),
              ),
              child: Text(
                message.textContent ?? '',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  color: textColor,
                  height: 1.4,
                ),
              ),
            ),
            const SizedBox(height: 2),
            Text(
              timeText,
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 10,
                color: AppColors.gray400.withValues(alpha: 0.8),
              ),
            ),
          ],
        ),
      ),
    );
  }

  bool _sameDay(String a, String b) {
    final da = DateTime.parse(a).toLocal();
    final db = DateTime.parse(b).toLocal();
    return da.year == db.year && da.month == db.month && da.day == db.day;
  }
}
