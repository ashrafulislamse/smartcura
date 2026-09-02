import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/money.dart';
import '../../../../core/widgets/widgets.dart';

/// SharedPreferences / family-arg constants kept top-level so they are
/// canonicalised and reused across watch/invalidate calls.
const _completedFilter = DriverAssignmentFilter(status: 'completed');

/// Earnings screen — premium redesign v2 (no gradient header, no colored chrome).
///
/// Section order:
///  1. Header — clean title + subtitle
///  2. Balance hero — white card with balance + Withdraw button
///  3. 3-stat row — Balance / Trips / Average rating
///  4. Period filter chips — Today / Week / Month / All
///  5. Recent trips — completed deliveries list
class EarningsScreen extends ConsumerStatefulWidget {
  const EarningsScreen({super.key});

  @override
  ConsumerState<EarningsScreen> createState() => _EarningsScreenState();
}

class _EarningsScreenState extends ConsumerState<EarningsScreen> {
  String _period = 'All';
  static const _periods = ['Today', 'Week', 'Month', 'All'];

  Future<void> _refresh() async {
    ref.invalidate(driverEarningsProvider);
    ref.invalidate(driverRatingsProvider);
    ref.invalidate(driverAssignmentsProvider(_completedFilter));
  }

  @override
  Widget build(BuildContext context) {
    final earningsAsync = ref.watch(driverEarningsProvider);
    final ratingsAsync = ref.watch(driverRatingsProvider);
    final assignmentsAsync =
        ref.watch(driverAssignmentsProvider(_completedFilter));

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
            child: earningsAsync.when(
              loading: () => _scrollableFill(const _LoadingState()),
              error: (e, _) => _scrollableFill(ErrorView(
                message: _errorMessage(e),
                onRetry: _retryable(e) ? _refresh : null,
              )),
              data: (earnings) {
                final ratings = ratingsAsync.value;
                final assignments = assignmentsAsync.value ??
                    const <DispatchAssignmentSummary>[];
                return CustomScrollView(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  slivers: [
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(
                          DesignTokens.spaceMd,
                          DesignTokens.spaceSm,
                          DesignTokens.spaceMd,
                          DesignTokens.spaceSm,
                        ),
                        child: _header(),
                      ),
                    ),
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: DesignTokens.spaceMd,
                        ),
                        child: _BalanceHero(earnings: earnings),
                      ),
                    ),
                    const SliverToBoxAdapter(
                      child: SizedBox(height: DesignTokens.spaceMd),
                    ),
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: DesignTokens.spaceMd,
                        ),
                        child: _StatRow(
                          earnings: earnings,
                          ratings: ratings,
                        ),
                      ),
                    ),
                    const SliverToBoxAdapter(
                      child: SizedBox(height: DesignTokens.spaceXl),
                    ),
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: DesignTokens.spaceMd,
                        ),
                        child: _PeriodChips(
                          period: _period,
                          periods: _periods,
                          onChanged: (p) => setState(() => _period = p),
                        ),
                      ),
                    ),
                    const SliverToBoxAdapter(
                      child: SizedBox(height: DesignTokens.spaceMd),
                    ),
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: DesignTokens.spaceMd,
                        ),
                        child: const _SectionTitle(title: 'Recent Trips'),
                      ),
                    ),
                    const SliverToBoxAdapter(
                      child: SizedBox(height: DesignTokens.spaceSm),
                    ),
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: DesignTokens.spaceMd,
                        ),
                        child: _RecentTrips(assignments: assignments),
                      ),
                    ),
                    const SliverToBoxAdapter(
                      child: SizedBox(height: 120),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _header() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'My Earnings',
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
            letterSpacing: -0.5,
            height: 1.1,
          ),
        ),
        const SizedBox(height: 4),
        const Text(
          'Available balance, completed trips, and rating history.',
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: AppColors.textSecondary,
          ),
        ),
      ],
    );
  }

  // RefreshIndicator needs an always-scrollable child even for non-list states.
  Widget _scrollableFill(Widget child) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.75,
          child: child,
        ),
      );

  String _errorMessage(Object? error) {
    if (error is ApiError) return error.displayMessage;
    return error?.toString() ?? 'Something went wrong';
  }

  bool _retryable(Object? error) {
    if (error is! ApiError) return true;
    return !error.isForbidden;
  }
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

// ---------------------------------------------------------------------------
// Balance hero — white card with balance + Withdraw button
// ---------------------------------------------------------------------------

class _BalanceHero extends StatelessWidget {
  const _BalanceHero({required this.earnings});
  final DriverEarnings earnings;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
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
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: const Icon(
                  Icons.account_balance_wallet_rounded,
                  color: AppColors.primary,
                  size: 22,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              const Expanded(
                child: Text(
                  'Available Balance',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary,
                    letterSpacing: 0.2,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          AnimatedCounter(
            end: earnings.balanceSen / 100,
            prefix: 'RM ',
            decimals: 2,
            style: const TextStyle(
              fontSize: 38,
              fontWeight: FontWeight.w900,
              color: AppColors.textPrimary,
              letterSpacing: -1,
              height: 1.0,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Across all completed deliveries',
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              onPressed: () => context.push('/earnings/withdraw'),
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
                  Icon(Icons.account_balance_rounded, size: 18),
                  SizedBox(width: 8),
                  Text(
                    'Withdraw Funds',
                    style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Stat row
// ---------------------------------------------------------------------------

class _StatRow extends StatelessWidget {
  const _StatRow({required this.earnings, required this.ratings});
  final DriverEarnings earnings;
  final DriverRatingList? ratings;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: _StatCard(
            icon: Icons.account_balance_wallet_rounded,
            iconBg: AppColors.primaryContainer,
            iconColor: AppColors.primary,
            label: 'Balance',
            value: formatSen(earnings.balanceSen),
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: _StatCard(
            icon: Icons.star_rounded,
            iconBg: AppColors.warningContainer,
            iconColor: AppColors.warning,
            label: 'Ratings',
            value: '${ratings?.totalRatings ?? 0}',
            subtitle: 'total reviews',
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: _StatCard(
            icon: Icons.trending_up_rounded,
            iconBg: AppColors.successContainer,
            iconColor: AppColors.success,
            label: 'Avg Rating',
            value: ratings?.averageStars != null
                ? ratings!.averageStars!.toStringAsFixed(1)
                : '—',
            subtitle: 'out of 5',
          ),
        ),
      ],
    );
  }
}

class _StatCard extends StatelessWidget {
  final IconData icon;
  final Color iconBg;
  final Color iconColor;
  final String label;
  final String value;
  final String? subtitle;

  const _StatCard({
    required this.icon,
    required this.iconBg,
    required this.iconColor,
    required this.label,
    required this.value,
    this.subtitle,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
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
          if (subtitle != null) ...[
            const SizedBox(height: 2),
            Text(
              subtitle!,
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w500,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Period chips
// ---------------------------------------------------------------------------

class _PeriodChips extends StatelessWidget {
  const _PeriodChips({
    required this.period,
    required this.periods,
    required this.onChanged,
  });
  final String period;
  final List<String> periods;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 36,
      child: Row(
        children: [
          for (int i = 0; i < periods.length; i++) ...[
            if (i > 0) const SizedBox(width: 8),
            Expanded(
              child: _PeriodChip(
                label: periods[i],
                selected: period == periods[i],
                onTap: () {
                  HapticFeedback.selectionClick();
                  onChanged(periods[i]);
                },
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _PeriodChip extends StatelessWidget {
  const _PeriodChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 180),
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
          border: Border.all(
            color: selected ? AppColors.primary : AppColors.gray200,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: selected ? AppColors.white : AppColors.textSecondary,
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Recent trips
// ---------------------------------------------------------------------------

class _RecentTrips extends StatelessWidget {
  const _RecentTrips({required this.assignments});
  final List<DispatchAssignmentSummary> assignments;

  @override
  Widget build(BuildContext context) {
    if (assignments.isEmpty) {
      return Container(
        padding: const EdgeInsets.all(DesignTokens.spaceLg),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.gray200),
        ),
        child: Row(
          children: [
            SvgPicture.asset(
              'assets/illustrations/empty_earnings.svg',
              width: 48,
              height: 48,
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            const Expanded(
              child: Text(
                'No completed trips yet',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
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
          for (int i = 0; i < assignments.length; i++) ...[
            if (i > 0)
              const Divider(
                height: 1,
                thickness: 1,
                color: AppColors.gray100,
                indent: DesignTokens.spaceMd,
                endIndent: DesignTokens.spaceMd,
              ),
            _TripRow(assignment: assignments[i]),
          ],
        ],
      ),
    );
  }
}

class _TripRow extends StatelessWidget {
  const _TripRow({required this.assignment});
  final DispatchAssignmentSummary assignment;

  @override
  Widget build(BuildContext context) {
    return Padding(
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
        ],
      ),
    );
  }

  String _shortId(String id) => id.length > 8 ? id.substring(0, 8) : id;
}

// ---------------------------------------------------------------------------
// Section title
// ---------------------------------------------------------------------------

class _SectionTitle extends StatelessWidget {
  const _SectionTitle({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w800,
        color: AppColors.textPrimary,
        letterSpacing: -0.3,
      ),
    );
  }
}
