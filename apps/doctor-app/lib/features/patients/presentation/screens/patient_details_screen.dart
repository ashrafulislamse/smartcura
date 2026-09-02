import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/models/contract_decoders.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/consultation_provider.dart';
import '../../../../core/providers/doctor_device_management_provider.dart';
import '../../../../core/providers/iot_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/providers/provider_helpers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/device_type_icon.dart';
import '../../../../core/widgets/widgets.dart';

/// Doctor-scoped prescriptions list (`GET /doctor/prescriptions`). The
/// foundation layer ships only a read-one prescription provider, so this local
/// provider covers the list path the patient details screen needs for the
/// "current medications" section. It is doctor-scoped (not per-patient) and
/// filtered client-side by [patientProfileId].
final doctorPrescriptionsProvider =
    FutureProvider.family<PrescriptionList, String?>((ref, cursor) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.doctorPrescriptions,
      queryParameters: cleanQuery({'cursor': cursor}),
    );
    return decodePrescriptionList(body);
  });
});

/// The vital-metric toggle for the trend chart.
enum VitalTrend { heartRate, bloodPressure, temperature, oxygenSaturation }

extension VitalTrendLabel on VitalTrend {
  String get label => switch (this) {
        VitalTrend.heartRate => 'Heart Rate',
        VitalTrend.bloodPressure => 'Blood Pressure',
        VitalTrend.temperature => 'Temperature',
        VitalTrend.oxygenSaturation => 'SpO2',
      };

  /// The metric wire value used to filter the vitals request, or null for the
  /// combined blood-pressure metric (systolic + diastolic).
  String? get metricFilter => switch (this) {
        VitalTrend.heartRate => VitalMetric.heartRate.wireValue,
        VitalTrend.bloodPressure => null, // both systolic + diastolic
        VitalTrend.temperature => VitalMetric.bodyTemperature.wireValue,
        VitalTrend.oxygenSaturation => VitalMetric.oxygenSaturation.wireValue,
      };
}

/// Patient Details Screen — Full Screen (No Bottom Nav).
///
/// Wired to real backend data via Riverpod providers:
/// - [doctorPatientDetailProvider] (GET /doctor/patients/{id}) for the patient
///   profile (name, contact, assignment status). Profile is reachable only as
///   /profiles/me, so this is the doctor-scoped read-one.
/// - [patientVitalReadingsProvider] (GET /patients/{id}/vital-readings) for the
///   latest vitals and the trend chart.
/// - [patientHealthAlertsProvider] (GET /patients/{id}/health-alerts) for the
///   active alerts list with an acknowledge action.
/// - [appointmentsProvider] (GET /appointments) filtered client-side to this
///   patient for the recent-consultations timeline.
/// - [doctorPrescriptionsProvider] (GET /doctor/prescriptions) filtered
///   client-side to this patient for current medications.
/// - [acknowledgeAlertProvider] (POST /health-alerts/{id}/acknowledge) for
///   acknowledging an open alert.
///
/// All four resource states (loading, error, empty, loaded) are rendered
/// distinctly per section. The CustomPaint mini-charts from the previous mock
/// build are replaced by [VitalChartWidget] (fl_chart LineChart) fed by the
/// real reading series.
class PatientDetailsScreen extends ConsumerStatefulWidget {
  const PatientDetailsScreen({super.key, this.patientId});

  final String? patientId;

  @override
  ConsumerState<PatientDetailsScreen> createState() =>
      _PatientDetailsScreenState();
}

class _PatientDetailsScreenState extends ConsumerState<PatientDetailsScreen> {
  VitalTrend _vitalTrend = VitalTrend.heartRate;
  bool _vitalsExpanded = false;
  String? _acknowledgingAlertId;
  String? _startingConsultationApptId;

  // ------------------------------------------------------------------
  // Vocabularies
  // ------------------------------------------------------------------

  /// `DoctorAssignedPatient.status` is a bare `string` carrying a
  /// `profile_status` wire value, so an invented key would compile silently.
  /// The switches below are the single place the status vocabulary is used;
  /// they mirror the generated `ProfileStatus` wire values
  /// (`pending`, `active`, `suspended`, `deactivated`).

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  DateTime? _parseTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso);
  }

  String _formatDate(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '';
    return DateFormat('EEE, MMM d, yyyy').format(dt);
  }

  String _formatDateShort(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '';
    return DateFormat('MMM d, yyyy').format(dt);
  }

  String _formatTime(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '--:--';
    return DateFormat.jm().format(dt);
  }

  String _formatDateTime(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '';
    return DateFormat('MMM d, yyyy • h:mm a').format(dt);
  }

  String _shortId(String id) {
    if (id.length <= 8) return id;
    return '#${id.substring(id.length - 8).toUpperCase()}';
  }

  StatusBadgeTone _profileStatusTone(String status) => switch (status) {
        'active' => StatusBadgeTone.success,
        'pending' => StatusBadgeTone.info,
        'suspended' => StatusBadgeTone.warning,
        'deactivated' => StatusBadgeTone.neutral,
        _ => StatusBadgeTone.neutral,
      };

  String _profileStatusLabel(String status) => switch (status) {
        'active' => 'Active',
        'pending' => 'Pending',
        'suspended' => 'Suspended',
        'deactivated' => 'Deactivated',
        _ => 'Unknown',
      };

  StatusBadgeTone _alertSeverityTone(HealthAlertSeverity severity) =>
      switch (severity) {
        HealthAlertSeverity.critical => StatusBadgeTone.error,
        HealthAlertSeverity.warning => StatusBadgeTone.warning,
        HealthAlertSeverity.info => StatusBadgeTone.info,
        HealthAlertSeverity.unknown => StatusBadgeTone.neutral,
      };

  String _alertSeverityLabel(HealthAlertSeverity severity) =>
      switch (severity) {
        HealthAlertSeverity.critical => 'Critical',
        HealthAlertSeverity.warning => 'Warning',
        HealthAlertSeverity.info => 'Info',
        HealthAlertSeverity.unknown => 'Unknown',
      };

  StatusBadgeTone _alertStateTone(HealthAlertState state) => switch (state) {
        HealthAlertState.open => StatusBadgeTone.error,
        HealthAlertState.acknowledged => StatusBadgeTone.info,
        HealthAlertState.escalated => StatusBadgeTone.warning,
        HealthAlertState.resolved => StatusBadgeTone.success,
        HealthAlertState.dismissed => StatusBadgeTone.neutral,
        HealthAlertState.unknown => StatusBadgeTone.neutral,
      };

  String _alertStateLabel(HealthAlertState state) => switch (state) {
        HealthAlertState.open => 'Open',
        HealthAlertState.acknowledged => 'Acknowledged',
        HealthAlertState.escalated => 'Escalated',
        HealthAlertState.resolved => 'Resolved',
        HealthAlertState.dismissed => 'Dismissed',
        HealthAlertState.unknown => 'Unknown',
      };

  String _vitalMetricLabel(VitalMetric m) => switch (m) {
        VitalMetric.heartRate => 'Heart Rate',
        VitalMetric.oxygenSaturation => 'SpO2',
        VitalMetric.bodyTemperature => 'Temperature',
        VitalMetric.systolicBp => 'Systolic BP',
        VitalMetric.diastolicBp => 'Diastolic BP',
        VitalMetric.respiratoryRate => 'Respiratory Rate',
        VitalMetric.ecgVoltage => 'ECG',
        VitalMetric.bloodPressure => 'Blood Pressure',
        VitalMetric.bloodGlucose => 'Blood Glucose',
        VitalMetric.bodyWeight => 'Weight',
        VitalMetric.unknown => 'Vital',
      };

  IconData _vitalMetricIcon(VitalMetric m) => switch (m) {
        VitalMetric.heartRate => Icons.favorite_rounded,
        VitalMetric.oxygenSaturation => Icons.air_rounded,
        VitalMetric.bodyTemperature => Icons.thermostat_rounded,
        VitalMetric.systolicBp => Icons.monitor_heart_rounded,
        VitalMetric.diastolicBp => Icons.monitor_heart_rounded,
        VitalMetric.respiratoryRate => Icons.waves_rounded,
        VitalMetric.ecgVoltage => Icons.show_chart_rounded,
        VitalMetric.bloodPressure => Icons.monitor_heart_rounded,
        VitalMetric.bloodGlucose => Icons.water_drop_rounded,
        VitalMetric.bodyWeight => Icons.scale_rounded,
        VitalMetric.unknown => Icons.timeline_rounded,
      };

  StatTone _vitalMetricTone(VitalMetric m) => switch (m) {
        VitalMetric.heartRate => StatTone.error,
        VitalMetric.oxygenSaturation => StatTone.info,
        VitalMetric.bodyTemperature => StatTone.warning,
        VitalMetric.systolicBp => StatTone.primary,
        VitalMetric.diastolicBp => StatTone.primary,
        VitalMetric.respiratoryRate => StatTone.success,
        VitalMetric.ecgVoltage => StatTone.neutral,
        VitalMetric.bloodPressure => StatTone.primary,
        VitalMetric.bloodGlucose => StatTone.warning,
        VitalMetric.bodyWeight => StatTone.neutral,
        VitalMetric.unknown => StatTone.neutral,
      };

  IconData _modeIcon(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => Icons.videocam_rounded,
        AppointmentMode.audio => Icons.phone_in_talk_rounded,
        AppointmentMode.chat => Icons.chat_bubble_rounded,
        AppointmentMode.inPerson => Icons.person_rounded,
        AppointmentMode.unknown => Icons.event_rounded,
      };

  String _modeLabel(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => 'Video',
        AppointmentMode.audio => 'Audio',
        AppointmentMode.chat => 'Chat',
        AppointmentMode.inPerson => 'In-Person',
        AppointmentMode.unknown => 'Appointment',
      };

  StatusBadgeTone _apptStatusTone(AppointmentStatus s) => switch (s) {
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

  String _apptStatusLabel(AppointmentStatus s) => switch (s) {
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

  StatusBadgeTone _rxStatusTone(PrescriptionStatus s) => switch (s) {
        PrescriptionStatus.draft => StatusBadgeTone.warning,
        PrescriptionStatus.signed => StatusBadgeTone.success,
        PrescriptionStatus.superseded => StatusBadgeTone.neutral,
        PrescriptionStatus.cancelled => StatusBadgeTone.error,
        PrescriptionStatus.expired => StatusBadgeTone.neutral,
        PrescriptionStatus.discarded => StatusBadgeTone.error,
        PrescriptionStatus.unknown => StatusBadgeTone.neutral,
      };

  String _rxStatusLabel(PrescriptionStatus s) => switch (s) {
        PrescriptionStatus.draft => 'Draft',
        PrescriptionStatus.signed => 'Active',
        PrescriptionStatus.superseded => 'Superseded',
        PrescriptionStatus.cancelled => 'Cancelled',
        PrescriptionStatus.expired => 'Expired',
        PrescriptionStatus.discarded => 'Discarded',
        PrescriptionStatus.unknown => 'Unknown',
      };

  /// True when a prescription still represents a current medication.
  bool _isCurrentMedication(Prescription rx) =>
      rx.status == PrescriptionStatus.signed ||
      rx.status == PrescriptionStatus.draft;

  /// Build the latest reading per metric from the full series.
  Map<VitalMetric, VitalReading> _latestPerMetric(List<VitalReading> readings) {
    final latest = <VitalMetric, VitalReading>{};
    for (final r in readings) {
      final existing = latest[r.metric];
      final existingT = _parseTimestamp(existing?.recordedAt);
      final newT = _parseTimestamp(r.recordedAt);
      if (existing == null ||
          (existingT != null && newT != null && newT.isAfter(existingT))) {
        latest[r.metric] = r;
      }
    }
    return latest;
  }

  /// Build sorted (x, y) spots for a single metric, ordered oldest→newest by
  /// recorded time so the trend reads left-to-right.
  List<FlSpot> _spotsForMetric(List<VitalReading> readings, VitalMetric m) {
    final series = readings.where((r) => r.metric == m).toList()
      ..sort((a, b) {
        final ta = _parseTimestamp(a.recordedAt);
        final tb = _parseTimestamp(b.recordedAt);
        if (ta == null || tb == null) return 0;
        return ta.compareTo(tb);
      });
    return [
      for (var i = 0; i < series.length; i++)
        FlSpot(i.toDouble(), series[i].value),
    ];
  }

  Future<void> _onRefresh(String patientId) async {
    ref.invalidate(doctorPatientDetailProvider(patientId));
    ref.invalidate(patientVitalReadingsProvider(
        (patientId, VitalReadingsFilter(metric: _vitalTrend.metricFilter))));
    ref.invalidate(
        patientHealthAlertsProvider((patientId, const HealthAlertsFilter())));
    ref.invalidate(appointmentsProvider(const AppointmentFilter()));
    ref.invalidate(doctorPrescriptionsProvider(null));
    ref.invalidate(patientDevicesProvider(patientId));
    ref.invalidate(availableDevicesProvider);
    await ref.read(doctorPatientDetailProvider(patientId).future);
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  Future<void> _acknowledgeAlert(HealthAlert alert) async {
    setState(() => _acknowledgingAlertId = alert.id);
    try {
      final notifier = ref.read(acknowledgeAlertProvider.notifier);
      final ok = await notifier.call(
        alertId: alert.id,
        expectedVersion: alert.version,
      );
      if (ok) {
        ref.invalidate(patientHealthAlertsProvider(
            (alert.patientProfileId, const HealthAlertsFilter())));
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Alert acknowledged.'),
              duration: Duration(seconds: 2),
            ),
          );
        }
      } else {
        _showMutationError(ref.read(acknowledgeAlertProvider).error);
      }
    } catch (e) {
      _showMutationError(e);
    } finally {
      if (mounted) setState(() => _acknowledgingAlertId = null);
    }
  }

  Future<void> _startConsultation(Appointment appt) async {
    setState(() => _startingConsultationApptId = appt.id);
    try {
      final notifier = ref.read(createConsultationProvider.notifier);
      final consultation = await notifier.call(appt.id);
      if (consultation != null && mounted) {
        ref.invalidate(appointmentDetailProvider(appt.id));
        context.push('/video-consultation', extra: consultation.consultationId);
      } else {
        _showMutationError(ref.read(createConsultationProvider).error);
      }
    } catch (e) {
      _showMutationError(e);
    } finally {
      if (mounted) setState(() => _startingConsultationApptId = null);
    }
  }

  /// Find the most recent appointment for [patientId] from the appointments
  /// list already loaded on this screen (watched in the consultations
  /// section). Returns null if the list has not loaded or no appointment
  /// exists for the patient.
  ///
  /// The patient detail header buttons need a consultation context that does
  /// not exist as a standalone read on this screen (there is no per-patient
  /// consultation list, and `Appointment` carries no consultation id), so the
  /// honest entry point is the appointment details screen, where the doctor
  /// can start a consultation and then reach notes / prescriptions through the
  /// video call control bar (which passes the consultation id correctly).
  Appointment? _mostRecentAppointmentFor(String patientId) {
    final list = ref
        .read(appointmentsProvider(const AppointmentFilter()))
        .valueOrNull
        ?.data;
    if (list == null) return null;
    final patientAppts =
        list.where((a) => a.patientProfileId == patientId).toList()
          ..sort((a, b) {
            final ta = _parseTimestamp(a.startsAt);
            final tb = _parseTimestamp(b.startsAt);
            if (ta == null || tb == null) return 0;
            return tb.compareTo(ta); // newest first
          });
    return patientAppts.isEmpty ? null : patientAppts.first;
  }

  /// Open the most recent appointment's details for [patientId], or show a
  /// snackbar with [message] when no appointment exists.
  void _openMostRecentAppointment(String patientId, String message) {
    final appt = _mostRecentAppointmentFor(patientId);
    if (appt == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(message)),
      );
      return;
    }
    context.push('/appointment-details', extra: appt.id);
  }

  void _showMutationError(Object? e) {
    final msg = e is ApiError
        ? e.displayMessage
        : 'Could not complete the action. Please try again.';
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
    }
  }

  // ------------------------------------------------------------------
  // Build
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final id = widget.patientId;
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
          title: Text('Patient Details',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold, color: AppColors.gray900)),
          centerTitle: true,
        ),
        body: const ErrorView(
          message: 'No patient was selected. Open a patient from the list.',
          isForbidden: true,
        ),
      );
    }

    final patientAsync = ref.watch(doctorPatientDetailProvider(id));

    return Scaffold(
      backgroundColor: AppColors.background,
      body: patientAsync.when(
        data: (patient) => _buildContent(patient),
        loading: () => _buildLoadingScaffold(),
        error: (err, _) {
          final apiError = err is ApiError ? err : toApiError(err);
          return _buildErrorScaffold(apiError, id);
        },
      ),
    );
  }

  Widget _buildLoadingScaffold() {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.surface,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: AppColors.gray900),
          onPressed: () => Navigator.pop(context),
        ),
        title: Text('Patient Details',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold, color: AppColors.gray900)),
        centerTitle: true,
      ),
      body: Shimmer.fromColors(
        baseColor: AppColors.shimmerBase,
        highlightColor: AppColors.shimmerHighlight,
        child: ListView(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          physics: const NeverScrollableScrollPhysics(),
          children: [
            _buildShimmerHeader(),
            const SizedBox(height: DesignTokens.spaceMd),
            _buildShimmerCard(120),
            const SizedBox(height: DesignTokens.spaceMd),
            _buildShimmerCard(180),
            const SizedBox(height: DesignTokens.spaceMd),
            _buildShimmerCard(160),
          ],
        ),
      ),
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
        title: Text('Patient Details',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold, color: AppColors.gray900)),
        centerTitle: true,
      ),
      body: ErrorView(
        message: apiError.displayMessage,
        onRetry: apiError.isForbidden
            ? null
            : () => ref.invalidate(doctorPatientDetailProvider(id)),
        isForbidden: apiError.isForbidden,
      ),
    );
  }

  Widget _buildContent(DoctorAssignedPatient patient) {
    final id = patient.profileId;

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => _onRefresh(id),
      child: CustomScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        slivers: [
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
              patient.displayName,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: AppColors.gray900,
                  ),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
            centerTitle: true,
          ),
          SliverToBoxAdapter(
            child: Column(
              children: [
                _buildPatientHeader(patient),
                Padding(
                  padding: const EdgeInsets.all(DesignTokens.spaceMd),
                  child: Column(
                    children: [
                      _buildVitalsSection(id),
                      const SizedBox(height: DesignTokens.spaceMd),
                      _buildConditionsSection(id),
                      const SizedBox(height: DesignTokens.spaceMd),
                      _buildAlertsSection(id),
                      const SizedBox(height: DesignTokens.spaceMd),
                      _buildMedicationsSection(id),
                      const SizedBox(height: DesignTokens.spaceMd),
                      _buildMedicalDevicesSection(id),
                      const SizedBox(height: DesignTokens.spaceMd),
                      _buildConsultationsSection(id),
                      const SizedBox(height: 160),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Sub-builders — header
  // ------------------------------------------------------------------

  Widget _buildPatientHeader(DoctorAssignedPatient patient) {
    final hasPhone = patient.phoneE164 != null && patient.phoneE164!.isNotEmpty;
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
          AvatarWidget(name: patient.displayName, size: DesignTokens.avatar2xl),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            patient.displayName,
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppColors.gray900,
                ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: DesignTokens.spaceXs),
          Text(
            '${_shortId(patient.profileId)} • Assigned ${_formatDateShort(patient.assignedAt)}',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray500,
                ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          StatusBadge(
            label: _profileStatusLabel(patient.status),
            tone: _profileStatusTone(patient.status),
            showDot: true,
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          // Contact info rows
          _buildContactRow(Icons.email_outlined, patient.email),
          if (hasPhone) ...[
            const SizedBox(height: DesignTokens.spaceXs + 2),
            _buildContactRow(Icons.phone_outlined, patient.phoneE164!),
          ],
          const SizedBox(height: DesignTokens.spaceXs + 2),
          _buildContactRow(Icons.translate_rounded, patient.preferredLocale),
          const SizedBox(height: DesignTokens.spaceLg),
          // Quick action buttons
          Row(
            children: [
              Expanded(
                child: FilledButton.icon(
                  // A consultation is created on demand from an appointment,
                  // and this screen has no consultation id in scope, so route
                  // to the appointment details where the create-then-join flow
                  // lives. Show a snackbar when no appointment exists.
                  onPressed: () => _openMostRecentAppointment(
                      patient.profileId,
                      'No active appointment found for this patient. '
                      'Create an appointment first.'),
                  icon: const Icon(Icons.videocam_rounded, size: 18),
                  label: const Text('Start Consultation'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                    padding: const EdgeInsets.symmetric(
                        vertical: DesignTokens.spaceSm + 2),
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
                  // Clinical notes are authored against a consultation id,
                  // which this screen cannot resolve without first starting a
                  // consultation from an appointment. Route to the appointment
                  // details; the notes screen is reachable from the video call
                  // with the correct consultation id.
                  onPressed: () => _openMostRecentAppointment(patient.profileId,
                      'No consultation found. Start a consultation first.'),
                  icon: const Icon(Icons.note_add_outlined, size: 18),
                  label: const Text('New Note'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primary,
                    side: const BorderSide(color: AppColors.primary),
                    padding: const EdgeInsets.symmetric(
                        vertical: DesignTokens.spaceSm + 2),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  // Prescriptions are issued against a consultation id, which
                  // requires an appointment first. Route to the appointment
                  // details; the e-prescription screen is reachable from the
                  // video call with the correct consultation id.
                  onPressed: () => _openMostRecentAppointment(patient.profileId,
                      'No consultation found. Start a consultation first.'),
                  icon: const Icon(Icons.receipt_long_outlined, size: 18),
                  label: const Text('New Prescription'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.accent,
                    side: const BorderSide(color: AppColors.accent),
                    padding: const EdgeInsets.symmetric(
                        vertical: DesignTokens.spaceSm + 2),
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
      ),
    );
  }

  Widget _buildContactRow(IconData icon, String text) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(icon, size: 16, color: AppColors.gray400),
        const SizedBox(width: DesignTokens.spaceSm),
        Flexible(
          child: Text(
            text,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray600,
                ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  // ------------------------------------------------------------------
  // Sub-builders — vitals section
  // ------------------------------------------------------------------

  static const _trendOptions = [
    FilterChipOption(value: VitalTrend.heartRate, label: 'HR'),
    FilterChipOption(value: VitalTrend.bloodPressure, label: 'BP'),
    FilterChipOption(value: VitalTrend.temperature, label: 'Temp'),
    FilterChipOption(value: VitalTrend.oxygenSaturation, label: 'SpO2'),
  ];

  Widget _buildVitalsSection(String patientId) {
    // The vitals request follows the active trend toggle so the chart and the
    // stat cards reflect the same metric family. For blood pressure we fetch
    // the unfiltered series (both systolic + diastolic).
    final vitalsAsync = ref.watch(patientVitalReadingsProvider(
        (patientId, VitalReadingsFilter(metric: _vitalTrend.metricFilter))));

    return PremiumCard(
      title: 'Vitals',
      trailing: TextButton.icon(
        onPressed: () => setState(() => _vitalsExpanded = !_vitalsExpanded),
        icon: Icon(
          _vitalsExpanded
              ? Icons.expand_less_rounded
              : Icons.expand_more_rounded,
          size: 18,
          color: AppColors.primary,
        ),
        label: Text(
          _vitalsExpanded ? 'Hide History' : 'View Vitals History',
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.primary,
          ),
        ),
      ),
      child: vitalsAsync.when(
        data: (resp) {
          final readings = resp.data;
          if (readings.isEmpty) {
            return Padding(
              padding:
                  const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
              child: const EmptyView(
                title: 'No vitals recorded',
                body:
                    "IoT vitals will appear here once the patient's device publishes readings.",
                icon: Icons.monitor_heart_outlined,
              ),
            );
          }
          final latest = _latestPerMetric(readings);
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildVitalStatRow(latest),
              const SizedBox(height: DesignTokens.spaceMd),
              FilterChipsWidget<VitalTrend>(
                options: _trendOptions,
                selected: _vitalTrend,
                onSelected: (v) {
                  if (v != null) setState(() => _vitalTrend = v);
                },
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              _buildTrendChart(readings),
              if (_vitalsExpanded) ...[
                const SizedBox(height: DesignTokens.spaceMd),
                _buildVitalsHistoryList(readings),
              ],
            ],
          );
        },
        loading: () => _buildVitalsShimmer(),
        error: (err, _) {
          final apiError = err is ApiError ? err : toApiError(err);
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
            child: ErrorView(
              message: apiError.isForbidden
                  ? 'No access to patient vitals.'
                  : 'Could not load vitals.',
              onRetry: apiError.isForbidden
                  ? null
                  : () => ref.invalidate(patientVitalReadingsProvider((
                        patientId,
                        VitalReadingsFilter(metric: _vitalTrend.metricFilter)
                      ))),
              isForbidden: apiError.isForbidden,
            ),
          );
        },
      ),
    );
  }

  Widget _buildVitalStatRow(Map<VitalMetric, VitalReading> latest) {
    final hr = latest[VitalMetric.heartRate];
    final sys = latest[VitalMetric.systolicBp];
    final dia = latest[VitalMetric.diastolicBp];
    final temp = latest[VitalMetric.bodyTemperature];
    final spo2 = latest[VitalMetric.oxygenSaturation];

    return Row(
      children: [
        Expanded(
          child: _buildVitalStat(
            'Heart Rate',
            hr != null ? '${hr.value.toStringAsFixed(0)}' : '--',
            hr?.unit ?? 'bpm',
            Icons.favorite_rounded,
            StatTone.error,
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: _buildVitalStat(
            'Blood Pressure',
            sys != null && dia != null
                ? '${sys.value.toStringAsFixed(0)}/${dia.value.toStringAsFixed(0)}'
                : '--',
            'mmHg',
            Icons.monitor_heart_rounded,
            StatTone.primary,
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: _buildVitalStat(
            'Temperature',
            temp != null ? temp.value.toStringAsFixed(1) : '--',
            temp?.unit ?? '°C',
            Icons.thermostat_rounded,
            StatTone.warning,
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: _buildVitalStat(
            'SpO2',
            spo2 != null ? '${spo2.value.toStringAsFixed(0)}' : '--',
            spo2?.unit ?? '%',
            Icons.air_rounded,
            StatTone.info,
          ),
        ),
      ],
    );
  }

  Widget _buildVitalStat(
      String label, String value, String unit, IconData icon, StatTone tone) {
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
          Container(
            width: 28,
            height: 28,
            decoration: BoxDecoration(
              color: iconBg,
              borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
            ),
            child: Icon(icon, size: 16, color: iconFg),
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
          Text(
            unit,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: AppColors.gray400,
                ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ],
      ),
    );
  }

  Widget _buildTrendChart(List<VitalReading> readings) {
    final List<FlSpot> spots;
    final String unit;
    final Color color;

    switch (_vitalTrend) {
      case VitalTrend.heartRate:
        spots = _spotsForMetric(readings, VitalMetric.heartRate);
        unit = spots.isNotEmpty ? 'bpm' : '';
        color = AppColors.error;
        break;
      case VitalTrend.bloodPressure:
        // Two series (systolic + diastolic) overlaid; rendered as two charts
        // stacked for legibility since VitalChartWidget draws one line.
        final sysSpots = _spotsForMetric(readings, VitalMetric.systolicBp);
        final diaSpots = _spotsForMetric(readings, VitalMetric.diastolicBp);
        if (sysSpots.isEmpty && diaSpots.isEmpty) {
          return const VitalChartWidget(
            spots: [],
            unit: 'mmHg',
            title: 'Blood Pressure',
            height: 160,
          );
        }
        return Column(
          children: [
            VitalChartWidget(
              spots: sysSpots,
              unit: 'mmHg',
              title: 'Systolic BP',
              color: AppColors.primary,
              height: 150,
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            VitalChartWidget(
              spots: diaSpots,
              unit: 'mmHg',
              title: 'Diastolic BP',
              color: AppColors.accent,
              height: 150,
            ),
          ],
        );
      case VitalTrend.temperature:
        spots = _spotsForMetric(readings, VitalMetric.bodyTemperature);
        unit = spots.isNotEmpty ? '°C' : '';
        color = AppColors.warning;
        break;
      case VitalTrend.oxygenSaturation:
        spots = _spotsForMetric(readings, VitalMetric.oxygenSaturation);
        unit = spots.isNotEmpty ? '%' : '';
        color = AppColors.info;
        break;
    }

    return VitalChartWidget(
      spots: spots,
      unit: unit,
      title: _vitalTrend.label,
      color: color,
      height: 180,
    );
  }

  Widget _buildVitalsHistoryList(List<VitalReading> readings) {
    final sorted = [...readings]..sort((a, b) {
        final ta = _parseTimestamp(a.recordedAt);
        final tb = _parseTimestamp(b.recordedAt);
        if (ta == null || tb == null) return 0;
        return tb.compareTo(ta); // newest first
      });

    if (sorted.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
        child: EmptyView(
          title: 'No history for this metric',
          icon: Icons.history_rounded,
        ),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Reading History',
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray700,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        for (final r in sorted.take(12)) ...[
          _buildVitalHistoryItem(r),
          const SizedBox(height: DesignTokens.spaceXs),
        ],
      ],
    );
  }

  Widget _buildVitalHistoryItem(VitalReading r) {
    final tone = _vitalMetricTone(r.metric);
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
    return Row(
      children: [
        Container(
          width: 32,
          height: 32,
          decoration: BoxDecoration(
            color: iconBg,
            borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
          ),
          child: Icon(_vitalMetricIcon(r.metric), size: 18, color: iconFg),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${_vitalMetricLabel(r.metric)}: ${r.value.toStringAsFixed(1)} ${r.unit}',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: AppColors.gray900,
                    ),
              ),
              Text(
                _formatDateTime(r.recordedAt),
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: AppColors.gray500,
                    ),
              ),
            ],
          ),
        ),
        if (r.quality != VitalReadingQuality.valid)
          StatusBadge(
            label: r.quality.name,
            tone: r.quality == VitalReadingQuality.invalid
                ? StatusBadgeTone.error
                : StatusBadgeTone.warning,
          ),
      ],
    );
  }

  Widget _buildVitalsShimmer() {
    return Shimmer.fromColors(
      baseColor: AppColors.shimmerBase,
      highlightColor: AppColors.shimmerHighlight,
      child: Column(
        children: [
          Row(
            children: List.generate(
              4,
              (_) => Expanded(
                child: Container(
                  margin: const EdgeInsets.only(right: DesignTokens.spaceSm),
                  height: 90,
                  decoration: BoxDecoration(
                    color: AppColors.white,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                ),
              ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Container(
            height: 180,
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Sub-builders — conditions & allergies section
  // ------------------------------------------------------------------

  Widget _buildConditionsSection(String patientId) {
    // `DoctorAssignedPatient` (the doctor-scoped read-one) carries no allergy
    // or active-condition fields — `Profile` is reachable only as
    // `/profiles/me`, and the only endpoint that discloses another person's
    // clinical sensitivities is the emergency break-glass disclosure
    // (`BreakGlassDisclosure.allergies` / `.activeConditions`). Break-glass
    // requires creating a grant first, which is an audited emergency action, so
    // it is not auto-triggered here. State the limitation on screen rather than
    // fabricating plausible values — per the reconciliation convention.
    return PremiumCard(
      title: 'Conditions & Allergies',
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
        child: EmptyView(
          title: 'No conditions or allergies available',
          body:
              'Allergy and active-condition records are only disclosed through '
              'emergency break-glass access. Start a break-glass grant to view '
              "this patient's clinical sensitivities.",
          icon: Icons.health_and_safety_outlined,
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Sub-builders — alerts section
  // ------------------------------------------------------------------

  Widget _buildAlertsSection(String patientId) {
    final alertsAsync = ref.watch(
        patientHealthAlertsProvider((patientId, const HealthAlertsFilter())));

    return PremiumCard(
      title: 'Health Alerts',
      child: alertsAsync.when(
        data: (resp) {
          final alerts = resp.data;
          // Active = not yet resolved/dismissed.
          final active = alerts
              .where((a) =>
                  a.state != HealthAlertState.resolved &&
                  a.state != HealthAlertState.dismissed)
              .toList();
          if (active.isEmpty) {
            return Padding(
              padding:
                  const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
              child: const EmptyView(
                title: 'No active alerts',
                body: 'This patient has no open health alerts.',
                icon: Icons.check_circle_outline_rounded,
              ),
            );
          }
          return Column(
            children: [
              for (final a in active) ...[
                _buildAlertItem(a),
                const SizedBox(height: DesignTokens.spaceSm),
              ],
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
                  ? 'No access to patient alerts.'
                  : 'Could not load alerts.',
              onRetry: apiError.isForbidden
                  ? null
                  : () => ref.invalidate(patientHealthAlertsProvider(
                      (patientId, const HealthAlertsFilter()))),
              isForbidden: apiError.isForbidden,
            ),
          );
        },
      ),
    );
  }

  Widget _buildAlertItem(HealthAlert alert) {
    final isProcessing = _acknowledgingAlertId == alert.id;
    final canAcknowledge = alert.state == HealthAlertState.open;
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceSm + 2),
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
              StatusBadge(
                label: _alertSeverityLabel(alert.severity),
                tone: _alertSeverityTone(alert.severity),
                showDot: true,
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              StatusBadge(
                label: _alertStateLabel(alert.state),
                tone: _alertStateTone(alert.state),
              ),
              const Spacer(),
              Icon(Icons.warning_amber_rounded,
                  size: 18,
                  color: _alertSeverityTone(alert.severity) ==
                          StatusBadgeTone.error
                      ? AppColors.error
                      : AppColors.warning),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceXs + 2),
          Text(
            '${_vitalMetricLabel(alert.metric)} reached ${alert.observedValue.toStringAsFixed(1)}',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                  color: AppColors.gray900,
                ),
          ),
          const SizedBox(height: 2),
          Row(
            children: [
              Icon(Icons.schedule_rounded, size: 12, color: AppColors.gray400),
              const SizedBox(width: 4),
              Text(
                'Observed ${_formatDateTime(alert.observedAt)}',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: AppColors.gray500,
                    ),
              ),
            ],
          ),
          if (canAcknowledge) ...[
            const SizedBox(height: DesignTokens.spaceSm),
            SizedBox(
              width: double.infinity,
              child: FilledButton.tonalIcon(
                onPressed: isProcessing ? null : () => _acknowledgeAlert(alert),
                icon: isProcessing
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: AppColors.primary),
                      )
                    : const Icon(Icons.check_circle_outline_rounded, size: 18),
                label: const Text(
                  'Acknowledge',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                ),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primaryContainer,
                  foregroundColor: AppColors.primaryDark,
                  shape: RoundedRectangleBorder(
                    borderRadius:
                        BorderRadius.circular(DesignTokens.radiusFull),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Sub-builders — medications section
  // ------------------------------------------------------------------

  Widget _buildMedicationsSection(String patientId) {
    final rxAsync = ref.watch(doctorPrescriptionsProvider(null));

    return PremiumCard(
      title: 'Current Medications',
      child: rxAsync.when(
        data: (resp) {
          final patientRx = resp.data
              .where((rx) => rx.patientProfileId == patientId)
              .toList();
          if (patientRx.isEmpty) {
            return Padding(
              padding:
                  const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
              child: const EmptyView(
                title: 'No prescriptions on file',
                body:
                    'Prescriptions you issue for this patient will appear here.',
                icon: Icons.medication_outlined,
              ),
            );
          }
          // Current = signed or draft; show active first, then history.
          final current = patientRx.where(_isCurrentMedication).toList();
          final history =
              patientRx.where((rx) => !_isCurrentMedication(rx)).toList();

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (current.isEmpty)
                Padding(
                  padding: const EdgeInsets.symmetric(
                      vertical: DesignTokens.spaceSm),
                  child: const EmptyView(
                    title: 'No active medications',
                    body: 'There are no signed prescriptions for this patient.',
                    icon: Icons.medication_liquid_outlined,
                  ),
                )
              else
                for (final rx in current) ...[
                  _buildMedicationCard(rx),
                  const SizedBox(height: DesignTokens.spaceSm),
                ],
              if (history.isNotEmpty) ...[
                const SizedBox(height: DesignTokens.spaceXs),
                Text(
                  'History',
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: AppColors.gray700,
                      ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                for (final rx in history.take(4)) ...[
                  _buildMedicationCard(rx, isHistory: true),
                  const SizedBox(height: DesignTokens.spaceSm),
                ],
              ],
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
                  ? 'No access to prescriptions.'
                  : 'Could not load medications.',
              onRetry: apiError.isForbidden
                  ? null
                  : () => ref.invalidate(doctorPrescriptionsProvider(null)),
              isForbidden: apiError.isForbidden,
            ),
          );
        },
      ),
    );
  }

  Widget _buildMedicationCard(Prescription rx, {bool isHistory = false}) {
    final items = rx.items;
    final tone = _rxStatusTone(rx.status);
    final iconBg = switch (tone) {
      StatusBadgeTone.success => AppColors.successContainer,
      StatusBadgeTone.warning => AppColors.warningContainer,
      StatusBadgeTone.error => AppColors.errorContainer,
      StatusBadgeTone.info => AppColors.infoContainer,
      StatusBadgeTone.neutral => AppColors.gray100,
      StatusBadgeTone.primary => AppColors.primaryContainer,
    };
    final iconFg = switch (tone) {
      StatusBadgeTone.success => AppColors.success,
      StatusBadgeTone.warning => AppColors.warning,
      StatusBadgeTone.error => AppColors.error,
      StatusBadgeTone.info => AppColors.info,
      StatusBadgeTone.neutral => AppColors.gray500,
      StatusBadgeTone.primary => AppColors.primary,
    };

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceSm + 2),
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: iconBg,
              borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
            ),
            child: Icon(Icons.medication_rounded, size: 20, color: iconFg),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  items.isEmpty ? 'Prescription' : items.first,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                        color: AppColors.gray900,
                      ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  items.length > 1
                      ? '${items.length} items • ${_formatDateShort(rx.createdAt)}'
                      : 'Issued ${_formatDateShort(rx.createdAt)}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: AppColors.gray500,
                      ),
                ),
              ],
            ),
          ),
          StatusBadge(
            label: _rxStatusLabel(rx.status),
            tone: tone,
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Sub-builders — medical devices section
  // ------------------------------------------------------------------

  Widget _buildMedicalDevicesSection(String patientId) {
    final devicesAsync = ref.watch(patientDevicesProvider(patientId));
    final mutation = ref.watch(deviceAssignmentProvider);
    final isMutating = mutation is DeviceAssignmentAssigning ||
        mutation is DeviceAssignmentReleasing;

    return PremiumCard(
      title: 'Medical Devices',
      trailing: FilledButton.tonalIcon(
        onPressed: isMutating ? null : () => _showAssignDeviceSheet(patientId),
        icon: const Icon(Icons.add_rounded, size: 18),
        label: const Text(
          'Assign',
          style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
        ),
        style: FilledButton.styleFrom(
          backgroundColor: AppColors.primaryContainer,
          foregroundColor: AppColors.primaryDark,
          padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceSm + 4,
              vertical: DesignTokens.spaceXs + 1),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
          ),
        ),
      ),
      child: devicesAsync.when(
        data: (devices) {
          if (devices.isEmpty) {
            return Padding(
              padding:
                  const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
              child: const EmptyView(
                title: 'No devices assigned',
                body: 'Assign an available IoT device to start collecting this '
                    "patient's vitals.",
                icon: Icons.devices_outlined,
              ),
            );
          }
          return Column(
            children: [
              for (final d in devices) ...[
                _buildDeviceCard(d, patientId, isMutating),
                const SizedBox(height: DesignTokens.spaceSm),
              ],
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
                  ? 'No access to patient devices.'
                  : 'Could not load devices.',
              onRetry: apiError.isForbidden
                  ? null
                  : () => ref.invalidate(patientDevicesProvider(patientId)),
              isForbidden: apiError.isForbidden,
            ),
          );
        },
      ),
    );
  }

  Widget _buildDeviceCard(
      DoctorDevice device, String patientId, bool isMutating) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceSm + 2),
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
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                ),
                child: Icon(DeviceTypeIcon.icon(device.deviceType),
                    size: 20, color: device.state.iconColor),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      DeviceTypeIcon.label(device.deviceType),
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: AppColors.gray900,
                          ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'SN ${device.serialNumber}',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: AppColors.gray500,
                          ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              StatusBadge(
                label: device.state.label,
                tone: device.state.badgeTone,
                showDot: true,
              ),
            ],
          ),
          if (device.lastSeenAt != null && device.lastSeenAt!.isNotEmpty) ...[
            const SizedBox(height: DesignTokens.spaceXs + 2),
            Row(
              children: [
                Icon(Icons.cloud_done_rounded,
                    size: 12, color: AppColors.gray400),
                const SizedBox(width: 4),
                Text(
                  'Last seen ${_formatDateTime(device.lastSeenAt)}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: AppColors.gray500,
                      ),
                ),
              ],
            ),
          ],
          const SizedBox(height: DesignTokens.spaceSm),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: isMutating
                  ? null
                  : () => _showReleaseDeviceSheet(device, patientId),
              icon: isMutating
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(
                          strokeWidth: 2, color: AppColors.error),
                    )
                  : const Icon(Icons.link_off_rounded, size: 18),
              label: const Text(
                'Release Device',
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
              ),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.error,
                side: const BorderSide(color: AppColors.errorLight),
                padding:
                    const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Bottom sheet listing available devices for assignment. Picking one calls
  /// `assignDevice` with the device's `version` (sourced from the available
  /// projection, which carries it).
  void _showAssignDeviceSheet(String patientId) {
    final availableAsync = ref.read(availableDevicesProvider);
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(DesignTokens.radiusXl)),
      ),
      builder: (sheetContext) {
        return DraggableScrollableSheet(
          initialChildSize: 0.6,
          minChildSize: 0.3,
          maxChildSize: 0.9,
          expand: false,
          builder: (_, scrollController) {
            return Padding(
              padding: EdgeInsets.only(
                left: DesignTokens.spaceMd,
                right: DesignTokens.spaceMd,
                top: DesignTokens.spaceMd,
                bottom: MediaQuery.of(sheetContext).viewInsets.bottom +
                    DesignTokens.spaceMd,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      margin:
                          const EdgeInsets.only(bottom: DesignTokens.spaceMd),
                      decoration: BoxDecoration(
                        color: AppColors.gray200,
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusFull),
                      ),
                    ),
                  ),
                  Text(
                    'Assign a Device',
                    style:
                        Theme.of(sheetContext).textTheme.titleMedium?.copyWith(
                              fontWeight: FontWeight.bold,
                              color: AppColors.gray900,
                            ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXs),
                  Text(
                    'Select an available device to assign to this patient.',
                    style: Theme.of(sheetContext).textTheme.bodySmall?.copyWith(
                          color: AppColors.gray500,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  Expanded(
                    child: availableAsync.when(
                      data: (devices) {
                        if (devices.isEmpty) {
                          return const EmptyView(
                            title: 'No devices available',
                            body: 'There are no unassigned devices in your '
                                'organization ready to assign.',
                            icon: Icons.devices_other_outlined,
                          );
                        }
                        return ListView.separated(
                          controller: scrollController,
                          itemCount: devices.length,
                          separatorBuilder: (_, __) =>
                              const SizedBox(height: DesignTokens.spaceSm),
                          itemBuilder: (_, index) {
                            final d = devices[index];
                            return _buildAvailableDeviceTile(d, patientId);
                          },
                        );
                      },
                      loading: () => const Center(
                        child: SizedBox(
                          width: 24,
                          height: 24,
                          child: CircularProgressIndicator(
                              strokeWidth: 2, color: AppColors.primary),
                        ),
                      ),
                      error: (err, _) {
                        final apiError =
                            err is ApiError ? err : toApiError(err);
                        return ErrorView(
                          message: apiError.isForbidden
                              ? 'No access to available devices.'
                              : 'Could not load available devices.',
                          onRetry: apiError.isForbidden
                              ? null
                              : () => ref.invalidate(availableDevicesProvider),
                          isForbidden: apiError.isForbidden,
                        );
                      },
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Widget _buildAvailableDeviceTile(Device device, String patientId) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surfaceVariant,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.gray200),
      ),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceSm + 2,
            vertical: DesignTokens.spaceXs),
        leading: Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: AppColors.primaryContainer,
            borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
          ),
          child: Icon(DeviceTypeIcon.icon(device.deviceType),
              size: 20, color: AppColors.primary),
        ),
        title: Text(
          DeviceTypeIcon.label(device.deviceType),
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray900,
              ),
        ),
        subtitle: Text(
          'SN ${device.serialNumber}',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: AppColors.gray500,
              ),
        ),
        trailing: FilledButton(
          onPressed: device.state.isAssignable
              ? () => _onAssign(device, patientId)
              : null,
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: AppColors.white,
            minimumSize: const Size(72, 36),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            ),
          ),
          child: const Text('Assign',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold)),
        ),
      ),
    );
  }

  Future<void> _onAssign(Device device, String patientId) async {
    Navigator.of(context).pop(); // close the picker sheet
    final notifier = ref.read(deviceAssignmentProvider.notifier);
    final ok = await notifier.assignDevice(
      deviceId: device.id,
      patientProfileId: patientId,
      expectedVersion: device.version,
    );
    if (!mounted) return;
    if (ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              '${DeviceTypeIcon.label(device.deviceType)} assigned to patient.'),
          duration: const Duration(seconds: 2),
        ),
      );
    } else {
      final st = ref.read(deviceAssignmentProvider);
      final msg = st is DeviceAssignmentError
          ? st.message
          : 'Could not assign the device. It may have been claimed by another '
              'session — refresh and try again.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      notifier.reset();
    }
  }

  /// Bottom sheet to pick a release reason code, then call `releaseDevice`.
  /// The `expected_version` comes from `DoctorDevice.version`, which the
  /// backend includes in the `GET /doctor/devices` response (added so that
  /// release works without a separate read-one endpoint). The version cache
  /// is checked as a fallback for any edge case where the projection did not
  /// carry the field.
  void _showReleaseDeviceSheet(DoctorDevice device, String patientId) {
    final versionCache = ref.read(deviceVersionCacheProvider);
    final expectedVersion =
        device.version != 0 ? device.version : versionCache[device.id];

    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(DesignTokens.radiusXl)),
      ),
      builder: (sheetContext) {
        return SafeArea(
          child: Padding(
            padding: EdgeInsets.only(
              left: DesignTokens.spaceMd,
              right: DesignTokens.spaceMd,
              top: DesignTokens.spaceMd,
              bottom: MediaQuery.of(sheetContext).viewInsets.bottom +
                  DesignTokens.spaceMd,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    margin: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
                    decoration: BoxDecoration(
                      color: AppColors.gray200,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                  ),
                ),
                Text(
                  'Release Device',
                  style: Theme.of(sheetContext).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppColors.gray900,
                      ),
                ),
                const SizedBox(height: DesignTokens.spaceXs),
                Text(
                  '${DeviceTypeIcon.label(device.deviceType)} • SN ${device.serialNumber}',
                  style: Theme.of(sheetContext).textTheme.bodySmall?.copyWith(
                        color: AppColors.gray500,
                      ),
                ),
                const SizedBox(height: DesignTokens.spaceMd),
                if (expectedVersion == null) ...[
                  Container(
                    padding: const EdgeInsets.all(DesignTokens.spaceSm + 2),
                    decoration: BoxDecoration(
                      color: AppColors.warningContainer,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                    ),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.info_outline_rounded,
                            size: 18, color: AppColors.warningDark),
                        const SizedBox(width: DesignTokens.spaceSm),
                        Expanded(
                          child: Text(
                            'The device version could not be determined. '
                            'Refresh the patient details and try again.',
                            style: Theme.of(sheetContext)
                                .textTheme
                                .bodySmall
                                ?.copyWith(color: AppColors.warningDark),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  SizedBox(
                    width: double.infinity,
                    child: TextButton(
                      onPressed: () => Navigator.of(sheetContext).pop(),
                      child: const Text('Close'),
                    ),
                  ),
                ] else
                  _buildReleaseReasonPicker(
                      sheetContext, device, patientId, expectedVersion),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildReleaseReasonPicker(
    BuildContext sheetContext,
    DoctorDevice device,
    String patientId,
    int expectedVersion,
  ) {
    return StatefulBuilder(
      builder: (context, setState) {
        // Manage the selection here rather than via RadioListTile's
        // deprecated groupValue/onChanged params.
        DeviceReleaseReasonCode selected =
            DeviceReleaseReasonCode.administrativeRequest;
        return Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Reason for release',
              style: Theme.of(sheetContext).textTheme.labelLarge?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: AppColors.gray700,
                  ),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            for (final code in DeviceReleaseReason.values) ...[
              _buildReleaseReasonTile(
                sheetContext,
                code: code,
                selected: selected == code,
                onTap: () => setState(() => selected = code),
              ),
              const SizedBox(height: DesignTokens.spaceXs),
            ],
            const SizedBox(height: DesignTokens.spaceMd),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: () => Navigator.of(sheetContext).pop(),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.gray600,
                      side: const BorderSide(color: AppColors.gray300),
                      padding: const EdgeInsets.symmetric(
                          vertical: DesignTokens.spaceSm + 2),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusFull),
                      ),
                    ),
                    child: const Text('Cancel'),
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: () => _onRelease(device, patientId,
                        expectedVersion, selected, sheetContext),
                    icon: const Icon(Icons.link_off_rounded, size: 18),
                    label: const Text(
                      'Release',
                      style:
                          TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                    ),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.error,
                      foregroundColor: AppColors.white,
                      padding: const EdgeInsets.symmetric(
                          vertical: DesignTokens.spaceSm + 2),
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
        );
      },
    );
  }

  Widget _buildReleaseReasonTile(
    BuildContext sheetContext, {
    required DeviceReleaseReasonCode code,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Material(
      color: selected ? AppColors.primaryContainer : AppColors.surfaceVariant,
      borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceSm + 2,
              vertical: DesignTokens.spaceSm),
          child: Row(
            children: [
              Icon(
                selected
                    ? Icons.radio_button_checked_rounded
                    : Icons.radio_button_unchecked_rounded,
                size: 20,
                color: selected ? AppColors.primary : AppColors.gray400,
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: Text(
                  DeviceReleaseReason.label(code),
                  style: Theme.of(sheetContext).textTheme.bodyMedium?.copyWith(
                        fontWeight:
                            selected ? FontWeight.w600 : FontWeight.w500,
                        color: selected
                            ? AppColors.primaryDark
                            : AppColors.gray700,
                      ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _onRelease(
    DoctorDevice device,
    String patientId,
    int expectedVersion,
    DeviceReleaseReasonCode reasonCode,
    BuildContext sheetContext,
  ) async {
    Navigator.of(sheetContext).pop(); // close the reason sheet
    final notifier = ref.read(deviceAssignmentProvider.notifier);
    final ok = await notifier.releaseDevice(
      deviceId: device.id,
      expectedVersion: expectedVersion,
      reasonCode: reasonCode.wireValue,
      patientProfileId: patientId,
    );
    if (!mounted) return;
    if (ok) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${DeviceTypeIcon.label(device.deviceType)} released.'),
          duration: const Duration(seconds: 2),
        ),
      );
    } else {
      final st = ref.read(deviceAssignmentProvider);
      final msg = st is DeviceAssignmentError
          ? st.message
          : 'Could not release the device. It may have been modified by '
              'another session — refresh and try again.';
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg)));
      notifier.reset();
    }
  }

  // ------------------------------------------------------------------
  // Sub-builders — consultations section
  // ------------------------------------------------------------------

  Widget _buildConsultationsSection(String patientId) {
    // Derive the consultation timeline from this patient's appointments. There
    // is no per-patient consultation list provider in the foundation layer, so
    // the appointment list (which carries date, mode, status) is the honest
    // source of the patient's visit history.
    final apptsAsync =
        ref.watch(appointmentsProvider(const AppointmentFilter()));

    return PremiumCard(
      title: 'Recent Consultations',
      child: apptsAsync.when(
        data: (resp) {
          final patientAppts =
              resp.data.where((a) => a.patientProfileId == patientId).toList()
                ..sort((a, b) {
                  final ta = _parseTimestamp(a.startsAt);
                  final tb = _parseTimestamp(b.startsAt);
                  if (ta == null || tb == null) return 0;
                  return tb.compareTo(ta); // newest first
                });

          if (patientAppts.isEmpty) {
            return Padding(
              padding:
                  const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
              child: const EmptyView(
                title: 'No consultations yet',
                body:
                    'Appointments with this patient will appear in the timeline here.',
                icon: Icons.event_note_outlined,
              ),
            );
          }

          // A "consultation" row is an appointment that has started or beyond.
          final hasConsultation = patientAppts.where((a) =>
              a.status == AppointmentStatus.inProgress ||
              a.status == AppointmentStatus.completed ||
              a.status == AppointmentStatus.noShow ||
              a.status == AppointmentStatus.checkedIn);

          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Quick start: any active upcoming appointment can start a
              // consultation.
              for (final appt in patientAppts.take(6)) ...[
                _buildConsultationItem(appt),
                const SizedBox(height: DesignTokens.spaceSm),
              ],
              if (hasConsultation.isEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: DesignTokens.spaceXs),
                  child: Text(
                    'No completed consultations yet.',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: AppColors.gray500,
                        ),
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
                  ? 'No access to appointments.'
                  : 'Could not load consultations.',
              onRetry: apiError.isForbidden
                  ? null
                  : () => ref.invalidate(
                      appointmentsProvider(const AppointmentFilter())),
              isForbidden: apiError.isForbidden,
            ),
          );
        },
      ),
    );
  }

  Widget _buildConsultationItem(Appointment appt) {
    final isActive = appt.status == AppointmentStatus.confirmed ||
        appt.status == AppointmentStatus.checkedIn ||
        appt.status == AppointmentStatus.inProgress;
    final isStarting = _startingConsultationApptId == appt.id;
    final canStart = isActive &&
        (appt.mode == AppointmentMode.video ||
            appt.mode == AppointmentMode.audio ||
            appt.mode == AppointmentMode.chat);

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceSm + 2),
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
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                ),
                child: Icon(_modeIcon(appt.mode),
                    size: 18, color: AppColors.primary),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '${_modeLabel(appt.mode)} Consultation',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            fontWeight: FontWeight.w600,
                            color: AppColors.gray900,
                          ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      '${_formatDate(appt.startsAt)} • ${_formatTime(appt.startsAt)}',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: AppColors.gray500,
                          ),
                    ),
                  ],
                ),
              ),
              StatusBadge(
                label: _apptStatusLabel(appt.status),
                tone: _apptStatusTone(appt.status),
              ),
            ],
          ),
          if (canStart) ...[
            const SizedBox(height: DesignTokens.spaceSm),
            SizedBox(
              width: double.infinity,
              child: FilledButton.icon(
                onPressed: isStarting ? null : () => _startConsultation(appt),
                icon: isStarting
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: AppColors.white),
                      )
                    : Icon(_modeIcon(appt.mode), size: 18),
                label: const Text(
                  'Start Consultation',
                  style: TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
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
          ],
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Sub-builders — shimmer
  // ------------------------------------------------------------------

  Widget _buildShimmerHeader() {
    return Shimmer.fromColors(
      baseColor: AppColors.shimmerBase,
      highlightColor: AppColors.shimmerHighlight,
      child: Column(
        children: [
          Container(
            width: DesignTokens.avatar2xl,
            height: DesignTokens.avatar2xl,
            decoration: const BoxDecoration(
              color: AppColors.white,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Container(
            height: 24,
            width: 200,
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(8),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Container(
            height: 14,
            width: 240,
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(6),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildShimmerCard(double height) {
    return Shimmer.fromColors(
      baseColor: AppColors.shimmerBase,
      highlightColor: AppColors.shimmerHighlight,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        ),
      ),
    );
  }
}
