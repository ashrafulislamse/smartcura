class Prescription {
  final String id;
  final String doctorName;
  final String specialty;
  final DateTime date;
  final List<Medication> medications;
  final String? diagnosis;
  final String? notes;

  Prescription({
    required this.id,
    required this.doctorName,
    required this.specialty,
    required this.date,
    required this.medications,
    this.diagnosis,
    this.notes,
  });
}

class Medication {
  final String name;
  final String dosage;
  final String frequency;
  final int duration; // in days
  final String instructions;

  Medication({
    required this.name,
    required this.dosage,
    required this.frequency,
    required this.duration,
    required this.instructions,
  });
}
