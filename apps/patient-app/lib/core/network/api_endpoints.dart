/// Centralised API endpoint path constants matching the SmartCura backend.
///
/// All paths are relative to `AppConstants.apiBaseUrl` (`/api/v1`), so they
/// begin with a leading `/` and contain NO host. The [ApiClient] Dio instance
/// prepends the base URL at request time.
///
/// Path-parameterised endpoints are exposed as static methods that accept the
/// parameter and return the fully-substituted path, so a caller can never forget
/// to interpolate an id.
class ApiEndpoints {
  ApiEndpoints._();

  // ---------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------
  static const sessions = '/sessions';
  static const sessionsCurrent = '/sessions/current';
  static const sessionsRefresh = '/sessions/refresh';
  static const sessionsStepUp = '/sessions/step-up';
  static const sessionsActiveRole = '/sessions/current/active-role';

  // ---------------------------------------------------------------------------
  // Profiles (self-scoped — the backend resolves "me" from the session)
  // ---------------------------------------------------------------------------
  static const profilesMe = '/profiles/me';
  static const profilesMeAvatar = '/profiles/me/avatar';
  static const profilesMeAddresses = '/profiles/me/addresses';
  static const profilesMeEmergencyContacts = '/profiles/me/emergency-contacts';
  static const profilesMeAllergies = '/profiles/me/allergies';
  static const profilesMeConditions = '/profiles/me/conditions';
  static const profilesMeVitalReadings = '/profiles/me/vital-readings';
  static const profilesMeHealthAlerts = '/profiles/me/health-alerts';
  static const profilesMePrescriptions = '/profiles/me/prescriptions';
  static const profilesMeConsultations = '/profiles/me/consultations';
  static const profilesMeAppointmentsNext = '/profiles/me/appointments/next';
  static const profilesMeDevices = '/profiles/me/devices';
  static String profilesMeDevice(String id) => '/profiles/me/devices/$id';
  static String profilesMeDeviceVitalReadings(String id) =>
      '/profiles/me/devices/$id/vital-readings';
  static String profilesMeDeviceAssignments(String id) =>
      '/profiles/me/devices/$id/assignments';
  static String profilesMeDeviceAssignmentRelease(String id) =>
      '/profiles/me/devices/$id/assignments/release';

  // ---------------------------------------------------------------------------
  // Doctors (public directory)
  // ---------------------------------------------------------------------------
  static const doctors = '/doctors';
  static String doctor(String id) => '/doctors/$id';
  static String doctorReviews(String id) => '/doctors/$id/reviews';

  // ---------------------------------------------------------------------------
  // Appointments
  // ---------------------------------------------------------------------------
  static const appointments = '/appointments';
  static String appointment(String id) => '/appointments/$id';
  static String appointmentStatus(String id) => '/appointments/$id/status';
  static String appointmentReschedule(String id) =>
      '/appointments/$id/reschedule';
  static String appointmentCheckIn(String id) => '/appointments/$id/check-in';
  static String appointmentStart(String id) => '/appointments/$id/start';
  static String appointmentSlots(String orgId) =>
      '/organizations/$orgId/appointment-slots';
  static String slotHold(String slotId) => '/appointments/slots/$slotId/hold';
  static String orgAppointments(String orgId) =>
      '/organizations/$orgId/appointments';
  static String doctorReview(String apptId) =>
      '/appointments/$apptId/doctor-review';

  // ---------------------------------------------------------------------------
  // Consultations
  // ---------------------------------------------------------------------------
  static String consultation(String id) => '/consultations/$id';
  static String consultationStatus(String id) => '/consultations/$id/status';
  static String consultationRoomToken(String id) =>
      '/consultations/$id/room-token';
  static String consultationNotes(String id) => '/consultations/$id/notes';
  static String consultationPrescriptions(String id) =>
      '/consultations/$id/prescriptions';
  static String consultationConversation(String id) =>
      '/consultations/$id/conversation';

  // ---------------------------------------------------------------------------
  // Conversations / Messages
  // ---------------------------------------------------------------------------
  static const conversations = '/conversations';
  static String conversationMessages(String id) =>
      '/conversations/$id/messages';
  static String conversationRead(String id) => '/conversations/$id/read';

  // ---------------------------------------------------------------------------
  // Prescriptions
  // ---------------------------------------------------------------------------
  static const prescriptions = '/prescriptions';
  static String prescription(String id) => '/prescriptions/$id';
  static String prescriptionPdf(String id) => '/prescriptions/$id/pdf';

  // ---------------------------------------------------------------------------
  // AI assistant
  // ---------------------------------------------------------------------------
  static const aiConversations = '/ai/conversations';
  static String aiTurns(String id) => '/ai/conversations/$id/turns';
  static String aiArtifact(String id) => '/ai/artifacts/$id';
  static String aiGenerationArtifact(String generationId) =>
      '/ai/generations/$generationId/artifact';

  // ---------------------------------------------------------------------------
  // IoT devices (organization-scoped)
  // ---------------------------------------------------------------------------
  static String orgDevices(String orgId) => '/organizations/$orgId/devices';
  static String device(String orgId, String deviceId) =>
      '/organizations/$orgId/devices/$deviceId';
  static String deviceVitalReadings(String orgId, String deviceId) =>
      '/organizations/$orgId/devices/$deviceId/vital-readings';

  /// Release a device from its current patient. The release is a sub-resource
  /// action (POST .../assignments/release) rather than a DELETE: the open
  /// assignment row is closed with a timestamp and a structured reason code and
  /// the history stays intact, since a reading recorded last month must remain
  /// attributable to the patient the device was assigned to then.
  static String deviceReleaseAssignment(String orgId, String deviceId) =>
      '/organizations/$orgId/devices/$deviceId/assignments/release';

  // ---------------------------------------------------------------------------
  // Firmware OTA
  // ---------------------------------------------------------------------------
  /// Version check for a hardware profile. [currentVersion], when supplied, is
  /// sent as a query param so the backend can report whether the device is
  /// behind the latest.
  static String firmwareVersionCheck(String hardwareProfile,
          [String? currentVersion]) =>
      currentVersion == null
          ? '/firmware/versions/$hardwareProfile'
          : '/firmware/versions/$hardwareProfile?current_version=$currentVersion';
  static String firmwareDownload(String firmwareVersionId) =>
      '/firmware/versions/$firmwareVersionId/download';

  // ---------------------------------------------------------------------------
  // Emergency
  // ---------------------------------------------------------------------------
  static const emergencies = '/emergencies';
  static String emergency(String id) => '/emergencies/$id';

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  static const notifications = '/notifications';

  /// Mark-read is PUT (as is [notificationsReadAll]) — both are state
  /// transitions the server models as an update, not a creation.
  static String notificationRead(String id) => '/notifications/$id/read';
  static const notificationsReadAll = '/notifications/read-all';
  static const notificationPreferences = '/notifications/preferences/me';
  static const pushDevices = '/notifications/push-devices';
  static String pushDeviceRevocation(String id) =>
      '/notifications/push-devices/$id/revocation';

  // ---------------------------------------------------------------------------
  // Pharmacy
  // ---------------------------------------------------------------------------
  static const medications = '/medications';
  static const pharmacyOrders = '/pharmacy-orders';
  static String pharmacyOrder(String id) => '/pharmacy-orders/$id';
  static String deliveryRating(String id) => '/deliveries/$id/rating';

  // ---------------------------------------------------------------------------
  // Care assignments / consent
  // ---------------------------------------------------------------------------
  static const consents = '/consents';
  static const careAssignments = '/care-assignments';

  // ---------------------------------------------------------------------------
  // Support tickets
  // ---------------------------------------------------------------------------
  static const supportTickets = '/support/tickets';
  static String supportTicket(String id) => '/support/tickets/$id';
}
