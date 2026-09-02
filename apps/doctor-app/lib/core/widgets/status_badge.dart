import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// Visual tone of a [StatusBadge]. Each maps to a container + foreground pair so
/// the badge is readable on white surfaces.
enum StatusBadgeTone { success, warning, error, info, neutral, primary }

extension StatusBadgeToneColors on StatusBadgeTone {
  Color get container => switch (this) {
        StatusBadgeTone.success => AppColors.successContainer,
        StatusBadgeTone.warning => AppColors.warningContainer,
        StatusBadgeTone.error => AppColors.errorContainer,
        StatusBadgeTone.info => AppColors.infoContainer,
        StatusBadgeTone.neutral => AppColors.gray100,
        StatusBadgeTone.primary => AppColors.primaryContainer,
      };

  Color get foreground => switch (this) {
        StatusBadgeTone.success => AppColors.successDark,
        StatusBadgeTone.warning => AppColors.warningDark,
        StatusBadgeTone.error => AppColors.errorDark,
        StatusBadgeTone.info => AppColors.infoDark,
        StatusBadgeTone.neutral => AppColors.gray600,
        StatusBadgeTone.primary => AppColors.primaryDark,
      };
}

/// A pill-shaped status badge with a tone color and optional leading dot.
/// Use for appointment / consultation / prescription / alert status chips.
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    super.key,
    required this.label,
    required this.tone,
    this.showDot = false,
    this.icon,
  });

  final String label;
  final StatusBadgeTone tone;
  final bool showDot;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceSm + 2,
        vertical: DesignTokens.spaceXs + 1,
      ),
      decoration: BoxDecoration(
        color: tone.container,
        borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (showDot) ...[
            Container(
              width: 6,
              height: 6,
              decoration: BoxDecoration(
                color: tone.foreground,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: DesignTokens.spaceXs),
          ] else if (icon != null) ...[
            Icon(icon, size: 12, color: tone.foreground),
            const SizedBox(width: DesignTokens.spaceXs),
          ],
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: tone.foreground,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ],
      ),
    );
  }
}
