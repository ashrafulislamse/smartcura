import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/earnings_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Doctor earnings screen, wired to [earningsProvider].
///
/// The data layer ([earningsProvider]) was fully built but had no dedicated UI —
/// only a single StatCard on the dashboard and profile showed the balance or
/// total. This screen shows the current balance, total earned, and a paginated
/// list of payout items with their gross, platform fee, net, status, and
/// period.
///
/// Money is integer sen from the server; formatted at the display boundary only
/// via [_formatSen]. The server sends one page; `page.hasMore` indicates whether
/// more exist, but no cursor pagination control is surfaced yet.
class DoctorEarningsScreen extends ConsumerStatefulWidget {
  const DoctorEarningsScreen({super.key});

  @override
  ConsumerState<DoctorEarningsScreen> createState() =>
      _DoctorEarningsScreenState();
}

class _DoctorEarningsScreenState extends ConsumerState<DoctorEarningsScreen> {
  Future<void> _onRefresh() async {
    ref.invalidate(earningsProvider);
    await ref.read(earningsProvider.future);
  }

  String _formatSen(int sen) {
    final ringgit = sen / 100;
    return 'RM ${ringgit.toStringAsFixed(2)}';
  }

  String _formatDate(String iso) {
    final dt = DateTime.tryParse(iso);
    if (dt == null) return '—';
    return DateFormat('d MMM yyyy').format(dt);
  }

  String _formatPeriod(String start, String end) {
    final s = DateTime.tryParse(start);
    final e = DateTime.tryParse(end);
    if (s == null || e == null) return '—';
    return '${DateFormat('d MMM').format(s)} – ${DateFormat('d MMM yyyy').format(e)}';
  }

  StatusBadgeTone _itemStatusTone(PayoutItemStatus status) => switch (status) {
        PayoutItemStatus.paid => StatusBadgeTone.success,
        PayoutItemStatus.pending => StatusBadgeTone.warning,
        PayoutItemStatus.failed => StatusBadgeTone.error,
        PayoutItemStatus.cancelled => StatusBadgeTone.neutral,
        PayoutItemStatus.unknown => StatusBadgeTone.neutral,
      };

  String _itemStatusLabel(PayoutItemStatus status) => switch (status) {
        PayoutItemStatus.paid => 'Paid',
        PayoutItemStatus.pending => 'Pending',
        PayoutItemStatus.failed => 'Failed',
        PayoutItemStatus.cancelled => 'Cancelled',
        PayoutItemStatus.unknown => 'Unknown',
      };

  @override
  Widget build(BuildContext context) {
    final earningsAsync = ref.watch(earningsProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Earnings'),
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
      body: earningsAsync.when(
        loading: () => const LoadingOverlay(label: 'Loading earnings…'),
        error: (error, _) {
          final apiError = error is ApiError ? error : toApiError(error);
          return ErrorView(
            message: apiError.displayMessage,
            onRetry: apiError.isForbidden ? null : _onRefresh,
            isForbidden: apiError.isForbidden,
          );
        },
        data: (earnings) {
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
                  // Balance + total stat cards
                  _buildStatCards(earnings),
                  const SizedBox(height: DesignTokens.spaceMd),

                  // Payout history
                  if (earnings.data.isEmpty) ...[
                    SizedBox(
                      height: MediaQuery.of(context).size.height * 0.3,
                      child: const EmptyView(
                        title: 'No payouts yet',
                        body:
                            'Your payout history will appear here once earnings are processed.',
                        icon: Icons.account_balance_wallet_outlined,
                      ),
                    ),
                  ] else ...[
                    _sectionTitle('Payout history'),
                    if (earnings.page.hasMore)
                      Padding(
                        padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
                        child: Text(
                          'Showing the first page. More payouts are available.',
                          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                                color: AppColors.gray500,
                              ),
                        ),
                      ),
                    const SizedBox(height: DesignTokens.spaceSm),
                    ...earnings.data.map((item) => _PayoutCard(
                          item: item,
                          formatSen: _formatSen,
                          formatDate: _formatDate,
                          formatPeriod: _formatPeriod,
                          statusTone: _itemStatusTone,
                          statusLabel: _itemStatusLabel,
                        )),
                  ],
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildStatCards(DoctorEarnings earnings) {
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      mainAxisSpacing: DesignTokens.spaceMd,
      crossAxisSpacing: DesignTokens.spaceMd,
      childAspectRatio: 1.4,
      children: [
        StatCard(
          icon: Icons.account_balance_wallet_rounded,
          label: 'Current Balance',
          value: _formatSen(earnings.balanceSen),
          subtitle: earnings.currency,
          tone: StatTone.primary,
        ),
        StatCard(
          icon: Icons.trending_up_rounded,
          label: 'Total Earned',
          value: _formatSen(earnings.totalEarnedSen),
          subtitle: 'All time',
          tone: StatTone.success,
        ),
      ],
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

class _PayoutCard extends StatelessWidget {
  final DoctorPayoutItem item;
  final String Function(int) formatSen;
  final String Function(String) formatDate;
  final String Function(String, String) formatPeriod;
  final StatusBadgeTone Function(PayoutItemStatus) statusTone;
  final String Function(PayoutItemStatus) statusLabel;

  const _PayoutCard({
    required this.item,
    required this.formatSen,
    required this.formatDate,
    required this.formatPeriod,
    required this.statusTone,
    required this.statusLabel,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      child: PremiumCard(
        accent: _accentFor(item.status),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    formatPeriod(item.periodStart, item.periodEnd),
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          color: AppColors.gray900,
                        ),
                  ),
                ),
                StatusBadge(
                  label: statusLabel(item.status),
                  tone: statusTone(item.status),
                ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            _MoneyRow(
              label: 'Gross',
              value: formatSen(item.grossSen),
              color: AppColors.gray700,
            ),
            const SizedBox(height: 4),
            _MoneyRow(
              label: 'Platform fee',
              value: '- ${formatSen(item.platformFeeSen)}',
              color: AppColors.gray500,
            ),
            const Divider(height: DesignTokens.spaceMd),
            _MoneyRow(
              label: 'Net',
              value: formatSen(item.netSen),
              color: AppColors.gray900,
              bold: true,
            ),
            const SizedBox(height: DesignTokens.spaceXs),
            Text(
              'Created ${formatDate(item.createdAt)}',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: AppColors.gray500,
                  ),
            ),
          ],
        ),
      ),
    );
  }

  Color _accentFor(PayoutItemStatus status) {
    return switch (status) {
      PayoutItemStatus.paid => AppColors.secondary,
      PayoutItemStatus.pending => AppColors.warning,
      PayoutItemStatus.failed => AppColors.error,
      PayoutItemStatus.cancelled => AppColors.gray400,
      PayoutItemStatus.unknown => AppColors.gray300,
    };
  }
}

class _MoneyRow extends StatelessWidget {
  final String label;
  final String value;
  final Color color;
  final bool bold;

  const _MoneyRow({
    required this.label,
    required this.value,
    required this.color,
    this.bold = false,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: AppColors.gray500,
              ),
        ),
        const Spacer(),
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 15,
            fontWeight: bold ? FontWeight.w800 : FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
