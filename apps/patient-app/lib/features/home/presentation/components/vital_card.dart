import 'package:flutter/material.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// A premium vital sign card with sparkline trend.
///
/// Shows an icon, label, current value with unit, optional badge, and a
/// sparkline chart derived from recent readings. When [isAbnormal], the
/// card border and value turn red to draw attention.
///
/// Designed to work inside an [Expanded] — all text has maxLines + ellipsis.
class VitalCard extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;
  final String unit;
  final Color color;
  final String? badge;
  final List<double> sparklineData;
  final bool isAbnormal;
  final String? abnormalMessage;

  const VitalCard({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    required this.unit,
    required this.color,
    this.badge,
    required this.sparklineData,
    this.isAbnormal = false,
    this.abnormalMessage,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$label: $value $unit',
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceSm + 2),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(
            color: isAbnormal ? AppColors.errorLight : AppColors.gray200,
            width: isAbnormal ? 1.5 : 1,
          ),
          boxShadow: [
            BoxShadow(
              color: AppColors.black.withValues(alpha: 0.03),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Header: icon + label (left) + badge (right)
            Row(
              children: [
                Icon(icon, color: color, size: 16),
                const SizedBox(width: 4),
                Flexible(
                  child: Text(
                    label,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textSecondary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (isAbnormal) ...[
                  const SizedBox(width: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 5,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.errorContainer,
                      borderRadius: BorderRadius.circular(
                        DesignTokens.radiusXs,
                      ),
                    ),
                    child: const Text(
                      'Alert',
                      style: TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: AppColors.errorDark,
                      ),
                    ),
                  ),
                ] else if (badge != null) ...[
                  const SizedBox(width: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 5,
                      vertical: 1,
                    ),
                    decoration: BoxDecoration(
                      color: AppColors.successContainer,
                      borderRadius: BorderRadius.circular(
                        DesignTokens.radiusXs,
                      ),
                    ),
                    child: Text(
                      badge!,
                      style: const TextStyle(
                        fontSize: 9,
                        fontWeight: FontWeight.w700,
                        color: AppColors.successDark,
                      ),
                    ),
                  ),
                ],
              ],
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            // Value
            Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              children: [
                Flexible(
                  child: Text(
                    value,
                    style: TextStyle(
                      fontSize: 26,
                      fontWeight: FontWeight.w900,
                      color: isAbnormal
                          ? AppColors.errorDark
                          : AppColors.textPrimary,
                      height: 1,
                      letterSpacing: -0.5,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                const SizedBox(width: 3),
                Flexible(
                  child: Text(
                    unit,
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textSecondary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            if (isAbnormal && abnormalMessage != null) ...[
              const SizedBox(height: 4),
              Text(
                abnormalMessage!,
                style: const TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  color: AppColors.errorDark,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
            const SizedBox(height: DesignTokens.spaceSm),
            // Sparkline
            SizedBox(
              height: 32,
              width: double.infinity,
              child: CustomPaint(
                size: Size.infinite,
                painter: SparklinePainter(
                  data: sparklineData,
                  color: isAbnormal ? AppColors.error : color,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Reusable sparkline painter — smooth line + gradient fill.
class SparklinePainter extends CustomPainter {
  final List<double> data;
  final Color color;

  SparklinePainter({required this.data, required this.color});

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
  bool shouldRepaint(covariant SparklinePainter oldDelegate) =>
      data != oldDelegate.data || color != oldDelegate.color;
}
