// Health Connect background sync.
//
// This module is the single source of truth for the Health Connect → backend
// metric mapping AND the workmanager background task. Both the foreground
// [HealthConnectNotifier] and the background isolate call
// [collectVitalReadingMaps] so the two paths can never drift on which metrics
// are read or how the sequence number is derived.
//
// workmanager runs [callbackDispatcher] in a **separate isolate** where
// Riverpod providers are not available. The background sync therefore:
//   1. Initialises the background binary messenger so platform channels
//      (flutter_secure_storage, health, shared_preferences) work.
//   2. Reads the session cookie + CSRF token directly from secure storage
//      using the same keys as [SessionStorage].
//   3. Calls the backend with a plain [Dio] instance (no Riverpod).
//   4. Reads Health Connect and POSTs to the device ingestion endpoint.
//
// If anything is unavailable (no session, no device, Health Connect blocked
// in the background, network failure) the task falls back to a local
// notification reminding the user to open the app — a deliberately safe
// behaviour for an FYP demo where the AndroidManifest cannot be modified to
// add the Health Connect background-read permission.

import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:health/health.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';
import 'package:workmanager/workmanager.dart';

import '../constants/app_constants.dart';
import '../network/api_endpoints.dart';
import '../network/session_storage.dart';

// ---------------------------------------------------------------------------
// Task identifiers
// ---------------------------------------------------------------------------

/// The workmanager task *name* (the second positional argument to
/// [Workmanager.registerPeriodicTask]). The callback dispatcher matches on
/// this to decide what to run.
const healthSyncTaskName = 'smartcura.healthSync';

/// The unique work *name* used to deduplicate the periodic task. Re-registering
/// with [ExistingPeriodicWorkPolicy.keep] is a no-op once this exists.
const healthSyncTaskUniqueName = 'smartcura-health-sync';

// ---------------------------------------------------------------------------
// shared_preferences keys
// ---------------------------------------------------------------------------

const _kAutoSyncEnabledKey = 'smartcura.health.autoSyncEnabled';
const _kLastBackgroundSyncAtKey = 'smartcura.health.lastBackgroundSyncAt';

// ---------------------------------------------------------------------------
// Health Connect → SmartCura metric mapping (shared with the foreground sync)
// ---------------------------------------------------------------------------

/// Maps a Health Connect [HealthDataType] to the SmartCura ingestion wire
/// metric, canonical unit, and a per-metric ordinal used to derive a
/// deterministic [sequence_number].
class HealthMetricMapping {
  final HealthDataType type;
  final String wireMetric;
  final String unit;
  final int ordinal;

  /// Multiplier applied to the Health Connect value before POSTing to the
  /// backend. Most metrics need no conversion (1.0). Blood glucose is the
  /// exception: Health Connect returns mmol/L but the backend's
  /// `vital_readings_unit_check` requires mg/dL, so the value must be
  /// scaled by 18.0182 in addition to the unit string changing.
  final double valueMultiplier;

  const HealthMetricMapping({
    required this.type,
    required this.wireMetric,
    required this.unit,
    required this.ordinal,
    this.valueMultiplier = 1.0,
  });
}

/// The single source of truth for which Health Connect metrics SmartCura reads
/// and how each is mapped to the backend ingestion format.
///
/// Blood pressure is split into systolic and diastolic readings because
/// SmartCura stores them as individual metrics.
/// Units must match the backend's `VITAL_METRIC_UNITS` table exactly — both
/// the Zod `.refine()` on the ingestion schema and the PostgreSQL
/// `vital_readings_unit_check` CHECK constraint reject mismatched units.
/// Blood glucose is the one metric whose **value** must also be converted
/// (mmol/L → mg/dL, ×18.0182); the others are unit-string renames only.
const healthMetricMappings = <HealthMetricMapping>[
  // --- Clinical vitals ---
  HealthMetricMapping(
    type: HealthDataType.HEART_RATE,
    wireMetric: 'heart_rate',
    unit: '/min',
    ordinal: 0,
  ),
  HealthMetricMapping(
    type: HealthDataType.BLOOD_OXYGEN,
    wireMetric: 'oxygen_saturation',
    unit: '%',
    ordinal: 1,
  ),
  HealthMetricMapping(
    type: HealthDataType.BODY_TEMPERATURE,
    wireMetric: 'body_temperature',
    unit: 'Cel',
    ordinal: 2,
  ),
  HealthMetricMapping(
    type: HealthDataType.BLOOD_PRESSURE_SYSTOLIC,
    wireMetric: 'systolic_bp',
    unit: 'mm[Hg]',
    ordinal: 3,
  ),
  HealthMetricMapping(
    type: HealthDataType.BLOOD_PRESSURE_DIASTOLIC,
    wireMetric: 'diastolic_bp',
    unit: 'mm[Hg]',
    ordinal: 4,
  ),
  HealthMetricMapping(
    type: HealthDataType.RESPIRATORY_RATE,
    wireMetric: 'respiratory_rate',
    unit: '/min',
    ordinal: 5,
  ),
  HealthMetricMapping(
    type: HealthDataType.BLOOD_GLUCOSE,
    wireMetric: 'blood_glucose',
    unit: 'mg/dL',
    ordinal: 6,
    valueMultiplier: 18.0182,
  ),
  HealthMetricMapping(
    type: HealthDataType.WEIGHT,
    wireMetric: 'body_weight',
    unit: 'kg',
    ordinal: 7,
  ),
  // --- Activity / wellness metrics ---
  HealthMetricMapping(
    type: HealthDataType.STEPS,
    wireMetric: 'steps',
    unit: 'count',
    ordinal: 8,
  ),
  HealthMetricMapping(
    type: HealthDataType.DISTANCE_DELTA,
    wireMetric: 'distance',
    unit: 'm',
    ordinal: 9,
  ),
  HealthMetricMapping(
    type: HealthDataType.ACTIVE_ENERGY_BURNED,
    wireMetric: 'active_energy',
    unit: 'kcal',
    ordinal: 10,
  ),
  HealthMetricMapping(
    type: HealthDataType.BASAL_ENERGY_BURNED,
    wireMetric: 'basal_energy',
    unit: 'kcal',
    ordinal: 11,
  ),
  HealthMetricMapping(
    type: HealthDataType.SLEEP_ASLEEP,
    wireMetric: 'sleep_duration',
    unit: 'h',
    ordinal: 12,
    valueMultiplier: 1.0,
  ),
];

/// The Health Connect data types to request authorisation for, derived from
/// [healthMetricMappings] so the two can never disagree.
List<HealthDataType> get healthSyncTypes =>
    healthMetricMappings.map((m) => m.type).toList();

/// Extracts a numeric value from a [HealthDataPoint], returning null for
/// non-numeric value types (audiograms, workouts) so they are skipped.
double? extractHealthValue(HealthDataPoint point) {
  final value = point.value;
  if (value is NumericHealthValue) return value.numericValue.toDouble();
  if (value is AudiogramHealthValue) return null;
  if (value is WorkoutHealthValue) return null;
  return null;
}

/// Reads every supported metric from Health Connect over `[from, to]` and
/// returns the readings as POST-ready JSON maps with deterministic sequence
/// numbers so re-syncs deduplicate instead of duplicating.
///
/// This is isolate-safe: it takes a [Health] instance and returns plain maps,
/// with no dependency on Riverpod. Both the foreground notifier and the
/// background task call it.
Future<List<Map<String, dynamic>>> collectVitalReadingMaps(
  Health health, {
  required DateTime from,
  required DateTime to,
}) async {
  final readings = <Map<String, dynamic>>[];

  for (final mapping in healthMetricMappings) {
    try {
      final samples = await health.getHealthDataFromTypes(
        types: [mapping.type],
        startTime: from,
        endTime: to,
      );
      for (final sample in samples) {
        final value = extractHealthValue(sample);
        if (value == null) continue;
        // dateTo is the end of the measurement window and is the canonical
        // "recorded at" instant. In health 13.x both dateFrom and dateTo are
        // non-nullable.
        final recordedAt = sample.dateTo;

        readings.add(<String, dynamic>{
          'boot_id': 0,
          // Deterministic sequence_number so re-syncs of the same reading
          // deduplicate via (device_id, boot_id, sequence_number) instead of
          // creating duplicates. Millisecond timestamp plus a per-metric
          // ordinal ensures uniqueness within a batch.
          'sequence_number':
              recordedAt.millisecondsSinceEpoch * 10 + mapping.ordinal,
          'metric': mapping.wireMetric,
          'value': value * mapping.valueMultiplier,
          'unit': mapping.unit,
          'recorded_at': recordedAt.toUtc().toIso8601String(),
          'quality': 'valid',
        });
      }
    } on Object catch (_) {
      // A metric that Health Connect has no data for (or cannot read in the
      // background) is not a fatal error — skip it and continue.
      continue;
    }
  }

  return readings;
}

// ---------------------------------------------------------------------------
// Workmanager entry point (runs in a background isolate)
// ---------------------------------------------------------------------------

/// Top-level callback dispatcher registered with [Workmanager.initialize].
///
/// Must be a top-level (or static) function annotated
/// `@pragma('vm:entry-point')` so the Flutter tool retains it for the
/// background isolate.
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    if (task == healthSyncTaskName) {
      return performBackgroundHealthSync();
    }
    // Unknown task — nothing to do.
    return true;
  });
}

/// Performs the isolate-safe Health Connect → backend sync.
///
/// Returns `true` to mark the work item complete (periodic tasks should not
/// trigger WorkManager's retry storm). Errors are handled internally by
/// showing a reminder notification.
Future<bool> performBackgroundHealthSync() async {
  try {
    // 1. Enable platform channels in this background isolate. The token is
    //    registered by the root isolate; if it is unavailable here we cannot
    //    read secure storage or Health Connect, so we fall back to a reminder.
    final token = RootIsolateToken.instance;
    if (token != null) {
      BackgroundIsolateBinaryMessenger.ensureInitialized(token);
    }

    // 2. Read the session directly from secure storage (same keys as
    //    SessionStorage — no Riverpod available in this isolate).
    const storage = FlutterSecureStorage();
    final cookie = await storage.read(key: SessionStorage.sessionCookieKey);
    final csrf = await storage.read(key: SessionStorage.csrfTokenKey);
    if (cookie == null || cookie.isEmpty) {
      await _showSyncReminderNotification(reason: 'Sign in to sync vitals');
      return true;
    }

    // 3. A minimal Dio with the session cookie replayed manually, mirroring the
    //    foreground api_client interceptors (CSRF + idempotency on POST).
    final dio = Dio(BaseOptions(
      baseUrl: AppConstants.apiBaseUrl,
      connectTimeout: const Duration(seconds: 30),
      receiveTimeout: const Duration(seconds: 30),
      sendTimeout: const Duration(seconds: 30),
      headers: {
        'Accept': 'application/json, application/problem+json',
        'Cookie': '${AppConstants.sessionCookieName}=$cookie',
      },
      validateStatus: (s) => s != null && s >= 200 && s < 300,
    ));

    // 4. GET /profiles/me/devices — self-scoped; each device carries its own
    //    organization_id, so the org scope is resolved from the response
    //    without needing the Riverpod currentOrganizationIdProvider.
    final devResponse = await dio.get<void>(ApiEndpoints.profilesMeDevices);
    final devBody = devResponse.data as Map<String, dynamic>;
    final devicesRaw = (devBody['data'] as List<dynamic>)
        .whereType<Map<String, dynamic>>()
        .toList();
    if (devicesRaw.isEmpty) {
      await _showSyncReminderNotification(
        reason: 'No device assigned to your profile',
      );
      return true;
    }

    // Prefer a phone-typed device (the one registered for Health Connect),
    // falling back to the first device — same logic as the foreground sync.
    final target = devicesRaw.firstWhere(
      (d) => (d['device_type'] as String?) == 'phone',
      orElse: () => devicesRaw.first,
    );
    final deviceId = target['id'] as String;
    final orgId = target['organization_id'] as String;

    // 5. Read Health Connect (last 24h). Authorization must have been granted
    //    in the foreground; we do not call requestAuthorization here because
    //    there is no UI to show the consent dialog.
    final health = Health();
    final now = DateTime.now();
    final from = now.subtract(const Duration(hours: 24));
    final readingMaps =
        await collectVitalReadingMaps(health, from: from, to: now);

    if (readingMaps.isEmpty) {
      // No new data — not an error. Record the attempt and finish.
      await _recordLastSyncAt(now);
      return true;
    }

    // 6. POST to the existing device ingestion endpoint.
    await dio.post<void>(
      ApiEndpoints.deviceVitalReadings(orgId, deviceId),
      data: {'readings': readingMaps},
      options: Options(headers: <String, dynamic>{
        if (csrf != null && csrf.isNotEmpty) AppConstants.csrfHeader: csrf,
        AppConstants.idempotencyKeyHeader: const Uuid().v4(),
      }),
    );

    await _recordLastSyncAt(now);
    return true;
  } on Object catch (_) {
    // Any failure (network, expired session, Health Connect blocked in the
    // background, missing platform-channel token) → remind the user to open
    // the app rather than crashing the background task.
    await _showSyncReminderNotification(reason: 'Sync paused');
    return true;
  }
}

// ---------------------------------------------------------------------------
// Preferences + scheduling (callable from the UI / main.dart)
// ---------------------------------------------------------------------------

/// Whether the user has enabled background auto-sync. Defaults to false.
Future<bool> getAutoSyncEnabled() async {
  final prefs = await SharedPreferences.getInstance();
  return prefs.getBool(_kAutoSyncEnabledKey) ?? false;
}

/// Persists the auto-sync toggle. Does NOT register/cancel the task — the
/// caller does that via [registerBackgroundHealthSync] /
/// [cancelBackgroundHealthSync] so the two stay in sync.
Future<void> setAutoSyncEnabled(bool enabled) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setBool(_kAutoSyncEnabledKey, enabled);
}

/// The last time the background sync ran (regardless of outcome), or null.
Future<DateTime?> getLastBackgroundSyncAt() async {
  final prefs = await SharedPreferences.getInstance();
  final value = prefs.getString(_kLastBackgroundSyncAtKey);
  if (value == null) return null;
  return DateTime.tryParse(value);
}

Future<void> _recordLastSyncAt(DateTime when) async {
  final prefs = await SharedPreferences.getInstance();
  await prefs.setString(_kLastBackgroundSyncAtKey, when.toIso8601String());
}

/// Registers the periodic Health Connect sync task.
///
/// Uses [ExistingPeriodicWorkPolicy.keep] so re-registration (e.g. on every
/// app launch while the toggle is on) does not duplicate the work. Runs at the
/// 15-minute WorkManager minimum, only on a connected network and when the
/// battery is not low.
Future<void> registerBackgroundHealthSync() async {
  await Workmanager().registerPeriodicTask(
    healthSyncTaskUniqueName,
    healthSyncTaskName,
    frequency: const Duration(minutes: 15),
    existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
    constraints: Constraints(
      networkType: NetworkType.connected,
      requiresBatteryNotLow: true,
    ),
  );
}

/// Cancels the periodic Health Connect sync task.
Future<void> cancelBackgroundHealthSync() async {
  await Workmanager().cancelByUniqueName(healthSyncTaskUniqueName);
}

// ---------------------------------------------------------------------------
// Notification fallback
// ---------------------------------------------------------------------------

const _notificationChannelId = 'smartcura_health_sync';

/// Shows a low-priority local notification prompting the user to open the app
/// to sync. Best-effort: any failure is swallowed so the background task never
/// crashes because of the notification plumbing.
Future<void> _showSyncReminderNotification({required String reason}) async {
  try {
    final plugin = FlutterLocalNotificationsPlugin();
    const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
    const iosInit = DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    );
    await plugin.initialize(
      const InitializationSettings(android: androidInit, iOS: iosInit),
    );

    // Ensure a channel exists on Android 8+.
    const channel = AndroidNotificationChannel(
      _notificationChannelId,
      'Health Sync',
      description: 'Reminders to sync vitals from your watch',
      importance: Importance.defaultImportance,
    );
    await plugin
        .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(channel);

    const androidDetails = AndroidNotificationDetails(
      _notificationChannelId,
      'Health Sync',
      importance: Importance.defaultImportance,
      priority: Priority.defaultPriority,
    );
    const iosDetails = DarwinNotificationDetails();
    const details =
        NotificationDetails(android: androidDetails, iOS: iosDetails);

    await plugin.show(
      0,
      'Sync your vitals',
      '$reason. Open SmartCura to sync from your watch.',
      details,
    );
  } on Object catch (_) {
    // Notifications are best-effort; never fail the task because of them.
  }
}
