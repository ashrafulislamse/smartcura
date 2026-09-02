import 'package:shared_preferences/shared_preferences.dart';

/// Local key-value store for the device ID that the patient just provisioned
/// but which has not yet been assigned to them by a care provider.
///
/// The backend only returns devices in `GET /profiles/me/devices` after an
/// admin/doctor has assigned the device to the patient. Until then, the patient
/// app shows a "Pending approval" card driven by this local ID so the patient
/// knows provisioning succeeded and can see the device in their list.
class PendingProvisioningDeviceStore {
  static const _key = 'pending_provisioning_device_id';

  /// Returns the locally stored pending device ID, or `null` if none exists.
  static Future<String?> getPendingDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    return prefs.getString(_key);
  }

  /// Stores a device ID as the pending provisioning device.
  static Future<void> setPendingDeviceId(String deviceId) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, deviceId);
  }

  /// Clears the pending device ID. Call this once the backend returns the
  /// device in `GET /profiles/me/devices` (i.e., it has been approved).
  static Future<void> clearPendingDeviceId() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
