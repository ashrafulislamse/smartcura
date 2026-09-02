import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// A custom-painted SmartCura logo mark — a rounded shield containing
/// a medical cross with a subtle pulse line. Used on splash, onboarding,
/// and auth screens for consistent branding.
class SmartCuraLogo extends StatelessWidget {
  final double size;
  final Color? color;

  const SmartCuraLogo({super.key, this.size = 80, this.color});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _SmartCuraLogoPainter(
          color: color ?? AppColors.white,
        ),
      ),
    );
  }
}

/// Paints the SmartCura mark: a rounded-square shield with a medical cross
/// and a pulse line running through the lower half.
class _SmartCuraLogoPainter extends CustomPainter {
  final Color color;

  _SmartCuraLogoPainter({required this.color});

  @override
  void paint(Canvas canvas, Size canvasSize) {
    final s = canvasSize.width;
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = s * 0.06
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    // Rounded square shield outline.
    final rrect = RRect.fromRectAndRadius(
      Rect.fromLTWH(s * 0.08, s * 0.08, s * 0.84, s * 0.84),
      Radius.circular(s * 0.22),
    );
    canvas.drawRRect(rrect, paint);

    // Medical cross (vertical + horizontal bars).
    final crossPaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = s * 0.07
      ..strokeCap = StrokeCap.round;

    // Vertical bar of the cross.
    canvas.drawLine(
      Offset(s * 0.5, s * 0.28),
      Offset(s * 0.5, s * 0.50),
      crossPaint,
    );
    // Horizontal bar of the cross.
    canvas.drawLine(
      Offset(s * 0.36, s * 0.39),
      Offset(s * 0.64, s * 0.39),
      crossPaint,
    );

    // Pulse / heartbeat line below the cross.
    final pulsePaint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = s * 0.045
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    final path = Path()
      ..moveTo(s * 0.22, s * 0.66)
      ..lineTo(s * 0.36, s * 0.66)
      ..lineTo(s * 0.42, s * 0.58)
      ..lineTo(s * 0.50, s * 0.74)
      ..lineTo(s * 0.58, s * 0.62)
      ..lineTo(s * 0.64, s * 0.66)
      ..lineTo(s * 0.78, s * 0.66);

    canvas.drawPath(path, pulsePaint);
  }

  @override
  bool shouldRepaint(covariant _SmartCuraLogoPainter oldDelegate) =>
      color != oldDelegate.color;
}
