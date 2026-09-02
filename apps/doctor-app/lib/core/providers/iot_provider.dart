import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Devices assigned within the doctor's scope (`GET /doctor/devices`).
final doctorDevicesProvider =
    FutureProvider.family<DoctorDeviceList, String?>((ref, cursor) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.doctorDevices,
      queryParameters: cleanQuery({'cursor': cursor}),
    );
    return decodeDoctorDeviceList(body);
  });
});

/// Vital readings for a patient (`GET /patients/{id}/vital-readings`). Filter by
/// an optional metric and date window.
class VitalReadingsFilter {
  const VitalReadingsFilter({this.metric, this.from, this.to, this.cursor});
  final String? metric; // wire value of [VitalMetric]
  final String? from; // ISO date
  final String? to;
  final String? cursor;
}

final patientVitalReadingsProvider =
    FutureProvider.family<VitalReadingListResponse, (String, VitalReadingsFilter)>(
        (ref, params) async {
  final api = ref.watch(apiClientProvider);
  final (patientId, filter) = params;
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.patientVitalReadings(patientId),
      queryParameters: cleanQuery({
        'metric': filter.metric,
        'from': filter.from,
        'to': filter.to,
        'cursor': filter.cursor,
      }),
    );
    return decodeVitalReadingListResponse(body);
  });
});

/// Health alerts for a patient (`GET /patients/{id}/health-alerts`). Filter by
/// an optional state and cursor.
class HealthAlertsFilter {
  const HealthAlertsFilter({this.state, this.cursor});
  final String? state; // wire value of [HealthAlertState]
  final String? cursor;
}

final patientHealthAlertsProvider =
    FutureProvider.family<HealthAlertListResponse, (String, HealthAlertsFilter)>(
        (ref, params) async {
  final api = ref.watch(apiClientProvider);
  final (patientId, filter) = params;
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.patientHealthAlerts(patientId),
      queryParameters: cleanQuery({
        'state': filter.state,
        'cursor': filter.cursor,
      }),
    );
    return decodeHealthAlertListResponse(body);
  });
});

/// Outcome for alert mutations.
class AlertMutationState {
  const AlertMutationState({this.value, this.error, this.loading = false});
  final HealthAlert? value;
  final ApiError? error;
  final bool loading;
}

/// Acknowledge an open health alert (`POST /health-alerts/{id}/acknowledge`).
/// Requires the alert's `expectedVersion` for optimistic concurrency.
class AcknowledgeAlertNotifier extends StateNotifier<AlertMutationState> {
  AcknowledgeAlertNotifier(this._api) : super(const AlertMutationState());
  final ApiClient _api;

  Future<bool> call({
    required String alertId,
    required int expectedVersion,
  }) async {
    state = const AlertMutationState(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.healthAlertAcknowledge(alertId),
        body: <String, dynamic>{'expected_version': expectedVersion},
      );
      state = AlertMutationState(value: decodeHealthAlert(body));
      return true;
    } catch (e) {
      state = AlertMutationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const AlertMutationState();
}

final acknowledgeAlertProvider = StateNotifierProvider.autoDispose<
    AcknowledgeAlertNotifier, AlertMutationState>(
    (ref) => AcknowledgeAlertNotifier(ref.watch(apiClientProvider)));

/// Transition a health alert's state (`PUT /health-alerts/{id}/state`), e.g.
/// escalate or resolve.
class AlertStateNotifier extends StateNotifier<AlertMutationState> {
  AlertStateNotifier(this._api) : super(const AlertMutationState());
  final ApiClient _api;

  Future<bool> call(TransitionHealthAlertRequest req,
      {required String alertId}) async {
    state = const AlertMutationState(loading: true);
    try {
      final body = await _api.put(
        ApiEndpoints.healthAlertState(alertId),
        body: <String, dynamic>{
          'state': req.state,
          'reason_code': req.reasonCode,
          if (req.escalatedToMembershipId != null)
            'escalated_to_membership_id': req.escalatedToMembershipId,
          'expected_version': req.expectedVersion,
        },
      );
      state = AlertMutationState(value: decodeHealthAlert(body));
      return true;
    } catch (e) {
      state = AlertMutationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const AlertMutationState();
}

final alertStateProvider = StateNotifierProvider.autoDispose<
    AlertStateNotifier, AlertMutationState>(
    (ref) => AlertStateNotifier(ref.watch(apiClientProvider)));
