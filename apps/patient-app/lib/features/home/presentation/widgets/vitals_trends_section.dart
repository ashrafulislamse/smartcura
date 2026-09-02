import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/health_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/state_view.dart';
import '../components/vital_card.dart';

/// Vitals trends section — shows the latest vital readings from real data.
///
/// Watches [vitalReadingsProvider], groups readings by metric, and renders
/// [VitalCard]s for heart rate (HR), blood pressure (BP), and body
/// temperature with sparkline trends derived from recent readings.
class VitalsTrendsSection extends ConsumerWidget {
  const VitalsTrendsSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vitalsAsync = ref.watch(vitalReadingsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          child: Text(
            'Vitals at a Glance',
            style: TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              letterSpacing: -0.3,
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        vitalsAsync.when(
          loading: () => _buildShimmer(),
          error: (error, _) => Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
            child: ErrorView(
              message: _errorMessage(error),
              onRetry: () => ref.invalidate(vitalReadingsProvider),
            ),
          ),
          data: (readings) {
            if (readings.isEmpty) {
              return Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceMd),
                child: const EmptyView(
                  title: 'No vitals recorded yet',
                  body:
                      'Connect a device or sync health data from Health Connect to see trends here.',
                  icon: Icons.monitor_heart_outlined,
                ),
              );
            }

            final byMetric = <VitalMetric, List<VitalReading>>{};
            for (final r in readings) {
              byMetric.putIfAbsent(r.metric, () => []).add(r);
            }
            for (final list in byMetric.values) {
              list.sort((a, b) => a.recordedAt.compareTo(b.recordedAt));
            }

            List<double> _sparkline(VitalMetric? metric) {
              if (metric == null) return [];
              final list = byMetric[metric];
              if (list == null || list.isEmpty) return [];
              final recent =
                  list.length > 10 ? list.sublist(list.length - 10) : list;
              return recent.map((r) => r.value).toList();
            }

            VitalReading? _latest(VitalMetric? metric) {
              if (metric == null) return null;
              final list = byMetric[metric];
              if (list == null || list.isEmpty) return null;
              return list.last;
            }

            final hrLatest = _latest(VitalMetric.heartRate);
            final sysLatest = _latest(VitalMetric.systolicBp);
            final diaLatest = _latest(VitalMetric.diastolicBp);
            final tempLatest = _latest(VitalMetric.bodyTemperature);

            return Padding(
              padding:
                  const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
              child: Column(
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: VitalCard(
                          icon: Icons.favorite,
                          label: 'HR',
                          value: hrLatest != null
                              ? hrLatest.value.toStringAsFixed(0)
                              : '--',
                          unit: hrLatest?.unit ?? 'bpm',
                          color: AppColors.heartRate,
                          badge: hrLatest != null ? 'Latest' : null,
                          sparklineData: _sparkline(VitalMetric.heartRate),
                        ),
                      ),
                      const SizedBox(width: DesignTokens.spaceSm),
                      Expanded(
                        child: VitalCard(
                          icon: Icons.water_drop,
                          label: 'BP',
                          value: sysLatest != null
                              ? sysLatest.value.toStringAsFixed(0)
                              : '--',
                          unit: diaLatest != null
                              ? '/${diaLatest.value.toStringAsFixed(0)}'
                              : '/--',
                          color: AppColors.bloodPressure,
                          sparklineData: _sparkline(VitalMetric.systolicBp),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: DesignTokens.spaceSm),
                  _buildTemperatureCard(
                    tempLatest,
                    _sparkline(VitalMetric.bodyTemperature),
                  ),
                ],
              ),
            );
          },
        ),
      ],
    );
  }

  Widget _buildTemperatureCard(VitalReading? latest, List<double> sparkline) {
    final hasData = latest != null;
    final baseColor = AppColors.temperature;

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.thermostat, color: baseColor, size: 18),
                    const SizedBox(width: 6),
                    const Text(
                      'Temperature',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      hasData ? latest.value.toStringAsFixed(1) : '--',
                      style: const TextStyle(
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                        color: AppColors.textPrimary,
                        height: 1,
                        letterSpacing: -0.5,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Text(
                      hasData ? latest.unit : '°F',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          SizedBox(
            width: 96,
            height: 40,
            child: CustomPaint(
              size: const Size(96, 40),
              painter: _TempSparklinePainter(
                data: hasData ? sparkline : [0.0, 0.0],
                color: hasData ? baseColor : AppColors.gray300,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildShimmer() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Shimmer.fromColors(
        baseColor: AppColors.gray200,
        highlightColor: AppColors.gray100,
        child: Column(
          children: [
            Row(
              children: [
                Expanded(
                  child: Container(
                    height: 120,
                    decoration: BoxDecoration(
                      color: AppColors.gray200,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                    ),
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
                Expanded(
                  child: Container(
                    height: 120,
                    decoration: BoxDecoration(
                      color: AppColors.gray200,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Container(
              height: 80,
              decoration: BoxDecoration(
                color: AppColors.gray200,
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              ),
            ),
          ],
        ),
      ),
    );
  }

  String _errorMessage(Object? error) {
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return 'Could not load vitals';
  }
}

class _TempSparklinePainter extends CustomPainter {
  final List<double> data;
  final Color color;

  _TempSparklinePainter({required this.data, required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    if (data.isEmpty) return;

    final paint = Paint()
      ..color = color
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final fillPaint = Paint()
      ..shader = LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [
          color.withValues(alpha: 0.15),
          color.withValues(alpha: 0.0),
        ],
      ).createShader(Rect.fromLTWH(0, 0, size.width, size.height));

    if (data.length == 1) {
      final path = Path()
        ..moveTo(0, size.height / 2)
        ..lineTo(size.width, size.height / 2);
      canvas.drawPath(path, paint);
      return;
    }

    final path = Path();
    final fillPath = Path();

    final maxValue = data.reduce((a, b) => a > b ? a : b);
    final minValue = data.reduce((a, b) => a < b ? a : b);
    final range = maxValue - minValue;

    for (int i = 0; i < data.length; i++) {
      final x = (size.width / (data.length - 1)) * i;
      final normalized = range > 0 ? (data[i] - minValue) / range : 0.5;
      final y = size.height - (normalized * size.height);

      if (i == 0) {
        path.moveTo(x, y);
        fillPath.moveTo(x, size.height);
        fillPath.lineTo(x, y);
      } else {
        path.lineTo(x, y);
        fillPath.lineTo(x, y);
      }
    }

    fillPath.lineTo(size.width, size.height);
    fillPath.close();

    canvas.drawPath(fillPath, fillPaint);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _TempSparklinePainter oldDelegate) =>
      data != oldDelegate.data || color != oldDelegate.color;
}
