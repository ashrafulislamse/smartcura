import 'dart:async';

import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/background/health_sync.dart';
import '../../../../core/providers/health_connect_provider.dart';
import '../../../../core/providers/health_provider.dart';
import '../../../../core/providers/iot_provider.dart';
import '../../../../core/providers/notification_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/vital_metrics.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../iot/presentation/utils/iot_device_helpers.dart';

/// Patient Health Dashboard — redesigned as a single, scannable clinical view.
///
/// Hierarchy: patient status → critical alerts → current vitals → trends →
/// recent activity → connected devices. Each section uses real backend data.
/// The layout is intentionally mobile-first, accessible, and thumb-friendly.
class HealthScreen extends ConsumerStatefulWidget {
  const HealthScreen({super.key});

  @override
  ConsumerState<HealthScreen> createState() => _HealthScreenState();
}

class _HealthScreenState extends ConsumerState<HealthScreen>
    with WidgetsBindingObserver {
  Timer? _autoRefreshTimer;
  DateTime? _lastRefreshed;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _autoRefreshTimer = Timer.periodic(
      const Duration(seconds: 15),
      (_) => _autoRefresh(),
    );
  }

  void _autoRefresh() {
    ref.invalidate(vitalReadingsProvider);
    ref.invalidate(healthAlertsProvider);
    ref.invalidate(myDevicesProvider);
    if (mounted) setState(() => _lastRefreshed = DateTime.now());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _autoRefresh();
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _refreshAll() async {
    _autoRefresh();
    await Future<void>.delayed(const Duration(milliseconds: 400));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: _refreshAll,
          color: AppColors.primary,
          backgroundColor: AppColors.white,
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(
              parent: BouncingScrollPhysics(),
            ),
            slivers: [
              const SliverToBoxAdapter(child: _GreetingHeader()),
              const SliverToBoxAdapter(child: _CriticalAlertBanner()),
              SliverToBoxAdapter(child: _SyncFromWatchCard()),
              SliverToBoxAdapter(
                child: _HealthSummarySection(
                  lastRefreshed: _lastRefreshed,
                ),
              ),
              const SliverToBoxAdapter(child: _TrendsSection()),
              const SliverToBoxAdapter(child: _RecentActivitySection()),
              const SliverToBoxAdapter(child: _ConnectedDevicesSection()),
              SliverToBoxAdapter(
                child: SizedBox(
                  height: 220 + MediaQuery.of(context).padding.bottom,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Greeting header + notification bell
// ---------------------------------------------------------------------------

class _GreetingHeader extends ConsumerWidget {
  const _GreetingHeader();

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(currentProfileProvider);
    final notificationsAsync = ref.watch(
      notificationsProvider(
        const (category: null, unreadOnly: true),
      ),
    );
    final unreadCount = notificationsAsync.valueOrNull?.length ?? 0;
    final name = profile?.displayName ?? 'there';

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
        DesignTokens.spaceSm,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  '${_greeting()},',
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                    height: 1.2,
                  ),
                ),
                Text(
                  name,
                  style: const TextStyle(
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    letterSpacing: -0.4,
                    height: 1.2,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                const Text(
                  "Here's your health status",
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                    height: 1.3,
                  ),
                ),
              ],
            ),
          ),
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
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                border: Border.all(color: AppColors.border),
              ),
              child: Stack(
                alignment: Alignment.center,
                children: [
                  const Icon(
                    Icons.notifications_outlined,
                    color: AppColors.textPrimary,
                    size: 22,
                  ),
                  if (unreadCount > 0)
                    Positioned(
                      top: 8,
                      right: 8,
                      child: Container(
                        width: 10,
                        height: 10,
                        decoration: const BoxDecoration(
                          color: AppColors.error,
                          shape: BoxShape.circle,
                        ),
                      ),
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
// Critical alert banner — only shown when an active critical alert exists
// ---------------------------------------------------------------------------

class _CriticalAlertBanner extends ConsumerWidget {
  const _CriticalAlertBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alertsAsync = ref.watch(healthAlertsProvider);

    if (alertsAsync.isLoading) return const SizedBox.shrink();

    final critical = alertsAsync.valueOrNull
        ?.where(
          (a) =>
              a.severity == HealthAlertSeverity.critical &&
              (a.state == HealthAlertState.open ||
                  a.state == HealthAlertState.escalated),
        )
        .firstOrNull;

    if (critical == null) return const SizedBox.shrink();

    final label = vitalMetricLabel(critical.metric);
    final value = '${critical.observedValue.toStringAsFixed(0)}%';

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        DesignTokens.spaceSm,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
      ),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.errorContainer,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.error.withValues(alpha: 0.2)),
        ),
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppColors.error,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                    ),
                    child: const Icon(
                      Icons.warning_amber_rounded,
                      color: AppColors.white,
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
                              decoration: const BoxDecoration(
                                color: AppColors.error,
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 6),
                            const Text(
                              'Critical Alert',
                              style: TextStyle(
                                fontSize: 12,
                                fontWeight: FontWeight.w700,
                                color: AppColors.error,
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(
                          '$label is critically low',
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                            height: 1.2,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          '$value · Measured ${_formatTimeAgo(critical.observedAt)}',
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Icon(
                    Icons.air,
                    color: AppColors.error.withValues(alpha: 0.25),
                    size: 48,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                0,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
              ),
              child: Row(
                children: [
                  Expanded(
                    child: _AlertActionButton(
                      label: 'Get Help Now',
                      icon: Icons.phone_rounded,
                      backgroundColor: AppColors.error,
                      foregroundColor: AppColors.white,
                      onTap: () {
                        HapticFeedback.lightImpact();
                        context.push('/emergency-sos');
                      },
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Expanded(
                    child: _AlertActionButton(
                      label: 'View Details',
                      icon: Icons.arrow_forward_rounded,
                      backgroundColor: AppColors.white,
                      foregroundColor: AppColors.error,
                      borderColor: AppColors.error.withValues(alpha: 0.25),
                      onTap: () {
                        HapticFeedback.lightImpact();
                        context.push('/health');
                      },
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AlertActionButton extends StatelessWidget {
  final String label;
  final IconData icon;
  final Color backgroundColor;
  final Color foregroundColor;
  final Color? borderColor;
  final VoidCallback onTap;

  const _AlertActionButton({
    required this.label,
    required this.icon,
    required this.backgroundColor,
    required this.foregroundColor,
    required this.onTap,
    this.borderColor,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        height: 44,
        decoration: BoxDecoration(
          color: backgroundColor,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          border: borderColor != null ? Border.all(color: borderColor!) : null,
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(icon, color: foregroundColor, size: 18),
            const SizedBox(width: 6),
            Text(
              label,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: foregroundColor,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Health Summary — 2x2 vital card grid
// ---------------------------------------------------------------------------

class _HealthSummarySection extends ConsumerWidget {
  final DateTime? lastRefreshed;

  const _HealthSummarySection({this.lastRefreshed});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vitalsAsync = ref.watch(vitalReadingsProvider);
    final alertsAsync = ref.watch(healthAlertsProvider);
    final readings = vitalsAsync.valueOrNull ?? const <VitalReading>[];
    final alerts = alertsAsync.valueOrNull ?? const <HealthAlert>[];

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        0,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Health Summary',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              GestureDetector(
                onTap: () {
                  HapticFeedback.lightImpact();
                  context.push('/health/enter-vitals');
                },
                child: const Text(
                  'See All',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          if (vitalsAsync.isLoading)
            _buildShimmerGrid()
          else if (vitalsAsync.hasError)
            ErrorView(
              message: _errorMessage(vitalsAsync.error),
              onRetry: () => ref.invalidate(vitalReadingsProvider),
            )
          else
            _buildGrid(context, readings, alerts),
        ],
      ),
    );
  }

  Widget _buildShimmerGrid() {
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      mainAxisSpacing: DesignTokens.spaceMd,
      crossAxisSpacing: DesignTokens.spaceMd,
      childAspectRatio: 0.85,
      children: const [
        _SummaryCardSkeleton(),
        _SummaryCardSkeleton(),
        _SummaryCardSkeleton(),
        _SummaryCardSkeleton(),
      ],
    );
  }

  Widget _buildGrid(
    BuildContext context,
    List<VitalReading> readings,
    List<HealthAlert> alerts,
  ) {
    return GridView.count(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      crossAxisCount: 2,
      mainAxisSpacing: DesignTokens.spaceMd,
      crossAxisSpacing: DesignTokens.spaceMd,
      childAspectRatio: 0.85,
      children: [
        _VitalSummaryCard(
          metric: VitalMetric.heartRate,
          title: 'Heart Rate',
          subtitle: null,
          icon: Icons.favorite_rounded,
          iconColor: AppColors.heartRate,
          unit: 'BPM',
          readings: readings,
          alerts: alerts,
          onTap: () => context.push('/health/enter-vitals'),
        ),
        _VitalSummaryCard(
          metric: VitalMetric.oxygenSaturation,
          title: 'SpO₂',
          subtitle: null,
          icon: Icons.air_rounded,
          iconColor: AppColors.oxygen,
          unit: '%',
          readings: readings,
          alerts: alerts,
          onTap: () => context.push('/health/enter-vitals'),
        ),
        _VitalSummaryCard(
          metric: VitalMetric.bodyTemperature,
          title: 'Temperature',
          subtitle: 'Skin',
          icon: Icons.thermostat_rounded,
          iconColor: AppColors.temperature,
          unit: '°C',
          readings: readings,
          alerts: alerts,
          onTap: () => context.push('/health/enter-vitals'),
        ),
        _VitalSummaryCard(
          metric: VitalMetric.bloodPressure,
          title: 'Blood Pressure',
          subtitle: null,
          icon: Icons.water_drop_rounded,
          iconColor: AppColors.bloodPressure,
          unit: 'mmHg',
          readings: readings,
          alerts: alerts,
          onTap: () => context.push('/health/enter-vitals'),
        ),
      ],
    );
  }

  String _errorMessage(Object? error) {
    final s = error?.toString() ?? '';
    return s.isEmpty ? 'Could not load vitals.' : s;
  }
}

class _VitalSummaryCard extends StatelessWidget {
  final VitalMetric metric;
  final String title;
  final String? subtitle;
  final IconData icon;
  final Color iconColor;
  final String unit;
  final List<VitalReading> readings;
  final List<HealthAlert> alerts;
  final VoidCallback onTap;

  const _VitalSummaryCard({
    required this.metric,
    required this.title,
    this.subtitle,
    required this.icon,
    required this.iconColor,
    required this.unit,
    required this.readings,
    required this.alerts,
    required this.onTap,
  });

  VitalReading? _latestFor(VitalMetric m) {
    final filtered = readings.where((r) => r.metric == m).toList();
    if (filtered.isEmpty) return null;
    return filtered.reduce(
      (a, b) => a.recordedAt.compareTo(b.recordedAt) >= 0 ? a : b,
    );
  }

  VitalReading? get latest {
    if (metric == VitalMetric.bloodPressure) {
      return _latestFor(VitalMetric.systolicBp) ??
          _latestFor(VitalMetric.diastolicBp);
    }
    return _latestFor(metric);
  }

  String? get _bpDisplayValue {
    if (metric != VitalMetric.bloodPressure) return null;
    final sys = _latestFor(VitalMetric.systolicBp);
    final dia = _latestFor(VitalMetric.diastolicBp);
    if (sys == null || dia == null) return null;
    return '${sys.value.toInt()}/${dia.value.toInt()} $unit';
  }

  String? get _bpRecordedAt {
    if (metric != VitalMetric.bloodPressure) return null;
    final sys = _latestFor(VitalMetric.systolicBp);
    final dia = _latestFor(VitalMetric.diastolicBp);
    if (sys == null || dia == null) return null;
    return sys.recordedAt.compareTo(dia.recordedAt) >= 0
        ? sys.recordedAt
        : dia.recordedAt;
  }

  HealthAlert? get activeAlert {
    if (metric == VitalMetric.bloodPressure) {
      return alerts
          .where(
            (a) =>
                (a.metric == VitalMetric.systolicBp ||
                    a.metric == VitalMetric.diastolicBp) &&
                (a.state == HealthAlertState.open ||
                    a.state == HealthAlertState.escalated),
          )
          .firstOrNull;
    }
    return alerts
        .where(
          (a) =>
              a.metric == metric &&
              (a.state == HealthAlertState.open ||
                  a.state == HealthAlertState.escalated),
        )
        .firstOrNull;
  }

  _CardStatus get status {
    if (latest == null) return const _CardStatus.noData();
    return activeAlert?.severity.let(
          (s) => switch (s) {
            HealthAlertSeverity.critical =>
              const _CardStatus.critical('Critical'),
            HealthAlertSeverity.warning => const _CardStatus.warning('Warning'),
            _ => const _CardStatus.normal('Normal'),
          },
        ) ??
        const _CardStatus.normal('Normal');
  }

  String get sourceLabel {
    if (latest == null) return 'No device connected';
    return _deviceSourceLabel(metric);
  }

  @override
  Widget build(BuildContext context) {
    final latestReading = latest;
    final cardStatus = status;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.black.withValues(alpha: 0.03),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 36,
                  height: 36,
                  decoration: BoxDecoration(
                    color: iconColor.withValues(alpha: 0.10),
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  child: Icon(icon, color: iconColor, size: 20),
                ),
                const Spacer(),
                Icon(
                  Icons.chevron_right_rounded,
                  color: AppColors.gray300,
                  size: 20,
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(width: 4),
                  Text(
                    subtitle!,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      color: AppColors.gray400,
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: 8),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _bpDisplayValue ??
                        (latestReading != null
                            ? _formatValue(latestReading.value, unit)
                            : 'No Data'),
                    style: TextStyle(
                      fontSize: 28,
                      fontWeight: FontWeight.w800,
                      color: latestReading != null
                          ? AppColors.textPrimary
                          : AppColors.gray400,
                      height: 1.0,
                      letterSpacing: -0.5,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: cardStatus.backgroundColor,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                    child: Text(
                      cardStatus.label,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: cardStatus.foregroundColor,
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    latestReading != null
                        ? '${_formatTimeAgo(_bpRecordedAt ?? latestReading.recordedAt)} · $sourceLabel'
                        : sourceLabel,
                    style: TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      color: AppColors.gray400,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CardStatus {
  final String label;
  final Color backgroundColor;
  final Color foregroundColor;

  const _CardStatus.normal(this.label)
      : backgroundColor = AppColors.successContainer,
        foregroundColor = AppColors.successDark;

  const _CardStatus.warning(this.label)
      : backgroundColor = AppColors.warningContainer,
        foregroundColor = AppColors.warningDark;

  const _CardStatus.critical(this.label)
      : backgroundColor = AppColors.errorContainer,
        foregroundColor = AppColors.errorDark;

  const _CardStatus.noData()
      : label = 'No Data',
        backgroundColor = AppColors.gray100,
        foregroundColor = AppColors.gray500;
}

class _SummaryCardSkeleton extends StatelessWidget {
  const _SummaryCardSkeleton();

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: AppColors.gray200,
      highlightColor: AppColors.gray100,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Trends section — chart + time filters + metric dropdown
// ---------------------------------------------------------------------------

class _TrendsSection extends ConsumerStatefulWidget {
  const _TrendsSection();

  @override
  ConsumerState<_TrendsSection> createState() => _TrendsSectionState();
}

class _TrendsSectionState extends ConsumerState<_TrendsSection> {
  VitalMetric _selectedMetric = VitalMetric.bodyTemperature;
  int _days = 1;

  @override
  Widget build(BuildContext context) {
    final vitalsAsync =
        ref.watch(vitalReadingsByMetricProvider(_selectedMetric));
    final readings = vitalsAsync.valueOrNull ?? const <VitalReading>[];
    final filtered = _filterByDuration(readings, Duration(days: _days));

    final color = _metricColor(_selectedMetric);
    final latest = filtered.isNotEmpty
        ? filtered.reduce(
            (a, b) => a.recordedAt.compareTo(b.recordedAt) >= 0 ? a : b,
          )
        : null;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        0,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
      ),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.black.withValues(alpha: 0.03),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Trends',
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                _MetricDropdown(
                  value: _selectedMetric,
                  onChanged: (metric) {
                    if (metric != null) {
                      HapticFeedback.selectionClick();
                      setState(() => _selectedMetric = metric);
                    }
                  },
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${_metricName(_selectedMetric)} · Last ${_days == 1 ? '24 hours' : _days == 7 ? '7 days' : '30 days'}',
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            if (latest != null)
              Row(
                children: [
                  Text(
                    _formatValue(latest.value, latest.unit),
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      color: color,
                      height: 1.0,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.successContainer,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                    child: const Text(
                      'Normal',
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: AppColors.successDark,
                      ),
                    ),
                  ),
                ],
              ),
            const SizedBox(height: DesignTokens.spaceMd),
            _TimeFilterPills(
              selectedDays: _days,
              onChanged: (days) {
                HapticFeedback.selectionClick();
                setState(() => _days = days);
              },
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            if (vitalsAsync.isLoading)
              SizedBox(
                height: 180,
                child: Shimmer.fromColors(
                  baseColor: AppColors.gray200,
                  highlightColor: AppColors.gray100,
                  child: Container(
                    decoration: BoxDecoration(
                      color: AppColors.gray200,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                    ),
                  ),
                ),
              )
            else if (filtered.length < 2)
              SizedBox(
                height: 180,
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.show_chart_rounded,
                        color: AppColors.gray300,
                        size: 40,
                      ),
                      const SizedBox(height: 8),
                      Text(
                        'Not enough data for a trend',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          color: AppColors.gray400,
                        ),
                      ),
                    ],
                  ),
                ),
              )
            else
              _TrendChart(
                readings: filtered,
                lineColor: color,
                unit: _unitForMetric(_selectedMetric),
              ),
          ],
        ),
      ),
    );
  }

  List<VitalReading> _filterByDuration(
    List<VitalReading> readings,
    Duration duration,
  ) {
    final cutoff = DateTime.now().subtract(duration);
    return readings
        .where((r) => DateTime.parse(r.recordedAt).isAfter(cutoff))
        .toList();
  }
}

class _MetricDropdown extends StatelessWidget {
  final VitalMetric value;
  final ValueChanged<VitalMetric?> onChanged;

  const _MetricDropdown({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.gray100,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
      ),
      child: DropdownButtonHideUnderline(
        child: DropdownButton<VitalMetric>(
          value: value,
          isDense: true,
          icon: const Icon(
            Icons.keyboard_arrow_down_rounded,
            color: AppColors.textSecondary,
            size: 18,
          ),
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
          dropdownColor: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          items: const [
            DropdownMenuItem(
              value: VitalMetric.bodyTemperature,
              child: Text('Temperature'),
            ),
            DropdownMenuItem(
              value: VitalMetric.heartRate,
              child: Text('Heart Rate'),
            ),
            DropdownMenuItem(
              value: VitalMetric.oxygenSaturation,
              child: Text('SpO₂'),
            ),
            DropdownMenuItem(
              value: VitalMetric.bloodPressure,
              child: Text('Blood Pressure'),
            ),
          ],
          onChanged: onChanged,
        ),
      ),
    );
  }
}

class _TimeFilterPills extends StatelessWidget {
  final int selectedDays;
  final ValueChanged<int> onChanged;

  const _TimeFilterPills({
    required this.selectedDays,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _TimePill(
          label: '24H',
          selected: selectedDays == 1,
          onTap: () => onChanged(1),
        ),
        const SizedBox(width: 8),
        _TimePill(
          label: '7D',
          selected: selectedDays == 7,
          onTap: () => onChanged(7),
        ),
        const SizedBox(width: 8),
        _TimePill(
          label: '30D',
          selected: selectedDays == 30,
          onTap: () => onChanged(30),
        ),
      ],
    );
  }
}

class _TimePill extends StatelessWidget {
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _TimePill({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : AppColors.gray100,
          borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
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

class _TrendChart extends StatelessWidget {
  final List<VitalReading> readings;
  final Color lineColor;
  final String unit;

  const _TrendChart({
    required this.readings,
    required this.lineColor,
    required this.unit,
  });

  @override
  Widget build(BuildContext context) {
    final sorted = List<VitalReading>.from(readings)
      ..sort((a, b) =>
          DateTime.parse(a.recordedAt).compareTo(DateTime.parse(b.recordedAt)));
    final earliest = DateTime.parse(sorted.first.recordedAt);
    final latest = DateTime.parse(sorted.last.recordedAt);
    final span = latest.difference(earliest).inMilliseconds.toDouble();

    final spots = sorted.map((r) {
      final x = span <= 0
          ? 0.0
          : DateTime.parse(r.recordedAt)
                  .difference(earliest)
                  .inMilliseconds
                  .toDouble() /
              span;
      return FlSpot(x, r.value);
    }).toList();

    final values = sorted.map((r) => r.value).toList();
    final minY = values.reduce((a, b) => a < b ? a : b);
    final maxY = values.reduce((a, b) => a > b ? a : b);
    final padding = (maxY - minY) * 0.15;

    return SizedBox(
      height: 180,
      child: LineChart(
        LineChartData(
          minY: minY - padding,
          maxY: maxY + padding,
          minX: 0,
          maxX: 1,
          gridData: FlGridData(
            show: true,
            drawVerticalLine: false,
            horizontalInterval: _interval(minY - padding, maxY + padding),
            getDrawingHorizontalLine: (value) => const FlLine(
              color: AppColors.gray100,
              strokeWidth: 1,
            ),
          ),
          titlesData: FlTitlesData(
            leftTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            rightTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            topTitles: const AxisTitles(
              sideTitles: SideTitles(showTitles: false),
            ),
            bottomTitles: AxisTitles(
              sideTitles: SideTitles(
                showTitles: true,
                interval: 0.25,
                reservedSize: 24,
                getTitlesWidget: (value, meta) {
                  final dt = earliest.add(
                    Duration(milliseconds: (span * value).toInt()),
                  );
                  return Padding(
                    padding: const EdgeInsets.only(top: 8),
                    child: Text(
                      _formatTrendTime(dt, span),
                      style: const TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w500,
                        color: AppColors.gray400,
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          borderData: FlBorderData(show: false),
          lineBarsData: [
            LineChartBarData(
              spots: spots,
              isCurved: true,
              color: lineColor,
              barWidth: 2.5,
              isStrokeCapRound: true,
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(
                show: true,
                color: lineColor.withValues(alpha: 0.10),
              ),
            ),
          ],
          lineTouchData: LineTouchData(
            touchTooltipData: LineTouchTooltipData(
              getTooltipItems: (touchedSpots) {
                return touchedSpots.map((spot) {
                  final reading = sorted[spot.spotIndex];
                  return LineTooltipItem(
                    '${reading.value.toStringAsFixed(1)} $unit\n${_formatTimeAgo(reading.recordedAt)}',
                    const TextStyle(
                      color: AppColors.white,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  );
                }).toList();
              },
            ),
          ),
        ),
      ),
    );
  }

  double _interval(double minY, double maxY) {
    final range = maxY - minY;
    if (range <= 0) return 1;
    return range / 4;
  }

  String _formatTrendTime(DateTime dt, double spanMs) {
    if (spanMs <= Duration.hoursPerDay * 60 * 60 * 1000) {
      return DateFormat('HH:mm').format(dt);
    }
    return DateFormat('d MMM').format(dt);
  }
}

// ---------------------------------------------------------------------------
// Recent Activity section
// ---------------------------------------------------------------------------

class _RecentActivitySection extends ConsumerWidget {
  const _RecentActivitySection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vitalsAsync = ref.watch(vitalReadingsProvider);
    final readings = vitalsAsync.valueOrNull ?? const <VitalReading>[];
    final latest = readings.isNotEmpty
        ? readings.reduce(
            (a, b) => a.recordedAt.compareTo(b.recordedAt) >= 0 ? a : b,
          )
        : null;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        0,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Recent Activity',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          if (vitalsAsync.isLoading)
            Shimmer.fromColors(
              baseColor: AppColors.gray200,
              highlightColor: AppColors.gray100,
              child: Container(
                height: 64,
                decoration: BoxDecoration(
                  color: AppColors.white,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                ),
              ),
            )
          else if (latest != null)
            _ActivityTile(
              icon: Icons.watch_rounded,
              iconColor: AppColors.primary,
              iconBg: AppColors.primaryContainer,
              title: 'Vitals updated',
              subtitle: 'All connected vitals synced successfully',
              timeAgo: _formatTimeAgo(latest.recordedAt),
            )
          else
            _ActivityTile(
              icon: Icons.info_outline_rounded,
              iconColor: AppColors.gray400,
              iconBg: AppColors.gray100,
              title: 'No recent activity',
              subtitle: 'Connect a device to start tracking',
              timeAgo: '',
            ),
        ],
      ),
    );
  }
}

class _ActivityTile extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final String title;
  final String subtitle;
  final String timeAgo;

  const _ActivityTile({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.title,
    required this.subtitle,
    required this.timeAgo,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: iconBg,
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: Icon(icon, color: iconColor, size: 22),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          if (timeAgo.isNotEmpty)
            Text(
              timeAgo,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: AppColors.gray400,
              ),
            ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Connected Devices section
// ---------------------------------------------------------------------------

class _ConnectedDevicesSection extends ConsumerWidget {
  const _ConnectedDevicesSection();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final devicesAsync = ref.watch(myDevicesProvider);
    final devices = devicesAsync.valueOrNull ?? const <Device>[];

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        0,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Connected Devices',
                style: TextStyle(
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              GestureDetector(
                onTap: () {
                  HapticFeedback.lightImpact();
                  context.push('/iot/device-management');
                },
                child: const Text(
                  'Manage',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          if (devicesAsync.isLoading)
            Shimmer.fromColors(
              baseColor: AppColors.gray200,
              highlightColor: AppColors.gray100,
              child: Container(
                height: 80,
                decoration: BoxDecoration(
                  color: AppColors.white,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                ),
              ),
            )
          else if (devices.isEmpty)
            _ActivityTile(
              icon: Icons.bluetooth_searching_rounded,
              iconColor: AppColors.primary,
              iconBg: AppColors.primaryContainer,
              title: 'No devices connected',
              subtitle: 'Tap to pair your first device',
              timeAgo: '',
            )
          else
            Column(
              children: [
                for (final device in devices) ...[
                  _DeviceListTile(device: device),
                  if (device != devices.last)
                    const SizedBox(height: DesignTokens.spaceSm),
                ],
              ],
            ),
        ],
      ),
    );
  }
}

class _DeviceListTile extends StatelessWidget {
  final Device device;

  const _DeviceListTile({required this.device});

  @override
  Widget build(BuildContext context) {
    final (icon, color) = deviceIconAndColor(device.deviceType);
    final label = deviceTypeLabel(device.deviceType);
    final isPhone = device.deviceType == DeviceType.phone;

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: Icon(icon, color: color, size: 22),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  isPhone
                      ? 'Health Connect · sync to send readings'
                      : 'SN: ${device.serialNumber}',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: device.state == DeviceState.active
                  ? AppColors.successContainer
                  : AppColors.gray100,
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            ),
            child: Text(
              device.state == DeviceState.active ? 'Active' : 'Inactive',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w700,
                color: device.state == DeviceState.active
                    ? AppColors.successDark
                    : AppColors.gray500,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sync from Watch card (Health Connect)
// ---------------------------------------------------------------------------

class _SyncFromWatchCard extends ConsumerStatefulWidget {
  const _SyncFromWatchCard();

  @override
  ConsumerState<_SyncFromWatchCard> createState() => _SyncFromWatchCardState();
}

class _SyncFromWatchCardState extends ConsumerState<_SyncFromWatchCard> {
  DateTime? _lastSyncAt;

  @override
  void initState() {
    super.initState();
    _loadLastSync();
  }

  Future<void> _loadLastSync() async {
    final lastAt = await getLastBackgroundSyncAt();
    if (mounted) setState(() => _lastSyncAt = lastAt);
  }

  @override
  Widget build(BuildContext context) {
    final devicesAsync = ref.watch(myDevicesProvider);
    final syncState = ref.watch(healthConnectProvider);

    final devices = devicesAsync.valueOrNull ?? const <Device>[];
    final hasPhoneDevice = devices.any((d) => d.deviceType == DeviceType.phone);

    // Only render when a phone device is actually assigned. While loading we
    // keep the space empty to avoid a flash of "no device" content.
    if (!hasPhoneDevice) {
      return const SizedBox.shrink();
    }

    final lastSyncAt = syncState.lastSyncedAt ?? _lastSyncAt;
    final isBusy = syncState.isBusy;
    final isError = syncState.isError;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        0,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
      ),
      child: Container(
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: [
              Color(0xFF2563EB),
              Color(0xFF1D4ED8),
              Color(0xFF1E40AF),
            ],
          ),
          borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          boxShadow: [
            BoxShadow(
              color: AppColors.primary.withValues(alpha: 0.25),
              blurRadius: 24,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceLg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: Colors.white.withValues(alpha: 0.15),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      isBusy ? Icons.sync : Icons.watch_rounded,
                      color: Colors.white,
                      size: 24,
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceMd),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Sync from Watch',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            color: Colors.white,
                            letterSpacing: -0.3,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          isBusy
                              ? (syncState.message ??
                                  'Syncing with Health Connect...')
                              : 'Pull today\'s vitals from Google Health Connect',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                            color: Colors.white.withValues(alpha: 0.85),
                            height: 1.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
              if (isError && syncState.message != null) ...[
                const SizedBox(height: DesignTokens.spaceMd),
                Container(
                  padding: const EdgeInsets.all(DesignTokens.spaceMd),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.12),
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.error_outline_rounded,
                          color: Colors.white, size: 18),
                      const SizedBox(width: DesignTokens.spaceSm),
                      Expanded(
                        child: Text(
                          syncState.message!,
                          style: const TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: Colors.white,
                            height: 1.4,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: DesignTokens.spaceMd),
              SizedBox(
                width: double.infinity,
                height: 44,
                child: ElevatedButton(
                  onPressed: isBusy
                      ? null
                      : () {
                          HapticFeedback.mediumImpact();
                          ref
                              .read(healthConnectProvider.notifier)
                              .syncFromWatch();
                        },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.white,
                    foregroundColor: AppColors.primary,
                    disabledBackgroundColor:
                        Colors.white.withValues(alpha: 0.7),
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                    ),
                  ),
                  child: isBusy
                      ? const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            SizedBox(
                              width: 16,
                              height: 16,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                color: AppColors.primary,
                              ),
                            ),
                            SizedBox(width: 8),
                            Text(
                              'Syncing...',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ],
                        )
                      : const Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.download_rounded, size: 18),
                            SizedBox(width: 6),
                            Text(
                              'Sync Now',
                              style: TextStyle(
                                fontSize: 14,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                          ],
                        ),
                ),
              ),
              if (lastSyncAt != null) ...[
                const SizedBox(height: DesignTokens.spaceSm),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(
                      Icons.check_circle_outline_rounded,
                      size: 14,
                      color: Colors.white.withValues(alpha: 0.7),
                    ),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        'Last sync ${_formatTimeAgo(lastSyncAt.toIso8601String())}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: Colors.white.withValues(alpha: 0.7),
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

String _displayUnit(String unit) {
  return switch (unit) {
    'Cel' => '°C',
    'mm[Hg]' => 'mmHg',
    '/min' => 'BPM',
    'count' => '',
    _ => unit,
  };
}

String _formatValue(double value, String unit) {
  final displayUnit = _displayUnit(unit);
  if (displayUnit.isEmpty) {
    return value == value.toInt()
        ? value.toInt().toString()
        : value.toStringAsFixed(1);
  }
  if (value == value.toInt()) {
    return '${value.toInt()}${displayUnit == '%' || displayUnit == '°C' ? '' : ' '}$displayUnit';
  }
  return '${value.toStringAsFixed(1)}${displayUnit == '%' || displayUnit == '°C' ? '' : ' '}$displayUnit';
}

String _formatTimeAgo(String isoTimestamp) {
  try {
    final dt = DateTime.parse(isoTimestamp).toLocal();
    final now = DateTime.now();
    final diff = now.difference(dt);
    if (diff.inSeconds < 60) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes} min ago';
    if (diff.inHours < 24) return '${diff.inHours} hr ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return DateFormat('d MMM').format(dt);
  } catch (_) {
    return '—';
  }
}

String _deviceSourceLabel(VitalMetric metric) {
  return switch (metric) {
    VitalMetric.heartRate => 'Wearable',
    VitalMetric.oxygenSaturation => 'Pulse Oximeter',
    VitalMetric.bodyTemperature => 'Temp Sensor',
    VitalMetric.systolicBp ||
    VitalMetric.diastolicBp ||
    VitalMetric.bloodPressure =>
      'BP Monitor',
    VitalMetric.respiratoryRate => 'Respiratory Monitor',
    VitalMetric.ecgVoltage => 'ECG',
    VitalMetric.bloodGlucose => 'Glucometer',
    VitalMetric.bodyWeight => 'Scale',
    _ => 'Device',
  };
}

Color _metricColor(VitalMetric metric) {
  return switch (metric) {
    VitalMetric.heartRate => AppColors.heartRate,
    VitalMetric.oxygenSaturation => AppColors.oxygen,
    VitalMetric.bodyTemperature => AppColors.temperature,
    VitalMetric.systolicBp ||
    VitalMetric.diastolicBp ||
    VitalMetric.bloodPressure =>
      AppColors.bloodPressure,
    _ => AppColors.primary,
  };
}

String _metricName(VitalMetric metric) {
  return switch (metric) {
    VitalMetric.heartRate => 'Heart Rate',
    VitalMetric.oxygenSaturation => 'SpO₂',
    VitalMetric.bodyTemperature => 'Temperature',
    VitalMetric.systolicBp ||
    VitalMetric.diastolicBp ||
    VitalMetric.bloodPressure =>
      'Blood Pressure',
    _ => 'Vitals',
  };
}

String _unitForMetric(VitalMetric metric) {
  return switch (metric) {
    VitalMetric.heartRate => '/min',
    VitalMetric.oxygenSaturation => '%',
    VitalMetric.bodyTemperature => '°C',
    VitalMetric.systolicBp ||
    VitalMetric.diastolicBp ||
    VitalMetric.bloodPressure =>
      'mmHg',
    _ => '',
  };
}

extension _NullableLet<T> on T? {
  R? let<R>(R Function(T) f) => this == null ? null : f(this as T);
}
