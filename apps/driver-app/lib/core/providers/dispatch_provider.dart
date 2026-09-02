import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Open dispatch offers for the acting driver (`GET /dispatch/offers`).
/// Responses are no-store and carry no recipient identity.
final dispatchOffersProvider = FutureProvider<DispatchOfferList>((ref) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.dispatchOffers);
    return decodeDispatchOfferList(body);
  });
});

/// Outcome of an accept-offer mutation.
class AcceptOfferState {
  const AcceptOfferState({this.value, this.error, this.loading = false});
  final DispatchAssignmentCreated? value;
  final ApiError? error;
  final bool loading;
}

/// Accept a dispatch offer (`POST /dispatch/offers/{offer_id}/acceptance`).
/// Creates the assignment and withdraws competing offers. The body carries the
/// selected `vehicle_id` (optional) and the `expected_version` for optimistic
/// concurrency. On success, returns the created [DispatchAssignmentCreated].
class AcceptOfferNotifier extends StateNotifier<AcceptOfferState> {
  AcceptOfferNotifier(this._api) : super(const AcceptOfferState());
  final ApiClient _api;

  Future<bool> call({
    required String offerId,
    String? vehicleId,
    required int expectedVersion,
  }) async {
    state = const AcceptOfferState(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.dispatchOfferAccept(offerId),
        body: <String, dynamic>{
          if (vehicleId != null) 'vehicle_id': vehicleId,
          'expected_version': expectedVersion,
        },
      );
      state = AcceptOfferState(value: decodeDispatchAssignmentCreated(body));
      return true;
    } catch (e) {
      state = AcceptOfferState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const AcceptOfferState();
}

final acceptOfferNotifier =
    StateNotifierProvider.autoDispose<AcceptOfferNotifier, AcceptOfferState>(
        (ref) => AcceptOfferNotifier(ref.watch(apiClientProvider)));

/// Read one assignment owned by the calling driver
/// (`GET /dispatch/assignments/{assignment_id}`). Returns the joined
/// summary shape (assignment id, dispatch job id, status, assigned and
/// completed timestamps, fee, version) so screens that need the fee can
/// render it without an extra round-trip.
final dispatchAssignmentProvider =
    FutureProvider.family<DispatchAssignmentSummary, String>(
        (ref, assignmentId) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.dispatchAssignment(assignmentId));
    return decodeDispatchAssignmentSummary(body);
  });
});

/// Recipient disclosure for an active assignment
/// (`GET /dispatch/assignments/{id}/recipient`). Minimum-necessary disclosure,
/// gated on the requesting driver holding an active assignment for the delivery.
final dispatchAssignmentRecipientProvider =
    FutureProvider.family<RecipientDisclosure, String>(
        (ref, assignmentId) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body =
        await api.get(ApiEndpoints.dispatchAssignmentRecipient(assignmentId));
    return decodeRecipientDisclosure(body);
  });
});

/// Navigation stops for an active assignment
/// (`GET /dispatch/assignments/{id}/stops`). Ordered pickup then dropoff, with
/// coordinates as decimal-degree strings. A concealed 404 means the assignment
/// is unknown, foreign, or no longer active — the map falls back to a
/// driver-only view, matching the pre-stops behaviour.
final dispatchAssignmentStopsProvider =
    FutureProvider.family<DispatchAssignmentStops, String>(
        (ref, assignmentId) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body =
        await api.get(ApiEndpoints.dispatchAssignmentStops(assignmentId));
    return decodeDispatchAssignmentStops(body);
  });
});

/// Records a driver location waypoint
/// (`POST /dispatch/assignments/{assignment_id}/waypoints`, HTTP 202). The
/// server throttles ordinary points to one every 15 seconds; `throttled` is a
/// normal outcome, not an error, so callers must not retry on it.
class RecordWaypointNotifier extends StateNotifier<bool> {
  RecordWaypointNotifier(this._api) : super(false);
  final ApiClient _api;

  /// Returns true when the call completed (stored OR throttled); false only on
  /// a transport/error failure. Fire-and-forget by design: navigation must
  /// never block on telemetry.
  Future<bool> call({
    required String assignmentId,
    required double latitude,
    required double longitude,
    double? accuracyMetres,
    required bool significant,
  }) async {
    try {
      await _api.post(
        ApiEndpoints.dispatchAssignmentWaypoints(assignmentId),
        body: <String, dynamic>{
          'latitude': latitude,
          'longitude': longitude,
          if (accuracyMetres != null) 'accuracy_metres': accuracyMetres.round(),
          'significant': significant,
          'recorded_at': DateTime.now().toUtc().toIso8601String(),
        },
      );
      return true;
    } catch (_) {
      // Location telemetry is best-effort: a lost point is preferable to a
      // retry storm on a flaky mobile connection.
      return false;
    }
  }
}

final recordWaypointNotifier =
    StateNotifierProvider.autoDispose<RecordWaypointNotifier, bool>(
        (ref) => RecordWaypointNotifier(ref.watch(apiClientProvider)));
