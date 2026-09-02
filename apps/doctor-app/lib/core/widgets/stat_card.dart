import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';
import 'premium_card.dart';

/// A compact stat card: a colored icon container + label + value + optional
/// subtitle. Used on the dashboard for today's appointments, assigned patients,
/// pending notes, unread notifications, and active IoT alerts.
class StatCard extends StatelessWidget {
  const StatCard({
    super.key,
    required this.icon,
    required this.label,
    required this.value,
    this.subtitle,
    this.tone = StatTone.primary,
    this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final String? subtitle;
  final StatTone tone;
  final VoidCallback? onTap;

  Color get _iconBg => switch (tone) {
        StatTone.primary => AppColors.primaryContainer,
        StatTone.success => AppColors.successContainer,
        StatTone.warning => AppColors.warningContainer,
        StatTone.error => AppColors.errorContainer,
        StatTone.info => AppColors.infoContainer,
        StatTone.neutral => AppColors.gray100,
      };

  Color get _iconFg => switch (tone) {
        StatTone.primary => AppColors.primary,
        StatTone.success => AppColors.success,
        StatTone.warning => AppColors.warning,
        StatTone.error => AppColors.error,
        StatTone.info => AppColors.info,
        StatTone.neutral => AppColors.gray500,
      };

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      onTap: onTap,
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: _iconBg,
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: Icon(icon, color: _iconFg, size: DesignTokens.iconMd),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: AppColors.gray500,
                      ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: Theme.of(context).textTheme.titleLarge?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: AppColors.gray900,
                      ),
                ),
                if (subtitle != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: AppColors.gray500,
                        ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Tone options for [StatCard], mirroring [StatusBadgeTone].
enum StatTone { primary, success, warning, error, info, neutral }
