enum AppointmentStatus {
  upcoming,
  completed,
  cancelled,
  rescheduled,
}

class Appointment {
  final String id;
  final String doctorId;
  final String doctorName;
  final String specialty;
  final String imageUrl;
  final DateTime dateTime;
  final String type; // 'video', 'audio', 'in-person'
  final AppointmentStatus status;
  final double fee;
  final String? notes;

  Appointment({
    required this.id,
    required this.doctorId,
    required this.doctorName,
    required this.specialty,
    required this.imageUrl,
    required this.dateTime,
    required this.type,
    required this.status,
    required this.fee,
    this.notes,
  });
}
