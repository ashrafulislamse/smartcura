import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../theme/app_colors.dart';
import '../../theme/design_tokens.dart';

/// Primary Button Widget
/// Reusable button component following the design system.
/// WCAG 2.1 AA compliant with haptic feedback and semantic labels.
class PrimaryButton extends StatelessWidget {
  final String text;
  final VoidCallback? onPressed;
  final bool isLoading;
  final IconData? icon;
  final double? height;
  final double? width;
  final Color? backgroundColor;
  final Color? textColor;
  final String? semanticLabel;

  const PrimaryButton({
    super.key,
    required this.text,
    this.onPressed,
    this.isLoading = false,
    this.icon,
    this.height,
    this.width,
    this.backgroundColor,
    this.textColor,
    this.semanticLabel,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      enabled: !isLoading && onPressed != null,
      label: semanticLabel ?? text,
      child: MouseRegion(
        cursor: onPressed != null && !isLoading
            ? SystemMouseCursors.click
            : SystemMouseCursors.basic,
        child: SizedBox(
          height: height ?? DesignTokens.buttonHeightMd,
          width: width,
          child: ElevatedButton(
            onPressed: isLoading
                ? null
                : onPressed != null
                    ? () {
                        HapticFeedback.lightImpact();
                        onPressed!();
                      }
                    : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: backgroundColor ?? AppColors.primary,
              foregroundColor: textColor ?? Colors.white,
              disabledBackgroundColor:
                  AppColors.primary.withValues(alpha: 0.5),
              elevation: DesignTokens.elevationMd,
              shadowColor: AppColors.primary.withValues(alpha: 0.3),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceMd,
                vertical: DesignTokens.spaceSm,
              ),
            ),
            child: isLoading
                ? SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(
                        textColor ?? Colors.white,
                      ),
                    ),
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      if (icon != null) ...[
                        Icon(icon, size: DesignTokens.iconSm),
                        const SizedBox(width: DesignTokens.spaceSm),
                      ],
                      Text(
                        text,
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                          color: textColor ?? Colors.white,
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
