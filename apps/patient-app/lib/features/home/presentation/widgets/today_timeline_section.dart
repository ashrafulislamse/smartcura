import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/doctor_provider.dart';
import '../../../../core/providers/prescription_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/join_consultation.dart';
import '../../../../core/utils/time_formatter.dart';
import '../../../../core/widgets/state_view.dart';

/// "Today" — one unified timeline of today's appointments and active
/// prescriptions.
///
/// Appointment rows come from [appointmentsProvider] filtered to active
/// statuses starting today (ascending). Medication rows come from
/// [prescriptionsProvider]: the backend has no medication-schedule or
/// adherence model, so rows are the signed, unexpired prescriptions
/// themselves — no "taken" state is fabricated. The medication CTA
/// deep-links to the prescription detail.
class TodayTimelineSection extends ConsumerWidget {
  const TodayTimelineSection({super.key});

  static const _activeStatuses = {
    AppointmentStatus.pendingPayment,
    AppointmentStatus.confirmed,
    AppointmentStatus.checkedIn,
    AppointmentStatus.inProgress,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appointmentsAsync = ref.watch(appointmentsProvider);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                'TODAY',
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  letterSpacing: 0.6,
                ),
              ),
              TextButton(
                onPressed: () => context.go('/schedule'),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                  minimumSize: const Size(0, 32),
                ),
                child: const Text(
                  'View all',
                  style: TextStyle(fontSize: 12, fontWeight: FontWeight.w700),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: DesignTokens.spaceXs),
        appointmentsAsync.when(
          loading: () => _buildShimmer(),
          error: (error, _) => Padding(
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceMd,
            ),
            child: ErrorView(
              message: _errorMessage(error, 'Could not load today\'s plan'),
              onRetry: () => ref
                ..invalidate(appointmentsProvider)
                ..invalidate(prescriptionsProvider),
            ),
          ),
          data: (appointments) => _buildContent(context, ref, appointments),
        ),
      ],
    );
  }

  Widget _buildContent(
    BuildContext context,
    WidgetRef ref,
    List<Appointment> appointments,
  ) {
    final prescriptionsAsync = ref.watch(prescriptionsProvider);
    final now = DateTime.now();

    final todaysAppointments = appointments
        .where((a) =>
            _activeStatuses.contains(a.status) && _isToday(a.startsAt, now))
        .toList()
      ..sort((a, b) => a.startsAt.compareTo(b.startsAt));

    // Signed, unexpired prescriptions stand in for a medication schedule —
    // the backend models no per-dose times or adherence state.
    final activePrescriptions = (prescriptionsAsync.valueOrNull ?? [])
        .where((p) => _isActivePrescription(p, now))
        .toList()
      ..sort((a, b) =>
          (b.signedAt ?? b.createdAt).compareTo(a.signedAt ?? a.createdAt));
    final medications = activePrescriptions.length > 3
        ? activePrescriptions.sublist(0, 3)
        : activePrescriptions;

    if (todaysAppointments.isEmpty && medications.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd,
            vertical: DesignTokens.spaceLg,
          ),
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
            border: Border.all(color: AppColors.gray200),
          ),
          child: const Column(
            children: [
              Icon(
                Icons.event_available_rounded,
                color: AppColors.gray300,
                size: 32,
              ),
              SizedBox(height: DesignTokens.spaceSm),
              Text(
                'Nothing scheduled today',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              SizedBox(height: 2),
              Text(
                'Appointments and active prescriptions will appear here.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    final rows = <Widget>[
      for (final (i, appt) in todaysAppointments.indexed)
        _TimelineRow(
          railLabel: formatTimeParts(appt.startsAt).$1,
          railSub: formatTimeParts(appt.startsAt).$2,
          isLast: i == todaysAppointments.length - 1 && medications.isEmpty,
          child: _AppointmentTile(appointment: appt),
        ),
      for (final (i, rx) in medications.indexed)
        _TimelineRow(
          railLabel: 'Rx',
          railSub: '',
          railAccent: AppColors.bloodPressure,
          isLast: i == medications.length - 1,
          child: _PrescriptionTile(prescription: rx),
        ),
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceSm,
              vertical: DesignTokens.spaceSm,
            ),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
              border: Border.all(color: AppColors.gray200),
              boxShadow: [
                BoxShadow(
                  color: AppColors.black.withValues(alpha: 0.04),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Column(children: rows),
          ),
          if (prescriptionsAsync.hasError)
            Padding(
              padding: const EdgeInsets.only(top: DesignTokens.spaceXs),
              child: Row(
                children: [
                  const Icon(
                    Icons.info_outline_rounded,
                    size: 14,
                    color: AppColors.textDisabled,
                  ),
                  const SizedBox(width: 6),
                  const Expanded(
                    child: Text(
                      'Couldn\'t load medications',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.textDisabled,
                      ),
                    ),
                  ),
                  TextButton(
                    onPressed: () => ref.invalidate(prescriptionsProvider),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.primary,
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(0, 28),
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                    child: const Text(
                      'Retry',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
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

  static bool _isToday(String iso, DateTime now) {
    final dt = DateTime.tryParse(iso)?.toLocal();
    if (dt == null) return false;
    return dt.year == now.year && dt.month == now.month && dt.day == now.day;
  }

  static bool _isActivePrescription(Prescription p, DateTime now) {
    if (p.status != PrescriptionStatus.signed) return false;
    final expires =
        p.expiresAt == null ? null : DateTime.tryParse(p.expiresAt!);
    return expires == null || expires.isAfter(now);
  }

  String _errorMessage(Object? error, String fallback) {
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return fallback;
  }

  Widget _buildShimmer() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Shimmer.fromColors(
        baseColor: AppColors.gray200,
        highlightColor: AppColors.gray100,
        child: Column(
          children: List.generate(
            2,
            (i) => Container(
              height: 72,
              margin:
                  EdgeInsets.only(bottom: i == 1 ? 0 : DesignTokens.spaceSm),
              decoration: BoxDecoration(
                color: AppColors.gray200,
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// One timeline row: rail label (time / Rx), dot-and-line, then content.
class _TimelineRow extends StatelessWidget {
  final String railLabel;
  final String railSub;
  final Color railAccent;
  final bool isLast;
  final Widget child;

  const _TimelineRow({
    required this.railLabel,
    required this.railSub,
    required this.child,
    this.railAccent = AppColors.primary,
    this.isLast = false,
  });

  @override
  Widget build(BuildContext context) {
    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SizedBox(
            width: 46,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                const SizedBox(height: 14),
                Text(
                  railLabel,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (railSub.isNotEmpty)
                  Text(
                    railSub,
                    style: const TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textDisabled,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          SizedBox(
            width: 12,
            child: Column(
              children: [
                const SizedBox(height: 17),
                Container(
                  width: 8,
                  height: 8,
                  decoration: BoxDecoration(
                    color: railAccent,
                    shape: BoxShape.circle,
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(
                      width: 1.5,
                      color: AppColors.gray200,
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(
                bottom: isLast ? 0 : DesignTokens.spaceSm,
              ),
              child: child,
            ),
          ),
        ],
      ),
    );
  }
}

/// An appointment row inside the today card.
class _AppointmentTile extends ConsumerWidget {
  final Appointment appointment;

  const _AppointmentTile({required this.appointment});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final doctorAsync =
        ref.watch(doctorDetailProvider(appointment.doctorMembershipId));

    final doctorName = doctorAsync.maybeWhen(
      data: (doc) => doc.displayName,
      orElse: () => 'Your doctor',
    );
    final specialty = doctorAsync.maybeWhen(
      data: (doc) => doc.primarySpecialty ?? _modeLabel(appointment.mode),
      orElse: () => _modeLabel(appointment.mode),
    );

    final now = DateTime.now();
    final start = DateTime.tryParse(appointment.startsAt);
    final end = DateTime.tryParse(appointment.endsAt);
    final isRemote = appointment.mode == AppointmentMode.video ||
        appointment.mode == AppointmentMode.audio;
    final joinable = (isRemote &&
            start != null &&
            end != null &&
            now.isAfter(start.subtract(const Duration(minutes: 15))) &&
            now.isBefore(end)) ||
        appointment.status == AppointmentStatus.checkedIn ||
        appointment.status == AppointmentStatus.inProgress;

    return _TileShell(
      icon: _modeIcon(appointment.mode),
      iconColor: AppColors.primary,
      title: doctorName,
      subtitle: '$specialty • ${_modeLabel(appointment.mode)}',
      ctaLabel: joinable ? 'Join' : 'View',
      ctaFilled: joinable,
      onCta: joinable
          ? () => launchConsultation(context, ref, appointment)
          : () => context.push(
                '/appointment-details',
                extra: {'appointmentId': appointment.id},
              ),
    );
  }

  IconData _modeIcon(AppointmentMode mode) {
    return switch (mode) {
      AppointmentMode.video => Icons.videocam_rounded,
      AppointmentMode.audio => Icons.call_rounded,
      AppointmentMode.chat => Icons.chat_bubble_outline_rounded,
      AppointmentMode.inPerson => Icons.location_on_rounded,
      _ => Icons.calendar_today_rounded,
    };
  }

  String _modeLabel(AppointmentMode mode) {
    return switch (mode) {
      AppointmentMode.video => 'Video',
      AppointmentMode.audio => 'Audio',
      AppointmentMode.chat => 'Chat',
      AppointmentMode.inPerson => 'In-person',
      _ => 'Appointment',
    };
  }
}

/// A prescription row inside the today card. Deep-links to the detail;
/// there is intentionally no "mark as taken" action — the backend models
/// no adherence state.
class _PrescriptionTile extends StatelessWidget {
  final Prescription prescription;

  const _PrescriptionTile({required this.prescription});

  @override
  Widget build(BuildContext context) {
    final items = prescription.items.join(', ');
    return _TileShell(
      icon: Icons.medication_rounded,
      iconColor: AppColors.bloodPressure,
      title:
          prescription.diagnosis != null && prescription.diagnosis!.isNotEmpty
              ? prescription.diagnosis!
              : 'Prescription',
      subtitle: items.isEmpty ? 'Tap to view details' : items,
      ctaLabel: 'View',
      ctaFilled: false,
      onCta: () =>
          context.push('/prescriptions/${prescription.prescriptionId}'),
    );
  }
}

/// Shared row chrome for timeline tiles.
class _TileShell extends StatelessWidget {
  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final String ctaLabel;
  final bool ctaFilled;
  final VoidCallback onCta;

  const _TileShell({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.ctaLabel,
    required this.ctaFilled,
    required this.onCta,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceSm,
        vertical: DesignTokens.spaceSm,
      ),
      decoration: BoxDecoration(
        color: AppColors.gray50,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: iconColor.withValues(alpha: 0.12),
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: Icon(icon, color: iconColor, size: 18),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 1),
                Text(
                  subtitle,
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: DesignTokens.spaceXs),
          _CtaButton(label: ctaLabel, filled: ctaFilled, onTap: onCta),
        ],
      ),
    );
  }
}

class _CtaButton extends StatelessWidget {
  final String label;
  final bool filled;
  final VoidCallback onTap;

  const _CtaButton({
    required this.label,
    required this.filled,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
        decoration: BoxDecoration(
          color: filled ? AppColors.primary : AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          border: filled ? null : Border.all(color: AppColors.gray300),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            color: filled ? AppColors.white : AppColors.primary,
          ),
        ),
      ),
    );
  }
}
