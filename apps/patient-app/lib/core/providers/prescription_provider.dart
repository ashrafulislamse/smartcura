import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../network/api_client.dart';
import '../network/api_endpoints.dart';

// Replaces: lib/core/providers/mock_data_provider.dart (mockPrescriptionsProvider)
//
// Screens that previously imported mock data and must be updated in Phase 2:
//   - lib/features/prescriptions/presentation/screens/prescriptions_list_screen.dart
//     (used ref.watch(mockPrescriptionsProvider))

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

class PrescriptionMapper {
  static Prescription fromJson(Map<String, dynamic> j) => Prescription(
        prescriptionId: j['prescription_id'] as String,
        consultationId: j['consultation_id'] as String,
        patientProfileId: j['patient_profile_id'] as String,
        doctorMembershipId: j['doctor_membership_id'] as String,
        status: prescriptionStatusFromWire(j['status'] as String),
        replacesPrescriptionId: j['replaces_prescription_id'] as String?,
        diagnosis: j['diagnosis'] as String?,
        cancellationReasonCode: j['cancellation_reason_code'] as String?,
        signedAt: j['signed_at'] as String?,
        expiresAt: j['expires_at'] as String?,
        version: (j['version'] as num).toInt(),
        documentStatus: j['document_status'] as String?,
        // PrescriptionItem is a typedef for String in the contracts.
        items: (j['items'] as List<dynamic>).whereType<String>().toList(),
        createdAt: j['created_at'] as String,
        updatedAt: j['updated_at'] as String,
      );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// All prescriptions for the current patient (self-scoped).
/// Backend: GET /prescriptions
final prescriptionsProvider = FutureProvider<List<Prescription>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.prescriptions);
  final data = response.data;
  // The endpoint may return a list directly or a { data: [...] } envelope.
  if (data is List) {
    return data
        .whereType<Map<String, dynamic>>()
        .map(PrescriptionMapper.fromJson)
        .toList();
  }
  final list = (data as Map<String, dynamic>)['data'] as List<dynamic>;
  return list
      .whereType<Map<String, dynamic>>()
      .map(PrescriptionMapper.fromJson)
      .toList();
});

/// A single prescription by id.
/// Backend: GET /prescriptions/{id}
final prescriptionDetailProvider =
    FutureProvider.family<Prescription, String>((ref, id) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.prescription(id));
  return PrescriptionMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Prescription PDF download URL (returned as a base64 data URI).
/// Backend: GET /prescriptions/{id}/pdf
final prescriptionPdfUrlProvider =
    FutureProvider.family<Map<String, dynamic>, String>((ref, id) async {
  final dio = ref.watch(apiClientProvider);
  final response =
      await dio.get<Map<String, dynamic>>(ApiEndpoints.prescriptionPdf(id));
  return response.data as Map<String, dynamic>;
});

/// Prescriptions for a specific consultation.
/// Backend: GET /consultations/{id}/prescriptions
final consultationPrescriptionsProvider =
    FutureProvider.family<List<Prescription>, String>(
        (ref, consultationId) async {
  final dio = ref.watch(apiClientProvider);
  final response =
      await dio.get(ApiEndpoints.consultationPrescriptions(consultationId));
  final data = response.data;
  if (data is List) {
    return data
        .whereType<Map<String, dynamic>>()
        .map(PrescriptionMapper.fromJson)
        .toList();
  }
  final list = (data as Map<String, dynamic>)['data'] as List<dynamic>;
  return list
      .whereType<Map<String, dynamic>>()
      .map(PrescriptionMapper.fromJson)
      .toList();
});
