/// App-wide constants
class AppConstants {
  // App Info
  static const String appName = 'SmartCura Patient';
  static const String appVersion = '1.0.0';
  static const String appTagline = 'Your Healthcare Companion';

  // API
  static const String baseUrl = 'https://api.smartcura.app';
  static const String apiVersion = 'v1';
  static const String apiBaseUrl = '$baseUrl/api/$apiVersion';

  // Session cookie name — matches the backend's __Host- prefixed cookie.
  static const String sessionCookieName = '__Host-smartcura_session';

  // Request headers
  static const String csrfHeader = 'X-CSRF-Token';
  static const String idempotencyKeyHeader = 'Idempotency-Key';
  static const String authorizationHeader = 'Authorization';

  // Client identity sent to POST /sessions
  static const String clientType = 'patient_flutter';
  static const String defaultDeviceName = 'SmartCura Patient';

  static const int apiTimeout = 30000; // 30 seconds
  static const int maxRetries = 3;

  // Pagination
  static const int defaultPageSize = 20;
  static const int maxPageSize = 100;

  // Cache
  static const Duration cacheExpiry = Duration(hours: 24);
  static const Duration tokenRefreshBuffer = Duration(minutes: 5);

  // UI
  static const double defaultPadding = 16.0;
  static const double defaultRadius = 12.0;
  static const double defaultElevation = 2.0;

  // Animation
  static const Duration defaultAnimationDuration = Duration(milliseconds: 300);
  static const Duration shortAnimationDuration = Duration(milliseconds: 150);
  static const Duration longAnimationDuration = Duration(milliseconds: 500);

  // Validation
  static const int minPasswordLength = 8;
  static const int maxPasswordLength = 50;
  static const int minNameLength = 2;
  static const int maxNameLength = 50;

  // File Upload
  static const int maxImageSizeBytes = 5 * 1024 * 1024; // 5MB
  static const int maxDocumentSizeBytes = 10 * 1024 * 1024; // 10MB
  static const List<String> allowedImageFormats = ['jpg', 'jpeg', 'png'];
  static const List<String> allowedDocumentFormats = ['pdf', 'doc', 'docx'];

  // Emergency
  static const Duration sosTimeout = Duration(seconds: 30);
  static const int maxEmergencyContacts = 5;

  // Health Monitoring
  static const Duration iotDataRefreshInterval = Duration(seconds: 5);
  static const int maxHealthRecords = 100;

  // Appointments
  static const Duration appointmentSlotDuration = Duration(minutes: 30);
  static const int maxAdvanceBookingDays = 30;
  static const int minAdvanceBookingHours = 2;

  // Chat
  static const int maxMessageLength = 1000;
  static const Duration typingIndicatorTimeout = Duration(seconds: 3);

  // Video Call
  static const int maxCallDuration = 60; // minutes
  static const int callQualityCheckInterval = 10; // seconds
}
