import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/health_provider.dart';
import '../../../../core/providers/prescription_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/time_formatter.dart';
import '../../../../core/utils/vital_metrics.dart';
import '../../../../core/widgets/state_view.dart';

/// "Recent Activity" — a low-weight merged feed of the latest completed
/// consultations, prescriptions, and health readings (cap 5, newest first).
///
/// Every row deep-links to real data. Sources load independently; if one
/// fails the others still render, and only a total failure shows the
/// retryable error card.
class RecentActivitySection extends ConsumerWidget {
  const RecentActivitySection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final appointmentsAsync = ref.watch(appointmentsProvider);
    final prescriptionsAsync = ref.watch(prescriptionsProvider);
    final readingsAsync = ref.watch(vitalReadingsProvider);

    final allLoading = appointmentsAsync.isLoading &&
        prescriptionsAsync.isLoading &&
        readingsAsync.isLoading &&
        appointmentsAsync.valueOrNull == null &&
        prescriptionsAsync.valueOrNull == null &&
        readingsAsync.valueOrNull == null;
    final allFailed = appointmentsAsync.hasError &&
        prescriptionsAsync.hasError &&
        readingsAsync.hasError;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          child: Text(
            'RECENT ACTIVITY',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              letterSpacing: 0.6,
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceXs),
        if (allLoading)
          _buildShimmer()
        else if (allFailed)
          Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
            child: ErrorView(
              message: 'Could not load your recent activity',
              onRetry: () => ref
                ..invalidate(appointmentsProvider)
                ..invalidate(prescriptionsProvider)
                ..invalidate(vitalReadingsProvider),
            ),
          )
        else
          _buildCard(
            context,
            appointments: appointmentsAsync.valueOrNull ?? const [],
            prescriptions: prescriptionsAsync.valueOrNull ?? const [],
            readings: readingsAsync.valueOrNull ?? const [],
          ),
      ],
    );
  }

  Widget _buildCard(
    BuildContext context, {
    required List<Appointment> appointments,
    required List<Prescription> prescriptions,
    required List<VitalReading> readings,
  }) {
    final items = <_ActivityItem>[
      for (final a in appointments.where(
        (a) =>
            a.status == AppointmentStatus.completed &&
            DateTime.tryParse(a.endsAt) != null,
      ))
        _ActivityItem(
          instant: DateTime.parse(a.endsAt),
          icon: Icons.medical_services_rounded,
          color: AppColors.primary,
          title: 'Consultation',
          subtitle: _modeLabel(a.mode),
          onTap: () => context.push(
            '/appointment-details',
            extra: {'appointmentId': a.id},
          ),
        ),
      for (final p in prescriptions.where(
        (p) => DateTime.tryParse(p.signedAt ?? p.createdAt) != null,
      ))
        _ActivityItem(
          instant: DateTime.parse(p.signedAt ?? p.createdAt),
          icon: Icons.receipt_long_rounded,
          color: AppColors.warning,
          title: 'Prescription',
          subtitle: p.items.isEmpty
              ? (p.diagnosis ?? 'Tap to view')
              : p.items.join(', '),
          onTap: () => context.push('/prescriptions/${p.prescriptionId}'),
        ),
      for (final r in readings.where(
        (r) => DateTime.tryParse(r.recordedAt) != null,
      ))
        _ActivityItem(
          instant: DateTime.parse(r.recordedAt),
          icon: Icons.monitor_heart_outlined,
          color: AppColors.heartRate,
          title: 'Health reading',
          subtitle:
              '${_capitalize(vitalMetricLabel(r.metric))} ${r.value.toStringAsFixed(r.metric == VitalMetric.bodyTemperature ? 1 : 0)} ${r.unit}',
          onTap: () => context.go('/health'),
        ),
    ];

    items.sort((a, b) => b.instant.compareTo(a.instant));
    final latest = items.length > 5 ? items.sublist(0, 5) : items;

    if (latest.isEmpty) {
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
              Icon(Icons.history_rounded, color: AppColors.gray300, size: 32),
              SizedBox(height: DesignTokens.spaceSm),
              Text(
                'No activity yet',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
              ),
              SizedBox(height: 2),
              Text(
                'Completed consultations, prescriptions and readings will appear here.',
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceSm,
          vertical: DesignTokens.spaceXs,
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
        child: Column(
          children: [
            for (final (i, item) in latest.indexed) ...[
              _ActivityRow(item: item),
              if (i != latest.length - 1)
                const Divider(
                  height: 1,
                  thickness: 1,
                  color: AppColors.gray100,
                ),
            ],
          ],
        ),
      ),
    );
  }

  String _modeLabel(AppointmentMode mode) {
    return switch (mode) {
      AppointmentMode.video => 'Video consultation',
      AppointmentMode.audio => 'Audio consultation',
      AppointmentMode.chat => 'Chat consultation',
      AppointmentMode.inPerson => 'In-person visit',
      _ => 'Consultation',
    };
  }

  String _capitalize(String s) =>
      s.isEmpty ? s : s[0].toUpperCase() + s.substring(1);

  Widget _buildShimmer() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Shimmer.fromColors(
        baseColor: AppColors.gray200,
        highlightColor: AppColors.gray100,
        child: Container(
          height: 180,
          decoration: BoxDecoration(
            color: AppColors.gray200,
            borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          ),
        ),
      ),
    );
  }
}

class _ActivityItem {
  final DateTime instant;
  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  const _ActivityItem({
    required this.instant,
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });
}

class _ActivityRow extends StatelessWidget {
  final _ActivityItem item;

  const _ActivityRow({required this.item});

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: item.onTap,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceXs,
            vertical: DesignTokens.spaceSm,
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: BoxDecoration(
                  color: item.color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: Icon(item.icon, color: item.color, size: 18),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      item.title,
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
                      item.subtitle,
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
              Text(
                formatRelativeTime(item.instant.toIso8601String()),
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textDisabled,
                ),
              ),
              const SizedBox(width: 2),
              const Icon(
                Icons.chevron_right_rounded,
                color: AppColors.gray300,
                size: 18,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
