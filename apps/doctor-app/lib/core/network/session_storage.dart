import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the SmartCura session cookie value and CSRF token in the platform
/// keychain (Android Keystore / iOS Keychain) via [flutter_secure_storage].
///
/// The backend mints an `__Host-smartcura_session` cookie (HttpOnly, Secure,
/// SameSite=Strict) on `POST /sessions`. Because the cookie is HttpOnly the
/// platform cookie jar cannot read it back, so the API client must replay the
/// raw value as a `Cookie` header on every subsequent request. This store holds
/// that value together with the CSRF token that every mutation must echo back.
///
/// Money is never stored here. Only session/CSRF state lives in secure storage.
class SessionStorage {
  SessionStorage({FlutterSecureStorage? secureStorage})
      : _storage = secureStorage ?? const FlutterSecureStorage(
          aOptions: AndroidOptions(
            encryptedSharedPreferences: true,
          ),
          iOptions: IOSOptions(
            accessibility: KeychainAccessibility.first_unlock,
          ),
        );

  final FlutterSecureStorage _storage;

  // Keep keys versioned so a future schema change can migrate cleanly.
  static const _kSessionCookie = 'smartcura.session_cookie';
  static const _kCsrfToken = 'smartcura.csrf_token';
  static const _kActiveMembershipId = 'smartcura.active_membership_id';
  static const _kActiveRole = 'smartcura.active_role';

  /// The raw `__Host-smartcura_session` cookie value, or null when signed out.
  Future<String?> getSessionCookie() async {
    try {
      return await _storage.read(key: _kSessionCookie);
    } catch (e) {
      debugPrint('SessionStorage: failed to read session cookie: $e');
      return null;
    }
  }

  Future<void> setSessionCookie(String? value) async {
    if (value == null || value.isEmpty) {
      await _storage.delete(key: _kSessionCookie);
      return;
    }
    await _storage.write(key: _kSessionCookie, value: value);
  }

  /// The CSRF token minted with the session, or null when signed out.
  Future<String?> getCsrfToken() async {
    try {
      return await _storage.read(key: _kCsrfToken);
    } catch (e) {
      debugPrint('SessionStorage: failed to read csrf token: $e');
      return null;
    }
  }

  Future<void> setCsrfToken(String? value) async {
    if (value == null || value.isEmpty) {
      await _storage.delete(key: _kCsrfToken);
      return;
    }
    await _storage.write(key: _kCsrfToken, value: value);
  }

  /// Persist both the session cookie and CSRF token in one call.
  Future<void> saveSession({
    required String sessionCookie,
    required String csrfToken,
  }) async {
    await Future.wait([
      setSessionCookie(sessionCookie),
      setCsrfToken(csrfToken),
    ]);
  }

  /// The membership id of the currently active doctor role, if one was selected.
  Future<String?> getActiveMembershipId() async {
    try {
      return await _storage.read(key: _kActiveMembershipId);
    } catch (_) {
      return null;
    }
  }

  Future<void> setActiveMembershipId(String? value) async {
    if (value == null || value.isEmpty) {
      await _storage.delete(key: _kActiveMembershipId);
      return;
    }
    await _storage.write(key: _kActiveMembershipId, value: value);
  }

  /// The wire value of the active role (e.g. `doctor`), if selected.
  Future<String?> getActiveRole() async {
    try {
      return await _storage.read(key: _kActiveRole);
    } catch (_) {
      return null;
    }
  }

  Future<void> setActiveRole(String? value) async {
    if (value == null || value.isEmpty) {
      await _storage.delete(key: _kActiveRole);
      return;
    }
    await _storage.write(key: _kActiveRole, value: value);
  }

  /// True when both a session cookie and CSRF token are present. This is a
  /// necessary but not sufficient condition for a live session — the server
  /// may still reject the cookie as expired.
  Future<bool> hasSession() async {
    final cookie = await getSessionCookie();
    final csrf = await getCsrfToken();
    return cookie != null && cookie.isNotEmpty && csrf != null && csrf.isNotEmpty;
  }

  /// Remove all session-related state. Called on explicit sign-out and on a 401.
  Future<void> clear() async {
    await Future.wait([
      _storage.delete(key: _kSessionCookie),
      _storage.delete(key: _kCsrfToken),
      _storage.delete(key: _kActiveMembershipId),
      _storage.delete(key: _kActiveRole),
    ]);
  }
}
