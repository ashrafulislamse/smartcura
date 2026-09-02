import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:uuid/uuid.dart';

import '../constants/app_constants.dart';
import 'api_error.dart';
import 'session_storage.dart';

/// A global navigator key shared with [GoRouter]. The error interceptor uses it
/// to redirect to /login on a 401 without needing a BuildContext. The router
/// assigns this as its `navigatorKey`.
final rootNavigatorKey = GlobalKey<NavigatorState>(debugLabel: 'rootNavigator');

/// Riverpod provider for the singleton [Dio] instance.
///
/// This is the single API boundary for the entire app, exactly like the web
/// portal's `client.ts`. Every provider that talks to the backend reads
/// `apiClientProvider` rather than constructing its own Dio, so the
/// interceptors below are always active.
///
/// Interceptor chain (applied in order on requests, reverse on responses):
///  1. Session — adds `Cookie: __Host-smartcura_session=<value>` from secure storage
///  2. CSRF — adds `X-CSRF-Token` on POST/PUT/PATCH/DELETE
///  3. Idempotency — adds `Idempotency-Key: <uuid>` on POST/PUT
///  4. Response — extracts `csrf_token` from JSON bodies and updates storage
///  5. Error — parses `application/problem+json` into [ApiError]; on 401 clears session
///  6. Logging (debug builds only)
final apiClientProvider = Provider<Dio>((ref) {
  final storage = ref.watch(sessionStorageProvider);

  final dio = Dio(BaseOptions(
    baseUrl: AppConstants.apiBaseUrl,
    connectTimeout: const Duration(seconds: 30),
    receiveTimeout: const Duration(seconds: 30),
    sendTimeout: const Duration(seconds: 30),
    headers: {
      'Accept': 'application/json, application/problem+json',
    },
    // Dio treats non-2xx as errors by default, which is what we want —
    // the error interceptor then maps them to ApiError.
    validateStatus: (status) => status != null && status >= 200 && status < 300,
  ));

  const uuid = Uuid();

  // -------------------------------------------------------------------------
  // Interceptor 1: Session cookie
  // -------------------------------------------------------------------------
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) async {
        final cookie = await storage.getSessionCookie();
        if (cookie != null && cookie.isNotEmpty) {
          options.headers['Cookie'] =
              '${AppConstants.sessionCookieName}=$cookie';
        }
        handler.next(options);
      },
    ),
  );

  // -------------------------------------------------------------------------
  // Interceptor 2: CSRF token (mutations only)
  // -------------------------------------------------------------------------
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) async {
        final method = options.method.toUpperCase();
        if (method == 'POST' || method == 'PUT' || method == 'PATCH' || method == 'DELETE') {
          final csrf = await storage.getCsrfToken();
          if (csrf != null && csrf.isNotEmpty) {
            options.headers[AppConstants.csrfHeader] = csrf;
          }
        }
        handler.next(options);
      },
    ),
  );

  // -------------------------------------------------------------------------
  // Interceptor 3: Idempotency-Key (POST/PUT only, if not already set)
  // -------------------------------------------------------------------------
  dio.interceptors.add(
    InterceptorsWrapper(
      onRequest: (options, handler) {
        final method = options.method.toUpperCase();
        if ((method == 'POST' || method == 'PUT') &&
            !options.headers.containsKey(AppConstants.idempotencyKeyHeader)) {
          options.headers[AppConstants.idempotencyKeyHeader] = uuid.v4();
        }
        handler.next(options);
      },
    ),
  );

  // -------------------------------------------------------------------------
  // Interceptor 4 & 5: Response (csrf rotation) + Error (problem+json, 401)
  // -------------------------------------------------------------------------
  dio.interceptors.add(
    InterceptorsWrapper(
      onResponse: (response, handler) async {
        // The backend includes a fresh `csrf_token` in bootstrap/step-up
        // responses. Rotating it here keeps mutations working even if the
        // server rotated the token on a non-mutation GET.
        _maybeUpdateCsrf(response, storage);
        handler.next(response);
      },
      onError: (err, handler) async {
        final apiError = _mapDioError(err);

        // On 401 the cookie is gone or rotated, so the paired CSRF token is
        // worthless. Clear both and bounce to /login.
        if (apiError.isUnauthenticated) {
          await storage.clear();
          _redirectUnauthorized();
        }

        return handler.reject(DioException(
          requestOptions: err.requestOptions,
          response: err.response,
          type: err.type,
          error: apiError,
          message: apiError.userMessage,
        ));
      },
    ),
  );

  // -------------------------------------------------------------------------
  // Interceptor 6: Debug logging
  // -------------------------------------------------------------------------
  if (kDebugMode) {
    dio.interceptors.add(
      LogInterceptor(
        requestHeader: false,
        responseHeader: false,
        requestBody: true,
        responseBody: true,
        error: true,
        logPrint: (obj) => debugPrint('[API] $obj'),
      ),
    );
  }

  return dio;
});

/// Extracts `csrf_token` from a JSON response body and updates secure storage.
void _maybeUpdateCsrf(Response response, SessionStorage storage) {
  final data = response.data;
  if (data is! Map<String, dynamic>) return;
  final token = data['csrf_token'];
  if (token is String && token.isNotEmpty) {
    // Fire-and-forget — the current request already succeeded.
    storage.saveCsrfToken(token);
  }
}

/// Converts a [DioException] (which may wrap a problem+json response or be a
/// network-level failure) into an [ApiError].
ApiError _mapDioError(DioException err) {
  final response = err.response;
  if (response == null) {
    // Network failure, timeout, or cancellation.
    if (err.type == DioExceptionType.cancel) {
      return ApiError.network('Request was cancelled');
    }
    return ApiError.network(err.message ?? 'The network request failed.');
  }

  final correlationId = response.headers.value('X-Correlation-ID');

  final contentType =
      response.headers.value('content-type')?.toLowerCase() ?? '';
  if (contentType.contains('json')) {
    try {
      final body = response.data is String
          ? jsonDecode(response.data as String) as Map<String, dynamic>
          : response.data is Map
              ? Map<String, dynamic>.from(response.data as Map)
              : null;
      if (body != null && _isProblemJson(body)) {
        return ApiError.fromProblemJson(body);
      }
    } catch (_) {
      // Fall through to unexpected.
    }
  }

  return ApiError.unexpected(response.statusCode ?? 0, correlationId);
}

bool _isProblemJson(Map<String, dynamic> body) {
  return body['type'] is String &&
      body['title'] is String &&
      body['status'] is num &&
      body['code'] is String &&
      body['correlation_id'] is String;
}

/// Redirects to /login via [GoRouter]. Safe to call when no route is mounted
/// yet (e.g. during app startup) — it simply no-ops if no context is available.
void _redirectUnauthorized() {
  final context = rootNavigatorKey.currentContext;
  if (context != null) {
    // Use go (not push) so the back stack is cleared — the user should not be
    // able to navigate back to a protected screen after being logged out.
    GoRouter.of(context).go('/login');
  }
}
