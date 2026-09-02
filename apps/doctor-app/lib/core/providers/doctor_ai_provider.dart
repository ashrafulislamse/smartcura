import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../models/doctor_ai_models.dart';
import '../network/api_client.dart';
import 'provider_helpers.dart';

// ---------------------------------------------------------------------------
// AI assistant — POST /doctor/ai/assistant
// ---------------------------------------------------------------------------

/// Parameters for a single doctor-AI assistant call.
///
/// All fields are optional except [prompt]. The backend refuses a request
/// without a prompt, returns 422 if [patientProfileId] is supplied for a
/// patient the doctor is not assigned to, and returns 501 if the deployment
/// has no AI provider configured.
class DoctorAiAssistantParams {
  const DoctorAiAssistantParams({
    required this.prompt,
    this.patientProfileId,
    this.consultationId,
  });

  final String prompt;
  final String? patientProfileId;
  final String? consultationId;

  Map<String, dynamic> toBody() => <String, dynamic>{
        'prompt': prompt,
        if (patientProfileId != null) 'patient_profile_id': patientProfileId,
        if (consultationId != null) 'consultation_id': consultationId,
      };
}

/// Notifier that calls `POST /doctor/ai/assistant` and exposes the decoded
/// response plus structured error state. The `Idempotency-Key` header is
/// auto-attached by `ApiClient`'s `_IdempotencyInterceptor` on every POST, so
/// the notifier does not manage keys itself — each click of the Ask button
/// is a fresh, billable inference, while a network retry with the same key
/// returns the stored response verbatim.
///
/// 501 NOT_IMPLEMENTED and 503 SERVICE_UNAVAILABLE are surfaced as
/// [DoctorAiAssistantUiState.notConfigured] and
/// [DoctorAiAssistantUiState.providerUnavailable] respectively, because the
/// remedy differs from a generic failure.
class DoctorAiAssistantNotifier
    extends StateNotifier<DoctorAiAssistantUiState> {
  DoctorAiAssistantNotifier(this._api)
      : super(const DoctorAiAssistantUiState());

  final ApiClient _api;

  /// Submit a synchronous clinical decision-support call. Returns `true` when
  /// the backend answered 200, `false` for any error state (including 501 and
  /// 503). A `false` return is the UI's signal to render the [state]'s
  /// [notConfigured] / [providerUnavailable] / [error] branch.
  Future<bool> call(DoctorAiAssistantParams params) async {
    state = const DoctorAiAssistantUiState(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.doctorAiAssistant,
        body: params.toBody(),
      );
      state = DoctorAiAssistantUiState(
        response: decodeDoctorAiAssistantResponse(body),
      );
      return true;
    } catch (e) {
      final apiError = toApiError(e);
      if (apiError.status == 501) {
        state = DoctorAiAssistantUiState(notConfigured: true);
      } else if (apiError.status == 503) {
        state = DoctorAiAssistantUiState(providerUnavailable: true);
      } else {
        state = DoctorAiAssistantUiState(error: apiError);
      }
      return false;
    }
  }

  /// Clear the current state — the UI calls this when navigating away or
  /// when a fresh "Ask" should not pre-fill a stale response.
  void reset() => state = const DoctorAiAssistantUiState();
}

/// AutoDispose so the state is torn down when the assistant screen pops.
final doctorAiAssistantProvider = StateNotifierProvider.autoDispose<
    DoctorAiAssistantNotifier, DoctorAiAssistantUiState>(
  (ref) => DoctorAiAssistantNotifier(ref.watch(apiClientProvider)),
);

// ---------------------------------------------------------------------------
// AI artifacts — GET /doctor/ai/artifacts
// ---------------------------------------------------------------------------

/// Arguments for [doctorAiArtifactsProvider]. `patientProfileId` narrows the
/// list to a single patient; `cursor` paginates by the server-issued opaque
/// cursor. `pageSize` is the requested page size; null defers to the server's
/// default.
class DoctorAiArtifactsQuery {
  const DoctorAiArtifactsQuery({
    this.patientProfileId,
    this.cursor,
    this.pageSize,
  });

  final String? patientProfileId;
  final String? cursor;
  final int? pageSize;

  @override
  bool operator ==(Object other) =>
      other is DoctorAiArtifactsQuery &&
      other.patientProfileId == patientProfileId &&
      other.cursor == cursor &&
      other.pageSize == pageSize;

  @override
  int get hashCode => Object.hash(patientProfileId, cursor, pageSize);
}

/// Lists AI artifacts for the doctor's actively-assigned patients via
/// `GET /doctor/ai/artifacts`. Assignment-scoped on the server: a doctor only
/// sees artifacts for patients under their own care.
///
/// Errors are converted via [toApiError] so a `DioException` (the common
/// shape for non-2xx responses) is normalised to an [ApiError] before
/// `AsyncValue.error` propagates to the UI — branching on `isForbidden` etc.
/// is therefore safe.
final doctorAiArtifactsProvider =
    FutureProvider.family<AiArtifactList, DoctorAiArtifactsQuery>(
  (ref, query) async {
    final api = ref.watch(apiClientProvider);
    return guardApi(() async {
      final body = await api.get(
        ApiEndpoints.doctorAiArtifacts,
        queryParameters: cleanQuery({
          'patient_profile_id': query.patientProfileId,
          'cursor': query.cursor,
          'page_size': query.pageSize,
        }),
      );
      return decodeAiArtifactList(body);
    });
  },
);
