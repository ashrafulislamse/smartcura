import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../auth/auth_provider.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';

// No direct mock replacement — emergency was previously UI-only.
//
// Screens that must be updated in Phase 2:
//   - lib/features/emergency/presentation/screens/emergency_sos_screen.dart
//   - lib/features/emergency/presentation/screens/emergency_contacts_setup_screen.dart

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

class EmergencyEventViewMapper {
  static EmergencyEventView fromJson(Map<String, dynamic> j) =>
      EmergencyEventView(
        emergencyEventId: j['emergency_event_id'] as String,
        status: emergencyEventStatusFromWire(j['status'] as String),
        triagePriority: triagePriorityFromWire(j['triage_priority'] as String),
        categoryCode: j['category_code'] as String,
        version: (j['version'] as num).toInt(),
      );
}

class EmergencyEventCreatedMapper {
  static EmergencyEventCreated fromJson(Map<String, dynamic> j) =>
      EmergencyEventCreated(
        emergencyEventId: j['emergency_event_id'] as String,
        status: emergencyEventStatusFromWire(j['status'] as String),
        triagePriority: triagePriorityFromWire(j['triage_priority'] as String),
        version: (j['version'] as num).toInt(),
      );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// A single emergency event by id.
/// Backend: GET /emergencies/{id}
final emergencyEventProvider =
    FutureProvider.family<EmergencyEventView, String>((ref, id) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.emergency(id));
  return EmergencyEventViewMapper.fromJson(
      response.data as Map<String, dynamic>);
});

/// Raise an emergency (SOS). The organization id is required by the backend and
/// comes from the current membership.
/// Backend: POST /emergencies
final raiseEmergencyProvider = StateNotifierProvider<RaiseEmergencyNotifier,
    AsyncValue<EmergencyEventCreated?>>((ref) => RaiseEmergencyNotifier(ref));

class RaiseEmergencyNotifier
    extends StateNotifier<AsyncValue<EmergencyEventCreated?>> {
  final Ref _ref;
  RaiseEmergencyNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<EmergencyEventCreated?> raise({
    required String categoryCode,
    String? latitude,
    String? longitude,
    String? addressText,
  }) async {
    state = const AsyncValue.loading();
    final orgId = _ref.read(currentOrganizationIdProvider);
    if (orgId == null) {
      state = AsyncValue.error(
        const ApiError(
          status: 0,
          code: 'NO_ORGANIZATION',
          title: 'No organization',
          detail: 'You are not a member of any organization.',
        ),
        StackTrace.current,
      );
      return null;
    }
    try {
      final dio = _ref.read(apiClientProvider);
      final response = await dio.post(
        ApiEndpoints.emergencies,
        data: {
          'organization_id': orgId,
          'category_code': categoryCode,
          if (latitude != null) 'latitude': latitude,
          if (longitude != null) 'longitude': longitude,
          if (addressText != null) 'address_text': addressText,
        },
      );
      final created = EmergencyEventCreatedMapper.fromJson(
          response.data as Map<String, dynamic>);
      state = AsyncValue.data(created);
      return created;
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
      return null;
    }
  }
}

/// Advance or resolve an emergency event.
/// Backend: PUT /emergencies/{id}/status, POST /emergencies/{id}/resolution
final emergencyMutationProvider =
    StateNotifierProvider<EmergencyMutationNotifier, AsyncValue<void>>(
        (ref) => EmergencyMutationNotifier(ref));

class EmergencyMutationNotifier extends StateNotifier<AsyncValue<void>> {
  final Ref _ref;
  EmergencyMutationNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<void> advance({
    required String eventId,
    required String status,
    String? reasonCode,
    required int expectedVersion,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.put(
        '${ApiEndpoints.emergency(eventId)}/status',
        data: {
          'status': status,
          if (reasonCode != null) 'reason_code': reasonCode,
          'expected_version': expectedVersion,
        },
      );
      state = const AsyncValue.data(null);
      _ref.invalidate(emergencyEventProvider(eventId));
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
    }
  }

  Future<void> resolve({
    required String eventId,
    required String resolutionType,
    required String notes,
    String? outcomeCode,
    required int expectedVersion,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.post(
        '${ApiEndpoints.emergency(eventId)}/resolution',
        data: {
          'resolution_type': resolutionType,
          'notes': notes,
          if (outcomeCode != null) 'outcome_code': outcomeCode,
          'expected_version': expectedVersion,
        },
      );
      state = const AsyncValue.data(null);
      _ref.invalidate(emergencyEventProvider(eventId));
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
    }
  }
}
