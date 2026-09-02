import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A premium-styled card with a white surface, rounded corners, subtle border,
/// and a soft shadow. Optionally renders a coloured accent strip on the left
/// edge (like the web portal's accent cards).
class PremiumCard extends StatelessWidget {
  final Widget child;
  final EdgeInsets padding;
  final EdgeInsets margin;
  final VoidCallback? onTap;
  final Color? accentColor;
  final double accentWidth;
  final double borderRadius;

  const PremiumCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(DesignTokens.spaceMd),
    this.margin = const EdgeInsets.symmetric(
      horizontal: DesignTokens.screenPaddingHorizontal,
      vertical: DesignTokens.spaceSm,
    ),
    this.onTap,
    this.accentColor,
    this.accentWidth = 4.0,
    this.borderRadius = DesignTokens.radiusLg,
  });

  @override
  Widget build(BuildContext context) {
    final card = Container(
      margin: margin,
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(borderRadius),
        border: Border.all(color: AppColors.gray200),
        boxShadow: const [
          BoxShadow(
            color: AppColors.shadow,
            blurRadius: 8,
            offset: Offset(0, 2),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(borderRadius),
        child: accentColor != null
            ? IntrinsicHeight(
                child: Row(
                  children: [
                    Container(width: accentWidth, color: accentColor),
                    Expanded(child: Padding(padding: padding, child: child)),
                  ],
                ),
              )
            : Padding(padding: padding, child: child),
      ),
    );

    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(borderRadius),
        child: card,
      );
    }
    return card;
  }
}
