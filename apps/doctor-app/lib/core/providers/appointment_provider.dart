import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Filter for the appointments list. `status` is the wire value of an
/// [AppointmentStatus] (e.g. `confirmed`, `completed`); null returns the
/// default mix. `cursor` pages forward. `pageSize` is honored by the backend
/// `PageSize` parameter (defaults to the server default if not supplied).
class AppointmentFilter {
  const AppointmentFilter({this.status, this.cursor, this.pageSize});
  final String? status;
  final String? cursor;
  final int? pageSize;
}

/// Paginated appointments list, filtered by optional status.
final appointmentsProvider =
    FutureProvider.family<AppointmentListResponse, AppointmentFilter>(
        (ref, filter) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.appointments,
      queryParameters: cleanQuery({
        'status': filter.status,
        'cursor': filter.cursor,
        'page_size': filter.pageSize,
      }),
    );
    return decodeAppointmentListResponse(body);
  });
});

/// Read-one appointment by id.
final appointmentDetailProvider =
    FutureProvider.family<Appointment, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.appointment(id));
    return decodeAppointment(body);
  });
});

/// State for an in-flight appointment status transition (PUT /appointments/{id}/status).
class AppointmentTransitionState {
  const AppointmentTransitionState(
      {this.value, this.error, this.loading = false});
  final Appointment? value;
  final ApiError? error;
  final bool loading;
  bool get isIdle => !loading && value == null && error == null;
}

/// Notifier that performs an optimistic-ish status transition: it loads the
/// returned appointment and lets the caller invalidate the list/detail providers.
class AppointmentTransitionNotifier
    extends StateNotifier<AppointmentTransitionState> {
  AppointmentTransitionNotifier(this._api)
      : super(const AppointmentTransitionState());
  final ApiClient _api;

  Future<bool> transition({
    required String appointmentId,
    required String status,
    required int expectedVersion,
    AppointmentCancellationReasonCode? cancellationReasonCode,
    AppointmentNoShowReasonCode? noShowReasonCode,
  }) async {
    state = const AppointmentTransitionState(loading: true);
    try {
      final body = await _api.put(
        ApiEndpoints.appointmentStatus(appointmentId),
        body: <String, dynamic>{
          'status': status,
          'expected_version': expectedVersion,
          if (cancellationReasonCode != null)
            'reason_code': cancellationReasonCode.wireValue,
          if (noShowReasonCode != null)
            'reason_code': noShowReasonCode.wireValue,
        },
      );
      final updated = decodeAppointment(body);
      state = AppointmentTransitionState(value: updated);
      return true;
    } catch (e) {
      final err = toApiError(e);
      state = AppointmentTransitionState(error: err);
      return false;
    }
  }

  void reset() => state = const AppointmentTransitionState();
}

final appointmentTransitionProvider = StateNotifierProvider.autoDispose<
        AppointmentTransitionNotifier, AppointmentTransitionState>(
    (ref) => AppointmentTransitionNotifier(ref.watch(apiClientProvider)));

/// Reschedule an appointment onto a new slot (POST /appointments/{id}/reschedule).
/// Returns the new rescheduled appointment's id on success.
Future<String?> rescheduleAppointment(
  WidgetRef ref, {
  required String appointmentId,
  required String slotId,
  AppointmentMode? mode,
  required int expectedVersion,
}) async {
  final api = ref.read(apiClientProvider);
  final body = await api.post(
    '/appointments/$appointmentId/reschedule',
    body: <String, dynamic>{
      'slot_id': slotId,
      if (mode != null) 'mode': mode.wireValue,
      'expected_version': expectedVersion,
    },
  );
  return body['id'] as String?;
}
