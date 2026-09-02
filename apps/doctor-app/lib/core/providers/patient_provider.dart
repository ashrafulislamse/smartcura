import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../models/doctor_patient_page.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import 'provider_helpers.dart';

/// Doctor-assigned patients list (`GET /doctor/patients`). Paginated; pass a
/// cursor to fetch the next page.
final doctorPatientsProvider =
    FutureProvider.family<DoctorAssignedPatientPage, String?>((ref, cursor) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.doctorPatients,
      queryParameters: cleanQuery({'cursor': cursor}),
    );
    return DoctorAssignedPatientPage.fromJson(body);
  });
});

/// A single assigned patient's summary (`GET /doctor/patients/{id}`). The
/// contract carries no name-resolution for arbitrary profiles, so this is the
/// doctor-scoped read-one.
final doctorPatientDetailProvider =
    FutureProvider.family<DoctorAssignedPatient, String>((ref, id) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.doctorPatient(id));
    return decodeDoctorAssignedPatient(body);
  });
});
