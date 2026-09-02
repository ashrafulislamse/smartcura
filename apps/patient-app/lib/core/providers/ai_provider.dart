import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';
import 'package:uuid/uuid.dart';

import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';

// Replaces: lib/core/providers/ai_diagnosis_provider.dart (AIDiagnosisProvider, AIDiagnosisState)
//
// Screens that previously imported mock data and must be updated in Phase 2:
//   - lib/features/ai/presentation/screens/smart_diagnosis_summary_view_1_screen.dart
//     (used ref.watch(aiDiagnosisProvider))
//   - lib/features/ai/presentation/screens/smart_diagnosis_summary_view_2_screen.dart
//   - lib/features/ai/presentation/screens/smart_diagnosis_summary_view_3_screen.dart

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

class AiArtifactMapper {
  static AiArtifact fromJson(Map<String, dynamic> j) {
    final content = j['content'] as Map<String, dynamic>?;
    return AiArtifact(
      artifactId: j['artifact_id'] as String,
      generationId: j['generation_id'] as String,
      patientProfileId: j['patient_profile_id'] as String,
      artifactType: aiArtifactTypeFromWire(j['artifact_type'] as String),
      versionNo: (j['version_no'] as num).toInt(),
      reviewStatus: aiReviewStatusFromWire(j['review_status'] as String),
      riskLevel: aiRiskLevelFromWire(j['risk_level'] as String),
      confidence: (j['confidence'] as num?)?.toDouble(),
      content: content == null
          ? const AiArtifactContent(nonDiagnostic: true)
          : AiArtifactContent(
              nonDiagnostic: content['non_diagnostic'] as bool? ?? true,
              // When the LLM returns plain text instead of JSON, the backend
              // stores {parse_error: true, raw_response: "..."}. Fall back to
              // the raw response so the patient still sees the AI's answer.
              summaryOfReportedSymptoms: content['parse_error'] == true
                  ? [
                      content['raw_response'] as String? ??
                          'AI analysis could not be parsed.',
                    ]
                  : (content['summary_of_reported_symptoms'] as List?)
                      ?.map((e) => e as String)
                      .toList(),
              suggestedNextStep: content['suggested_next_step'] as String?,
              informationOnlyNotice:
                  content['information_only_notice'] as String? ??
                      (content['parse_error'] == true
                          ? 'This is general information and not a diagnosis. '
                              'Always consult your doctor for medical advice.'
                          : null),
              sources: (content['sources'] as List?)?.map((e) {
                final s = e as Map<String, dynamic>;
                return AiArtifactSource(
                  chunkId: s['chunk_id'] as String,
                  rank: (s['rank'] as num).toInt(),
                );
              }).toList(),
            ),
      modelId: j['model_id'] as String,
      promptTemplateId: j['prompt_template_id'] as String,
      replacesArtifactId: j['replaces_artifact_id'] as String?,
      version: (j['version'] as num).toInt(),
      createdAt: j['created_at'] as String,
      updatedAt: j['updated_at'] as String,
    );
  }
}

class AiConversationMapper {
  static AiConversation fromJson(Map<String, dynamic> j) => AiConversation(
        conversationId: j['conversation_id'] as String,
        status: j['status'] as String,
      );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// The patient's active AI conversation (creates or resumes one).
/// Backend: POST /ai/conversations — returns 201 with the active conversation.
/// There is no GET /ai/conversations list endpoint; POST is idempotent and
/// returns the existing active conversation if one already exists.
final aiConversationProvider = FutureProvider<AiConversation>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.post(ApiEndpoints.aiConversations);
  return AiConversationMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Kept for backward compatibility — returns a single-element list wrapping
/// the active conversation from [aiConversationProvider].
final aiConversationsProvider =
    FutureProvider<List<AiConversation>>((ref) async {
  final conv = await ref.watch(aiConversationProvider.future);
  return [conv];
});

/// A single AI artifact by id.
/// Backend: GET /ai/artifacts/{id}
final aiArtifactProvider =
    FutureProvider.family<AiArtifact, String>((ref, artifactId) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.aiArtifact(artifactId));
  return AiArtifactMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Submit a turn to an AI conversation and return the generation acknowledgement.
/// Backend: POST /ai/conversations/{id}/turns
final submitAiTurnProvider = StateNotifierProvider<SubmitAiTurnNotifier,
    AsyncValue<AiGenerationAccepted?>>((ref) => SubmitAiTurnNotifier(ref));

class SubmitAiTurnNotifier
    extends StateNotifier<AsyncValue<AiGenerationAccepted?>> {
  final Ref _ref;
  final _uuid = const Uuid();

  SubmitAiTurnNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<AiGenerationAccepted?> submit({
    required String conversationId,
    required String content,
    required AiArtifactType artifactType,
  }) async {
    state = const AsyncValue.loading();
    final correlationId = _uuid.v7();
    try {
      final dio = _ref.read(apiClientProvider);
      final response = await dio.post(
        ApiEndpoints.aiTurns(conversationId),
        data: {
          'content': content,
          'artifact_type': artifactType.wireValue,
          'client_correlation_id': correlationId,
        },
      );
      final j = response.data as Map<String, dynamic>;
      final accepted = AiGenerationAccepted(
        generationId: j['generation_id'] as String,
        sequenceNo: (j['sequence_no'] as num).toInt(),
        status: j['status'] as String,
      );
      state = AsyncValue.data(accepted);
      return accepted;
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
      return null;
    }
  }
}

/// Fetch the artifact produced by a generation, polling until it is ready.
/// Backend: GET /ai/generations/{generation_id}/artifact
///
/// Returns 404 while the generation is still queued/running. This provider
/// polls every 2 seconds for up to 30 seconds, then reports a timeout.
final aiArtifactByGenerationProvider =
    FutureProvider.family<AiArtifact, String>((ref, generationId) async {
  final dio = ref.watch(apiClientProvider);
  const maxAttempts = 15;
  const interval = Duration(seconds: 2);

  for (int attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      final response =
          await dio.get(ApiEndpoints.aiGenerationArtifact(generationId));
      return AiArtifactMapper.fromJson(response.data as Map<String, dynamic>);
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      if (apiError?.status == 404) {
        // Artifact not ready yet — wait and retry.
        await Future.delayed(interval);
        continue;
      }
      // Any other error is a real failure.
      throw apiError ??
          ApiError.network(e.message ?? 'Failed to fetch artifact');
    }
  }
  throw ApiError.network('AI analysis is taking longer than expected. '
      'Please check back later.');
});

/// Review an AI artifact (approve / reject).
/// Backend: POST /ai/artifacts/{id}/review
final reviewAiArtifactProvider =
    StateNotifierProvider<ReviewAiArtifactNotifier, AsyncValue<void>>(
        (ref) => ReviewAiArtifactNotifier(ref));

class ReviewAiArtifactNotifier extends StateNotifier<AsyncValue<void>> {
  final Ref _ref;
  ReviewAiArtifactNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<void> review({
    required String artifactId,
    required String decision,
    required String rationaleCode,
    required int expectedVersion,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.post(
        '${ApiEndpoints.aiArtifact(artifactId)}/review',
        data: {
          'decision': decision,
          'rationale_code': rationaleCode,
          'expected_version': expectedVersion,
        },
      );
      state = const AsyncValue.data(null);
      _ref.invalidate(aiArtifactProvider(artifactId));
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
    }
  }
}
