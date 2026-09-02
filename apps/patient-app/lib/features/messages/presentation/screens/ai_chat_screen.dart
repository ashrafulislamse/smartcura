import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/ai_provider.dart';
import '../../../../core/providers/health_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/vital_chart_widget.dart';

/// AI Assistant Chat Screen — premium, from-scratch redesign.
///
/// Backend flow:
/// 1. POST /ai/conversations → 201 AiConversation (create or resume)
/// 2. POST /ai/conversations/{id}/turns → 202 AiGenerationAccepted (queued)
/// 3. The artifact is produced asynchronously by the worker. The app polls
///    GET /ai/generations/{generation_id}/artifact every 2s until the
///    artifact is ready (200) or the poll times out (30s).
///
/// Handles 501 (AI not configured) and 503 (provider down) distinctly.
class AIChatScreen extends ConsumerStatefulWidget {
  const AIChatScreen({super.key});

  @override
  ConsumerState<AIChatScreen> createState() => _AIChatScreenState();
}

// -----------------------------------------------------------------------------
// Local message model
// -----------------------------------------------------------------------------

class _ChatMessage {
  final String text;
  final bool isUser;
  final DateTime timestamp;
  final String? generationId;
  AiArtifact? artifact;

  _ChatMessage({
    required this.text,
    required this.isUser,
    required this.timestamp,
    this.generationId,
    this.artifact,
  });
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

class _AIChatScreenState extends ConsumerState<AIChatScreen>
    with TickerProviderStateMixin {
  final TextEditingController _messageController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  late AnimationController _typingController;

  final List<_ChatMessage> _messages = [];
  String? _conversationId;
  bool _isCreatingConversation = false;
  bool _isGenerating = false;
  String? _errorMessage;
  bool _isAiUnavailable = false; // 503
  bool _isAiNotConfigured = false; // 501

  static const int _maxChars = 500;

  @override
  void initState() {
    super.initState();
    _typingController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat();
  }

  @override
  void dispose() {
    _typingController.dispose();
    _messageController.dispose();
    _scrollController.dispose();
    super.dispose();
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

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  Future<String?> _ensureConversation() async {
    if (_conversationId != null) return _conversationId;

    setState(() {
      _isCreatingConversation = true;
      _errorMessage = null;
    });

    try {
      final dio = ref.read(apiClientProvider);
      final response = await dio.post<dynamic>(ApiEndpoints.aiConversations);
      final data = response.data as Map<String, dynamic>;
      _conversationId = data['conversation_id'] as String;
      return _conversationId;
    } on DioException catch (e) {
      _handleDioError(e);
      return null;
    } finally {
      if (mounted) setState(() => _isCreatingConversation = false);
    }
  }

  void _handleDioError(DioException e) {
    final apiError = e.error as ApiError?;
    final status = apiError?.status ?? 0;
    if (status == 501) {
      _isAiNotConfigured = true;
      _errorMessage =
          'AI assistant is not configured for this deployment. Please contact support.';
    } else if (status == 503) {
      _isAiUnavailable = true;
      _errorMessage =
          'AI service is temporarily unavailable. Please try again later.';
    } else if (apiError != null) {
      _errorMessage = apiError.userMessage;
    } else {
      _errorMessage = 'Something went wrong. Please try again.';
    }
  }

  Future<void> _sendMessage(
      [String? presetText, AiArtifactType? artifactType]) async {
    final text = (presetText ?? _messageController.text).trim();
    if (text.isEmpty || _isGenerating || _isCreatingConversation) return;

    _messageController.clear();
    setState(() {
      _errorMessage = null;
      _isAiNotConfigured = false;
      _isAiUnavailable = false;
    });

    // Immediately show the user's message.
    _messages.add(_ChatMessage(
      text: text,
      isUser: true,
      timestamp: DateTime.now(),
    ));
    _scrollToBottom();

    // Ensure conversation exists.
    final convId = await _ensureConversation();
    if (convId == null) {
      _scrollToBottom();
      return;
    }

    // Submit the turn.
    setState(() => _isGenerating = true);
    _scrollToBottom();

    final result = await ref.read(submitAiTurnProvider.notifier).submit(
          conversationId: convId,
          content: text,
          artifactType: artifactType ?? AiArtifactType.symptomSummary,
        );

    if (result != null) {
      final genId = result.generationId;
      final msgIndex =
          _messages.length; // will be the index of the AI message we add below
      _messages.add(_ChatMessage(
        text: 'Generating your AI health summary…',
        isUser: false,
        timestamp: DateTime.now(),
        generationId: genId,
      ));
      _scrollToBottom();

      // Poll for the completed artifact. The provider retries every 2s
      // for up to 30s. We await its future and update the placeholder
      // message when the artifact arrives (or on timeout/error).
      //
      // NOTE: ref.listen cannot be used here because _sendMessage is not
      // the build method. ref.read(...future) is the correct way to await
      // a FutureProvider from outside build().
      try {
        final artifact =
            await ref.read(aiArtifactByGenerationProvider(genId).future);
        if (!mounted) return;
        setState(() {
          if (msgIndex < _messages.length &&
              _messages[msgIndex].generationId == genId) {
            _messages[msgIndex] = _ChatMessage(
              text: _artifactDisplayText(artifact),
              isUser: false,
              timestamp: _messages[msgIndex].timestamp,
              generationId: genId,
              artifact: artifact,
            );
          }
        });
        _scrollToBottom();
      } catch (err) {
        if (!mounted) return;
        setState(() {
          if (msgIndex < _messages.length &&
              _messages[msgIndex].generationId == genId) {
            _messages[msgIndex] = _ChatMessage(
              text: err is ApiError
                  ? err.userMessage
                  : 'Analysis is taking longer than expected. '
                      'Please check back later.',
              isUser: false,
              timestamp: _messages[msgIndex].timestamp,
              generationId: genId,
            );
          }
        });
        _scrollToBottom();
      }
    } else {
      final turnState = ref.read(submitAiTurnProvider);
      if (turnState.hasError) {
        final err = turnState.error;
        if (err is ApiError) {
          if (err.status == 501) {
            _isAiNotConfigured = true;
            _errorMessage =
                'AI assistant is not configured for this deployment. Please contact support.';
          } else if (err.status == 503) {
            _isAiUnavailable = true;
            _errorMessage =
                'AI service is temporarily unavailable. Please try again later.';
          } else {
            _errorMessage = err.userMessage;
          }
        }
      }
    }

    if (mounted) {
      setState(() => _isGenerating = false);
      _scrollToBottom();
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  String _formatTime(DateTime dt) {
    final h = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
    final m = dt.minute.toString().padLeft(2, '0');
    final p = dt.hour >= 12 ? 'PM' : 'AM';
    return '$h:$m $p';
  }

  /// Extracts displayable text from a completed artifact. Used as the fallback
  /// message text when the structured card is rendered alongside it.
  String _artifactDisplayText(AiArtifact artifact) {
    final c = artifact.content;
    final parts = <String>[];
    if (c.summaryOfReportedSymptoms != null &&
        c.summaryOfReportedSymptoms!.isNotEmpty) {
      parts.addAll(c.summaryOfReportedSymptoms!);
    }
    if (c.suggestedNextStep != null) {
      parts.add(c.suggestedNextStep!);
    }
    if (parts.isEmpty) return 'AI analysis complete.';
    return parts.join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final vitalReadingsAsync =
        ref.watch(vitalReadingsByMetricProvider(VitalMetric.heartRate));

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.surface,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Column(
          children: [
            _buildHeader(),
            Expanded(child: _buildChatArea(vitalReadingsAsync)),
            if (_errorMessage != null) _buildErrorBanner(),
            _buildInputArea(),
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  Widget _buildHeader() {
    final isOnline = !_isAiUnavailable && !_isAiNotConfigured;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(bottom: BorderSide(color: AppColors.gray100)),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceMd,
              vertical: DesignTokens.spaceSm + 2),
          child: Row(
            children: [
              // Back
              GestureDetector(
                onTap: () => context.pop(),
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: const BoxDecoration(
                    color: AppColors.gray100,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.arrow_back,
                      size: 20, color: AppColors.textPrimary),
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm + 4),

              // Avatar with status dot
              Stack(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [AppColors.secondary, AppColors.primary],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                    ),
                    child: const Icon(Icons.psychology,
                        color: AppColors.white, size: 24),
                  ),
                  Positioned(
                    bottom: 0,
                    right: 0,
                    child: Container(
                      width: 12,
                      height: 12,
                      decoration: BoxDecoration(
                        color: isOnline ? AppColors.success : AppColors.gray400,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.surface, width: 2),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(width: DesignTokens.spaceSm + 4),

              // Title + status
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'SmartCura AI',
                      style: TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        fontFamily: 'Manrope',
                        letterSpacing: DesignTokens.letterSpacingTight,
                      ),
                    ),
                    Text(
                      _isAiNotConfigured
                          ? 'Not Configured'
                          : _isAiUnavailable
                              ? 'Unavailable'
                              : _isGenerating
                                  ? 'Analyzing…'
                                  : 'Online · Ready to help',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: isOnline
                            ? AppColors.successDark
                            : AppColors.gray500,
                        fontFamily: 'Manrope',
                      ),
                    ),
                  ],
                ),
              ),

              // Info button
              GestureDetector(
                onTap: () => _showInfoSheet(context),
                child: Container(
                  width: 40,
                  height: 40,
                  decoration: const BoxDecoration(
                    color: AppColors.gray100,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(Icons.info_outline,
                      size: 20, color: AppColors.gray600),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showInfoSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(DesignTokens.radiusXl)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(DesignTokens.spaceLg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'About SmartCura AI',
                  style: TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    fontFamily: 'Manrope',
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceMd),
                _infoRow(Icons.health_and_safety_outlined, 'Symptom Analysis',
                    'Describe your symptoms for AI-powered insights.'),
                _infoRow(Icons.insights_outlined, 'Health Insights',
                    'Get personalised non-diagnostic summaries.'),
                _infoRow(Icons.privacy_tip_outlined, 'Private & Secure',
                    'Your data stays within your organisation.'),
                const SizedBox(height: DesignTokens.spaceMd),
                Container(
                  padding: const EdgeInsets.all(DesignTokens.spaceMd),
                  decoration: BoxDecoration(
                    color: AppColors.warningContainer,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  child: const Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(Icons.warning_amber_rounded,
                          color: AppColors.warningDark, size: 20),
                      SizedBox(width: DesignTokens.spaceSm + 4),
                      Expanded(
                        child: Text(
                          'AI insights are non-diagnostic and do not replace professional medical advice. Always consult a qualified healthcare provider.',
                          style: TextStyle(
                            fontSize: 13,
                            color: AppColors.warningDark,
                            height: DesignTokens.lineHeightNormal,
                            fontFamily: 'Manrope',
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _infoRow(IconData icon, String title, String subtitle) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
            ),
            child: Icon(icon, color: AppColors.primary, size: 20),
          ),
          const SizedBox(width: DesignTokens.spaceSm + 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                    fontFamily: 'Manrope',
                  ),
                ),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.gray500,
                    fontFamily: 'Manrope',
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Chat area
  // -------------------------------------------------------------------------

  Widget _buildChatArea(AsyncValue<List<VitalReading>> vitalReadingsAsync) {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [AppColors.background, AppColors.gray50],
        ),
      ),
      child: ListView(
        controller: _scrollController,
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd, vertical: DesignTokens.spaceMd),
        children: [
          if (_messages.isEmpty) ...[
            _buildWelcomeCard(vitalReadingsAsync),
            const SizedBox(height: DesignTokens.spaceLg),
            _buildQuickSuggestions(),
          ] else
            ..._messages.map((msg) => Padding(
                  padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
                  child: msg.isUser
                      ? _buildUserMessage(msg.text, _formatTime(msg.timestamp))
                      : _buildAIMessage(msg.text, _formatTime(msg.timestamp),
                          msg.generationId, msg.artifact),
                )),
          if (_isGenerating || _isCreatingConversation) _buildTypingIndicator(),
          if (_isAiNotConfigured)
            _buildStatusCard(
              icon: Icons.cloud_off,
              title: 'AI Not Configured',
              message:
                  'The AI assistant hasn\'t been set up for this deployment. Please contact support to enable it.',
              color: AppColors.gray600,
              bg: AppColors.gray100,
            ),
          if (_isAiUnavailable)
            _buildStatusCard(
              icon: Icons.error_outline,
              title: 'AI Service Unavailable',
              message:
                  'The AI service is temporarily down. Please try again in a few moments.',
              color: AppColors.warningDark,
              bg: AppColors.warningContainer,
            ),
          const SizedBox(height: 100),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Welcome card
  // -------------------------------------------------------------------------

  Widget _buildWelcomeCard(AsyncValue<List<VitalReading>> vitalReadingsAsync) {
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.secondary, AppColors.primary],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.2),
            blurRadius: DesignTokens.elevationLg,
            offset: const Offset(0, DesignTokens.elevationMd),
          ),
        ],
      ),
      child: Column(
        children: [
          // Top section
          Padding(
            padding: const EdgeInsets.all(DesignTokens.spaceLg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 52,
                      height: 52,
                      decoration: BoxDecoration(
                        color: AppColors.white.withValues(alpha: 0.2),
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(Icons.smart_toy,
                          color: AppColors.white, size: 28),
                    ),
                    const SizedBox(width: DesignTokens.spaceSm + 4),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'AI Health Assistant',
                            style: TextStyle(
                              fontSize: 18,
                              fontWeight: FontWeight.w800,
                              color: AppColors.white,
                              fontFamily: 'Manrope',
                              letterSpacing: DesignTokens.letterSpacingTight,
                            ),
                          ),
                          SizedBox(height: 2),
                          Text(
                            'Powered by SmartCura',
                            style: TextStyle(
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                              color: AppColors.primaryContainer,
                              fontFamily: 'Manrope',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: DesignTokens.spaceMd),
                const Text(
                  'Describe your symptoms or ask a health question. I\'ll analyse your input and provide a non-diagnostic summary.',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppColors.white,
                    height: DesignTokens.lineHeightNormal,
                    fontFamily: 'Manrope',
                  ),
                ),
              ],
            ),
          ),
          // Heart rate section (if available)
          vitalReadingsAsync.when(
            loading: () => Padding(
              padding: const EdgeInsets.fromLTRB(DesignTokens.spaceLg, 0,
                  DesignTokens.spaceLg, DesignTokens.spaceLg),
              child: SizedBox(
                height: 1,
                child: LinearProgressIndicator(
                  backgroundColor: AppColors.white.withValues(alpha: 0.3),
                  color: AppColors.white,
                ),
              ),
            ),
            error: (_, __) => const SizedBox.shrink(),
            data: (readings) {
              if (readings.isEmpty) return const SizedBox.shrink();
              return Container(
                margin: const EdgeInsets.fromLTRB(DesignTokens.spaceSm, 0,
                    DesignTokens.spaceSm, DesignTokens.spaceSm),
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          padding:
                              const EdgeInsets.all(DesignTokens.spaceXs + 2),
                          decoration: BoxDecoration(
                            color: AppColors.errorContainer,
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusSm),
                          ),
                          child: const Icon(Icons.favorite,
                              color: AppColors.heartRate, size: 16),
                        ),
                        const SizedBox(width: DesignTokens.spaceSm + 2),
                        const Text(
                          'YOUR HEART RATE',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textSecondary,
                            letterSpacing: DesignTokens.letterSpacingWide,
                            fontFamily: 'Manrope',
                          ),
                        ),
                        const Spacer(),
                        Text(
                          '${readings.last.value.toStringAsFixed(0)} ${readings.last.unit}',
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: AppColors.heartRate,
                            fontFamily: 'Manrope',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: DesignTokens.spaceSm + 2),
                    VitalChartWidget(
                      readings: readings,
                      lineColor: AppColors.heartRate,
                      unit: readings.isNotEmpty ? readings.first.unit : '',
                      minY: 40,
                      maxY: 180,
                    ),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Quick suggestions
  // -------------------------------------------------------------------------

  Widget _buildQuickSuggestions() {
    final suggestions = [
      (
        'How is my health today?',
        Icons.favorite_rounded,
        'Get an AI summary of your latest vitals',
        'How is my health today?',
        AiArtifactType.healthSummary,
      ),
      (
        'Daily health summary',
        Icons.wb_sunny_outlined,
        'Morning overview of today\'s vitals',
        'Give me my daily health summary',
        AiArtifactType.dailySummary,
      ),
      (
        '7-day trend analysis',
        Icons.show_chart_rounded,
        'See how your vitals changed this week',
        'Analyse my vital trends over the past 7 days',
        AiArtifactType.trendAnalysis,
      ),
      (
        'Describe your symptoms',
        Icons.sick_outlined,
        'e.g. "I have a headache and feel dizzy"',
        'I have a headache and feel dizzy',
        AiArtifactType.symptomSummary,
      ),
      (
        'Ask about vitals',
        Icons.monitor_heart,
        'e.g. "What does my heart rate mean?"',
        'What does my heart rate mean?',
        AiArtifactType.symptomSummary,
      ),
      (
        'General health question',
        Icons.help_outline,
        'e.g. "How can I improve my sleep?"',
        'How can I improve my sleep?',
        AiArtifactType.symptomSummary,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(left: 4, bottom: DesignTokens.spaceSm + 4),
          child: Text(
            'HOW CAN I HELP?',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w800,
              color: AppColors.gray400,
              letterSpacing: DesignTokens.letterSpacingWider,
              fontFamily: 'Manrope',
            ),
          ),
        ),
        ...suggestions.map((s) {
          return Padding(
            padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
            child: GestureDetector(
              onTap: () => _sendMessage(s.$4, s.$5),
              child: Container(
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                  border: Border.all(color: AppColors.gray200),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.shadow,
                      blurRadius: DesignTokens.elevationSm,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: AppColors.secondaryContainer,
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusSm),
                      ),
                      child:
                          Icon(s.$2, color: AppColors.secondaryDark, size: 20),
                    ),
                    const SizedBox(width: DesignTokens.spaceSm + 4),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            s.$1,
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                              fontFamily: 'Manrope',
                            ),
                          ),
                          Text(
                            s.$3,
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.gray500,
                              fontFamily: 'Manrope',
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.arrow_forward_ios,
                        size: 12, color: AppColors.gray400),
                  ],
                ),
              ),
            ),
          );
        }),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Message bubbles
  // -------------------------------------------------------------------------

  Widget _buildAIMessage(String message, String time,
      [String? generationId, AiArtifact? artifact]) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // AI avatar
        Container(
          width: 36,
          height: 36,
          margin: const EdgeInsets.only(top: 2),
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [AppColors.secondary, AppColors.primary],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            shape: BoxShape.circle,
          ),
          child: const Icon(Icons.smart_toy, color: AppColors.white, size: 18),
        ),
        const SizedBox(width: DesignTokens.spaceSm + 2),
        // Bubble
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceMd,
                    vertical: DesignTokens.spaceSm + 4),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(DesignTokens.radiusXs),
                    topRight: Radius.circular(DesignTokens.radiusLg),
                    bottomLeft: Radius.circular(DesignTokens.radiusLg),
                    bottomRight: Radius.circular(DesignTokens.radiusLg),
                  ),
                  border: Border.all(color: AppColors.gray200),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.shadow,
                      blurRadius: DesignTokens.elevationSm,
                      offset: const Offset(0, 1),
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
                padding: const EdgeInsets.only(left: 4),
                child: Text(
                  time,
                  style: const TextStyle(
                    fontSize: 10,
                    color: AppColors.gray400,
                    fontFamily: 'Manrope',
                  ),
                ),
              ),
              // Structured artifact card when the artifact is ready.
              if (artifact != null) ...[
                const SizedBox(height: DesignTokens.spaceSm),
                _buildArtifactCard(artifact),
              ],
              // Inline "generating" badge while the worker has not yet produced
              // the artifact.
              if (generationId != null && artifact == null) ...[
                const SizedBox(height: DesignTokens.spaceSm),
                Padding(
                  padding: const EdgeInsets.only(left: 4),
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: DesignTokens.spaceSm + 4,
                        vertical: DesignTokens.spaceXs + 2),
                    decoration: BoxDecoration(
                      color: AppColors.secondaryContainer,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                    child: const Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.hourglass_top,
                            size: 12, color: AppColors.secondaryDark),
                        SizedBox(width: DesignTokens.spaceXs + 2),
                        Text(
                          'Generating AI analysis…',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color: AppColors.secondaryDark,
                            fontFamily: 'Manrope',
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
        const SizedBox(width: 44),
      ],
    );
  }

  /// Structured card that renders the completed AI artifact with its content
  /// fields: summary, next step, disclaimer, and sources.
  Widget _buildArtifactCard(AiArtifact artifact) {
    final c = artifact.content;
    return Padding(
      padding: const EdgeInsets.only(left: 4),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.secondaryContainer,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.secondary.withValues(alpha: 0.2)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header
            Row(
              children: [
                const Icon(Icons.insights,
                    size: 16, color: AppColors.secondaryDark),
                const SizedBox(width: DesignTokens.spaceXs + 2),
                Text(
                  'AI Health Summary',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.secondaryDark,
                    fontFamily: 'Manrope',
                  ),
                ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            // Summary of reported symptoms
            if (c.summaryOfReportedSymptoms != null &&
                c.summaryOfReportedSymptoms!.isNotEmpty) ...[
              ...c.summaryOfReportedSymptoms!.map((s) => Padding(
                    padding:
                        const EdgeInsets.only(bottom: DesignTokens.spaceXs),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('•  ',
                            style: TextStyle(
                                fontSize: 13, color: AppColors.textSecondary)),
                        Expanded(
                          child: Text(
                            s,
                            style: const TextStyle(
                              fontSize: 13,
                              color: AppColors.textPrimary,
                              height: DesignTokens.lineHeightNormal,
                              fontFamily: 'Manrope',
                            ),
                          ),
                        ),
                      ],
                    ),
                  )),
              const SizedBox(height: DesignTokens.spaceXs),
            ],
            // Suggested next step
            if (c.suggestedNextStep != null) ...[
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceSm + 4,
                    vertical: DesignTokens.spaceXs + 2),
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Icon(Icons.arrow_forward,
                        size: 14, color: AppColors.primary),
                    const SizedBox(width: DesignTokens.spaceXs + 2),
                    Expanded(
                      child: Text(
                        c.suggestedNextStep!,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                          fontFamily: 'Manrope',
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: DesignTokens.spaceXs),
            ],
            // Information-only notice (disclaimer)
            if (c.informationOnlyNotice != null)
              Text(
                c.informationOnlyNotice!,
                style: TextStyle(
                  fontSize: 10,
                  color: AppColors.gray500,
                  height: DesignTokens.lineHeightNormal,
                  fontFamily: 'Manrope',
                ),
              ),
            // Sources count
            if (c.sources != null && c.sources!.isNotEmpty) ...[
              const SizedBox(height: DesignTokens.spaceXs),
              Text(
                '${c.sources!.length} knowledge reference${c.sources!.length == 1 ? '' : 's'}',
                style: TextStyle(
                  fontSize: 10,
                  color: AppColors.gray400,
                  fontFamily: 'Manrope',
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildUserMessage(String message, String time) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        const SizedBox(width: 44),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceMd,
                    vertical: DesignTokens.spaceSm + 4),
                decoration: const BoxDecoration(
                  gradient: LinearGradient(
                    colors: [AppColors.primary, AppColors.primaryLight],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.only(
                    topLeft: Radius.circular(DesignTokens.radiusLg),
                    topRight: Radius.circular(DesignTokens.radiusLg),
                    bottomLeft: Radius.circular(DesignTokens.radiusLg),
                    bottomRight: Radius.circular(DesignTokens.radiusXs),
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
                padding: const EdgeInsets.only(right: 4),
                child: Text(
                  time,
                  style: const TextStyle(
                    fontSize: 10,
                    color: AppColors.gray400,
                    fontFamily: 'Manrope',
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Typing indicator
  // -------------------------------------------------------------------------

  Widget _buildTypingIndicator() {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: 36,
            height: 36,
            margin: const EdgeInsets.only(top: 2),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [AppColors.secondary, AppColors.primary],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              shape: BoxShape.circle,
            ),
            child:
                const Icon(Icons.smart_toy, color: AppColors.white, size: 18),
          ),
          const SizedBox(width: DesignTokens.spaceSm + 2),
          Flexible(
            child: Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: DesignTokens.spaceMd,
                  vertical: DesignTokens.spaceMd),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(DesignTokens.radiusXs),
                  topRight: Radius.circular(DesignTokens.radiusLg),
                  bottomLeft: Radius.circular(DesignTokens.radiusLg),
                  bottomRight: Radius.circular(DesignTokens.radiusLg),
                ),
                border: Border.all(color: AppColors.gray200),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildTypingDot(0),
                  const SizedBox(width: DesignTokens.spaceXs + 2),
                  _buildTypingDot(1),
                  const SizedBox(width: DesignTokens.spaceXs + 2),
                  _buildTypingDot(2),
                ],
              ),
            ),
          ),
          const SizedBox(width: 44),
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
            decoration: BoxDecoration(
              color: AppColors.secondary.withValues(alpha: 0.5),
              shape: BoxShape.circle,
            ),
          ),
        );
      },
    );
  }

  // -------------------------------------------------------------------------
  // Status / error cards
  // -------------------------------------------------------------------------

  Widget _buildStatusCard({
    required IconData icon,
    required String title,
    required String message,
    required Color color,
    required Color bg,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: color, size: 24),
            const SizedBox(width: DesignTokens.spaceSm + 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: color,
                      fontFamily: 'Manrope',
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXs + 2),
                  Text(
                    message,
                    style: TextStyle(
                      fontSize: 13,
                      color: color,
                      height: DesignTokens.lineHeightNormal,
                      fontFamily: 'Manrope',
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorBanner() {
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceMd, vertical: DesignTokens.spaceSm + 2),
      color: AppColors.errorContainer,
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppColors.error, size: 20),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Text(
              _errorMessage!,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.errorDark,
                fontFamily: 'Manrope',
              ),
            ),
          ),
          GestureDetector(
            onTap: () => setState(() => _errorMessage = null),
            child: const Icon(Icons.close, color: AppColors.error, size: 18),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Input area — premium chat-style (like ChatGPT / modern messaging apps)
  // -------------------------------------------------------------------------

  Widget _buildInputArea() {
    final isBusy = _isGenerating || _isCreatingConversation;
    final hasText = _messageController.text.trim().isNotEmpty;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.gray100)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
              DesignTokens.spaceMd,
              DesignTokens.spaceSm + 2,
              DesignTokens.spaceMd,
              DesignTokens.spaceSm + 2),
          // One unified container — no separate circles or gaps.
          child: Container(
            constraints: const BoxConstraints(minHeight: 48, maxHeight: 140),
            decoration: BoxDecoration(
              color: AppColors.gray50,
              borderRadius: BorderRadius.circular(DesignTokens.radius2xl),
              border: Border.all(color: AppColors.gray200),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                // + attachment icon — inside the container, no separate circle
                Padding(
                  padding: const EdgeInsets.only(
                      left: DesignTokens.spaceSm + 2,
                      bottom: DesignTokens.spaceSm + 4),
                  child: Icon(Icons.add, color: AppColors.gray400, size: 22),
                ),

                // Text field
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                        horizontal: DesignTokens.spaceSm + 2, vertical: 0),
                    child: TextField(
                      controller: _messageController,
                      maxLines: null,
                      maxLength: _maxChars,
                      textInputAction: TextInputAction.newline,
                      decoration: InputDecoration(
                        hintText: 'Describe your symptoms…',
                        hintStyle: TextStyle(
                          fontSize: 15,
                          color: AppColors.gray400,
                          fontWeight: FontWeight.w400,
                          fontFamily: 'Manrope',
                          height: DesignTokens.lineHeightNormal,
                        ),
                        border: InputBorder.none,
                        enabledBorder: InputBorder.none,
                        focusedBorder: InputBorder.none,
                        contentPadding:
                            const EdgeInsets.symmetric(vertical: 13),
                        isDense: true,
                        counterText: '',
                      ),
                      style: const TextStyle(
                        fontSize: 15,
                        color: AppColors.textPrimary,
                        fontWeight: FontWeight.w400,
                        height: DesignTokens.lineHeightNormal,
                        fontFamily: 'Manrope',
                      ),
                      onChanged: (_) => setState(() {}),
                    ),
                  ),
                ),

                // Send button — inside the container, no separate circle
                Padding(
                  padding: const EdgeInsets.only(
                      right: DesignTokens.spaceXs + 2,
                      bottom: DesignTokens.spaceXs + 2),
                  child: GestureDetector(
                    onTap: isBusy || !hasText ? null : () => _sendMessage(),
                    child: AnimatedContainer(
                      duration: DesignTokens.animationFast,
                      width: 36,
                      height: 36,
                      decoration: BoxDecoration(
                        gradient: hasText && !isBusy
                            ? AppColors.primaryGradient
                            : null,
                        color: hasText && !isBusy ? null : AppColors.gray200,
                        shape: BoxShape.circle,
                      ),
                      child: Center(
                        child: isBusy
                            ? const SizedBox(
                                width: 16,
                                height: 16,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: AppColors.white,
                                ),
                              )
                            : Icon(
                                Icons.arrow_upward_rounded,
                                color: hasText
                                    ? AppColors.white
                                    : AppColors.gray400,
                                size: 20,
                              ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
