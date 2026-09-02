import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/models/doctor_patient_page.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Appointments List Screen — Schedule Hub.
///
/// Redesigned to the researched reference UI: a month label, a 7-day week strip
/// with per-day appointment-count dots, a 4-stat summary card for the selected
/// day, and a time-rail timeline of appointments. Pending requests that need
/// doctor confirmation are surfaced in a "Needs confirmation" strip above the
/// timeline with real Accept / Decline actions.
///
/// Wired to real backend data via Riverpod providers:
/// - [appointmentsProvider] (GET /appointments) for the doctor's appointment
///   list; filtered client-side to the selected day because the endpoint does
///   not yet accept a date query parameter.
/// - [doctorPatientsProvider] for resolving patient display names.
/// - [appointmentTransitionProvider] for accepting / declining pending requests
///   (PUT /appointments/{id}/status).
///
/// All resource states (loading, error, empty, loaded) are rendered distinctly.
class AppointmentsListScreen extends ConsumerStatefulWidget {
  const AppointmentsListScreen({super.key});

  @override
  ConsumerState<AppointmentsListScreen> createState() =>
      _AppointmentsListScreenState();
}

class _AppointmentsListScreenState
    extends ConsumerState<AppointmentsListScreen> {
  late DateTime _selectedDay;
  late DateTime _weekStart;
  String? _processingAppointmentId;

  @override
  void initState() {
    super.initState();
    _selectedDay = DateTime.now();
    _weekStart = _startOfWeek(_selectedDay);
  }

  DateTime _startOfWeek(DateTime date) {
    // Week starts on Monday to match the reference strip.
    final weekday = date.weekday; // 1 = Mon, 7 = Sun
    return DateTime(date.year, date.month, date.day)
        .subtract(Duration(days: weekday - 1));
  }

  DateTime _dateOnly(DateTime d) => DateTime(d.year, d.month, d.day);

  bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  DateTime? _parseTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso);
  }

  String _formatHour(DateTime dt) => DateFormat('hh:mm').format(dt);
  String _formatMeridiem(DateTime dt) => DateFormat('a').format(dt);
  String _formatDateLong(DateTime d) =>
      DateFormat('EEEE, d MMM yyyy').format(d);
  String _formatMonthYear(DateTime d) => DateFormat('MMMM yyyy').format(d);
  String _weekdayLabel(DateTime d) => DateFormat.E().format(d);

  String _modeLabel(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => 'Video Consultation',
        AppointmentMode.audio => 'Audio Call',
        AppointmentMode.chat => 'Chat Consultation',
        AppointmentMode.inPerson => 'On-site Consultation',
        AppointmentMode.unknown => 'Appointment',
      };

  Color _modeColor(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => AppColors.info,
        AppointmentMode.audio => AppColors.primary,
        AppointmentMode.chat => AppColors.accent,
        AppointmentMode.inPerson => AppColors.successDark,
        AppointmentMode.unknown => AppColors.gray500,
      };

  StatusBadgeTone _statusTone(AppointmentStatus status) => switch (status) {
        AppointmentStatus.pendingPayment => StatusBadgeTone.warning,
        AppointmentStatus.confirmed => StatusBadgeTone.info,
        AppointmentStatus.checkedIn => StatusBadgeTone.info,
        AppointmentStatus.inProgress => StatusBadgeTone.primary,
        AppointmentStatus.cancelled => StatusBadgeTone.error,
        AppointmentStatus.completed => StatusBadgeTone.success,
        AppointmentStatus.noShow => StatusBadgeTone.error,
        AppointmentStatus.rescheduled => StatusBadgeTone.info,
        AppointmentStatus.unknown => StatusBadgeTone.neutral,
      };

  String _statusLabel(AppointmentStatus status) => switch (status) {
        AppointmentStatus.pendingPayment => 'Pending',
        AppointmentStatus.confirmed => 'Upcoming',
        AppointmentStatus.checkedIn => 'Upcoming',
        AppointmentStatus.inProgress => 'In Progress',
        AppointmentStatus.cancelled => 'Cancelled',
        AppointmentStatus.completed => 'Completed',
        AppointmentStatus.noShow => 'No Show',
        AppointmentStatus.rescheduled => 'Rescheduled',
        AppointmentStatus.unknown => 'Unknown',
      };

  Color _dotColor(AppointmentStatus status) => switch (status) {
        AppointmentStatus.completed => AppColors.success,
        AppointmentStatus.cancelled => AppColors.error,
        AppointmentStatus.noShow => AppColors.error,
        AppointmentStatus.confirmed => AppColors.primary,
        AppointmentStatus.checkedIn => AppColors.primary,
        AppointmentStatus.inProgress => AppColors.primary,
        AppointmentStatus.rescheduled => AppColors.info,
        AppointmentStatus.pendingPayment => AppColors.warning,
        AppointmentStatus.unknown => AppColors.gray400,
      };

  Map<DateTime, int> _appointmentsByDay(List<Appointment> appts) {
    final map = <DateTime, int>{};
    for (final a in appts) {
      final dt = _parseTimestamp(a.startsAt);
      if (dt == null) continue;
      final day = _dateOnly(dt);
      map[day] = (map[day] ?? 0) + 1;
    }
    return map;
  }

  List<Appointment> _appointmentsForDay(List<Appointment> appts, DateTime day) {
    return appts.where((a) {
      final dt = _parseTimestamp(a.startsAt);
      return dt != null && _isSameDay(dt, day);
    }).toList()
      ..sort((a, b) {
        final at = _parseTimestamp(a.startsAt)!;
        final bt = _parseTimestamp(b.startsAt)!;
        return at.compareTo(bt);
      });
  }

  List<Appointment> _pendingForDay(List<Appointment> appts, DateTime day) =>
      _appointmentsForDay(appts, day)
          .where((a) => a.status == AppointmentStatus.pendingPayment)
          .toList();

  List<Appointment> _confirmedForDay(List<Appointment> appts, DateTime day) =>
      _appointmentsForDay(appts, day)
          .where((a) => a.status != AppointmentStatus.pendingPayment)
          .toList();

  int _countVideo(List<Appointment> appts) =>
      appts.where((a) => a.mode == AppointmentMode.video).length;

  int _countOnsite(List<Appointment> appts) =>
      appts.where((a) => a.mode == AppointmentMode.inPerson).length;

  Duration _totalDuration(List<Appointment> appts) {
    var total = Duration.zero;
    for (final a in appts) {
      final start = _parseTimestamp(a.startsAt);
      final end = _parseTimestamp(a.endsAt);
      if (start != null && end != null) {
        total += end.difference(start);
      }
    }
    return total;
  }

  String _formatDuration(Duration d) {
    final hours = d.inHours;
    final minutes = d.inMinutes.remainder(60);
    if (hours > 0 && minutes > 0) return '${hours}h ${minutes}m';
    if (hours > 0) return '${hours}h';
    return '${minutes}m';
  }

  Map<String, String> _patientNameMap(DoctorAssignedPatientPage? page) {
    if (page == null) return {};
    return {for (final p in page.data) p.profileId: p.displayName};
  }

  Future<void> _onRefresh() async {
    ref.invalidate(
        appointmentsProvider(const AppointmentFilter(pageSize: 100)));
    ref.invalidate(doctorPatientsProvider(null));
    await ref.read(
        appointmentsProvider(const AppointmentFilter(pageSize: 100)).future);
  }

  Future<void> _transitionPending(Appointment appt, String newStatus) async {
    setState(() => _processingAppointmentId = appt.id);
    try {
      final notifier = ref.read(appointmentTransitionProvider.notifier);
      final ok = await notifier.transition(
        appointmentId: appt.id,
        status: newStatus,
        expectedVersion: appt.version,
        cancellationReasonCode: newStatus == 'cancelled'
            ? AppointmentCancellationReasonCode.doctorUnavailable
            : null,
      );
      if (ok) {
        ref.invalidate(
            appointmentsProvider(const AppointmentFilter(pageSize: 100)));
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

  Future<void> _pickDate() async {
    final picked = await showDatePicker(
      context: context,
      initialDate: _selectedDay,
      firstDate: DateTime.now().subtract(const Duration(days: 365)),
      lastDate: DateTime.now().add(const Duration(days: 365)),
      builder: (context, child) => Theme(
        data: Theme.of(context).copyWith(
          colorScheme: Theme.of(context).colorScheme.copyWith(
                primary: AppColors.primary,
              ),
        ),
        child: child!,
      ),
    );
    if (picked != null) {
      setState(() {
        _selectedDay = picked;
        _weekStart = _startOfWeek(picked);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final topInset = MediaQuery.of(context).viewPadding.top;
    final apptsAsync =
        ref.watch(appointmentsProvider(const AppointmentFilter(pageSize: 100)));
    final patientsAsync = ref.watch(doctorPatientsProvider(null));

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: RefreshIndicator(
          color: AppColors.primary,
          onRefresh: _onRefresh,
          child: CustomScrollView(
            slivers: [
              SliverToBoxAdapter(
                child: Padding(
                  padding: EdgeInsets.fromLTRB(
                    DesignTokens.spaceMd,
                    topInset + DesignTokens.spaceSm,
                    DesignTokens.spaceMd,
                    DesignTokens.spaceMd,
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text(
                        'My Schedule',
                        style: TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w800,
                          color: AppColors.gray900,
                          letterSpacing: -0.3,
                        ),
                      ),
                      IconButton(
                        icon: const Icon(Icons.calendar_today_rounded,
                            color: AppColors.gray700),
                        onPressed: _pickDate,
                      ),
                    ],
                  ),
                ),
              ),
              SliverFillRemaining(
                child: _buildContent(apptsAsync, patientsAsync),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildContent(AsyncValue<AppointmentListResponse> apptsAsync,
      AsyncValue<DoctorAssignedPatientPage> patientsAsync) {
    return apptsAsync.when(
      loading: () => const _ScheduleSkeleton(),
      error: (err, _) => ErrorView(
        message: toApiError(err).displayMessage,
        onRetry: _onRefresh,
      ),
      data: (apptsResponse) {
        final appts = apptsResponse.data;
        final nameMap = _patientNameMap(patientsAsync.valueOrNull);
        return _buildLoadedBody(appts, nameMap);
      },
    );
  }

  Widget _buildLoadedBody(
      List<Appointment> appts, Map<String, String> nameMap) {
    final dayAppts = _appointmentsForDay(appts, _selectedDay);
    final pendingAppts = _pendingForDay(appts, _selectedDay);
    final confirmedAppts = _confirmedForDay(appts, _selectedDay);
    final dayCounts = _appointmentsByDay(appts);

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            _formatMonthYear(_selectedDay),
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.gray900,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildWeekStrip(dayCounts),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildStatsCard(dayAppts),
          const SizedBox(height: DesignTokens.spaceLg),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                _formatDateLong(_selectedDay),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                  color: AppColors.gray900,
                  letterSpacing: -0.3,
                ),
              ),
              Text(
                '${dayAppts.length} Appointment${dayAppts.length == 1 ? '' : 's'}',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.primary,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          if (dayAppts.isEmpty)
            EmptyView(
              title: 'No appointments',
              body:
                  'There are no appointments for ${_formatDateLong(_selectedDay)}.',
              illustrationAsset: 'assets/illustrations/empty_schedule.svg',
            )
          else ...[
            if (pendingAppts.isNotEmpty) ...[
              _buildPendingSection(pendingAppts, nameMap),
              const SizedBox(height: DesignTokens.spaceLg),
            ],
            if (confirmedAppts.isNotEmpty)
              _buildTimeline(confirmedAppts, nameMap)
            else if (pendingAppts.isNotEmpty)
              const SizedBox.shrink()
            else
              EmptyView(
                title: 'No appointments',
                body:
                    'There are no appointments for ${_formatDateLong(_selectedDay)}.',
                illustrationAsset: 'assets/illustrations/empty_schedule.svg',
              ),
          ],
          const SizedBox(height: 100), // Space for bottom nav
        ],
      ),
    );
  }

  Widget _buildWeekStrip(Map<DateTime, int> dayCounts) {
    return IntrinsicHeight(
      child: Row(
        children: List.generate(7, (index) {
          final day = _weekStart.add(Duration(days: index));
          final isSelected = _isSameDay(day, _selectedDay);
          final isToday = _isSameDay(day, DateTime.now());
          final count = dayCounts[_dateOnly(day)] ?? 0;

          return Expanded(
            child: GestureDetector(
              onTap: () {
                setState(() {
                  _selectedDay = day;
                  _weekStart = _startOfWeek(day);
                });
              },
              behavior: HitTestBehavior.opaque,
              child: Container(
                margin: const EdgeInsets.symmetric(horizontal: 2),
                padding:
                    const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
                decoration: BoxDecoration(
                  color: isSelected ? AppColors.primary : Colors.transparent,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
                ),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Text(
                      _weekdayLabel(day),
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: isSelected ? AppColors.white : AppColors.gray500,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '${day.day}',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: isSelected
                            ? AppColors.white
                            : isToday
                                ? AppColors.primary
                                : AppColors.gray900,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(
                        count.clamp(0, 3),
                        (i) => Container(
                          width: 4,
                          height: 4,
                          margin: const EdgeInsets.symmetric(horizontal: 1),
                          decoration: BoxDecoration(
                            color: isSelected
                                ? AppColors.white
                                : AppColors.primary,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        }),
      ),
    );
  }

  Widget _buildStatsCard(List<Appointment> dayAppts) {
    final total = dayAppts.length;
    final video = _countVideo(dayAppts);
    final onsite = _countOnsite(dayAppts);
    final duration = _totalDuration(dayAppts);

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        boxShadow: const [
          BoxShadow(
            color: AppColors.shadowLight,
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: IntrinsicHeight(
        child: Row(
          children: [
            _buildStatItem(
              icon: Icons.calendar_today_rounded,
              iconColor: AppColors.primary,
              iconBg: AppColors.primaryContainer,
              value: '$total',
              label: 'Appointments',
            ),
            const VerticalDivider(width: 1, color: AppColors.gray100),
            _buildStatItem(
              icon: Icons.videocam_rounded,
              iconColor: AppColors.info,
              iconBg: AppColors.infoContainer,
              value: '$video',
              label: 'Video',
            ),
            const VerticalDivider(width: 1, color: AppColors.gray100),
            _buildStatItem(
              icon: Icons.home_work_outlined,
              iconColor: AppColors.successDark,
              iconBg: AppColors.successContainer,
              value: '$onsite',
              label: 'On-site',
            ),
            const VerticalDivider(width: 1, color: AppColors.gray100),
            _buildStatItem(
              icon: Icons.schedule_rounded,
              iconColor: AppColors.warning,
              iconBg: AppColors.warningContainer,
              value: _formatDuration(duration),
              label: 'Duration',
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatItem({
    required IconData icon,
    required Color iconColor,
    required Color iconBg,
    required String value,
    required String label,
  }) {
    return Expanded(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: iconBg,
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            ),
            child: Icon(icon, size: 18, color: iconColor),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w800,
              color: AppColors.gray900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w600,
              color: AppColors.gray500,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildPendingSection(
      List<Appointment> pending, Map<String, String> nameMap) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Needs confirmation',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w800,
            color: AppColors.gray900,
          ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        ...pending.map((appt) => _buildPendingCard(appt, nameMap)),
      ],
    );
  }

  Widget _buildPendingCard(Appointment appt, Map<String, String> nameMap) {
    final name = nameMap[appt.patientProfileId] ?? 'Patient';
    final isProcessing = _processingAppointmentId == appt.id;
    final startsAt = _parseTimestamp(appt.startsAt);

    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.warning.withValues(alpha: 0.3)),
          boxShadow: const [
            BoxShadow(
              color: AppColors.shadowLight,
              blurRadius: 6,
              offset: Offset(0, 2),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                AvatarWidget(name: name, size: 44),
                const SizedBox(width: DesignTokens.spaceMd),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        name,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.gray900,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _modeLabel(appt.mode),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: _modeColor(appt.mode),
                        ),
                      ),
                      if (startsAt != null)
                        Text(
                          '${_formatDateLong(startsAt)} • ${_formatHour(startsAt)} ${_formatMeridiem(startsAt)}',
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w500,
                            color: AppColors.gray500,
                          ),
                        ),
                    ],
                  ),
                ),
                StatusBadge(
                  label: 'NEW',
                  tone: StatusBadgeTone.warning,
                ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: isProcessing
                        ? null
                        : () => _transitionPending(appt, 'cancelled'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.gray600,
                      side: const BorderSide(color: AppColors.gray300),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusFull),
                      ),
                      padding: const EdgeInsets.symmetric(
                          vertical: DesignTokens.spaceSm + 2),
                    ),
                    child: const Text(
                      'Decline',
                      style:
                          TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
                Expanded(
                  child: FilledButton.icon(
                    onPressed: isProcessing
                        ? null
                        : () => _transitionPending(appt, 'confirmed'),
                    icon: isProcessing
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                                strokeWidth: 2, color: AppColors.white),
                          )
                        : const Icon(Icons.check_rounded, size: 18),
                    label: const Text(
                      'Accept',
                      style:
                          TextStyle(fontSize: 14, fontWeight: FontWeight.bold),
                    ),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: AppColors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusFull),
                      ),
                      padding: const EdgeInsets.symmetric(
                          vertical: DesignTokens.spaceSm + 2),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildTimeline(List<Appointment> appts, Map<String, String> nameMap) {
    final now = DateTime.now();
    Appointment? nextAppt;
    for (final a in appts) {
      final start = _parseTimestamp(a.startsAt);
      if (start != null && start.isAfter(now)) {
        final status = a.status;
        if (status == AppointmentStatus.confirmed ||
            status == AppointmentStatus.checkedIn ||
            status == AppointmentStatus.inProgress) {
          nextAppt = a;
          break;
        }
      }
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Schedule',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w800,
            color: AppColors.gray900,
          ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        for (var i = 0; i < appts.length; i++)
          _buildTimelineItem(
            appts[i],
            nameMap,
            isHighlighted: appts[i].id == nextAppt?.id,
            isLast: i == appts.length - 1,
          ),
      ],
    );
  }

  Widget _buildTimelineItem(
    Appointment appt,
    Map<String, String> nameMap, {
    required bool isHighlighted,
    required bool isLast,
  }) {
    final patientName = nameMap[appt.patientProfileId] ?? 'Patient';
    final mode = appt.mode;
    final status = appt.status;
    final startsAt = _parseTimestamp(appt.startsAt);
    final timeLabel = startsAt != null ? _formatHour(startsAt) : '--:--';
    final meridiem = startsAt != null ? _formatMeridiem(startsAt) : '';

    final (locationIcon, locationLabel) = switch (mode) {
      AppointmentMode.video => (Icons.videocam_rounded, 'Video'),
      AppointmentMode.audio => (Icons.phone_in_talk_rounded, 'Audio'),
      AppointmentMode.chat => (Icons.chat_bubble_rounded, 'Chat'),
      AppointmentMode.inPerson => (Icons.home_work_outlined, 'On-site'),
      AppointmentMode.unknown => (Icons.event_rounded, 'Consultation'),
    };

    return IntrinsicHeight(
      child: Padding(
        padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm + 4),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SizedBox(
              width: 48,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    timeLabel,
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color:
                          isHighlighted ? AppColors.primary : AppColors.gray800,
                    ),
                  ),
                  Text(
                    meridiem,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: AppColors.gray500,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm + 2),
            Column(
              children: [
                const SizedBox(height: 4),
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: _dotColor(status),
                    shape: BoxShape.circle,
                    border: Border.all(color: AppColors.white, width: 2),
                    boxShadow: const [
                      BoxShadow(
                        color: AppColors.shadowLight,
                        blurRadius: 4,
                      ),
                    ],
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 2,
                      margin: const EdgeInsets.symmetric(vertical: 3),
                      color: AppColors.gray200,
                    ),
                  ),
              ],
            ),
            const SizedBox(width: DesignTokens.spaceSm + 4),
            Expanded(
              child: GestureDetector(
                onTap: () =>
                    context.push('/appointment-details', extra: appt.id),
                behavior: HitTestBehavior.opaque,
                child: Container(
                  padding: const EdgeInsets.all(DesignTokens.spaceSm + 4),
                  decoration: BoxDecoration(
                    color: isHighlighted
                        ? AppColors.primaryContainer.withValues(alpha: 0.35)
                        : AppColors.gray50,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                    border: isHighlighted
                        ? Border.all(
                            color:
                                AppColors.primaryLight.withValues(alpha: 0.6))
                        : null,
                  ),
                  child: Row(
                    children: [
                      AvatarWidget(name: patientName, size: 40),
                      const SizedBox(width: DesignTokens.spaceSm + 2),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              patientName,
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: AppColors.gray900,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _modeLabel(mode),
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w600,
                                color: _modeColor(mode),
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                Icon(locationIcon,
                                    size: 12, color: AppColors.gray500),
                                const SizedBox(width: 4),
                                Text(
                                  locationLabel,
                                  style: TextStyle(
                                    fontSize: 11,
                                    fontWeight: FontWeight.w500,
                                    color: AppColors.gray500,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      const SizedBox(width: DesignTokens.spaceXs),
                      StatusBadge(
                        label: _statusLabel(status),
                        tone: _statusTone(status),
                      ),
                      const Icon(Icons.chevron_right_rounded,
                          size: 18, color: AppColors.gray400),
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
}

class _ScheduleSkeleton extends StatelessWidget {
  const _ScheduleSkeleton();

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: AppColors.gray100,
      highlightColor: AppColors.gray50,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(height: 16, width: 100, color: AppColors.white),
            const SizedBox(height: DesignTokens.spaceSm),
            Container(height: 64, color: AppColors.white),
            const SizedBox(height: DesignTokens.spaceLg),
            Container(height: 80, color: AppColors.white),
            const SizedBox(height: DesignTokens.spaceLg),
            Container(height: 16, width: 180, color: AppColors.white),
            const SizedBox(height: DesignTokens.spaceMd),
            for (var i = 0; i < 3; i++) ...[
              Container(height: 80, color: AppColors.white),
              const SizedBox(height: DesignTokens.spaceSm),
            ],
          ],
        ),
      ),
    );
  }
}
