import 'package:smartcura_contracts/smartcura_contracts.dart';

/// Carries the backend `application/problem+json` body so a screen can react to
/// the problem code, not just the HTTP status text.
///
/// Mirrors the web portal's `ApiError` (see `apps/web-portal/src/lib/api/client.ts`).
/// The backend always answers a failed request with a Problem Details object whose
/// fields are: `type`, `title`, `status`, `detail`, `instance`, `code`,
/// `correlation_id`, and optional `errors` (field violations).
class ApiError implements Exception {
  final int status;
  final String code;
  final String title;
  final String? detail;
  final String? correlationId;

  /// Field-level validation violations, present when `code` is `VALIDATION_FAILED`.
  final List<FieldViolation>? errors;

  const ApiError({
    required this.status,
    required this.code,
    required this.title,
    this.detail,
    this.correlationId,
    this.errors,
  });

  /// Build an [ApiError] from a decoded `application/problem+json` body.
  factory ApiError.fromProblemJson(Map<String, dynamic> json) {
    final rawErrors = json['errors'];
    List<FieldViolation>? violations;
    if (rawErrors is List) {
      violations = rawErrors
          .whereType<Map<String, dynamic>>()
          .map((e) => FieldViolation(
                field: e['field'] as String? ?? '',
                code: e['code'] as String? ?? '',
                message: e['message'] as String? ?? '',
              ))
          .toList();
    }
    return ApiError(
      status: (json['status'] as num?)?.toInt() ?? 0,
      code: json['code'] as String? ?? 'UNKNOWN',
      title: json['title'] as String? ?? 'Request failed',
      detail: json['detail'] as String?,
      correlationId: json['correlation_id'] as String?,
      errors: violations,
    );
  }

  /// A non-HTTP failure (network down, timeout, cancelled).
  factory ApiError.network(String message) => ApiError(
        status: 0,
        code: 'NETWORK_ERROR',
        title: 'Cannot reach the SmartCura API',
        detail: message,
      );

  /// A response that was not valid problem+json and had no usable body.
  factory ApiError.unexpected(int status, String? correlationId) => ApiError(
        status: status,
        code: 'CLIENT_ERROR',
        title: 'Request failed with status $status',
        correlationId: correlationId,
      );

  bool get isUnauthenticated => status == 401;
  bool get isForbidden => status == 403;
  bool get isConflict => status == 409;
  bool get isNotFound => status == 404;
  bool get isRateLimited => status == 429;
  bool get isServer => status >= 500;
  bool get isNetwork => status == 0;

  /// True when a recent step-up (MFA re-authentication) is required.
  /// Distinguished from an ordinary 403 because the remedy is different.
  bool get needsStepUp => status == 403 && code == 'STEP_UP_REQUIRED';

  /// True when an optimistic write lost to a concurrent one — re-read before retrying.
  bool get isVersionConflict =>
      status == 409 && code.contains('VERSION_CONFLICT');

  /// The primary message to show the user.
  String get userMessage => detail?.isNotEmpty == true ? detail! : title;

  @override
  String toString() => 'ApiError($status $code): $title${detail != null ? ' — $detail' : ''}';
}
