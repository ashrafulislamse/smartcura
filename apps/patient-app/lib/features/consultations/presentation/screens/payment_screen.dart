import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/app_state_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';

/// Payment / Checkout Screen
///
/// Reads the booking wizard state ([bookingStateProvider]) which was populated
/// by the book-appointment screen: the selected doctor ([DoctorDirectoryItem],
/// which carries [DoctorDirectoryItem.consultationFeeSen] and
/// [DoctorDirectoryItem.currency]), the date, and the consultation mode.
///
/// The fee is integer sen — formatted to `RM X.XX` for display only. The server
/// never sends a formatted string (see AGENTS.md "Money" convention).
///
/// No real payment adapter exists yet (per AGENTS.md), so the checkout UI is
/// shown with the real fee breakdown and navigates to success on confirmation.
/// The appointment is already booked at this point.
class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({super.key});

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen> {
  String _selectedPayment = 'pay_at_appointment';
  bool _isProcessing = false;

  /// Formats integer sen into a display string: `RM 50.00`.
  String _formatMoney(int sen, String currency) {
    final rm = (sen / 100).toStringAsFixed(2);
    return currency == 'MYR' ? 'RM $rm' : '$currency $rm';
  }

  /// Service tax at 6% on the sen amount, rounded to the nearest sen.
  int _taxSen(int feeSen) => (feeSen * 0.06).round();

  String _modeLabel(AppointmentMode? mode) {
    if (mode == null) return 'TBD';
    return switch (mode) {
      AppointmentMode.video => 'Video Consultation',
      AppointmentMode.audio => 'Audio Consultation',
      AppointmentMode.inPerson => 'In-person Visit',
      AppointmentMode.chat => 'Chat Consultation',
      AppointmentMode.unknown => 'TBD',
    };
  }

  (IconData, String) _modeInfo(AppointmentMode? mode) {
    if (mode == null) return (Icons.help_outline, 'TBD');
    return switch (mode) {
      AppointmentMode.video => (Icons.videocam, 'Video Consultation'),
      AppointmentMode.audio => (Icons.phone_in_talk, 'Audio Consultation'),
      AppointmentMode.inPerson => (Icons.location_on, 'In-person Visit'),
      AppointmentMode.chat => (Icons.chat_bubble_outline, 'Chat Consultation'),
      AppointmentMode.unknown => (Icons.help_outline, 'TBD'),
    };
  }

  String _formatDate(DateTime dt) {
    const days = [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday'
    ];
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec'
    ];
    return '${days[dt.weekday - 1]}, ${months[dt.month - 1]} ${dt.day}, ${dt.year}';
  }

  Future<void> _processPayment(BookingState booking) async {
    setState(() => _isProcessing = true);

    // No real payment adapter exists yet (see AGENTS.md). The appointment is
    // already booked at this point; the fee is collected at the appointment.
    await Future<void>.delayed(const Duration(seconds: 2));

    if (!mounted) return;
    setState(() => _isProcessing = false);

    final doctor = booking.doctor!;
    final fee = doctor.consultationFeeSen;
    final tax = _taxSen(fee);
    final total = fee + tax;

    context.go('/payment-success', extra: {
      'amountSen': total,
      'currency': doctor.currency,
      'doctorName': doctor.displayName,
      'date': booking.selectedDate != null
          ? _formatDate(booking.selectedDate!)
          : 'TBD',
      'time': _modeLabel(booking.consultationMode),
      'transactionId': 'Pay at appointment',
    });
  }

  @override
  Widget build(BuildContext context) {
    final booking = ref.watch(bookingStateProvider);
    final doctor = booking.doctor;

    if (doctor == null) {
      return _buildNoBooking(context);
    }

    final fee = doctor.consultationFeeSen;
    final tax = _taxSen(fee);
    final total = fee + tax;

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
          child: Column(
            children: [
              _buildHeader(context),
              Expanded(
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  padding: EdgeInsets.fromLTRB(
                    DesignTokens.spaceMd,
                    DesignTokens.spaceSm,
                    DesignTokens.spaceMd,
                    DesignTokens.space2xl + 80,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildDoctorSummary(doctor, booking),
                      const SizedBox(height: DesignTokens.spaceSm),
                      _buildOrderSummary(doctor, booking, fee, tax, total),
                      const SizedBox(height: DesignTokens.spaceSm),
                      _buildPaymentMethods(),
                      const SizedBox(height: DesignTokens.spaceSm),
                      _buildSecurityBadge(),
                    ],
                  ),
                ),
              ),
              _buildBottomBar(booking, total, doctor.currency),
            ],
          ),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Header (custom — no AppBar)
  // -------------------------------------------------------------------------
  Widget _buildHeader(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceMd,
        vertical: DesignTokens.spaceSm,
      ),
      child: Row(
        children: [
          GestureDetector(
            onTap: () => context.pop(),
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.surface,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.gray200),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.black.withValues(alpha: 0.04),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: const Icon(
                Icons.arrow_back,
                size: 20,
                color: AppColors.textPrimary,
              ),
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          const Text(
            'Checkout',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // No booking state
  // -------------------------------------------------------------------------
  Widget _buildNoBooking(BuildContext context) {
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
          child: Column(
            children: [
              _buildHeader(context),
              Expanded(
                child: Center(
                  child: Padding(
                    padding: const EdgeInsets.all(DesignTokens.spaceXl),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 80,
                          height: 80,
                          decoration: BoxDecoration(
                            color: AppColors.gray100,
                            shape: BoxShape.circle,
                          ),
                          child: const Icon(
                            Icons.shopping_cart_outlined,
                            size: 40,
                            color: AppColors.gray400,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceLg),
                        const Text(
                          'No booking to pay for',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceSm),
                        const Text(
                          'Select a doctor and book an appointment first.',
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 14,
                            fontWeight: FontWeight.w400,
                            color: AppColors.textSecondary,
                            height: 1.5,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceXl),
                        SizedBox(
                          width: 220,
                          height: DesignTokens.buttonHeightMd,
                          child: ElevatedButton(
                            onPressed: () => context.go('/find-doctor'),
                            style: ElevatedButton.styleFrom(
                              backgroundColor: AppColors.primary,
                              foregroundColor: AppColors.white,
                              elevation: 0,
                              shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(
                                    DesignTokens.radiusLg),
                              ),
                            ),
                            child: const Text(
                              'Find a Doctor',
                              style: TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 14,
                                fontWeight: FontWeight.w700,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Doctor summary card (hero card with gradient)
  // -------------------------------------------------------------------------
  Widget _buildDoctorSummary(DoctorDirectoryItem doctor, BookingState booking) {
    final (modeIcon, modeLabel) = _modeInfo(booking.consultationMode);
    final dateStr = booking.selectedDate != null
        ? _formatDate(booking.selectedDate!)
        : 'Date TBD';

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [AppColors.primary, AppColors.primaryDark],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.25),
            blurRadius: 20,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Column(
        children: [
          Row(
            children: [
              AvatarWidget(
                imageUrl: doctor.imageUrl,
                name: doctor.displayName,
                size: 56,
                gradient: const LinearGradient(
                  colors: [AppColors.white, AppColors.primaryContainer],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      doctor.displayName,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: AppColors.white,
                        height: 1.2,
                      ),
                    ),
                    if (doctor.primarySpecialty != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        doctor.primarySpecialty!,
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 13,
                          fontWeight: FontWeight.w500,
                          color: AppColors.white.withValues(alpha: 0.85),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceMd,
              vertical: DesignTokens.spaceSm + 2,
            ),
            decoration: BoxDecoration(
              color: AppColors.white.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: Row(
              children: [
                Icon(modeIcon, size: 18, color: AppColors.white),
                const SizedBox(width: DesignTokens.spaceSm),
                Expanded(
                  child: Text(
                    modeLabel,
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.white,
                    ),
                  ),
                ),
                const Icon(
                  Icons.calendar_today,
                  size: 16,
                  color: AppColors.white,
                ),
                const SizedBox(width: DesignTokens.spaceXs + 2),
                Flexible(
                  child: Text(
                    dateStr,
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.white,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Order summary / fee breakdown
  // -------------------------------------------------------------------------
  Widget _buildOrderSummary(
    DoctorDirectoryItem doctor,
    BookingState booking,
    int fee,
    int tax,
    int total,
  ) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.03),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Fee Breakdown',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          _buildFeeRow(
            'Consultation Fee',
            _formatMoney(fee, doctor.currency),
          ),
          const SizedBox(height: DesignTokens.spaceSm + 2),
          _buildFeeRow(
            'Service Tax (6%)',
            _formatMoney(tax, doctor.currency),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Container(
            height: 1,
            decoration: BoxDecoration(
              gradient: LinearGradient(
                colors: [
                  AppColors.gray200,
                  AppColors.gray200.withValues(alpha: 0),
                ],
              ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Total',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              Text(
                _formatMoney(total, doctor.currency),
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildFeeRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontFamily: 'Manrope',
            fontSize: 14,
            fontWeight: FontWeight.w500,
            color: AppColors.textSecondary,
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            fontFamily: 'Manrope',
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Payment method selector
  // -------------------------------------------------------------------------
  Widget _buildPaymentMethods() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.03),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Payment Method',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          _buildPaymentOption(
            id: 'pay_at_appointment',
            icon: Icons.payments_outlined,
            title: 'Pay at Appointment',
            subtitle: 'Settle the fee during your visit',
            iconColor: AppColors.secondary,
            iconBgColor: AppColors.secondaryContainer,
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildPaymentOption(
            id: 'card',
            icon: Icons.credit_card_outlined,
            title: 'Credit / Debit Card',
            subtitle: 'Visa, Mastercard, American Express',
            iconColor: AppColors.primary,
            iconBgColor: AppColors.primaryContainer,
            isDisabled: true,
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildPaymentOption(
            id: 'ewallet',
            icon: Icons.account_balance_wallet_outlined,
            title: 'E-Wallet',
            subtitle: 'Touch n Go, GrabPay, Boost',
            iconColor: AppColors.info,
            iconBgColor: AppColors.infoContainer,
            isDisabled: true,
          ),
        ],
      ),
    );
  }

  Widget _buildPaymentOption({
    required String id,
    required IconData icon,
    required String title,
    required String subtitle,
    required Color iconColor,
    required Color iconBgColor,
    bool isDisabled = false,
  }) {
    final isSelected = _selectedPayment == id;

    return Opacity(
      opacity: isDisabled ? 0.5 : 1.0,
      child: GestureDetector(
        onTap: isDisabled ? null : () => setState(() => _selectedPayment = id),
        child: Container(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: isSelected
                ? AppColors.primaryContainer.withValues(alpha: 0.3)
                : AppColors.gray50,
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(
              color: isSelected ? AppColors.primary : AppColors.gray200,
              width: isSelected ? 2 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: iconBgColor,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: Icon(icon, size: 22, color: iconColor),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      subtitle,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 12,
                        fontWeight: FontWeight.w400,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              if (isDisabled)
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceSm,
                    vertical: 2,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.gray100,
                    borderRadius:
                        BorderRadius.circular(DesignTokens.radiusFull),
                  ),
                  child: const Text(
                    'Soon',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 10,
                      fontWeight: FontWeight.w700,
                      color: AppColors.gray500,
                    ),
                  ),
                )
              else
                Container(
                  width: 24,
                  height: 24,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: isSelected ? AppColors.primary : Colors.transparent,
                    border: Border.all(
                      color: isSelected ? AppColors.primary : AppColors.gray300,
                      width: 2,
                    ),
                  ),
                  child: isSelected
                      ? const Icon(
                          Icons.check,
                          size: 14,
                          color: AppColors.white,
                        )
                      : null,
                ),
            ],
          ),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Security badge
  // -------------------------------------------------------------------------
  Widget _buildSecurityBadge() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceMd,
        vertical: DesignTokens.spaceSm + 2,
      ),
      decoration: BoxDecoration(
        color: AppColors.successContainer,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(
            Icons.verified_user_outlined,
            size: 18,
            color: AppColors.successDark,
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          const Text(
            'Your booking is secured and encrypted',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.successDark,
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Bottom bar
  // -------------------------------------------------------------------------
  Widget _buildBottomBar(BookingState booking, int total, String currency) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        DesignTokens.spaceSm,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(
          top: BorderSide(color: AppColors.gray100, width: 1),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.06),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Total Amount',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                  ),
                ),
                Text(
                  _formatMoney(total, currency),
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            SizedBox(
              width: double.infinity,
              height: DesignTokens.buttonHeightLg,
              child: ElevatedButton(
                onPressed:
                    _isProcessing ? null : () => _processPayment(booking),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: AppColors.white,
                  disabledBackgroundColor:
                      AppColors.primary.withValues(alpha: 0.5),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                  ),
                ),
                child: _isProcessing
                    ? const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          SizedBox(
                            height: 22,
                            width: 22,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.5,
                              valueColor: AlwaysStoppedAnimation<Color>(
                                  AppColors.white),
                            ),
                          ),
                          SizedBox(width: DesignTokens.spaceSm),
                          Text(
                            'Processing...',
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      )
                    : const Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Icon(Icons.check_circle_outline, size: 22),
                          SizedBox(width: DesignTokens.spaceSm),
                          Text(
                            'Confirm Booking',
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
