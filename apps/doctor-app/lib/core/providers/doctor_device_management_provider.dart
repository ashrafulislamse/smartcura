import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Doctor-scoped IoT device assignment management.
///
/// The three endpoints wired here are:
///   * `GET /doctor/available-devices` — devices in the doctor's organization
///     with no open assignment and an assignable state (`provisioned` or
///     `active`). Returns the full [Device] projection (`serializeDevice`),
///     which carries `version`.
///   * `POST /doctor/devices/{deviceId}/assignments` — bind a device to a
///     patient under the doctor's active care. Body:
///     `{ patient_profile_id, expected_version }`. Returns the updated full
///     [Device] (with a bumped `version`).
///   * `POST /doctor/devices/{deviceId}/assignments/release` — close the open
///     assignment. Body: `{ expected_version, reason_code }`. Returns the
///     updated full [Device].
///
/// `GET /doctor/devices` (the doctor's assigned-device list) returns the
/// [DoctorDevice] projection, which does NOT carry `version`, so it cannot be
/// used to source an `expected_version` for release. The version is sourced
/// from [availableDevicesProvider] (before assignment) and from the
/// assign/release mutation responses (after assignment), and cached in
/// [deviceVersionCacheProvider]. See the trap: release strictly requires
/// `expected_version` and a stale/missing version yields `409
/// DEVICE_VERSION_CONFLICT`; the cache is updated on every mutation response
/// so a second mutation on the same device reuses the fresh version.

// ---------------------------------------------------------------------------
// Version cache
// ---------------------------------------------------------------------------

/// Cache of the most recent `version` seen per device id. Seeded from
/// [availableDevicesProvider] and updated on assign/release responses. A
/// device whose version is unknown (e.g. an assignment created in a previous
/// session, when `GET /doctor/devices` reports no version) cannot be released
/// through this flow — the UI states that limitation rather than guessing a
/// version that would earn a `409`.
final deviceVersionCacheProvider =
    StateProvider<Map<String, int>>((ref) => <String, int>{});

/// Record (or refresh) the version for a device. Called after loading the
/// available-devices list and after each successful assign/release mutation.
/// Accepts a Riverpod [Ref] because it is invoked from inside providers and
/// notifiers, not from a widget build.
void rememberDeviceVersion(Ref ref, Device device) {
  final cache = ref.read(deviceVersionCacheProvider);
  if (cache[device.id] == device.version) return;
  ref.read(deviceVersionCacheProvider.notifier).state = {
    ...cache,
    device.id: device.version,
  };
}

// ---------------------------------------------------------------------------
// Available devices (full Device projection, carries version)
// ---------------------------------------------------------------------------

/// Devices in the doctor's organization available for assignment (no open
/// assignment, `provisioned` or `active` state). `GET /doctor/available-devices`.
///
/// Each device carries its `version`, which the assign body needs as
/// `expected_version`. The list is also used to seed [deviceVersionCacheProvider].
final availableDevicesProvider = FutureProvider<List<Device>>((ref) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.doctorAvailableDevices);
    final resp = decodeDeviceListResponse(body);
    // Seed the version cache for every available device so a subsequent
    // release (after an assign on this screen) reuses the fresh version.
    final cache = ref.read(deviceVersionCacheProvider);
    var changed = false;
    final next = <String, int>{...cache};
    for (final d in resp.data) {
      if (next[d.id] != d.version) {
        next[d.id] = d.version;
        changed = true;
      }
    }
    if (changed) {
      ref.read(deviceVersionCacheProvider.notifier).state = next;
    }
    return resp.data;
  });
});

// ---------------------------------------------------------------------------
// Patient devices (DoctorDevice projection, no version)
// ---------------------------------------------------------------------------

/// Devices currently assigned to a patient the doctor is actively treating,
/// derived from `GET /doctor/devices` and filtered client-side by
/// `patient_profile_id`.
///
/// The endpoint returns the [DoctorDevice] projection, which carries no
/// `version` (and no `organization_id`, `hardware_revision`, etc.), so the
/// return type is `List<DoctorDevice>`, not `List<Device>` — fabricating the
/// missing fields would be the "guessing schema" trap. The version needed for
/// a release is sourced separately from [deviceVersionCacheProvider].
final patientDevicesProvider =
    FutureProvider.family<List<DoctorDevice>, String>((ref, patientProfileId) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.doctorDevices);
    final resp = decodeDoctorDeviceList(body);
    return resp.data
        .where((d) => d.patientProfileId == patientProfileId)
        .toList();
  });
});

// ---------------------------------------------------------------------------
// Assignment / release mutations
// ---------------------------------------------------------------------------

/// The lifecycle of a device assignment mutation. `assigning` and `releasing`
/// distinguish the in-flight action so the UI can show the right spinner.
/// `success` carries the updated [Device] (with its bumped `version`) so the
/// caller can refresh [deviceVersionCacheProvider] and the patient-devices
/// list reflects the new state after invalidation.
sealed class DeviceAssignmentState {
  const DeviceAssignmentState();
}

class DeviceAssignmentIdle extends DeviceAssignmentState {
  const DeviceAssignmentIdle();
}

class DeviceAssignmentAssigning extends DeviceAssignmentState {
  const DeviceAssignmentAssigning();
}

class DeviceAssignmentReleasing extends DeviceAssignmentState {
  const DeviceAssignmentReleasing();
}

class DeviceAssignmentSuccess extends DeviceAssignmentState {
  const DeviceAssignmentSuccess([this.device]);
  final Device? device;
}

class DeviceAssignmentError extends DeviceAssignmentState {
  const DeviceAssignmentError(this.message);
  final String message;
}

/// Performs assign/release mutations and invalidates the list providers on
/// success so the UI re-reads from the server rather than mutating local state.
class DeviceAssignmentNotifier extends StateNotifier<DeviceAssignmentState> {
  DeviceAssignmentNotifier(this._api, this._ref)
      : super(const DeviceAssignmentIdle());
  final ApiClient _api;
  final Ref _ref;

  /// Assign [deviceId] to [patientProfileId]. [expectedVersion] comes from the
  /// available-device projection. On success, refreshes the version cache,
  /// invalidates the available- and patient-devices providers, and returns
  /// `true`. The returned [Device] is held in state for the caller to cache.
  Future<bool> assignDevice({
    required String deviceId,
    required String patientProfileId,
    required int expectedVersion,
  }) async {
    state = const DeviceAssignmentAssigning();
    try {
      final body = await _api.post(
        ApiEndpoints.doctorDeviceAssignments(deviceId),
        body: <String, dynamic>{
          'patient_profile_id': patientProfileId,
          'expected_version': expectedVersion,
        },
      );
      final updated = decodeDevice(body);
      // The response carries the bumped version; cache it so a subsequent
      // release on the same device reuses the fresh value.
      rememberDeviceVersion(_ref, updated);
      _invalidateLists(patientProfileId: patientProfileId);
      state = DeviceAssignmentSuccess(updated);
      return true;
    } catch (e) {
      state = DeviceAssignmentError(toApiError(e).displayMessage);
      return false;
    }
  }

  /// Release [deviceId] from its current assignment with [reasonCode].
  /// [expectedVersion] is sourced by the caller from
  /// [deviceVersionCacheProvider]. On success, refreshes the version cache,
  /// invalidates the list providers, and returns `true`.
  Future<bool> releaseDevice({
    required String deviceId,
    required int expectedVersion,
    required String reasonCode,
    String? patientProfileId,
  }) async {
    state = const DeviceAssignmentReleasing();
    try {
      final body = await _api.post(
        ApiEndpoints.doctorDeviceRelease(deviceId),
        body: <String, dynamic>{
          'expected_version': expectedVersion,
          'reason_code': reasonCode,
        },
      );
      final updated = decodeDevice(body);
      rememberDeviceVersion(_ref, updated);
      _invalidateLists(patientProfileId: patientProfileId);
      state = DeviceAssignmentSuccess(updated);
      return true;
    } catch (e) {
      state = DeviceAssignmentError(toApiError(e).displayMessage);
      return false;
    }
  }

  /// Reset back to idle so a transient success/error does not linger across
  /// unrelated interactions.
  void reset() => state = const DeviceAssignmentIdle();

  void _invalidateLists({String? patientProfileId}) {
    _ref.invalidate(availableDevicesProvider);
    // Invalidate every family instance; only one patient is open at a time,
    // and naming the specific patient keeps it sharp when available.
    if (patientProfileId != null) {
      _ref.invalidate(patientDevicesProvider(patientProfileId));
    } else {
      _ref.invalidate(patientDevicesProvider);
    }
  }
}

final deviceAssignmentProvider = StateNotifierProvider.autoDispose<
    DeviceAssignmentNotifier, DeviceAssignmentState>(
    (ref) => DeviceAssignmentNotifier(ref.watch(apiClientProvider), ref));
