import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// A premium appointment timeline card for the home screen's
/// horizontal appointment carousel.
///
/// Compact two-row layout: time+mode badge on top, doctor avatar+name below.
/// The entire card is tappable. [isActive] adds a subtle accent border.
class TimelineCard extends StatelessWidget {
  final String time;
  final String status;
  final String title;
  final String subtitle;
  final String? imageUrl;
  final Color accentColor;
  final IconData? icon;
  final bool isActive;
  final VoidCallback? onTap;
  final String? actionLabel;

  const TimelineCard({
    super.key,
    required this.time,
    required this.status,
    required this.title,
    required this.subtitle,
    this.imageUrl,
    this.accentColor = AppColors.primary,
    this.icon,
    this.isActive = false,
    this.onTap,
    this.actionLabel,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$title at $time. Status: $status. $subtitle',
      button: onTap != null,
      enabled: onTap != null,
      child: GestureDetector(
        onTap: onTap != null
            ? () {
                HapticFeedback.lightImpact();
                onTap!();
              }
            : null,
        child: Container(
          width: 280,
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd,
            vertical: DesignTokens.spaceSm + 2,
          ),
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(
              color: isActive
                  ? accentColor.withValues(alpha: 0.35)
                  : AppColors.gray200,
              width: isActive ? 1.5 : 1,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.black.withValues(alpha: 0.04),
                blurRadius: 10,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              // Row 1: time + mode badge
              Row(
                children: [
                  Icon(
                    Icons.schedule_rounded,
                    size: 13,
                    color: accentColor,
                  ),
                  const SizedBox(width: 3),
                  Flexible(
                    child: Text(
                      time,
                      style: TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                        color: accentColor,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 7,
                      vertical: 2,
                    ),
                    decoration: BoxDecoration(
                      color: accentColor.withValues(alpha: 0.10),
                      borderRadius: BorderRadius.circular(
                        DesignTokens.radiusFull,
                      ),
                    ),
                    child: Text(
                      status,
                      style: TextStyle(
                        fontSize: 10,
                        fontWeight: FontWeight.w700,
                        color: accentColor,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              // Row 2: avatar + doctor name + specialty
              Row(
                children: [
                  _buildAvatar(),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 1),
                        Text(
                          subtitle,
                          style: const TextStyle(
                            fontSize: 12,
                            color: AppColors.textSecondary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  if (actionLabel != null)
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 8,
                        vertical: 4,
                      ),
                      decoration: BoxDecoration(
                        color: accentColor,
                        borderRadius: BorderRadius.circular(
                          DesignTokens.radiusSm,
                        ),
                      ),
                      child: Text(
                        actionLabel!,
                        style: const TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          color: AppColors.white,
                        ),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAvatar() {
    if (imageUrl != null && imageUrl!.isNotEmpty) {
      return Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
          image: DecorationImage(
            image: NetworkImage(imageUrl!),
            fit: BoxFit.cover,
          ),
        ),
      );
    }
    if (icon != null) {
      return Container(
        width: 42,
        height: 42,
        decoration: BoxDecoration(
          color: accentColor.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
        ),
        child: Icon(icon, color: accentColor, size: 22),
      );
    }
    final initials = title.trim().split(RegExp(r'\s+'));
    String initialStr = '?';
    if (initials.isNotEmpty && initials[0].isNotEmpty) {
      initialStr = initials.length > 1
          ? (initials[0][0] + initials[1][0]).toUpperCase()
          : initials[0][0].toUpperCase();
    }
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        color: accentColor.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
      ),
      alignment: Alignment.center,
      child: Text(
        initialStr,
        style: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w700,
          color: accentColor,
        ),
      ),
    );
  }
}
