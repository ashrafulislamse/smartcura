/// Doctor-scoped API endpoint path constants.
///
/// All paths are relative to the API base (`https://api.smartcura.app/api/v1`).
/// The [ApiClient] prepends the base, so these constants carry only the path
/// after `/api/v1`. Path-parameter helpers return interpolated strings so the
/// compiler can catch a missing id at the call site rather than at runtime.
class ApiEndpoints {
  ApiEndpoints._();

  // ---- Sessions ----------------------------------------------------------
  static const sessions = '/sessions';
  static const sessionsCurrent = '/sessions/current';
  static const sessionsRefresh = '/sessions/refresh';
  static const sessionsStepUp = '/sessions/step-up';
  static const sessionsActiveRole = '/sessions/current/active-role';

  // ---- Profiles ----------------------------------------------------------
  static const profilesMe = '/profiles/me';
  static const profilesMeAvatar = '/profiles/me/avatar';

  // ---- Doctor workspace --------------------------------------------------
  static const doctorDashboard = '/doctor/dashboard';
  static const doctorAnalytics = '/doctor/analytics';
  static const doctorEarnings = '/doctor/earnings';
  static const doctorInbox = '/doctor/inbox';
  static const doctorPatients = '/doctor/patients';
  static String doctorPatient(String id) => '/doctor/patients/$id';
  static const doctorTemplates = '/doctor/templates';
  static String doctorTemplate(String id) =>
      '/doctor/templates/$id'; // path param is `templateId` (camelCase) per OpenAPI
  static const doctorAiAssistant = '/doctor/ai/assistant';
  static const doctorAiArtifacts = '/doctor/ai/artifacts';
  static const doctorDevices = '/doctor/devices';
  static const doctorAvailableDevices = '/doctor/available-devices';
  static String doctorDeviceAssignments(String deviceId) =>
      '/doctor/devices/$deviceId/assignments';
  static String doctorDeviceRelease(String deviceId) =>
      '/doctor/devices/$deviceId/assignments/release';
  static const doctorNotes = '/doctor/notes';
  static const doctorPrescriptions = '/doctor/prescriptions';

  // ---- Appointments ------------------------------------------------------
  static const appointments = '/appointments';
  static String appointment(String id) => '/appointments/$id';
  static String appointmentStatus(String id) => '/appointments/$id/status';

  // ---- Consultations -----------------------------------------------------
  static String appointmentConsultation(String apptId) =>
      '/appointments/$apptId/consultation';
  static String consultation(String id) => '/consultations/$id';
  static String consultationStatus(String id) => '/consultations/$id/status';
  static String consultationRoomToken(String id) =>
      '/consultations/$id/room-token';
  static String consultationNotes(String id) => '/consultations/$id/notes';
  static String consultationPrescriptions(String id) =>
      '/consultations/$id/prescriptions';

  // ---- Clinical notes ----------------------------------------------------
  static const clinicalNotes = '/clinical-notes';
  static String clinicalNote(String id) => '/clinical-notes/$id';
  static String clinicalNoteStatus(String id) => '/clinical-notes/$id/status';

  // ---- Prescriptions -----------------------------------------------------
  static const prescriptions = '/prescriptions';
  static String prescription(String id) => '/prescriptions/$id';
  static String prescriptionStatus(String id) => '/prescriptions/$id/status';
  static String prescriptionReplacement(String id) =>
      '/prescriptions/$id/replacements';
  static String prescriptionCancellation(String id) =>
      '/prescriptions/$id/cancellation';
  static String prescriptionPdf(String id) => '/prescriptions/$id/pdf';

  // ---- Availability ------------------------------------------------------
  static String availabilityRules(String membershipId) =>
      '/memberships/$membershipId/availability-rules';
  static String availabilityExceptions(String membershipId) =>
      '/memberships/$membershipId/availability-exceptions';
  static String availabilitySlots(String membershipId) =>
      '/memberships/$membershipId/availability-slots';

  // ---- Conversations / messaging -----------------------------------------
  static const conversations = '/conversations';
  static String conversationMessages(String id) =>
      '/conversations/$id/messages';
  static String conversationRead(String id) => '/conversations/$id/read';

  // ---- Patient vitals/alerts (doctor-assigned scope) ---------------------
  static String patientVitalReadings(String patientId) =>
      '/patients/$patientId/vital-readings';
  static String patientHealthAlerts(String patientId) =>
      '/patients/$patientId/health-alerts';
  static String healthAlertAcknowledge(String alertId) =>
      '/health-alerts/$alertId/acknowledge';
  static String healthAlertState(String alertId) =>
      '/health-alerts/$alertId/state';

  // ---- Notifications -----------------------------------------------------
  static const notifications = '/notifications';
  static String notificationRead(String id) =>
      '/notifications/$id/read'; // path param is `notification_id`
  static const notificationsReadAll = '/notifications/read-all';
  static const notificationPreferences = '/notifications/preferences/me';
  static const pushDevices = '/notifications/push-devices';
  static String pushDeviceRevocation(String id) =>
      '/notifications/push-devices/$id/revocation'; // path param is `push_device_id`

  // ---- Emergency ---------------------------------------------------------
  static const emergencies = '/emergencies';
  static String emergency(String id) => '/emergencies/$id';
  static String emergencyTriage(String id) => '/emergencies/$id/triage';
  static String emergencyStatus(String id) => '/emergencies/$id/status';

  // ---- Verification documents --------------------------------------------
  static String verificationDocuments(String membershipId) =>
      '/memberships/$membershipId/verification-documents';

  // ---- Doctor details (professional profile) -----------------------------
  static String doctorDetails(String membershipId) =>
      '/memberships/$membershipId/doctor-details';

  // ---- Break-glass -------------------------------------------------------
  static const breakGlassGrants = '/break-glass/grants';
  static String breakGlassGrant(String id) => '/break-glass/grants/$id';

  // ---- Medications -------------------------------------------------------
  static const medications = '/medications';

  // ---- Support tickets ---------------------------------------------------
  static const supportTickets = '/support/tickets';
}
