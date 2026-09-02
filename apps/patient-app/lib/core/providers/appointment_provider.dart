import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';

// Replaces: lib/core/providers/mock_data_provider.dart (mockAppointmentsProvider)
//
// Screens that previously imported mock data and must be updated in Phase 2:
//   - lib/features/consultations/presentation/screens/appointments_screen.dart
//     (used ref.watch(mockAppointmentsProvider))
//   - lib/features/home/presentation/screens/home_screen.dart
//     (used ref.watch(mockAppointmentsProvider))

// ---------------------------------------------------------------------------
// Mappers for appointment-related generated types (snake_case wire → typed)
// ---------------------------------------------------------------------------

class AppointmentMapper {
  static Appointment fromJson(Map<String, dynamic> j) => Appointment(
        id: j['id'] as String,
        slotId: j['slot_id'] as String,
        patientProfileId: j['patient_profile_id'] as String,
        doctorMembershipId: j['doctor_membership_id'] as String,
        organizationId: j['organization_id'] as String,
        mode: appointmentModeFromWire(j['mode'] as String),
        status: appointmentStatusFromWire(j['status'] as String),
        startsAt: j['starts_at'] as String,
        endsAt: j['ends_at'] as String,
        feeSen: (j['fee_sen'] as num).toInt(),
        currency: j['currency'] as String,
        paymentState: j['payment_state'] == null
            ? null
            : appointmentPaymentStateFromWire(j['payment_state'] as String),
        cancellationReasonCode: j['cancellation_reason_code'] == null
            ? null
            : appointmentReasonCodeFromWire(
                j['cancellation_reason_code'] as String),
        replacedByAppointmentId: j['replaced_by_appointment_id'] as String?,
        version: (j['version'] as num).toInt(),
        createdAt: j['created_at'] as String,
        updatedAt: j['updated_at'] as String,
      );
}

class AppointmentListMapper {
  static List<Appointment> fromJson(Map<String, dynamic> j) =>
      (j['data'] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .map(AppointmentMapper.fromJson)
          .toList();
}

class AvailabilitySlotMapper {
  static AvailabilitySlot fromJson(Map<String, dynamic> j) => AvailabilitySlot(
        id: j['id'] as String,
        membershipId: j['membership_id'] as String,
        organizationId: j['organization_id'] as String,
        startsAt: j['starts_at'] as String,
        endsAt: j['ends_at'] as String,
        state: j['state'] as String,
        version: (j['version'] as num).toInt(),
      );
}

class AvailabilitySlotListMapper {
  static List<AvailabilitySlot> fromJson(Map<String, dynamic> j) =>
      (j['data'] as List<dynamic>)
          .whereType<Map<String, dynamic>>()
          .map(AvailabilitySlotMapper.fromJson)
          .toList();
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// All appointments for the current patient (self-scoped).
/// Backend: GET /appointments
final appointmentsProvider = FutureProvider<List<Appointment>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.appointments);
  return AppointmentListMapper.fromJson(response.data as Map<String, dynamic>);
});

/// The next upcoming appointment (single, or null).
/// Backend: GET /profiles/me/appointments/next
final nextAppointmentProvider = FutureProvider<Appointment?>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.profilesMeAppointmentsNext);
  if (response.data == null) return null;
  return AppointmentMapper.fromJson(response.data as Map<String, dynamic>);
});

/// A single appointment by id.
/// Backend: GET /appointments/{id}
final appointmentDetailProvider =
    FutureProvider.family<Appointment, String>((ref, id) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.appointment(id));
  return AppointmentMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Input for [appointmentSlotsProvider].
class AppointmentSlotsParams {
  final String organizationId;
  final String? membershipId;
  final DateTime from;
  final DateTime to;

  const AppointmentSlotsParams({
    required this.organizationId,
    this.membershipId,
    required this.from,
    required this.to,
  });

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AppointmentSlotsParams &&
          organizationId == other.organizationId &&
          membershipId == other.membershipId &&
          from.toIso8601String() == other.from.toIso8601String() &&
          to.toIso8601String() == other.to.toIso8601String();

  @override
  int get hashCode => Object.hash(
        organizationId,
        membershipId,
        from.toIso8601String(),
        to.toIso8601String(),
      );
}

/// Availability slots for a given organization, optionally filtered by doctor.
/// Backend: GET /organizations/{orgId}/appointment-slots?from=...&to=...&membership_id=...
///
/// The `from` and `to` parameters are **required** by the API. Without them
/// the server returns 422 VALIDATION_FAILED.
final appointmentSlotsProvider =
    FutureProvider.family<List<AvailabilitySlot>, AppointmentSlotsParams>(
        (ref, params) async {
  final dio = ref.watch(apiClientProvider);
  final queryParams = <String, dynamic>{
    'from': params.from.toUtc().toIso8601String(),
    'to': params.to.toUtc().toIso8601String(),
    'page_size': 100,
  };
  if (params.membershipId != null) {
    queryParams['membership_id'] = params.membershipId;
  }
  final response = await dio.get(
    ApiEndpoints.appointmentSlots(params.organizationId),
    queryParameters: queryParams,
  );
  return AvailabilitySlotListMapper.fromJson(
      response.data as Map<String, dynamic>);
});

/// Booking / cancellation / reschedule mutations.
final bookingMutationProvider =
    StateNotifierProvider<BookingMutationNotifier, AsyncValue<Appointment?>>(
        (ref) => BookingMutationNotifier(ref));

class BookingMutationNotifier extends StateNotifier<AsyncValue<Appointment?>> {
  final Ref _ref;
  BookingMutationNotifier(this._ref) : super(const AsyncValue.data(null));

  /// Book an appointment for a slot.
  /// Backend: POST /organizations/{orgId}/appointments with body { slot_id, mode }
  Future<Appointment?> book({
    required String slotId,
    required AppointmentMode mode,
    required String organizationId,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      final response = await dio.post(
        ApiEndpoints.orgAppointments(organizationId),
        data: {
          'slot_id': slotId,
          'mode': mode.wireValue,
        },
      );
      final appointment =
          AppointmentMapper.fromJson(response.data as Map<String, dynamic>);
      state = AsyncValue.data(appointment);
      // Invalidate the appointments list so it refetches.
      _ref.invalidate(appointmentsProvider);
      return appointment;
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
      return null;
    }
  }

  /// Cancel an appointment. The schema requires a reason code + expected version.
  /// Backend: POST /appointments/{id}/status
  Future<void> cancel({
    required String appointmentId,
    required AppointmentCancellationReasonCode reasonCode,
    required int expectedVersion,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.post(
        ApiEndpoints.appointmentStatus(appointmentId),
        data: {
          'status': 'cancelled',
          'reason_code': reasonCode.wireValue,
          'expected_version': expectedVersion,
        },
      );
      state = const AsyncValue.data(null);
      _ref.invalidate(appointmentsProvider);
      _ref.invalidate(appointmentDetailProvider(appointmentId));
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
    }
  }

  /// Reschedule to a new slot.
  /// Backend: POST /appointments/{id}/reschedule
  Future<Appointment?> reschedule({
    required String appointmentId,
    required String newSlotId,
    AppointmentMode? mode,
    required int expectedVersion,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      final response = await dio.post(
        ApiEndpoints.appointmentReschedule(appointmentId),
        data: {
          'slot_id': newSlotId,
          if (mode != null) 'mode': mode.wireValue,
          'expected_version': expectedVersion,
        },
      );
      final appointment =
          AppointmentMapper.fromJson(response.data as Map<String, dynamic>);
      state = AsyncValue.data(appointment);
      _ref.invalidate(appointmentsProvider);
      _ref.invalidate(appointmentDetailProvider(appointmentId));
      return appointment;
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
      return null;
    }
  }
}
