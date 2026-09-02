import 'package:flutter/material.dart';
import '../../theme/app_colors.dart';
import '../../theme/design_tokens.dart';

/// Custom Text Field Widget
/// Reusable input field component following the design system. Covers five
/// border states: default, enabled, focused, error, focused-error, disabled.
class CustomTextField extends StatelessWidget {
  final String? label;
  final String? hint;
  final TextEditingController? controller;
  final TextInputType? keyboardType;
  final IconData? prefixIcon;
  final Widget? suffixIcon;
  final String? Function(String?)? validator;
  final bool obscureText;
  final int? maxLines;
  final bool enabled;
  final VoidCallback? onTap;
  final Function(String)? onChanged;

  const CustomTextField({
    super.key,
    this.label,
    this.hint,
    this.controller,
    this.keyboardType,
    this.prefixIcon,
    this.suffixIcon,
    this.validator,
    this.obscureText = false,
    this.maxLines = 1,
    this.enabled = true,
    this.onTap,
    this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (label != null) ...[
          Text(
            label!,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                  color: AppColors.textPrimary,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
        ],
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          obscureText: obscureText,
          maxLines: maxLines,
          enabled: enabled,
          onTap: onTap,
          onChanged: onChanged,
          validator: validator,
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: AppColors.textPrimary,
              ),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: TextStyle(
              color: AppColors.textSecondary.withValues(alpha: 0.6),
            ),
            prefixIcon: prefixIcon != null
                ? Icon(
                    prefixIcon,
                    color: AppColors.textSecondary,
                    size: DesignTokens.iconSm,
                  )
                : null,
            suffixIcon: suffixIcon,
            filled: true,
            fillColor: Colors.white,
            contentPadding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceMd,
              vertical: DesignTokens.spaceMd,
            ),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              borderSide: const BorderSide(
                color: AppColors.border,
                width: DesignTokens.borderWidthThin,
              ),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              borderSide: const BorderSide(
                color: AppColors.border,
                width: DesignTokens.borderWidthThin,
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              borderSide: const BorderSide(
                color: AppColors.primary,
                width: DesignTokens.borderWidthMedium,
              ),
            ),
            errorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              borderSide: const BorderSide(
                color: AppColors.error,
                width: DesignTokens.borderWidthThin,
              ),
            ),
            focusedErrorBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              borderSide: const BorderSide(
                color: AppColors.error,
                width: DesignTokens.borderWidthMedium,
              ),
            ),
            disabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              borderSide: BorderSide(
                color: AppColors.border.withValues(alpha: 0.5),
                width: DesignTokens.borderWidthThin,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
