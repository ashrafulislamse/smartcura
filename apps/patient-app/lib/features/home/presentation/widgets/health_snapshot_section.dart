import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/health_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/state_view.dart';

/// "Your Health" — a compact four-vital snapshot.
///
/// One white card with four cells (heart rate, SpO2, temperature, blood
/// pressure), each showing the latest reading and a status chip derived
/// from open health alerts. No readings: "--" + "No data"; the whole list
/// empty renders an [EmptyView]; failures render an [ErrorView] with retry.
///
/// Alerts are secondary decoration here — the Health Status card above is
/// the authoritative alert surface — so an alerts fetch failure degrades to
/// "no alerts" rather than hiding the vitals.
class HealthSnapshotSection extends ConsumerWidget {
  const HealthSnapshotSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final readingsAsync = ref.watch(vitalReadingsProvider);
    final alertsAsync = ref.watch(healthAlertsProvider);

    final openAlerts = alertsAsync.valueOrNull?.where(_isOpen).toList() ?? [];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'YOUR HEALTH',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  letterSpacing: 0.6,
                ),
              ),
              TextButton(
                onPressed: () => context.go('/health'),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: const Size(0, 32),
                ),
                child: const Text(
                  'View health trends',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: DesignTokens.spaceXs),
        readingsAsync.when(
          loading: _buildShimmer,
          error: (error, _) => Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceMd,
            ),
            child: ErrorView(
              message: _errorMessage(error, 'Could not load vitals'),
              onRetry: () => ref.invalidate(vitalReadingsProvider),
            ),
          ),
          data: (readings) {
            if (readings.isEmpty) {
              return Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: DesignTokens.spaceMd,
                ),
                child: const EmptyView(
                  title: 'No readings yet',
                  body:
                      'Connect a device or add a reading manually to see your vitals here.',
                  icon: Icons.monitor_heart_outlined,
                ),
              );
            }
            return _buildCard(context, readings, openAlerts);
          },
        ),
      ],
    );
  }

  static bool _isOpen(HealthAlert a) =>
      a.state == HealthAlertState.open || a.state == HealthAlertState.escalated;

  Widget _buildCard(
    BuildContext context,
    List<VitalReading> readings,
    List<HealthAlert> openAlerts,
  ) {
    final byMetric = <VitalMetric, VitalReading>{};
    for (final r in readings) {
      final existing = byMetric[r.metric];
      if (existing == null || _isLater(r.recordedAt, existing.recordedAt)) {
        byMetric[r.metric] = r;
      }
    }

    final heartRate = byMetric[VitalMetric.heartRate];
    final spo2 = byMetric[VitalMetric.oxygenSaturation];
    final temperature = byMetric[VitalMetric.bodyTemperature];
    final systolic = byMetric[VitalMetric.systolicBp];
    final diastolic = byMetric[VitalMetric.diastolicBp];
    const bpAlertMetrics = {
      VitalMetric.systolicBp,
      VitalMetric.diastolicBp,
      VitalMetric.bloodPressure,
    };

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceXs,
          vertical: DesignTokens.spaceMd,
        ),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          border: Border.all(color: AppColors.gray200),
          boxShadow: [
            BoxShadow(
              color: AppColors.black.withValues(alpha: 0.04),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: IntrinsicHeight(
          child: Row(
            children: [
              Expanded(
                child: _VitalCell(
                  icon: Icons.favorite_rounded,
                  color: AppColors.heartRate,
                  label: 'Heart Rate',
                  value: heartRate == null
                      ? '--'
                      : heartRate.value.toStringAsFixed(0),
                  unit: heartRate?.unit ?? 'bpm',
                  status: _statusFor(
                      heartRate, openAlerts, const {VitalMetric.heartRate}),
                ),
              ),
              const _CellDivider(),
              Expanded(
                child: _VitalCell(
                  icon: Icons.water_drop_rounded,
                  color: AppColors.oxygen,
                  label: 'SpO2',
                  value: spo2 == null ? '--' : spo2.value.toStringAsFixed(0),
                  unit: spo2?.unit ?? '%',
                  status: _statusFor(
                      spo2, openAlerts, const {VitalMetric.oxygenSaturation}),
                ),
              ),
              const _CellDivider(),
              Expanded(
                child: _VitalCell(
                  icon: Icons.thermostat_rounded,
                  color: AppColors.temperature,
                  label: 'Temp',
                  value: temperature == null
                      ? '--'
                      : temperature.value.toStringAsFixed(1),
                  unit: temperature?.unit ?? '°C',
                  status: _statusFor(temperature, openAlerts,
                      const {VitalMetric.bodyTemperature}),
                ),
              ),
              const _CellDivider(),
              Expanded(
                child: _VitalCell(
                  icon: Icons.bloodtype_rounded,
                  color: AppColors.bloodPressure,
                  label: 'Blood Pressure',
                  value: _bpValue(systolic, diastolic),
                  unit: 'mmHg',
                  status: _statusFor(
                    systolic ?? diastolic,
                    openAlerts,
                    bpAlertMetrics,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _bpValue(VitalReading? systolic, VitalReading? diastolic) {
    if (systolic == null && diastolic == null) return '--';
    final sys = systolic?.value.toStringAsFixed(0) ?? '--';
    final dia = diastolic?.value.toStringAsFixed(0) ?? '--';
    return '$sys/$dia';
  }

  static _CellStatus _statusFor(
    VitalReading? reading,
    List<HealthAlert> openAlerts,
    Set<VitalMetric> metrics,
  ) {
    final alert = openAlerts.where((a) => metrics.contains(a.metric)).toList();
    if (alert.isNotEmpty) {
      final hasCritical =
          alert.any((a) => a.severity == HealthAlertSeverity.critical);
      return hasCritical
          ? const _CellStatus('Urgent', AppColors.emergency)
          : const _CellStatus('Attention', AppColors.warning);
    }
    if (reading == null) {
      return const _CellStatus('No data', AppColors.gray400);
    }
    return const _CellStatus('Normal', AppColors.success);
  }

  static bool _isLater(String iso, String otherIso) {
    final a = DateTime.tryParse(iso);
    final b = DateTime.tryParse(otherIso);
    if (a == null || b == null) return false;
    return a.isAfter(b);
  }

  String _errorMessage(Object? error, String fallback) {
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return fallback;
  }

  Widget _buildShimmer() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Shimmer.fromColors(
        baseColor: AppColors.gray200,
        highlightColor: AppColors.gray100,
        child: Container(
          height: 128,
          decoration: BoxDecoration(
            color: AppColors.gray200,
            borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          ),
        ),
      ),
    );
  }
}

class _CellStatus {
  final String label;
  final Color color;

  const _CellStatus(this.label, this.color);
}

class _CellDivider extends StatelessWidget {
  const _CellDivider();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 1,
      color: AppColors.gray200,
      margin: const EdgeInsets.symmetric(vertical: 4),
    );
  }
}

class _VitalCell extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String label;
  final String value;
  final String unit;
  final _CellStatus status;

  const _VitalCell({
    required this.icon,
    required this.color,
    required this.label,
    required this.value,
    required this.unit,
    required this.status,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, color: color, size: 18),
        const SizedBox(height: 6),
        Text(
          label,
          style: const TextStyle(
            fontSize: 10,
            fontWeight: FontWeight.w700,
            color: AppColors.textSecondary,
          ),
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 4),
        Text(
          value,
          style: const TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w900,
            color: AppColors.textPrimary,
            height: 1.1,
            letterSpacing: -0.3,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
        const SizedBox(height: 1),
        Text(
          unit,
          style: const TextStyle(
            fontSize: 9,
            fontWeight: FontWeight.w600,
            color: AppColors.textDisabled,
          ),
          maxLines: 1,
        ),
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
          decoration: BoxDecoration(
            color: status.color.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(20),
          ),
          child: Text(
            status.label,
            style: TextStyle(
              fontSize: 9,
              fontWeight: FontWeight.w800,
              color: status.color,
            ),
          ),
        ),
      ],
    );
  }
}
