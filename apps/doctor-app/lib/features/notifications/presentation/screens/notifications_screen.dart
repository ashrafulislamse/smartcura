import 'package:flutter/material.dart' hide Notification;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/navigation/deep_link_handler.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/notifications/notification_copy.dart';
import '../../../../core/providers/notification_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Notifications Screen — Full screen (no bottom nav).
///
/// Wired to real backend data via [notificationsProvider] (GET /notifications).
/// Supports All/Unread + category filtering, read/unread state, date grouping
/// (Today / Yesterday / Earlier), mark-one-read on tap, mark-all-read (single
/// `PUT /notifications/read-all`), and tap-through navigation via the deep-link
/// mapping. Title/body copy comes from the client catalogue
/// ([NotificationCopy]), which mirrors the worker's server-side catalogue.
/// All four resource states (loading, error, empty, loaded) are distinct.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  /// Stable filter instance — kept in state so the family provider doesn't
  /// refetch on every rebuild (NotificationFilter has no == override).
  NotificationFilter _filter = const NotificationFilter();

  // Track which notification is being marked-read so we can show a spinner.
  String? _markingId;

  // Track the mark-all-read operation.
  bool _markingAll = false;

  // ---- Filter options --------------------------------------------------

  /// 'all' maps to no filter, 'unread' to `unread=true`. The other values are
  /// the wire values of [NotificationCategory]. Labels follow the task spec;
  /// "Lab Results" maps to `vitals_alerts` and "Refill Requests" maps to
  /// `prescriptions`, which are the closest real categories.
  static const _filterOptions = <FilterChipOption<String>>[
    FilterChipOption(value: 'all', label: 'All'),
    FilterChipOption(value: 'unread', label: 'Unread'),
    FilterChipOption(value: 'appointments', label: 'Appointments'),
    FilterChipOption(value: 'messages', label: 'Messages'),
    FilterChipOption(value: 'system', label: 'System'),
    FilterChipOption(value: 'vitals_alerts', label: 'Lab Results'),
    FilterChipOption(value: 'prescriptions', label: 'Refill Requests'),
  ];

  String get _selectedFilterValue {
    if (_filter.unread == true) return 'unread';
    if (_filter.category == null) return 'all';
    return _filter.category!;
  }

  void _onFilterSelected(String? value) {
    setState(() {
      if (value == null || value == 'all') {
        _filter = const NotificationFilter();
      } else if (value == 'unread') {
        _filter = const NotificationFilter(unread: true);
      } else {
        _filter = NotificationFilter(category: value);
      }
    });
  }

  // ---- Helpers ---------------------------------------------------------

  DateTime? _parseTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso);
  }

  IconData _categoryIcon(NotificationCategory category) => switch (category) {
        NotificationCategory.accountSecurity => Icons.security_rounded,
        NotificationCategory.appointments => Icons.calendar_month_rounded,
        NotificationCategory.consultations => Icons.medical_services_rounded,
        NotificationCategory.messages => Icons.mail_rounded,
        NotificationCategory.prescriptions => Icons.medication_rounded,
        NotificationCategory.vitalsAlerts => Icons.monitor_heart_rounded,
        NotificationCategory.aiReview => Icons.psychology_rounded,
        NotificationCategory.delivery => Icons.local_pharmacy_rounded,
        NotificationCategory.dispatch => Icons.local_shipping_rounded,
        NotificationCategory.emergency => Icons.emergency_rounded,
        NotificationCategory.system => Icons.system_update_rounded,
        NotificationCategory.vitalsUpdate => Icons.monitor_heart_rounded,
        NotificationCategory.unknown => Icons.notifications_rounded,
      };

  Color _categoryColor(NotificationCategory category) => switch (category) {
        NotificationCategory.accountSecurity => AppColors.error,
        NotificationCategory.appointments => AppColors.primary,
        NotificationCategory.consultations => AppColors.primary,
        NotificationCategory.messages => AppColors.accent,
        NotificationCategory.prescriptions => AppColors.success,
        NotificationCategory.vitalsAlerts => AppColors.error,
        NotificationCategory.aiReview => AppColors.accent,
        NotificationCategory.delivery => AppColors.warning,
        NotificationCategory.dispatch => AppColors.warning,
        NotificationCategory.emergency => AppColors.error,
        NotificationCategory.system => AppColors.gray500,
        NotificationCategory.vitalsUpdate => AppColors.error,
        NotificationCategory.unknown => AppColors.gray500,
      };

  /// Group key for a notification based on its [createdAt] timestamp.
  _DateGroup _dateGroupFor(DateTime? createdAt) {
    if (createdAt == null) return _DateGroup.earlier;
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final yesterday = today.subtract(const Duration(days: 1));
    final notifDate = DateTime(createdAt.year, createdAt.month, createdAt.day);
    if (notifDate == today) return _DateGroup.today;
    if (notifDate == yesterday) return _DateGroup.yesterday;
    return _DateGroup.earlier;
  }

  String _groupLabel(_DateGroup group) => switch (group) {
        _DateGroup.today => 'Today',
        _DateGroup.yesterday => 'Yesterday',
        _DateGroup.earlier => 'Earlier',
      };

  String _formatTime(DateTime dt) => DateFormat('h:mm a').format(dt);

  String _formatDate(DateTime dt) => DateFormat('MMM d, yyyy').format(dt);

  Future<void> _onRefresh() async {
    ref.invalidate(notificationsProvider(_filter));
    await ref.read(notificationsProvider(_filter).future);
  }

  // ---- Actions ---------------------------------------------------------

  /// Tap: mark the notification read (already-read rows skip the PUT), then
  /// navigate through the deep-link mapping so the doctor lands on the
  /// appointment / conversation / patient the notification is about. Resource
  /// types without a doctor-app screen (prescriptions, dispatch, broadcasts…)
  /// map back onto /notifications, in which case no navigation happens.
  Future<void> _onTapNotification(Notification notification) async {
    if (notification.readAt == null) {
      setState(() => _markingId = notification.notificationId);
      try {
        await markNotificationRead(ref,
            notificationId: notification.notificationId);
        ref.invalidate(notificationsProvider(_filter));
      } catch (e) {
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(e is ApiError
                  ? e.displayMessage
                  : 'Could not mark notification as read.'),
            ),
          );
        }
        return; // A failed write should not swallow the tap.
      } finally {
        if (mounted) setState(() => _markingId = null);
      }
    }

    final link = deepLinkForResource(
      notification.resourceType,
      notification.resourceId,
    );
    if (link == null) return;
    final location = mapDeepLinkToLocation(Uri.parse(link));
    if (location == null || location == '/notifications') return;
    if (mounted) context.push(location);
  }

  Future<void> _markAllRead(List<Notification> all) async {
    final unread = all.where((n) => n.readAt == null).toList();
    if (unread.isEmpty) return;
    setState(() => _markingAll = true);
    try {
      await markAllNotificationsRead(ref);
      ref.invalidate(notificationsProvider(_filter));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('All notifications marked as read'),
            duration: Duration(seconds: 2),
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e is ApiError
                ? e.displayMessage
                : 'Could not mark all as read.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _markingAll = false);
    }
  }

  // ---- Build -----------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final notifsAsync = ref.watch(notificationsProvider(_filter));
    final unreadCount =
        notifsAsync.valueOrNull?.data.where((n) => n.readAt == null).length ??
            0;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new, color: AppColors.gray900),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text(
          'Notifications',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.gray900,
                fontSize: 18,
              ),
        ),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_outlined, color: AppColors.gray900),
            onPressed: () {
              // Notification preferences screen is a future task.
            },
          ),
        ],
      ),
      body: Column(
        children: [
          // ---- Filter chips ----------------------------------------
          Container(
            color: AppColors.white,
            padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceMd,
                vertical: DesignTokens.spaceSm + 2),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: FilterChipsWidget<String>(
                options: _filterOptions,
                selected: _selectedFilterValue,
                onSelected: _onFilterSelected,
              ),
            ),
          ),

          // ---- Content ---------------------------------------------
          Expanded(
            child: notifsAsync.when(
              data: (list) {
                final items = list.data;
                if (items.isEmpty) {
                  return RefreshIndicator(
                    color: AppColors.primary,
                    onRefresh: _onRefresh,
                    child: ListView(
                      physics: const AlwaysScrollableScrollPhysics(),
                      children: [
                        SizedBox(
                          height: MediaQuery.of(context).size.height * 0.5,
                          child: const EmptyView(
                            title: 'No notifications',
                            body:
                                'You\'re all caught up. New notifications will appear here.',
                            icon: Icons.notifications_none_rounded,
                          ),
                        ),
                      ],
                    ),
                  );
                }
                return _buildGroupedList(items, unreadCount);
              },
              loading: () => _buildLoadingList(),
              error: (err, _) {
                final apiError = err is ApiError ? err : toApiError(err);
                return ErrorView(
                  message: apiError.displayMessage,
                  onRetry: apiError.isForbidden ? null : _onRefresh,
                  isForbidden: apiError.isForbidden,
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Grouped notification list
  // ------------------------------------------------------------------

  Widget _buildGroupedList(List<Notification> items, int unreadCount) {
    // Partition notifications into date groups, preserving original order.
    final groups = <_DateGroup, List<Notification>>{};
    for (final n in items) {
      final group = _dateGroupFor(_parseTimestamp(n.createdAt));
      groups.putIfAbsent(group, () => []).add(n);
    }

    // Sort groups: today → yesterday → earlier.
    const groupOrder = [
      _DateGroup.today,
      _DateGroup.yesterday,
      _DateGroup.earlier,
    ];

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _onRefresh,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.only(bottom: DesignTokens.spaceLg),
        itemCount: groupOrder.length + 1, // +1 for the mark-all button
        itemBuilder: (context, index) {
          // The last item is the mark-all-read button.
          if (index == groupOrder.length) {
            if (unreadCount == 0) return const SizedBox.shrink();
            return Padding(
              padding: const EdgeInsets.only(top: DesignTokens.spaceLg),
              child: Center(
                child: TextButton.icon(
                  onPressed: _markingAll ? null : () => _markAllRead(items),
                  icon: _markingAll
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: AppColors.primary,
                          ),
                        )
                      : const Icon(Icons.done_all_rounded, size: 18),
                  label: Text(
                    'MARK ALL AS READ',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                          letterSpacing: 1.2,
                          color: AppColors.primary,
                        ),
                  ),
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.primary,
                    padding: const EdgeInsets.symmetric(
                        horizontal: DesignTokens.spaceLg,
                        vertical: DesignTokens.spaceSm + 2),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                  ),
                ),
              ),
            );
          }

          final group = groupOrder[index];
          final groupItems = groups[group];
          if (groupItems == null || groupItems.isEmpty) {
            return const SizedBox.shrink();
          }

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildSectionHeader(_groupLabel(group)),
              ...groupItems
                  .map((n) => Padding(
                        padding: const EdgeInsets.symmetric(
                            horizontal: DesignTokens.spaceMd, vertical: 4),
                        child: _buildNotificationCard(n),
                      ))
                  .toList(),
            ],
          );
        },
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(DesignTokens.spaceMd + 4,
          DesignTokens.spaceMd, DesignTokens.spaceMd, DesignTokens.spaceSm + 2),
      child: Text(
        title,
        style: Theme.of(context).textTheme.titleSmall?.copyWith(
              fontWeight: FontWeight.bold,
              color: AppColors.gray900,
            ),
      ),
    );
  }

  /// Small urgency chip derived from the notification's priority: critical is
  /// red, high orange, normal blue-grey, low grey.
  Widget _buildPriorityChip(NotificationPriority priority) {
    final color = notificationPriorityColor(priority);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceSm,
        vertical: 2,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(DesignTokens.radiusXs),
      ),
      child: Text(
        notificationPriorityLabel(priority),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: color,
              fontWeight: FontWeight.w700,
              fontSize: 9,
              letterSpacing: 0.6,
            ),
      ),
    );
  }

  Widget _buildNotificationCard(Notification notification) {
    final isUnread = notification.readAt == null;
    final categoryColor = _categoryColor(notification.category);
    final icon = _categoryIcon(notification.category);
    final createdAt = _parseTimestamp(notification.createdAt);
    final isMarking = _markingId == notification.notificationId;
    final copy = NotificationCopy.forCode(notification.titleCode);
    final showPriorityChip =
        notification.priority != NotificationPriority.unknown;

    return Material(
      color: isUnread ? categoryColor.withValues(alpha: 0.06) : AppColors.white,
      borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: isMarking ? null : () => _onTapNotification(notification),
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(
              color: isUnread
                  ? categoryColor.withValues(alpha: 0.2)
                  : AppColors.gray200,
              width: 1,
            ),
            boxShadow: isUnread
                ? null
                : const [
                    BoxShadow(
                      color: AppColors.shadowLight,
                      blurRadius: 8,
                      offset: Offset(0, 2),
                    ),
                  ],
          ),
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Type icon
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: categoryColor.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: isMarking
                    ? Center(
                        child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: categoryColor,
                          ),
                        ),
                      )
                    : Icon(icon,
                        color: categoryColor, size: DesignTokens.iconMd),
              ),
              const SizedBox(width: DesignTokens.spaceMd - 2),

              // Content
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Text(
                            copy.title,
                            style: Theme.of(context)
                                .textTheme
                                .titleSmall
                                ?.copyWith(
                                  fontWeight: isUnread
                                      ? FontWeight.w600
                                      : FontWeight.w500,
                                  color: AppColors.gray900,
                                ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: DesignTokens.spaceSm),
                        if (showPriorityChip) ...[
                          _buildPriorityChip(notification.priority),
                          const SizedBox(width: DesignTokens.spaceSm),
                        ],
                        if (createdAt != null)
                          Text(
                            _formatTime(createdAt),
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(
                                  fontWeight: FontWeight.w500,
                                  color: isUnread
                                      ? AppColors.primary
                                      : AppColors.gray400,
                                ),
                          ),
                      ],
                    ),
                    const SizedBox(height: DesignTokens.spaceXs),
                    Text(
                      copy.body,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppColors.gray500,
                            height: 1.4,
                          ),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (createdAt != null &&
                        _dateGroupFor(createdAt) != _DateGroup.today) ...[
                      const SizedBox(height: DesignTokens.spaceXs),
                      Text(
                        _formatDate(createdAt),
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              color: AppColors.gray400,
                            ),
                      ),
                    ],
                  ],
                ),
              ),

              // Unread indicator
              if (isUnread) ...[
                const SizedBox(width: DesignTokens.spaceSm),
                Container(
                  width: 10,
                  height: 10,
                  margin: const EdgeInsets.only(top: 6),
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    shape: BoxShape.circle,
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.primary.withValues(alpha: 0.5),
                        blurRadius: 4,
                        spreadRadius: 1,
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Loading (shimmer skeletons)
  // ------------------------------------------------------------------

  Widget _buildLoadingList() {
    return Shimmer.fromColors(
      baseColor: AppColors.shimmerBase,
      highlightColor: AppColors.shimmerHighlight,
      child: ListView.builder(
        physics: const NeverScrollableScrollPhysics(),
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        itemCount: 6,
        itemBuilder: (context, index) {
          return Padding(
            padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm + 2),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: const BoxDecoration(
                    color: AppColors.white,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceMd - 2),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        height: 16,
                        width: double.infinity,
                        decoration: BoxDecoration(
                          color: AppColors.white,
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusXs),
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceSm),
                      Container(
                        height: 14,
                        width: double.infinity * 0.7,
                        decoration: BoxDecoration(
                          color: AppColors.white,
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusXs),
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceXs),
                      Container(
                        height: 14,
                        width: double.infinity * 0.5,
                        decoration: BoxDecoration(
                          color: AppColors.white,
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusXs),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// Date grouping buckets for notification sections.
enum _DateGroup { today, yesterday, earlier }
