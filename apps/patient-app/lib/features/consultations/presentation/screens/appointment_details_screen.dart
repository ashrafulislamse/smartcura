import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';
import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/app_state_provider.dart';
import '../../../../core/providers/doctor_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/status_badge.dart';

/// Appointment Details Screen
///
/// Wired to [appointmentDetailProvider] (GET /appointments/{id}). The id
/// arrives either from the route extra (set by the appointments list) or from
/// [selectedAppointmentProvider] as a fallback.
///
/// Shows a status timeline (booked → confirmed → checked-in → in-progress →
/// completed) and action buttons that vary by status and consultation mode.
class AppointmentDetailsScreen extends ConsumerStatefulWidget {
  /// Optional appointment id from the route extra. When null, falls back to
  /// [selectedAppointmentProvider].
  final String? appointmentId;

  const AppointmentDetailsScreen({
    super.key,
    this.appointmentId,
  });

  @override
  ConsumerState<AppointmentDetailsScreen> createState() =>
      _AppointmentDetailsScreenState();
}

class _AppointmentDetailsScreenState
    extends ConsumerState<AppointmentDetailsScreen> {
  String? _resolvedId;
  bool _isCheckingIn = false;

  @override
  void initState() {
    super.initState();
    _resolvedId =
        widget.appointmentId ?? ref.read(selectedAppointmentProvider)?.id;
  }

  @override
  Widget build(BuildContext context) {
    if (_resolvedId == null || _resolvedId!.isEmpty) {
      return _buildNoSelection(context);
    }

    final appointmentAsync = ref.watch(appointmentDetailProvider(_resolvedId!));

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
        body: appointmentAsync.when(
          loading: () => _buildLoading(context),
          error: (error, _) => _buildErrorView(context, error),
          data: (appointment) => _buildContent(context, appointment),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------
  Widget _buildLoading(BuildContext context) {
    return SafeArea(
      child: Column(
        children: [
          _buildHeader(context, null),
          const Expanded(
            child: Center(
              child: CircularProgressIndicator(color: AppColors.primary),
            ),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // No selection / error states
  // -------------------------------------------------------------------------
  Widget _buildNoSelection(BuildContext context) {
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
              _buildHeader(context, null),
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
                            Icons.event_outlined,
                            size: 40,
                            color: AppColors.gray400,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceLg),
                        const Text(
                          'No appointment selected',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceSm),
                        const Text(
                          'Choose an appointment from your list to view its details.',
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
                          width: 200,
                          height: DesignTokens.buttonHeightMd,
                          child: ElevatedButton(
                            onPressed: () => context.go('/schedule'),
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
                              'View Appointments',
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

  Widget _buildErrorView(BuildContext context, Object error) {
    return SafeArea(
      child: Column(
        children: [
          _buildHeader(context, null),
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
                        color: AppColors.errorContainer,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.cloud_off,
                        size: 40,
                        color: AppColors.error,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                    const Text(
                      'Could not load appointment',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 18,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceSm),
                    Text(
                      _errorMessage(error),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 14,
                        fontWeight: FontWeight.w400,
                        color: AppColors.textSecondary,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceXl),
                    SizedBox(
                      width: 200,
                      height: DesignTokens.buttonHeightMd,
                      child: OutlinedButton(
                        onPressed: () {
                          ref.invalidate(
                              appointmentDetailProvider(_resolvedId!));
                        },
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.primary,
                          side: const BorderSide(color: AppColors.primary),
                          shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusLg),
                          ),
                        ),
                        child: const Text(
                          'Try Again',
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
    );
  }

  // -------------------------------------------------------------------------
  // Main content
  // -------------------------------------------------------------------------
  Widget _buildContent(BuildContext context, Appointment appointment) {
    final doctorAsync =
        ref.watch(doctorDetailProvider(appointment.doctorMembershipId));

    return SafeArea(
      child: Column(
        children: [
          _buildHeader(context, appointment),
          Expanded(
            child: doctorAsync.when(
              loading: () => _buildDoctorLoading(context),
              error: (_, __) => _buildContentBody(context, appointment, null),
              data: (doctor) => _buildContentBody(context, appointment, doctor),
            ),
          ),
          _buildBottomBar(context, appointment),
        ],
      ),
    );
  }

  Widget _buildDoctorLoading(BuildContext context) {
    return const Center(
      child: Padding(
        padding: EdgeInsets.only(top: 100),
        child: CircularProgressIndicator(color: AppColors.primary),
      ),
    );
  }

  Widget _buildContentBody(
    BuildContext context,
    Appointment appointment,
    DoctorDirectoryItem? doctor,
  ) {
    return SingleChildScrollView(
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
          _buildDoctorCard(context, appointment, doctor),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildScheduleCard(context, appointment),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildConsultationTypeCard(context, appointment),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildFeeCard(context, appointment),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildTimelineCard(context, appointment),
          const SizedBox(height: DesignTokens.spaceLg),
          if (appointment.cancellationReasonCode != null)
            _buildCancellationInfo(context, appointment),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Header (custom — no AppBar)
  // -------------------------------------------------------------------------
  Widget _buildHeader(BuildContext context, Appointment? appointment) {
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
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Appointment Details',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    height: 1.2,
                  ),
                ),
                if (appointment != null) ...[
                  const SizedBox(height: 2),
                  Row(
                    children: [
                      Text(
                        _formatFullDate(_parseDateTime(appointment.startsAt)),
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textSecondary,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        '#${appointment.id.substring(0, 8)}',
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          if (appointment != null) _statusBadge(appointment.status),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Doctor card
  // -------------------------------------------------------------------------
  Widget _buildDoctorCard(
    BuildContext context,
    Appointment appointment,
    DoctorDirectoryItem? doctor,
  ) {
    final name = doctor?.displayName ?? 'Doctor';
    final specialty = doctor?.primarySpecialty ?? 'Medical Professional';
    final rating = doctor?.ratingAverage ?? 0.0;
    final reviewCount = doctor?.reviewCount ?? 0;

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
                imageUrl: doctor?.imageUrl,
                name: name,
                size: 64,
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
                      name,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                        color: AppColors.white,
                        height: 1.2,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      specialty,
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                        color: AppColors.white.withValues(alpha: 0.85),
                      ),
                    ),
                    if (reviewCount > 0) ...[
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Icon(
                            Icons.star,
                            size: 14,
                            color: AppColors.warning,
                          ),
                          const SizedBox(width: 4),
                          Text(
                            '${rating.toStringAsFixed(1)} ($reviewCount reviews)',
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: AppColors.white.withValues(alpha: 0.9),
                            ),
                          ),
                        ],
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
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  _modeInfo(appointment.mode).$2,
                  size: 16,
                  color: AppColors.white,
                ),
                const SizedBox(width: DesignTokens.spaceXs + 2),
                Text(
                  _modeInfo(appointment.mode).$1,
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.white,
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
  // Schedule card
  // -------------------------------------------------------------------------
  Widget _buildScheduleCard(BuildContext context, Appointment appointment) {
    final start = _parseDateTime(appointment.startsAt);
    final end = _parseDateTime(appointment.endsAt);

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
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: const Icon(
                  Icons.calendar_today,
                  size: 20,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              const Text(
                'Schedule',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          _detailRow(
            Icons.event_outlined,
            'Date',
            _formatFullDate(start),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Container(
            height: 1,
            color: AppColors.gray100,
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          _detailRow(
            Icons.access_time,
            'Time',
            '${_formatTime(start)} – ${_formatTime(end)}',
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Container(
            height: 1,
            color: AppColors.gray100,
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          _detailRow(
            Icons.timelapse,
            'Duration',
            _formatDuration(start, end),
          ),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Consultation type card
  // -------------------------------------------------------------------------
  Widget _buildConsultationTypeCard(
      BuildContext context, Appointment appointment) {
    final (label, icon) = _modeInfo(appointment.mode);
    final color = _modeColor(appointment.mode);

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
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            ),
            child: Icon(icon, size: 28, color: color),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Consultation Type',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  label,
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
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

  // -------------------------------------------------------------------------
  // Fee card
  // -------------------------------------------------------------------------
  Widget _buildFeeCard(BuildContext context, Appointment appointment) {
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
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.secondaryContainer,
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: const Icon(
              Icons.payments_outlined,
              size: 20,
              color: AppColors.secondaryDark,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Consultation Fee',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  _paymentStateLabel(appointment.paymentState),
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                    color: _paymentStateColor(appointment.paymentState),
                  ),
                ),
              ],
            ),
          ),
          Text(
            _formatMoney(appointment.feeSen, appointment.currency),
            style: const TextStyle(
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
  // Timeline card
  // -------------------------------------------------------------------------
  Widget _buildTimelineCard(BuildContext context, Appointment appointment) {
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
            'Appointment Progress',
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          _StatusTimeline(status: appointment.status),
        ],
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Cancellation info
  // -------------------------------------------------------------------------
  Widget _buildCancellationInfo(BuildContext context, Appointment appointment) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.errorContainer,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(
          color: AppColors.error.withValues(alpha: 0.2),
        ),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.info_outline,
            size: 20,
            color: AppColors.error,
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Cancellation Reason',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.errorDark,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _reasonLabel(appointment.cancellationReasonCode),
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: AppColors.errorDark,
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
  // Detail row helper
  // -------------------------------------------------------------------------
  Widget _detailRow(IconData icon, String label, String value) {
    return Row(
      children: [
        Icon(icon, size: 18, color: AppColors.textSecondary),
        const SizedBox(width: DesignTokens.spaceSm),
        Text(
          label,
          style: const TextStyle(
            fontFamily: 'Manrope',
            fontSize: 13,
            fontWeight: FontWeight.w500,
            color: AppColors.textSecondary,
          ),
        ),
        const Spacer(),
        Flexible(
          child: Text(
            value,
            textAlign: TextAlign.right,
            style: const TextStyle(
              fontFamily: 'Manrope',
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
        ),
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Bottom bar
  // -------------------------------------------------------------------------
  Widget _buildBottomBar(BuildContext context, Appointment appointment) {
    final status = appointment.status;
    final canJoin = _canJoin(appointment);
    final canCancel = _canCancel(appointment);
    final canReschedule = _canReschedule(appointment);

    final isCompleted = status == AppointmentStatus.completed;
    final isCancelled = status == AppointmentStatus.cancelled ||
        status == AppointmentStatus.noShow ||
        status == AppointmentStatus.rescheduled;

    if (isCompleted || isCancelled) {
      // Single primary action for terminal states
      return _buildBottomContainer(
        child: SizedBox(
          width: double.infinity,
          height: DesignTokens.buttonHeightLg,
          child: ElevatedButton(
            onPressed: () => context.go('/find-doctor'),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: AppColors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.add_circle_outline, size: 20),
                const SizedBox(width: DesignTokens.spaceSm),
                Text(
                  isCompleted ? 'Book Again' : 'Book New Appointment',
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    if (canJoin && !canCancel) {
      // checked_in or in_progress — just join
      return _buildBottomContainer(
        child: SizedBox(
          width: double.infinity,
          height: DesignTokens.buttonHeightLg,
          child: ElevatedButton(
            onPressed:
                _isCheckingIn ? null : () => _onJoin(context, appointment),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: AppColors.white,
              elevation: 0,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              ),
            ),
            child: _isCheckingIn
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(
                      strokeWidth: 2.5,
                      valueColor:
                          AlwaysStoppedAnimation<Color>(AppColors.white),
                    ),
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.video_call, size: 22),
                      const SizedBox(width: DesignTokens.spaceSm),
                      Text(
                        _joinLabel(appointment.mode),
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      );
    }

    // scheduled / confirmed — three actions
    return _buildBottomContainer(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          SizedBox(
            width: double.infinity,
            height: DesignTokens.buttonHeightLg,
            child: ElevatedButton(
              onPressed:
                  _isCheckingIn ? null : () => _onJoin(context, appointment),
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
              child: _isCheckingIn
                  ? const SizedBox(
                      height: 22,
                      width: 22,
                      child: CircularProgressIndicator(
                        strokeWidth: 2.5,
                        valueColor:
                            AlwaysStoppedAnimation<Color>(AppColors.white),
                      ),
                    )
                  : Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.login, size: 20),
                        const SizedBox(width: DesignTokens.spaceSm),
                        Text(
                          'Check In & Join',
                          style: const TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                      ],
                    ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Row(
            children: [
              Expanded(
                child: SizedBox(
                  height: DesignTokens.buttonHeightMd,
                  child: OutlinedButton(
                    onPressed: canReschedule
                        ? () => context.push('/reschedule-appointment')
                        : null,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.primary,
                      side: const BorderSide(color: AppColors.primary),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusLg),
                      ),
                    ),
                    child: const Text(
                      'Reschedule',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: SizedBox(
                  height: DesignTokens.buttonHeightMd,
                  child: TextButton(
                    onPressed: canCancel
                        ? () => _showCancelDialog(context, appointment)
                        : null,
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.error,
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusLg),
                      ),
                    ),
                    child: const Text(
                      'Cancel',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBottomContainer({required Widget child}) {
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
        child: child,
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /// Check-in then navigate to the consultation room.
  void _onJoin(BuildContext context, Appointment appointment) async {
    final status = appointment.status;

    // If already checked in or in progress, skip the check-in API call.
    if (status != AppointmentStatus.checkedIn &&
        status != AppointmentStatus.inProgress) {
      setState(() => _isCheckingIn = true);

      try {
        await ref.read(apiClientProvider).put<dynamic>(
          ApiEndpoints.appointmentStatus(appointment.id),
          data: {
            'status': 'checked_in',
            'expected_version': appointment.version,
          },
        );
        // Invalidate so the detail screen refetches the updated version.
        ref.invalidate(appointmentDetailProvider(appointment.id));
      } catch (e) {
        if (!mounted) return;
        setState(() => _isCheckingIn = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Check-in failed: ${_errorMessage(e)}'),
            backgroundColor: AppColors.error,
          ),
        );
        return;
      }

      if (!mounted) return;
      setState(() => _isCheckingIn = false);
    }

    final doctorAsync =
        ref.read(doctorDetailProvider(appointment.doctorMembershipId));
    final doctorName =
        doctorAsync.whenOrNull(data: (d) => d.displayName) ?? 'Doctor';
    final specialty =
        doctorAsync.whenOrNull(data: (d) => d.primarySpecialty) ?? '';

    final route = appointment.mode == AppointmentMode.audio
        ? '/audio-consultation'
        : '/video-consultation';

    if (!mounted) return;
    context.push(route, extra: {
      'appointmentId': appointment.id,
      'doctorName': doctorName,
      'specialty': specialty,
    });
  }

  void _showCancelDialog(BuildContext context, Appointment appointment) {
    AppointmentCancellationReasonCode? selectedReason;

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(DesignTokens.radius2xl),
        ),
      ),
      builder: (sheetContext) => StatefulBuilder(
        builder: (ctx, setState) => Padding(
          padding: EdgeInsets.only(
            bottom: MediaQuery.of(ctx).viewInsets.bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // Handle
              Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(top: DesignTokens.spaceMd),
                decoration: BoxDecoration(
                  color: AppColors.gray200,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                ),
              ),
              Padding(
                padding: const EdgeInsets.all(DesignTokens.spaceLg),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 44,
                          height: 44,
                          decoration: BoxDecoration(
                            color: AppColors.errorContainer,
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusMd),
                          ),
                          child: const Icon(
                            Icons.cancel_outlined,
                            color: AppColors.error,
                            size: 22,
                          ),
                        ),
                        const SizedBox(width: DesignTokens.spaceMd),
                        const Text(
                          'Cancel Appointment',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                    const Text(
                      'Please select a reason for cancellation. This helps us improve our service.',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 14,
                        fontWeight: FontWeight.w400,
                        color: AppColors.textSecondary,
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                    Container(
                      decoration: BoxDecoration(
                        border: Border.all(color: AppColors.gray200),
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusLg),
                      ),
                      child: DropdownButtonFormField<
                          AppointmentCancellationReasonCode>(
                        value: selectedReason,
                        decoration: InputDecoration(
                          labelText: 'Reason',
                          labelStyle: const TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 14,
                            fontWeight: FontWeight.w500,
                            color: AppColors.textSecondary,
                          ),
                          border: InputBorder.none,
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: DesignTokens.spaceMd,
                            vertical: DesignTokens.spaceSm + 2,
                          ),
                          prefixIcon: const Icon(
                            Icons.feedback_outlined,
                            size: 20,
                            color: AppColors.textSecondary,
                          ),
                        ),
                        items: const [
                          DropdownMenuItem(
                            value: AppointmentCancellationReasonCode
                                .patientRequest,
                            child: Text(
                              'Patient request',
                              style: TextStyle(fontFamily: 'Manrope'),
                            ),
                          ),
                          DropdownMenuItem(
                            value: AppointmentCancellationReasonCode
                                .scheduleConflict,
                            child: Text(
                              'Schedule conflict',
                              style: TextStyle(fontFamily: 'Manrope'),
                            ),
                          ),
                          DropdownMenuItem(
                            value: AppointmentCancellationReasonCode
                                .duplicateBooking,
                            child: Text(
                              'Duplicate booking',
                              style: TextStyle(fontFamily: 'Manrope'),
                            ),
                          ),
                        ],
                        onChanged: (v) => setState(() => selectedReason = v),
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                    Row(
                      children: [
                        Expanded(
                          child: SizedBox(
                            height: DesignTokens.buttonHeightLg,
                            child: OutlinedButton(
                              onPressed: () => Navigator.pop(ctx),
                              style: OutlinedButton.styleFrom(
                                foregroundColor: AppColors.textPrimary,
                                side:
                                    const BorderSide(color: AppColors.gray300),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(
                                      DesignTokens.radiusLg),
                                ),
                              ),
                              child: const Text(
                                'Keep Appointment',
                                style: TextStyle(
                                  fontFamily: 'Manrope',
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                        ),
                        const SizedBox(width: DesignTokens.spaceSm),
                        Expanded(
                          child: SizedBox(
                            height: DesignTokens.buttonHeightLg,
                            child: ElevatedButton(
                              onPressed: selectedReason == null
                                  ? null
                                  : () {
                                      Navigator.pop(ctx);
                                      _performCancel(context, appointment,
                                          selectedReason!);
                                    },
                              style: ElevatedButton.styleFrom(
                                backgroundColor: AppColors.error,
                                foregroundColor: AppColors.white,
                                disabledBackgroundColor:
                                    AppColors.error.withValues(alpha: 0.4),
                                elevation: 0,
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(
                                      DesignTokens.radiusLg),
                                ),
                              ),
                              child: const Text(
                                'Cancel',
                                style: TextStyle(
                                  fontFamily: 'Manrope',
                                  fontSize: 15,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _performCancel(
    BuildContext context,
    Appointment appointment,
    AppointmentCancellationReasonCode reason,
  ) async {
    await ref.read(bookingMutationProvider.notifier).cancel(
          appointmentId: appointment.id,
          reasonCode: reason,
          expectedVersion: appointment.version,
        );

    if (!mounted) return;

    final mutationState = ref.read(bookingMutationProvider);
    if (mutationState.hasError) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content:
              Text('Could not cancel: ${_errorMessage(mutationState.error)}'),
          backgroundColor: AppColors.error,
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Appointment cancelled'),
          backgroundColor: AppColors.success,
        ),
      );
      ref.invalidate(appointmentDetailProvider(appointment.id));
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------
  bool _canJoin(Appointment a) {
    return (a.mode == AppointmentMode.video ||
            a.mode == AppointmentMode.audio) &&
        (a.status == AppointmentStatus.confirmed ||
            a.status == AppointmentStatus.pendingPayment ||
            a.status == AppointmentStatus.checkedIn ||
            a.status == AppointmentStatus.inProgress);
  }

  bool _canCancel(Appointment a) {
    return a.status == AppointmentStatus.pendingPayment ||
        a.status == AppointmentStatus.confirmed ||
        a.status == AppointmentStatus.checkedIn;
  }

  bool _canReschedule(Appointment a) {
    return a.status == AppointmentStatus.pendingPayment ||
        a.status == AppointmentStatus.confirmed ||
        a.status == AppointmentStatus.checkedIn;
  }

  String _joinLabel(AppointmentMode mode) {
    return switch (mode) {
      AppointmentMode.audio => 'Join Audio Call',
      AppointmentMode.video => 'Join Video Call',
      _ => 'Join Consultation',
    };
  }

  (String, IconData) _modeInfo(AppointmentMode mode) {
    return switch (mode) {
      AppointmentMode.video => ('Video Consultation', Icons.videocam),
      AppointmentMode.audio => ('Audio Consultation', Icons.phone_in_talk),
      AppointmentMode.inPerson => ('In-person Visit', Icons.location_on),
      AppointmentMode.chat => ('Chat Consultation', Icons.chat_bubble_outline),
      AppointmentMode.unknown => ('Consultation', Icons.help_outline),
    };
  }

  Color _modeColor(AppointmentMode mode) {
    return switch (mode) {
      AppointmentMode.video => AppColors.primary,
      AppointmentMode.audio => AppColors.secondary,
      AppointmentMode.inPerson => AppColors.warning,
      AppointmentMode.chat => AppColors.info,
      AppointmentMode.unknown => AppColors.gray400,
    };
  }

  Widget _statusBadge(AppointmentStatus status) {
    final (text, tone) = _statusMapping(status);
    return StatusBadge(text: text, tone: tone, small: true);
  }

  (String, StatusTone) _statusMapping(AppointmentStatus status) {
    return switch (status) {
      AppointmentStatus.pendingPayment => ('Pending', StatusTone.warning),
      AppointmentStatus.confirmed => ('Confirmed', StatusTone.info),
      AppointmentStatus.checkedIn => ('Checked In', StatusTone.info),
      AppointmentStatus.inProgress => ('In Progress', StatusTone.success),
      AppointmentStatus.completed => ('Completed', StatusTone.success),
      AppointmentStatus.cancelled => ('Cancelled', StatusTone.error),
      AppointmentStatus.noShow => ('No Show', StatusTone.neutral),
      AppointmentStatus.rescheduled => ('Rescheduled', StatusTone.warning),
      AppointmentStatus.unknown => ('Unknown', StatusTone.neutral),
    };
  }

  String _reasonLabel(AppointmentReasonCode? code) {
    if (code == null) return 'Unknown';
    return switch (code) {
      AppointmentReasonCode.patientRequest => 'Patient request',
      AppointmentReasonCode.doctorUnavailable => 'Doctor unavailable',
      AppointmentReasonCode.scheduleConflict => 'Schedule conflict',
      AppointmentReasonCode.paymentExpired => 'Payment expired',
      AppointmentReasonCode.duplicateBooking => 'Duplicate booking',
      AppointmentReasonCode.clinicalReason => 'Clinical reason',
      AppointmentReasonCode.administrativeAction => 'Administrative action',
      AppointmentReasonCode.patientAbsent => 'Patient absent',
      AppointmentReasonCode.patientLate => 'Patient late',
      AppointmentReasonCode.patientUnreachable => 'Patient unreachable',
      AppointmentReasonCode.rescheduled => 'Rescheduled',
      AppointmentReasonCode.unknown => 'Unknown',
    };
  }

  String _paymentStateLabel(AppointmentPaymentState? state) {
    if (state == null) return 'Pay at appointment';
    return switch (state) {
      AppointmentPaymentState.pending => 'Payment pending',
      AppointmentPaymentState.captured => 'Payment captured',
      AppointmentPaymentState.refunded => 'Payment refunded',
      AppointmentPaymentState.failed => 'Payment failed',
      AppointmentPaymentState.unknown => 'Payment status unknown',
    };
  }

  Color _paymentStateColor(AppointmentPaymentState? state) {
    if (state == null) return AppColors.textSecondary;
    return switch (state) {
      AppointmentPaymentState.pending => AppColors.warning,
      AppointmentPaymentState.captured => AppColors.success,
      AppointmentPaymentState.refunded => AppColors.info,
      AppointmentPaymentState.failed => AppColors.error,
      AppointmentPaymentState.unknown => AppColors.gray400,
    };
  }

  String _formatMoney(int sen, String currency) {
    final rm = (sen / 100).toStringAsFixed(2);
    return currency == 'MYR' ? 'RM $rm' : '$currency $rm';
  }

  DateTime _parseDateTime(String iso) {
    return DateTime.tryParse(iso) ?? DateTime.now();
  }

  String _formatTime(DateTime dt) {
    final hour = dt.hour > 12 ? dt.hour - 12 : (dt.hour == 0 ? 12 : dt.hour);
    final minute = dt.minute.toString().padLeft(2, '0');
    final amPm = dt.hour >= 12 ? 'PM' : 'AM';
    return '$hour:$minute $amPm';
  }

  String _formatFullDate(DateTime dt) {
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

  String _formatDuration(DateTime start, DateTime end) {
    final diff = end.difference(start);
    if (diff.inHours > 0) {
      return '${diff.inHours}h ${diff.inMinutes % 60}m';
    }
    return '${diff.inMinutes}m';
  }

  String _errorMessage(Object? error) {
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return 'Request failed';
  }
}

// -----------------------------------------------------------------------------
// Status Timeline widget
// -----------------------------------------------------------------------------

class _StatusTimeline extends StatelessWidget {
  final AppointmentStatus status;

  const _StatusTimeline({required this.status});

  static const _steps = [
    (AppointmentStatus.pendingPayment, 'Booked', Icons.event_available),
    (AppointmentStatus.confirmed, 'Confirmed', Icons.verified),
    (AppointmentStatus.checkedIn, 'Checked In', Icons.login),
    (AppointmentStatus.inProgress, 'In Progress', Icons.play_circle),
    (AppointmentStatus.completed, 'Completed', Icons.check_circle),
  ];

  int _currentStepIndex() {
    return switch (status) {
      AppointmentStatus.pendingPayment => 0,
      AppointmentStatus.confirmed => 1,
      AppointmentStatus.checkedIn => 2,
      AppointmentStatus.inProgress => 3,
      AppointmentStatus.completed => 4,
      AppointmentStatus.cancelled => -1,
      AppointmentStatus.noShow => -1,
      AppointmentStatus.rescheduled => -1,
      AppointmentStatus.unknown => -1,
    };
  }

  @override
  Widget build(BuildContext context) {
    final currentIndex = _currentStepIndex();

    if (currentIndex < 0) {
      return _buildTerminalState();
    }

    return Column(
      children: List.generate(_steps.length * 2 - 1, (i) {
        if (i.isOdd) {
          final stepIdx = i ~/ 2;
          final isCompleted = stepIdx < currentIndex;
          return _buildConnector(isCompleted);
        }
        final index = i ~/ 2;
        final (_, label, icon) = _steps[index];
        final isCompleted = index < currentIndex;
        final isCurrent = index == currentIndex;
        return _buildStep(
          icon: icon,
          label: label,
          isCompleted: isCompleted,
          isCurrent: isCurrent,
        );
      }),
    );
  }

  Widget _buildStep({
    required IconData icon,
    required String label,
    required bool isCompleted,
    required bool isCurrent,
  }) {
    final color =
        isCompleted || isCurrent ? AppColors.primary : AppColors.gray300;

    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: isCompleted
                ? AppColors.primary
                : isCurrent
                    ? AppColors.primaryContainer
                    : AppColors.gray100,
            shape: BoxShape.circle,
            border: Border.all(
              color: color,
              width: isCurrent
                  ? 2.5
                  : isCompleted
                      ? 0
                      : 1.5,
            ),
          ),
          child: Icon(
            isCompleted ? Icons.check : icon,
            size: 18,
            color: isCompleted
                ? AppColors.white
                : isCurrent
                    ? AppColors.primary
                    : AppColors.gray400,
          ),
        ),
        const SizedBox(width: DesignTokens.spaceMd),
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 14,
              fontWeight:
                  isCurrent || isCompleted ? FontWeight.w700 : FontWeight.w500,
              color: isCurrent || isCompleted
                  ? AppColors.textPrimary
                  : AppColors.textSecondary,
            ),
          ),
        ),
        if (isCurrent)
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceSm,
              vertical: DesignTokens.spaceXs,
            ),
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            ),
            child: const Text(
              'Now',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 10,
                fontWeight: FontWeight.w700,
                color: AppColors.primaryDark,
              ),
            ),
          ),
      ],
    );
  }

  Widget _buildConnector(bool isCompleted) {
    return Padding(
      padding: const EdgeInsets.only(left: 19),
      child: Container(
        width: 2,
        height: 24,
        color: isCompleted ? AppColors.primary : AppColors.gray200,
      ),
    );
  }

  Widget _buildTerminalState() {
    final (label, icon, color) = switch (status) {
      AppointmentStatus.cancelled => (
          'Appointment Cancelled',
          Icons.cancel_outlined,
          AppColors.error
        ),
      AppointmentStatus.noShow => (
          'Marked as No-Show',
          Icons.person_off_outlined,
          AppColors.gray500
        ),
      AppointmentStatus.rescheduled => (
          'Rescheduled',
          Icons.swap_horiz,
          AppColors.warning
        ),
      AppointmentStatus.unknown => (
          'Status Unknown',
          Icons.help_outline,
          AppColors.gray400
        ),
      _ => ('', Icons.circle, AppColors.gray400),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 28),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Text(
              label,
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: color,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
