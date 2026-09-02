import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Verification documents for a membership (`GET /memberships/{id}/verification-documents`).
final verificationDocumentsProvider =
    FutureProvider.family<VerificationDocumentListResponse, String>(
        (ref, membershipId) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.verificationDocuments(membershipId));
    return decodeVerificationDocumentListResponse(body);
  });
});

/// Outcome of requesting an upload target (the response carries the document
/// record plus a presigned upload URL with an expiry).
class UploadTargetState {
  const UploadTargetState({this.value, this.error, this.loading = false});
  final RequestVerificationUploadResponse? value;
  final ApiError? error;
  final bool loading;
}

/// Request an upload target for a verification document
/// (`POST /memberships/{id}/verification-documents`). The caller uploads the
/// file to the returned URL, then calls [FinalizeUploadNotifier].
class RequestUploadTargetNotifier extends StateNotifier<UploadTargetState> {
  RequestUploadTargetNotifier(this._api) : super(const UploadTargetState());
  final ApiClient _api;

  Future<bool> call({
    required String membershipId,
    required RequestVerificationUploadRequest req,
  }) async {
    state = const UploadTargetState(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.verificationDocuments(membershipId),
        body: <String, dynamic>{
          'document_kind': req.documentKind.wireValue,
          'content_type': req.contentType,
          'byte_size': req.byteSize,
          'declared_sha256': req.declaredSha256,
          if (req.documentExpiresAt != null)
            'document_expires_at': req.documentExpiresAt,
        },
      );
      state =
          UploadTargetState(value: decodeRequestVerificationUploadResponse(body));
      return true;
    } catch (e) {
      state = UploadTargetState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const UploadTargetState();
}

final requestUploadTargetProvider = StateNotifierProvider.autoDispose<
    RequestUploadTargetNotifier, UploadTargetState>(
    (ref) => RequestUploadTargetNotifier(ref.watch(apiClientProvider)));

/// Outcome of finalizing an uploaded verification document.
class FinalizeUploadState {
  const FinalizeUploadState({this.value, this.error, this.loading = false});
  final VerificationDocumentView? value;
  final ApiError? error;
  final bool loading;
}

/// Finalize an uploaded verification document
/// (`POST /memberships/{id}/verification-documents/{documentId}/finalize`).
/// The caller reports the SHA-256 of the bytes actually uploaded so the server
/// can confirm integrity and kick off the ClamAV scan.
class FinalizeUploadNotifier extends StateNotifier<FinalizeUploadState> {
  FinalizeUploadNotifier(this._api) : super(const FinalizeUploadState());
  final ApiClient _api;

  Future<bool> call({
    required String membershipId,
    required String documentId,
    required String reportedSha256,
  }) async {
    state = const FinalizeUploadState(loading: true);
    try {
      final body = await _api.post(
        '${ApiEndpoints.verificationDocuments(membershipId)}/$documentId/finalize',
        body: <String, dynamic>{'reported_sha256': reportedSha256},
      );
      state = FinalizeUploadState(value: decodeVerificationDocumentView(body));
      return true;
    } catch (e) {
      state = FinalizeUploadState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const FinalizeUploadState();
}

final finalizeUploadProvider = StateNotifierProvider.autoDispose<
    FinalizeUploadNotifier, FinalizeUploadState>(
    (ref) => FinalizeUploadNotifier(ref.watch(apiClientProvider)));
