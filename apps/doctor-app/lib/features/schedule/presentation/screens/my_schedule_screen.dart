import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';
import 'package:table_calendar/table_calendar.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/models/doctor_patient_page.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/providers/schedule_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// My Schedule Screen — Calendar + Day Schedule.
///
/// Wired to real backend data via Riverpod providers:
/// - [activeMembershipIdProvider] for the doctor's membership id.
/// - [availabilityRulesProvider] (GET /memberships/{id}/availability-rules) for
///   the weekly rule set and its version token.
/// - [availabilitySlotsProvider] (GET /memberships/{id}/availability-slots) for
///   the generated slots over the visible month window. Every slot state —
///   `open`, `held`, `booked`, `closed` — is returned so the doctor sees the
///   schedule as it actually is.
/// - [appointmentsProvider] for resolving booked slots to patient names.
/// - [doctorPatientsProvider] for name resolution.
/// - [availabilityRulesMutationProvider] (PUT) for replacing the weekly rules.
/// - [availabilityExceptionProvider] (POST) for recording date exceptions.
/// - [slotGenerationProvider] (POST) for generating slots over a date range.
///
/// All four resource states (loading, error, empty, loaded) are rendered
/// distinctly.
class MyScheduleScreen extends ConsumerStatefulWidget {
  const MyScheduleScreen({super.key});

  @override
  ConsumerState<MyScheduleScreen> createState() => _MyScheduleScreenState();
}

class _MyScheduleScreenState extends ConsumerState<MyScheduleScreen> {
  DateTime _focusedDay = DateTime.now();
  DateTime _selectedDay = DateTime.now();
  CalendarFormat _calendarFormat = CalendarFormat.month;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  DateTime? _parseTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso);
  }

  bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  String _formatTime(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '--:--';
    return DateFormat.jm().format(dt);
  }

  String _formatDate(DateTime day) {
    return DateFormat('EEEE, MMM d').format(day);
  }

  String _formatCalendarDate(DateTime day) {
    return DateFormat('yyyy-MM-dd').format(day);
  }

  /// Build a profile-id → display-name map from the first page of assigned
  /// patients for resolving booked-slot patient names.
  Map<String, String> _patientNameMap(
      AsyncValue<DoctorAssignedPatientPage> patientsAsync) {
    final page = patientsAsync.valueOrNull;
    if (page == null) return {};
    return {for (final p in page.data) p.profileId: p.displayName};
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
        AppointmentMode.inPerson => 'In-Person',
        AppointmentMode.unknown => 'Visit',
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

  /// The slot-state vocabulary, as asserted against the backend's
  /// `availability_slot.state` column. `open` is bookable, `held` is a
  /// temporary lock, `booked` has an appointment, and `closed` was removed by
  /// an exception or rule change.
  static const _slotStateOpen = 'open';
  static const _slotStateHeld = 'held';
  static const _slotStateBooked = 'booked';
  static const _slotStateClosed = 'closed';

  /// Slots for the currently-selected day, sorted by start time.
  List<AvailabilitySlot> _slotsForDay(List<AvailabilitySlot> all) {
    return all
        .where((s) => _isSameDay(_parseTimestamp(s.startsAt)!, _selectedDay))
        .toList()
      ..sort((a, b) =>
          _parseTimestamp(a.startsAt)!.compareTo(_parseTimestamp(b.startsAt)!));
  }

  /// Appointments for the currently-selected day, keyed by slot id for
  /// matching booked slots to their appointment.
  Map<String, Appointment> _appointmentsBySlotForDay(List<Appointment> all) {
    final map = <String, Appointment>{};
    for (final a in all) {
      if (_isSameDay(_parseTimestamp(a.startsAt)!, _selectedDay)) {
        map[a.slotId] = a;
      }
    }
    return map;
  }

  /// Days that have at least one slot in the month, for calendar markers.
  Map<DateTime, List<AvailabilitySlot>> _slotEventMap(
      List<AvailabilitySlot> all) {
    final map = <DateTime, List<AvailabilitySlot>>{};
    for (final s in all) {
      final dt = _parseTimestamp(s.startsAt);
      if (dt == null) continue;
      final day = DateTime(dt.year, dt.month, dt.day);
      map.putIfAbsent(day, () => []).add(s);
    }
    return map;
  }

  Future<void> _onRefresh(String membershipId) async {
    ref.invalidate(availabilityRulesProvider(membershipId));
    final from = DateTime(_focusedDay.year, _focusedDay.month, 1);
    final to = DateTime(_focusedDay.year, _focusedDay.month + 1, 0, 23, 59);
    ref.invalidate(availabilitySlotsProvider((
      membershipId,
      AvailabilitySlotFilter(
          from: from.toUtc().toIso8601String(),
          to: to.toUtc().toIso8601String())
    )));
    ref.invalidate(appointmentsProvider);
    ref.invalidate(doctorPatientsProvider(null));
    await ref.read(availabilityRulesProvider(membershipId).future);
  }

  // ------------------------------------------------------------------
  // Build
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final membershipId = ref.watch(activeMembershipIdProvider);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Column(
          children: [
            _buildGradientHeader(membershipId),
            Expanded(
              child: membershipId == null
                  ? const ErrorView(
                      message:
                          'No active membership found. Please sign in again.',
                      isForbidden: true,
                    )
                  : _buildBody(membershipId),
            ),
          ],
        ),
        floatingActionButton: membershipId == null
            ? null
            : FloatingActionButton.extended(
                onPressed: () =>
                    _showGenerateSlotsDialog(context, membershipId),
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.white,
                icon: const Icon(Icons.date_range_rounded, size: 20),
                label: const Text(
                  'Set Weekly Availability',
                  style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                ),
              ),
        floatingActionButtonLocation: FloatingActionButtonLocation.centerFloat,
      ),
    );
  }

  Widget _buildGradientHeader(String? membershipId) {
    final canPop = Navigator.canPop(context);
    return Container(
      width: double.infinity,
      padding: EdgeInsets.only(
        top: MediaQuery.of(context).padding.top + DesignTokens.spaceMd,
        bottom: DesignTokens.space2xl + 8,
        left: canPop ? DesignTokens.spaceSm : DesignTokens.spaceLg,
        right: DesignTokens.spaceSm,
      ),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.primary, AppColors.primaryDark],
        ),
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(DesignTokens.radius3xl),
          bottomRight: Radius.circular(DesignTokens.radius3xl),
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Row(
                children: [
                  if (canPop)
                    IconButton(
                      icon: const Icon(Icons.arrow_back_rounded,
                          color: AppColors.white),
                      onPressed: () => context.pop(),
                    ),
                  const Text(
                    'My Schedule',
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      color: AppColors.white,
                      letterSpacing: -0.3,
                    ),
                  ),
                ],
              ),
              IconButton(
                icon: const Icon(Icons.add_rounded, color: AppColors.white),
                onPressed: membershipId == null
                    ? null
                    : () => _openActionsMenu(context, membershipId),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.15),
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            ),
            child: Text(
              'Availability & Slots',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Colors.white.withOpacity(0.9),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildBody(String membershipId) {
    final rulesAsync = ref.watch(availabilityRulesProvider(membershipId));

    // Slots for the visible month window.
    final monthStart = DateTime(_focusedDay.year, _focusedDay.month, 1);
    final monthEnd =
        DateTime(_focusedDay.year, _focusedDay.month + 1, 0, 23, 59);
    final slotsAsync = ref.watch(availabilitySlotsProvider((
      membershipId,
      AvailabilitySlotFilter(
          from: monthStart.toUtc().toIso8601String(),
          to: monthEnd.toUtc().toIso8601String())
    )));

    final apptsAsync =
        ref.watch(appointmentsProvider(const AppointmentFilter()));
    final patientsAsync = ref.watch(doctorPatientsProvider(null));
    final nameMap = _patientNameMap(patientsAsync);

    return Column(
      children: [
        // ---- Calendar ----
        rulesAsync.when(
          data: (rules) => _buildCalendar(slotsAsync),
          loading: () => _buildShimmerCalendar(),
          error: (err, _) {
            final apiError = err is ApiError ? err : toApiError(err);
            return ErrorView(
              message: apiError.displayMessage,
              onRetry: apiError.isForbidden
                  ? null
                  : () =>
                      ref.invalidate(availabilityRulesProvider(membershipId)),
              isForbidden: apiError.isForbidden,
            );
          },
        ),
        Container(height: 8, color: AppColors.background),
        // ---- Day schedule ----
        Expanded(
          child: slotsAsync.when(
            data: (slotResp) {
              final appts = apptsAsync.valueOrNull?.data ?? const [];
              return _buildDaySchedule(
                  slotResp.data, appts, nameMap, membershipId);
            },
            loading: () => const LoadingOverlay(label: 'Loading schedule...'),
            error: (err, _) {
              final apiError = err is ApiError ? err : toApiError(err);
              return ErrorView(
                message: apiError.displayMessage,
                onRetry: apiError.isForbidden
                    ? null
                    : () => ref.invalidate(availabilitySlotsProvider((
                          membershipId,
                          AvailabilitySlotFilter(
                              from: monthStart.toUtc().toIso8601String(),
                              to: monthEnd.toUtc().toIso8601String())
                        ))),
                isForbidden: apiError.isForbidden,
              );
            },
          ),
        ),
      ],
    );
  }

  // ------------------------------------------------------------------
  // Calendar
  // ------------------------------------------------------------------

  Widget _buildCalendar(AsyncValue<AvailabilitySlotListResponse> slotsAsync) {
    final allSlots = slotsAsync.valueOrNull?.data ?? const <AvailabilitySlot>[];
    final eventMap = _slotEventMap(allSlots);

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        boxShadow: [
          BoxShadow(
            color: AppColors.shadowLight,
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceSm, vertical: DesignTokens.spaceSm),
      child: TableCalendar<AvailabilitySlot>(
        firstDay: DateTime.utc(2024, 1, 1),
        lastDay: DateTime.utc(2030, 12, 31),
        focusedDay: _focusedDay,
        selectedDayPredicate: (day) => _isSameDay(day, _selectedDay),
        calendarFormat: _calendarFormat,
        startingDayOfWeek: StartingDayOfWeek.sunday,
        availableCalendarFormats: const {
          CalendarFormat.month: 'Month',
          CalendarFormat.twoWeeks: '2 Weeks',
        },
        eventLoader: (day) {
          final key = DateTime(day.year, day.month, day.day);
          return eventMap[key] ?? [];
        },
        onDaySelected: (selected, focused) {
          setState(() {
            _selectedDay = selected;
            _focusedDay = focused;
          });
        },
        onFormatChanged: (format) {
          setState(() => _calendarFormat = format);
        },
        onPageChanged: (focused) {
          _focusedDay = focused;
        },
        // ---- Styling ----
        headerStyle: HeaderStyle(
          formatButtonVisible: false,
          titleCentered: true,
          titleTextStyle: Theme.of(context).textTheme.titleMedium!.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.gray900,
              ),
          leftChevronIcon:
              const Icon(Icons.chevron_left_rounded, color: AppColors.gray400),
          rightChevronIcon:
              const Icon(Icons.chevron_right_rounded, color: AppColors.gray400),
        ),
        daysOfWeekStyle: DaysOfWeekStyle(
          weekdayStyle: Theme.of(context).textTheme.labelSmall!.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.gray500,
              ),
          weekendStyle: Theme.of(context).textTheme.labelSmall!.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.gray400,
              ),
        ),
        calendarStyle: CalendarStyle(
          selectedDecoration: const BoxDecoration(
            color: AppColors.primary,
            shape: BoxShape.circle,
          ),
          selectedTextStyle: const TextStyle(
            color: AppColors.white,
            fontWeight: FontWeight.bold,
          ),
          todayDecoration: BoxDecoration(
            color: AppColors.primaryContainer,
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.primary, width: 1.5),
          ),
          todayTextStyle: const TextStyle(
            color: AppColors.primaryDark,
            fontWeight: FontWeight.w600,
          ),
          defaultTextStyle: const TextStyle(color: AppColors.gray900),
          weekendTextStyle: const TextStyle(color: AppColors.gray600),
          outsideTextStyle: const TextStyle(color: AppColors.gray300),
          markerDecoration: const BoxDecoration(
            color: AppColors.secondary,
            shape: BoxShape.circle,
          ),
          markerSize: 6,
          markersMaxCount: 3,
          markerMargin: const EdgeInsets.only(top: 1),
        ),
        calendarBuilders: CalendarBuilders(
          singleMarkerBuilder: (context, day, slot) {
            final color = _slotMarkerColor(slot.state);
            return Positioned(
              bottom: 1,
              child: Container(
                width: 6,
                height: 6,
                decoration: BoxDecoration(
                  color: color,
                  shape: BoxShape.circle,
                ),
              ),
            );
          },
        ),
      ),
    );
  }

  Color _slotMarkerColor(String state) {
    switch (state) {
      case _slotStateBooked:
        return AppColors.accent;
      case _slotStateOpen:
        return AppColors.secondary;
      case _slotStateHeld:
        return AppColors.warning;
      case _slotStateClosed:
        return AppColors.gray400;
      default:
        return AppColors.gray300;
    }
  }

  Widget _buildShimmerCalendar() {
    return Shimmer.fromColors(
      baseColor: AppColors.shimmerBase,
      highlightColor: AppColors.shimmerHighlight,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          boxShadow: [
            BoxShadow(
              color: AppColors.shadowLight,
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        height: 340,
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Column(
          children: [
            Container(
              height: 20,
              width: 140,
              decoration: BoxDecoration(
                color: AppColors.white,
                borderRadius: BorderRadius.circular(10),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            Expanded(
              child: GridView.count(
                crossAxisCount: 7,
                physics: const NeverScrollableScrollPhysics(),
                children: List.generate(35, (_) {
                  return Padding(
                    padding: const EdgeInsets.all(4),
                    child: Container(
                      decoration: BoxDecoration(
                        color: AppColors.white,
                        shape: BoxShape.circle,
                      ),
                    ),
                  );
                }),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Day schedule
  // ------------------------------------------------------------------

  Widget _buildDaySchedule(
    List<AvailabilitySlot> allSlots,
    List<Appointment> appts,
    Map<String, String> nameMap,
    String membershipId,
  ) {
    final daySlots = _slotsForDay(allSlots);
    final apptBySlot = _appointmentsBySlotForDay(appts);

    if (daySlots.isEmpty) {
      return RefreshIndicator(
        color: AppColors.primary,
        onRefresh: () => _onRefresh(membershipId),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(
              height: MediaQuery.of(context).size.height * 0.4,
              child: EmptyView(
                title: 'No appointments scheduled',
                body:
                    'There are no slots for ${_formatDate(_selectedDay)}. Generate slots or set your weekly availability.',
                icon: Icons.event_available_rounded,
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: () => _onRefresh(membershipId),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceSm),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  _formatDate(_selectedDay),
                  style: const TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w800,
                    color: AppColors.gray900,
                    letterSpacing: -0.3,
                  ),
                ),
                // Legend
                Row(
                  children: [
                    _buildLegendDot(AppColors.secondary, 'Open'),
                    const SizedBox(width: DesignTokens.spaceSm),
                    _buildLegendDot(AppColors.accent, 'Booked'),
                    const SizedBox(width: DesignTokens.spaceSm),
                    _buildLegendDot(AppColors.gray400, 'Closed'),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.only(
                  left: DesignTokens.spaceMd,
                  right: DesignTokens.spaceMd,
                  bottom: 120),
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: daySlots.length,
              itemBuilder: (context, index) {
                final slot = daySlots[index];
                final appt = apptBySlot[slot.id];
                return _buildSlotCard(slot, appt, nameMap);
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLegendDot(Color color, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
          ),
        ),
        const SizedBox(width: 4),
        Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: AppColors.gray500,
              ),
        ),
      ],
    );
  }

  Widget _buildSlotCard(
      AvailabilitySlot slot, Appointment? appt, Map<String, String> nameMap) {
    final timeText =
        '${_formatTime(slot.startsAt)} - ${_formatTime(slot.endsAt)}';

    switch (slot.state) {
      case _slotStateBooked:
        if (appt != null) {
          final name = nameMap[appt.patientProfileId] ?? 'Patient';
          return Padding(
            padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
            child: PremiumCard(
              accent: AppColors.primary,
              onTap: () => context.push('/appointment-details', extra: appt.id),
              child: Row(
                children: [
                  AvatarWidget(name: name, size: DesignTokens.avatarMd),
                  const SizedBox(width: DesignTokens.spaceMd),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          timeText,
                          style:
                              Theme.of(context).textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.w600,
                                    color: AppColors.gray900,
                                  ),
                        ),
                        const SizedBox(height: 2),
                        Row(
                          children: [
                            Icon(_modeIcon(appt.mode),
                                size: 14, color: AppColors.primary),
                            const SizedBox(width: 4),
                            Text(
                              '$name • ${_modeLabel(appt.mode)}',
                              style: Theme.of(context)
                                  .textTheme
                                  .labelMedium
                                  ?.copyWith(
                                    color: AppColors.gray600,
                                    fontWeight: FontWeight.w500,
                                  ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                  StatusBadge(
                    label: _statusLabel(appt.status),
                    tone: _statusTone(appt.status),
                  ),
                ],
              ),
            ),
          );
        }
        // Booked but appointment not in the first page — fall through to open.
        return _buildOpenSlotCard(slot, timeText);
      case _slotStateOpen:
        return _buildOpenSlotCard(slot, timeText);
      case _slotStateHeld:
        return Padding(
          padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
          child: PremiumCard(
            accent: AppColors.warning,
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: AppColors.warningContainer,
                    borderRadius:
                        BorderRadius.circular(DesignTokens.radiusFull),
                  ),
                  child: const Icon(Icons.hourglass_top_rounded,
                      color: AppColors.warning, size: DesignTokens.iconSm),
                ),
                const SizedBox(width: DesignTokens.spaceMd),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        timeText,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w600,
                              color: AppColors.gray900,
                            ),
                      ),
                      Text(
                        'Held',
                        style:
                            Theme.of(context).textTheme.labelMedium?.copyWith(
                                  color: AppColors.warningDark,
                                  fontWeight: FontWeight.w500,
                                ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      case _slotStateClosed:
        return Padding(
          padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
          child: PremiumCard(
            accent: AppColors.gray400,
            child: Opacity(
              opacity: 0.75,
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: AppColors.gray100,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusFull),
                    ),
                    child: const Icon(Icons.block_rounded,
                        color: AppColors.gray400, size: DesignTokens.iconSm),
                  ),
                  const SizedBox(width: DesignTokens.spaceMd),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          timeText,
                          style:
                              Theme.of(context).textTheme.titleSmall?.copyWith(
                                    fontWeight: FontWeight.w500,
                                    color: AppColors.gray500,
                                  ),
                        ),
                        Text(
                          'Blocked / Closed',
                          style:
                              Theme.of(context).textTheme.labelMedium?.copyWith(
                                    color: AppColors.gray400,
                                  ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ),
        );
      default:
        return _buildOpenSlotCard(slot, timeText);
    }
  }

  Widget _buildOpenSlotCard(AvailabilitySlot slot, String timeText) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      child: PremiumCard(
        accent: AppColors.secondary,
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.successContainer,
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
              ),
              child: const Icon(Icons.check_circle_outline_rounded,
                  color: AppColors.secondary, size: DesignTokens.iconSm),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    timeText,
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w600,
                          color: AppColors.gray900,
                        ),
                  ),
                  Text(
                    'Available',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: AppColors.secondaryDark,
                          fontWeight: FontWeight.w500,
                        ),
                  ),
                ],
              ),
            ),
            StatusBadge(
              label: 'Open',
              tone: StatusBadgeTone.success,
            ),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Actions menu + dialogs
  // ------------------------------------------------------------------

  void _openActionsMenu(BuildContext context, String? membershipId) {
    if (membershipId == null) return;
    showModalBottomSheet(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius:
            BorderRadius.vertical(top: Radius.circular(DesignTokens.radiusXl)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: DesignTokens.spaceSm),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.gray200,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            ListTile(
              leading: const Icon(Icons.edit_calendar_rounded,
                  color: AppColors.primary),
              title: const Text('Set Weekly Availability'),
              subtitle: const Text('Replace your recurring weekly schedule'),
              onTap: () {
                Navigator.pop(ctx);
                _showWeeklyAvailabilityDialog(context, membershipId);
              },
            ),
            ListTile(
              leading: const Icon(Icons.event_busy_rounded,
                  color: AppColors.warning),
              title: const Text('Add Exception'),
              subtitle: const Text('Block a specific date (leave, closure)'),
              onTap: () {
                Navigator.pop(ctx);
                _showExceptionDialog(context, membershipId);
              },
            ),
            ListTile(
              leading: const Icon(Icons.auto_mode_rounded,
                  color: AppColors.secondary),
              title: const Text('Generate Slots'),
              subtitle: const Text('Materialise slots for a date range'),
              onTap: () {
                Navigator.pop(ctx);
                _showGenerateSlotsDialog(context, membershipId);
              },
            ),
            const SizedBox(height: DesignTokens.spaceMd),
          ],
        ),
      ),
    );
  }

  void _showGenerateSlotsDialog(BuildContext context, String membershipId) {
    final fromCtrl =
        TextEditingController(text: _formatCalendarDate(_focusedDay));
    final toCtrl = TextEditingController(
        text: _formatCalendarDate(_focusedDay.add(const Duration(days: 30))));

    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Generate Slots'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Text(
                'Materialise availability slots from your weekly rules over a date range.'),
            const SizedBox(height: DesignTokens.spaceMd),
            TextField(
              controller: fromCtrl,
              decoration: const InputDecoration(
                labelText: 'From (YYYY-MM-DD)',
                prefixIcon: Icon(Icons.calendar_today_rounded, size: 18),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            TextField(
              controller: toCtrl,
              decoration: const InputDecoration(
                labelText: 'To (YYYY-MM-DD)',
                prefixIcon: Icon(Icons.calendar_today_rounded, size: 18),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () async {
              Navigator.pop(ctx);
              await _generateSlots(membershipId, fromCtrl.text, toCtrl.text);
            },
            child: const Text('Generate'),
          ),
        ],
      ),
    );
  }

  Future<void> _generateSlots(
      String membershipId, String from, String to) async {
    final notifier = ref.read(slotGenerationProvider.notifier);
    final ok = await notifier.generate(
      membershipId: membershipId,
      fromDate: from,
      toDate: to,
    );
    if (ok) {
      final result = ref.read(slotGenerationProvider).result;
      // Invalidate slots so the calendar refreshes.
      final monthStart = DateTime(_focusedDay.year, _focusedDay.month, 1);
      final monthEnd =
          DateTime(_focusedDay.year, _focusedDay.month + 1, 0, 23, 59);
      ref.invalidate(availabilitySlotsProvider((
        membershipId,
        AvailabilitySlotFilter(
            from: monthStart.toUtc().toIso8601String(),
            to: monthEnd.toUtc().toIso8601String())
      )));
      ref.invalidate(availabilityRulesProvider(membershipId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result != null
                ? 'Generated ${result.generatedSlotCount} slots.'
                : 'Slots generated.'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } else {
      final err = ref.read(slotGenerationProvider).error;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(err is ApiError
                ? err.displayMessage
                : 'Could not generate slots. Please try again.'),
          ),
        );
      }
    }
  }

  void _showExceptionDialog(BuildContext context, String membershipId) {
    final dateCtrl =
        TextEditingController(text: _formatCalendarDate(_selectedDay));
    final reasonCodes = AvailabilityExceptionReasonCode.values
        .where((r) => r != AvailabilityExceptionReasonCode.unknown)
        .toList();
    var selectedReason = AvailabilityExceptionReasonCode.administrativeBlock;
    var isUnavailable = true;

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Add Availability Exception'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: dateCtrl,
                decoration: const InputDecoration(
                  labelText: 'Date (YYYY-MM-DD)',
                  prefixIcon: Icon(Icons.calendar_today_rounded, size: 18),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              DropdownButtonFormField<AvailabilityExceptionReasonCode>(
                initialValue: selectedReason,
                decoration: const InputDecoration(labelText: 'Reason'),
                items: reasonCodes
                    .map((r) => DropdownMenuItem(
                          value: r,
                          child: Text(_exceptionReasonLabel(r)),
                        ))
                    .toList(),
                onChanged: (v) {
                  if (v != null) {
                    setDialogState(() => selectedReason = v);
                  }
                },
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              SwitchListTile(
                title: const Text('Unavailable (block all slots)'),
                value: isUnavailable,
                onChanged: (v) => setDialogState(() => isUnavailable = v),
                activeThumbColor: AppColors.primary,
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                Navigator.pop(ctx);
                await _recordException(
                  membershipId,
                  dateCtrl.text,
                  isUnavailable,
                  selectedReason,
                );
              },
              child: const Text('Add Exception'),
            ),
          ],
        ),
      ),
    );
  }

  String _exceptionReasonLabel(AvailabilityExceptionReasonCode r) {
    switch (r) {
      case AvailabilityExceptionReasonCode.annualLeave:
        return 'Annual Leave';
      case AvailabilityExceptionReasonCode.sickLeave:
        return 'Sick Leave';
      case AvailabilityExceptionReasonCode.publicHoliday:
        return 'Public Holiday';
      case AvailabilityExceptionReasonCode.training:
        return 'Training';
      case AvailabilityExceptionReasonCode.administrativeBlock:
        return 'Administrative Block';
      case AvailabilityExceptionReasonCode.clinicClosure:
        return 'Clinic Closure';
      case AvailabilityExceptionReasonCode.scheduleCorrection:
        return 'Schedule Correction';
      case AvailabilityExceptionReasonCode.emergencyCover:
        return 'Emergency Cover';
      default:
        return 'Other';
    }
  }

  Future<void> _recordException(
    String membershipId,
    String date,
    bool isUnavailable,
    AvailabilityExceptionReasonCode reason,
  ) async {
    // Need the current rules version for optimistic concurrency.
    final rules = ref.read(availabilityRulesProvider(membershipId)).valueOrNull;
    final version = rules?.version ?? 0;

    final notifier = ref.read(availabilityExceptionProvider.notifier);
    final ok = await notifier.record(
      membershipId: membershipId,
      req: RecordAvailabilityExceptionRequest(
        exceptionDate: date,
        isUnavailable: isUnavailable,
        reasonCode: reason,
        expectedVersion: version,
      ),
    );
    if (ok) {
      final result = ref.read(availabilityExceptionProvider).result;
      // Invalidate slots so the calendar refreshes.
      final monthStart = DateTime(_focusedDay.year, _focusedDay.month, 1);
      final monthEnd =
          DateTime(_focusedDay.year, _focusedDay.month + 1, 0, 23, 59);
      ref.invalidate(availabilitySlotsProvider((
        membershipId,
        AvailabilitySlotFilter(
            from: monthStart.toUtc().toIso8601String(),
            to: monthEnd.toUtc().toIso8601String())
      )));
      ref.invalidate(availabilityRulesProvider(membershipId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result != null
                ? 'Exception recorded. ${result.closedSlotCount} slots closed.'
                : 'Exception recorded.'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } else {
      final err = ref.read(availabilityExceptionProvider).error;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(err is ApiError
                ? err.displayMessage
                : 'Could not record exception. Please try again.'),
          ),
        );
      }
    }
  }

  void _showWeeklyAvailabilityDialog(
      BuildContext context, String membershipId) {
    // Show a simplified editor: a list of weekday toggles with start/end times.
    // The full rule set is replaced on save.
    final rules = ref.read(availabilityRulesProvider(membershipId)).valueOrNull;
    final version = rules?.version ?? 0;

    // Build a map of existing rules by weekday (1=Mon..7=Sun in ISO).
    final existingByDay = <int, AvailabilityRule>{};
    for (final r in rules?.data ?? const <AvailabilityRule>[]) {
      existingByDay[r.weekday] = r;
    }

    // Track editable rules in dialog state.
    final dialogRules = <int, ({String start, String end, bool enabled})>{};
    const weekdays = [
      (1, 'Monday'),
      (2, 'Tuesday'),
      (3, 'Wednesday'),
      (4, 'Thursday'),
      (5, 'Friday'),
      (6, 'Saturday'),
      (7, 'Sunday'),
    ];
    for (final (idx, _) in weekdays) {
      final existing = existingByDay[idx];
      dialogRules[idx] = (
        start: existing?.startTime ?? '09:00',
        end: existing?.endTime ?? '17:00',
        enabled: existing != null,
      );
    }

    showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Weekly Availability'),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView(
              shrinkWrap: true,
              children: weekdays.map((entry) {
                final (idx, label) = entry;
                final rule = dialogRules[idx]!;
                return CheckboxListTile(
                  value: rule.enabled,
                  title: Text(label),
                  subtitle: rule.enabled
                      ? Text('${rule.start} - ${rule.end}')
                      : const Text('Not available'),
                  onChanged: (v) {
                    setDialogState(() {
                      dialogRules[idx] = (
                        start: rule.start,
                        end: rule.end,
                        enabled: v ?? false,
                      );
                    });
                  },
                );
              }).toList(),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () async {
                Navigator.pop(ctx);
                await _replaceRules(membershipId, dialogRules, version);
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _replaceRules(
    String membershipId,
    Map<int, ({String start, String end, bool enabled})> dialogRules,
    int expectedVersion,
  ) async {
    final timezone =
        ref.read(currentProfileProvider)?.timezone ?? 'Asia/Kuala_Lumpur';
    final today = _formatCalendarDate(DateTime.now());

    final rules = <AvailabilityRuleInput>[];
    dialogRules.forEach((weekday, rule) {
      if (!rule.enabled) return;
      rules.add(AvailabilityRuleInput(
        weekday: weekday,
        startTime: rule.start,
        endTime: rule.end,
        slotDurationMinutes: 30,
        timezone: timezone,
        effectiveFrom: today,
      ));
    });

    final notifier = ref.read(availabilityRulesMutationProvider.notifier);
    final ok = await notifier.replace(
      membershipId: membershipId,
      rules: rules,
      expectedVersion: expectedVersion,
    );
    if (ok) {
      ref.invalidate(availabilityRulesProvider(membershipId));
      final monthStart = DateTime(_focusedDay.year, _focusedDay.month, 1);
      final monthEnd =
          DateTime(_focusedDay.year, _focusedDay.month + 1, 0, 23, 59);
      ref.invalidate(availabilitySlotsProvider((
        membershipId,
        AvailabilitySlotFilter(
            from: monthStart.toUtc().toIso8601String(),
            to: monthEnd.toUtc().toIso8601String())
      )));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(rules.isEmpty
                ? 'Availability cleared.'
                : 'Weekly availability updated. ${rules.length} active days.'),
            duration: const Duration(seconds: 2),
          ),
        );
      }
    } else {
      final err = ref.read(availabilityRulesMutationProvider).error;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(err is ApiError
                ? err.displayMessage
                : 'Could not update availability. Please try again.'),
          ),
        );
      }
    }
  }
}
