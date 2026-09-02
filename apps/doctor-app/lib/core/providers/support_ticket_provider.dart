import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../network/api_client.dart';

/// Outcome of a support-ticket creation.
class SupportTicketMutationState {
  const SupportTicketMutationState({this.value, this.error, this.loading = false});
  final SupportTicketCreated? value;
  final ApiError? error;
  final bool loading;
}

/// Raises a support ticket (`POST /support/tickets`). The requester is the
/// authenticated session and is never accepted from the body; the
/// `organization_id` is required and comes from the caller's active membership.
class CreateSupportTicketNotifier
    extends StateNotifier<SupportTicketMutationState> {
  CreateSupportTicketNotifier(this._api)
      : super(const SupportTicketMutationState());
  final ApiClient _api;

  Future<bool> call({
    required String organizationId,
    required String categoryCode,
    required String subjectCode,
    required String body,
    String? priority,
  }) async {
    state = const SupportTicketMutationState(loading: true);
    try {
      final res = await _api.post(
        ApiEndpoints.supportTickets,
        body: <String, dynamic>{
          'organization_id': organizationId,
          'category_code': categoryCode,
          'subject_code': subjectCode,
          if (priority != null) 'priority': priority,
          'body': body,
        },
      );
      state = SupportTicketMutationState(
        value: SupportTicketCreated.fromJson(res),
      );
      return true;
    } catch (e) {
      state = SupportTicketMutationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const SupportTicketMutationState();
}

final createSupportTicketProvider = StateNotifierProvider.autoDispose<
    CreateSupportTicketNotifier, SupportTicketMutationState>(
    (ref) => CreateSupportTicketNotifier(ref.watch(apiClientProvider)));
