import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/app_state_provider.dart';
import '../../../../core/providers/doctor_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/loading_overlay.dart';
import '../../../../core/widgets/state_view.dart';

/// Book Appointment Screen — wired to the real backend.
///
/// Reads the selected doctor from [selectedDoctorProvider] (set by the profile
/// screen), fetches availability slots with [appointmentSlotsProvider]
/// (GET /organizations/{org}/appointment-slots) and books through
/// [bookingMutationProvider] (POST /appointments).
///
/// The UI is a single scrollable page with a visual stepper: 1) Select Date →
/// 2) Select Time → 3) Consultation Type → 4) Notes. All four resource states
/// are handled for the slots section (loading / error / empty / loaded).
class BookAppointmentScreen extends ConsumerStatefulWidget {
  const BookAppointmentScreen({super.key});

  @override
  ConsumerState<BookAppointmentScreen> createState() =>
      _BookAppointmentScreenState();
}

class _BookAppointmentScreenState extends ConsumerState<BookAppointmentScreen> {
  /// The first selectable day — today (same-day booking if a slot is open).
  final DateTime _firstSelectable =
      DateTime(DateTime.now().year, DateTime.now().month, DateTime.now().day);

  late DateTime _selectedDate;
  String? _selectedSlotId;
  AppointmentMode _consultationMode = AppointmentMode.video;
  final TextEditingController _notesController = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Default to tomorrow so the user sees a full day of slots.
    _selectedDate = _firstSelectable.add(const Duration(days: 1));
  }

  @override
  void dispose() {
    _notesController.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Slot filtering — the provider returns all slots for the 14-day window;
  // we narrow to this doctor + this calendar day + open state.
  // ---------------------------------------------------------------------------
  List<AvailabilitySlot> _filterSlotsForDay(
      List<AvailabilitySlot> all, DoctorDirectoryItem doctor) {
    final dayStart = DateTime(
      _selectedDate.year,
      _selectedDate.month,
      _selectedDate.day,
    );
    final dayEnd = dayStart.add(const Duration(days: 1));

    return all.where((s) {
      if (s.membershipId != doctor.membershipId) return false;
      if (s.state != 'open') return false;
      final start = DateTime.tryParse(s.startsAt);
      if (start == null) return false;
      return !start.isBefore(dayStart) && start.isBefore(dayEnd);
    }).toList()
      // Order by start time — see AGENTS.md "Lists".
      ..sort((a, b) => a.startsAt.compareTo(b.startsAt));
  }

  Map<_SlotPeriod, List<AvailabilitySlot>> _groupByPeriod(
      List<AvailabilitySlot> slots) {
    final morning = <AvailabilitySlot>[];
    final afternoon = <AvailabilitySlot>[];
    final evening = <AvailabilitySlot>[];
    for (final s in slots) {
      final dt = DateTime.tryParse(s.startsAt);
      if (dt == null) continue;
      final hour = dt.toLocal().hour;
      if (hour < 12) {
        morning.add(s);
      } else if (hour < 17) {
        afternoon.add(s);
      } else {
        evening.add(s);
      }
    }
    return {
      _SlotPeriod.morning: morning,
      _SlotPeriod.afternoon: afternoon,
      _SlotPeriod.evening: evening,
    };
  }

  // ---------------------------------------------------------------------------
  // Booking action
  // ---------------------------------------------------------------------------
  Future<void> _bookAppointment(DoctorDirectoryItem doctor) async {
    final slotId = _selectedSlotId;
    if (slotId == null) return;

    // Persist the wizard selections for downstream screens.
    ref.read(bookingStateProvider.notifier)
      ..setDoctor(doctor)
      ..setDate(_selectedDate)
      ..setSlot(slotId)
      ..setConsultationMode(_consultationMode)
      ..setNotes(_notesController.text.trim());

    final appointment = await ref.read(bookingMutationProvider.notifier).book(
          slotId: slotId,
          mode: _consultationMode,
          organizationId: doctor.organizationId,
        );

    if (!mounted) return;

    if (appointment != null) {
      ref.read(selectedAppointmentProvider.notifier).state = appointment;
      if (doctor.consultationFeeSen > 0) {
        context.go('/payment');
      } else {
        context.go('/appointment-details',
            extra: {'appointmentId': appointment.id});
      }
    } else {
      final err = ref.read(bookingMutationProvider);
      final message = err.whenOrNull(
            error: (e, _) {
              try {
                final m = (e as dynamic).userMessage;
                if (m is String && m.isNotEmpty) return m;
              } catch (_) {}
              return 'Booking failed. Please try again.';
            },
          ) ??
          'Booking failed. Please try again.';
      _showError(message);
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          message,
          style: const TextStyle(fontFamily: 'Manrope'),
        ),
        backgroundColor: AppColors.error,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------
  @override
  Widget build(BuildContext context) {
    final doctor = ref.watch(selectedDoctorProvider);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.white,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: doctor == null
            ? SafeArea(
                child: Column(
                  children: [
                    _buildHeader(),
                    const Expanded(
                      child: EmptyView(
                        title: 'No doctor selected',
                        body:
                            'Go back and select a doctor to book an appointment.',
                        icon: Icons.person_search_outlined,
                      ),
                    ),
                  ],
                ),
              )
            : _buildBody(doctor),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Body — scrollable content + fixed booking bar + loading overlay.
  // ---------------------------------------------------------------------------
  Widget _buildBody(DoctorDirectoryItem doctor) {
    final bookingState = ref.watch(bookingMutationProvider);
    final isBooking = bookingState.isLoading;

    final params = AppointmentSlotsParams(
      organizationId: doctor.organizationId,
      membershipId: doctor.membershipId,
      from: _firstSelectable,
      to: _firstSelectable.add(const Duration(days: 14)),
    );
    final slotsAsync = ref.watch(appointmentSlotsProvider(params));

    return Stack(
      children: [
        SingleChildScrollView(
          physics: const BouncingScrollPhysics(),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildHeader(),
              _buildDoctorCard(doctor),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildStepper(),
              const SizedBox(height: DesignTokens.spaceLg),
              Padding(
                padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceMd),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _buildDateSelector(),
                    const SizedBox(height: DesignTokens.spaceLg),
                    _buildTimeSlots(slotsAsync, doctor),
                    const SizedBox(height: DesignTokens.spaceLg),
                    _buildConsultationType(),
                    const SizedBox(height: DesignTokens.spaceLg),
                    _buildNotesField(),
                    // Space for the fixed bottom booking bar.
                    SizedBox(
                      height: MediaQuery.of(context).padding.bottom + 100,
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        _buildBookingBar(doctor, isBooking),
        if (isBooking)
          const LoadingOverlay(message: 'Booking your appointment…'),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Custom header — SafeArea with back button and title.
  // ---------------------------------------------------------------------------
  Widget _buildHeader() {
    final topPad = MediaQuery.of(context).padding.top;

    return Container(
      padding: EdgeInsets.only(
        top: topPad,
        left: DesignTokens.spaceSm,
        right: DesignTokens.spaceSm,
        bottom: DesignTokens.spaceSm,
      ),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          bottom: BorderSide(color: AppColors.gray200, width: 1),
        ),
      ),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back_rounded,
                color: AppColors.textPrimary, size: 22),
            onPressed: () => context.pop(),
          ),
          const SizedBox(width: DesignTokens.spaceXs),
          const Text(
            'Book Appointment',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              fontFamily: 'Manrope',
              color: AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Doctor card — compact summary of the selected doctor.
  // ---------------------------------------------------------------------------
  Widget _buildDoctorCard(DoctorDirectoryItem doctor) {
    final specialty =
        doctor.primarySpecialty != null && doctor.primarySpecialty!.isNotEmpty
            ? _formatSpecialty(doctor.primarySpecialty!)
            : (doctor.specialties.isNotEmpty
                ? doctor.specialties.map(_formatSpecialty).join(', ')
                : 'Doctor');

    return Container(
      margin: const EdgeInsets.all(DesignTokens.spaceMd),
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.shadow,
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          AvatarWidget(
            imageUrl: doctor.imageUrl,
            name: doctor.displayName,
            size: DesignTokens.avatarLg,
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  doctor.displayName,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    fontFamily: 'Manrope',
                    color: AppColors.textPrimary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  specialty,
                  style: const TextStyle(
                    fontSize: 13,
                    fontFamily: 'Manrope',
                    color: AppColors.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                Row(
                  children: [
                    Icon(Icons.star_rounded,
                        size: 16, color: AppColors.warning),
                    const SizedBox(width: 4),
                    Text(
                      doctor.ratingAverage.toStringAsFixed(1),
                      style: const TextStyle(
                        fontSize: 13,
                        fontWeight: FontWeight.w700,
                        fontFamily: 'Manrope',
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '(${doctor.reviewCount})',
                      style: const TextStyle(
                        fontSize: 12,
                        fontFamily: 'Manrope',
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const Spacer(),
                    Text(
                      MoneyFormatter.format(
                          doctor.consultationFeeSen, doctor.currency),
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        fontFamily: 'Manrope',
                        color: AppColors.primary,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Stepper — 4-step visual indicator.
  // ---------------------------------------------------------------------------
  Widget _buildStepper() {
    // Determine step states based on selections.
    final step1Done = true; // Date always has a default.
    final step2Done = _selectedSlotId != null;
    final step3Done = _selectedSlotId != null; // Type has a default.
    final step4Active = _selectedSlotId != null;

    final steps = [
      _StepInfo(number: 1, label: 'Date', done: step1Done, active: !step2Done),
      _StepInfo(number: 2, label: 'Time', done: step2Done, active: !step2Done),
      _StepInfo(number: 3, label: 'Type', done: step3Done, active: step4Active),
      _StepInfo(number: 4, label: 'Notes', done: false, active: step4Active),
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd, vertical: DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.gray200),
        ),
        child: Row(
          children: [
            for (int i = 0; i < steps.length; i++) ...[
              _buildStepDot(steps[i]),
              if (i < steps.length - 1)
                Expanded(
                  child: Container(
                    height: 2,
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    color:
                        steps[i].done ? AppColors.primary : AppColors.gray200,
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildStepDot(_StepInfo step) {
    final isActive = step.active && !step.done;
    final color = step.done
        ? AppColors.primary
        : isActive
            ? AppColors.primary
            : AppColors.gray300;
    final bgColor = step.done
        ? AppColors.primary
        : isActive
            ? AppColors.primaryContainer
            : AppColors.gray100;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            color: bgColor,
            shape: BoxShape.circle,
            border: Border.all(color: color, width: 2),
          ),
          alignment: Alignment.center,
          child: step.done
              ? const Icon(Icons.check, size: 16, color: AppColors.white)
              : Text(
                  '${step.number}',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    fontFamily: 'Manrope',
                    color: color,
                  ),
                ),
        ),
        const SizedBox(height: 4),
        Text(
          step.label,
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            fontFamily: 'Manrope',
            color: step.done || isActive
                ? AppColors.textPrimary
                : AppColors.textSecondary,
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Date selector — horizontal scrollable list of the next 14 days.
  // ---------------------------------------------------------------------------
  Widget _buildDateSelector() {
    final dates =
        List.generate(14, (i) => _firstSelectable.add(Duration(days: i)));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle('Select Date'),
        const SizedBox(height: DesignTokens.spaceSm),
        SizedBox(
          height: 76,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            padding: EdgeInsets.zero,
            itemCount: dates.length,
            separatorBuilder: (_, __) =>
                const SizedBox(width: DesignTokens.spaceSm),
            itemBuilder: (context, index) {
              final date = dates[index];
              final isSelected = _isSameDay(date, _selectedDate);
              final isToday = _isSameDay(date, _firstSelectable);

              return GestureDetector(
                onTap: () {
                  setState(() {
                    _selectedDate = date;
                    _selectedSlotId = null;
                  });
                },
                child: Container(
                  width: 60,
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  decoration: BoxDecoration(
                    color: isSelected ? AppColors.primary : AppColors.surface,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                    border: Border.all(
                      color: isSelected ? AppColors.primary : AppColors.gray200,
                      width: isSelected ? 2 : 1,
                    ),
                    boxShadow: isSelected
                        ? [
                            BoxShadow(
                              color: AppColors.primary.withValues(alpha: 0.2),
                              blurRadius: 8,
                              offset: const Offset(0, 2),
                            ),
                          ]
                        : null,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        DateFormat('EEE').format(date),
                        style: TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w600,
                          fontFamily: 'Manrope',
                          color: isSelected
                              ? AppColors.white
                              : AppColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        DateFormat('d').format(date),
                        style: TextStyle(
                          fontSize: 18,
                          fontWeight: FontWeight.w700,
                          fontFamily: 'Manrope',
                          color: isSelected
                              ? AppColors.white
                              : AppColors.textPrimary,
                        ),
                      ),
                      if (isToday)
                        Text(
                          'Today',
                          style: TextStyle(
                            fontSize: 9,
                            fontWeight: FontWeight.w600,
                            fontFamily: 'Manrope',
                            color: isSelected
                                ? AppColors.white.withValues(alpha: 0.8)
                                : AppColors.primary,
                          ),
                        ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }

  bool _isSameDay(DateTime a, DateTime b) =>
      a.year == b.year && a.month == b.month && a.day == b.day;

  // ---------------------------------------------------------------------------
  // Time slots — loading / error / empty / loaded, never collapsed.
  // ---------------------------------------------------------------------------
  Widget _buildTimeSlots(AsyncValue<List<AvailabilitySlot>> slotsAsync,
      DoctorDirectoryItem doctor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle('Select Time'),
        const SizedBox(height: DesignTokens.spaceSm),
        slotsAsync.when(
          loading: () => _buildSlotsSkeleton(),
          error: (error, _) {
            String message = 'Could not load availability';
            try {
              final m = (error as dynamic).userMessage;
              if (m is String && m.isNotEmpty) message = m;
            } catch (_) {}
            bool isForbidden = false;
            try {
              final f = (error as dynamic).isForbidden;
              if (f is bool) isForbidden = f;
            } catch (_) {}
            return ErrorView(
              message: message,
              onRetry: isForbidden
                  ? null
                  : () => ref.invalidate(appointmentSlotsProvider(
                        AppointmentSlotsParams(
                          organizationId: doctor.organizationId,
                          membershipId: doctor.membershipId,
                          from: _firstSelectable,
                          to: _firstSelectable.add(const Duration(days: 14)),
                        ),
                      )),
            );
          },
          data: (allSlots) {
            final daySlots = _filterSlotsForDay(allSlots, doctor);
            if (daySlots.isEmpty) {
              return EmptyView(
                title: 'No slots available',
                body:
                    'Dr. ${doctor.displayName} has no open slots on ${DateFormat('d MMM yyyy').format(_selectedDate)}. Pick another date.',
                icon: Icons.event_busy,
              );
            }
            final grouped = _groupByPeriod(daySlots);
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final period in _SlotPeriod.values)
                  if (grouped[period]!.isNotEmpty) ...[
                    _buildPeriodLabel(period),
                    const SizedBox(height: DesignTokens.spaceSm),
                    Wrap(
                      spacing: DesignTokens.spaceSm,
                      runSpacing: DesignTokens.spaceSm,
                      children: grouped[period]!
                          .map((s) => _buildSlotChip(s))
                          .toList(),
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                  ],
              ],
            );
          },
        ),
      ],
    );
  }

  Widget _buildPeriodLabel(_SlotPeriod period) {
    final (icon, label) = switch (period) {
      _SlotPeriod.morning => (Icons.wb_sunny_outlined, 'Morning'),
      _SlotPeriod.afternoon => (Icons.wb_cloudy_outlined, 'Afternoon'),
      _SlotPeriod.evening => (Icons.nights_stay_outlined, 'Evening'),
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: AppColors.textSecondary),
        const SizedBox(width: 6),
        Text(
          label,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            fontFamily: 'Manrope',
            color: AppColors.textSecondary,
          ),
        ),
      ],
    );
  }

  Widget _buildSlotChip(AvailabilitySlot slot) {
    final isSelected = _selectedSlotId == slot.id;
    final start = DateTime.tryParse(slot.startsAt);
    final label = start != null
        ? DateFormat('h:mm a').format(start.toLocal())
        : slot.startsAt;

    return GestureDetector(
      onTap: () => setState(() => _selectedSlotId = slot.id),
      child: AnimatedContainer(
        duration: DesignTokens.animationFast,
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd, vertical: 10),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.primary : AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
          border: Border.all(
            color: isSelected ? AppColors.primary : AppColors.gray200,
            width: isSelected ? 2 : 1,
          ),
          boxShadow: isSelected
              ? [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.2),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ]
              : null,
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            fontFamily: 'Manrope',
            color: isSelected ? AppColors.white : AppColors.textPrimary,
          ),
        ),
      ),
    );
  }

  Widget _buildSlotsSkeleton() {
    return Shimmer.fromColors(
      baseColor: AppColors.gray200,
      highlightColor: AppColors.gray100,
      child: Wrap(
        spacing: DesignTokens.spaceSm,
        runSpacing: DesignTokens.spaceSm,
        children: List.generate(
          6,
          (_) => Container(
            width: 90,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.gray200,
              borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Consultation type — Video / Audio / In-person cards.
  // ---------------------------------------------------------------------------
  Widget _buildConsultationType() {
    final modes = <AppointmentMode>[
      AppointmentMode.video,
      AppointmentMode.audio,
      AppointmentMode.inPerson,
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle('Consultation Type'),
        const SizedBox(height: DesignTokens.spaceSm),
        Row(
          children: modes.map((mode) {
            final isSelected = _consultationMode == mode;
            final meta = _modeMeta(mode);
            return Expanded(
              child: GestureDetector(
                onTap: () => setState(() => _consultationMode = mode),
                child: Container(
                  margin: EdgeInsets.only(
                      right: mode != AppointmentMode.inPerson
                          ? DesignTokens.spaceSm
                          : 0),
                  padding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceSm,
                      vertical: DesignTokens.spaceMd),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? AppColors.primaryContainer
                        : AppColors.surface,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                    border: Border.all(
                      color: isSelected ? AppColors.primary : AppColors.gray200,
                      width: isSelected ? 2 : 1,
                    ),
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: isSelected
                              ? AppColors.primary.withValues(alpha: 0.1)
                              : AppColors.gray100,
                          shape: BoxShape.circle,
                        ),
                        child: Icon(
                          meta.icon,
                          size: 20,
                          color: isSelected
                              ? AppColors.primary
                              : AppColors.textSecondary,
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceSm),
                      Text(
                        meta.title,
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          fontFamily: 'Manrope',
                          color: isSelected
                              ? AppColors.primaryOnContainer
                              : AppColors.textPrimary,
                        ),
                        textAlign: TextAlign.center,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        meta.subtitle,
                        style: const TextStyle(
                          fontSize: 10,
                          fontFamily: 'Manrope',
                          color: AppColors.textSecondary,
                        ),
                        textAlign: TextAlign.center,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ],
                  ),
                ),
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  _ModeMeta _modeMeta(AppointmentMode mode) {
    return switch (mode) {
      AppointmentMode.video => _ModeMeta(
          icon: Icons.videocam_rounded,
          title: 'Video',
          subtitle: 'Face-to-face',
        ),
      AppointmentMode.audio => _ModeMeta(
          icon: Icons.phone_in_talk_rounded,
          title: 'Audio',
          subtitle: 'Voice-only',
        ),
      AppointmentMode.inPerson => _ModeMeta(
          icon: Icons.local_hospital_rounded,
          title: 'In Person',
          subtitle: 'Visit clinic',
        ),
      _ => _ModeMeta(
          icon: Icons.help_outline_rounded,
          title: 'Other',
          subtitle: '',
        ),
    };
  }

  // ---------------------------------------------------------------------------
  // Notes field — optional text input.
  // ---------------------------------------------------------------------------
  Widget _buildNotesField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle('Notes (Optional)'),
        const SizedBox(height: DesignTokens.spaceSm),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(color: AppColors.gray200),
          ),
          child: TextField(
            controller: _notesController,
            maxLines: 4,
            maxLength: 300,
            style: const TextStyle(
              fontSize: 14,
              fontFamily: 'Manrope',
              color: AppColors.textPrimary,
            ),
            decoration: InputDecoration(
              hintText: 'Briefly describe your symptoms or reason for visit…',
              hintStyle: const TextStyle(
                fontSize: 14,
                fontFamily: 'Manrope',
                color: AppColors.textSecondary,
              ),
              border: InputBorder.none,
              contentPadding: const EdgeInsets.all(DesignTokens.spaceMd),
              counterText: '',
            ),
            onChanged: (_) => setState(() {}),
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Booking bar — fixed at the bottom with summary + book button.
  // ---------------------------------------------------------------------------
  Widget _buildBookingBar(DoctorDirectoryItem doctor, bool isBooking) {
    final bottomPad = MediaQuery.of(context).padding.bottom;
    final canBook = _selectedSlotId != null && !isBooking;

    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: Container(
        padding: EdgeInsets.fromLTRB(
          DesignTokens.spaceMd,
          DesignTokens.spaceMd,
          DesignTokens.spaceMd,
          bottomPad + DesignTokens.spaceSm,
        ),
        decoration: BoxDecoration(
          color: AppColors.surface,
          border: Border(
            top: BorderSide(color: AppColors.gray200, width: 1),
          ),
          boxShadow: [
            BoxShadow(
              color: AppColors.shadow,
              blurRadius: 12,
              offset: const Offset(0, -2),
            ),
          ],
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    canBook
                        ? DateFormat('EEE, MMM d').format(_selectedDate)
                        : 'Select a time slot',
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      fontFamily: 'Manrope',
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    MoneyFormatter.format(
                        doctor.consultationFeeSen, doctor.currency),
                    style: const TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      fontFamily: 'Manrope',
                      color: AppColors.primary,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: _buildBookButton(doctor, canBook, isBooking),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBookButton(
      DoctorDirectoryItem doctor, bool canBook, bool isBooking) {
    return Material(
      color: canBook ? AppColors.primary : AppColors.gray300,
      borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: canBook ? () => _bookAppointment(doctor) : null,
        child: Container(
          height: DesignTokens.buttonHeightLg,
          alignment: Alignment.center,
          child: isBooking
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.white,
                  ),
                )
              : Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(
                      Icons.check_circle_outline_rounded,
                      size: 20,
                      color: AppColors.white,
                    ),
                    const SizedBox(width: 8),
                    Text(
                      doctor.consultationFeeSen > 0
                          ? 'Proceed to Pay'
                          : 'Confirm Booking',
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        fontFamily: 'Manrope',
                        color: AppColors.white,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Shared building blocks
  // ---------------------------------------------------------------------------

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 16,
        fontWeight: FontWeight.w700,
        fontFamily: 'Manrope',
        color: AppColors.textPrimary,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  String _formatSpecialty(String specialty) {
    if (specialty.isEmpty) return specialty;
    return specialty
        .split('_')
        .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
        .join(' ');
  }
}

// =============================================================================
// Private helpers
// =============================================================================

enum _SlotPeriod { morning, afternoon, evening }

class _StepInfo {
  final int number;
  final String label;
  final bool active;
  final bool done;

  const _StepInfo({
    required this.number,
    required this.label,
    required this.active,
    required this.done,
  });
}

class _ModeMeta {
  final IconData icon;
  final String title;
  final String subtitle;

  const _ModeMeta({
    required this.icon,
    required this.title,
    required this.subtitle,
  });
}
