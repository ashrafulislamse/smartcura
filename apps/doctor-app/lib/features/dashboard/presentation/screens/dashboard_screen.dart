import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/models/doctor_patient_page.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/dashboard_provider.dart';
import '../../../../core/providers/earnings_provider.dart';
import '../../../../core/providers/iot_provider.dart';
import '../../../../core/providers/message_provider.dart';
import '../../../../core/providers/notification_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Doctor Dashboard — redesigned to a modern practice overview.
///
/// Inspired by clean clinical dashboards: greeting header, four KPI stat cards,
/// today’s appointments, live patient monitoring, a 7-day vitals trend, an AI
/// assistant call-out, and a compact schedule list. All data is real:
/// - Dashboard counts from `GET /doctor/dashboard`.
/// - Latest vitals from the next booked patient via `GET /patients/{id}/vital-readings`.
/// - Patient names resolved through `GET /doctor/patients`.
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  String? _processingAppointmentId;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  String _greeting() {
    final hour = DateTime.now().hour;
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  String _doctorName(String displayName) {
    final parts = displayName.trim().split(RegExp(r'\s+'));
    final body = (parts.length > 1 && parts.first.endsWith('.'))
        ? parts.skip(1).join(' ')
        : displayName.trim();
    return 'Dr. $body';
  }

  DateTime? _parseTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso);
  }

  String _formatTime(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '--:--';
    return DateFormat.jm().format(dt);
  }

  String _formatDateShort(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '';
    return DateFormat('MMM d').format(dt);
  }

  String _shortId(String id) {
    if (id.length <= 8) return id;
    return '#${id.substring(id.length - 8).toUpperCase()}';
  }

  AppointmentStatus _parseStatus(String status) {
    try {
      return appointmentStatusFromWire(status);
    } catch (_) {
      return AppointmentStatus.unknown;
    }
  }

  AppointmentMode _parseMode(String mode) {
    try {
      return appointmentModeFromWire(mode);
    } catch (_) {
      return AppointmentMode.unknown;
    }
  }

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
        AppointmentMode.inPerson => 'On-site',
        AppointmentMode.unknown => 'Appointment',
      };

  Color _modeColor(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => AppColors.info,
        AppointmentMode.audio => AppColors.primary,
        AppointmentMode.chat => AppColors.accent,
        AppointmentMode.inPerson => AppColors.success,
        AppointmentMode.unknown => AppColors.gray500,
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

  String _vitalStatusLabel(VitalMetric metric, double value) {
    switch (metric) {
      case VitalMetric.heartRate:
        return value >= 60 && value <= 100 ? 'Normal' : 'Review';
      case VitalMetric.oxygenSaturation:
        return value >= 95 ? 'Normal' : 'Low';
      case VitalMetric.bodyTemperature:
        return value >= 36.1 && value <= 37.2 ? 'Normal' : 'Review';
      default:
        return '';
    }
  }

  Color _vitalStatusColor(VitalMetric metric, double value) {
    final label = _vitalStatusLabel(metric, value);
    if (label == 'Normal') return AppColors.success;
    if (label == 'Low') return AppColors.warning;
    return AppColors.error;
  }

  String _vitalUnit(VitalMetric metric) => switch (metric) {
        VitalMetric.heartRate => 'bpm',
        VitalMetric.oxygenSaturation => '%',
        VitalMetric.bodyTemperature => '°C',
        VitalMetric.systolicBp => 'mmHg',
        VitalMetric.diastolicBp => 'mmHg',
        VitalMetric.respiratoryRate => '/min',
        VitalMetric.bloodGlucose => 'mg/dL',
        VitalMetric.bodyWeight => 'kg',
        _ => '',
      };

  IconData _vitalIcon(VitalMetric metric) => switch (metric) {
        VitalMetric.heartRate => Icons.favorite_rounded,
        VitalMetric.oxygenSaturation => Icons.air_rounded,
        VitalMetric.bodyTemperature => Icons.thermostat_rounded,
        _ => Icons.monitor_heart_rounded,
      };

  Color _vitalColor(VitalMetric metric) => switch (metric) {
        VitalMetric.heartRate => AppColors.error,
        VitalMetric.oxygenSaturation => AppColors.info,
        VitalMetric.bodyTemperature => AppColors.warning,
        _ => AppColors.primary,
      };

  VitalReading? _latestReading(
      List<VitalReading> readings, VitalMetric metric) {
    final filtered = readings.where((r) => r.metric == metric).toList();
    filtered.sort((a, b) => b.recordedAt.compareTo(a.recordedAt));
    return filtered.isNotEmpty ? filtered.first : null;
  }

  List<VitalReading> _readingsForTrend(
      List<VitalReading> readings, VitalMetric metric) {
    final filtered = readings.where((r) => r.metric == metric).toList();
    filtered.sort((a, b) => a.recordedAt.compareTo(b.recordedAt));
    return filtered.take(20).toList();
  }

  Map<String, String> _patientNameMap(
      AsyncValue<DoctorAssignedPatientPage> patientsAsync) {
    final page = patientsAsync.valueOrNull;
    if (page == null) return {};
    return {for (final p in page.data) p.profileId: p.displayName};
  }

  // ------------------------------------------------------------------
  // Refresh / actions
  // ------------------------------------------------------------------

  Future<void> _onRefresh() async {
    ref.invalidate(dashboardProvider);
    ref.invalidate(earningsProvider);
    ref.invalidate(doctorPatientsProvider(null));
    ref.invalidate(doctorInboxProvider);
    await ref.read(dashboardProvider.future);
  }

  Future<void> _transitionPending(
    DoctorUpcomingAppointment appt,
    String newStatus, {
    AppointmentCancellationReasonCode? reasonCode,
  }) async {
    setState(() => _processingAppointmentId = appt.appointmentId);
    try {
      final full =
          await ref.read(appointmentDetailProvider(appt.appointmentId).future);
      final notifier = ref.read(appointmentTransitionProvider.notifier);
      final ok = await notifier.transition(
        appointmentId: appt.appointmentId,
        status: newStatus,
        expectedVersion: full.version,
        cancellationReasonCode: reasonCode,
      );
      if (ok) {
        ref.invalidate(dashboardProvider);
        ref.invalidate(appointmentsProvider);
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(newStatus == 'cancelled'
                  ? 'Request declined.'
                  : 'Request accepted.'),
              duration: const Duration(seconds: 2),
            ),
          );
        }
      } else {
        final err = ref.read(appointmentTransitionProvider).error;
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(err is ApiError
                  ? err.displayMessage
                  : 'Could not update the request. Please try again.'),
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e is ApiError
                ? e.displayMessage
                : 'Could not update the request. Please try again.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _processingAppointmentId = null);
    }
  }

  // ------------------------------------------------------------------
  // Build
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(currentProfileProvider);
    final dashboardAsync = ref.watch(dashboardProvider);
    final earningsAsync = ref.watch(earningsProvider);
    final patientsAsync = ref.watch(doctorPatientsProvider(null));
    final inboxAsync = ref.watch(doctorInboxProvider(null));
    final notifsAsync =
        ref.watch(notificationsProvider(const NotificationFilter()));

    final displayName = profile?.displayName ?? 'Doctor';
    final unreadNotifications = dashboardAsync
            .valueOrNull?.data.unreadNotifications ??
        notifsAsync.valueOrNull?.data.where((n) => n.readAt == null).length ??
        0;
    final unreadMessages = inboxAsync.valueOrNull?.data
            .fold<int>(0, (sum, c) => sum + c.unreadCount) ??
        0;

    // Resolve the next booked patient so the monitoring cards can show real vitals.
    final upcomingList =
        dashboardAsync.valueOrNull?.data.upcomingAppointments ?? [];
    final nextPatientId = upcomingList.isNotEmpty &&
            upcomingList.first.patientProfileId.isNotEmpty
        ? upcomingList.first.patientProfileId
        : '';

    final now = DateTime.now().toUtc();
    final vitalsAsync = nextPatientId.isNotEmpty
        ? ref.watch(patientVitalReadingsProvider((
            nextPatientId,
            VitalReadingsFilter(
              from: now.subtract(const Duration(days: 7)).toIso8601String(),
              to: now.toIso8601String(),
            ),
          )))
        : const AsyncValue<VitalReadingListResponse?>.data(null);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: RefreshIndicator(
          color: AppColors.primary,
          onRefresh: _onRefresh,
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverToBoxAdapter(
                child: dashboardAsync.when(
                  data: (dashboard) => Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      _buildHeader(
                          displayName, unreadNotifications, unreadMessages),
                      _buildLoadedContent(
                        dashboard: dashboard,
                        earningsAsync: earningsAsync,
                        patientsAsync: patientsAsync,
                        vitalsAsync: vitalsAsync,
                      ),
                    ],
                  ),
                  loading: () => _buildLoadingContent(),
                  error: (err, _) =>
                      _buildErrorContent(err, displayName, unreadNotifications),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Loaded content
  // ------------------------------------------------------------------

  Widget _buildLoadedContent({
    required DoctorDashboardResponse dashboard,
    required AsyncValue<DoctorEarnings> earningsAsync,
    required AsyncValue<DoctorAssignedPatientPage> patientsAsync,
    required AsyncValue<VitalReadingListResponse?> vitalsAsync,
  }) {
    final data = dashboard.data;
    final upcoming = data.upcomingAppointments ?? <DoctorUpcomingAppointment>[];
    final sorted = List<DoctorUpcomingAppointment>.from(upcoming)
      ..sort((a, b) {
        final aTime = _parseTimestamp(a.startsAt);
        final bTime = _parseTimestamp(b.startsAt);
        if (aTime == null || bTime == null) return 0;
        return aTime.compareTo(bTime);
      });

    final today = DateTime.now();
    final todayAppts = sorted.where((a) {
      final t = _parseTimestamp(a.startsAt);
      if (t == null) return false;
      return t.year == today.year &&
          t.month == today.month &&
          t.day == today.day;
    }).toList();

    final nameMap = _patientNameMap(patientsAsync);
    final vitals = vitalsAsync.valueOrNull?.data ?? [];
    final nextPatientName = sorted.isNotEmpty
        ? (nameMap[sorted.first.patientProfileId] ?? 'Patient')
        : '';

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            'Doctor Dashboard',
            style: TextStyle(
              fontSize: 26,
              fontWeight: FontWeight.w800,
              color: AppColors.gray900,
              letterSpacing: -0.5,
              height: 1.2,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildStatCards(data),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildAppointmentsSection(todayAppts, nameMap),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildPatientMonitoringSection(vitals, nextPatientName),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildTrendChartSection(vitals),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildAiSupportSection(),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildScheduleSection(sorted, nameMap),
          const SizedBox(height: 104), // bottom nav clearance
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Header
  // ------------------------------------------------------------------

  Widget _buildHeader(
      String displayName, int unreadNotifications, int unreadMessages) {
    final topInset = MediaQuery.of(context).viewPadding.top;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        topInset + DesignTokens.spaceMd,
        DesignTokens.spaceMd,
        DesignTokens.spaceSm,
      ),
      child: Row(
        children: [
          AvatarWidget(name: displayName, size: 48),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  '${_greeting()},',
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: AppColors.gray500,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _doctorName(displayName),
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: AppColors.gray900,
                    letterSpacing: -0.3,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          _buildIconButton(
            icon: Icons.chat_bubble_outline_rounded,
            badge: unreadMessages,
            onTap: () => context.push('/messages'),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          _buildIconButton(
            icon: Icons.notifications_outlined,
            badge: unreadNotifications,
            onTap: () => context.push('/notifications'),
          ),
        ],
      ),
    );
  }

  Widget _buildIconButton({
    required IconData icon,
    required int badge,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: 44,
        height: 44,
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.gray200),
          boxShadow: const [
            BoxShadow(
              color: AppColors.shadowLight,
              blurRadius: 8,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: Stack(
          alignment: Alignment.center,
          children: [
            Icon(icon, color: AppColors.gray700, size: 22),
            if (badge > 0)
              Positioned(
                right: 6,
                top: 6,
                child: Container(
                  padding: const EdgeInsets.all(2),
                  decoration: BoxDecoration(
                    color: AppColors.error,
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.white, width: 1.5),
                  ),
                  constraints:
                      const BoxConstraints(minWidth: 16, minHeight: 16),
                  child: Text(
                    badge > 9 ? '9+' : '$badge',
                    style: const TextStyle(
                      color: AppColors.white,
                      fontSize: 9,
                      fontWeight: FontWeight.bold,
                    ),
                    textAlign: TextAlign.center,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Stat cards
  // ------------------------------------------------------------------

  Widget _buildStatCards(DoctorDashboardGroups data) {
    final cards = [
      _StatCardData(
        label: 'Today\'s Appointments',
        value: data.todayAppointments?.toString() ?? '0',
        sub: 'Bookings for today',
        icon: Icons.calendar_today_rounded,
        color: AppColors.primary,
        bg: AppColors.primaryContainer,
        onTap: () => context.push('/appointments'),
      ),
      _StatCardData(
        label: 'Active Patients',
        value: data.assignedPatients?.toString() ?? '0',
        sub: 'In your caseload',
        icon: Icons.people_rounded,
        color: AppColors.secondary,
        bg: AppColors.secondaryContainer,
        onTap: () => context.push('/patients'),
      ),
      _StatCardData(
        label: 'Pending Reviews',
        value: data.pendingNotes?.toString() ?? '0',
        sub: 'Notes to complete',
        icon: Icons.edit_note_rounded,
        color: AppColors.warning,
        bg: AppColors.warningContainer,
        onTap: () => context.push('/consultation-notes'),
      ),
      _StatCardData(
        label: 'Alerts',
        value: data.activeIotAlerts?.toString() ?? '0',
        sub: 'Need attention',
        icon: Icons.notifications_active_rounded,
        color: AppColors.error,
        bg: AppColors.errorContainer,
        onTap: () => context.push('/patients'),
      ),
    ];

    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: cards.length,
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        mainAxisSpacing: DesignTokens.spaceMd,
        crossAxisSpacing: DesignTokens.spaceMd,
        childAspectRatio: 1.15,
      ),
      itemBuilder: (context, index) => _buildStatCard(cards[index]),
    );
  }

  Widget _buildStatCard(_StatCardData card) {
    return GestureDetector(
      onTap: card.onTap,
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          border: Border.all(color: AppColors.gray200),
          boxShadow: const [
            BoxShadow(
              color: AppColors.shadowLight,
              blurRadius: 12,
              offset: Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: card.bg,
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              child: Icon(card.icon, color: card.color, size: 22),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  card.value,
                  style: const TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.w800,
                    color: AppColors.gray900,
                    height: 1,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  card.label,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.gray700,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  card.sub,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.gray500,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Appointments section
  // ------------------------------------------------------------------

  Widget _buildAppointmentsSection(
    List<DoctorUpcomingAppointment> todayAppts,
    Map<String, String> nameMap,
  ) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
        boxShadow: const [
          BoxShadow(
            color: AppColors.shadowLight,
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Today\'s Appointments',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: AppColors.gray900,
                ),
              ),
              GestureDetector(
                onTap: () => context.push('/appointments'),
                child: Row(
                  children: [
                    Icon(Icons.calendar_month_outlined,
                        color: AppColors.primary, size: 16),
                    const SizedBox(width: 4),
                    Text(
                      'View Calendar',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          if (todayAppts.isEmpty)
            _buildEmptyState(
              icon: Icons.event_busy_rounded,
              title: 'No appointments today',
              body: 'Your schedule is clear. New bookings will appear here.',
            )
          else
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: todayAppts.length,
              separatorBuilder: (_, __) =>
                  const Divider(height: 24, color: AppColors.gray100),
              itemBuilder: (context, index) =>
                  _buildAppointmentRow(todayAppts[index], nameMap),
            ),
          if (todayAppts.isNotEmpty) ...[
            const SizedBox(height: DesignTokens.spaceMd),
            GestureDetector(
              onTap: () => context.push('/appointments'),
              child: Center(
                child: Text(
                  'View all appointments',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildAppointmentRow(
      DoctorUpcomingAppointment appt, Map<String, String> nameMap) {
    final status = _parseStatus(appt.status);
    final mode = _parseMode(appt.mode);
    final patientName = nameMap[appt.patientProfileId] ??
        'Patient ${_shortId(appt.patientProfileId)}';
    final isPending = status == AppointmentStatus.pendingPayment;
    final isProcessing = _processingAppointmentId == appt.appointmentId;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 56,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _formatTime(appt.startsAt),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.gray900,
                ),
              ),
              Text(
                _formatDateShort(appt.startsAt),
                style: const TextStyle(
                  fontSize: 11,
                  color: AppColors.gray500,
                ),
              ),
            ],
          ),
        ),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                patientName,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.gray900,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: _modeColor(mode).withValues(alpha: 0.1),
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(_modeIcon(mode),
                            size: 12, color: _modeColor(mode)),
                        const SizedBox(width: 4),
                        Text(
                          _modeLabel(mode),
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                            color: _modeColor(mode),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  StatusBadge(
                      tone: _statusTone(status), label: _statusLabel(status)),
                ],
              ),
            ],
          ),
        ),
        if (isPending)
          Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildIconAction(
                icon: Icons.check_rounded,
                color: AppColors.success,
                onTap: isProcessing
                    ? null
                    : () => _transitionPending(appt, 'confirmed'),
              ),
              const SizedBox(width: 8),
              _buildIconAction(
                icon: Icons.close_rounded,
                color: AppColors.error,
                onTap: isProcessing
                    ? null
                    : () => _transitionPending(appt, 'cancelled'),
              ),
            ],
          )
        else
          _buildIconAction(
            icon: Icons.more_vert_rounded,
            color: AppColors.gray500,
            onTap: () =>
                context.push('/appointment-details', extra: appt.appointmentId),
          ),
      ],
    );
  }

  Widget _buildIconAction({
    required IconData icon,
    required Color color,
    required VoidCallback? onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        width: 32,
        height: 32,
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.1),
          shape: BoxShape.circle,
        ),
        child: Icon(icon, size: 16, color: color),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Patient monitoring
  // ------------------------------------------------------------------

  Widget _buildPatientMonitoringSection(
      List<VitalReading> vitals, String patientName) {
    final hr = _latestReading(vitals, VitalMetric.heartRate);
    final spo2 = _latestReading(vitals, VitalMetric.oxygenSaturation);
    final temp = _latestReading(vitals, VitalMetric.bodyTemperature);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Text(
              'Patient Monitoring',
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w800,
                color: AppColors.gray900,
              ),
            ),
            if (patientName.isNotEmpty)
              Text(
                patientName,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.gray500,
                ),
              ),
          ],
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        if (hr == null && spo2 == null && temp == null)
          _buildEmptyState(
            icon: Icons.monitor_heart_outlined,
            title: 'No live vitals',
            body: vitals.isEmpty && patientName.isEmpty
                ? 'Bookings with connected devices will show live vitals here.'
                : 'The next patient has no recent vitals. Sync a device to see data.',
          )
        else
          SizedBox(
            height: 130,
            child: ListView(
              scrollDirection: Axis.horizontal,
              children: [
                if (hr != null) _buildVitalCard(hr),
                if (spo2 != null) _buildVitalCard(spo2),
                if (temp != null) _buildVitalCard(temp),
              ],
            ),
          ),
      ],
    );
  }

  Widget _buildVitalCard(VitalReading reading) {
    final metric = reading.metric;
    final color = _vitalColor(metric);
    final status = _vitalStatusLabel(metric, reading.value);
    final statusColor = _vitalStatusColor(metric, reading.value);
    final icon = _vitalIcon(metric);
    final unit = reading.unit.isNotEmpty ? reading.unit : _vitalUnit(metric);

    return Container(
      width: 160,
      margin: const EdgeInsets.only(right: DesignTokens.spaceMd),
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
        boxShadow: const [
          BoxShadow(
            color: AppColors.shadowLight,
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 32,
                height: 32,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: Icon(icon, color: color, size: 18),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  _vitalMetricLabel(metric),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.gray700,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ],
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                reading.value.toStringAsFixed(
                    metric == VitalMetric.oxygenSaturation ? 0 : 1),
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w800,
                  color: AppColors.gray900,
                  height: 1,
                ),
              ),
              const SizedBox(width: 4),
              Text(
                unit,
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.gray500,
                ),
              ),
            ],
          ),
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: statusColor,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 6),
              Text(
                status,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: statusColor,
                ),
              ),
              const Spacer(),
              _MiniSparkline(
                color: color,
                data: _readingsForTrend([reading], metric)
                    .map((r) => r.value)
                    .toList(),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _vitalMetricLabel(VitalMetric m) => switch (m) {
        VitalMetric.heartRate => 'Heart Rate',
        VitalMetric.oxygenSaturation => 'SpO₂',
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

  // ------------------------------------------------------------------
  // Trend chart
  // ------------------------------------------------------------------

  Widget _buildTrendChartSection(List<VitalReading> vitals) {
    final hrReadings = _readingsForTrend(vitals, VitalMetric.heartRate);

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
        boxShadow: const [
          BoxShadow(
            color: AppColors.shadowLight,
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                '7-Day Trend Overview',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: AppColors.gray900,
                ),
              ),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(
                  color: AppColors.gray100,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Heart Rate',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        color: AppColors.gray700,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Icon(Icons.keyboard_arrow_down_rounded,
                        size: 16, color: AppColors.gray500),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          if (hrReadings.length < 2)
            _buildEmptyState(
              icon: Icons.show_chart_rounded,
              title: 'Not enough data',
              body:
                  'At least two heart-rate readings are needed to draw a trend.',
            )
          else
            SizedBox(
              height: 180,
              child: _TrendLineChart(
                readings: hrReadings,
                color: AppColors.error,
                unit: 'bpm',
              ),
            ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // AI support
  // ------------------------------------------------------------------

  Widget _buildAiSupportSection() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
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
            blurRadius: 16,
            offset: const Offset(0, 6),
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
                  color: AppColors.white.withValues(alpha: 0.2),
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: const Icon(Icons.auto_awesome_rounded,
                    color: AppColors.white, size: 22),
              ),
              const SizedBox(width: 12),
              const Expanded(
                child: Text(
                  'AI Support',
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w800,
                    color: AppColors.white,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          const Text(
            'Summarize patient visits, draft clinical notes, review AI artifacts, and more.',
            style: TextStyle(
              fontSize: 13,
              color: AppColors.white,
              height: 1.5,
            ),
          ),
          const SizedBox(height: 4),
          const Text(
            'Non-diagnostic • Human review required',
            style: TextStyle(
              fontSize: 11,
              color: AppColors.white,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: () => context.push('/doctor-ai'),
              icon: const Icon(Icons.psychology_alt_rounded, size: 18),
              label: const Text('Open AI Assistant'),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.white,
                foregroundColor: AppColors.primaryDark,
                elevation: 0,
                padding: const EdgeInsets.symmetric(vertical: 14),
                textStyle: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Schedule section
  // ------------------------------------------------------------------

  Widget _buildScheduleSection(
    List<DoctorUpcomingAppointment> sorted,
    Map<String, String> nameMap,
  ) {
    final items = sorted.take(5).toList();

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
        boxShadow: const [
          BoxShadow(
            color: AppColors.shadowLight,
            blurRadius: 12,
            offset: Offset(0, 4),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'Today\'s Schedule',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: AppColors.gray900,
                ),
              ),
              GestureDetector(
                onTap: () => context.push('/my-schedule'),
                child: Text(
                  'View full schedule',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          if (items.isEmpty)
            _buildEmptyState(
              icon: Icons.schedule_rounded,
              title: 'No upcoming slots',
              body: 'Your schedule is empty for the next 24 hours.',
            )
          else
            ListView.separated(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: items.length,
              separatorBuilder: (_, __) =>
                  const Divider(height: 20, color: AppColors.gray100),
              itemBuilder: (context, index) =>
                  _buildScheduleRow(items[index], nameMap),
            ),
        ],
      ),
    );
  }

  Widget _buildScheduleRow(
      DoctorUpcomingAppointment appt, Map<String, String> nameMap) {
    final patientName = nameMap[appt.patientProfileId] ??
        'Patient ${_shortId(appt.patientProfileId)}';
    return Row(
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: const BoxDecoration(
            color: AppColors.success,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 12),
        SizedBox(
          width: 56,
          child: Text(
            _formatTime(appt.startsAt),
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.gray900,
            ),
          ),
        ),
        Expanded(
          child: Text(
            patientName,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppColors.gray800,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }

  // ------------------------------------------------------------------
  // Empty state helper
  // ------------------------------------------------------------------

  Widget _buildEmptyState({
    required IconData icon,
    required String title,
    required String body,
  }) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceLg),
      alignment: Alignment.center,
      child: Column(
        children: [
          Icon(icon, size: 36, color: AppColors.gray400),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            title,
            style: const TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.gray700,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            body,
            style: const TextStyle(
              fontSize: 13,
              color: AppColors.gray500,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Loading / error
  // ------------------------------------------------------------------

  Widget _buildLoadingContent() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Shimmer.fromColors(
        baseColor: AppColors.gray200,
        highlightColor: AppColors.gray100,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 80),
            Container(height: 32, width: 200, decoration: _shimmerBox),
            const SizedBox(height: DesignTokens.spaceLg),
            GridView.builder(
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              itemCount: 4,
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 2,
                mainAxisSpacing: DesignTokens.spaceMd,
                crossAxisSpacing: DesignTokens.spaceMd,
                childAspectRatio: 1.15,
              ),
              itemBuilder: (_, __) => Container(decoration: _shimmerBox),
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            Container(height: 240, decoration: _shimmerBox),
            const SizedBox(height: DesignTokens.spaceLg),
            Container(height: 160, decoration: _shimmerBox),
            const SizedBox(height: 104),
          ],
        ),
      ),
    );
  }

  BoxDecoration get _shimmerBox => BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
      );

  Widget _buildErrorContent(Object err, String displayName, int unreadCount) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildHeader(displayName, unreadCount, 0),
        Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          child: ErrorView(
            message: err is ApiError
                ? err.displayMessage
                : 'Could not load dashboard.',
            onRetry: _onRefresh,
          ),
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------
// Stat card data
// ------------------------------------------------------------------

class _StatCardData {
  const _StatCardData({
    required this.label,
    required this.value,
    required this.sub,
    required this.icon,
    required this.color,
    required this.bg,
    required this.onTap,
  });

  final String label;
  final String value;
  final String sub;
  final IconData icon;
  final Color color;
  final Color bg;
  final VoidCallback onTap;
}

// ------------------------------------------------------------------
// Mini sparkline
// ------------------------------------------------------------------

class _MiniSparkline extends StatelessWidget {
  const _MiniSparkline({required this.color, required this.data});

  final Color color;
  final List<double> data;

  @override
  Widget build(BuildContext context) {
    if (data.length < 2) {
      return const SizedBox(width: 40, height: 20);
    }
    final min = data.reduce((a, b) => a < b ? a : b);
    final max = data.reduce((a, b) => a > b ? a : b);
    final range = max - min;
    final spots = <FlSpot>[
      for (var i = 0; i < data.length; i++)
        FlSpot(i.toDouble(), range == 0 ? 0.5 : (data[i] - min) / range),
    ];

    return SizedBox(
      width: 40,
      height: 20,
      child: LineChart(
        LineChartData(
          gridData: const FlGridData(show: false),
          titlesData: const FlTitlesData(show: false),
          borderData: FlBorderData(show: false),
          lineBarsData: [
            LineChartBarData(
              spots: spots,
              isCurved: true,
              color: color,
              barWidth: 2,
              dotData: const FlDotData(show: false),
              belowBarData: BarAreaData(
                show: true,
                color: color.withValues(alpha: 0.1),
              ),
            ),
          ],
          lineTouchData: const LineTouchData(enabled: false),
          minX: 0,
          maxX: (data.length - 1).toDouble(),
          minY: 0,
          maxY: 1,
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------
// Trend line chart
// ------------------------------------------------------------------

class _TrendLineChart extends StatelessWidget {
  const _TrendLineChart({
    required this.readings,
    required this.color,
    required this.unit,
  });

  final List<VitalReading> readings;
  final Color color;
  final String unit;

  @override
  Widget build(BuildContext context) {
    final spots = <FlSpot>[
      for (var i = 0; i < readings.length; i++)
        FlSpot(i.toDouble(), readings[i].value),
    ];
    final values = readings.map((r) => r.value).toList();
    final minY = values.reduce((a, b) => a < b ? a : b);
    final maxY = values.reduce((a, b) => a > b ? a : b);
    final padding = (maxY - minY) * 0.15;

    return LineChart(
      LineChartData(
        gridData: FlGridData(
          show: true,
          drawVerticalLine: false,
          horizontalInterval: (maxY - minY) / 4,
          getDrawingHorizontalLine: (_) => FlLine(
            color: AppColors.gray200,
            strokeWidth: 1,
            dashArray: [4, 4],
          ),
        ),
        titlesData: FlTitlesData(
          leftTitles: AxisTitles(
            sideTitles: SideTitles(
              showTitles: true,
              reservedSize: 40,
              interval: (maxY - minY) / 4,
              getTitlesWidget: (value, meta) {
                return Text(
                  value.toStringAsFixed(0),
                  style:
                      const TextStyle(fontSize: 10, color: AppColors.gray500),
                );
              },
            ),
          ),
          bottomTitles:
              const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          rightTitles:
              const AxisTitles(sideTitles: SideTitles(showTitles: false)),
          topTitles:
              const AxisTitles(sideTitles: SideTitles(showTitles: false)),
        ),
        borderData: FlBorderData(show: false),
        lineBarsData: [
          LineChartBarData(
            spots: spots,
            isCurved: true,
            color: color,
            barWidth: 3,
            dotData: FlDotData(
              show: true,
              getDotPainter: (spot, percent, bar, index) => FlDotCirclePainter(
                radius: 4,
                color: color,
                strokeWidth: 2,
                strokeColor: AppColors.white,
              ),
            ),
            belowBarData: BarAreaData(
              show: true,
              color: color.withValues(alpha: 0.1),
            ),
          ),
        ],
        lineTouchData: LineTouchData(
          enabled: true,
          touchTooltipData: LineTouchTooltipData(
            tooltipBgColor: AppColors.gray900,
            getTooltipItems: (touchedSpots) => touchedSpots.map((spot) {
              return LineTooltipItem(
                '${spot.y.toStringAsFixed(1)} $unit',
                const TextStyle(
                  color: AppColors.white,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              );
            }).toList(),
          ),
        ),
        minY: minY - padding,
        maxY: maxY + padding,
      ),
    );
  }
}
