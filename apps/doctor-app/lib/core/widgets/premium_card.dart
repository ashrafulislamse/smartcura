import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A premium card: white background, rounded-16, 1px border, subtle shadow,
/// and an optional left accent stripe in a tone color. Flat-by-default matches
/// the existing card theme but adds the accent and a tighter internal padding
/// control for content that should not touch the border.
class PremiumCard extends StatelessWidget {
  const PremiumCard({
    super.key,
    required this.child,
    this.accent,
    this.padding,
    this.onTap,
    this.title,
    this.trailing,
  });

  final Widget child;
  final Color? accent;
  final EdgeInsets? padding;
  final VoidCallback? onTap;
  final String? title;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.white,
      borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        child: Container(
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(color: AppColors.gray200, width: 1),
            boxShadow: const [
              BoxShadow(
                color: AppColors.shadowLight,
                blurRadius: 8,
                offset: Offset(0, 2),
              ),
            ],
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (accent != null)
                  Container(width: 4, color: accent),
                Expanded(
                  child: Padding(
                    padding: padding ??
                        const EdgeInsets.all(DesignTokens.spaceMd),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        if (title != null || trailing != null)
                          Padding(
                            padding: const EdgeInsets.only(
                                bottom: DesignTokens.spaceSm),
                            child: Row(
                              children: [
                                if (title != null)
                                  Expanded(
                                    child: Text(
                                      title!,
                                      style: Theme.of(context)
                                          .textTheme
                                          .titleSmall
                                          ?.copyWith(
                                            fontWeight: FontWeight.w600,
                                          ),
                                    ),
                                  ),
                                if (trailing != null) trailing!,
                              ],
                            ),
                          ),
                        child,
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
