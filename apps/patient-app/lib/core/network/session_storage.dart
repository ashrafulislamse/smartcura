import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the backend session cookie value and the paired CSRF token in
/// flutter_secure_storage (platform keychain / encrypted SharedPreferences).
///
/// The web portal keeps the CSRF token in module memory because the browser
/// manages the cookie. Flutter has no cookie jar by default, so we store the
/// cookie *value* here (not the full Set-Cookie header) and replay it manually
/// as `Cookie: __Host-smartcura_session=<value>` on every request. See
/// `api_client.dart` for how the two values are consumed.
///
/// On a 401 both values are cleared atomically so the auth provider can redirect
/// to /login without a half-session lingering.
class SessionStorage {
  /// Public so the background-sync isolate (workmanager) can read the same
  /// keys without constructing a [SessionStorage] (which needs Riverpod).
  /// Keep these in sync with the reads below.
  static const sessionCookieKey = 'session_cookie';
  static const csrfTokenKey = 'csrf_token';

  final FlutterSecureStorage _storage;

  SessionStorage(this._storage);

  Future<void> saveSession(String cookieValue, String csrfToken) async {
    // Write both — if the app is killed between the two writes, a partial
    // session is still better than a stale one, because the next 401 clears it.
    await _storage.write(key: sessionCookieKey, value: cookieValue);
    await _storage.write(key: csrfTokenKey, value: csrfToken);
  }

  /// Update only the CSRF token (e.g. when the backend rotates it on a response).
  Future<void> saveCsrfToken(String csrfToken) async {
    await _storage.write(key: csrfTokenKey, value: csrfToken);
  }

  Future<String?> getSessionCookie() async {
    return _storage.read(key: sessionCookieKey);
  }

  Future<String?> getCsrfToken() async {
    return _storage.read(key: csrfTokenKey);
  }

  /// True when a session cookie value is present. Does not validate it — the
  /// backend is the only authority on whether the session is still alive.
  Future<bool> hasSession() async {
    final cookie = await _storage.read(key: sessionCookieKey);
    return cookie != null && cookie.isNotEmpty;
  }

  Future<void> clear() async {
    await _storage.delete(key: sessionCookieKey);
    await _storage.delete(key: csrfTokenKey);
  }
}

/// Riverpod provider for [SessionStorage]. Uses default FlutterSecureStorage
/// options (AES on Android, Keychain on iOS).
final sessionStorageProvider = Provider<SessionStorage>((ref) {
  return SessionStorage(const FlutterSecureStorage());
});
