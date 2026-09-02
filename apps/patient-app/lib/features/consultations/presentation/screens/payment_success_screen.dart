import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// Payment Success Screen
///
/// Reads transaction details from the route extra (set by [PaymentScreen]):
/// [amountSen] (integer sen), [currency], [doctorName], [date], [time],
/// [transactionId]. No hardcoded fallbacks — every value comes from the
/// booking flow.
class PaymentSuccessScreen extends StatefulWidget {
  final int amountSen;
  final String currency;
  final String doctorName;
  final String date;
  final String time;
  final String transactionId;

  const PaymentSuccessScreen({
    super.key,
    required this.amountSen,
    required this.currency,
    required this.doctorName,
    required this.date,
    required this.time,
    required this.transactionId,
  });

  @override
  State<PaymentSuccessScreen> createState() => _PaymentSuccessScreenState();
}

class _PaymentSuccessScreenState extends State<PaymentSuccessScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _scaleAnimation;
  late Animation<double> _fadeAnimation;
  late Animation<double> _checkAnimation;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      duration: const Duration(milliseconds: 800),
      vsync: this,
    );

    _scaleAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.0, 0.6, curve: Curves.elasticOut),
      ),
    );

    _checkAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.3, 0.8, curve: Curves.easeInOut),
      ),
    );

    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.4, 1.0, curve: Curves.easeIn),
      ),
    );

    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  String _formatMoney(int sen, String currency) {
    final rm = (sen / 100).toStringAsFixed(2);
    return currency == 'MYR' ? 'RM $rm' : '$currency $rm';
  }

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceLg,
            ),
            child: Column(
              children: [
                const Spacer(flex: 2),

                // Animated success icon
                ScaleTransition(
                  scale: _scaleAnimation,
                  child: Container(
                    width: 120,
                    height: 120,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: const LinearGradient(
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                        colors: [
                          AppColors.secondary,
                          AppColors.primary,
                        ],
                      ),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.primary.withValues(alpha: 0.35),
                          blurRadius: 40,
                          offset: const Offset(0, 12),
                        ),
                      ],
                    ),
                    child: Center(
                      child: SizeTransition(
                        sizeFactor: _checkAnimation,
                        axisAlignment: 0.0,
                        child: const Icon(
                          Icons.check,
                          size: 64,
                          color: AppColors.white,
                        ),
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceXl),

                // Success message
                FadeTransition(
                  opacity: _fadeAnimation,
                  child: Column(
                    children: [
                      const Text(
                        'Payment Successful!',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 26,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                          height: 1.2,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: DesignTokens.spaceSm),
                      Text(
                        'Your appointment with ${widget.doctorName} is confirmed.',
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 14,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textSecondary,
                          height: 1.5,
                        ),
                        textAlign: TextAlign.center,
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceXl),

                // Payment details card
                FadeTransition(
                  opacity: _fadeAnimation,
                  child: Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(DesignTokens.spaceLg),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radius2xl),
                      border: Border.all(color: AppColors.gray200),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.black.withValues(alpha: 0.04),
                          blurRadius: 20,
                          offset: const Offset(0, 4),
                        ),
                      ],
                    ),
                    child: Column(
                      children: [
                        // Amount paid
                        const Text(
                          'AMOUNT PAID',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: AppColors.gray400,
                            letterSpacing: 1.2,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceSm),
                        Text(
                          _formatMoney(widget.amountSen, widget.currency),
                          style: const TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 34,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceLg),
                        Container(
                          height: 1,
                          color: AppColors.gray100,
                        ),
                        const SizedBox(height: DesignTokens.spaceMd),

                        // Transaction details
                        _buildDetailRow(
                          'Transaction ID',
                          widget.transactionId,
                          isMono: true,
                        ),
                        const SizedBox(height: DesignTokens.spaceMd),
                        _buildDetailRow('Doctor', widget.doctorName),
                        const SizedBox(height: DesignTokens.spaceMd),
                        _buildDetailRow('Date', widget.date),
                        const SizedBox(height: DesignTokens.spaceMd),
                        _buildDetailRow('Time', widget.time),
                      ],
                    ),
                  ),
                ),

                const Spacer(flex: 3),

                // Action buttons
                FadeTransition(
                  opacity: _fadeAnimation,
                  child: Column(
                    children: [
                      SizedBox(
                        width: double.infinity,
                        height: DesignTokens.buttonHeightLg,
                        child: ElevatedButton(
                          onPressed: () => context.go('/home'),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.primary,
                            foregroundColor: AppColors.white,
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius:
                                  BorderRadius.circular(DesignTokens.radiusLg),
                            ),
                          ),
                          child: const Text(
                            'View Appointment',
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceSm),
                      SizedBox(
                        width: double.infinity,
                        height: DesignTokens.buttonHeightLg,
                        child: OutlinedButton(
                          onPressed: () => context.go('/home'),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppColors.textPrimary,
                            side: const BorderSide(color: AppColors.gray300),
                            shape: RoundedRectangleBorder(
                              borderRadius:
                                  BorderRadius.circular(DesignTokens.radiusLg),
                            ),
                          ),
                          child: const Text(
                            'Back to Home',
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),

                // Email confirmation note
                FadeTransition(
                  opacity: _fadeAnimation,
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(
                        Icons.mail_outline,
                        size: 16,
                        color: AppColors.gray400,
                      ),
                      const SizedBox(width: DesignTokens.spaceSm),
                      const Text(
                        'A confirmation email has been sent to your inbox.',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 11,
                          fontWeight: FontWeight.w500,
                          color: AppColors.gray500,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceMd),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value, {bool isMono = false}) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontFamily: 'Manrope',
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: AppColors.textSecondary,
          ),
        ),
        Flexible(
          child: Container(
            padding: isMono
                ? const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceSm,
                    vertical: DesignTokens.spaceXs,
                  )
                : null,
            decoration: isMono
                ? BoxDecoration(
                    color: AppColors.gray100,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                  )
                : null,
            child: Text(
              value,
              style: TextStyle(
                fontFamily: isMono ? 'Manrope' : 'Manrope',
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ),
      ],
    );
  }
}
