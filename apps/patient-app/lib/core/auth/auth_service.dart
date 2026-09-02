import 'package:dio/dio.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../constants/app_constants.dart';
import '../models/session_bootstrap.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import '../network/session_storage.dart';
import '../notifications/push_device_store.dart';
import 'firebase_initializer.dart';

/// The full auth service: Firebase identity + backend application session.
///
/// Flow (see AGENTS.md "Session/Auth Flow"):
///  1. Firebase `signInWithEmailAndPassword` → `user.getIdToken()`
///  2. POST /sessions with `Authorization: Bearer <id_token>` + body
///     `{"client_type": "patient_flutter", "device_name": "<device>"}`
///  3. Response 201: `SessionBootstrapResponse` — store csrf_token + cookie
///  4. On 401 anywhere: clear storage, redirect to /login (handled by api_client)
///
/// If Firebase is not configured (`firebaseConfigured == false`), `signIn` and
/// `signUp` throw an [ApiError] with a clear message so the auth screens can
/// show the "contact admin" state.
class AuthService {
  final Dio _dio;
  final SessionStorage _storage;

  AuthService(this._dio, this._storage);

  /// Sign in with email/password via Firebase, then exchange the id token for a
  /// backend application session.
  Future<SessionBootstrap> signIn(
    String email,
    String password,
    String deviceName,
  ) async {
    if (!firebaseConfigured) {
      throw const ApiError(
        status: 0,
        code: 'FIREBASE_NOT_CONFIGURED',
        title: 'Firebase is not configured',
        detail:
            'Authentication is unavailable. Please contact the administrator '
            'to configure Firebase for this app.',
      );
    }

    // 1. Firebase sign-in → id token
    final credential = await FirebaseAuth.instance
        .signInWithEmailAndPassword(email: email, password: password);

    final idToken = await credential.user?.getIdToken();
    if (idToken == null) {
      throw const ApiError(
        status: 0,
        code: 'AUTH_TOKEN_INVALID',
        title: 'Failed to obtain identity token',
        detail: 'Firebase returned no id token after sign-in.',
      );
    }

    // 2. POST /sessions
    return _createSession(idToken, deviceName);
  }

  /// Sign in with Google via the native Google Sign-In SDK, then exchange the
  /// resulting Firebase id token for a backend application session.
  ///
  /// This follows the same backend flow as email/password: Google credential
  /// → Firebase credential → Firebase id token → POST /sessions.
  Future<SessionBootstrap> signInWithGoogle(String deviceName) async {
    if (!firebaseConfigured) {
      throw const ApiError(
        status: 0,
        code: 'FIREBASE_NOT_CONFIGURED',
        title: 'Firebase is not configured',
        detail:
            'Google sign-in is unavailable. Please contact the administrator '
            'to configure Firebase for this app.',
      );
    }

    // 1. Trigger the native Google account picker.
    final googleUser = await GoogleSignIn().signIn();
    if (googleUser == null) {
      throw const ApiError(
        status: 0,
        code: 'GOOGLE_SIGN_IN_CANCELLED',
        title: 'Sign-in cancelled',
        detail: 'Google sign-in was cancelled.',
      );
    }

    // 2. Exchange the Google auth tokens for a Firebase credential.
    final googleAuth = await googleUser.authentication;
    final credential = GoogleAuthProvider.credential(
      accessToken: googleAuth.accessToken,
      idToken: googleAuth.idToken,
    );

    await FirebaseAuth.instance.signInWithCredential(credential);

    // 3. Firebase now has a signed-in user; get its id token for the backend.
    final idToken = await FirebaseAuth.instance.currentUser?.getIdToken();
    if (idToken == null) {
      throw const ApiError(
        status: 0,
        code: 'AUTH_TOKEN_INVALID',
        title: 'Failed to obtain identity token',
        detail: 'Firebase returned no id token after Google sign-in.',
      );
    }

    return _createSession(idToken, deviceName);
  }

  /// Create a Firebase account, set the display name, then exchange the id token
  /// for a backend session.
  Future<SessionBootstrap> signUp(
    String email,
    String password,
    String displayName,
    String deviceName,
  ) async {
    if (!firebaseConfigured) {
      throw const ApiError(
        status: 0,
        code: 'FIREBASE_NOT_CONFIGURED',
        title: 'Firebase is not configured',
        detail:
            'Account creation is unavailable. Please contact the administrator '
            'to configure Firebase for this app.',
      );
    }

    final credential = await FirebaseAuth.instance
        .createUserWithEmailAndPassword(email: email, password: password);

    // Set display name on the Firebase profile
    await credential.user?.updateDisplayName(displayName);

    final idToken = await credential.user?.getIdToken();
    if (idToken == null) {
      throw const ApiError(
        status: 0,
        code: 'AUTH_TOKEN_INVALID',
        title: 'Failed to obtain identity token',
        detail: 'Firebase returned no id token after sign-up.',
      );
    }

    return _createSession(idToken, deviceName);
  }

  /// Try to restore an existing session by calling GET /sessions/current.
  /// Returns null (and clears storage) if the session is gone (401).
  Future<SessionBootstrap?> restoreSession() async {
    try {
      final response = await _dio.get<dynamic>(
        ApiEndpoints.sessionsCurrent,
        options: Options(
          // Use a shorter timeout for session restore so the user is not
          // stuck on a spinner for 30 seconds if the server is unreachable.
          sendTimeout: const Duration(seconds: 10),
          receiveTimeout: const Duration(seconds: 10),
        ),
      );
      final bootstrap = SessionBootstrap.fromJson(
        response.data as Map<String, dynamic>,
      );
      // The response interceptor already rotated the CSRF token, but persist
      // both explicitly in case this is the first call after app start.
      await _storage.saveCsrfToken(bootstrap.csrfToken);
      return bootstrap;
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      if (apiError != null && apiError.isUnauthenticated) {
        // Session expired — clear and return null (redirect handled by interceptor).
        await _storage.clear();
        return null;
      }
      // Other errors (network, 5xx) — rethrow so the caller can show a retry.
      rethrow;
    }
  }

  /// Sign out: revoke this device's push registration, DELETE /sessions/current
  /// (with CSRF), then Firebase sign-out, then clear local storage.
  Future<void> signOut() async {
    // Revoke the push device while the session is still alive — the endpoint
    // authenticates with it. Best-effort and skipped silently when this
    // process never registered a device (no id tracked; never invent one).
    final store = await PushDeviceStore.load();
    final pushDeviceId = store.pushDeviceId;
    if (pushDeviceId != null) {
      try {
        await _dio.put<void>(
          ApiEndpoints.pushDeviceRevocation(pushDeviceId),
        );
      } catch (e) {
        debugPrint('[AuthService] push device revocation failed: $e');
      } finally {
        await store.clear();
      }
    }

    // Best-effort server-side revocation — don't block on it if the network is down.
    try {
      await _dio.delete<dynamic>(ApiEndpoints.sessionsCurrent);
    } catch (e) {
      debugPrint('[AuthService] server-side session revoke failed: $e');
    }

    if (firebaseConfigured) {
      try {
        await FirebaseAuth.instance.signOut();
      } catch (e) {
        debugPrint('[AuthService] Firebase signOut failed: $e');
      }
    }

    await _storage.clear();
  }

  /// Send a password reset email via Firebase.
  Future<void> sendPasswordReset(String email) async {
    if (!firebaseConfigured) {
      throw const ApiError(
        status: 0,
        code: 'FIREBASE_NOT_CONFIGURED',
        title: 'Firebase is not configured',
        detail:
            'Password reset is unavailable. Please contact the administrator.',
      );
    }
    await FirebaseAuth.instance.sendPasswordResetEmail(email: email);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  Future<SessionBootstrap> _createSession(
    String idToken,
    String deviceName,
  ) async {
    try {
      final response = await _dio.post<dynamic>(
        ApiEndpoints.sessions,
        data: {
          'client_type': AppConstants.clientType,
          'device_name': deviceName,
        },
        options: Options(
          headers: {
            AppConstants.authorizationHeader: 'Bearer $idToken',
          },
        ),
      );

      final bootstrap = SessionBootstrap.fromJson(
        response.data as Map<String, dynamic>,
      );

      // The Set-Cookie header is set by the backend but Dio does not auto-store
      // it (no cookie jar). Extract the session cookie value and persist it.
      final setCookie = response.headers.value('set-cookie');
      final cookieValue = _extractSessionCookieValue(setCookie);
      if (cookieValue != null) {
        await _storage.saveSession(cookieValue, bootstrap.csrfToken);
      } else {
        // Even if we can't parse the cookie, persist the CSRF token so mutations
        // have a chance — the backend may have set the cookie in a way Dio can't
        // read on this platform. The next request will 401 if the cookie is
        // truly missing, and the interceptor will clean up.
        await _storage.saveCsrfToken(bootstrap.csrfToken);
      }

      return bootstrap;
    } on DioException catch (e) {
      // Unwrap the ApiError that the error interceptor attached.
      if (e.error is ApiError) throw e.error as ApiError;
      rethrow;
    }
  }

  /// Parses the `__Host-smartcura_session=<value>` pair out of a Set-Cookie
  /// header value, returning just the value. Returns null if the header is
  /// absent or the cookie is not present.
  String? _extractSessionCookieValue(String? setCookie) {
    if (setCookie == null || setCookie.isEmpty) return null;
    final name = AppConstants.sessionCookieName;
    // The header may contain multiple cookies separated by commas, but the
    // session cookie value itself is a simple opaque string (no commas in
    // practice). We scan for the cookie name prefix.
    final start = setCookie.indexOf('$name=');
    if (start < 0) return null;
    final valueStart = start + name.length + 1; // +1 for '='
    var valueEnd = setCookie.indexOf(';', valueStart);
    if (valueEnd < 0) valueEnd = setCookie.length;
    var value = setCookie.substring(valueStart, valueEnd).trim();
    // Strip any trailing attributes if the parsing above captured too much.
    final spaceIdx = value.indexOf(' ');
    if (spaceIdx >= 0) value = value.substring(0, spaceIdx);
    return value.isEmpty ? null : value;
  }
}

/// Riverpod provider for [AuthService].
final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService(
      ref.watch(apiClientProvider), ref.watch(sessionStorageProvider));
});
