/// API endpoints and configuration
class ApiConstants {
  // Base URL (production backend)
  static const String baseUrl = 'https://api.smartcura.app';

  // API Version
  static const String apiVersion = 'v1';
  static const String apiPrefix = '/api/$apiVersion';

  // Authentication Endpoints
  static const String login = '$apiPrefix/auth/login';
  static const String register = '$apiPrefix/auth/register';
  static const String logout = '$apiPrefix/auth/logout';
  static const String refreshToken = '$apiPrefix/auth/refresh';
  static const String forgotPassword = '$apiPrefix/auth/forgot-password';
  static const String resetPassword = '$apiPrefix/auth/reset-password';
  static const String verifyEmail = '$apiPrefix/auth/verify-email';
  static const String resendVerification = '$apiPrefix/auth/resend-verification';

  // User Endpoints
  static const String profile = '$apiPrefix/users/profile';
  static const String updateProfile = '$apiPrefix/users/profile';
  static const String changePassword = '$apiPrefix/users/change-password';
  static const String uploadAvatar = '$apiPrefix/users/avatar';

  // Doctor Endpoints
  static const String doctors = '$apiPrefix/doctors';
  static const String doctorDetails = '$apiPrefix/doctors/:id';
  static const String doctorSearch = '$apiPrefix/doctors/search';
  static const String doctorAvailability = '$apiPrefix/doctors/:id/availability';
  static const String doctorReviews = '$apiPrefix/doctors/:id/reviews';

  // Appointment Endpoints
  static const String appointments = '$apiPrefix/appointments';
  static const String appointmentDetails = '$apiPrefix/appointments/:id';
  static const String bookAppointment = '$apiPrefix/appointments/book';
  static const String cancelAppointment = '$apiPrefix/appointments/:id/cancel';
  static const String rescheduleAppointment = '$apiPrefix/appointments/:id/reschedule';
  static const String upcomingAppointments = '$apiPrefix/appointments/upcoming';
  static const String pastAppointments = '$apiPrefix/appointments/past';

  // Consultation Endpoints
  static const String consultations = '$apiPrefix/consultations';
  static const String startConsultation = '$apiPrefix/consultations/:id/start';
  static const String endConsultation = '$apiPrefix/consultations/:id/end';
  static const String consultationNotes = '$apiPrefix/consultations/:id/notes';

  // Prescription Endpoints
  static const String prescriptions = '$apiPrefix/prescriptions';
  static const String prescriptionDetails = '$apiPrefix/prescriptions/:id';
  static const String downloadPrescription = '$apiPrefix/prescriptions/:id/download';

  // Health Records Endpoints
  static const String healthRecords = '$apiPrefix/health-records';
  static const String uploadHealthRecord = '$apiPrefix/health-records/upload';
  static const String deleteHealthRecord = '$apiPrefix/health-records/:id';

  // IoT Device Endpoints
  static const String iotDevices = '$apiPrefix/iot/devices';
  static const String iotDeviceData = '$apiPrefix/iot/devices/:id/data';
  static const String iotDeviceStatus = '$apiPrefix/iot/devices/:id/status';
  static const String pairDevice = '$apiPrefix/iot/devices/pair';
  static const String unpairDevice = '$apiPrefix/iot/devices/:id/unpair';

  // AI Assistant Endpoints
  static const String aiChat = '$apiPrefix/ai/chat';
  static const String symptomChecker = '$apiPrefix/ai/symptom-checker';
  static const String healthRecommendations = '$apiPrefix/ai/recommendations';

  // Emergency Endpoints
  static const String emergencySOS = '$apiPrefix/emergency/sos';
  static const String emergencyContacts = '$apiPrefix/emergency/contacts';
  static const String ambulanceTracking = '$apiPrefix/emergency/ambulance/:id/track';

  // Pharmacy Endpoints
  static const String pharmacyOrders = '$apiPrefix/pharmacy/orders';
  static const String placeOrder = '$apiPrefix/pharmacy/orders/place';
  static const String orderTracking = '$apiPrefix/pharmacy/orders/:id/track';

  // Payment Endpoints
  static const String createPaymentIntent = '$apiPrefix/payments/intent';
  static const String confirmPayment = '$apiPrefix/payments/confirm';
  static const String paymentHistory = '$apiPrefix/payments/history';

  // Notification Endpoints
  static const String notifications = '$apiPrefix/notifications';
  static const String markAsRead = '$apiPrefix/notifications/:id/read';
  static const String markAllAsRead = '$apiPrefix/notifications/read-all';
  static const String notificationSettings = '$apiPrefix/notifications/settings';

  // Chat Endpoints
  static const String chatMessages = '$apiPrefix/chat/messages';
  static const String sendMessage = '$apiPrefix/chat/messages/send';
  static const String chatHistory = '$apiPrefix/chat/history';

  // WebSocket Endpoints
  static const String wsBaseUrl = 'wss://api.smartcura.app';
  static const String wsChat = '$wsBaseUrl/chat';
  static const String wsNotifications = '$wsBaseUrl/notifications';
  static const String wsIotData = '$wsBaseUrl/iot';

  // Helper method to replace path parameters
  static String replacePathParams(String path, Map<String, String> params) {
    String result = path;
    params.forEach((key, value) {
      result = result.replaceAll(':$key', value);
    });
    return result;
  }
}
