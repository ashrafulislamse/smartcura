import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// Shared brand logo widget used across all auth screens.
///
/// A rounded-gradient container with the health_and_safety icon and a soft
/// shadow. Consistent across splash, login, signup, forgot-password.
class BrandLogo extends StatelessWidget {
  final double size;
  final double iconSize;
  final Gradient? gradient;

  const BrandLogo({
    super.key,
    this.size = 72,
    this.iconSize = 36,
    this.gradient,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: size,
      width: size,
      decoration: BoxDecoration(
        gradient: gradient ?? AppColors.primaryGradient,
        borderRadius: BorderRadius.circular(size * 0.22),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withOpacity(0.3),
            blurRadius: 16,
            offset: Offset(0, 6),
          ),
        ],
      ),
      child: Icon(
        Icons.health_and_safety_rounded,
        color: Colors.white,
        size: iconSize,
      ),
    );
  }
}

/// Shared decorative background bubbles used behind auth screens.
/// Positioned absolutely behind the scrollable content.
class AuthBackgroundDecor extends StatelessWidget {
  const AuthBackgroundDecor({super.key});

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Positioned(
          top: -100,
          right: -100,
          child: Container(
            width: 300,
            height: 300,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.primary.withOpacity(0.05),
            ),
          ),
        ),
        Positioned(
          top: 150,
          left: -80,
          child: Container(
            width: 200,
            height: 200,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.secondary.withOpacity(0.05),
            ),
          ),
        ),
      ],
    );
  }
}

/// Inline error banner — consistent across all auth forms.
class AuthErrorBanner extends StatelessWidget {
  final String message;

  const AuthErrorBanner({super.key, required this.message});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceMd,
        vertical: DesignTokens.spaceSm,
      ),
      decoration: BoxDecoration(
        color: AppColors.errorContainer,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.error.withOpacity(0.2)),
      ),
      child: Row(
        children: [
          const Icon(Icons.error_outline, color: AppColors.errorDark, size: 20),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Text(
              message,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: AppColors.errorDark,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Firebase not-configured warning card.
class FirebaseNotConfiguredCard extends StatelessWidget {
  final String feature;

  const FirebaseNotConfiguredCard({
    super.key,
    this.feature = 'Authentication',
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.errorContainer,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.error.withOpacity(0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(
            Icons.cloud_off_rounded,
            color: AppColors.errorDark,
            size: DesignTokens.iconMd,
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Firebase Not Configured',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppColors.errorDark,
                      ),
                ),
                const SizedBox(height: DesignTokens.spaceXs),
                Text(
                  'Contact your administrator to set up Firebase '
                  '$feature. The app cannot use this feature without it.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.errorDark,
                        height: 1.5,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
