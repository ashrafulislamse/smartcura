import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/message_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/empty_view.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/filter_chips_widget.dart';
import '../../../../core/widgets/search_bar_widget.dart';

/// Inbox filter options. Each maps to a real backend field so the filter is
/// never vacuous: [all] shows everything, [unread] keeps `unread_count > 0`,
/// [active] keeps `status == 'active'`, [closed] keeps `status == 'closed'`.
/// There is no "urgent" field in the conversation contract, so it is not
/// offered — a filter with no backing data would be a vacuous control.
enum _InboxFilter { all, unread, active, closed }

/// Messages List Screen — the doctor's conversation inbox.
///
/// Wired to real backend data:
/// - [doctorInboxProvider] reads `GET /doctor/inbox` (first page, no cursor).
/// - Each conversation's patient name is resolved from
///   [doctorPatientDetailProvider] using `patient_profile_id` — never
///   hardcoded, and never an `i.pravatar.cc` URL.
/// - [SearchBarWidget] filters the visible list by patient name (client-side).
/// - [FilterChipsWidget] narrows by unread / active / closed, all backed by
///   real fields on [ConversationInbox].
/// - Tapping a conversation pushes `/chat-consultation` with the conversation
///   id as the route `extra`.
///
/// All four resource states (loading, error, empty, loaded) are rendered
/// distinctly.
class MessagesListScreen extends ConsumerStatefulWidget {
  const MessagesListScreen({super.key});

  @override
  ConsumerState<MessagesListScreen> createState() => _MessagesListScreenState();
}

class _MessagesListScreenState extends ConsumerState<MessagesListScreen> {
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  _InboxFilter _filter = _InboxFilter.all;

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // Helpers

  DateTime? _parseTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso);
  }

  /// Relative-ish timestamp for an inbox row: "10:30 AM" today, "Yesterday",
  /// a weekday name within the last week, otherwise "MMM d".
  String _formatLatestAt(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '';
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));
    final dateOnly = DateTime(dt.year, dt.month, dt.day);
    if (dateOnly == today) return DateFormat.Hm().format(dt);
    if (dateOnly == yesterday) return 'Yesterday';
    if (today.difference(dateOnly).inDays < 7) {
      return DateFormat.E().format(dt);
    }
    return DateFormat('MMM d').format(dt);
  }

  /// Resolve a patient's display name for a conversation. Reads the cached
  /// value of [doctorPatientDetailProvider] so it does not block the inbox
  /// render; unresolved names fall back to a short id so the row is never blank.
  String _patientName(ConversationInbox conv) {
    final patient = ref
        .read(doctorPatientDetailProvider(conv.patientProfileId))
        .valueOrNull;
    return patient?.displayName.isNotEmpty == true
        ? patient!.displayName
        : 'Patient ${conv.patientProfileId.substring(0, 4)}';
  }

  bool _matchesFilter(ConversationInbox conv) {
    switch (_filter) {
      case _InboxFilter.all:
        return true;
      case _InboxFilter.unread:
        return conv.unreadCount > 0;
      case _InboxFilter.active:
        return conv.status == 'active';
      case _InboxFilter.closed:
        return conv.status == 'closed';
    }
  }

  bool _matchesSearch(ConversationInbox conv, String name) {
    if (_searchQuery.isEmpty) return true;
    return name.toLowerCase().contains(_searchQuery.toLowerCase());
  }

  Future<void> _refresh() async {
    ref.invalidate(doctorInboxProvider(null));
    // Wait a tick so the refresh indicator has something to spin against.
    await Future<void>.delayed(const Duration(milliseconds: 300));
  }

  // --------------------------------------------------------------------------
  // Build

  @override
  Widget build(BuildContext context) {
    final inboxAsync = ref.watch(doctorInboxProvider(null));

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Column(
          children: [
            _buildGradientHeader(),
            _buildSearchAndFilters(),
            Expanded(
              child: inboxAsync.when(
                data: (list) {
                  final conversations = list.data;
                  if (conversations.isEmpty) {
                    return _buildRefreshableEmpty();
                  }
                  // Resolve names once for both search and render.
                  final named = conversations
                      .map((c) => (conversation: c, name: _patientName(c)))
                      .where((e) => _matchesFilter(e.conversation))
                      .where((e) => _matchesSearch(e.conversation, e.name))
                      .toList();

                  if (named.isEmpty) {
                    return _buildRefreshableNoMatch();
                  }
                  return _buildConversationList(named);
                },
                loading: () => _buildShimmerList(),
                error: (err, _) {
                  final apiError = err is ApiError ? err : toApiError(err);
                  return RefreshIndicator(
                    color: AppColors.primary,
                    onRefresh: _refresh,
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        SizedBox(
                          height: MediaQuery.of(context).size.height * 0.6,
                          child: ErrorView(
                            message: apiError.displayMessage,
                            isForbidden: apiError.isForbidden,
                            onRetry: () =>
                                ref.invalidate(doctorInboxProvider(null)),
                            icon: Icons.mail_lock_outlined,
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildGradientHeader() {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + DesignTokens.spaceLg,
        bottom: DesignTokens.space2xl + 8,
        left: DesignTokens.spaceLg,
        right: DesignTokens.spaceSm,
      ),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.primary, AppColors.primaryDark],
        ),
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(DesignTokens.radius3xl),
          bottomRight: Radius.circular(DesignTokens.radius3xl),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Messages',
                style: TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                  color: AppColors.white,
                  letterSpacing: -0.3,
                ),
              ),
              IconButton(
                icon: const Icon(Icons.refresh_rounded, color: AppColors.white),
                onPressed: _refresh,
              ),
            ],
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.15),
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            ),
            child: Text(
              'Patient Conversations',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Colors.white.withOpacity(0.9),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchAndFilters() {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          bottom: BorderSide(color: AppColors.gray100),
        ),
      ),
      padding: const EdgeInsets.fromLTRB(DesignTokens.spaceMd,
          DesignTokens.spaceMd, DesignTokens.spaceMd, DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SearchBarWidget(
            controller: _searchController,
            hint: 'Search patients...',
            onChanged: (value) => setState(() => _searchQuery = value),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          FilterChipsWidget<_InboxFilter>(
            options: const [
              FilterChipOption(value: _InboxFilter.all, label: 'All'),
              FilterChipOption(value: _InboxFilter.unread, label: 'Unread'),
              FilterChipOption(value: _InboxFilter.active, label: 'Active'),
              FilterChipOption(value: _InboxFilter.closed, label: 'Closed'),
            ],
            selected: _filter,
            onSelected: (v) => setState(() => _filter = v ?? _InboxFilter.all),
          ),
        ],
      ),
    );
  }

  Widget _buildConversationList(
      List<({ConversationInbox conversation, String name})> named) {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _refresh,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: 80),
        itemCount: named.length,
        separatorBuilder: (_, __) =>
            const SizedBox(height: DesignTokens.spaceSm),
        itemBuilder: (context, index) {
          final entry = named[index];
          return _buildConversationCard(entry.conversation, entry.name);
        },
      ),
    );
  }

  Widget _buildConversationCard(ConversationInbox conv, String patientName) {
    final hasUnread = conv.unreadCount > 0;
    final isActive = conv.status == 'active';
    final initials = _initials(patientName);

    return InkWell(
      onTap: () =>
          context.push('/chat-consultation', extra: conv.conversationId),
      borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          border: Border.all(color: AppColors.gray100),
          boxShadow: [
            BoxShadow(
              color: AppColors.shadowLight,
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Initials avatar — never an i.pravatar.cc URL.
            Stack(
              children: [
                Container(
                  width: 56,
                  height: 56,
                  decoration: const BoxDecoration(
                    gradient: AppColors.primaryGradient,
                    shape: BoxShape.circle,
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    initials,
                    style: const TextStyle(
                      color: AppColors.white,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                if (isActive)
                  Positioned(
                    bottom: 0,
                    right: 0,
                    child: Container(
                      width: 14,
                      height: 14,
                      decoration: BoxDecoration(
                        color: AppColors.success,
                        shape: BoxShape.circle,
                        border: Border.all(color: AppColors.white, width: 2),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            // Content.
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Flexible(
                        child: Text(
                          patientName,
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight:
                                hasUnread ? FontWeight.bold : FontWeight.w600,
                            color: AppColors.gray900,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      const SizedBox(width: DesignTokens.spaceSm),
                      Text(
                        _formatLatestAt(conv.latestMessageAt),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight:
                              hasUnread ? FontWeight.w600 : FontWeight.w400,
                          color:
                              hasUnread ? AppColors.primary : AppColors.gray500,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Icon(Icons.chat_bubble_outline_rounded,
                          size: 15, color: AppColors.gray400),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          isActive
                              ? 'Tap to open conversation'
                              : 'Conversation closed',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight:
                                hasUnread ? FontWeight.w500 : FontWeight.w400,
                            color: hasUnread
                                ? AppColors.gray700
                                : AppColors.gray500,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (hasUnread) ...[
                        const SizedBox(width: DesignTokens.spaceSm),
                        Container(
                          constraints: const BoxConstraints(
                            minWidth: 20,
                            minHeight: 20,
                          ),
                          padding: const EdgeInsets.symmetric(
                              horizontal: 5, vertical: 1),
                          decoration: const BoxDecoration(
                            color: AppColors.error,
                            shape: BoxShape.circle,
                          ),
                          child: Center(
                            child: Text(
                              '${conv.unreadCount}',
                              style: const TextStyle(
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                color: AppColors.white,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) {
      return parts.first.substring(0, 1).toUpperCase();
    }
    return (parts.first.substring(0, 1) + parts[1].substring(0, 1))
        .toUpperCase();
  }

  // --------------------------------------------------------------------------
  // Empty / loading states

  Widget _buildRefreshableEmpty() {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(
            height: MediaQuery.of(context).size.height * 0.6,
            child: const EmptyView(
              title: 'No conversations yet',
              body:
                  'When a patient messages you, the conversation will appear here.',
              icon: Icons.forum_outlined,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRefreshableNoMatch() {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _refresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(
            height: MediaQuery.of(context).size.height * 0.6,
            child: EmptyView(
              title: 'No matches',
              body: _searchQuery.isNotEmpty
                  ? 'No conversations match "$_searchQuery".'
                  : 'No conversations match this filter.',
              icon: Icons.search_off_rounded,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildShimmerList() {
    return ListView.builder(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: 80),
      itemCount: 6,
      itemBuilder: (context, index) => _buildShimmerRow(),
    );
  }

  Widget _buildShimmerRow() {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.gray100),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildShimmerBox(56, 56, radius: 28),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    _buildShimmerBox(140, 16),
                    _buildShimmerBox(48, 12),
                  ],
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                _buildShimmerBox(double.infinity, 14),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildShimmerBox(double width, double height, {double radius = 8}) {
    return Container(
      width: width == double.infinity ? double.maxFinite : width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.shimmerBase,
        borderRadius: BorderRadius.circular(radius),
      ),
    );
  }
}
