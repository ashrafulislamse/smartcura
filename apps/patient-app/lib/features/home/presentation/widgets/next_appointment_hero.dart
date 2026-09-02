import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/doctor_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/join_consultation.dart';
import '../../../../core/widgets/avatar_widget.dart';

/// Next-appointment card — the primary transactional component on Home.
///
/// Watches [nextAppointmentProvider] and renders a white Level-1 card with a
/// state-aware primary CTA:
///
/// * more than 15 min out → "View appointment"
/// * within the join window (15 min before start until the slot ends) for a
///   video/audio consultation → "Join Consultation" with a live countdown
/// * checked-in / in-progress → "Join Consultation"
/// * completed → "View consultation summary"
/// * cancelled / no-show → "Book new appointment"
///
/// Doctor name, specialty and avatar resolve via [doctorDetailProvider];
/// nothing here is hard-coded.
class NextAppointmentHero extends ConsumerWidget {
  const NextAppointmentHero({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final nextAsync = ref.watch(nextAppointmentProvider);

    return nextAsync.when(
      loading: () => _buildShimmer(),
      error: (error, _) => _buildError(ref, error),
      data: (appointment) {
        if (appointment == null) return _buildEmptyState(context);
        return _buildCard(context, ref, appointment);
      },
    );
  }

  // ─── Card (has data) ──────────────────────────────────────────────────

  Widget _buildCard(
    BuildContext context,
    WidgetRef ref,
    Appointment appointment,
  ) {
    final doctorAsync =
        ref.watch(doctorDetailProvider(appointment.doctorMembershipId));

    final doctorName = doctorAsync.maybeWhen(
      data: (doc) => doc.displayName,
      orElse: () => 'Your doctor',
    );
    final specialty = doctorAsync.maybeWhen(
      data: (doc) => doc.primarySpecialty ?? 'General Physician',
      orElse: () => 'General Physician',
    );
    final imageUrl = doctorAsync.maybeWhen(
      data: (doc) => doc.imageUrl,
      orElse: () => null,
    );

    final now = DateTime.now();
    final start = DateTime.tryParse(appointment.startsAt);
    final end = DateTime.tryParse(appointment.endsAt);
    final minutesToStart = start?.difference(now).inMinutes;

    final isRemote = appointment.mode == AppointmentMode.video ||
        appointment.mode == AppointmentMode.audio;
    final inJoinWindow = isRemote &&
        start != null &&
        end != null &&
        now.isAfter(start.subtract(const Duration(minutes: 15))) &&
        now.isBefore(end);
    final joinable = inJoinWindow ||
        appointment.status == AppointmentStatus.checkedIn ||
        appointment.status == AppointmentStatus.inProgress;

    final presentation = _presentation(appointment, minutesToStart, joinable);

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          border: Border.all(color: AppColors.gray200),
          boxShadow: [
            BoxShadow(
              color: AppColors.black.withValues(alpha: 0.05),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Label + date chip
            Row(
              children: [
                const Text(
                  'NEXT APPOINTMENT',
                  style: TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w800,
                    color: AppColors.primary,
                    letterSpacing: 0.8,
                  ),
                ),
                const Spacer(),
                if (presentation.chipLabel != null)
                  _Chip(
                    label: presentation.chipLabel!,
                    backgroundColor: presentation.chipColor.withValues(
                      alpha: 0.12,
                    ),
                    textColor: presentation.chipColor,
                  )
                else
                  _Chip(
                    label: _dateChipLabel(start, now),
                    backgroundColor: AppColors.primaryContainer,
                    textColor: AppColors.primaryDark,
                  ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            // Doctor + time row
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AvatarWidget(
                  imageUrl: imageUrl,
                  name: doctorName,
                  size: 56,
                  gradient: LinearGradient(
                    colors: [
                      AppColors.primaryContainer,
                      AppColors.primaryLight
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceMd),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _TimeRow(
                        startsAt: appointment.startsAt,
                        countdown: presentation.countdown,
                      ),
                      const SizedBox(height: 2),
                      Text(
                        doctorName,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      Text(
                        specialty,
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 6),
                      Row(
                        children: [
                          Icon(
                            _modeIcon(appointment.mode),
                            size: 14,
                            color: AppColors.primary,
                          ),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              '${_modeLabel(appointment.mode)} consultation',
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.textSecondary,
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
                Container(
                  width: 56,
                  height: 56,
                  decoration: BoxDecoration(
                    color: AppColors.primaryContainer.withValues(alpha: 0.6),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.calendar_month_outlined,
                    color: AppColors.primary,
                    size: 26,
                  ),
                ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            // Primary CTA
            SizedBox(
              width: double.infinity,
              height: 48,
              child: presentation.primaryFilled
                  ? FilledButton.icon(
                      onPressed: () {
                        HapticFeedback.lightImpact();
                        presentation.onPrimary(context, ref, appointment);
                      },
                      icon: Icon(presentation.primaryIcon, size: 18),
                      label: Text(
                        presentation.primaryLabel,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                      style: FilledButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: AppColors.white,
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusMd),
                        ),
                      ),
                    )
                  : OutlinedButton(
                      onPressed: () {
                        HapticFeedback.lightImpact();
                        presentation.onPrimary(context, ref, appointment);
                      },
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.primary,
                        side: const BorderSide(color: AppColors.primary),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusMd),
                        ),
                      ),
                      child: Text(
                        presentation.primaryLabel,
                        style: const TextStyle(fontWeight: FontWeight.w700),
                      ),
                    ),
            ),
            // Secondary navigation
            if (appointment.status != AppointmentStatus.cancelled &&
                appointment.status != AppointmentStatus.noShow)
              Center(
                child: TextButton(
                  onPressed: () {
                    HapticFeedback.lightImpact();
                    context.push('/appointment-details',
                        extra: {'appointmentId': appointment.id});
                  },
                  style: TextButton.styleFrom(
                    foregroundColor: AppColors.primary,
                    minimumSize: const Size(48, 40),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'View appointment details',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      SizedBox(width: 4),
                      Icon(Icons.chevron_right_rounded, size: 16),
                    ],
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  /// The state machine that decides chip, countdown and primary CTA.
  _Presentation _presentation(
    Appointment a,
    int? minutesToStart,
    bool joinable,
  ) {
    void toDetails(BuildContext c, WidgetRef r, Appointment appt) =>
        c.push('/appointment-details', extra: {'appointmentId': appt.id});
    void toJoin(BuildContext c, WidgetRef r, Appointment appt) =>
        launchConsultation(c, r, appt);
    void toBook(BuildContext c, WidgetRef r, Appointment appt) =>
        c.push('/find-doctor');

    switch (a.status) {
      case AppointmentStatus.cancelled:
        return _Presentation(
          chipLabel: 'Cancelled',
          chipColor: AppColors.error,
          primaryLabel: 'Book new appointment',
          primaryIcon: Icons.add_rounded,
          primaryFilled: false,
          onPrimary: toBook,
        );
      case AppointmentStatus.noShow:
        return _Presentation(
          chipLabel: 'Missed',
          chipColor: AppColors.warning,
          primaryLabel: 'Book new appointment',
          primaryIcon: Icons.add_rounded,
          primaryFilled: false,
          onPrimary: toBook,
        );
      case AppointmentStatus.completed:
        return _Presentation(
          chipLabel: 'Completed',
          chipColor: AppColors.success,
          primaryLabel: 'View consultation summary',
          primaryIcon: Icons.summarize_outlined,
          primaryFilled: false,
          onPrimary: toDetails,
        );
      case AppointmentStatus.rescheduled:
        return _Presentation(
          chipLabel: 'Rescheduled',
          chipColor: AppColors.info,
          primaryLabel: 'View appointment',
          primaryIcon: Icons.event_outlined,
          primaryFilled: false,
          onPrimary: toDetails,
        );
      case AppointmentStatus.checkedIn:
      case AppointmentStatus.inProgress:
        return _Presentation(
          chipLabel: 'In progress',
          chipColor: AppColors.success,
          primaryLabel: 'Join Consultation',
          primaryIcon: _joinIcon(a.mode),
          primaryFilled: true,
          onPrimary:
              a.mode == AppointmentMode.video || a.mode == AppointmentMode.audio
                  ? toJoin
                  : toDetails,
        );
      default:
        if (joinable) {
          return _Presentation(
            countdown: (minutesToStart != null && minutesToStart > 0)
                ? 'Starting in $minutesToStart min'
                : null,
            primaryLabel: 'Join Consultation',
            primaryIcon: _joinIcon(a.mode),
            primaryFilled: true,
            onPrimary: toJoin,
          );
        }
        return _Presentation(
          primaryLabel: 'View appointment',
          primaryIcon: Icons.event_outlined,
          primaryFilled: false,
          onPrimary: toDetails,
        );
    }
  }

  IconData _joinIcon(AppointmentMode mode) => mode == AppointmentMode.audio
      ? Icons.phone_in_talk_rounded
      : Icons.videocam_rounded;

  String _dateChipLabel(DateTime? start, DateTime now) {
    if (start == null) return 'SCHEDULED';
    if (start.year == now.year &&
        start.month == now.month &&
        start.day == now.day) {
      return 'TODAY';
    }
    final tomorrow = now.add(const Duration(days: 1));
    if (start.year == tomorrow.year &&
        start.month == tomorrow.month &&
        start.day == tomorrow.day) {
      return 'TOMORROW';
    }
    return DateFormat('MMM d').format(start).toUpperCase();
  }

  IconData _modeIcon(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => Icons.videocam_rounded,
        AppointmentMode.audio => Icons.phone_in_talk_rounded,
        AppointmentMode.chat => Icons.chat_bubble_outline_rounded,
        AppointmentMode.inPerson => Icons.local_hospital_outlined,
        AppointmentMode.unknown => Icons.event_outlined,
      };

  String _modeLabel(AppointmentMode mode) => switch (mode) {
        AppointmentMode.video => 'Video',
        AppointmentMode.audio => 'Audio',
        AppointmentMode.chat => 'Chat',
        AppointmentMode.inPerson => 'In-person',
        AppointmentMode.unknown => 'Scheduled',
      };

  // ─── Empty state (no appointment) ─────────────────────────────────────

  Widget _buildEmptyState(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: GestureDetector(
        onTap: () {
          HapticFeedback.lightImpact();
          context.push('/find-doctor');
        },
        child: Container(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
            border: Border.all(color: AppColors.gray200),
            boxShadow: [
              BoxShadow(
                color: AppColors.black.withValues(alpha: 0.04),
                blurRadius: 10,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: const Icon(
                  Icons.event_available_rounded,
                  color: AppColors.primary,
                  size: 24,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              const Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'No upcoming appointments',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    SizedBox(height: 2),
                    Text(
                      'Book a consultation with a doctor',
                      style: TextStyle(
                        fontSize: 13,
                        color: AppColors.textSecondary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                decoration: BoxDecoration(
                  color: AppColors.primary,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                ),
                child: const Text(
                  'Book',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.white,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ─── Shimmer / error ──────────────────────────────────────────────────

  Widget _buildShimmer() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Shimmer.fromColors(
        baseColor: AppColors.gray200,
        highlightColor: AppColors.gray100,
        child: Container(
          height: 190,
          decoration: BoxDecoration(
            color: AppColors.gray200,
            borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          ),
        ),
      ),
    );
  }

  Widget _buildError(WidgetRef ref, Object error) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          border: Border.all(color: AppColors.gray200),
        ),
        child: Row(
          children: [
            const Icon(Icons.cloud_off_outlined, color: AppColors.gray400),
            const SizedBox(width: DesignTokens.spaceMd),
            const Expanded(
              child: Text(
                'Could not load your next appointment.',
                style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
              ),
            ),
            TextButton(
              onPressed: () => ref.invalidate(nextAppointmentProvider),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Presentation {
  final String? chipLabel;
  final Color chipColor;
  final String? countdown;
  final String primaryLabel;
  final IconData primaryIcon;
  final bool primaryFilled;
  final void Function(BuildContext, WidgetRef, Appointment) onPrimary;

  const _Presentation({
    this.chipLabel,
    this.chipColor = AppColors.primary,
    this.countdown,
    required this.primaryLabel,
    required this.primaryIcon,
    required this.primaryFilled,
    required this.onPrimary,
  });
}

class _Chip extends StatelessWidget {
  final String label;
  final Color backgroundColor;
  final Color textColor;

  const _Chip({
    required this.label,
    required this.backgroundColor,
    required this.textColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: backgroundColor,
        borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10,
          fontWeight: FontWeight.w800,
          color: textColor,
          letterSpacing: 0.4,
        ),
      ),
    );
  }
}

class _TimeRow extends StatelessWidget {
  final String startsAt;
  final String? countdown;

  const _TimeRow({required this.startsAt, this.countdown});

  @override
  Widget build(BuildContext context) {
    final dt = DateTime.tryParse(startsAt);
    final time = dt != null ? DateFormat('h:mm').format(dt) : startsAt;
    final dayPart = dt != null ? DateFormat('a').format(dt) : '';

    return Wrap(
      crossAxisAlignment: WrapCrossAlignment.center,
      spacing: 8,
      children: [
        Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            Text(
              time,
              style: const TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w900,
                color: AppColors.textPrimary,
                height: 1.1,
                letterSpacing: -0.5,
              ),
            ),
            const SizedBox(width: 4),
            Text(
              dayPart,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
        if (countdown != null)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: AppColors.warningContainer,
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            ),
            child: Text(
              countdown!,
              style: const TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w800,
                color: AppColors.warningDark,
              ),
            ),
          ),
      ],
    );
  }
}
