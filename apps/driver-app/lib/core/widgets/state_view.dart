import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// The four states a resource-bound widget can be in.
///
/// Mirrors the web portal's `ResourceState` convention: loading, error, empty,
/// and loaded are distinct states. Collapsing them makes a permission error
/// look like an empty table, which is the worst outcome — see AGENTS.md.
enum ResourceState { loading, error, empty, loaded }

/// A widget that renders different content based on its resource state.
///
/// Use this to wrap any screen section that depends on an async provider so
/// the loading / error / empty / loaded states are handled consistently.
/// A forbidden error (403) gets no retry button — the user cannot fix it by
/// retrying, so offering one is misleading.
class StateView<T> extends StatelessWidget {
  final bool isLoading;
  final Object? error;
  final bool isEmpty;
  final T? data;
  final Widget Function(T data) builder;
  final VoidCallback? onRetry;
  final String? emptyTitle;
  final String? emptyBody;
  final IconData emptyIcon;

  const StateView({
    super.key,
    required this.builder,
    this.isLoading = false,
    this.error,
    this.isEmpty = false,
    this.data,
    this.onRetry,
    this.emptyTitle,
    this.emptyBody,
    this.emptyIcon = Icons.inbox_outlined,
  });

  @override
  Widget build(BuildContext context) {
    if (isLoading) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(DesignTokens.spaceXl),
          child: CircularProgressIndicator(color: AppColors.primary),
        ),
      );
    }

    if (error != null) {
      return ErrorView(
        message: _errorMessage(error),
        onRetry: _isRetryable(error) ? onRetry : null,
      );
    }

    if (isEmpty || data == null) {
      return EmptyView(
        title: emptyTitle ?? 'Nothing here yet',
        body: emptyBody,
        icon: emptyIcon,
      );
    }

    return builder(data as T);
  }

  String _errorMessage(Object? error) {
    if (error == null) return 'Something went wrong';
    // ApiError has a userMessage getter; avoid a hard import cycle by duck-typing.
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return error.toString();
  }

  bool _isRetryable(Object? error) {
    if (error == null) return false;
    try {
      final isForbidden = (error as dynamic).isForbidden;
      if (isForbidden is bool && isForbidden) return false;
    } catch (_) {}
    return true;
  }
}

/// A standalone error view: icon + title + message + optional retry button.
class ErrorView extends StatelessWidget {
  final String title;
  final String message;
  final VoidCallback? onRetry;
  final IconData icon;

  const ErrorView({
    super.key,
    required this.message,
    this.title = 'Something went wrong',
    this.onRetry,
    this.icon = Icons.error_outline,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        physics: const NeverScrollableScrollPhysics(),
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: DesignTokens.iconLg, color: AppColors.error),
              const SizedBox(height: DesignTokens.spaceSm),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                  fontFamily: 'Manrope',
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: DesignTokens.spaceXs),
              Text(
                message,
                textAlign: TextAlign.center,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                  fontFamily: 'Manrope',
                ),
              ),
              if (onRetry != null) ...[
                const SizedBox(height: DesignTokens.spaceMd),
                FilledButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh, size: 18),
                  label: const Text(
                    'Retry',
                    style: TextStyle(fontFamily: 'Manrope'),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

/// A standalone empty-state view: icon or SVG illustration + title + optional body.
class EmptyView extends StatelessWidget {
  final String title;
  final String? body;
  final IconData icon;

  /// Optional brand-aligned SVG illustration (e.g. `assets/illustrations/empty_offers.svg`).
  /// When provided, it replaces the large icon above the title.
  final String? illustrationAsset;

  const EmptyView({
    super.key,
    required this.title,
    this.body,
    this.icon = Icons.inbox_outlined,
    this.illustrationAsset,
  });

  @override
  Widget build(BuildContext context) {
    return Center(
      child: SingleChildScrollView(
        physics: const NeverScrollableScrollPhysics(),
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (illustrationAsset != null)
                SvgPicture.asset(
                  illustrationAsset!,
                  width: 120,
                  height: 120,
                )
              else
                Icon(icon, size: DesignTokens.iconLg, color: AppColors.gray300),
              const SizedBox(height: DesignTokens.spaceSm),
              Text(
                title,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                  fontFamily: 'Manrope',
                ),
                textAlign: TextAlign.center,
              ),
              if (body != null) ...[
                const SizedBox(height: DesignTokens.spaceXs),
                Text(
                  body!,
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                    fontFamily: 'Manrope',
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
