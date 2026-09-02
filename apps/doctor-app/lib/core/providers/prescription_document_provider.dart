import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../network/api_client.dart';

/// Outcome of uploading a generated prescription PDF to backend storage.
///
/// The backend does not yet expose a prescription-document upload endpoint:
/// the only presigned-URL flow is `/memberships/{id}/verification-documents`,
/// whose `document_kind` enum has no prescription/PDF kind. Rather than
/// fabricate a verification-document record with an unrelated kind (which would
/// be dishonest per the project's reconciliation conventions), this provider
/// reports [PrescriptionUploadResult.unsupported] so the caller can surface the
/// gap without blocking the user. The Share/Download path always works.
///
/// When a real prescription-document endpoint is added, the `supported` branch
/// below is where the presigned-URL request, PUT, and finalize calls belong.
sealed class PrescriptionUploadResult {
  const PrescriptionUploadResult();
}

/// The upload completed. [sha256Hex] is the integrity hash of the stored bytes.
final class PrescriptionUploadSuccess extends PrescriptionUploadResult {
  const PrescriptionUploadSuccess({required this.sha256Hex});
  final String sha256Hex;
}

/// The backend does not support prescription PDF storage yet. The PDF bytes are
/// still available to the caller for Share/Download.
final class PrescriptionUploadUnsupported extends PrescriptionUploadResult {
  const PrescriptionUploadUnsupported(this.reason);
  final String reason;
}

/// The upload attempt failed with a recoverable error.
final class PrescriptionUploadFailure extends PrescriptionUploadResult {
  const PrescriptionUploadFailure(this.error);
  final ApiError error;
}

/// Computes the SHA-256 hex digest of [bytes], used as the declared hash for an
/// upload and to verify integrity after a PUT.
String computeSha256Hex(Uint8List bytes) {
  final digest = sha256.convert(bytes);
  return digest.toString();
}

/// Attempts to upload a generated prescription PDF to backend object storage.
///
/// Mirrors the verification-document presigned-URL flow (request target → PUT
/// bytes → finalize with hash) but guards against the absence of a prescription
/// document kind. See [PrescriptionUploadResult] for the outcome states.
class PrescriptionDocumentUploadNotifier
    extends StateNotifier<PrescriptionUploadResult?> {
  PrescriptionDocumentUploadNotifier(this._api) : super(null);
  // Reserved for the prescription-document presigned-URL flow once the backend
  // exposes an endpoint. See the upload() method for the wiring plan.
  // ignore: unused_field
  final ApiClient _api;

  Future<PrescriptionUploadResult> upload({
    required Uint8List pdfBytes,
  }) async {
    final hash = computeSha256Hex(pdfBytes);

    // The only presigned-URL endpoint is /memberships/{id}/verification-documents,
    // and its document_kind enum has no prescription kind. Sending a request with
    // an unrelated kind would create a fraudulent verification record, so we
    // refuse up front and report the configuration gap. This branch is the
    // single place to wire a real prescription-document endpoint when one lands:
    //   1. request an upload target with `hash` as `declared_sha256`,
    //   2. PUT `pdfBytes` to the presigned URL,
    //   3. finalize with `reported_sha256: hash`.
    const reason =
        'Prescription PDF upload is not yet supported by the backend. '
        'The PDF is ready to share or download.';
    final result = PrescriptionUploadUnsupported(reason);
    state = result;
    debugPrint('prescription PDF upload skipped: $reason (sha256=$hash, '
        '${pdfBytes.length} bytes)');
    return result;
  }

  void reset() => state = null;
}

final prescriptionDocumentUploadProvider = StateNotifierProvider.autoDispose<
    PrescriptionDocumentUploadNotifier, PrescriptionUploadResult?>(
    (ref) => PrescriptionDocumentUploadNotifier(ref.watch(apiClientProvider)));
