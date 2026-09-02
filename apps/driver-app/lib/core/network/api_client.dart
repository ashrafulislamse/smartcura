import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:uuid/uuid.dart';

import '../constants/app_constants.dart';
import 'api_error.dart';
import 'session_storage.dart';

export 'api_error.dart';
export 'api_endpoints.dart';
export 'session_storage.dart';

/// Riverpod provider for the secure session store. Singleton across the app.
final sessionStorageProvider = Provider<SessionStorage>((ref) {
  return SessionStorage();
});

/// A callback invoked once when the API client detects that the session has
/// expired (HTTP 401). The auth notifier registers itself here so it can flip
/// [AuthState] to unauthenticated and trigger the router redirect, without the
/// API client taking a hard dependency on the auth layer (which would be
/// circular, since auth depends on the API client).
typedef SessionExpiredCallback = void Function();

/// The core HTTP client for the SmartCura backend.
///
/// Wraps [Dio] with five interceptors that implement the session contract:
///
/// 1. **Session cookie** — reads the stored `__Host-smartcura_session` value
///    and replays it as a `Cookie` header on every request.
/// 2. **CSRF** — attaches `X-CSRF-Token` to every state-changing method
///    (POST/PUT/PATCH/DELETE).
/// 3. **Idempotency** — attaches a fresh `Idempotency-Key` UUID to every POST
///    and PUT so a retried request is de-duplicated server-side.
/// 4. **Response** — extracts a refreshed `csrf_token` from any 2xx response
///    body and persists it, so token rotation is transparent.
/// 5. **Error** — parses `application/problem+json` into [ApiError] and, on a
///    401, clears the stored session and fires [onSessionExpired].
///
/// A debug-only logging interceptor is added when `kDebugMode` is true.
class ApiClient {
  ApiClient({required this.sessionStorage, SessionExpiredCallback? onSessionExpired})
      : _onSessionExpired = onSessionExpired {
    _dio = Dio(BaseOptions(
      baseUrl: AppConstants.apiBaseUrl,
      connectTimeout: AppConstants.connectionTimeout,
      receiveTimeout: AppConstants.receiveTimeout,
      sendTimeout: AppConstants.sendTimeout,
      responseType: ResponseType.json,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    ));

    _dio.interceptors.addAll([
      _SessionCookieInterceptor(sessionStorage),
      _CsrfInterceptor(sessionStorage),
      _IdempotencyInterceptor(_uuid),
      _ResponseInterceptor(sessionStorage, this),
      _ErrorInterceptor(sessionStorage, this),
      if (kDebugMode) _DebugLogInterceptor(),
    ]);
  }

  final SessionStorage sessionStorage;
  final Uuid _uuid = const Uuid();

  /// Set by the auth notifier so a 401 can flip the app to the login screen.
  SessionExpiredCallback? _onSessionExpired;

  late final Dio _dio;

  /// Exposed for advanced consumers that need the raw [Dio] (e.g. file uploads
  /// with progress). Prefer the typed helpers below for normal traffic.
  Dio get dio => _dio;

  /// Register the callback fired when a 401 clears the session. Idempotent.
  void onSessionExpired(SessionExpiredCallback callback) {
    _onSessionExpired = callback;
  }

  /// Fire the registered callback (if any). Called by the error interceptor.
  void notifySessionExpired() {
    _onSessionExpired?.call();
  }

  // ---- Typed helpers -----------------------------------------------------

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    final response = await _dio.get(
      path,
      queryParameters: queryParameters,
      options: options,
    );
    return response.data is Map<String, dynamic>
        ? response.data as Map<String, dynamic>
        : <String, dynamic>{'data': response.data};
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Object? body,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    final response = await _dio.post(
      path,
      data: body,
      queryParameters: queryParameters,
      options: options,
    );
    return response.data is Map<String, dynamic>
        ? response.data as Map<String, dynamic>
        : <String, dynamic>{'data': response.data};
  }

  Future<Map<String, dynamic>> put(
    String path, {
    Object? body,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    final response = await _dio.put(
      path,
      data: body,
      queryParameters: queryParameters,
      options: options,
    );
    return response.data is Map<String, dynamic>
        ? response.data as Map<String, dynamic>
        : <String, dynamic>{'data': response.data};
  }

  Future<Map<String, dynamic>> patch(
    String path, {
    Object? body,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    final response = await _dio.patch(
      path,
      data: body,
      queryParameters: queryParameters,
      options: options,
    );
    return response.data is Map<String, dynamic>
        ? response.data as Map<String, dynamic>
        : <String, dynamic>{'data': response.data};
  }

  Future<void> delete(
    String path, {
    Object? body,
    Map<String, dynamic>? queryParameters,
    Options? options,
  }) async {
    await _dio.delete(
      path,
      data: body,
      queryParameters: queryParameters,
      options: options,
    );
  }

  /// Build a one-off [Dio] call carrying the Firebase id token as a Bearer
  /// header, used only for `POST /sessions` (which mints the session cookie).
  /// The session interceptors are intentionally bypassed because there is no
  /// session yet. Returns the decoded body AND the raw `Set-Cookie` header so
  /// the auth service can persist the HttpOnly session cookie value itself.
  Future<({Map<String, dynamic> body, String? setCookie})>
      postWithBearerToken(
    String path, {
    required String bearerToken,
    Object? body,
  }) async {
    try {
      final response = await _dio.post(
        path,
        data: body,
        options: Options(
          headers: {
            'Authorization': 'Bearer $bearerToken',
            'Accept': 'application/json',
            'Content-Type': 'application/json',
          },
          // Do not send the session cookie for the session-minting call.
          extra: {'skipSessionCookie': true, 'skipCsrf': true},
        ),
      );
      final decoded = response.data is Map<String, dynamic>
          ? response.data as Map<String, dynamic>
          : <String, dynamic>{'data': response.data};
      // Dio folds multiple Set-Cookie headers into one comma-joined string.
      final setCookie = response.headers.value('set-cookie');
      return (body: decoded, setCookie: setCookie);
    } on DioException catch (e) {
      throw ApiError.fromDio(e);
    }
  }

  /// Extract the `__Host-smartcura_session` value from a folded `Set-Cookie`
  /// header string. Returns an empty string when the cookie is absent.
  static String extractHostSessionCookie(String? setCookieHeader) {
    if (setCookieHeader == null || setCookieHeader.isEmpty) return '';
    // Dio joins multiple Set-Cookie headers with ", ". A cookie attribute like
    // `Expires=Wed, 09 Aug 2026...` also contains a comma, so we scan for the
    // segment starting with our cookie name rather than splitting naively.
    final token = '__Host-smartcura_session=';
    final start = setCookieHeader.indexOf(token);
    if (start == -1) return '';
    final valueStart = start + token.length;
    // The value ends at the next ';' or at the end of the segment.
    var valueEnd = setCookieHeader.indexOf(';', valueStart);
    if (valueEnd == -1) {
      // Fall back to the next ", " boundary (start of another cookie).
      valueEnd = setCookieHeader.indexOf(', ', valueStart);
    }
    if (valueEnd == -1) valueEnd = setCookieHeader.length;
    return setCookieHeader.substring(valueStart, valueEnd).trim();
  }
}

/// Riverpod provider for the singleton [ApiClient].
final apiClientProvider = Provider<ApiClient>((ref) {
  final storage = ref.watch(sessionStorageProvider);
  return ApiClient(sessionStorage: storage);
});

// ===========================================================================
// Interceptors
// ===========================================================================

const _kMutationMethods = {'POST', 'PUT', 'PATCH', 'DELETE'};
const _kIdempotentMethods = {'POST', 'PUT'};

class _SessionCookieInterceptor extends Interceptor {
  _SessionCookieInterceptor(this.storage);
  final SessionStorage storage;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    if (options.extra['skipSessionCookie'] == true) {
      handler.next(options);
      return;
    }
    // Chain the async read with a continuation.
    _attachCookie(options).then((_) => handler.next(options));
  }

  Future<void> _attachCookie(RequestOptions options) async {
    final cookie = await storage.getSessionCookie();
    if (cookie != null && cookie.isNotEmpty) {
      final existing = options.headers['Cookie'] as String? ?? '';
      final merged = existing.isEmpty
          ? '__Host-smartcura_session=$cookie'
          : '$existing; __Host-smartcura_session=$cookie';
      options.headers['Cookie'] = merged;
    }
  }
}

class _CsrfInterceptor extends Interceptor {
  _CsrfInterceptor(this.storage);
  final SessionStorage storage;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final method = options.method.toUpperCase();
    if (!_kMutationMethods.contains(method) ||
        options.extra['skipCsrf'] == true) {
      handler.next(options);
      return;
    }
    _attachCsrf(options).then((_) => handler.next(options));
  }

  Future<void> _attachCsrf(RequestOptions options) async {
    final csrf = await storage.getCsrfToken();
    if (csrf != null && csrf.isNotEmpty) {
      options.headers['X-CSRF-Token'] = csrf;
    }
  }
}

class _IdempotencyInterceptor extends Interceptor {
  _IdempotencyInterceptor(this.uuid);
  final Uuid uuid;

  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final method = options.method.toUpperCase();
    if (_kIdempotentMethods.contains(method) &&
        options.headers['Idempotency-Key'] == null) {
      options.headers['Idempotency-Key'] = uuid.v4();
    }
    handler.next(options);
  }
}

class _ResponseInterceptor extends Interceptor {
  _ResponseInterceptor(this.storage, this.client);
  final SessionStorage storage;
  final ApiClient client;

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    // Persist a rotated CSRF token if the backend included one in the body.
    final data = response.data;
    if (data is Map<String, dynamic>) {
      final csrf = data['csrf_token'];
      if (csrf is String && csrf.isNotEmpty) {
        storage.setCsrfToken(csrf);
      }
    }
    handler.next(response);
  }
}

class _ErrorInterceptor extends Interceptor {
  _ErrorInterceptor(this.storage, this.client);
  final SessionStorage storage;
  final ApiClient client;

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final apiError = ApiError.fromDio(err);

    // On a 401 / invalid session, wipe local credentials and notify the auth
    // layer so it can redirect to /login.
    if (apiError.isSessionInvalid) {
      storage.clear().then((_) => client.notifySessionExpired());
    }

    handler.next(
      DioException(
        requestOptions: err.requestOptions,
        response: err.response,
        type: err.type,
        error: apiError,
        stackTrace: err.stackTrace,
        message: apiError.displayMessage,
      ),
    );
  }
}

class _DebugLogInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    debugPrint('→ ${options.method} ${options.path}');
    handler.next(options);
  }

  @override
  void onResponse(Response<dynamic> response, ResponseInterceptorHandler handler) {
    debugPrint('← ${response.statusCode} ${response.requestOptions.path}');
    handler.next(response);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) {
    final code = err.response?.statusCode;
    debugPrint('✕ $code ${err.requestOptions.path} :: ${err.message}');
    handler.next(err);
  }
}
