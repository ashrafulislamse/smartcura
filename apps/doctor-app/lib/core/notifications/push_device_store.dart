import 'package:shared_preferences/shared_preferences.dart';

/// Persists the push-device registration in [SharedPreferences].
///
/// The backend's `POST /notifications/push-devices` returns the
/// `push_device_id` it assigned; sign-out needs that id to revoke the device
/// (`PUT /notifications/push-devices/{id}/revocation`) before the session goes
/// away. The id is kept alongside a `registered` marker so a future launch can
/// tell "this install registered before" from "never registered" even after a
/// revocation cleared the id.
///
/// This is plain (non-secure) storage on purpose: the id is a routing handle,
/// not a credential — the FCM token itself never leaves the API call.
class PushDeviceStore {
  PushDeviceStore(this._prefs);

  static const _kPushDeviceId = 'smartcura.push_device_id';
  static const _kRegistered = 'smartcura.push_device_registered';

  final SharedPreferences _prefs;

  /// Load the store from platform preferences.
  static Future<PushDeviceStore> load() async =>
      PushDeviceStore(await SharedPreferences.getInstance());

  /// The push device id the backend assigned, or null when none is registered.
  String? get pushDeviceId => _prefs.getString(_kPushDeviceId);

  /// True when this install has completed a registration at least once.
  bool get registered => _prefs.getBool(_kRegistered) ?? false;

  /// Record a fresh registration.
  Future<void> save(String pushDeviceId) async {
    await _prefs.setString(_kPushDeviceId, pushDeviceId);
    await _prefs.setBool(_kRegistered, true);
  }

  /// Clear the tracked id (after revocation or a failed registration). The
  /// `registered` marker stays so the next launch knows to re-register.
  Future<void> clear() async {
    await _prefs.remove(_kPushDeviceId);
  }
}
