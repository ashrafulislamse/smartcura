import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/doctor_provider.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/app_state_provider.dart';

/// Reschedule Appointment Screen
///
/// Lets the patient pick a new date and time slot for an existing appointment.
/// Reads [selectedAppointmentProvider] for the target appointment, fetches
/// 14 days of availability slots from [appointmentSlotsProvider], filters
/// locally for the selected day, and calls [BookingMutationNotifier.reschedule].
class RescheduleAppointmentScreen extends ConsumerStatefulWidget {
  const RescheduleAppointmentScreen({super.key});

  @override
  ConsumerState<RescheduleAppointmentScreen> createState() =>
      _RescheduleAppointmentScreenState();
}

class _RescheduleAppointmentScreenState
    extends ConsumerState<RescheduleAppointmentScreen> {
  DateTime _selectedDay = _dateOnly(DateTime.now());
  String? _selectedSlotId;
  bool _isSubmitting = false;

  // ── Lifecycle ───────────────────────────────────────────────────────────

  @override
  void initState() {
    super.initState();
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
      ),
    );
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  static DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

  List<DateTime> get _dateRange {
    final today = _dateOnly(DateTime.now());
    return List.generate(14, (i) => today.add(Duration(days: i)));
  }

  AppointmentSlotsParams _buildSlotsParams(String orgId, String membershipId) {
    final today = _dateOnly(DateTime.now());
    return AppointmentSlotsParams(
      organizationId: orgId,
      membershipId: membershipId,
      from: today,
      to: today.add(const Duration(days: 14)),
    );
  }

  List<AvailabilitySlot> _slotsForDay(List<AvailabilitySlot> all) {
    final dayStart = _selectedDay;
    final dayEnd = _selectedDay.add(const Duration(days: 1));
    return all.where((slot) {
      final start = DateTime.parse(slot.startsAt).toLocal();
      return start
              .isAfter(dayStart.subtract(const Duration(microseconds: 1))) &&
          start.isBefore(dayEnd) &&
          slot.state == 'open';
    }).toList()
      ..sort((a, b) =>
          DateTime.parse(a.startsAt).compareTo(DateTime.parse(b.startsAt)));
  }

  String _formatTime(String iso) {
    final dt = DateTime.parse(iso).toLocal();
    final h = dt.hour;
    final m = dt.minute;
    final amPm = h < 12 ? 'AM' : 'PM';
    final hour12 = h == 0 ? 12 : (h > 12 ? h - 12 : h);
    return '$hour12:${m.toString().padLeft(2, '0')} $amPm';
  }

  String _formatDate(String iso) {
    final dt = DateTime.parse(iso).toLocal();
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
      'Dec',
    ];
    return '${months[dt.month - 1]} ${dt.day}, ${dt.year}';
  }

  String _formatDay(DateTime d) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days[d.weekday - 1];
  }

  String _modeLabel(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => 'Video Call',
        AppointmentMode.audio => 'Audio Call',
        AppointmentMode.chat => 'Chat',
        AppointmentMode.inPerson => 'In Person',
        AppointmentMode.unknown => 'Consultation',
      };

  IconData _modeIcon(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => Icons.videocam_rounded,
        AppointmentMode.audio => Icons.call_rounded,
        AppointmentMode.chat => Icons.chat_bubble_rounded,
        AppointmentMode.inPerson => Icons.local_hospital_rounded,
        AppointmentMode.unknown => Icons.event_rounded,
      };

  // ── Actions ─────────────────────────────────────────────────────────────

  Future<void> _confirmReschedule(Appointment appointment) async {
    if (_selectedSlotId == null) {
      _showSnackbar('Please select a time slot to continue.', isError: true);
      return;
    }

    setState(() => _isSubmitting = true);

    final result = await ref.read(bookingMutationProvider.notifier).reschedule(
          appointmentId: appointment.id,
          newSlotId: _selectedSlotId!,
          mode: appointment.mode,
          expectedVersion: appointment.version,
        );

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    if (result != null) {
      context
          .go('/reschedule-success', extra: {'appointmentId': appointment.id});
    } else {
      final asyncVal = ref.read(bookingMutationProvider);
      final message = asyncVal.maybeWhen(
        error: (e, _) => e is ApiError
            ? e.userMessage
            : 'Reschedule failed. Please try again.',
        orElse: () => 'Reschedule failed. Please try again.',
      );
      _showSnackbar(message, isError: true);
    }
  }

  void _showSnackbar(String message, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          message,
          style: TextStyle(
            fontFamily: 'Manrope',
            fontSize: 14,
            fontWeight: FontWeight.w600,
            color: AppColors.white,
          ),
        ),
        backgroundColor: isError ? AppColors.error : AppColors.success,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
        ),
        margin: const EdgeInsets.fromLTRB(
          DesignTokens.spaceMd,
          0,
          DesignTokens.spaceMd,
          80,
        ),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  // ── Build ───────────────────────────────────────────────────────────────

  @override
  Widget build(BuildContext context) {
    final appointment = ref.watch(selectedAppointmentProvider);

    if (appointment == null) {
      return _buildNoSelection();
    }

    final slotsParams = _buildSlotsParams(
      appointment.organizationId,
      appointment.doctorMembershipId,
    );

    final doctorAsync =
        ref.watch(doctorDetailProvider(appointment.doctorMembershipId));
    final slotsAsync = ref.watch(appointmentSlotsProvider(slotsParams));
    final bookingState = ref.watch(bookingMutationProvider);
    final isLoading = _isSubmitting || bookingState.isLoading;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: SingleChildScrollView(
                physics: const BouncingScrollPhysics(),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const SizedBox(height: DesignTokens.spaceMd),
                    _buildCurrentAppointmentCard(appointment, doctorAsync),
                    const SizedBox(height: DesignTokens.spaceLg),
                    _buildDateSelector(),
                    const SizedBox(height: DesignTokens.spaceLg),
                    _buildSlotsSection(slotsAsync, slotsParams),
                    const SizedBox(height: 100),
                  ],
                ),
              ),
            ),
            _buildBottomBar(appointment, isLoading),
          ],
        ),
      ),
    );
  }

  // ── Empty state ─────────────────────────────────────────────────────────

  Widget _buildNoSelection() {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: Center(
                child: Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceLg,
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Container(
                        width: 96,
                        height: 96,
                        decoration: const BoxDecoration(
                          color: AppColors.gray100,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          Icons.event_busy_rounded,
                          size: 48,
                          color: AppColors.gray400,
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceLg),
                      Text(
                        'No Appointment Selected',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 20,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceSm),
                      Text(
                        'Please select an appointment to reschedule from your appointments list.',
                        textAlign: TextAlign.center,
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 14,
                          fontWeight: FontWeight.w400,
                          color: AppColors.textSecondary,
                          height: DesignTokens.lineHeightRelaxed,
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceXl),
                      SizedBox(
                        width: 200,
                        height: DesignTokens.buttonHeightMd,
                        child: ElevatedButton(
                          onPressed: () => context.pop(),
                          style: ElevatedButton.styleFrom(
                            backgroundColor: AppColors.primary,
                            foregroundColor: AppColors.white,
                            elevation: 0,
                            shape: RoundedRectangleBorder(
                              borderRadius:
                                  BorderRadius.circular(DesignTokens.radiusLg),
                            ),
                          ),
                          child: Text(
                            'Go Back',
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                              color: AppColors.white,
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
    );
  }

  // ── Header ──────────────────────────────────────────────────────────────

  Widget _buildHeader() {
    return Container(
      decoration: const BoxDecoration(
        gradient: AppColors.primaryGradient,
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceSm,
            vertical: DesignTokens.spaceSm,
          ),
          child: Row(
            children: [
              _buildBackButton(),
              Expanded(
                child: Text(
                  'Reschedule',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 18,
                    fontWeight: FontWeight.w700,
                    color: AppColors.white,
                    letterSpacing: DesignTokens.letterSpacingTight,
                  ),
                ),
              ),
              const SizedBox(width: 48),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBackButton() {
    return Material(
      color: Colors.transparent,
      clipBehavior: Clip.antiAlias,
      shape: const CircleBorder(),
      child: InkWell(
        onTap: () => context.pop(),
        child: Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          child: Icon(
            Icons.arrow_back_rounded,
            size: 24,
            color: AppColors.white,
          ),
        ),
      ),
    );
  }

  // ── Current appointment card ────────────────────────────────────────────

  Widget _buildCurrentAppointmentCard(
    Appointment appointment,
    AsyncValue<DoctorDirectoryItem> doctorAsync,
  ) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        boxShadow: [
          BoxShadow(
            color: AppColors.shadow,
            blurRadius: 8,
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
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                ),
                child: Icon(
                  Icons.swap_horiz_rounded,
                  size: 22,
                  color: AppColors.primaryDark,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: Text(
                  'Current Appointment',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          doctorAsync.when(
            loading: () => _buildDoctorSkeleton(),
            error: (_, __) => _buildDoctorRow(
              'Doctor',
              appointment.doctorMembershipId,
              null,
            ),
            data: (doctor) => _buildDoctorRow(
              doctor.displayName,
              doctor.primarySpecialty ?? doctor.practiceName,
              doctor.imageUrl,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Divider(height: 1, thickness: 1, color: AppColors.borderLight),
          const SizedBox(height: DesignTokens.spaceMd),
          Row(
            children: [
              _buildInfoCell(
                Icons.calendar_today_rounded,
                'Date',
                _formatDate(appointment.startsAt),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              _buildInfoCell(
                Icons.access_time_rounded,
                'Time',
                _formatTime(appointment.startsAt),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: 10,
              vertical: 6,
            ),
            decoration: BoxDecoration(
              color: AppColors.secondaryContainer,
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _modeIcon(appointment.mode),
                  size: 16,
                  color: AppColors.secondaryDark,
                ),
                const SizedBox(width: 6),
                Text(
                  _modeLabel(appointment.mode),
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.secondaryDark,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDoctorSkeleton() {
    return Row(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: AppColors.gray100,
            borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
          ),
          child: Icon(Icons.person, size: 24, color: AppColors.gray400),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                height: 14,
                width: 140,
                decoration: BoxDecoration(
                  color: AppColors.gray200,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
              const SizedBox(height: 6),
              Container(
                height: 12,
                width: 100,
                decoration: BoxDecoration(
                  color: AppColors.gray100,
                  borderRadius: BorderRadius.circular(4),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildDoctorRow(String name, String subtitle, String? imageUrl) {
    return Row(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
            color: AppColors.primaryContainer,
          ),
          clipBehavior: Clip.antiAlias,
          child: imageUrl != null && imageUrl.isNotEmpty
              ? Image.network(
                  imageUrl,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => Icon(
                    Icons.person,
                    size: 24,
                    color: AppColors.primaryDark,
                  ),
                )
              : Icon(
                  Icons.person,
                  size: 24,
                  color: AppColors.primaryDark,
                ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 13,
                  fontWeight: FontWeight.w400,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildInfoCell(IconData icon, String label, String value) {
    return Expanded(
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.textSecondary),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                    letterSpacing: DesignTokens.letterSpacingWide,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  maxLines: 1,
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
      ),
    );
  }

  // ── Date selector ───────────────────────────────────────────────────────

  Widget _buildDateSelector() {
    final dates = _dateRange;
    final today = _dateOnly(DateTime.now());

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          child: Text(
            'Select a New Date',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
        ),
        const SizedBox(height: 10),
        SizedBox(
          height: 78,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            physics: const BouncingScrollPhysics(),
            padding:
                const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
            itemCount: dates.length,
            separatorBuilder: (_, __) =>
                const SizedBox(width: DesignTokens.spaceSm),
            itemBuilder: (context, index) {
              final date = dates[index];
              final isSelected = date == _selectedDay;
              final isToday = date == today;
              return _buildDatePill(
                date: date,
                isSelected: isSelected,
                isToday: isToday,
                onTap: () {
                  setState(() {
                    _selectedDay = date;
                    _selectedSlotId = null;
                  });
                },
              );
            },
          ),
        ),
      ],
    );
  }

  Widget _buildDatePill({
    required DateTime date,
    required bool isSelected,
    required bool isToday,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: DesignTokens.animationFast,
        width: 60,
        padding: const EdgeInsets.symmetric(vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary : AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          border: Border.all(
            color: isSelected
                ? AppColors.primary
                : isToday
                    ? AppColors.primaryLight
                    : AppColors.border,
            width: isToday && !isSelected ? 1.5 : 1,
          ),
          boxShadow: [
            if (isSelected)
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.3),
                blurRadius: 8,
                offset: const Offset(0, 3),
              )
            else
              BoxShadow(
                color: AppColors.shadow,
                blurRadius: 4,
                offset: const Offset(0, 1),
              ),
          ],
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text(
              _formatDay(date),
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: isSelected
                    ? AppColors.white.withValues(alpha: 0.85)
                    : AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              '${date.day}',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: isSelected ? AppColors.white : AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: 2),
            Container(
              width: 5,
              height: 5,
              decoration: BoxDecoration(
                color: isToday
                    ? (isSelected ? AppColors.white : AppColors.primary)
                    : Colors.transparent,
                shape: BoxShape.circle,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ── Slots section ───────────────────────────────────────────────────────

  /// Builds the time-slot section.
  ///
  /// Accepts [slotsParams] as the second parameter — this signature is
  /// required by the rest of the codebase and must not be changed.
  Widget _buildSlotsSection(
    AsyncValue<List<AvailabilitySlot>> slotsAsync,
    AppointmentSlotsParams slotsParams,
  ) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Text(
                'Available Time Slots',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const Spacer(),
              Icon(
                Icons.schedule_rounded,
                size: 18,
                color: AppColors.textSecondary,
              ),
            ],
          ),
          const SizedBox(height: 10),
          slotsAsync.when(
            loading: _buildSlotsLoading,
            error: (err, _) => _buildSlotsError(err, slotsParams),
            data: (slots) {
              final daySlots = _slotsForDay(slots);
              if (daySlots.isEmpty) return _buildSlotsEmpty();
              return _buildSlotGroups(daySlots);
            },
          ),
        ],
      ),
    );
  }

  Widget _buildSlotsLoading() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          SizedBox(
            width: 28,
            height: 28,
            child: CircularProgressIndicator(
              strokeWidth: 2.5,
              valueColor: AlwaysStoppedAnimation<Color>(AppColors.primary),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            'Loading available slots…',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSlotsError(Object error, AppointmentSlotsParams slotsParams) {
    final message = error is ApiError
        ? error.userMessage
        : 'Could not load availability. Please try again.';
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: AppColors.errorContainer,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.error.withValues(alpha: 0.2)),
      ),
      child: Column(
        children: [
          Icon(Icons.cloud_off_rounded, size: 36, color: AppColors.error),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            message,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 14,
              fontWeight: FontWeight.w500,
              color: AppColors.errorDark,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          TextButton(
            onPressed: () =>
                ref.invalidate(appointmentSlotsProvider(slotsParams)),
            child: Text(
              'Retry',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.primary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSlotsEmpty() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceLg,
        vertical: DesignTokens.spaceXl,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: const BoxDecoration(
              color: AppColors.gray100,
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.event_available_rounded,
              size: 32,
              color: AppColors.gray400,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            'No slots available on this day',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            'Try selecting a different date from the options above.',
            textAlign: TextAlign.center,
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 13,
              fontWeight: FontWeight.w400,
              color: AppColors.textSecondary,
              height: DesignTokens.lineHeightRelaxed,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSlotGroups(List<AvailabilitySlot> slots) {
    final morning = <AvailabilitySlot>[];
    final afternoon = <AvailabilitySlot>[];
    final evening = <AvailabilitySlot>[];

    for (final slot in slots) {
      final hour = DateTime.parse(slot.startsAt).toLocal().hour;
      if (hour < 12) {
        morning.add(slot);
      } else if (hour < 17) {
        afternoon.add(slot);
      } else {
        evening.add(slot);
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (morning.isNotEmpty) ...[
          _buildSlotGroup('Morning', Icons.wb_sunny_outlined, morning),
          const SizedBox(height: DesignTokens.spaceMd),
        ],
        if (afternoon.isNotEmpty) ...[
          _buildSlotGroup('Afternoon', Icons.wb_sunny_rounded, afternoon),
          const SizedBox(height: DesignTokens.spaceMd),
        ],
        if (evening.isNotEmpty) ...[
          _buildSlotGroup('Evening', Icons.nights_stay_outlined, evening),
        ],
      ],
    );
  }

  Widget _buildSlotGroup(
    String label,
    IconData icon,
    List<AvailabilitySlot> slots,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(icon, size: 18, color: AppColors.textSecondary),
            const SizedBox(width: DesignTokens.spaceSm),
            Text(
              label,
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.textSecondary,
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
              decoration: BoxDecoration(
                color: AppColors.gray100,
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
              ),
              child: Text(
                '${slots.length}',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textSecondary,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Wrap(
          spacing: DesignTokens.spaceSm,
          runSpacing: DesignTokens.spaceSm,
          children: slots.map(_buildSlotChip).toList(),
        ),
      ],
    );
  }

  Widget _buildSlotChip(AvailabilitySlot slot) {
    final isSelected = slot.id == _selectedSlotId;

    return GestureDetector(
      onTap: () {
        setState(() {
          _selectedSlotId = isSelected ? null : slot.id;
        });
      },
      child: AnimatedContainer(
        duration: DesignTokens.animationFast,
        padding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 10,
        ),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary : AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
          border: Border.all(
            color: isSelected ? AppColors.primary : AppColors.border,
            width: 1.5,
          ),
          boxShadow: [
            if (isSelected)
              BoxShadow(
                color: AppColors.primary.withValues(alpha: 0.25),
                blurRadius: 6,
                offset: const Offset(0, 2),
              ),
          ],
        ),
        child: Text(
          _formatTime(slot.startsAt),
          style: TextStyle(
            fontFamily: 'Manrope',
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: isSelected ? AppColors.white : AppColors.textPrimary,
          ),
        ),
      ),
    );
  }

  // ── Bottom bar ──────────────────────────────────────────────────────────

  Widget _buildBottomBar(Appointment appointment, bool isLoading) {
    final canSubmit = _selectedSlotId != null && !isLoading;

    return Container(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
        4,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: Border(top: BorderSide(color: AppColors.border, width: 1)),
        boxShadow: [
          BoxShadow(
            color: AppColors.shadow,
            blurRadius: 8,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: SizedBox(
          height: DesignTokens.buttonHeightLg,
          child: ElevatedButton(
            onPressed: canSubmit ? () => _confirmReschedule(appointment) : null,
            style: ElevatedButton.styleFrom(
              backgroundColor:
                  canSubmit ? AppColors.primary : AppColors.gray300,
              foregroundColor: AppColors.white,
              disabledBackgroundColor: AppColors.gray300,
              disabledForegroundColor: AppColors.white,
              elevation: canSubmit ? 2 : 0,
              shadowColor: AppColors.primary.withValues(alpha: 0.3),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (isLoading) ...[
                  SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor:
                          AlwaysStoppedAnimation<Color>(AppColors.white),
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Text(
                    'Rescheduling…',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.white,
                    ),
                  ),
                ] else ...[
                  Text(
                    'Confirm Reschedule',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.white,
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Icon(Icons.arrow_forward_rounded, size: 22),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
