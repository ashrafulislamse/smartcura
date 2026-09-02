import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Filter for the driver assignments list. The `status` field carries a
/// [DispatchAssignmentStatus] wire value (e.g. `en_route_pickup`,
/// `completed`). When null, all assignments are returned.
class DriverAssignmentFilter {
  const DriverAssignmentFilter({this.status, this.cursor});
  final String? status; // wire value of [DispatchAssignmentStatus]
  final String? cursor;
}

/// The acting driver's assignments (`GET /drivers/me/assignments?status=`).
/// Filter by an optional assignment status ('active', 'completed', 'all') and
/// cursor. Returns [DispatchAssignmentSummary] items carrying assignment_id,
/// dispatch_job_id, status, assigned_at, completed_at, fee_sen, and version.
final driverAssignmentsProvider =
    FutureProvider.family<List<DispatchAssignmentSummary>, DriverAssignmentFilter>(
        (ref, filter) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.driversMeAssignments,
      queryParameters: cleanQuery({
        'status': filter.status,
        'cursor': filter.cursor,
      }),
    );
    return decodeDriverAssignmentSummaries(body);
  });
});

/// Outcome of an advance-assignment mutation.
class AdvanceAssignmentState {
  const AdvanceAssignmentState({this.value, this.error, this.loading = false});
  final DispatchAssignmentState? value;
  final ApiError? error;
  final bool loading;
}

/// Advance an assignment one step, or cancel or fail it
/// (`PUT /dispatch/assignments/{assignment_id}/status`). Skipping a step is
/// refused server-side, so a delivery cannot complete without `picked_up`.
/// The body carries the target `status` (a [DispatchAssignmentStatus] wire
/// value), an optional `reason_code` (required for `cancelled` and `failed`),
/// and the `expected_version` for optimistic concurrency.
class AdvanceAssignmentNotifier extends StateNotifier<AdvanceAssignmentState> {
  AdvanceAssignmentNotifier(this._api)
      : super(const AdvanceAssignmentState());
  final ApiClient _api;

  Future<bool> call({
    required String assignmentId,
    required String status,
    String? reasonCode,
    required int expectedVersion,
  }) async {
    state = const AdvanceAssignmentState(loading: true);
    try {
      final body = await _api.put(
        ApiEndpoints.dispatchAssignmentStatus(assignmentId),
        body: <String, dynamic>{
          'status': status,
          if (reasonCode != null) 'reason_code': reasonCode,
          'expected_version': expectedVersion,
        },
      );
      state = AdvanceAssignmentState(value: decodeDispatchAssignmentState(body));
      return true;
    } catch (e) {
      state = AdvanceAssignmentState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const AdvanceAssignmentState();
}

final advanceAssignmentNotifier = StateNotifierProvider.autoDispose<
    AdvanceAssignmentNotifier, AdvanceAssignmentState>(
    (ref) => AdvanceAssignmentNotifier(ref.watch(apiClientProvider)));
