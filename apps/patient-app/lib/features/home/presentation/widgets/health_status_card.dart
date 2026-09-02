import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/health_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/time_formatter.dart';
import '../../../../core/utils/vital_metrics.dart';

/// Health Status card — the first major content component on Home.
///
/// Answers the patient's first question, "is anything wrong?", from real
/// backend state:
///
/// * **critical** — an open/escalated [HealthAlert] with severity critical:
///   red card with an emergency action.
/// * **warning** — an open/escalated alert with severity warning: amber card
///   naming the affected reading.
/// * **normal** — readings exist and no open alerts: calm green card with a
///   relative "Updated …" instant derived from the newest reading.
/// * **no data** — no readings at all: neutral card prompting the patient to
///   connect a device or sync health data from Health Connect.
///
/// No clinical "health score" is invented; the card only reports what the
/// server's threshold engine and the patient's readings already say.
class HealthStatusCard extends ConsumerWidget {
  const HealthStatusCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final alertsAsync = ref.watch(healthAlertsProvider);
    final readingsAsync = ref.watch(vitalReadingsProvider);

    // Still loading and nothing cached to show: shimmer, not a blank gap.
    if ((readingsAsync.isLoading && readingsAsync.valueOrNull == null) ||
        (alertsAsync.isLoading && alertsAsync.valueOrNull == null)) {
      return _buildShimmer();
    }

    // If either source failed hard, do NOT claim wellness — surface the
    // error with a retry. A permission error gets no retry button.
    if (_hardError(readingsAsync) || _hardError(alertsAsync)) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
        child: _StatusShell(
          backgroundColor: AppColors.white,
          borderColor: AppColors.gray200,
          icon: Icons.monitor_heart_outlined,
          iconBackgroundColor: AppColors.errorContainer,
          iconColor: AppColors.error,
          title: 'Health status unavailable',
          titleColor: AppColors.textPrimary,
          body:
              'We could not load your latest readings. Check your connection and try again.',
          actionLabel: 'Retry',
          onAction: () {
            ref.invalidate(vitalReadingsProvider);
            ref.invalidate(healthAlertsProvider);
          },
        ),
      );
    }

    final readings = readingsAsync.valueOrNull ?? const <VitalReading>[];
    final alerts = alertsAsync.valueOrNull ?? const <HealthAlert>[];

    final openAlerts = alerts
        .where((a) =>
            a.state == HealthAlertState.open ||
            a.state == HealthAlertState.escalated)
        .toList();
    final critical = openAlerts
        .where((a) => a.severity == HealthAlertSeverity.critical)
        .toList();
    final warning = openAlerts
        .where((a) => a.severity == HealthAlertSeverity.warning)
        .toList();

    if (critical.isNotEmpty) {
      return _buildCritical(context, critical.first);
    }
    if (warning.isNotEmpty) {
      return _buildWarning(context, warning.first);
    }
    if (openAlerts.isNotEmpty) {
      // An open info-level alert still deserves attention, not alarm.
      return _buildWarning(context, openAlerts.first);
    }
    if (readings.isEmpty) {
      return _buildNoData(context);
    }
    return _buildNormal(context, readings);
  }

  bool _hardError(AsyncValue<Object?> value) =>
      value.hasError && value.valueOrNull == null;

  // ─── Normal ───────────────────────────────────────────────────────────

  Widget _buildNormal(BuildContext context, List<VitalReading> readings) {
    final latest = readings
        .map((r) => DateTime.tryParse(r.recordedAt))
        .whereType<DateTime>()
        .fold<DateTime?>(null, (a, b) => a == null || b.isAfter(a) ? b : a);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: GestureDetector(
        onTap: () => context.go('/health'),
        child: Container(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: AppColors.successContainer.withValues(alpha: 0.45),
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(
              color: AppColors.success.withValues(alpha: 0.25),
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: const BoxDecoration(
                  color: AppColors.success,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.check_rounded,
                  color: AppColors.white,
                  size: 24,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      "You're doing well",
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.successDark,
                      ),
                    ),
                    const SizedBox(height: 2),
                    const Text(
                      'Your latest health readings are within your normal range.',
                      style: TextStyle(
                        fontSize: 12.5,
                        color: AppColors.gray700,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            latest != null
                                ? 'Updated ${formatRelativeTime(latest.toIso8601String())}'
                                : 'Updated recently',
                            style: const TextStyle(
                              fontSize: 11.5,
                              color: AppColors.textSecondary,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          width: 7,
                          height: 7,
                          decoration: const BoxDecoration(
                            color: AppColors.success,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              SizedBox(
                width: 64,
                height: 32,
                child: CustomPaint(
                  painter: _EcgPainter(
                    color: AppColors.success.withValues(alpha: 0.45),
                  ),
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Container(
                width: 32,
                height: 32,
                decoration: const BoxDecoration(
                  color: AppColors.white,
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.chevron_right_rounded,
                  color: AppColors.successDark,
                  size: 20,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ─── Warning ─────────────────────────────────────────────────────────

  Widget _buildWarning(BuildContext context, HealthAlert alert) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.warningContainer.withValues(alpha: 0.55),
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.warning.withValues(alpha: 0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: const BoxDecoration(
                color: AppColors.warning,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.priority_high_rounded,
                color: AppColors.white,
                size: 24,
              ),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Something needs attention',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.warningDark,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Your latest ${vitalMetricLabel(alert.metric)} reading '
                    '(${alert.observedValue.toStringAsFixed(0)}) is outside '
                    'your normal range.',
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.gray700,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: TextButton(
                      onPressed: () => context.go('/health'),
                      style: TextButton.styleFrom(
                        foregroundColor: AppColors.warningDark,
                        backgroundColor: AppColors.white.withValues(alpha: 0.7),
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                        minimumSize: const Size(48, 36),
                      ),
                      child: const Text(
                        'View details',
                        style: TextStyle(fontWeight: FontWeight.w700),
                      ),
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

  // ─── Critical ─────────────────────────────────────────────────────────

  Widget _buildCritical(BuildContext context, HealthAlert alert) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.errorContainer.withValues(alpha: 0.6),
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.error.withValues(alpha: 0.35)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: const BoxDecoration(
                color: AppColors.emergency,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.emergency_rounded,
                color: AppColors.white,
                size: 24,
              ),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text(
                    'Urgent attention',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.errorDark,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Your ${vitalMetricLabel(alert.metric)} reading is '
                    'critically out of range. If you feel unwell, get help '
                    'now.',
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.gray700,
                      height: 1.35,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      SizedBox(
                        height: 42,
                        child: FilledButton(
                          onPressed: () => context.push('/emergency-sos'),
                          style: FilledButton.styleFrom(
                            backgroundColor: AppColors.emergency,
                            foregroundColor: AppColors.white,
                            padding: const EdgeInsets.symmetric(
                              horizontal: 14,
                              vertical: 8,
                            ),
                          ),
                          child: const Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              Icon(Icons.emergency_rounded, size: 16),
                              SizedBox(width: 6),
                              Text(
                                'Get emergency help',
                                style: TextStyle(fontWeight: FontWeight.w700),
                              ),
                            ],
                          ),
                        ),
                      ),
                      const SizedBox(height: 4),
                      SizedBox(
                        height: 36,
                        child: TextButton(
                          onPressed: () => context.go('/health'),
                          style: TextButton.styleFrom(
                            foregroundColor: AppColors.errorDark,
                            padding: EdgeInsets.zero,
                          ),
                          child: const Text(
                            'View details',
                            style: TextStyle(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ─── No data ──────────────────────────────────────────────────────────

  Widget _buildNoData(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.gray200),
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.surfaceVariant,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.monitor_heart_outlined,
                color: AppColors.gray500,
                size: 24,
              ),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: const [
                  Text(
                    'No readings yet',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  SizedBox(height: 2),
                  Text(
                    'Connect a device or sync health data from Health Connect.',
                    style: TextStyle(
                      fontSize: 12.5,
                      color: AppColors.textSecondary,
                      height: 1.35,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm),
            TextButton(
              onPressed: () => context.push('/health/enter-vitals'),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primary,
                minimumSize: const Size(48, 40),
              ),
              child: const Text(
                'Sync health data',
                style: TextStyle(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildShimmer() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Shimmer.fromColors(
        baseColor: AppColors.gray200,
        highlightColor: AppColors.gray100,
        child: Container(
          height: 96,
          decoration: BoxDecoration(
            color: AppColors.gray200,
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          ),
        ),
      ),
    );
  }
}

/// Internal shell so the error variant keeps the same silhouette as the
/// data-driven variants.
class _StatusShell extends StatelessWidget {
  final Color backgroundColor;
  final Color borderColor;
  final IconData icon;
  final Color iconBackgroundColor;
  final Color iconColor;
  final String title;
  final Color titleColor;
  final String body;
  final String actionLabel;
  final VoidCallback onAction;

  const _StatusShell({
    required this.backgroundColor,
    required this.borderColor,
    required this.icon,
    required this.iconBackgroundColor,
    required this.iconColor,
    required this.title,
    required this.titleColor,
    required this.body,
    required this.actionLabel,
    required this.onAction,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: borderColor),
      ),
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: iconBackgroundColor,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: iconColor, size: 24),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: titleColor,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  body,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.textSecondary,
                    height: 1.35,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          TextButton(
            onPressed: onAction,
            style: TextButton.styleFrom(
              foregroundColor: AppColors.primary,
              minimumSize: const Size(48, 40),
            ),
            child: Text(
              actionLabel,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

/// Subtle heartbeat line, purely decorative.
class _EcgPainter extends CustomPainter {
  final Color color;

  _EcgPainter({required this.color});

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = color
      ..strokeWidth = 1.6
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final midY = size.height / 2;
    final path = Path()
      ..moveTo(0, midY)
      ..lineTo(size.width * 0.30, midY)
      ..lineTo(size.width * 0.38, midY - size.height * 0.18)
      ..lineTo(size.width * 0.46, midY)
      ..lineTo(size.width * 0.54, midY - size.height * 0.42)
      ..lineTo(size.width * 0.62, midY + size.height * 0.30)
      ..lineTo(size.width * 0.70, midY)
      ..lineTo(size.width, midY);
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _EcgPainter oldDelegate) =>
      oldDelegate.color != color;
}
