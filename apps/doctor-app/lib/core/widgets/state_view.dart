import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_error.dart';
import 'error_view.dart';
import 'loading_overlay.dart';

/// The four distinct states a resource screen can be in. Collapsing them is the
/// bug that makes a permission error look like an empty table (the worst
/// outcome), so loading / failed / empty / loaded are always separate.
enum ResourceState { loading, failed, empty, loaded }

/// A widget that switches between loading, error, empty, and content builders
/// based on an [AsyncValue]. This is the canonical wrapper for any screen that
/// reads a FutureProvider — it guarantees the three failure shapes are distinct.
///
/// Pass [isEmpty] to distinguish "loaded but zero rows" from "loaded with rows".
/// [onRetry] is shown only for genuine failures, never for a forbidden error
/// (a 403 gets no retry button, per convention).
class StateView<T> extends StatelessWidget {
  const StateView({
    super.key,
    required this.value,
    required this.data,
    this.isEmpty,
    this.emptyBuilder,
    this.onRetry,
    this.loadingBuilder,
  });

  final AsyncValue<T> value;
  final Widget Function(T data) data;
  final bool Function(T data)? isEmpty;
  final WidgetBuilder? emptyBuilder;
  final VoidCallback? onRetry;
  final WidgetBuilder? loadingBuilder;

  @override
  Widget build(BuildContext context) {
    return value.when(
      data: (d) {
        if (isEmpty != null && isEmpty!(d)) {
          return emptyBuilder?.call(context) ??
              const SizedBox.shrink();
        }
        return data(d);
      },
      loading: () => loadingBuilder?.call(context) ?? const LoadingOverlay(),
      error: (err, _) {
        final apiError = err is ApiError ? err : toApiError(err);
        // A forbidden error gets no retry button — it is not transient.
        final retry = apiError.isForbidden ? null : onRetry;
        return ErrorView(
          message: apiError.displayMessage,
          onRetry: retry,
          isForbidden: apiError.isForbidden,
        );
      },
    );
  }
}
