import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';
import '../../../../core/providers/providers.dart';
import '../../../../core/auth/auth_provider.dart';
import '../../../../core/utils/money.dart';

/// Driver dashboard — premium redesign v2.
///
/// Section order (matches the patient home pattern):
///  1. Header — clean white, greeting + online toggle + notification bell
///  2. Hero — active delivery card (premium white card) OR idle state
///  3. Stat row — Earnings / Active / Completed (3 clean cards)
///  4. Quick actions — Find Orders / Withdraw / Support
///  5. Recent deliveries — completed list
///
/// All data is wired to real providers:
///  - [currentProfileProvider]        → greeting name
///  - [driverEarningsProvider]        → wallet balance (stat card)
///  - [driverAssignmentsProvider]     → active + completed assignment counts
///
/// The online/offline toggle is local UI state only; no endpoint models a
/// driver availability switch yet, so toggling it shows a snackbar and does not
/// persist. When a `PATCH /drivers/me/availability` endpoint is added, wire
/// the toggle to it.
class DriverDashboardScreen extends ConsumerStatefulWidget {
  const DriverDashboardScreen({super.key});

  @override
  ConsumerState<DriverDashboardScreen> createState() =>
      _DriverDashboardScreenState();
}

class _DriverDashboardScreenState extends ConsumerState<DriverDashboardScreen> {
  // Filters are `const` so family canonicalization reuses one provider entry.
  static const _activeFilter = DriverAssignmentFilter(status: 'active');
  static const _completedFilter = DriverAssignmentFilter(status: 'completed');

  bool _isOnline = true;

  String _greeting() {
    final h = DateTime.now().hour;
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  String _displayName(Profile? profile) {
    final name = profile?.displayName.trim();
    if (name == null || name.isEmpty) return 'Driver';
    final first = name.split(' ').first;
    return first.isEmpty ? name : first;
  }

  Future<void> _refresh() async {
    ref.invalidate(profileProvider);
    ref.invalidate(driverEarningsProvider);
    ref.invalidate(driverAssignmentsProvider(_activeFilter));
    ref.invalidate(driverAssignmentsProvider(_completedFilter));
  }

  void _toggleOnline() {
    setState(() => _isOnline = !_isOnline);
    AppSnackbar.info(
      context,
      'Driver availability is managed by dispatch. '
      '${_isOnline ? 'Online' : 'Offline'} status is not yet switchable.',
    );
  }

  @override
  Widget build(BuildContext context) {
    final profileAsync = ref.watch(profileProvider);
    final profile = profileAsync.valueOrNull;
    final earnings = ref.watch(driverEarningsProvider);
    final activeAssignments =
        ref.watch(driverAssignmentsProvider(_activeFilter));
    final completedAssignments =
        ref.watch(driverAssignmentsProvider(_completedFilter));

    final balanceSen = earnings.valueOrNull?.balanceSen;
    final activeCount = activeAssignments.valueOrNull?.length;
    final completedCount = completedAssignments.valueOrNull?.length;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: Colors.transparent,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            onRefresh: _refresh,
            color: AppColors.primary,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // 1. Header — greeting, online toggle, bell
                  _buildHeader(profile),
                  const SizedBox(height: DesignTokens.spaceMd),

                  // 2. Active delivery hero (or idle state)
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceMd,
                    ),
                    child: _activeDeliverySection(activeAssignments),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),

                  // 3. Three-stat row
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceMd,
                    ),
                    child: _statRow(balanceSen, activeCount, completedCount),
                  ),
                  const SizedBox(height: DesignTokens.spaceXl),

                  // 4. Quick actions
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceMd,
                    ),
                    child: _quickActions(),
                  ),
                  const SizedBox(height: DesignTokens.spaceXl),

                  // 5. Recent deliveries
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceMd,
                    ),
                    child: _recentDeliveriesHeader(),
                  ),
                  const SizedBox(height: DesignTokens.spaceSm),
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceMd,
                    ),
                    child: _recentDeliveriesSection(completedAssignments),
                  ),

                  // Keep content clear of the floating bottom nav.
                  const SizedBox(height: 120),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------

  Widget _buildHeader(Profile? profile) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        DesignTokens.spaceSm,
        DesignTokens.spaceMd,
        DesignTokens.spaceSm,
      ),
      child: Row(
        children: [
          // Avatar
          AvatarWidget(
            name: profile?.displayName ?? 'D R',
            imageUrl: profile?.avatarUrl,
            size: 48,
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          // Greeting
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${_greeting()},',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _displayName(profile),
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    letterSpacing: -0.5,
                    height: 1.1,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  DateFormat('EEEE, d MMMM').format(DateTime.now()),
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          // Online toggle pill
          _OnlinePill(
            isOnline: _isOnline,
            onTap: _toggleOnline,
          ),
          const SizedBox(width: 6),
          // Notification bell
          GestureDetector(
            onTap: () {
              HapticFeedback.lightImpact();
              context.push('/notifications');
            },
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.white,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: AppColors.black.withValues(alpha: 0.06),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: const Center(
                child: Icon(
                  Icons.notifications_outlined,
                  color: AppColors.gray600,
                  size: 22,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Active delivery hero
  // ---------------------------------------------------------------------------

  Widget _activeDeliverySection(
      AsyncValue<List<DispatchAssignmentSummary>> av) {
    if (av.isLoading && !av.hasValue) {
      return _heroPlaceholder();
    }
    if (av.hasError) {
      return ErrorView(
        message: _asyncMessage(av.error),
        onRetry: _isRetryable(av.error) ? _refresh : null,
        icon: Icons.error_outline,
      );
    }
    final list = av.value ?? const [];
    if (list.isEmpty) {
      return _noActiveCard();
    }
    return _activeDeliveryHero(list.first);
  }

  Widget _activeDeliveryHero(DispatchAssignmentSummary a) {
    final info = _assignmentStatusInfo(a.status.wireValue);
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.05),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: info.tone.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: Icon(
                  Icons.directions_run_rounded,
                  color: info.tone,
                  size: 24,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: info.tone,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          'Active Delivery',
                          style: TextStyle(
                            color: info.tone,
                            fontSize: 12,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 0.3,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      formatSen(a.feeSen),
                      style: const TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        height: 1.0,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Job ${_shortId(a.dispatchJobId)}  ·  ${info.label}',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              onPressed: () =>
                  context.push('/order-details?id=${a.assignmentId}'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    'Continue Delivery',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                  SizedBox(width: 8),
                  Icon(Icons.arrow_forward_rounded, size: 18),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _heroPlaceholder() {
    return Container(
      height: 120,
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
      ),
      child: const Center(
        child: SizedBox(
          width: 24,
          height: 24,
          child: CircularProgressIndicator(strokeWidth: 2),
        ),
      ),
    );
  }

  Widget _noActiveCard() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.gray100,
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: const Icon(
              Icons.inbox_rounded,
              color: AppColors.gray600,
              size: 24,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'No active deliveries',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _isOnline
                      ? 'New offers will appear in Available Orders.'
                      : 'Go online to start receiving dispatch offers.',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Stat row
  // ---------------------------------------------------------------------------

  Widget _statRow(int? balanceSen, int? activeCount, int? completedCount) {
    return Row(
      children: [
        Expanded(
          child: _StatCard(
            label: 'Earnings',
            value: balanceSen == null ? '—' : formatSen(balanceSen),
            icon: Icons.account_balance_wallet_rounded,
            iconBg: AppColors.primaryContainer,
            iconColor: AppColors.primary,
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: _StatCard(
            label: 'Active',
            value: activeCount?.toString() ?? '—',
            icon: Icons.local_shipping_rounded,
            iconBg: AppColors.warningContainer,
            iconColor: AppColors.warning,
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: _StatCard(
            label: 'Completed',
            value: completedCount?.toString() ?? '—',
            icon: Icons.check_circle_rounded,
            iconBg: AppColors.successContainer,
            iconColor: AppColors.success,
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Quick actions
  // ---------------------------------------------------------------------------

  Widget _quickActions() {
    final actions = [
      _QuickAction(
        icon: Icons.local_shipping_rounded,
        label: 'Find Orders',
        color: AppColors.primary,
        bg: AppColors.primaryContainer,
        onTap: () => context.go('/orders'),
      ),
      _QuickAction(
        icon: Icons.account_balance_rounded,
        label: 'Withdraw',
        color: AppColors.secondary,
        bg: AppColors.secondaryContainer,
        onTap: () => context.push('/earnings/withdraw'),
      ),
      _QuickAction(
        icon: Icons.history_rounded,
        label: 'History',
        color: AppColors.info,
        bg: AppColors.infoContainer,
        onTap: () => context.push('/orders/history'),
      ),
      _QuickAction(
        icon: Icons.support_agent_rounded,
        label: 'Support',
        color: AppColors.gray700,
        bg: AppColors.gray100,
        onTap: () => context.push('/support'),
      ),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Quick Actions',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
            letterSpacing: -0.3,
          ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        Row(
          children: [
            for (int i = 0; i < actions.length; i++) ...[
              if (i > 0) const SizedBox(width: DesignTokens.spaceSm),
              Expanded(child: actions[i]),
            ],
          ],
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Recent deliveries
  // ---------------------------------------------------------------------------

  Widget _recentDeliveriesHeader() {
    return Row(
      children: [
        const Text(
          'Recent Deliveries',
          style: TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
            letterSpacing: -0.3,
          ),
        ),
        const Spacer(),
        GestureDetector(
          onTap: () => context.push('/orders/history'),
          child: const Text(
            'See all',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.primary,
            ),
          ),
        ),
      ],
    );
  }

  Widget _recentDeliveriesSection(
      AsyncValue<List<DispatchAssignmentSummary>> cv) {
    if (cv.isLoading && !cv.hasValue) {
      return Container(
        height: 80,
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.gray200),
        ),
        child: const Center(
          child: SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
        ),
      );
    }
    if (cv.hasError) {
      return ErrorView(
        message: _asyncMessage(cv.error),
        onRetry: _isRetryable(cv.error) ? _refresh : null,
        icon: Icons.error_outline,
      );
    }
    final list = cv.value ?? const [];
    if (list.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(DesignTokens.spaceLg),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.gray200),
        ),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.gray100,
                borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
              ),
              child: const Icon(
                Icons.history_rounded,
                color: AppColors.gray500,
                size: 20,
              ),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            const Expanded(
              child: Text(
                'No completed deliveries yet.\nYour trip history will appear here.',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textSecondary,
                  height: 1.4,
                ),
              ),
            ),
          ],
        ),
      );
    }
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Column(
        children: [
          for (int i = 0; i < list.length; i++) ...[
            if (i > 0)
              const Divider(
                height: 1,
                thickness: 1,
                color: AppColors.gray100,
                indent: DesignTokens.spaceMd,
                endIndent: DesignTokens.spaceMd,
              ),
            _RecentDeliveryRow(assignment: list[i]),
          ],
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  String _shortId(String uuid) {
    // Show the last 6 hex chars of the first UUID segment for compactness.
    if (uuid.length < 8) return uuid;
    return uuid.substring(0, 8);
  }

  String _asyncMessage(Object? e) {
    if (e == null) return 'Something went wrong.';
    return e.toString();
  }

  bool _isRetryable(Object? e) {
    if (e == null) return false;
    final s = e.toString();
    return !s.contains('403') && !s.contains('PERMISSION_DENIED');
  }

  _StatusTone _assignmentStatusInfo(String status) {
    switch (status) {
      case 'assigned':
      case 'en_route_pickup':
        return _StatusTone(AppColors.info, 'Heading to pickup');
      case 'arrived_pickup':
        return _StatusTone(AppColors.warning, 'At pickup');
      case 'picked_up':
      case 'en_route_dropoff':
        return _StatusTone(AppColors.warning, 'In transit');
      case 'arrived_dropoff':
        return _StatusTone(AppColors.success, 'Arrived at drop-off');
      case 'completed':
        return _StatusTone(AppColors.gray500, 'Completed');
      case 'cancelled':
      case 'failed':
        return _StatusTone(AppColors.error, 'Cancelled');
      default:
        return _StatusTone(AppColors.gray500, status);
    }
  }
}

// ---------------------------------------------------------------------------
// Sub-widgets
// ---------------------------------------------------------------------------

class _OnlinePill extends StatelessWidget {
  final bool isOnline;
  final VoidCallback onTap;

  const _OnlinePill({required this.isOnline, required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 220),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: isOnline ? AppColors.success : AppColors.gray200,
          borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(
                color: AppColors.white,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: isOnline
                        ? AppColors.success.withValues(alpha: 0.6)
                        : Colors.transparent,
                    blurRadius: 6,
                  ),
                ],
              ),
            ),
            const SizedBox(width: 6),
            Text(
              isOnline ? 'Online' : 'Offline',
              style: const TextStyle(
                color: AppColors.white,
                fontSize: 12,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final Color iconBg;
  final Color iconColor;

  const _StatCard({
    required this.label,
    required this.value,
    required this.icon,
    required this.iconBg,
    required this.iconColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.03),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 32,
            height: 32,
            decoration: BoxDecoration(
              color: iconBg,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: iconColor, size: 18),
          ),
          const SizedBox(height: DesignTokens.spaceSm + 2),
          Text(
            label,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
              letterSpacing: 0.2,
            ),
          ),
          const SizedBox(height: 2),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
                letterSpacing: -0.5,
                height: 1.0,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _QuickAction extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  final Color bg;
  final VoidCallback onTap;

  const _QuickAction({
    required this.icon,
    required this.label,
    required this.color,
    required this.bg,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.gray200),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: bg,
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              label,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
                letterSpacing: 0.1,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _RecentDeliveryRow extends StatelessWidget {
  final DispatchAssignmentSummary assignment;

  const _RecentDeliveryRow({required this.assignment});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () =>
            context.push('/trip-complete?id=${assignment.assignmentId}'),
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd,
            vertical: DesignTokens.spaceMd,
          ),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.successContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: const Icon(
                  Icons.check_rounded,
                  color: AppColors.success,
                  size: 20,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Completed',
                      style: TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Job ${_shortId(assignment.dispatchJobId)}',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textSecondary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Text(
                formatSen(assignment.feeSen),
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              const Icon(
                Icons.chevron_right_rounded,
                color: AppColors.gray400,
                size: 20,
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _shortId(String uuid) {
    if (uuid.length < 8) return uuid;
    return uuid.substring(0, 8);
  }
}

class _StatusTone {
  final Color tone;
  final String label;
  _StatusTone(this.tone, this.label);
}
