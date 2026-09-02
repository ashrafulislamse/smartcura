import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A centered spinner for loading states. Intentionally minimal — it never
/// blocks interaction with a translucent scrim unless wrapped by a dialog.
class LoadingOverlay extends StatelessWidget {
  const LoadingOverlay({super.key, this.label});

  final String? label;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const SizedBox(
            width: 32,
            height: 32,
            child: CircularProgressIndicator(
              strokeWidth: 3,
              color: AppColors.primary,
            ),
          ),
          if (label != null) ...[
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              label!,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.gray500,
                  ),
            ),
          ],
        ],
      ),
    );
  }
}
