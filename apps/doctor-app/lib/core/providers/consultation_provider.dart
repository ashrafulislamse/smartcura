import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Read-one consultation (`GET /consultations/{id}`).
final consultationDetailProvider =
    FutureProvider.family<Consultation, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.consultation(id));
    return decodeConsultation(body);
  });
});

/// Clinical notes for a consultation (`GET /consultations/{id}/notes`).
final consultationNotesProvider =
    FutureProvider.family<ClinicalNoteList, String>(
        (ref, consultationId) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.consultationNotes(consultationId));
    return decodeClinicalNoteList(body);
  });
});

/// Notifier that mints a LiveKit room token for a consultation
/// (`POST /consultations/{id}/room-token`). This is a POST (not a read) because
/// the token is issued on demand and rotates, so it is not a FutureProvider.
class RoomTokenState {
  const RoomTokenState({this.token, this.error, this.loading = false});
  final ConsultationRoomToken? token;
  final ApiError? error;
  final bool loading;
}

class RoomTokenNotifier extends StateNotifier<RoomTokenState> {
  RoomTokenNotifier(this._api) : super(const RoomTokenState());
  final ApiClient _api;

  Future<bool> fetch(String consultationId) async {
    state = const RoomTokenState(loading: true);
    try {
      final body =
          await _api.post(ApiEndpoints.consultationRoomToken(consultationId));
      state = RoomTokenState(token: decodeConsultationRoomToken(body));
      return true;
    } catch (e) {
      state = RoomTokenState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const RoomTokenState();
}

final roomTokenProvider =
    StateNotifierProvider.autoDispose<RoomTokenNotifier, RoomTokenState>(
        (ref) => RoomTokenNotifier(ref.watch(apiClientProvider)));

/// Generic mutation outcome used by the create/start/sign providers below.
class MutationOutcome<T> {
  const MutationOutcome({this.value, this.error, this.loading = false});
  final T? value;
  final ApiError? error;
  final bool loading;
}

/// Create a consultation for an appointment
/// (`POST /appointments/{apptId}/consultation`). Returns the new consultation.
class CreateConsultationNotifier
    extends StateNotifier<MutationOutcome<Consultation>> {
  CreateConsultationNotifier(this._api) : super(const MutationOutcome());
  final ApiClient _api;

  /// Creates (or returns the existing) consultation for [appointmentId].
  /// Returns the `Consultation` on success, or `null` on failure — the error
  /// is also stored in [state] for callers that prefer to read it from there.
  Future<Consultation?> call(String appointmentId) async {
    state = const MutationOutcome(loading: true);
    try {
      final body =
          await _api.post(ApiEndpoints.appointmentConsultation(appointmentId));
      final consultation = decodeConsultation(body);
      state = MutationOutcome(value: consultation);
      return consultation;
    } catch (e) {
      state = MutationOutcome(error: toApiError(e));
      return null;
    }
  }

  void reset() => state = const MutationOutcome();
}

final createConsultationProvider = StateNotifierProvider<
        CreateConsultationNotifier, MutationOutcome<Consultation>>(
    (ref) => CreateConsultationNotifier(ref.watch(apiClientProvider)));

/// Transition a consultation's status (`PUT /consultations/{id}/status`), e.g.
/// start (`in_progress`) or complete.
class ConsultationTransitionNotifier
    extends StateNotifier<MutationOutcome<Consultation>> {
  ConsultationTransitionNotifier(this._api) : super(const MutationOutcome());
  final ApiClient _api;

  Future<bool> call({
    required String consultationId,
    required String status,
    String? outcomeCode,
    required int expectedVersion,
  }) async {
    state = const MutationOutcome(loading: true);
    try {
      final body = await _api.put(
        ApiEndpoints.consultationStatus(consultationId),
        body: <String, dynamic>{
          'status': status,
          if (outcomeCode != null) 'outcome_code': outcomeCode,
          'expected_version': expectedVersion,
        },
      );
      state = MutationOutcome(value: decodeConsultation(body));
      return true;
    } catch (e) {
      state = MutationOutcome(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const MutationOutcome();
}

final consultationTransitionProvider = StateNotifierProvider.autoDispose<
        ConsultationTransitionNotifier, MutationOutcome<Consultation>>(
    (ref) => ConsultationTransitionNotifier(ref.watch(apiClientProvider)));

/// Create a clinical note (`POST /consultations/{id}/notes`).
class CreateNoteNotifier extends StateNotifier<MutationOutcome<ClinicalNote>> {
  CreateNoteNotifier(this._api) : super(const MutationOutcome());
  final ApiClient _api;

  Future<bool> call({
    required String consultationId,
    required Map<String, Object?> content,
  }) async {
    state = const MutationOutcome(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.consultationNotes(consultationId),
        body: <String, dynamic>{'content': content},
      );
      state = MutationOutcome(value: decodeClinicalNote(body));
      return true;
    } catch (e) {
      state = MutationOutcome(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const MutationOutcome();
}

final createNoteProvider = StateNotifierProvider.autoDispose<CreateNoteNotifier,
        MutationOutcome<ClinicalNote>>(
    (ref) => CreateNoteNotifier(ref.watch(apiClientProvider)));

/// Sign (or discard) a clinical note (`PUT /clinical-notes/{id}/status`).
class SignNoteNotifier extends StateNotifier<MutationOutcome<ClinicalNote>> {
  SignNoteNotifier(this._api) : super(const MutationOutcome());
  final ApiClient _api;

  Future<bool> call({
    required String noteId,
    required String status, // `signed` or `discarded`
    required int expectedVersion,
  }) async {
    state = const MutationOutcome(loading: true);
    try {
      final body = await _api.put(
        ApiEndpoints.clinicalNoteStatus(noteId),
        body: <String, dynamic>{
          'status': status,
          'expected_version': expectedVersion,
        },
      );
      state = MutationOutcome(value: decodeClinicalNote(body));
      return true;
    } catch (e) {
      state = MutationOutcome(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const MutationOutcome();
}

final signNoteProvider = StateNotifierProvider.autoDispose<SignNoteNotifier,
        MutationOutcome<ClinicalNote>>(
    (ref) => SignNoteNotifier(ref.watch(apiClientProvider)));

/// Read-one prescription (`GET /prescriptions/{id}`).
final prescriptionDetailProvider =
    FutureProvider.family<Prescription, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.prescription(id));
    return decodePrescription(body);
  });
});

/// Create a prescription for a consultation
/// (`POST /consultations/{id}/prescriptions`).
class CreatePrescriptionNotifier
    extends StateNotifier<MutationOutcome<Prescription>> {
  CreatePrescriptionNotifier(this._api) : super(const MutationOutcome());
  final ApiClient _api;

  Future<bool> call({
    required String consultationId,
    required List<PrescriptionItemInput> items,
    String? diagnosis,
  }) async {
    state = const MutationOutcome(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.consultationPrescriptions(consultationId),
        body: <String, dynamic>{
          'items': items
              .map((i) => <String, dynamic>{
                    if (i.medicationReference != null)
                      'medication_reference': i.medicationReference,
                    if (i.medicationText != null)
                      'medication_text': i.medicationText,
                    'dose_value': i.doseValue,
                    'dose_unit': i.doseUnit,
                    'route_code': i.routeCode,
                    if (i.frequencyCode != null)
                      'frequency_code': i.frequencyCode,
                    if (i.frequencyText != null)
                      'frequency_text': i.frequencyText,
                    'duration_days': i.durationDays,
                    if (i.patientInstructions != null)
                      'patient_instructions': i.patientInstructions,
                  })
              .toList(),
          if (diagnosis != null && diagnosis.isNotEmpty) 'diagnosis': diagnosis,
        },
      );
      state = MutationOutcome(value: decodePrescription(body));
      return true;
    } catch (e) {
      state = MutationOutcome(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const MutationOutcome();
}

final createPrescriptionProvider = StateNotifierProvider.autoDispose<
        CreatePrescriptionNotifier, MutationOutcome<Prescription>>(
    (ref) => CreatePrescriptionNotifier(ref.watch(apiClientProvider)));

/// Transition a prescription's status (`PUT /prescriptions/{id}/status`), e.g.
/// sign (`signed`) with an expiry.
class PrescriptionTransitionNotifier
    extends StateNotifier<MutationOutcome<Prescription>> {
  PrescriptionTransitionNotifier(this._api) : super(const MutationOutcome());
  final ApiClient _api;

  Future<bool> call({
    required String prescriptionId,
    required String status,
    required int expectedVersion,
    String? expiresAt,
  }) async {
    state = const MutationOutcome(loading: true);
    try {
      final body = await _api.put(
        ApiEndpoints.prescriptionStatus(prescriptionId),
        body: <String, dynamic>{
          'status': status,
          'expected_version': expectedVersion,
          if (expiresAt != null) 'expires_at': expiresAt,
        },
      );
      state = MutationOutcome(value: decodePrescription(body));
      return true;
    } catch (e) {
      state = MutationOutcome(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const MutationOutcome();
}

final prescriptionTransitionProvider = StateNotifierProvider.autoDispose<
        PrescriptionTransitionNotifier, MutationOutcome<Prescription>>(
    (ref) => PrescriptionTransitionNotifier(ref.watch(apiClientProvider)));
