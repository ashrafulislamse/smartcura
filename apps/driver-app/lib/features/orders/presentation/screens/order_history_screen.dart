import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';
import '../../../../core/providers/providers.dart';

/// Order history — completed driver assignments plus an aggregate summary.
///
/// Data:
///  - [driverAssignmentsProvider] with `status: 'completed'` → the trip list.
///  - [driverEarningsProvider]                    → total earnings (balance_sen).
///  - [driverRatingsProvider]                     → average stars + count.
///
/// Each assignment carries only assignment id, dispatch job id, status and
/// version on [DispatchAssignmentCreated] — no per-trip fee or timestamp — so
/// those are not fabricated on the cards. The summary's total earnings uses the
/// earnings balance (the only real money figure available) and the average
/// rating uses the ratings provider. Date filter chips are cosmetic,
/// client-side filters (today / week / month / all); there is no per-assignment
/// timestamp to filter on yet, so the chips re-filter only the completed list.
class OrderHistoryScreen extends ConsumerStatefulWidget {
  const OrderHistoryScreen({super.key});

  @override
  ConsumerState<OrderHistoryScreen> createState() => _OrderHistoryScreenState();
}

class _OrderHistoryScreenState extends ConsumerState<OrderHistoryScreen> {
  static const _completedFilter = DriverAssignmentFilter(status: 'completed');
  static const _dateFilters = <String>['Today', 'Week', 'Month', 'All'];
  String _dateFilter = 'All';

  Future<void> _refresh() async {
    ref.invalidate(driverAssignmentsProvider(_completedFilter));
    ref.invalidate(driverEarningsProvider);
    ref.invalidate(driverRatingsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final assignments = ref.watch(driverAssignmentsProvider(_completedFilter));
    final ratings = ref.watch(driverRatingsProvider);

    final avgRating = ratings.valueOrNull?.averageStars;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Order History'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        color: AppColors.primary,
        child: Column(
          children: [
            const SizedBox(height: 12),
            FilterChipsWidget<String>(
              options: _dateFilters,
              selected: _dateFilter,
              onSelected: (v) => setState(() => _dateFilter = v ?? 'All'),
              labelBuilder: (s) => s,
            ),
            const SizedBox(height: 12),
            Expanded(
              child: assignments.when(
                loading: () => _scrollableFill(const _LoadingState()),
                error: (e, _) => _scrollableFill(ErrorView(
                  message: _message(e),
                  onRetry: _retryable(e) ? _refresh : null,
                )),
                data: (list) {
                  final filtered = _applyDateFilter(list);
                  final totalTrips = filtered.length;
                  // Total earnings = sum of real per-trip fee_sen for the
                  // filtered window. Derived from the displayed list, never a
                  // cached projection (see "derived over stored" convention).
                  final totalEarningsSen =
                      filtered.fold<int>(0, (sum, a) => sum + a.feeSen);
                  return Column(
                    children: [
                      _SummaryRow(
                        totalTrips: totalTrips,
                        totalEarningsSen: totalEarningsSen,
                        avgRating: avgRating,
                      ),
                      const SizedBox(height: 12),
                      Expanded(
                        child: filtered.isEmpty
                            ? _scrollableFill(const EmptyView(
                                title: 'No trips in this period',
                                body:
                                    'Completed deliveries for the selected window will show here.',
                                icon: Icons.history_rounded,
                                illustrationAsset:
                                    'assets/illustrations/empty_trips.svg',
                              ))
                            : RefreshListWidget<DispatchAssignmentSummary>(
                                items: filtered,
                                onRefresh: _refresh,
                                padding:
                                    const EdgeInsets.fromLTRB(16, 8, 16, 24),
                                itemBuilder: (ctx, a, i) => _HistoryCard(
                                  assignment: a,
                                  onTap: () => context.push(
                                      '/trip-complete?id=${a.assignmentId}'),
                                ),
                              ),
                      ),
                    ],
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Client-side date filter over the fetched completed assignments, using the
  /// real `completed_at` (falling back to `assigned_at`). 'All' returns the
  /// unfiltered list. Newest first.
  List<DispatchAssignmentSummary> _applyDateFilter(
      List<DispatchAssignmentSummary> list) {
    final now = DateTime.now();
    DateTime cutoff;
    switch (_dateFilter) {
      case 'Today':
        cutoff = DateTime(now.year, now.month, now.day);
        break;
      case 'Week':
        cutoff = now.subtract(const Duration(days: 7));
        break;
      case 'Month':
        cutoff = now.subtract(const Duration(days: 30));
        break;
      case 'All':
      default:
        cutoff = DateTime.fromMillisecondsSinceEpoch(0);
    }
    final filtered = list.where((a) {
      final ts = _parseTimestamp(a.completedAt ?? a.assignedAt);
      return ts != null && !ts.isBefore(cutoff);
    }).toList();
    // Most recent first.
    filtered.sort((a, b) {
      final ta = _parseTimestamp(a.completedAt ?? a.assignedAt);
      final tb = _parseTimestamp(b.completedAt ?? b.assignedAt);
      if (ta == null && tb == null) return 0;
      if (ta == null) return 1;
      if (tb == null) return -1;
      return tb.compareTo(ta);
    });
    return filtered;
  }

  Widget _scrollableFill(Widget child) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.6,
          child: child,
        ),
      );
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();
  @override
  Widget build(BuildContext context) => const Center(
        child: Padding(
          padding: EdgeInsets.all(DesignTokens.spaceXl),
          child: CircularProgressIndicator(color: AppColors.primary),
        ),
      );
}

class _SummaryRow extends StatelessWidget {
  final int totalTrips;
  final int? totalEarningsSen;
  final double? avgRating;

  const _SummaryRow({
    required this.totalTrips,
    required this.totalEarningsSen,
    required this.avgRating,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.primary.withOpacity(0.06),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: AppColors.primary.withOpacity(0.15)),
      ),
      child: Row(
        children: [
          _SummaryItem(
            label: 'Total Trips',
            value: '$totalTrips',
          ),
          const _VDivider(),
          _SummaryItem(
            label: 'Earnings',
            value:
                totalEarningsSen == null ? '—' : formatSen(totalEarningsSen!),
          ),
          const _VDivider(),
          _SummaryItem(
            label: 'Avg Rating',
            value: avgRating == null ? '—' : avgRating!.toStringAsFixed(1),
          ),
        ],
      ),
    );
  }
}

class _SummaryItem extends StatelessWidget {
  final String label;
  final String value;

  const _SummaryItem({required this.label, required this.value});

  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(
          children: [
            Text(value,
                style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primary)),
            const SizedBox(height: 2),
            Text(label,
                style: const TextStyle(
                    fontSize: 11, color: AppColors.textSecondary)),
          ],
        ),
      );
}

class _VDivider extends StatelessWidget {
  const _VDivider();
  @override
  Widget build(BuildContext context) => Container(
        width: 1,
        height: 30,
        color: AppColors.border,
      );
}

class _HistoryCard extends StatelessWidget {
  final DispatchAssignmentSummary assignment;
  final VoidCallback onTap;

  const _HistoryCard({required this.assignment, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final info = _statusInfo(assignment.status);
    final completed = assignment.status == DispatchAssignmentStatus.completed;
    final dateText =
        _formatTimestamp(assignment.completedAt ?? assignment.assignedAt);
    return PremiumCard(
      margin: EdgeInsets.zero,
      accentColor: completed ? AppColors.success : AppColors.error,
      onTap: onTap,
      child: Row(
        children: [
          Container(
            width: 42,
            height: 42,
            decoration: BoxDecoration(
              color: (completed ? AppColors.success : AppColors.error)
                  .withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: Icon(
              completed ? Icons.check_circle_rounded : Icons.cancel_rounded,
              color: completed ? AppColors.success : AppColors.error,
              size: 20,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Job ${_shortId(assignment.dispatchJobId)}',
                    style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary),
                    overflow: TextOverflow.ellipsis),
                const SizedBox(height: 4),
                Row(
                  children: [
                    StatusBadge(text: info.label, tone: info.tone, small: true),
                    const Spacer(),
                    Text(formatSen(assignment.feeSen),
                        style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w800,
                            color: AppColors.primary)),
                  ],
                ),
                if (dateText != null) ...[
                  const SizedBox(height: 4),
                  Text(dateText,
                      style: const TextStyle(
                          fontSize: 11, color: AppColors.textSecondary)),
                ],
              ],
            ),
          ),
          const Icon(Icons.chevron_right_rounded,
              color: AppColors.gray400, size: 22),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

String formatSen(int sen) => 'RM ${(sen / 100).toStringAsFixed(2)}';

String _shortId(String id) => id.length <= 8 ? id : id.substring(0, 8);

DateTime? _parseTimestamp(String ts) {
  try {
    return DateTime.parse(ts);
  } catch (_) {
    return null;
  }
}

String? _formatTimestamp(String ts) {
  final dt = _parseTimestamp(ts);
  if (dt == null) return null;
  final d = DateTime.tryParse('${dt.toLocal()}');
  final t = d ?? dt;
  final day = t.day.toString().padLeft(2, '0');
  final month = _monthName(t.month);
  final hour = t.hour.toString().padLeft(2, '0');
  final minute = t.minute.toString().padLeft(2, '0');
  return '$day $month · $hour:$minute';
}

String _monthName(int m) => const [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ][m - 1];

({String label, StatusTone tone}) _statusInfo(DispatchAssignmentStatus s) =>
    switch (s) {
      DispatchAssignmentStatus.assigned => (
          label: 'Assigned',
          tone: StatusTone.info
        ),
      DispatchAssignmentStatus.enRoutePickup => (
          label: 'En route to pickup',
          tone: StatusTone.info
        ),
      DispatchAssignmentStatus.arrivedPickup => (
          label: 'Arrived at pickup',
          tone: StatusTone.warning
        ),
      DispatchAssignmentStatus.pickedUp => (
          label: 'Picked up',
          tone: StatusTone.info
        ),
      DispatchAssignmentStatus.enRouteDropoff => (
          label: 'En route to drop-off',
          tone: StatusTone.info
        ),
      DispatchAssignmentStatus.arrivedDropoff => (
          label: 'Arrived at drop-off',
          tone: StatusTone.warning
        ),
      DispatchAssignmentStatus.completed => (
          label: 'Completed',
          tone: StatusTone.success
        ),
      DispatchAssignmentStatus.cancelled => (
          label: 'Cancelled',
          tone: StatusTone.error
        ),
      DispatchAssignmentStatus.failed => (
          label: 'Failed',
          tone: StatusTone.error
        ),
      DispatchAssignmentStatus.unknown => (
          label: 'Unknown',
          tone: StatusTone.neutral
        ),
    };

String _message(Object? error) {
  if (error == null) return 'Something went wrong';
  try {
    final m = (error as dynamic).displayMessage;
    if (m is String && m.isNotEmpty) return m;
  } catch (_) {}
  return error.toString();
}

bool _retryable(Object? error) {
  if (error == null) return false;
  try {
    final f = (error as dynamic).isForbidden;
    if (f is bool && f) return false;
  } catch (_) {}
  return true;
}
