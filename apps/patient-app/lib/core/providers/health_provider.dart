import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';

// Replaces: lib/core/providers/iot_data_provider.dart (DeviceReading partial)
// and lib/core/providers/mock_data_provider.dart (health mock data)
//
// Screens that previously imported mock data and must be updated in Phase 2:
//   - lib/features/health/presentation/screens/health_screen.dart
//   - lib/features/health/presentation/screens/enter_vitals_screen.dart
//   - lib/features/home/presentation/screens/home_screen.dart

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

class VitalReadingMapper {
  static VitalReading fromJson(Map<String, dynamic> j) => VitalReading(
        id: j['id'] as String,
        deviceId: j['device_id'] as String,
        patientProfileId: j['patient_profile_id'] as String,
        metric: vitalMetricFromWire(j['metric'] as String),
        value: (j['value'] as num).toDouble(),
        unit: j['unit'] as String,
        recordedAt: j['recorded_at'] as String,
        ingestedAt: j['ingested_at'] as String,
        quality: vitalReadingQualityFromWire(j['quality'] as String),
      );
}

class VitalReadingListMapper {
  static List<VitalReading> fromJson(Map<String, dynamic> j) =>
      (j['data'] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .map(VitalReadingMapper.fromJson)
          .toList();
}

class HealthAlertMapper {
  static HealthAlert fromJson(Map<String, dynamic> j) => HealthAlert(
        id: j['id'] as String,
        organizationId: j['organization_id'] as String,
        patientProfileId: j['patient_profile_id'] as String,
        deviceId: j['device_id'] as String,
        metric: vitalMetricFromWire(j['metric'] as String),
        observedValue: (j['observed_value'] as num).toDouble(),
        thresholdId: j['threshold_id'] as String,
        severity: healthAlertSeverityFromWire(j['severity'] as String),
        state: healthAlertStateFromWire(j['state'] as String),
        observedAt: j['observed_at'] as String,
        acknowledgedByProfileId: j['acknowledged_by_profile_id'] as String?,
        acknowledgedAt: j['acknowledged_at'] as String?,
        resolvedAt: j['resolved_at'] as String?,
        version: (j['version'] as num).toInt(),
        createdAt: j['created_at'] as String,
        updatedAt: j['updated_at'] as String,
      );
}

class HealthAlertListMapper {
  static List<HealthAlert> fromJson(Map<String, dynamic> j) =>
      (j['data'] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .map(HealthAlertMapper.fromJson)
          .toList();
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// Vital readings for the current patient (self-scoped).
/// Backend: GET /profiles/me/vital-readings
final vitalReadingsProvider =
    FutureProvider<List<VitalReading>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.profilesMeVitalReadings);
  return VitalReadingListMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Vital readings filtered by metric (e.g. heart_rate, oxygen_saturation).
/// Uses the same endpoint with a query parameter.
final vitalReadingsByMetricProvider =
    FutureProvider.family<List<VitalReading>, VitalMetric>((ref, metric) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(
    ApiEndpoints.profilesMeVitalReadings,
    queryParameters: {'metric': metric.wireValue},
  );
  return VitalReadingListMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Health alerts for the current patient (self-scoped).
/// Backend: GET /profiles/me/health-alerts
final healthAlertsProvider =
    FutureProvider<List<HealthAlert>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.profilesMeHealthAlerts);
  return HealthAlertListMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Acknowledge a health alert.
/// Backend: POST /profiles/me/health-alerts/{id}/acknowledge
final acknowledgeAlertProvider =
    StateNotifierProvider<AcknowledgeAlertNotifier, AsyncValue<void>>(
        (ref) => AcknowledgeAlertNotifier(ref));

class AcknowledgeAlertNotifier extends StateNotifier<AsyncValue<void>> {
  final Ref _ref;
  AcknowledgeAlertNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<void> acknowledge({
    required String alertId,
    required int expectedVersion,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.post(
        '/profiles/me/health-alerts/$alertId/acknowledge',
        data: {'expected_version': expectedVersion},
      );
      state = const AsyncValue.data(null);
      _ref.invalidate(healthAlertsProvider);
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"), StackTrace.current);
    }
  }
}
