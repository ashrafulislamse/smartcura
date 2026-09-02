import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A full-state error view with an icon, message, and optional retry button.
///
/// A forbidden (403) error intentionally shows no retry button — retrying a
/// permission refusal is never useful and signals the wrong thing to the user.
class ErrorView extends StatelessWidget {
  const ErrorView({
    super.key,
    required this.message,
    this.onRetry,
    this.isForbidden = false,
    this.icon,
  });

  final String message;
  final VoidCallback? onRetry;
  final bool isForbidden;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final showRetry = onRetry != null && !isForbidden;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon ??
                  (isForbidden
                      ? Icons.lock_outline
                      : Icons.error_outline_rounded),
              size: DesignTokens.icon2xl,
              color: isForbidden ? AppColors.warning : AppColors.error,
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            Text(
              message,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.gray600,
                  ),
            ),
            if (showRetry) ...[
              const SizedBox(height: DesignTokens.spaceLg),
              FilledButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
