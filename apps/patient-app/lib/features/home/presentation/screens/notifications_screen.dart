import 'dart:async';

import 'package:flutter/material.dart' hide Notification;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/navigation/deep_link_handler.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';
import '../../../../core/notifications/notification_copy.dart';
import '../../../../core/providers/notification_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/state_view.dart';

/// Notifications Screen — wired to real backend data.
///
/// Watches [notificationsProvider] (GET /notifications) with server-side
/// `category=` / `unread=` filters and renders each notification through the
/// [notification_copy] catalogue with a priority chip. Tapping marks the
/// notification read (PUT /notifications/{id}/read) then navigates via the
/// deep-link mapping for its resource; "Mark all read" calls
/// PUT /notifications/read-all.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;

  /// Currently selected category filter; null means "All".
  NotificationCategory? _selectedCategory;

  /// Whether the server-side `unread=true` filter is active.
  bool _unreadOnly = false;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );

    _fadeAnimation = Tween<double>(
      begin: 0.0,
      end: 1.0,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeOut,
    ));

    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, 0.05),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeOutCubic,
    ));

    _animationController.forward();

    // Auto-refresh every 30s so new notifications appear without manual pull.
    _autoRefreshTimer =
        Timer.periodic(const Duration(seconds: 30), (_) => _autoRefresh());
  }

  Timer? _autoRefreshTimer;

  void _autoRefresh() {
    if (mounted) ref.invalidate(notificationsProvider);
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    _animationController.dispose();
    super.dispose();
  }

  NotificationFilter get _filter => (
        category: _selectedCategory,
        unreadOnly: _unreadOnly,
      );

  Future<void> _onRefresh() async {
    ref.invalidate(notificationsProvider);
    await Future<void>.delayed(const Duration(milliseconds: 400));
  }

  /// Mark every unread notification as read in one server call.
  Future<void> _markAllRead() async {
    HapticFeedback.lightImpact();
    final dio = ref.read(apiClientProvider);
    try {
      await dio.put<void>(ApiEndpoints.notificationsReadAll);
    } catch (e) {
      debugPrint('[Notifications] mark-all-read failed: $e');
    }
    ref.invalidate(notificationsProvider);
  }

  /// Mark a single notification as read, then follow its deep link.
  void _onTapNotification(Notification notification) {
    if (notification.readAt == null) {
      HapticFeedback.lightImpact();
      _markOneRead(notification.notificationId);
    }
    final location = DeepLinkHandler.locationForResource(
      notification.resourceType,
      notification.resourceId,
    );
    // Don't push the same route on top of itself (malformed/unknown links
    // fall back to /notifications).
    if (location == '/notifications') return;

    // Shell routes don't push reliably from outside the shell; use go.
    // Full-screen destinations push so the back button returns to the list.
    final isShellRoute = const {
      '/home',
      '/schedule',
      '/messages',
      '/health',
      '/profile',
    }.contains(location);
    if (isShellRoute) {
      context.go(location);
    } else {
      context.push(location);
    }
  }

  /// Replicates [markNotificationRead] from the provider layer but uses
  /// [WidgetRef] instead of [Ref], which is what a ConsumerState holds.
  /// The foundation function takes a `Ref` (provider scope) and cannot be
  /// called directly with a `WidgetRef` (widget scope).
  Future<void> _markOneRead(String notificationId) async {
    final dio = ref.read(apiClientProvider);
    await dio.put<void>(ApiEndpoints.notificationRead(notificationId));
    ref.invalidate(notificationsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final notificationsAsync = ref.watch(notificationsProvider(_filter));

    final unreadCount = notificationsAsync.maybeWhen(
      data: (notifs) => notifs.where((n) => n.readAt == null).length,
      orElse: () => 0,
    );

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: Color(0xFFF6F6F8),
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFFF6F6F8),
        appBar: AppBar(
          backgroundColor: const Color(0xFFF6F6F8),
          elevation: 0,
          scrolledUnderElevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back, color: AppColors.textPrimary),
            onPressed: () => Navigator.pop(context),
            style: IconButton.styleFrom(
              backgroundColor: AppColors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
          ),
          title: const Text(
            'Notifications',
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          actions: [
            TextButton(
              onPressed: unreadCount > 0 ? _markAllRead : null,
              child: Text(
                'Mark all read',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: unreadCount > 0
                      ? AppColors.primary
                      : AppColors.textDisabled,
                ),
              ),
            ),
          ],
        ),
        body: FadeTransition(
          opacity: _fadeAnimation,
          child: SlideTransition(
            position: _slideAnimation,
            child: Column(
              children: [
                // Category + unread filter chips (server-side query params).
                _buildFilterChips(),
                const SizedBox(height: 8),
                // Notification list
                Expanded(
                  child: notificationsAsync.when(
                    loading: () => _buildShimmerList(),
                    error: (error, _) => ErrorView(
                      message: _errorMessage(error),
                      onRetry: () => ref.invalidate(notificationsProvider),
                    ),
                    data: (notifications) {
                      if (notifications.isEmpty) {
                        return RefreshIndicator(
                          onRefresh: _onRefresh,
                          color: AppColors.primary,
                          child: SingleChildScrollView(
                            physics: const AlwaysScrollableScrollPhysics(),
                            child: SizedBox(
                              height: MediaQuery.of(context).size.height * 0.5,
                              child: EmptyView(
                                title: _unreadOnly
                                    ? 'No unread notifications'
                                    : 'No notifications',
                                body: _unreadOnly
                                    ? 'You are all caught up. New updates will appear here.'
                                    : 'Your notifications will appear here when you have updates.',
                                icon: Icons.notifications_none_outlined,
                              ),
                            ),
                          ),
                        );
                      }

                      return RefreshIndicator(
                        onRefresh: _onRefresh,
                        color: AppColors.primary,
                        child: _buildGroupedList(notifications),
                      );
                    },
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// Build the horizontal filter chips: "All", one per category, and an
  /// "Unread" toggle. Each chip narrows the server query rather than hiding
  /// rows client-side.
  Widget _buildFilterChips() {
    final categories = NotificationCategory.values
        .where((c) => c != NotificationCategory.unknown)
        .toList();

    return SizedBox(
      height: 44,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: categories.length + 2, // +1 for "All", +1 for "Unread"
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          if (index == 0) {
            final isActive = _selectedCategory == null;
            return FilterChip(
              label: const Text('All'),
              selected: isActive,
              onSelected: (_) => setState(() => _selectedCategory = null),
              selectedColor: AppColors.primary,
              labelStyle: TextStyle(
                color: isActive ? AppColors.white : AppColors.textSecondary,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
              backgroundColor: AppColors.gray100,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(9999),
                side: BorderSide(
                  color: isActive ? AppColors.primary : AppColors.gray200,
                ),
              ),
              showCheckmark: false,
              padding: const EdgeInsets.symmetric(horizontal: 4),
            );
          }
          if (index == categories.length + 1) {
            return FilterChip(
              label: const Text('Unread'),
              selected: _unreadOnly,
              onSelected: (selected) => setState(() => _unreadOnly = selected),
              selectedColor: AppColors.primary,
              labelStyle: TextStyle(
                color: _unreadOnly ? AppColors.white : AppColors.textSecondary,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
              backgroundColor: AppColors.gray100,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(9999),
                side: BorderSide(
                  color: _unreadOnly ? AppColors.primary : AppColors.gray200,
                ),
              ),
              showCheckmark: false,
              padding: const EdgeInsets.symmetric(horizontal: 4),
            );
          }
          final category = categories[index - 1];
          final isActive = _selectedCategory == category;
          return FilterChip(
            label: Text(_categoryLabel(category)),
            selected: isActive,
            onSelected: (_) =>
                setState(() => _selectedCategory = isActive ? null : category),
            selectedColor: AppColors.primary,
            labelStyle: TextStyle(
              color: isActive ? AppColors.white : AppColors.textSecondary,
              fontWeight: FontWeight.w600,
              fontSize: 13,
            ),
            backgroundColor: AppColors.gray100,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(9999),
              side: BorderSide(
                color: isActive ? AppColors.primary : AppColors.gray200,
              ),
            ),
            showCheckmark: false,
            padding: const EdgeInsets.symmetric(horizontal: 4),
          );
        },
      ),
    );
  }

  /// Build the notification list grouped by date sections.
  Widget _buildGroupedList(List<Notification> notifications) {
    final now = DateTime.now();
    final today = <Notification>[];
    final yesterday = <Notification>[];
    final earlier = <Notification>[];

    for (final n in notifications) {
      final dt = DateTime.tryParse(n.createdAt);
      if (dt == null) {
        earlier.add(n);
        continue;
      }
      if (dt.year == now.year && dt.month == now.month && dt.day == now.day) {
        today.add(n);
      } else if (now.difference(dt).inDays <= 1) {
        yesterday.add(n);
      } else {
        earlier.add(n);
      }
    }

    // Sort each group newest first.
    for (final list in [today, yesterday, earlier]) {
      list.sort((a, b) => b.createdAt.compareTo(a.createdAt));
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(
        parent: BouncingScrollPhysics(),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      children: [
        if (today.isNotEmpty) ...[
          _buildSectionHeader('TODAY'),
          const SizedBox(height: 12),
          ...today.map((n) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _NotificationCard(
                  notification: n,
                  onTap: () => _onTapNotification(n),
                ),
              )),
        ],
        if (yesterday.isNotEmpty) ...[
          const SizedBox(height: 12),
          _buildSectionHeader('YESTERDAY'),
          const SizedBox(height: 12),
          ...yesterday.map((n) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _NotificationCard(
                  notification: n,
                  onTap: () => _onTapNotification(n),
                ),
              )),
        ],
        if (earlier.isNotEmpty) ...[
          const SizedBox(height: 12),
          _buildSectionHeader('EARLIER'),
          const SizedBox(height: 12),
          ...earlier.map((n) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: _NotificationCard(
                  notification: n,
                  onTap: () => _onTapNotification(n),
                ),
              )),
        ],
        const SizedBox(height: 40),
      ],
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(left: 4, bottom: 4),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 11,
          fontWeight: FontWeight.w700,
          color: AppColors.gray500,
          letterSpacing: 0.8,
        ),
      ),
    );
  }

  Widget _buildShimmerList() {
    final baseColor = AppColors.gray200;
    final highlightColor = AppColors.gray100;
    return Shimmer.fromColors(
      baseColor: baseColor,
      highlightColor: highlightColor,
      child: ListView(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        children: List.generate(
          5,
          (_) => Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: baseColor,
                borderRadius: BorderRadius.circular(16),
              ),
              child: Row(
                children: [
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: baseColor,
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 180,
                          height: 14,
                          decoration: BoxDecoration(
                            color: baseColor,
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Container(
                          width: 220,
                          height: 12,
                          decoration: BoxDecoration(
                            color: baseColor,
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                        const SizedBox(height: 6),
                        Container(
                          width: 80,
                          height: 10,
                          decoration: BoxDecoration(
                            color: baseColor,
                            borderRadius: BorderRadius.circular(4),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  /// Convert a [NotificationCategory] to a human-readable label.
  String _categoryLabel(NotificationCategory category) {
    return switch (category) {
      NotificationCategory.accountSecurity => 'Security',
      NotificationCategory.appointments => 'Appointments',
      NotificationCategory.consultations => 'Consultations',
      NotificationCategory.messages => 'Messages',
      NotificationCategory.prescriptions => 'Prescriptions',
      NotificationCategory.vitalsAlerts => 'Vitals',
      NotificationCategory.vitalsUpdate => 'Health Data',
      NotificationCategory.aiReview => 'AI Review',
      NotificationCategory.delivery => 'Delivery',
      NotificationCategory.dispatch => 'Dispatch',
      NotificationCategory.emergency => 'Emergency',
      NotificationCategory.system => 'System',
      NotificationCategory.unknown => 'Other',
    };
  }

  String _errorMessage(Object? error) {
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return 'Could not load notifications';
  }
}

/// A single notification card with category-specific icon, read/unread
/// styling, catalogue copy, a priority chip, and tap-to-open behaviour.
class _NotificationCard extends StatelessWidget {
  final Notification notification;
  final VoidCallback onTap;

  const _NotificationCard({
    required this.notification,
    required this.onTap,
  });

  bool get _isUnread => notification.readAt == null;

  /// Wire value of the notification priority; `unknown` maps to null so it
  /// renders with the Normal style (`wireValue` throws for unknown).
  String? get _priorityWire => switch (notification.priority) {
        NotificationPriority.unknown => null,
        final p => p.wireValue,
      };

  ({IconData icon, Color bgColor, Color iconColor}) get _categoryVisual {
    return switch (notification.category) {
      NotificationCategory.accountSecurity => (
          icon: Icons.security,
          bgColor: AppColors.warning.withOpacity(0.12),
          iconColor: AppColors.warningDark,
        ),
      NotificationCategory.appointments => (
          icon: Icons.calendar_today_rounded,
          bgColor: AppColors.primary.withOpacity(0.12),
          iconColor: AppColors.primary,
        ),
      NotificationCategory.consultations => (
          icon: Icons.videocam_rounded,
          bgColor: AppColors.primary.withOpacity(0.12),
          iconColor: AppColors.primary,
        ),
      NotificationCategory.messages => (
          icon: Icons.message_rounded,
          bgColor: AppColors.secondary.withOpacity(0.12),
          iconColor: AppColors.secondaryDark,
        ),
      NotificationCategory.prescriptions => (
          icon: Icons.medication_rounded,
          bgColor: AppColors.warning.withOpacity(0.12),
          iconColor: AppColors.warningDark,
        ),
      NotificationCategory.vitalsAlerts => (
          icon: Icons.monitor_heart_rounded,
          bgColor: AppColors.error.withOpacity(0.12),
          iconColor: AppColors.errorDark,
        ),
      NotificationCategory.vitalsUpdate => (
          icon: Icons.favorite_rounded,
          bgColor: AppColors.success.withOpacity(0.12),
          iconColor: AppColors.successDark,
        ),
      NotificationCategory.aiReview => (
          icon: Icons.psychology_rounded,
          bgColor: Colors.purple.withOpacity(0.12),
          iconColor: Colors.purple.shade700,
        ),
      NotificationCategory.delivery => (
          icon: Icons.local_shipping_rounded,
          bgColor: AppColors.info.withOpacity(0.12),
          iconColor: AppColors.infoDark,
        ),
      NotificationCategory.dispatch => (
          icon: Icons.local_shipping_rounded,
          bgColor: AppColors.info.withOpacity(0.12),
          iconColor: AppColors.infoDark,
        ),
      NotificationCategory.emergency => (
          icon: Icons.emergency_rounded,
          bgColor: AppColors.emergency.withOpacity(0.12),
          iconColor: AppColors.emergency,
        ),
      NotificationCategory.system => (
          icon: Icons.info_rounded,
          bgColor: AppColors.gray200,
          iconColor: AppColors.gray600,
        ),
      NotificationCategory.unknown => (
          icon: Icons.notifications_rounded,
          bgColor: AppColors.gray200,
          iconColor: AppColors.gray600,
        ),
    };
  }

  Widget _buildPriorityChip() {
    final priority = _priorityWire;
    final color = priorityColor(priority);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(9999),
      ),
      child: Text(
        priorityLabel(priority),
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w700,
          color: color,
          letterSpacing: 0.3,
        ),
      ),
    );
  }

  String _formatTime(String createdAt) {
    final dt = DateTime.tryParse(createdAt);
    if (dt == null) return createdAt;
    final now = DateTime.now();
    final diff = now.difference(dt);

    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
    if (diff.inHours < 24)
      return '${diff.inHours} hour${diff.inHours == 1 ? '' : 's'} ago';
    if (diff.inDays <= 1)
      return 'Yesterday, ${DateFormat('h:mm a').format(dt)}';
    if (diff.inDays < 7) return '${diff.inDays} days ago';
    return DateFormat('MMM d, yyyy').format(dt);
  }

  @override
  Widget build(BuildContext context) {
    final visual = _categoryVisual;
    // Catalogue copy keyed by the stored codes — same strings the server
    // renders into push previews.
    final copy = copyForCode(notification.titleCode);
    final body = copyForCode(notification.bodyCode).body;
    final timeStr = _formatTime(notification.createdAt);

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 200),
        opacity: _isUnread ? 1.0 : 0.65,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(
              color: _isUnread
                  ? visual.iconColor.withOpacity(0.2)
                  : AppColors.gray200,
              width: _isUnread ? 1.5 : 1,
            ),
            boxShadow: const [
              BoxShadow(
                color: AppColors.shadow,
                blurRadius: 8,
                offset: Offset(0, 2),
              ),
            ],
          ),
          child: Column(
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Icon
                  Container(
                    width: 48,
                    height: 48,
                    decoration: BoxDecoration(
                      color: visual.bgColor,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      visual.icon,
                      color: visual.iconColor,
                      size: 24,
                    ),
                  ),

                  const SizedBox(width: 12),

                  // Content
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                copy.title,
                                style: TextStyle(
                                  fontSize: 15,
                                  fontWeight: _isUnread
                                      ? FontWeight.w700
                                      : FontWeight.w600,
                                  color: AppColors.textPrimary,
                                ),
                              ),
                            ),
                            if (_isUnread)
                              Container(
                                width: 8,
                                height: 8,
                                decoration: BoxDecoration(
                                  color: visual.iconColor,
                                  shape: BoxShape.circle,
                                ),
                              ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          body,
                          style: TextStyle(
                            fontSize: 13,
                            color: AppColors.textSecondary,
                            height: 1.4,
                          ),
                        ),
                        const SizedBox(height: 6),
                        Row(
                          children: [
                            _buildPriorityChip(),
                            const SizedBox(width: 8),
                            Text(
                              timeStr,
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: AppColors.gray500,
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
