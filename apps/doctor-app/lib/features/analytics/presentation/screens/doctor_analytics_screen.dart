import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/analytics_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Doctor analytics screen, wired to [analyticsProvider].
///
/// The data layer ([analyticsProvider]) was fully built but had no UI — analytics
/// data was not surfaced anywhere. This screen shows the appointment status
/// breakdown, patient count trend, rating summary, and monthly earnings
/// projection. The server returns its default date window when no range is
/// supplied.
///
/// Note: `AppointmentStatusCount.status` is typed as a bare `String` in the
/// contract (not an enum), so values are humanised from wire format at the
/// display boundary. The known vocabulary is: `pending_payment`, `confirmed`,
/// `checked_in`, `in_progress`, `cancelled`, `completed`, `no_show`,
/// `rescheduled`.
class DoctorAnalyticsScreen extends ConsumerStatefulWidget {
  const DoctorAnalyticsScreen({super.key});

  @override
  ConsumerState<DoctorAnalyticsScreen> createState() =>
      _DoctorAnalyticsScreenState();
}

class _DoctorAnalyticsScreenState extends ConsumerState<DoctorAnalyticsScreen> {
  Future<void> _onRefresh() async {
    ref.invalidate(analyticsProvider(null));
    await ref.read(analyticsProvider(null).future);
  }

  String _formatSen(int sen) {
    final ringgit = sen / 100;
    return 'RM ${ringgit.toStringAsFixed(2)}';
  }

  String _humanise(String wire) {
    return wire
        .split('_')
        .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
        .join(' ');
  }

  StatusBadgeTone _statusTone(String wire) {
    switch (wire) {
      case 'completed':
        return StatusBadgeTone.success;
      case 'cancelled':
      case 'no_show':
        return StatusBadgeTone.error;
      case 'pending_payment':
      case 'checked_in':
        return StatusBadgeTone.warning;
      case 'in_progress':
        return StatusBadgeTone.primary;
      case 'confirmed':
      case 'rescheduled':
        return StatusBadgeTone.info;
      default:
        return StatusBadgeTone.neutral;
    }
  }

  String _formatPeriod(String start, String end) {
    try {
      final s = DateTime.parse(start);
      final e = DateTime.parse(end);
      return '${s.day}/${s.month} – ${e.day}/${e.month}/${e.year}';
    } catch (_) {
      return '—';
    }
  }

  @override
  Widget build(BuildContext context) {
    final analyticsAsync = ref.watch(analyticsProvider(null));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Analytics'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _onRefresh,
          ),
        ],
      ),
      body: analyticsAsync.when(
        loading: () => const LoadingOverlay(label: 'Loading analytics…'),
        error: (error, _) {
          final apiError = error is ApiError ? error : toApiError(error);
          return ErrorView(
            message: apiError.displayMessage,
            onRetry: apiError.isForbidden ? null : _onRefresh,
            isForbidden: apiError.isForbidden,
          );
        },
        data: (response) {
          final groups = response.data;
          if (_isEmpty(groups)) {
            return const EmptyView(
              title: 'No analytics yet',
              body:
                  'Your performance insights will appear here once you have patient activity.',
              icon: Icons.bar_chart_outlined,
            );
          }
          return RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _onRefresh,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              padding: const EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                120,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildStatRow(groups),
                  const SizedBox(height: DesignTokens.spaceMd),

                  // Appointment status breakdown
                  if (groups.appointmentStatusBreakdown != null &&
                      groups.appointmentStatusBreakdown!.isNotEmpty) ...[
                    _sectionTitle('Appointment status breakdown'),
                    const SizedBox(height: DesignTokens.spaceSm),
                    ...groups.appointmentStatusBreakdown!.map(
                      (item) => _StatusRow(
                        label: _humanise(item.status),
                        count: item.count,
                        tone: _statusTone(item.status),
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                  ],

                  // Patient count trend
                  if (groups.patientCountTrend != null &&
                      groups.patientCountTrend!.isNotEmpty) ...[
                    _sectionTitle('Patient count trend'),
                    const SizedBox(height: DesignTokens.spaceSm),
                    ...groups.patientCountTrend!.map(
                      (item) => _TrendRow(
                        period:
                            _formatPeriod(item.periodStart, item.periodEnd),
                        count: item.count,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                  ],

                  // Readable groups (server-provided summary labels)
                  if (response.readableGroups.isNotEmpty) ...[
                    _sectionTitle('Summary'),
                    const SizedBox(height: DesignTokens.spaceSm),
                    ...response.readableGroups.map(
                      (label) => Padding(
                        padding: const EdgeInsets.only(bottom: 4),
                        child: Row(
                          children: [
                            Icon(Icons.check_circle_outline_rounded,
                                size: 16, color: AppColors.secondary),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                label,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodyMedium
                                    ?.copyWith(color: AppColors.gray700),
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
          );
        },
      ),
    );
  }

  bool _isEmpty(DoctorAnalyticsGroups g) {
    return (g.appointmentStatusBreakdown == null ||
            g.appointmentStatusBreakdown!.isEmpty) &&
        (g.patientCountTrend == null || g.patientCountTrend!.isEmpty) &&
        g.ratingSummary == null &&
        g.monthlyEarningsProjection == null;
  }

  Widget _buildStatRow(DoctorAnalyticsGroups groups) {
    final cards = <Widget>[];

    if (groups.ratingSummary != null) {
      cards.add(
        StatCard(
          icon: Icons.star_rounded,
          label: 'Rating',
          value: groups.ratingSummary!.ratingAverage.toStringAsFixed(1),
          subtitle: '${groups.ratingSummary!.reviewCount} reviews',
          tone: StatTone.warning,
        ),
      );
    }

    if (groups.monthlyEarningsProjection != null) {
      cards.add(
        StatCard(
          icon: Icons.account_balance_wallet_rounded,
          label: 'Projected',
          value: _formatSen(groups.monthlyEarningsProjection!.projectedSen),
          subtitle:
              '${groups.monthlyEarningsProjection!.basisCount} appointments basis',
          tone: StatTone.success,
        ),
      );
    }

    if (groups.appointmentStatusBreakdown != null) {
      final total = groups.appointmentStatusBreakdown!
          .fold(0, (sum, item) => sum + item.count);
      cards.add(
        StatCard(
          icon: Icons.event_note_rounded,
          label: 'Appointments',
          value: '$total',
          subtitle: 'In this period',
          tone: StatTone.primary,
        ),
      );
    }

    if (groups.patientCountTrend != null) {
      final totalPatients = groups.patientCountTrend!
          .fold(0, (sum, item) => sum + item.count);
      cards.add(
        StatCard(
          icon: Icons.group_outlined,
          label: 'Patients',
          value: '$totalPatients',
          subtitle: 'Across all periods',
          tone: StatTone.info,
        ),
      );
    }

    if (cards.isEmpty) return const SizedBox.shrink();

    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      mainAxisSpacing: DesignTokens.spaceMd,
      crossAxisSpacing: DesignTokens.spaceMd,
      childAspectRatio: 1.4,
      children: cards,
    );
  }

  Widget _sectionTitle(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 17,
        fontWeight: FontWeight.w800,
        color: AppColors.gray900,
        letterSpacing: -0.3,
      ),
    );
  }
}

class _StatusRow extends StatelessWidget {
  final String label;
  final int count;
  final StatusBadgeTone tone;

  const _StatusRow({
    required this.label,
    required this.count,
    required this.tone,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      child: Row(
        children: [
          StatusBadge(label: label, tone: tone),
          const Spacer(),
          Text(
            '$count',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
          ),
        ],
      ),
    );
  }
}

class _TrendRow extends StatelessWidget {
  final String period;
  final int count;

  const _TrendRow({required this.period, required this.count});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      child: PremiumCard(
        accent: AppColors.secondary,
        child: Row(
          children: [
            Icon(Icons.group_outlined,
                size: DesignTokens.iconSm, color: AppColors.gray600),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                period,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppColors.gray600,
                    ),
              ),
            ),
            Text(
              '$count patients',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.gray900,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}
