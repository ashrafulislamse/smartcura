import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import '../notifications/fcm_service.dart';
import 'firebase_initializer.dart';

export 'package:smartcura_contracts/smartcura_contracts.dart'
    show SessionBootstrapResponse, Profile, Membership, BootstrapState;

/// Riverpod provider for the singleton [AuthService].
final authServiceProvider = Provider<AuthService>((ref) {
  final apiClient = ref.watch(apiClientProvider);
  final fcmService = ref.watch(fcmServiceProvider);
  return AuthService(apiClient: apiClient, fcmService: fcmService);
});

/// Bridges Firebase Authentication with the SmartCura backend session layer.
///
/// Flow for `signIn`:
///  1. `FirebaseAuth.signInWithEmailAndPassword` → `user.getIdToken()`.
///  2. `POST /sessions` with `Authorization: Bearer <id_token>` and a body of
///     `{client_type: "doctor_flutter", device_name, requested_role: "doctor"}`.
///  3. The response carries a `Set-Cookie: __Host-smartcura_session=…` header
///     (HttpOnly, so we read it from the header, not the cookie jar) plus a
///     `csrf_token` in the body. Both are persisted to secure storage.
///  4. Returns the decoded [SessionBootstrapResponse].
///
/// When [firebaseConfigured] is false, every method that needs Firebase throws
/// [FirebaseNotConfiguredError] so the UI can render the fallback state.
class AuthService {
  AuthService({required ApiClient apiClient, required FcmService fcmService})
      : _apiClient = apiClient,
        _fcmService = fcmService,
        _auth = FirebaseAuth.instance;

  final ApiClient _apiClient;
  final FcmService _fcmService;
  final FirebaseAuth _auth;

  /// Sign in an existing doctor. Returns the session bootstrap so the caller
  /// can route on `bootstrapState` (`profile_required`, `verification_pending`,
  /// `role_selection_required`, `ready`).
  Future<SessionBootstrapResponse> signIn({
    required String email,
    required String password,
  }) async {
    _requireFirebase();

    final credential = await _auth.signInWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );
    final idToken = await credential.user!.getIdToken(true);
    return _bootstrapSession(idToken!);
  }

  /// Create a new Firebase user and immediately mint a SmartCura session.
  Future<SessionBootstrapResponse> signUp({
    required String email,
    required String password,
    required String displayName,
  }) async {
    _requireFirebase();

    final credential = await _auth.createUserWithEmailAndPassword(
      email: email.trim(),
      password: password,
    );
    await credential.user!.updateDisplayName(displayName);
    final idToken = await credential.user!.getIdToken(true);
    return _bootstrapSession(idToken!);
  }

  /// Send a Firebase password-reset email. No session is created.
  Future<void> sendPasswordResetEmail(String email) async {
    _requireFirebase();
    await _auth.sendPasswordResetEmail(email: email.trim());
  }

  /// Re-establish a session from a still-valid stored cookie, without Firebase.
  /// Returns null when there is no stored session or the server rejects it.
  /// Times out after 10 seconds so the app doesn't hang on an unreachable backend.
  Future<SessionBootstrapResponse?> restoreSession() async {
    final hasSession = await _apiClient.sessionStorage.hasSession();
    if (!hasSession) return null;

    try {
      final body = await _apiClient
          .get(ApiEndpoints.sessionsCurrent)
          .timeout(const Duration(seconds: 10));
      return decodeSessionBootstrap(body);
    } on ApiError catch (e) {
      if (e.isSessionInvalid) {
        await _apiClient.sessionStorage.clear();
        return null;
      }
      rethrow;
    }
  }

  /// Keep a live session alive by touching it on the server. This is a best-
  /// effort call: it silently ignores network errors and only clears local
  /// credentials when the server explicitly says the session is invalid.
  /// Called when the app returns from background so the demo does not log out
  /// while the evaluator is using it.
  Future<SessionBootstrapResponse?> touchSession() async {
    final hasSession = await _apiClient.sessionStorage.hasSession();
    if (!hasSession) return null;

    try {
      final body = await _apiClient
          .get(ApiEndpoints.sessionsCurrent)
          .timeout(const Duration(seconds: 10));
      return decodeSessionBootstrap(body);
    } on ApiError catch (e) {
      if (e.isSessionInvalid) {
        await _apiClient.sessionStorage.clear();
      }
      return null;
    } catch (e) {
      debugPrint('Session touch failed (ignored): $e');
      return null;
    }
  }

  /// Tear down the backend session, sign out of Firebase, and clear local state.
  Future<void> signOut() async {
    // Revoke the push device while the session is still alive — the endpoint
    // authenticates with it. Best-effort and skipped silently when this process
    // never registered a device (no id tracked; never invent one).
    try {
      await _fcmService.revokeTrackedPushDevice();
    } catch (e) {
      debugPrint('Push device revocation failed (continuing): $e');
    }

    // Best-effort server sign-out: a 401/404 here is not fatal.
    try {
      await _apiClient.delete(ApiEndpoints.sessionsCurrent);
    } catch (e) {
      debugPrint('Backend sign-out failed (continuing): $e');
    }
    if (firebaseConfigured) {
      try {
        await _auth.signOut();
      } catch (e) {
        debugPrint('Firebase sign-out failed (continuing): $e');
      }
    }
    await _apiClient.sessionStorage.clear();
  }

  // ---- Internals ---------------------------------------------------------

  Future<SessionBootstrapResponse> _bootstrapSession(String idToken) async {
    final deviceName = await _resolveDeviceName();

    final result = await _apiClient.postWithBearerToken(
      ApiEndpoints.sessions,
      bearerToken: idToken,
      body: <String, dynamic>{
        'client_type': ClientType.doctorFlutter.wireValue,
        'device_name': deviceName,
        'requested_role': RoleId.doctor.wireValue,
      },
    );

    // The cookie is HttpOnly, so extract the raw value from the Set-Cookie
    // header and persist it ourselves for replay as a Cookie header later.
    final cookieValue = ApiClient.extractHostSessionCookie(result.setCookie);
    final csrfToken = (result.body['csrf_token'] as String?) ?? '';

    if (cookieValue.isEmpty || csrfToken.isEmpty) {
      throw const ApiError(
        status: 201,
        title: 'Session response was incomplete',
        detail: 'The server did not return a session cookie or CSRF token.',
      );
    }

    await _apiClient.sessionStorage.saveSession(
      sessionCookie: cookieValue,
      csrfToken: csrfToken,
    );

    return decodeSessionBootstrap(result.body);
  }

  /// Best-effort device name for the `device_name` field of POST /sessions.
  Future<String> _resolveDeviceName() async {
    try {
      final deviceInfo = DeviceInfoPlugin();
      if (Platform.isAndroid) {
        final info = await deviceInfo.androidInfo;
        return 'android-${info.model}';
      } else if (Platform.isIOS) {
        final info = await deviceInfo.iosInfo;
        return 'ios-${info.name}';
      }
    } catch (_) {
      // Fall through to the default below.
    }
    return 'doctor-flutter';
  }

  void _requireFirebase() {
    if (!firebaseConfigured) {
      throw FirebaseNotConfiguredError();
    }
  }
}
