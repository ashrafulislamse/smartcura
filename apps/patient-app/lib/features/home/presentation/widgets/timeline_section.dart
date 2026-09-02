import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/doctor_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/state_view.dart';
import '../components/timeline_card.dart';

/// Timeline section — shows upcoming appointments from real data.
///
/// Watches [appointmentsProvider], filters for upcoming (active status,
/// future start time), sorts by start time, and renders each as a
/// [TimelineCard]. Doctor names are resolved per-card via
/// [doctorDetailProvider].
class TimelineSection extends ConsumerWidget {
  const TimelineSection({super.key});

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
                'Upcoming Appointments',
                style: TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  letterSpacing: -0.3,
                  fontFamily: 'Manrope',
                ),
              ),
              TextButton(
                onPressed: () => context.push('/schedule'),
                style: TextButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                ),
                child: const Text(
                  'See all',
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    fontFamily: 'Manrope',
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        appointmentsAsync.when(
          loading: () => _buildShimmer(),
          error: (error, _) => SizedBox(
            height: 140,
            child: ErrorView(
              message: _errorMessage(error),
              onRetry: () => ref.invalidate(appointmentsProvider),
            ),
          ),
          data: (appointments) {
            final now = DateTime.now();
            final upcoming = appointments
                .where((a) => _isUpcoming(a, now))
                .toList()
              ..sort((a, b) => a.startsAt.compareTo(b.startsAt));

            if (upcoming.isEmpty) {
              return SizedBox(
                height: 140,
                child: const EmptyView(
                  title: 'No upcoming appointments',
                  body: 'Your scheduled appointments will appear here.',
                  icon: Icons.event_available_outlined,
                ),
              );
            }

            return SizedBox(
              height: 120,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(
                  horizontal: DesignTokens.spaceMd,
                ),
                physics: const BouncingScrollPhysics(),
                itemCount: upcoming.length,
                separatorBuilder: (_, __) => const SizedBox(width: 12),
                itemBuilder: (context, index) {
                  final appt = upcoming[index];
                  return _AppointmentTimelineCard(appointment: appt);
                },
              ),
            );
          },
        ),
      ],
    );
  }

  bool _isUpcoming(Appointment a, DateTime now) {
    final activeStatuses = {
      AppointmentStatus.pendingPayment,
      AppointmentStatus.confirmed,
      AppointmentStatus.checkedIn,
      AppointmentStatus.inProgress,
    };
    if (!activeStatuses.contains(a.status)) return false;
    final start = DateTime.tryParse(a.startsAt);
    if (start == null) return false;
    return start.isAfter(now.subtract(const Duration(minutes: 30)));
  }

  String _errorMessage(Object? error) {
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return 'Could not load appointments';
  }

  Widget _buildShimmer() {
    return SizedBox(
      height: 120,
      child: Shimmer.fromColors(
        baseColor: AppColors.gray200,
        highlightColor: AppColors.gray100,
        child: ListView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          physics: const NeverScrollableScrollPhysics(),
          children: List.generate(
            2,
            (_) => Container(
              width: 280,
              height: 90,
              margin: const EdgeInsets.only(right: 12),
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

class _AppointmentTimelineCard extends ConsumerWidget {
  final Appointment appointment;

  const _AppointmentTimelineCard({required this.appointment});

  String _formatTime(String startsAt) {
    final dt = DateTime.tryParse(startsAt);
    if (dt == null) return startsAt;
    final now = DateTime.now();
    final isToday = dt.day == now.day && dt.month == now.month;
    final timeStr = DateFormat('h:mm a').format(dt);
    if (isToday) {
      final diff = dt.difference(now);
      if (diff.inMinutes <= 0 && diff.inMinutes > -30) return 'Now • $timeStr';
      return timeStr;
    }
    return '${DateFormat('MMM d').format(dt)} • $timeStr';
  }

  String _modeLabel(AppointmentMode mode) {
    return switch (mode) {
      AppointmentMode.video => 'Video',
      AppointmentMode.audio => 'Audio',
      AppointmentMode.chat => 'Chat',
      AppointmentMode.inPerson => 'In-person',
      AppointmentMode.unknown => 'Appointment',
    };
  }

  bool _isActive(Appointment appt) {
    final now = DateTime.now();
    final start = DateTime.tryParse(appt.startsAt);
    if (start == null) return false;
    return (now.difference(start).inMinutes).abs() < 15;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final doctorAsync =
        ref.watch(doctorDetailProvider(appointment.doctorMembershipId));

    final doctorName = doctorAsync.maybeWhen(
      data: (doc) => doc.displayName,
      orElse: () => 'Doctor',
    );

    final specialty = doctorAsync.maybeWhen(
      data: (doc) => doc.primarySpecialty ?? 'General Physician',
      orElse: () => _modeLabel(appointment.mode),
    );

    final imageUrl = doctorAsync.maybeWhen(
      data: (doc) => doc.imageUrl,
      orElse: () => null,
    );

    final active = _isActive(appointment);

    return TimelineCard(
      time: _formatTime(appointment.startsAt),
      status: _modeLabel(appointment.mode),
      title: doctorName,
      subtitle: specialty,
      imageUrl: imageUrl,
      accentColor: AppColors.primary,
      isActive: active,
      actionLabel:
          appointment.mode == AppointmentMode.video ? 'Join Session' : 'View',
      onTap: () {
        context.push('/appointment-details',
            extra: {'appointmentId': appointment.id});
      },
    );
  }
}
