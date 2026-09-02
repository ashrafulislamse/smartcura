import '../network/api_error.dart';

/// Run a fetch, converting any thrown object into an [ApiError] that Riverpod's
/// [FutureProvider] surfaces as `AsyncError`. Non-ApiError throwables are
/// wrapped so the UI never sees a raw type it cannot render.
Future<T> guardApi<T>(Future<T> Function() action) async {
  try {
    return await action();
  } catch (e) {
    throw toApiError(e);
  }
}

/// Build a `?key=value` query map skipping null/empty values.
Map<String, dynamic> cleanQuery(Map<String, dynamic?> input) {
  final out = <String, dynamic>{};
  input.forEach((k, v) {
    if (v == null) return;
    if (v is String && v.isEmpty) return;
    if (v is List && v.isEmpty) return;
    out[k] = v;
  });
  return out;
}
