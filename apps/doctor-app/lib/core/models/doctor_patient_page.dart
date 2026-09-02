import 'package:smartcura_contracts/smartcura_contracts.dart';

import 'contract_decoders.dart';

/// Local paginated wrapper for `GET /doctor/patients`.
///
/// The generated contracts do not include a dedicated list response for the
/// doctor-assigned patients collection, so this local model carries the
/// [DoctorAssignedPatient] rows together with the [PageInfo] cursor. It is the
/// only place where a doctor app model is not backed 1:1 by a contract type.
class DoctorAssignedPatientPage {
  const DoctorAssignedPatientPage({
    required this.data,
    required this.page,
  });

  final List<DoctorAssignedPatient> data;
  final PageInfo page;

  factory DoctorAssignedPatientPage.fromJson(Map<String, dynamic> json) {
    final rows = (json['data'] as List?)
            ?.whereType<Map<String, dynamic>>()
            .map(decodeDoctorAssignedPatient)
            .toList() ??
        <DoctorAssignedPatient>[];
    return DoctorAssignedPatientPage(
      data: rows,
      page: pageFromListBody(json),
    );
  }
}
