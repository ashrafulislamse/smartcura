import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'consultation_provider.dart' show MutationOutcome;
import 'provider_helpers.dart';

/// Doctor clinical templates list (`GET /doctor/templates`). Paginated.
final templatesProvider =
    FutureProvider.family<ClinicalTemplateList, String?>((ref, cursor) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.doctorTemplates,
      queryParameters: cleanQuery({'cursor': cursor}),
    );
    return decodeClinicalTemplateList(body);
  });
});

/// Read-one template (`GET /doctor/templates/{id}`).
final templateDetailProvider =
    FutureProvider.family<ClinicalTemplate, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.doctorTemplate(id));
    return decodeClinicalTemplate(body);
  });
});

/// Generic CRUD outcome for template mutations.
class TemplateMutationState {
  const TemplateMutationState({this.value, this.error, this.loading = false});
  final ClinicalTemplate? value;
  final ApiError? error;
  final bool loading;
}

/// Create a template (`POST /doctor/templates`).
class CreateTemplateNotifier extends StateNotifier<TemplateMutationState> {
  CreateTemplateNotifier(this._api) : super(const TemplateMutationState());
  final ApiClient _api;

  Future<bool> call(ClinicalTemplateCreateRequest req) async {
    state = const TemplateMutationState(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.doctorTemplates,
        body: <String, dynamic>{
          'name': req.name,
          'description': req.description,
          'specialty': req.specialty,
          'content': req.content,
        },
      );
      state = TemplateMutationState(value: decodeClinicalTemplate(body));
      return true;
    } catch (e) {
      state = TemplateMutationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const TemplateMutationState();
}

final createTemplateProvider = StateNotifierProvider.autoDispose<
    CreateTemplateNotifier, TemplateMutationState>(
    (ref) => CreateTemplateNotifier(ref.watch(apiClientProvider)));

/// Update a template (`PUT /doctor/templates/{id}`). Requires expectedVersion.
class UpdateTemplateNotifier extends StateNotifier<TemplateMutationState> {
  UpdateTemplateNotifier(this._api) : super(const TemplateMutationState());
  final ApiClient _api;

  Future<bool> call({
    required String templateId,
    required ClinicalTemplateUpdateRequest req,
  }) async {
    state = const TemplateMutationState(loading: true);
    try {
      final body = await _api.put(
        ApiEndpoints.doctorTemplate(templateId),
        body: <String, dynamic>{
          'name': req.name,
          'description': req.description,
          'specialty': req.specialty,
          'content': req.content,
          'expected_version': req.expectedVersion,
        },
      );
      state = TemplateMutationState(value: decodeClinicalTemplate(body));
      return true;
    } catch (e) {
      state = TemplateMutationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const TemplateMutationState();
}

final updateTemplateProvider = StateNotifierProvider.autoDispose<
    UpdateTemplateNotifier, TemplateMutationState>(
    (ref) => UpdateTemplateNotifier(ref.watch(apiClientProvider)));

/// Delete (archive) a template (`DELETE /doctor/templates/{id}`).
class DeleteTemplateNotifier extends StateNotifier<MutationOutcome<void>> {
  DeleteTemplateNotifier(this._api) : super(const MutationOutcome());
  final ApiClient _api;

  Future<bool> call(String templateId) async {
    state = const MutationOutcome<void>(loading: true);
    try {
      await _api.delete(ApiEndpoints.doctorTemplate(templateId));
      state = const MutationOutcome<void>(value: null);
      return true;
    } catch (e) {
      state = MutationOutcome<void>(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const MutationOutcome<void>();
}

final deleteTemplateProvider = StateNotifierProvider.autoDispose<
    DeleteTemplateNotifier, MutationOutcome<void>>(
    (ref) => DeleteTemplateNotifier(ref.watch(apiClientProvider)));
