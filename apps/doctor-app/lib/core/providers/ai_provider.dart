import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// AI assistant call outcome. The response is non-diagnostic by contract.
class AiAssistantState {
  const AiAssistantState({this.value, this.error, this.loading = false});
  final DoctorAiAssistantResponse? value;
  final ApiError? error;
  final bool loading;
}

/// Call the doctor AI assistant (`POST /doctor/ai/assistant`). The request is
/// idempotent via the auto-attached `Idempotency-Key`, so a retried call with
/// the same key returns the original response instead of double-charging tokens.
class AiAssistantNotifier extends StateNotifier<AiAssistantState> {
  AiAssistantNotifier(this._api) : super(const AiAssistantState());
  final ApiClient _api;

  Future<bool> call(DoctorAiAssistantRequest req) async {
    state = const AiAssistantState(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.doctorAiAssistant,
        body: <String, dynamic>{
          'prompt': req.prompt,
          if (req.patientProfileId != null)
            'patient_profile_id': req.patientProfileId,
          if (req.consultationId != null)
            'consultation_id': req.consultationId,
        },
      );
      state = AiAssistantState(value: decodeDoctorAiAssistantResponse(body));
      return true;
    } catch (e) {
      state = AiAssistantState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const AiAssistantState();
}

final aiAssistantProvider = StateNotifierProvider.autoDispose<
    AiAssistantNotifier, AiAssistantState>(
    (ref) => AiAssistantNotifier(ref.watch(apiClientProvider)));

/// AI artifacts list (`GET /doctor/ai/artifacts`). Paginated by cursor.
final aiArtifactsProvider =
    FutureProvider.family<AiArtifactList, String?>((ref, cursor) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.doctorAiArtifacts,
      queryParameters: cleanQuery({'cursor': cursor}),
    );
    return decodeAiArtifactList(body);
  });
});
