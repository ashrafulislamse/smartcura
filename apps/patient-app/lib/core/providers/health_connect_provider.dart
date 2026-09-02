import 'package:android_intent_plus/android_intent.dart';
import 'package:android_intent_plus/flag.dart';
import 'package:health/health.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../auth/auth_provider.dart';
import '../background/health_sync.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'health_provider.dart';
import 'iot_provider.dart';

// ---------------------------------------------------------------------------
// Own-devices provider (GET /profiles/me/devices)
// ---------------------------------------------------------------------------

/// Devices currently assigned to the authenticated patient (open assignments
/// only). The backend resolves "me" from the session — no patient id in the
/// request.
///
/// Used by the watch-sync flow to find the deviceId to POST readings to.
/// A patient can have multiple open device assignments, so this may return
/// more than one. The sync flow picks the first `phone` device, falling back
/// to the first active device if no `phone` type exists.
final ownDevicesProvider = FutureProvider<List<Device>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get<void>(ApiEndpoints.profilesMeDevices);
  return DeviceListResponse.fromJson(response.data as Map<String, Object?>)
      .data;
});

// ---------------------------------------------------------------------------
// Health Connect sync
// ---------------------------------------------------------------------------

/// The phases of a watch sync, so the UI can show specific progress text.
enum HealthConnectSyncPhase {
  idle,
  requestingPermissions,
  reading,
  submitting,
  success,
  error,
}

/// The state held by [HealthConnectNotifier].
class HealthConnectSyncState {
  final HealthConnectSyncPhase phase;
  final String? message;
  final int? accepted;
  final int? deduplicated;
  final int? rejected;
  final int? alertsRaised;
  final DateTime? lastSyncedAt;

  const HealthConnectSyncState({
    this.phase = HealthConnectSyncPhase.idle,
    this.message,
    this.accepted,
    this.deduplicated,
    this.rejected,
    this.alertsRaised,
    this.lastSyncedAt,
  });

  bool get isIdle => phase == HealthConnectSyncPhase.idle;
  bool get isBusy =>
      phase == HealthConnectSyncPhase.requestingPermissions ||
      phase == HealthConnectSyncPhase.reading ||
      phase == HealthConnectSyncPhase.submitting;
  bool get isSuccess => phase == HealthConnectSyncPhase.success;
  bool get isError => phase == HealthConnectSyncPhase.error;

  HealthConnectSyncState copyWith({
    HealthConnectSyncPhase? phase,
    String? message,
    int? accepted,
    int? deduplicated,
    int? rejected,
    int? alertsRaised,
    DateTime? lastSyncedAt,
  }) =>
      HealthConnectSyncState(
        phase: phase ?? this.phase,
        message: message ?? this.message,
        accepted: accepted ?? this.accepted,
        deduplicated: deduplicated ?? this.deduplicated,
        rejected: rejected ?? this.rejected,
        alertsRaised: alertsRaised ?? this.alertsRaised,
        lastSyncedAt: lastSyncedAt ?? this.lastSyncedAt,
      );
}

/// Manages the Health Connect → backend sync lifecycle.
///
/// The flow is:
/// 1. Request Health Connect permissions (the OS shows a rational dialog).
/// 2. Read recent records from Health Connect for each supported metric.
/// 3. Map each record to the backend ingestion format with a deterministic
///    sequence_number so re-syncs deduplicate instead of duplicating.
/// 4. POST to the existing ingestion endpoint for the patient's assigned
///    device.
/// 5. Invalidate the vital-readings provider so the Health screen refreshes.
///
/// The `health` package reads from Google Health Connect on Android (and
/// Apple HealthKit on iOS). All three test watches — Amazfit (Zepp app),
/// Xiaomi Mi Band (Mi Fitness), Samsung Galaxy Watch (Samsung Health) —
/// sync their data to Health Connect via their companion apps, so one
/// integration covers all of them.
class HealthConnectNotifier extends StateNotifier<HealthConnectSyncState> {
  final Ref _ref;
  HealthConnectNotifier(this._ref) : super(const HealthConnectSyncState());

  /// Triggers a full sync cycle from Health Connect to the backend.
  Future<void> syncFromWatch() async {
    // --- 1. Resolve the target device ---------------------------------------
    //
    // The patient needs at least one assigned device. The sync flow prefers
    // a `phone` device (the one registered for Health Connect), but falls
    // back to the first active device so the feature works even before an
    // admin creates a phone-typed device.
    final devices = await _ref.read(ownDevicesProvider.future);
    if (devices.isEmpty) {
      state = const HealthConnectSyncState(
        phase: HealthConnectSyncPhase.error,
        message: 'No device is assigned to your profile. Ask your clinic to '
            'assign a device before syncing vitals from your watch.',
      );
      return;
    }
    final phoneDevices = devices.where((d) => d.deviceType == DeviceType.phone);
    final targetDevice =
        phoneDevices.isNotEmpty ? phoneDevices.first : devices.first;

    final orgId = _ref.read(currentOrganizationIdProvider);
    if (orgId == null) {
      state = const HealthConnectSyncState(
        phase: HealthConnectSyncPhase.error,
        message: 'No active organization membership. Cannot submit readings.',
      );
      return;
    }

    // --- 2. Request Health Connect permissions ------------------------------
    state = const HealthConnectSyncState(
      phase: HealthConnectSyncPhase.requestingPermissions,
      message: 'Connecting to Health Connect...',
    );

    try {
      final health = Health();

      final types = healthSyncTypes;
      final permissions = List.filled(types.length, HealthDataAccess.READ);

      final authorized =
          await health.requestAuthorization(types, permissions: permissions);
      if (!authorized) {
        state = const HealthConnectSyncState(
          phase: HealthConnectSyncPhase.error,
          message: 'Health Connect permission was denied. Tap "Open Health '
              'Connect" below and enable SmartCura to read vitals and activity '
              'data.',
        );
        return;
      }

      // --- 3. Read recent records from Health Connect -----------------------
      state = const HealthConnectSyncState(
        phase: HealthConnectSyncPhase.reading,
        message: 'Reading vitals from your watch...',
      );

      final now = DateTime.now();
      final from = now.subtract(const Duration(hours: 24));

      final readings =
          await collectVitalReadingMaps(health, from: from, to: now);

      if (readings.isEmpty) {
        state = HealthConnectSyncState(
          phase: HealthConnectSyncPhase.success,
          message:
              'No new vitals found in Health Connect in the last 24 hours.',
          accepted: 0,
          deduplicated: 0,
          rejected: 0,
          alertsRaised: 0,
          lastSyncedAt: now,
        );
        return;
      }

      // --- 4. POST to the existing ingestion endpoint -----------------------
      state = HealthConnectSyncState(
        phase: HealthConnectSyncPhase.submitting,
        message: 'Submitting ${readings.length} readings to SmartCura...',
      );

      final dio = _ref.read(apiClientProvider);
      final response = await dio.post<void>(
        ApiEndpoints.deviceVitalReadings(orgId, targetDevice.id),
        data: {'readings': readings},
      );

      final body = response.data as Map<String, dynamic>;
      final accepted = (body['accepted'] as num?)?.toInt() ?? 0;
      final deduplicated = (body['deduplicated'] as num?)?.toInt() ?? 0;
      final rejected = (body['rejected'] as num?)?.toInt() ?? 0;
      final alertsRaised = (body['alerts_raised'] as num?)?.toInt() ?? 0;

      // --- 5. Refresh the Health screen -------------------------------------
      _ref.invalidate(vitalReadingsProvider);
      _ref.invalidate(devicesProvider);

      state = HealthConnectSyncState(
        phase: HealthConnectSyncPhase.success,
        message: _buildSummaryMessage(accepted, deduplicated, rejected),
        accepted: accepted,
        deduplicated: deduplicated,
        rejected: rejected,
        alertsRaised: alertsRaised,
        lastSyncedAt: now,
      );
    } on ApiError catch (e) {
      state = HealthConnectSyncState(
        phase: HealthConnectSyncPhase.error,
        // Include the backend's detail and any field-level issues so the
        // user can see why a reading was rejected (e.g. unit mismatch,
        // value out of bounds). Without this the only signal is a generic
        // 422 "Request validation failed".
        message: _formatApiError(e),
      );
    } catch (e) {
      state = HealthConnectSyncState(
        phase: HealthConnectSyncPhase.error,
        message: 'Sync failed: $e',
      );
    }
  }

  /// Renders a backend [ApiError] with as much detail as the server returned.
  /// Falls back to the title when the body has no human-readable detail.
  String _formatApiError(ApiError e) {
    final detail = e.detail;
    if (detail != null && detail.isNotEmpty && detail != e.title) {
      return 'Sync failed: ${e.title} \u2014 $detail';
    }
    final issues = e.errors;
    if (issues != null && issues.isNotEmpty) {
      final first = issues.first;
      final field = first.field.isNotEmpty ? first.field : null;
      final msg = first.message;
      if (msg != null && msg.isNotEmpty) {
        return field != null
            ? 'Sync failed: $field \u2014 $msg'
            : 'Sync failed: $msg';
      }
    }
    return 'Sync failed: ${e.title}';
  }

  /// Resets to idle (used when the user dismisses the result card).
  void reset() {
    state = HealthConnectSyncState(lastSyncedAt: state.lastSyncedAt);
  }

  /// Opens the Health Connect permission page for this app.
  ///
  /// Uses a 3-level fallback chain so this works on stock Android 14+ as well
  /// as OEM skins (Vivo Funtouch OS, Xiaomi MIUI, etc.) that suppress the
  /// standard Health Connect permission dialog:
  ///
  /// 1. `MANAGE_HEALTH_PERMISSIONS` — the direct permission page (Android 14+).
  /// 2. Launch the Health Connect controller app (its main screen).
  /// 3. Open SmartCura's own app-details settings page — the user can then
  ///    navigate to Permissions → Health Connect manually. This always works
  ///    because `APPLICATION_DETAILS_SETTINGS` is a system settings action
  ///    available on every Android version.
  Future<void> openHealthConnectSettings() async {
    const packageName = 'com.smartcura.smartcuraPatientApp';

    // --- Attempt 1: direct Health Connect permission page (Android 14+) ---
    try {
      await const AndroidIntent(
        action: 'android.health.connect.action.MANAGE_HEALTH_PERMISSIONS',
        arguments: <String, dynamic>{
          'android.intent.extra.PACKAGE_NAME': packageName,
        },
        flags: <int>[Flag.FLAG_ACTIVITY_NEW_TASK],
      ).launchChooser('Open Health Connect');
      return; // success — no need to fall back
    } on Object catch (_) {
      // The action is unavailable on this device/OS. Continue to fallback.
    }

    // --- Attempt 2: launch the Health Connect controller app ---
    try {
      await const AndroidIntent(
        action: 'android.intent.action.MAIN',
        package: 'com.google.android.healthconnect.controller',
      ).launchChooser('Open Health Connect');
      return; // success
    } on Object catch (_) {
      // The HC controller app may not be installed or the intent may not
      // resolve on this OEM skin. Continue to the final fallback.
    }

    // --- Attempt 3: open SmartCura's app-details settings page ---
    //
    // This is the guaranteed-to-work fallback. On Android 14+ the user can
    // find Health Connect permissions under this app's settings page. On
    // older versions they can at least see all granted/denied permissions.
    try {
      await AndroidIntent(
        action: 'android.settings.APPLICATION_DETAILS_SETTINGS',
        data: 'package:$packageName',
        flags: <int>[Flag.FLAG_ACTIVITY_NEW_TASK],
      ).launch();
    } on Object catch (_) {
      // If even the system settings page cannot be opened, there is nothing
      // more we can do programmatically. The caller's UI should advise the
      // user to open Settings manually.
    }
  }

  // -------------------------------------------------------------------------
  // Summary helpers
  // -------------------------------------------------------------------------

  String _buildSummaryMessage(int accepted, int deduplicated, int rejected) {
    if (accepted == 0 && deduplicated > 0) {
      return 'All $deduplicated readings were already synced. No new data.';
    }
    final parts = <String>['$accepted synced'];
    if (deduplicated > 0) parts.add('$deduplicated duplicates skipped');
    if (rejected > 0) parts.add('$rejected rejected');
    return parts.join(' · ');
  }
}

final healthConnectProvider =
    StateNotifierProvider<HealthConnectNotifier, HealthConnectSyncState>(
        (ref) => HealthConnectNotifier(ref));
