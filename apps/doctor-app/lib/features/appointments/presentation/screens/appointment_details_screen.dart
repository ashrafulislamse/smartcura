import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/consultation_provider.dart';
import '../../../../core/providers/iot_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Appointment Details Screen — Full Screen (No Bottom Nav).
///
/// Wired to real backend data via Riverpod providers:
/// - [appointmentDetailProvider] (GET /appointments/{id}) for the appointment.
/// - [doctorPatientDetailProvider] (GET /doctor/patients/{id}) for resolving
///   the patient's display name and contact info (Profile is reachable only as
///   /profiles/me, so the appointment carries no names).
/// - [patientVitalReadingsProvider] (GET /patients/{id}/vital-readings) for the
///   latest vitals summary.
/// - [appointmentTransitionProvider] (PUT /appointments/{id}/status) for
///   complete / no-show / cancel actions.
/// - [createConsultationProvider] (POST /appointments/{id}/consultation) for
///   starting a video/audio consultation, which navigates to the consultation
///   room.
///
/// All four resource states (loading, error, empty, loaded) are rendered
/// distinctly.
class AppointmentDetailsScreen extends ConsumerStatefulWidget {
  const AppointmentDetailsScreen({super.key, this.appointmentId});

  final String? appointmentId;

  @override
  ConsumerState<AppointmentDetailsScreen> createState() =>
      _AppointmentDetailsScreenState();
}

class _AppointmentDetailsScreenState
    extends ConsumerState<AppointmentDetailsScreen> {
  bool _actionLoading = false;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  DateTime? _parseTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso);
  }

  IconData _modeIcon(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => Icons.videocam_rounded,
        AppointmentMode.audio => Icons.phone_in_talk_rounded,
        AppointmentMode.chat => Icons.chat_bubble_rounded,
        AppointmentMode.inPerson => Icons.person_rounded,
        AppointmentMode.unknown => Icons.event_rounded,
      };

  String _modeLabel(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => 'Video Call',
        AppointmentMode.audio => 'Audio Call',
        AppointmentMode.chat => 'Chat',
        AppointmentMode.inPerson => 'In-Person Visit',
        AppointmentMode.unknown => 'Appointment',
      };

  StatusBadgeTone _statusTone(AppointmentStatus status) => switch (status) {
        AppointmentStatus.pendingPayment => StatusBadgeTone.warning,
        AppointmentStatus.confirmed => StatusBadgeTone.success,
        AppointmentStatus.checkedIn => StatusBadgeTone.info,
        AppointmentStatus.inProgress => StatusBadgeTone.primary,
        AppointmentStatus.cancelled => StatusBadgeTone.error,
        AppointmentStatus.completed => StatusBadgeTone.neutral,
        AppointmentStatus.noShow => StatusBadgeTone.error,
        AppointmentStatus.rescheduled => StatusBadgeTone.info,
        AppointmentStatus.unknown => StatusBadgeTone.neutral,
      };

  String _statusLabel(AppointmentStatus status) => switch (status) {
        AppointmentStatus.pendingPayment => 'Pending',
        AppointmentStatus.confirmed => 'Confirmed',
        AppointmentStatus.checkedIn => 'Checked In',
        AppointmentStatus.inProgress => 'In Progress',
        AppointmentStatus.cancelled => 'Cancelled',
        AppointmentStatus.completed => 'Completed',
        AppointmentStatus.noShow => 'No Show',
        AppointmentStatus.rescheduled => 'Rescheduled',
        AppointmentStatus.unknown => 'Unknown',
      };

  String _formatTime(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '--:--';
    return DateFormat.jm().format(dt);
  }

  String _formatDate(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '';
    return DateFormat('EEE, MMM d, yyyy').format(dt);
  }

  /// Integer sen → "RM X.XX" (the single place money is formatted for display).
  String _formatSen(int sen) {
    final ringgit = sen / 100;
    return 'RM ${ringgit.toStringAsFixed(2)}';
  }

  /// The ordered status steps for the horizontal timeline.
  static const _timelineSteps = <AppointmentStatus>[
    AppointmentStatus.pendingPayment,
    AppointmentStatus.confirmed,
    AppointmentStatus.checkedIn,
    AppointmentStatus.inProgress,
    AppointmentStatus.completed,
  ];

  static const _stepLabels = <String>[
    'Booked',
    'Confirmed',
    'Checked In',
    'In Progress',
    'Completed',
  ];

  /// The index of the current step in the timeline, or -1 if the status is not
  /// on the main happy path (cancelled / no_show / rescheduled).
  int _currentStepIndex(AppointmentStatus status) {
    final idx = _timelineSteps.indexOf(status);
    return idx;
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  Future<void> _transitionStatus(Appointment appt, String newStatus) async {
    setState(() => _actionLoading = true);
    try {
      final notifier = ref.read(appointmentTransitionProvider.notifier);
      final ok = await notifier.transition(
        appointmentId: appt.id,
        status: newStatus,
        expectedVersion: appt.version,
        cancellationReasonCode: newStatus == 'cancelled'
            ? AppointmentCancellationReasonCode.doctorUnavailable
            : null,
        noShowReasonCode: newStatus == 'no_show'
            ? AppointmentNoShowReasonCode.patientAbsent
            : null,
      );
      if (ok) {
        ref.invalidate(appointmentDetailProvider(appt.id));
        ref.invalidate(appointmentsProvider);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(
                  'Status updated to ${_statusLabel(appointmentStatusFromWire(newStatus))}.'),
              duration: const Duration(seconds: 2),
            ),
          );
        }
      } else {
        _showMutationError();
      }
    } catch (e) {
      _showMutationError(e);
    } finally {
      if (mounted) setState(() => _actionLoading = false);
    }
  }

  Future<void> _startConsultation(Appointment appt) async {
    setState(() => _actionLoading = true);
    try {
      final notifier = ref.read(createConsultationProvider.notifier);
      final consultation = await notifier.call(appt.id);
      debugPrint(
          '[DoctorAppt] createConsultation result: ${consultation?.consultationId}');
      if (consultation != null) {
        ref.invalidate(appointmentDetailProvider(appt.id));
        ref.invalidate(appointmentsProvider);
        if (mounted) {
          context.push('/video-consultation',
              extra: consultation.consultationId);
        }
      } else {
        final err = ref.read(createConsultationProvider).error;
        debugPrint('[DoctorAppt] createConsultation failed: $err');
        _showMutationError(err);
      }
    } catch (e) {
      debugPrint('[DoctorAppt] startConsultation exception: $e');
      _showMutationError(e);
    } finally {
      if (mounted) setState(() => _actionLoading = false);
    }
  }

  void _showMutationError([Object? e]) {
    String msg;
    if (e is ApiError) {
      msg = e.displayMessage;
    } else if (ref.read(createConsultationProvider).error is ApiError) {
      msg = (ref.read(createConsultationProvider).error as ApiError)
          .displayMessage;
    } else if (ref.read(appointmentTransitionProvider).error is ApiError) {
      msg = (ref.read(appointmentTransitionProvider).error as ApiError)
          .displayMessage;
    } else {
      msg = 'Could not complete the action. Please try again.';
    }
    debugPrint('[AppointmentDetails] mutation error: $e');
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg)),
      );
    }
  }

  Future<void> _confirmCancel(Appointment appt) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Cancel Appointment'),
        content: const Text(
            'Are you sure you want to cancel this appointment? This cannot be undone.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Keep'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(backgroundColor: AppColors.error),
            child: const Text('Cancel Appointment'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _transitionStatus(appt, 'cancelled');
    }
  }

  Future<void> _confirmNoShow(Appointment appt) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Mark as No-Show'),
        content: const Text(
            'Mark this appointment as a no-show? The patient will be notified.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Dismiss'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('Mark No-Show'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      await _transitionStatus(appt, 'no_show');
    }
  }

  // ------------------------------------------------------------------
  // Build
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final id = widget.appointmentId;
    if (id == null || id.isEmpty) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          backgroundColor: AppColors.surface,
          elevation: 0,
          leading: IconButton(
            icon:
                const Icon(Icons.arrow_back_rounded, color: AppColors.gray900),
            onPressed: () => Navigator.pop(context),
          ),
          title: Text('Appointment Details',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold, color: AppColors.gray900)),
          centerTitle: true,
        ),
        body: const ErrorView(
          message: 'No appointment was selected.',
          isForbidden: true,
        ),
      );
    }

    final apptAsync = ref.watch(appointmentDetailProvider(id));

    return Scaffold(
      backgroundColor: AppColors.background,
      body: apptAsyncBody(apptAsync, id),
    );
  }

  Widget apptAsyncBody(AsyncValue<Appointment> apptAsync, String id) {
    return apptAsync.when(
      data: (appt) => _buildContent(appt),
      loading: () => _buildLoading(),
      error: (err, _) {
        final apiError = err is ApiError ? err : toApiError(err);
        return _buildErrorScaffold(apiError, id);
      },
    );
  }

  Widget _buildErrorScaffold(ApiError apiError, String id) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: AppColors.gray900),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text('Appointment Details',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold, color: AppColors.gray900)),
        centerTitle: true,
      ),
      body: ErrorView(
        message: apiError.displayMessage,
        onRetry: apiError.isForbidden
            ? null
            : () => ref.invalidate(appointmentDetailProvider(id)),
        isForbidden: apiError.isForbidden,
      ),
    );
  }

  Widget _buildLoading() {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: AppColors.gray900),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text('Appointment Details',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold, color: AppColors.gray900)),
        centerTitle: true,
      ),
      body: const LoadingOverlay(label: 'Loading appointment...'),
    );
  }

  Widget _buildContent(Appointment appt) {
    // Watch the patient detail for name resolution.
    final patientAsync =
        ref.watch(doctorPatientDetailProvider(appt.patientProfileId));
    final patient = patientAsync.valueOrNull;
    final patientName = patient?.displayName ?? 'Patient';

    // Watch the latest vitals.
    final vitalsAsync = ref.watch(patientVitalReadingsProvider(
        (appt.patientProfileId, const VitalReadingsFilter())));

    return Stack(
      children: [
        CustomScrollView(
          slivers: [
            // ---- App Bar ----
            SliverAppBar(
              backgroundColor: AppColors.surface.withValues(alpha: 0.9),
              elevation: 0,
              pinned: true,
              leading: IconButton(
                icon: const Icon(Icons.arrow_back_rounded,
                    color: AppColors.gray900),
                onPressed: () => Navigator.pop(context),
              ),
              title: Text(
                'Appointment Details',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: AppColors.gray900,
                    ),
              ),
              centerTitle: true,
            ),

            // ---- Content ----
            SliverToBoxAdapter(
              child: Column(
                children: [
                  _buildPatientHeader(appt, patientName, patient),
                  Padding(
                    padding: const EdgeInsets.all(DesignTokens.spaceMd),
                    child: Column(
                      children: [
                        _buildAppointmentInfoCard(appt),
                        const SizedBox(height: DesignTokens.spaceMd),
                        _buildTimeline(appt),
                        const SizedBox(height: DesignTokens.spaceMd),
                        _buildVitalsCard(vitalsAsync),
                        const SizedBox(height: DesignTokens.spaceMd),
                        _buildPatientInfoCard(patient),
                        const SizedBox(height: 200),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),

        // ---- Sticky Footer ----
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          child: _buildActionFooter(appt),
        ),
      ],
    );
  }

  // ------------------------------------------------------------------
  // Sub-builders
  // ------------------------------------------------------------------

  Widget _buildPatientHeader(
      Appointment appt, String patientName, DoctorAssignedPatient? patient) {
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.primary.withValues(alpha: 0.1),
            AppColors.transparent,
          ],
        ),
      ),
      padding: const EdgeInsets.fromLTRB(DesignTokens.spaceMd,
          DesignTokens.spaceLg, DesignTokens.spaceMd, DesignTokens.spaceXl),
      child: Column(
        children: [
          AvatarWidget(name: patientName, size: DesignTokens.avatar2xl),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            patientName,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppColors.gray900,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceXs),
          Text(
            'Patient ID: #${_shortId(appt.patientProfileId)}',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray500,
                ),
          ),
          if (patient != null) ...[
            const SizedBox(height: DesignTokens.spaceXs),
            Text(
              patient.email,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: AppColors.gray400,
                  ),
            ),
          ],
          const SizedBox(height: DesignTokens.spaceLg),
          StatusBadge(
            label: _statusLabel(appt.status),
            tone: _statusTone(appt.status),
            showDot: true,
          ),
        ],
      ),
    );
  }

  String _shortId(String id) {
    if (id.length <= 8) return id;
    return id.substring(id.length - 8).toUpperCase();
  }

  Widget _buildAppointmentInfoCard(Appointment appt) {
    return PremiumCard(
      title: 'Appointment Info',
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: _buildInfoItem(Icons.calendar_today_rounded,
                    _formatDate(appt.startsAt), 'Date'),
              ),
              Container(width: 1, height: 40, color: AppColors.gray200),
              Expanded(
                child: _buildInfoItem(
                    Icons.schedule_rounded, _formatTime(appt.startsAt), 'Time'),
              ),
              Container(width: 1, height: 40, color: AppColors.gray200),
              Expanded(
                child: _buildInfoItem(
                    _modeIcon(appt.mode), _modeLabel(appt.mode), 'Type'),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceSm,
                vertical: DesignTokens.spaceXs),
            decoration: BoxDecoration(
              color: AppColors.gray50,
              borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
            ),
            child: Text(
              'Ref: #${appt.id.substring(0, 8)}',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: AppColors.gray500,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildInfoItem(IconData icon, String value, String label) {
    return Column(
      children: [
        Icon(icon, size: DesignTokens.iconSm, color: AppColors.gray400),
        const SizedBox(height: DesignTokens.spaceSm),
        Text(
          value,
          textAlign: TextAlign.center,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray900,
              ),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: AppColors.gray500,
              ),
        ),
      ],
    );
  }

  Widget _buildTimeline(Appointment appt) {
    final currentIdx = _currentStepIndex(appt.status);
    final isOffPath = currentIdx == -1;

    if (isOffPath) {
      // Cancelled / no_show / rescheduled: show a banner instead of the stepper.
      return PremiumCard(
        accent: _statusTone(appt.status) == StatusBadgeTone.error
            ? AppColors.error
            : AppColors.info,
        child: Row(
          children: [
            Icon(
              appt.status == AppointmentStatus.cancelled
                  ? Icons.cancel_rounded
                  : appt.status == AppointmentStatus.noShow
                      ? Icons.person_off_rounded
                      : Icons.swap_horiz_rounded,
              color: _statusTone(appt.status) == StatusBadgeTone.error
                  ? AppColors.error
                  : AppColors.info,
              size: DesignTokens.iconMd,
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Status: ${_statusLabel(appt.status)}',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: AppColors.gray900,
                        ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'This appointment is no longer on the active schedule.',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.gray500,
                        ),
                  ),
                ],
              ),
            ),
          ],
        ),
      );
    }

    return PremiumCard(
      title: 'Status Timeline',
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        child: Row(
          children: List.generate(_timelineSteps.length, (i) {
            final isCompleted = i < currentIdx;
            final isCurrent = i == currentIdx;
            final isFuture = i > currentIdx;
            final isLast = i == _timelineSteps.length - 1;

            return Row(
              children: [
                Column(
                  children: [
                    Container(
                      width: 32,
                      height: 32,
                      decoration: BoxDecoration(
                        color: isCompleted
                            ? AppColors.primary
                            : isCurrent
                                ? AppColors.primaryContainer
                                : AppColors.gray100,
                        shape: BoxShape.circle,
                        border: isCurrent
                            ? Border.all(color: AppColors.primary, width: 2)
                            : null,
                      ),
                      child: Icon(
                        isCompleted
                            ? Icons.check_rounded
                            : isCurrent
                                ? Icons.radio_button_checked_rounded
                                : Icons.circle_outlined,
                        size: 16,
                        color: isCompleted
                            ? AppColors.white
                            : isCurrent
                                ? AppColors.primary
                                : AppColors.gray400,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceXs),
                    Text(
                      _stepLabels[i],
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: isFuture
                                ? AppColors.gray400
                                : AppColors.gray700,
                            fontWeight:
                                isCurrent ? FontWeight.w700 : FontWeight.w500,
                          ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                ),
                if (!isLast)
                  Container(
                    width: 24,
                    margin: const EdgeInsets.only(bottom: 20),
                    child: Container(
                      height: 2,
                      color:
                          isCompleted ? AppColors.primary : AppColors.gray200,
                    ),
                  ),
              ],
            );
          }),
        ),
      ),
    );
  }

  Widget _buildVitalsCard(AsyncValue<VitalReadingListResponse> vitalsAsync) {
    return PremiumCard(
      title: 'Latest Vitals',
      trailing: vitalsAsync.isLoading
          ? const SizedBox(
              width: 16,
              height: 16,
              child: CircularProgressIndicator(
                  strokeWidth: 2, color: AppColors.primary))
          : null,
      child: vitalsAsync.when(
        data: (resp) {
          final readings = resp.data;
          if (readings.isEmpty) {
            return Padding(
              padding:
                  const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
              child: EmptyView(
                title: 'No vitals recorded',
                body:
                    'IoT vitals will appear here once the patient\'s device publishes readings.',
                icon: Icons.monitor_heart_outlined,
              ),
            );
          }
          // Find the latest reading per metric.
          final latest = <VitalMetric, VitalReading>{};
          for (final r in readings) {
            final existing = latest[r.metric];
            if (existing == null ||
                _parseTimestamp(r.recordedAt)!
                    .isAfter(_parseTimestamp(existing.recordedAt)!)) {
              latest[r.metric] = r;
            }
          }

          final hr = latest[VitalMetric.heartRate];
          final temp = latest[VitalMetric.bodyTemperature];
          final sys = latest[VitalMetric.systolicBp];
          final dia = latest[VitalMetric.diastolicBp];

          return Row(
            children: [
              Expanded(
                child: _buildVitalItem(
                  'Heart Rate',
                  hr != null ? '${hr.value.toStringAsFixed(0)} bpm' : '--',
                  Icons.favorite_rounded,
                  StatTone.error,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: _buildVitalItem(
                  'Blood Pressure',
                  sys != null && dia != null
                      ? '${sys.value.toStringAsFixed(0)}/${dia.value.toStringAsFixed(0)}'
                      : '--',
                  Icons.monitor_heart_rounded,
                  StatTone.info,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: _buildVitalItem(
                  'Temperature',
                  temp != null ? '${temp.value.toStringAsFixed(1)}°C' : '--',
                  Icons.thermostat_rounded,
                  StatTone.warning,
                ),
              ),
            ],
          );
        },
        loading: () => const SizedBox(
          height: 80,
          child: Center(
            child: SizedBox(
              width: 24,
              height: 24,
              child: CircularProgressIndicator(
                  strokeWidth: 2, color: AppColors.primary),
            ),
          ),
        ),
        error: (err, _) {
          final apiError = err is ApiError ? err : toApiError(err);
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
            child: ErrorView(
              message: apiError.isForbidden
                  ? 'No access to patient vitals.'
                  : 'Could not load vitals.',
              isForbidden: apiError.isForbidden,
            ),
          );
        },
      ),
    );
  }

  Widget _buildVitalItem(
      String label, String value, IconData icon, StatTone tone) {
    final iconBg = switch (tone) {
      StatTone.primary => AppColors.primaryContainer,
      StatTone.success => AppColors.successContainer,
      StatTone.warning => AppColors.warningContainer,
      StatTone.error => AppColors.errorContainer,
      StatTone.info => AppColors.infoContainer,
      StatTone.neutral => AppColors.gray100,
    };
    final iconFg = switch (tone) {
      StatTone.primary => AppColors.primary,
      StatTone.success => AppColors.success,
      StatTone.warning => AppColors.warning,
      StatTone.error => AppColors.error,
      StatTone.info => AppColors.info,
      StatTone.neutral => AppColors.gray500,
    };

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceSm),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 28,
                height: 28,
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                ),
                child: Icon(icon, size: 16, color: iconFg),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            value,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppColors.gray900,
                ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: AppColors.gray500,
                ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _buildPatientInfoCard(DoctorAssignedPatient? patient) {
    if (patient == null) {
      return const SizedBox.shrink();
    }

    return PremiumCard(
      title: 'Patient Details',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildDetailRow(
              Icons.person_outline_rounded, 'Name', patient.displayName),
          if (patient.phoneE164 != null && patient.phoneE164!.isNotEmpty)
            _buildDetailRow(Icons.phone_outlined, 'Phone', patient.phoneE164!),
          _buildDetailRow(Icons.email_outlined, 'Email', patient.email),
          _buildDetailRow(Icons.schedule_outlined, 'Assigned',
              _formatDate(patient.assignedAt)),
          const SizedBox(height: DesignTokens.spaceSm),
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceSm,
                    vertical: DesignTokens.spaceXs),
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                ),
                child: Text(
                  'Status: ${patient.status}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: AppColors.primaryDark,
                        fontWeight: FontWeight.w600,
                      ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildDetailRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceXs + 1),
      child: Row(
        children: [
          Icon(icon, size: DesignTokens.iconSm, color: AppColors.gray400),
          const SizedBox(width: DesignTokens.spaceSm),
          Text(
            '$label: ',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray500,
                ),
          ),
          Expanded(
            child: Text(
              value,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.gray900,
                    fontWeight: FontWeight.w500,
                  ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionFooter(Appointment appt) {
    final isUpcoming = appt.status == AppointmentStatus.pendingPayment ||
        appt.status == AppointmentStatus.confirmed;
    final isCheckedIn = appt.status == AppointmentStatus.checkedIn;
    final isInProgress = appt.status == AppointmentStatus.inProgress;
    final isVideoOrAudio = appt.mode == AppointmentMode.video ||
        appt.mode == AppointmentMode.audio;
    final isConsultationMode =
        isVideoOrAudio || appt.mode == AppointmentMode.chat;

    // No actions for terminal / off-path states.
    if (appt.status == AppointmentStatus.completed ||
        appt.status == AppointmentStatus.cancelled ||
        appt.status == AppointmentStatus.noShow) {
      return const SizedBox.shrink();
    }

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.surface.withValues(alpha: 0.95),
        border: const Border(
          top: BorderSide(color: AppColors.gray200),
        ),
      ),
      child: SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (isInProgress) ...[
              // Complete button
              SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightMd,
                child: FilledButton.icon(
                  onPressed: _actionLoading
                      ? null
                      : () => _transitionStatus(appt, 'completed'),
                  icon: _actionLoading
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppColors.white),
                        )
                      : const Icon(Icons.check_circle_outline_rounded,
                          size: 20),
                  label: const Text(
                    'Complete Consultation',
                    style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                  ),
                ),
              ),
            ] else if (isCheckedIn && isConsultationMode) ...[
              // Patient has checked in — doctor can start the consultation.
              SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightMd,
                child: FilledButton.icon(
                  onPressed:
                      _actionLoading ? null : () => _startConsultation(appt),
                  icon: _actionLoading
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppColors.white),
                        )
                      : Icon(_modeIcon(appt.mode), size: 20),
                  label: Text(
                    'Start ${_modeLabel(appt.mode)}',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed:
                          _actionLoading ? null : () => _confirmNoShow(appt),
                      icon: const Icon(Icons.person_off_outlined, size: 18),
                      label: const Text('No-Show',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.warningDark,
                        side: const BorderSide(color: AppColors.warning),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusFull),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed:
                          _actionLoading ? null : () => _confirmCancel(appt),
                      icon: const Icon(Icons.cancel_outlined, size: 18),
                      label: const Text('Cancel',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.error,
                        side: const BorderSide(color: AppColors.error),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusFull),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ] else if (isUpcoming && isConsultationMode) ...[
              // Start Consultation + secondary actions
              SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightMd,
                child: FilledButton.icon(
                  onPressed:
                      _actionLoading ? null : () => _startConsultation(appt),
                  icon: _actionLoading
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppColors.white),
                        )
                      : Icon(_modeIcon(appt.mode), size: 20),
                  label: Text(
                    'Start ${_modeLabel(appt.mode)}',
                    style: const TextStyle(
                        fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed:
                          _actionLoading ? null : () => _confirmNoShow(appt),
                      icon: const Icon(Icons.person_off_outlined, size: 18),
                      label: const Text('No-Show',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.warningDark,
                        side: const BorderSide(color: AppColors.warning),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusFull),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed:
                          _actionLoading ? null : () => _confirmCancel(appt),
                      icon: const Icon(Icons.cancel_outlined, size: 18),
                      label: const Text('Cancel',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.error,
                        side: const BorderSide(color: AppColors.error),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusFull),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ] else if (isUpcoming) ...[
              // In-person: no consultation start, but no-show / cancel
              SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightMd,
                child: FilledButton.icon(
                  onPressed: _actionLoading
                      ? null
                      : () => _transitionStatus(appt, 'checked_in'),
                  icon: _actionLoading
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppColors.white),
                        )
                      : const Icon(Icons.login_rounded, size: 20),
                  label: const Text('Check In Patient',
                      style:
                          TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed:
                          _actionLoading ? null : () => _confirmNoShow(appt),
                      icon: const Icon(Icons.person_off_outlined, size: 18),
                      label: const Text('No-Show',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.warningDark,
                        side: const BorderSide(color: AppColors.warning),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusFull),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed:
                          _actionLoading ? null : () => _confirmCancel(appt),
                      icon: const Icon(Icons.cancel_outlined, size: 18),
                      label: const Text('Cancel',
                          style: TextStyle(fontWeight: FontWeight.w600)),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.error,
                        side: const BorderSide(color: AppColors.error),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusFull),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ],
            // Fee info row
            const SizedBox(height: DesignTokens.spaceSm),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.payments_outlined,
                    size: 16, color: AppColors.gray400),
                const SizedBox(width: DesignTokens.spaceXs),
                Text(
                  'Consultation Fee: ${_formatSen(appt.feeSen)} ${appt.currency}',
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: AppColors.gray500,
                      ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
