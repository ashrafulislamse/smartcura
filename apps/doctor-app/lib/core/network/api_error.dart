import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

/// A parsed API error derived from the backend's RFC 9457 `application/problem+json`
/// response body, or from a transport-level failure.
///
/// The backend always returns errors as ProblemDetails with a `code` drawn from the
/// `ProblemCode` enum, a numeric `status`, a human-readable `title` and optional
/// `detail`, plus a `correlationId` for support. Field-level validation failures
/// carry an `errors` array of [FieldViolation].
class ApiError implements Exception {
  const ApiError({
    required this.status,
    this.code,
    this.title,
    this.detail,
    this.correlationId,
    this.errors,
    this.original,
  });

  /// HTTP status code (0 for transport errors with no response).
  final int status;

  /// Stable machine code from [ProblemCode], or `null` when the body could not be
  /// parsed as ProblemDetails (e.g. a 5xx HTML page from an upstream proxy).
  final ProblemCode? code;

  /// Short human-readable summary from `title`.
  final String? title;

  /// Longer human-readable explanation from `detail`, if present.
  final String? detail;

  /// Correlation id for support traceability, if present.
  final String? correlationId;

  /// Field-level validation violations, if the error was a 422 `VALIDATION_FAILED`.
  final List<FieldViolation>? errors;

  /// The original [DioException], retained for debugging and stack traces.
  final DioException? original;

  /// Convenience getters keyed on the HTTP status code.
  bool get isUnauthenticated => status == 401;
  bool get isForbidden => status == 403;
  bool get isConflict => status == 409;
  bool get isNotFound => status == 404;
  bool get isRateLimited => status == 429;
  bool get isClientError => status >= 400 && status < 500;
  bool get isServer => status >= 500;

  /// True when the backend refused the request because the session was invalid.
  /// Used by the error interceptor to decide whether to clear local credentials.
  bool get isSessionInvalid =>
      code == ProblemCode.authTokenInvalid ||
      code == ProblemCode.appSessionInvalid ||
      isUnauthenticated;

  /// True when a step-up (re-authentication) is required for the mutation.
  bool get isStepUpRequired => code == ProblemCode.stepUpRequired;

  /// True when the request needs break-glass authorisation.
  bool get isBreakGlassRequired => code == ProblemCode.breakGlassRequired;

  /// A single human-readable message suitable for a snack-bar or error view.
  String get displayMessage {
    if (detail != null && detail!.isNotEmpty) return detail!;
    if (title != null && title!.isNotEmpty) return title!;
    switch (status) {
      case 0:
        return 'No network connection. Please check your connectivity and try again.';
      case 400:
        return 'The request was malformed.';
      case 401:
        return 'Your session has expired. Please sign in again.';
      case 403:
        return 'You do not have permission to perform this action.';
      case 404:
        return 'The requested resource was not found.';
      case 409:
        return 'This record was modified by another session. Refresh and try again.';
      case 422:
        return 'Some fields need your attention.';
      case 429:
        return 'Too many requests. Please slow down and try again shortly.';
      case 500:
      case 502:
      case 503:
      case 504:
        return 'The server is temporarily unavailable. Please try again shortly.';
      default:
        return 'Something went wrong (HTTP $status).';
    }
  }

  /// Joined field-violation messages for validation errors, or empty string.
  String get validationSummary {
    if (errors == null || errors!.isEmpty) return '';
    return errors!.map((v) => '${v.field}: ${v.message}').join('\n');
  }

  @override
  String toString() {
    final parts = <String>[
      'ApiError($status',
      if (code != null) ' code=${code!.wireValue}',
      if (title != null) ' title=$title',
      if (correlationId != null) ' correlationId=$correlationId',
      ')',
    ];
    return parts.join();
  }

  /// Parse a [DioException] into an [ApiError]. Falls back to a transport error
  /// when the response body is missing or not ProblemDetails-shaped.
  factory ApiError.fromDio(DioException e) {
    final response = e.response;
    if (response == null) {
      // Transport-level failure (timeout, connection, cancellation).
      String title;
      switch (e.type) {
        case DioExceptionType.connectionTimeout:
        case DioExceptionType.sendTimeout:
        case DioExceptionType.receiveTimeout:
          title = 'The request timed out.';
          break;
        case DioExceptionType.connectionError:
          title = 'Could not connect to the server.';
          break;
        case DioExceptionType.cancel:
          title = 'The request was cancelled.';
          break;
        case DioExceptionType.badCertificate:
          title = 'The server certificate could not be verified.';
          break;
        case DioExceptionType.badResponse:
        case DioExceptionType.unknown:
          title = 'An unexpected network error occurred.';
          break;
        case DioExceptionType.transformTimeout:
          title = 'The response could not be processed in time.';
          break;
      }
      return ApiError(
        status: 0,
        title: title,
        detail: e.message,
        original: e,
      );
    }

    final status = response.statusCode ?? 0;
    final data = response.data;
    Map<String, dynamic>? body;
    if (data is String) {
      try {
        final decoded = jsonDecode(data);
        if (decoded is Map<String, dynamic>) body = decoded;
      } catch (_) {
        // Not JSON; leave body null.
      }
    } else if (data is Map<String, dynamic>) {
      body = data;
    }

    if (body == null) {
      return ApiError(
        status: status,
        title: _defaultTitleFor(status),
        original: e,
      );
    }

    return ApiError(
      status: body['status'] as int? ?? status,
      code: _parseCode(body['code']),
      title: body['title'] as String?,
      detail: body['detail'] as String?,
      correlationId: body['correlation_id'] as String?,
      errors: _parseErrors(body['errors']),
      original: e,
    );
  }

  static ProblemCode? _parseCode(Object? raw) {
    if (raw is! String || raw.isEmpty) return null;
    try {
      return problemCodeFromWire(raw);
    } catch (_) {
      return null;
    }
  }

  static List<FieldViolation>? _parseErrors(Object? raw) {
    if (raw is! List) return null;
    final out = <FieldViolation>[];
    for (final item in raw) {
      if (item is Map<String, dynamic>) {
        out.add(FieldViolation(
          field: item['field'] as String? ?? '',
          code: item['code'] as String? ?? '',
          message: item['message'] as String? ?? '',
        ));
      }
    }
    return out.isEmpty ? null : out;
  }

  static String _defaultTitleFor(int status) {
    switch (status) {
      case 400:
        return 'Bad Request';
      case 401:
        return 'Unauthorized';
      case 403:
        return 'Forbidden';
      case 404:
        return 'Not Found';
      case 409:
        return 'Conflict';
      case 422:
        return 'Validation Failed';
      case 429:
        return 'Too Many Requests';
      case 500:
        return 'Internal Server Error';
      case 502:
        return 'Bad Gateway';
      case 503:
        return 'Service Unavailable';
      case 504:
        return 'Gateway Timeout';
      default:
        return 'Error';
    }
  }
}

/// Thrown when a provider is asked to do something that requires Firebase Auth,
/// but Firebase is not configured on this device (no google-services.json /
/// GoogleService-Info.plist).
class FirebaseNotConfiguredError extends ApiError {
  FirebaseNotConfiguredError()
      : super(
          status: 0,
          title: 'Firebase is not configured',
          detail: 'Authentication is unavailable on this device. '
              'Contact your administrator to configure Firebase.',
        );
}

/// Converts a thrown object into an [ApiError]. Anything that is already an
/// [ApiError] is returned as-is; a raw [DioException] is parsed; anything else
/// is wrapped in a generic transport error.
ApiError toApiError(Object error, [StackTrace? stack]) {
  if (error is ApiError) return error;
  if (error is DioException) return ApiError.fromDio(error);
  debugPrint('Unhandled error in API layer: $error\n$stack');
  return ApiError(
    status: 0,
    title: 'Unexpected error',
    detail: error.toString(),
  );
}
