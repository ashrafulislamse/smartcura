import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A semi-transparent overlay with a centered spinner and an optional message.
/// Used during blocking mutations (booking, sign-out, etc.).
class LoadingOverlay extends StatelessWidget {
  final String? message;
  final Color? backgroundColor;

  const LoadingOverlay({
    super.key,
    this.message,
    this.backgroundColor,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      color: backgroundColor ?? AppColors.overlay,
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator(color: AppColors.white),
            if (message != null) ...[
              const SizedBox(height: DesignTokens.spaceMd),
              Text(
                message!,
                style: const TextStyle(color: AppColors.white, fontSize: 14),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
