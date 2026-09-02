import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/ai_provider.dart';
import '../../../../core/providers/message_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../../core/widgets/status_badge.dart';

/// Messages List Screen — Chat Hub
///
/// Two tabs:
/// - **AI Assistant**: hero card to start/continue an AI conversation
/// - **Doctors**: patient-scoped consultation conversations from real API
///
/// Patient flow for doctor conversations:
///   GET /profiles/me/consultations → GET /consultations/{id}/conversation
///   → GET /conversations/{id}/messages (in [DoctorChatScreen])
class MessagesListScreen extends ConsumerStatefulWidget {
  const MessagesListScreen({super.key});

  @override
  ConsumerState<MessagesListScreen> createState() => _MessagesListScreenState();
}

enum _MessageTab { aiAssistant, doctors }

class _MessagesListScreenState extends ConsumerState<MessagesListScreen>
    with SingleTickerProviderStateMixin {
  _MessageTab _selectedTab = _MessageTab.aiAssistant;
  late AnimationController _animController;
  late Animation<double> _tabAnim;
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: DesignTokens.animationNormal,
    );
    _tabAnim = CurvedAnimation(
      parent: _animController,
      curve: Curves.easeInOut,
    );
    _animController.forward();
  }

  @override
  void dispose() {
    _animController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  StatusTone _consultationStatusTone(ConsultationStatus s) {
    switch (s) {
      case ConsultationStatus.inProgress:
        return StatusTone.info;
      case ConsultationStatus.completed:
        return StatusTone.success;
      case ConsultationStatus.cancelled:
        return StatusTone.neutral;
      case ConsultationStatus.notStarted:
      case ConsultationStatus.ready:
        return StatusTone.warning;
      case ConsultationStatus.unknown:
        return StatusTone.neutral;
    }
  }

  String _consultationStatusLabel(ConsultationStatus s) {
    switch (s) {
      case ConsultationStatus.notStarted:
        return 'Not Started';
      case ConsultationStatus.ready:
        return 'Ready';
      case ConsultationStatus.inProgress:
        return 'In Progress';
      case ConsultationStatus.completed:
        return 'Completed';
      case ConsultationStatus.cancelled:
        return 'Cancelled';
      case ConsultationStatus.unknown:
        return 'Unknown';
    }
  }

  String _conversationStatusTone(String status) {
    switch (status) {
      case 'active':
        return 'Active';
      case 'closed':
        return 'Closed';
      default:
        return status;
    }
  }

  String _shortId(String id) => id.length <= 12 ? id : '${id.substring(0, 8)}…';

  String _formatDate(String? isoTimestamp) {
    if (isoTimestamp == null || isoTimestamp.isEmpty) return '';
    try {
      final dt = DateTime.parse(isoTimestamp).toLocal();
      final now = DateTime.now();
      if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
        return 'Today';
      }
      final y = now.subtract(const Duration(days: 1));
      if (dt.year == y.year && dt.month == y.month && dt.day == y.day) {
        return 'Yesterday';
      }
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }

  @override
  Widget build(BuildContext context) {
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
        body: SafeArea(
          child: Column(
            children: [
              _buildHeader(),
              _buildTabSwitcher(),
              if (_selectedTab == _MessageTab.doctors) _buildSearchBar(),
              Expanded(
                child: _selectedTab == _MessageTab.aiAssistant
                    ? _buildAIAssistantTab()
                    : _buildDoctorsTab(),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(DesignTokens.spaceLg,
          DesignTokens.spaceMd, DesignTokens.spaceLg, DesignTokens.spaceMd),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          const Text(
            'Messages',
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              letterSpacing: DesignTokens.letterSpacingTight,
              fontFamily: 'Manrope',
            ),
          ),
          GestureDetector(
            onTap: () => context.push('/notifications'),
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.surface,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.gray200),
              ),
              child: const Icon(
                Icons.notifications_outlined,
                size: 20,
                color: AppColors.gray600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Tab Switcher
  // -------------------------------------------------------------------------

  Widget _buildTabSwitcher() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          DesignTokens.spaceLg, 0, DesignTokens.spaceLg, DesignTokens.spaceMd),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceXs),
        decoration: BoxDecoration(
          color: AppColors.gray100,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        ),
        child: Row(
          children: [
            Expanded(
              child: _buildTabButton(
                'AI Assistant',
                _MessageTab.aiAssistant,
                Icons.psychology_outlined,
              ),
            ),
            Expanded(
              child: _buildTabButton(
                'Doctors',
                _MessageTab.doctors,
                Icons.medical_services_outlined,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTabButton(String label, _MessageTab tab, IconData icon) {
    final isSelected = _selectedTab == tab;
    return GestureDetector(
      onTap: () => setState(() => _selectedTab = tab),
      child: AnimatedContainer(
        duration: DesignTokens.animationFast,
        padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm + 2),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.surface : Colors.transparent,
          borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: AppColors.shadow,
                    blurRadius: DesignTokens.elevationSm,
                    offset: const Offset(0, 2),
                  ),
                ]
              : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(
              icon,
              size: 18,
              color: isSelected ? AppColors.primary : AppColors.gray500,
            ),
            const SizedBox(width: DesignTokens.spaceSm - 2),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
                color: isSelected ? AppColors.primary : AppColors.gray600,
                fontFamily: 'Manrope',
              ),
            ),
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Search Bar (Doctors tab only)
  // -------------------------------------------------------------------------

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(DesignTokens.spaceLg - 4, 0,
          DesignTokens.spaceLg - 4, DesignTokens.spaceMd),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          border: Border.all(color: AppColors.gray200),
        ),
        child: TextField(
          controller: _searchController,
          style: const TextStyle(
            fontSize: 15,
            color: AppColors.textPrimary,
            fontFamily: 'Manrope',
          ),
          decoration: InputDecoration(
            hintText: 'Search conversations...',
            hintStyle: const TextStyle(
              fontSize: 15,
              color: AppColors.textDisabled,
              fontFamily: 'Manrope',
            ),
            prefixIcon:
                const Icon(Icons.search, size: 20, color: AppColors.gray400),
            border: InputBorder.none,
            contentPadding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceMd,
                vertical: DesignTokens.spaceSm + 4),
          ),
          onChanged: (v) => setState(() => _searchQuery = v.toLowerCase()),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // AI Assistant Tab
  // -------------------------------------------------------------------------

  Widget _buildAIAssistantTab() {
    final aiConvAsync = ref.watch(aiConversationProvider);

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(aiConversationProvider),
      color: AppColors.primary,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(DesignTokens.spaceLg - 2, 0,
            DesignTokens.spaceLg - 2, DesignTokens.space2xl),
        children: [
          // Hero card
          _buildAIHeroCard(),
          const SizedBox(height: DesignTokens.spaceLg),

          // Active conversation card (from real API)
          aiConvAsync.when(
            loading: () => _buildShimmerCard(),
            error: (error, _) => ErrorView(
              message: _errorMessage(error),
              onRetry: () => ref.invalidate(aiConversationProvider),
            ),
            data: (conv) {
              if (conv.status == 'active') {
                return _buildActiveConversationCard(conv);
              }
              return _buildStartCard();
            },
          ),
          const SizedBox(height: DesignTokens.spaceLg),

          // Feature highlights
          _buildFeatureHighlights(),
          const SizedBox(height: DesignTokens.spaceLg),

          // Quick suggestions
          _buildQuickSuggestions(),
        ],
      ),
    );
  }

  Widget _buildAIHeroCard() {
    return GestureDetector(
      onTap: () => context.push('/ai-chat'),
      child: Container(
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [AppColors.primary, AppColors.primaryLight],
          ),
          borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          boxShadow: [
            BoxShadow(
              color: AppColors.primary.withValues(alpha: 0.3),
              blurRadius: DesignTokens.elevationLg,
              offset: const Offset(0, DesignTokens.elevationMd),
            ),
          ],
        ),
        padding: const EdgeInsets.all(DesignTokens.spaceLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: AppColors.white.withValues(alpha: 0.2),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.psychology,
                    color: AppColors.white,
                    size: 28,
                  ),
                ),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceSm + 4,
                      vertical: DesignTokens.spaceXs + 2),
                  decoration: BoxDecoration(
                    color: AppColors.white.withValues(alpha: 0.15),
                    borderRadius:
                        BorderRadius.circular(DesignTokens.radiusFull),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.auto_awesome,
                          size: 14, color: AppColors.white),
                      SizedBox(width: 4),
                      Text(
                        'AI Powered',
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          color: AppColors.white,
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
              'AI Health Assistant',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppColors.white,
                fontFamily: 'Manrope',
                letterSpacing: DesignTokens.letterSpacingTight,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceXs),
            const Text(
              'Ask me anything about your health.\nGet instant symptom analysis and insights.',
              style: TextStyle(
                fontSize: 14,
                color: AppColors.primaryContainer,
                height: DesignTokens.lineHeightNormal,
                fontFamily: 'Manrope',
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceMd,
                      vertical: DesignTokens.spaceSm + 2),
                  decoration: BoxDecoration(
                    color: AppColors.white,
                    borderRadius:
                        BorderRadius.circular(DesignTokens.radiusFull),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Start Chatting',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primary,
                          fontFamily: 'Manrope',
                        ),
                      ),
                      SizedBox(width: DesignTokens.spaceSm - 2),
                      Icon(Icons.arrow_forward,
                          size: 16, color: AppColors.primary),
                    ],
                  ),
                ),
                const Spacer(),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActiveConversationCard(AiConversation conv) {
    return GestureDetector(
      onTap: () => context.push('/ai-chat'),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(
            color: AppColors.secondary.withValues(alpha: 0.2),
          ),
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
              width: 48,
              height: 48,
              decoration: const BoxDecoration(
                gradient: AppColors.secondaryGradient,
                shape: BoxShape.circle,
              ),
              child:
                  const Icon(Icons.smart_toy, color: AppColors.white, size: 22),
            ),
            const SizedBox(width: DesignTokens.spaceSm + 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Active AI Conversation',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                      fontFamily: 'Manrope',
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'ID: ${_shortId(conv.conversationId)}',
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.gray500,
                      fontFamily: 'Manrope',
                    ),
                  ),
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(
                  horizontal: DesignTokens.spaceSm + 2,
                  vertical: DesignTokens.spaceXs),
              decoration: BoxDecoration(
                color: AppColors.successContainer,
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 6,
                    height: 6,
                    decoration: const BoxDecoration(
                      color: AppColors.success,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceXs),
                  const Text(
                    'Active',
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.successDark,
                      fontFamily: 'Manrope',
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm),
            const Icon(Icons.arrow_forward_ios,
                size: 14, color: AppColors.gray400),
          ],
        ),
      ),
    );
  }

  Widget _buildStartCard() {
    return GestureDetector(
      onTap: () => context.push('/ai-chat'),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.secondaryContainer,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(
            color: AppColors.secondary.withValues(alpha: 0.15),
          ),
        ),
        child: Row(
          children: [
            const Icon(Icons.add_circle, color: AppColors.secondary, size: 28),
            const SizedBox(width: DesignTokens.spaceSm + 4),
            const Expanded(
              child: Text(
                'Tap to start your first AI conversation',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.secondaryDark,
                  fontFamily: 'Manrope',
                ),
              ),
            ),
            const Icon(Icons.arrow_forward_ios,
                size: 14, color: AppColors.secondary),
          ],
        ),
      ),
    );
  }

  Widget _buildFeatureHighlights() {
    final features = [
      (
        icon: Icons.health_and_safety_outlined,
        title: 'Symptom Analysis',
        subtitle: 'Describe your symptoms',
        color: AppColors.primary,
      ),
      (
        icon: Icons.insights_outlined,
        title: 'Health Insights',
        subtitle: 'AI-powered summaries',
        color: AppColors.secondary,
      ),
      (
        icon: Icons.monitor_heart_outlined,
        title: 'Vital Monitoring',
        subtitle: 'Track your readings',
        color: AppColors.heartRate,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(left: 4, bottom: DesignTokens.spaceSm + 4),
          child: Text(
            'CAPABILITIES',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: AppColors.gray400,
              letterSpacing: DesignTokens.letterSpacingWider,
              fontFamily: 'Manrope',
            ),
          ),
        ),
        ...features.map((f) {
          return GestureDetector(
            onTap: () => context.push('/ai-chat'),
            child: Container(
              margin: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
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
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: f.color.withValues(alpha: 0.1),
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                    ),
                    child: Icon(f.icon, color: f.color, size: 22),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm + 4),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          f.title,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                            fontFamily: 'Manrope',
                          ),
                        ),
                        Text(
                          f.subtitle,
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
          );
        }),
      ],
    );
  }

  Widget _buildQuickSuggestions() {
    final suggestions = [
      'I have a headache',
      'Feeling dizzy',
      'Chest pain',
      'Feeling anxious',
      'Trouble sleeping',
      'Fatigue',
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(left: 4, bottom: DesignTokens.spaceSm + 4),
          child: Text(
            'QUICK START',
            style: TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              color: AppColors.gray400,
              letterSpacing: DesignTokens.letterSpacingWider,
              fontFamily: 'Manrope',
            ),
          ),
        ),
        Wrap(
          spacing: DesignTokens.spaceSm,
          runSpacing: DesignTokens.spaceSm,
          children: suggestions.map((s) {
            return GestureDetector(
              onTap: () => context.push('/ai-chat'),
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceMd - 2,
                    vertical: DesignTokens.spaceSm),
                decoration: BoxDecoration(
                  color: AppColors.surface,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                  border: Border.all(
                    color: AppColors.secondary.withValues(alpha: 0.25),
                  ),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.bolt_outlined,
                        size: 14, color: AppColors.secondary),
                    const SizedBox(width: DesignTokens.spaceXs + 2),
                    Text(
                      s,
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.secondaryDark,
                        fontFamily: 'Manrope',
                      ),
                    ),
                  ],
                ),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Doctors Tab
  // -------------------------------------------------------------------------

  Widget _buildDoctorsTab() {
    final conversationsAsync = ref.watch(patientConversationsProvider);

    return conversationsAsync.when(
      loading: () => _buildShimmerList(),
      error: (error, _) => ErrorView(
        message: _errorMessage(error),
        onRetry: () => ref.invalidate(patientConversationsProvider),
      ),
      data: (entries) {
        if (entries.isEmpty) {
          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(patientConversationsProvider),
            color: AppColors.primary,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              child: SizedBox(
                height: MediaQuery.of(context).size.height * 0.5,
                child: const EmptyView(
                  title: 'No conversations yet',
                  body:
                      'Your doctor consultations will appear here once you book an appointment and start a consultation.',
                  icon: Icons.chat_bubble_outline,
                ),
              ),
            ),
          );
        }

        final filtered = entries.where((e) {
          final convId = e.conversation.conversationId.toLowerCase();
          final consId = e.consultation.consultationId.toLowerCase();
          final status =
              _consultationStatusLabel(e.consultation.status).toLowerCase();
          return convId.contains(_searchQuery) ||
              consId.contains(_searchQuery) ||
              status.contains(_searchQuery);
        }).toList();

        if (filtered.isEmpty) {
          return const EmptyView(
            title: 'No matches',
            body: 'Try a different search term.',
            icon: Icons.search_off,
          );
        }

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(patientConversationsProvider),
          color: AppColors.primary,
          child: ListView.builder(
            padding: const EdgeInsets.fromLTRB(DesignTokens.spaceLg - 2, 0,
                DesignTokens.spaceLg - 2, DesignTokens.space2xl),
            itemCount: filtered.length,
            itemBuilder: (context, index) {
              return Padding(
                padding:
                    const EdgeInsets.only(bottom: DesignTokens.spaceSm + 4),
                child: _buildDoctorChatCard(filtered[index]),
              );
            },
          ),
        );
      },
    );
  }

  Widget _buildDoctorChatCard(PatientConversationEntry entry) {
    final consultation = entry.consultation;
    final conversation = entry.conversation;
    final dateStr =
        _formatDate(consultation.startedAt ?? consultation.createdAt);

    return GestureDetector(
      onTap: () =>
          context.push('/doctor-chat', extra: conversation.conversationId),
      child: Container(
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
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Row(
          children: [
            AvatarWidget(
              name: 'Dr',
              size: 52,
              gradient: AppColors.primaryGradient,
            ),
            const SizedBox(width: DesignTokens.spaceSm + 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Expanded(
                        child: Text(
                          'Consultation',
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                            fontFamily: 'Manrope',
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      StatusBadge(
                        text: _consultationStatusLabel(consultation.status),
                        tone: _consultationStatusTone(consultation.status),
                        small: true,
                      ),
                    ],
                  ),
                  const SizedBox(height: DesignTokens.spaceXs + 2),
                  Row(
                    children: [
                      Icon(Icons.calendar_today_outlined,
                          size: 12, color: AppColors.gray400),
                      const SizedBox(width: DesignTokens.spaceXs),
                      Text(
                        dateStr,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.gray500,
                          fontFamily: 'Manrope',
                        ),
                      ),
                      const SizedBox(width: DesignTokens.spaceSm + 4),
                      Icon(Icons.tag, size: 12, color: AppColors.gray400),
                      const SizedBox(width: DesignTokens.spaceXs),
                      Text(
                        _shortId(conversation.conversationId),
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.gray500,
                          fontFamily: 'Manrope',
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: DesignTokens.spaceXs + 2),
                  Container(
                    padding: const EdgeInsets.symmetric(
                        horizontal: DesignTokens.spaceSm,
                        vertical: DesignTokens.spaceXs),
                    decoration: BoxDecoration(
                      color: conversation.status == 'active'
                          ? AppColors.successContainer
                          : AppColors.gray100,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusSm),
                    ),
                    child: Text(
                      _conversationStatusTone(conversation.status),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: conversation.status == 'active'
                            ? AppColors.successDark
                            : AppColors.gray600,
                        fontFamily: 'Manrope',
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm),
            const Icon(Icons.arrow_forward_ios,
                size: 14, color: AppColors.gray400),
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Shimmer
  // -------------------------------------------------------------------------

  Widget _buildShimmerList() {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(DesignTokens.spaceLg - 2, 0,
          DesignTokens.spaceLg - 2, DesignTokens.space2xl),
      itemCount: 5,
      itemBuilder: (context, index) => Padding(
          padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm + 4),
          child: _buildShimmerCard()),
    );
  }

  Widget _buildShimmerCard() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: const BoxDecoration(
              color: AppColors.gray100,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm + 4),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  height: 16,
                  width: 180,
                  decoration: BoxDecoration(
                    color: AppColors.gray100,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusXs),
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                Container(
                  height: 12,
                  width: 120,
                  decoration: BoxDecoration(
                    color: AppColors.gray100,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusXs),
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
  // Error handling
  // -------------------------------------------------------------------------

  String _errorMessage(Object? error) {
    if (error == null) return 'Something went wrong';

    // DioException → ApiError
    if (error is DioException) {
      final apiError = error.error as ApiError?;
      if (apiError != null) return _apiErrorMessage(apiError);
      return _dioExceptionMessage(error);
    }

    // Direct ApiError
    if (error is ApiError) return _apiErrorMessage(error);

    // Fallback
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return error.toString();
  }

  String _apiErrorMessage(ApiError e) {
    if (e.isForbidden) {
      return 'You don\'t have permission to access conversations. Please sign in again or contact support.';
    }
    if (e.isUnauthenticated) {
      return 'Your session has expired. Please sign in again.';
    }
    if (e.isNotFound) {
      return 'No conversations found. Your doctor consultations will appear here once available.';
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
