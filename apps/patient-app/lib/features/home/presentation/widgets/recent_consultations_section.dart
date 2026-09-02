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
import '../components/consultation_card.dart';

/// Recent consultations section — shows completed appointments from real data.
///
/// Watches [appointmentsProvider], filters for [AppointmentStatus.completed],
/// sorts by start time descending, and renders each as a [ConsultationCard].
/// Doctor names are resolved per-card via [doctorDetailProvider].
class RecentConsultationsSection extends ConsumerWidget {
  const RecentConsultationsSection({super.key});

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
                'Recent Consultations',
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
                  'View All',
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
        const SizedBox(height: DesignTokens.spaceSm),
        appointmentsAsync.when(
          loading: () => _buildShimmer(),
          error: (error, _) => SizedBox(
            height: 180,
            child: ErrorView(
              message: _errorMessage(error),
              onRetry: () => ref.invalidate(appointmentsProvider),
            ),
          ),
          data: (appointments) {
            final completed = appointments
                .where((a) => a.status == AppointmentStatus.completed)
                .toList()
              ..sort((a, b) => b.startsAt.compareTo(a.startsAt));

            if (completed.isEmpty) {
              return SizedBox(
                height: 180,
                child: const EmptyView(
                  title: 'No consultations yet',
                  body: 'Your past consultations will appear here.',
                  icon: Icons.history_outlined,
                ),
              );
            }

            final visible =
                completed.length > 5 ? completed.sublist(0, 5) : completed;

            return SizedBox(
              height: 165,
              child: ListView.separated(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(
                  horizontal: DesignTokens.spaceMd,
                ),
                physics: const BouncingScrollPhysics(),
                itemCount: visible.length,
                separatorBuilder: (_, __) => const SizedBox(width: 12),
                itemBuilder: (context, index) {
                  final appt = visible[index];
                  return _ConsultationCardItem(appointment: appt);
                },
              ),
            );
          },
        ),
      ],
    );
  }

  String _errorMessage(Object? error) {
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return 'Could not load consultations';
  }

  Widget _buildShimmer() {
    return SizedBox(
      height: 165,
      child: Shimmer.fromColors(
        baseColor: AppColors.gray200,
        highlightColor: AppColors.gray100,
        child: ListView(
          scrollDirection: Axis.horizontal,
          physics: const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          children: List.generate(
            3,
            (_) => Container(
              width: 260,
              height: 155,
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

class _ConsultationCardItem extends ConsumerWidget {
  final Appointment appointment;

  const _ConsultationCardItem({required this.appointment});

  String _formatDate(String startsAt) {
    final dt = DateTime.tryParse(startsAt);
    if (dt == null) return startsAt;
    return DateFormat('MMM d, yyyy').format(dt);
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
      orElse: () => 'Consultation',
    );

    final imageUrl = doctorAsync.maybeWhen(
      data: (doc) => doc.imageUrl,
      orElse: () => null,
    );

    return ConsultationCard(
      doctorName: doctorName,
      specialty: specialty,
      date: _formatDate(appointment.startsAt),
      doctorImageUrl: imageUrl,
      onBookAgain: () {
        context.push('/doctor-profile', extra: appointment.doctorMembershipId);
      },
    );
  }
}
