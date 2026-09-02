import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A full-state empty view: illustration or icon + title + body + optional
/// action. Distinct from [ErrorView] so an empty list never reads as a failure.
///
/// When [illustrationAsset] is provided, an SVG illustration is shown instead of
/// the generic icon. Existing callers that only supply an icon keep working.
class EmptyView extends StatelessWidget {
  const EmptyView({
    super.key,
    required this.title,
    this.body,
    this.icon = Icons.inbox_outlined,
    this.illustrationAsset,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String? body;
  final IconData icon;
  final String? illustrationAsset;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (illustrationAsset != null)
              SvgPicture.asset(
                illustrationAsset!,
                width: 120,
                height: 120,
                fit: BoxFit.contain,
              )
            else
              Icon(icon, size: DesignTokens.icon2xl, color: AppColors.gray300),
            const SizedBox(height: DesignTokens.spaceMd),
            Text(
              title,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    color: AppColors.gray700,
                  ),
            ),
            if (body != null) ...[
              const SizedBox(height: DesignTokens.spaceXs),
              Text(
                body!,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppColors.gray500,
                    ),
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: DesignTokens.spaceLg),
              OutlinedButton(
                onPressed: onAction,
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
