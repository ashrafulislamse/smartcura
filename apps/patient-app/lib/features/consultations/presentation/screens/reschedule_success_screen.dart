import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// Reschedule Success Screen
///
/// Shown after a successful reschedule mutation. Displays an animated
/// checkmark with a gradient background, a confirmation message, and
/// two actions: view the appointment details or go back home.
class RescheduleSuccessScreen extends StatefulWidget {
  final String? appointmentId;

  const RescheduleSuccessScreen({
    super.key,
    this.appointmentId,
  });

  @override
  State<RescheduleSuccessScreen> createState() =>
      _RescheduleSuccessScreenState();
}

class _RescheduleSuccessScreenState extends State<RescheduleSuccessScreen>
    with TickerProviderStateMixin {
  late final AnimationController _checkController;
  late final AnimationController _scaleController;
  late final Animation<double> _checkAnimation;
  late final Animation<double> _scaleAnimation;
  late final Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
      ),
    );

    // Checkmark draw animation (path progress 0 → 1).
    _checkController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );

    // Scale animation for the circle pop-in.
    _scaleController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 400),
    );

    _checkAnimation = CurvedAnimation(
      parent: _checkController,
      curve: Curves.easeInOut,
    );

    _scaleAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _scaleController, curve: Curves.elasticOut),
    );

    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _scaleController,
        curve: const Interval(0.5, 1.0, curve: Curves.easeIn),
      ),
    );

    // Start the sequence: scale first, then draw the checkmark.
    _scaleController.forward();
    Future.delayed(const Duration(milliseconds: 300), () {
      if (mounted) _checkController.forward();
    });
  }

  @override
  void dispose() {
    _checkController.dispose();
    _scaleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            _buildTopAccent(),
            Expanded(
              child: SingleChildScrollView(
                physics: const BouncingScrollPhysics(),
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceLg,
                  ),
                  child: Column(
                    children: [
                      const SizedBox(height: DesignTokens.spaceXl),
                      _buildAnimatedCheckmark(),
                      const SizedBox(height: DesignTokens.spaceXl),
                      _buildHeader(),
                      const SizedBox(height: DesignTokens.spaceXl),
                      _buildSummaryCard(),
                      const SizedBox(height: DesignTokens.space2xl),
                      _buildActions(),
                      const SizedBox(height: DesignTokens.spaceXl),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Top accent bar ──────────────────────────────────────────────────────

  Widget _buildTopAccent() {
    return Container(
      height: 4,
      decoration: const BoxDecoration(
        gradient: AppColors.primaryGradient,
      ),
    );
  }

  // ── Animated checkmark ──────────────────────────────────────────────────

  Widget _buildAnimatedCheckmark() {
    return AnimatedBuilder(
      animation: Listenable.merge([_scaleController, _checkController]),
      builder: (context, child) {
        return Transform.scale(
          scale: _scaleAnimation.value,
          child: child,
        );
      },
      child: Container(
        width: 120,
        height: 120,
        decoration: BoxDecoration(
          gradient: const LinearGradient(
            colors: [AppColors.success, AppColors.successLight],
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
          ),
          shape: BoxShape.circle,
          boxShadow: [
            BoxShadow(
              color: AppColors.success.withValues(alpha: 0.3),
              blurRadius: 24,
              offset: const Offset(0, 8),
            ),
          ],
        ),
        child: CustomPaint(
          painter: _CheckPainter(progress: _checkAnimation.value),
        ),
      ),
    );
  }

  // ── Header text ─────────────────────────────────────────────────────────

  Widget _buildHeader() {
    return FadeTransition(
      opacity: _fadeAnimation,
      child: Column(
        children: [
          Text(
            'Appointment Rescheduled!',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 26,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              letterSpacing: DesignTokens.letterSpacingTight,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm + 2),
          Text(
            'Your appointment has been successfully rescheduled. You will receive a confirmation shortly.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 15,
              fontWeight: FontWeight.w400,
              color: AppColors.textSecondary,
              height: DesignTokens.lineHeightRelaxed,
            ),
          ),
        ],
      ),
    );
  }

  // ── Summary card ────────────────────────────────────────────────────────

  Widget _buildSummaryCard() {
    return FadeTransition(
      opacity: _fadeAnimation,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.shadow,
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          children: [
            _buildSummaryRow(
              icon: Icons.check_circle_rounded,
              iconColor: AppColors.success,
              iconBg: AppColors.successContainer,
              label: 'Status',
              value: 'Rescheduled',
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            Divider(height: 1, thickness: 1, color: AppColors.borderLight),
            const SizedBox(height: DesignTokens.spaceMd),
            _buildSummaryRow(
              icon: Icons.event_rounded,
              iconColor: AppColors.primary,
              iconBg: AppColors.primaryContainer,
              label: 'Appointment ID',
              value: widget.appointmentId ?? '—',
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            Divider(height: 1, thickness: 1, color: AppColors.borderLight),
            const SizedBox(height: DesignTokens.spaceMd),
            _buildSummaryRow(
              icon: Icons.notifications_active_rounded,
              iconColor: AppColors.secondary,
              iconBg: AppColors.secondaryContainer,
              label: 'Reminder',
              value: 'You\'ll be notified before your visit',
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSummaryRow({
    required IconData icon,
    required Color iconColor,
    required Color iconBg,
    required String label,
    required String value,
  }) {
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: iconBg,
            borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
          ),
          child: Icon(icon, size: 20, color: iconColor),
        ),
        const SizedBox(width: DesignTokens.spaceSm + 2),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                  letterSpacing: DesignTokens.letterSpacingWide,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ── Action buttons ──────────────────────────────────────────────────────

  Widget _buildActions() {
    return FadeTransition(
      opacity: _fadeAnimation,
      child: Column(
        children: [
          SizedBox(
            width: double.infinity,
            height: DesignTokens.buttonHeightLg,
            child: ElevatedButton(
              onPressed: () => context.go(
                '/appointment-details',
                extra: {'appointmentId': widget.appointmentId},
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.white,
                elevation: 2,
                shadowColor: AppColors.primary.withValues(alpha: 0.3),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.visibility_rounded, size: 20),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Text(
                    'View Appointment',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          SizedBox(
            width: double.infinity,
            height: DesignTokens.buttonHeightLg,
            child: OutlinedButton(
              onPressed: () => context.go('/home'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.primary,
                side: BorderSide(color: AppColors.border, width: 1.5),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                ),
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.home_rounded, size: 20),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Text(
                    'Back to Home',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.primary,
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

/// Paints a white checkmark that draws itself based on [progress].
class _CheckPainter extends CustomPainter {
  final double progress;

  _CheckPainter({required this.progress});

  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);

    // Checkmark points — scaled to a 120×120 canvas.
    final p1 = Offset(center.dx - 22, center.dy + 2);
    final p2 = Offset(center.dx - 6, center.dy + 18);
    final p3 = Offset(center.dx + 24, center.dy - 20);

    final path = Path()
      ..moveTo(p1.dx, p1.dy)
      ..lineTo(p2.dx, p2.dy)
      ..lineTo(p3.dx, p3.dy);

    final pathMetrics = path.computeMetrics();
    final totalLength = pathMetrics.fold(0.0, (prev, m) => prev + m.length);

    final paint = Paint()
      ..color = AppColors.white
      ..style = PaintingStyle.stroke
      ..strokeWidth = 6
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round;

    // Draw progressively based on [progress].
    final drawnLength = totalLength * progress.clamp(0.0, 1.0);
    double remaining = drawnLength;

    for (final metric in pathMetrics) {
      if (remaining <= 0) break;
      final segmentLength = metric.length;
      final extractLength =
          remaining > segmentLength ? segmentLength : remaining;
      final extractedPath = metric.extractPath(0, extractLength);
      canvas.drawPath(extractedPath, paint);
      remaining -= segmentLength;
    }
  }

  @override
  bool shouldRepaint(_CheckPainter oldDelegate) =>
      oldDelegate.progress != progress;
}
