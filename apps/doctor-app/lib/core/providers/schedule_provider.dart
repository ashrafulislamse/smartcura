import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Availability rules for a membership (`GET /memberships/{id}/availability-rules`).
/// Carries the rules, the rule-set version (for optimistic concurrency), and the
/// count of slots generated at the last write. This is the canonical read for
/// the schedule screen; availability slots themselves are a generation action,
/// not a list read (see [generateSlots]).
final availabilityRulesProvider =
    FutureProvider.family<AvailabilityRulesResponse, String>(
        (ref, membershipId) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.availabilityRules(membershipId));
    return decodeAvailabilityRulesResponse(body);
  });
});

/// Date-range filter for reading generated availability slots
/// (`GET /memberships/{id}/availability-slots`). `from` and `to` are ISO-8601
/// instants bounding the window; `cursor` pages forward.
class AvailabilitySlotFilter {
  const AvailabilitySlotFilter({
    required this.from,
    required this.to,
    this.cursor,
  });
  final String from; // ISO-8601 instant
  final String to; // ISO-8601 instant
  final String? cursor;
}

/// Already-generated availability slots for a membership over a date window
/// (`GET /memberships/{id}/availability-slots`). Every slot state — `open`,
/// `held`, `booked`, `closed` — is returned so the doctor sees the schedule as
/// it actually is. This is a read, not a generation; use [SlotGenerationNotifier]
/// to materialise slots after a rule-set change.
final availabilitySlotsProvider = FutureProvider.family<
    AvailabilitySlotListResponse, (String, AvailabilitySlotFilter)>(
    (ref, params) async {
  final api = ref.watch(apiClientProvider);
  final (membershipId, filter) = params;
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.availabilitySlots(membershipId),
      queryParameters: cleanQuery({
        'from': filter.from,
        'to': filter.to,
        'cursor': filter.cursor,
      }),
    );
    return decodeAvailabilitySlotListResponse(body);
  });
});

/// Notifier for replacing the full availability rule set
/// (`PUT /memberships/{id}/availability-rules`). Requires the current
/// `expectedVersion` for optimistic concurrency.
class AvailabilityRulesMutationState {
  const AvailabilityRulesMutationState({this.result, this.error, this.loading = false});
  final AvailabilityRulesResponse? result;
  final ApiError? error;
  final bool loading;
}

class AvailabilityRulesMutationNotifier
    extends StateNotifier<AvailabilityRulesMutationState> {
  AvailabilityRulesMutationNotifier(this._api)
      : super(const AvailabilityRulesMutationState());
  final ApiClient _api;

  Future<bool> replace({
    required String membershipId,
    required List<AvailabilityRuleInput> rules,
    required int expectedVersion,
    int? horizonDays,
  }) async {
    state = const AvailabilityRulesMutationState(loading: true);
    try {
      final body = await _api.put(
        ApiEndpoints.availabilityRules(membershipId),
        body: <String, dynamic>{
          'rules': rules
              .map((r) => <String, dynamic>{
                    'weekday': r.weekday,
                    'start_time': r.startTime,
                    'end_time': r.endTime,
                    'slot_duration_minutes': r.slotDurationMinutes,
                    'timezone': r.timezone,
                    'effective_from': r.effectiveFrom,
                    if (r.effectiveTo != null) 'effective_to': r.effectiveTo,
                  })
              .toList(),
          'expected_version': expectedVersion,
          if (horizonDays != null) 'horizon_days': horizonDays,
        },
      );
      state = AvailabilityRulesMutationState(
          result: decodeAvailabilityRulesResponse(body));
      return true;
    } catch (e) {
      state = AvailabilityRulesMutationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const AvailabilityRulesMutationState();
}

final availabilityRulesMutationProvider = StateNotifierProvider.autoDispose<
    AvailabilityRulesMutationNotifier, AvailabilityRulesMutationState>(
    (ref) => AvailabilityRulesMutationNotifier(ref.watch(apiClientProvider)));

/// Notifier for recording an availability exception (a leave/closure day)
/// (`POST /memberships/{id}/availability-exceptions`).
class AvailabilityExceptionState {
  const AvailabilityExceptionState({this.result, this.error, this.loading = false});
  final AvailabilityExceptionResponse? result;
  final ApiError? error;
  final bool loading;
}

class AvailabilityExceptionNotifier
    extends StateNotifier<AvailabilityExceptionState> {
  AvailabilityExceptionNotifier(this._api)
      : super(const AvailabilityExceptionState());
  final ApiClient _api;

  Future<bool> record({
    required String membershipId,
    required RecordAvailabilityExceptionRequest req,
  }) async {
    state = const AvailabilityExceptionState(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.availabilityExceptions(membershipId),
        body: <String, dynamic>{
          'exception_date': req.exceptionDate,
          'is_unavailable': req.isUnavailable,
          if (req.replacementStartTime != null)
            'replacement_start_time': req.replacementStartTime,
          if (req.replacementEndTime != null)
            'replacement_end_time': req.replacementEndTime,
          'reason_code': req.reasonCode.wireValue,
          'expected_version': req.expectedVersion,
        },
      );
      state = AvailabilityExceptionState(
          result: decodeAvailabilityExceptionResponse(body));
      return true;
    } catch (e) {
      state = AvailabilityExceptionState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const AvailabilityExceptionState();
}

final availabilityExceptionProvider = StateNotifierProvider.autoDispose<
    AvailabilityExceptionNotifier, AvailabilityExceptionState>(
    (ref) => AvailabilityExceptionNotifier(ref.watch(apiClientProvider)));

/// Notifier for generating availability slots for a date window
/// (`POST /memberships/{id}/availability-slots`, returns 201 with a generation
/// summary). This is a generation action, not a list read — call it after a
/// rule-set change to materialise the slots.
class SlotGenerationState {
  const SlotGenerationState({this.result, this.error, this.loading = false});
  final AvailabilitySlotGenerationResponse? result;
  final ApiError? error;
  final bool loading;
}

class SlotGenerationNotifier extends StateNotifier<SlotGenerationState> {
  SlotGenerationNotifier(this._api) : super(const SlotGenerationState());
  final ApiClient _api;

  Future<bool> generate({
    required String membershipId,
    required String fromDate,
    required String toDate,
  }) async {
    state = const SlotGenerationState(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.availabilitySlots(membershipId),
        body: <String, dynamic>{
          'from_date': fromDate,
          'to_date': toDate,
        },
      );
      state =
          SlotGenerationState(result: decodeAvailabilitySlotGenerationResponse(body));
      return true;
    } catch (e) {
      state = SlotGenerationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const SlotGenerationState();
}

final slotGenerationProvider = StateNotifierProvider.autoDispose<
    SlotGenerationNotifier, SlotGenerationState>(
    (ref) => SlotGenerationNotifier(ref.watch(apiClientProvider)));
