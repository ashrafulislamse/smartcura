import 'package:flutter/material.dart' hide Notification;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/navigation/deep_link_handler.dart';
import '../../../../core/notifications/notification_copy.dart';
import '../../../../core/providers/providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Notifications screen.
///
/// Watches [notificationsProvider] and renders each notification as a
/// [PremiumCard] with human copy resolved from the title code through
/// [NotificationCopy] (mirroring the server's catalogue), a priority chip, and
/// the category badge. Pull-to-refresh is handled by [RefreshListWidget].
///
/// Tapping a notification marks it as read (`PUT /notifications/{id}/read`) and
/// navigates through the deep-link mapping ([locationForResource]), so list taps
/// and push taps land on the same screen. The All/Unread chips re-query the list
/// server-side; Mark all read fires `PUT /notifications/read-all`.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() =>
      _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  // Const instances so the provider family sees stable keys across rebuilds.
  static const _allFilter = NotificationFilter();
  static const _unreadFilter = NotificationFilter(unread: true);

  bool _unreadOnly = false;

  NotificationFilter get _filter => _unreadOnly ? _unreadFilter : _allFilter;

  @override
  Widget build(BuildContext context) {
    final notifications = ref.watch(notificationsProvider(_filter));
    final list = notifications.value?.data ?? <Notification>[];
    final unreadCount = list.where((n) => n.readAt == null).length;
    final markAll = ref.watch(markAllNotificationsReadNotifier);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Row(
          children: [
            const Text('Notifications'),
            if (unreadCount > 0) ...[
              const SizedBox(width: DesignTokens.spaceSm),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(
                  color: AppColors.emergency,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Text(
                  '$unreadCount',
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ],
        ),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: () => context.pop(),
        ),
        actions: [
          if (unreadCount > 0)
            TextButton(
              onPressed: markAll.loading ? null : _markAllRead,
              child: markAll.loading
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text(
                      'Mark all read',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
            ),
        ],
      ),
      body: Column(
        children: [
          _FilterSelector(
            unreadOnly: _unreadOnly,
            onChanged: (unread) {
              setState(() => _unreadOnly = unread);
            },
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Expanded(
            child: StateView<NotificationList>(
              isLoading: notifications.isLoading,
              error: notifications.error,
              isEmpty: notifications.hasValue && list.isEmpty,
              data: notifications.value,
              emptyTitle:
                  _unreadOnly ? 'No unread notifications' : 'No notifications',
              emptyBody: 'You are all caught up.',
              emptyIcon: Icons.notifications_none_rounded,
              onRetry: () => ref.invalidate(notificationsProvider(_filter)),
              builder: (data) => RefreshListWidget<Notification>(
                items: data.data,
                onRefresh: () async =>
                    ref.invalidate(notificationsProvider(_filter)),
                padding:
                    const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
                itemBuilder: (context, n, index) => _NotificationCard(
                  notification: n,
                  onTap: () => _handleTap(n),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ---- Actions --------------------------------------------------------------

  Future<void> _markAllRead() async {
    final ok = await ref.read(markAllNotificationsReadNotifier.notifier).call();
    if (!mounted) return;
    if (ok) {
      ref.invalidate(notificationsProvider(_allFilter));
      ref.invalidate(notificationsProvider(_unreadFilter));
    } else {
      final error = ref.read(markAllNotificationsReadNotifier).error;
      AppSnackbar.error(
          context, error?.displayMessage ?? 'Could not mark all as read.');
    }
  }

  // ---- Tap handling --------------------------------------------------------

  Future<void> _handleTap(Notification n) async {
    // Mark as read if unread.
    if (n.readAt == null) {
      final notifier = ref.read(markNotificationReadNotifier.notifier);
      final ok = await notifier.call(notificationId: n.notificationId);
      if (mounted && ok) {
        ref.invalidate(notificationsProvider(_filter));
      }
    }
    if (!mounted) return;

    // Deep-link navigation — the same mapping a push tap follows. Mapping to
    // the notification centre means "no dedicated screen here": the user is
    // already looking at it.
    final location = locationForResource(n.resourceType, n.resourceId);
    if (location == kNotificationsLocation) return;
    context.push(location);
  }
}

/// All / Unread filter chips. Drives the `unread=true` server-side query.
class _FilterSelector extends StatelessWidget {
  const _FilterSelector({required this.unreadOnly, required this.onChanged});

  final bool unreadOnly;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    Widget chip(String label, bool selected, bool value) {
      return ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onChanged(value),
        selectedColor: AppColors.primary,
        labelStyle: TextStyle(
          color: selected ? AppColors.white : AppColors.textSecondary,
          fontWeight: FontWeight.w700,
          fontSize: 13,
        ),
        backgroundColor: AppColors.gray100,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
          side: BorderSide(
            color: selected ? AppColors.primary : AppColors.gray200,
          ),
        ),
        showCheckmark: false,
        padding: const EdgeInsets.symmetric(horizontal: 4),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.screenPaddingHorizontal,
      ),
      child: Row(
        children: [
          chip('All', !unreadOnly, false),
          const SizedBox(width: DesignTokens.spaceSm),
          chip('Unread', unreadOnly, true),
        ],
      ),
    );
  }
}

// ---- Notification card -----------------------------------------------------

class _NotificationCard extends StatelessWidget {
  final Notification notification;
  final VoidCallback onTap;

  const _NotificationCard({required this.notification, required this.onTap});

  bool get _isUnread => notification.readAt == null;

  @override
  Widget build(BuildContext context) {
    final cat = notification.category;
    final color = _categoryColor(cat);
    final copy = NotificationCopy.forCode(notification.titleCode);

    return PremiumCard(
      onTap: onTap,
      accentColor: _isUnread ? color : null,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Icon
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: Icon(_categoryIcon(cat), color: color, size: 22),
          ),
          const SizedBox(width: DesignTokens.spaceSm + 4),
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
                          fontSize: 14,
                          fontWeight:
                              _isUnread ? FontWeight.w800 : FontWeight.w600,
                          color: AppColors.textPrimary,
                        ),
                      ),
                    ),
                    const SizedBox(width: DesignTokens.spaceSm),
                    Text(
                      _formatTimestamp(notification.createdAt),
                      style: const TextStyle(
                        fontSize: 11,
                        color: AppColors.gray400,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  copy.body,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                    height: 1.4,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                // Badges. A Wrap (not a Row) so category + priority + unread
                // dot never overflow on narrow devices.
                Wrap(
                  spacing: DesignTokens.spaceSm,
                  runSpacing: DesignTokens.spaceXs,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    StatusBadge(
                      text: _categoryLabel(cat),
                      tone: _categoryTone(cat),
                      small: true,
                    ),
                    _PriorityChip(priority: notification.priority),
                    if (_isUnread)
                      Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          color: AppColors.primary,
                          shape: BoxShape.circle,
                        ),
                      ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ---- Helpers --------------------------------------------------------------

  String _formatTimestamp(String iso) {
    try {
      final dt = DateTime.parse(iso);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inMinutes < 1) return 'Just now';
      if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
      if (diff.inHours < 24) return '${diff.inHours}h ago';
      if (diff.inDays < 7) return '${diff.inDays}d ago';
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '';
    }
  }

  String _categoryLabel(NotificationCategory cat) => switch (cat) {
        NotificationCategory.accountSecurity => 'Security',
        NotificationCategory.appointments => 'Appointment',
        NotificationCategory.consultations => 'Consultation',
        NotificationCategory.messages => 'Message',
        NotificationCategory.prescriptions => 'Prescription',
        NotificationCategory.vitalsAlerts => 'Vitals Alert',
        NotificationCategory.aiReview => 'AI Review',
        NotificationCategory.delivery => 'Delivery',
        NotificationCategory.dispatch => 'Dispatch',
        NotificationCategory.emergency => 'Emergency',
        NotificationCategory.system => 'System',
        NotificationCategory.vitalsUpdate => 'Vitals Update',
        NotificationCategory.unknown => 'Notification',
      };

  IconData _categoryIcon(NotificationCategory cat) => switch (cat) {
        NotificationCategory.accountSecurity => Icons.security_rounded,
        NotificationCategory.appointments => Icons.event_rounded,
        NotificationCategory.consultations => Icons.medical_services_rounded,
        NotificationCategory.messages => Icons.message_rounded,
        NotificationCategory.prescriptions => Icons.medication_rounded,
        NotificationCategory.vitalsAlerts => Icons.monitor_heart_rounded,
        NotificationCategory.aiReview => Icons.auto_awesome_rounded,
        NotificationCategory.delivery => Icons.local_shipping_rounded,
        NotificationCategory.dispatch => Icons.local_shipping_rounded,
        NotificationCategory.emergency => Icons.warning_rounded,
        NotificationCategory.system => Icons.campaign_rounded,
        NotificationCategory.vitalsUpdate => Icons.monitor_heart_rounded,
        NotificationCategory.unknown => Icons.notifications_rounded,
      };

  Color _categoryColor(NotificationCategory cat) => switch (cat) {
        NotificationCategory.accountSecurity => AppColors.error,
        NotificationCategory.appointments => AppColors.primary,
        NotificationCategory.consultations => AppColors.primary,
        NotificationCategory.messages => AppColors.info,
        NotificationCategory.prescriptions => AppColors.secondary,
        NotificationCategory.vitalsAlerts => AppColors.emergency,
        NotificationCategory.aiReview => AppColors.info,
        NotificationCategory.delivery => AppColors.primary,
        NotificationCategory.dispatch => AppColors.primary,
        NotificationCategory.emergency => AppColors.emergency,
        NotificationCategory.system => AppColors.gray400,
        NotificationCategory.vitalsUpdate => AppColors.info,
        NotificationCategory.unknown => AppColors.gray400,
      };

  StatusTone _categoryTone(NotificationCategory cat) => switch (cat) {
        NotificationCategory.accountSecurity => StatusTone.error,
        NotificationCategory.appointments => StatusTone.info,
        NotificationCategory.consultations => StatusTone.info,
        NotificationCategory.messages => StatusTone.info,
        NotificationCategory.prescriptions => StatusTone.success,
        NotificationCategory.vitalsAlerts => StatusTone.error,
        NotificationCategory.aiReview => StatusTone.info,
        NotificationCategory.delivery => StatusTone.info,
        NotificationCategory.dispatch => StatusTone.info,
        NotificationCategory.emergency => StatusTone.error,
        NotificationCategory.system => StatusTone.neutral,
        NotificationCategory.vitalsUpdate => StatusTone.info,
        NotificationCategory.unknown => StatusTone.neutral,
      };
}

/// Small tinted pill showing the notification's delivery priority, coloured by
/// [NotificationCopy.priorityColor].
class _PriorityChip extends StatelessWidget {
  const _PriorityChip({required this.priority});

  final NotificationPriority priority;

  @override
  Widget build(BuildContext context) {
    final color = NotificationCopy.priorityColor(priority);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        NotificationCopy.priorityLabel(priority),
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}
