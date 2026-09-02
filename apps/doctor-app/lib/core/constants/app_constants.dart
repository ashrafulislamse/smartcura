/// App-wide constants
/// 
/// Contains all configuration values used throughout the app
class AppConstants {
  // App Info
  static const String appName = 'SmartCura Doctor';
  static const String appVersion = '1.0.0';
  static const String appDescription = 'Professional healthcare platform for doctors';
  
  // API Configuration
  static const String baseUrl = 'https://api.smartcura.app';
  static const String apiVersion = 'v1';
  static const String apiPrefix = 'api';
  static const String apiBaseUrl = '$baseUrl/$apiPrefix/$apiVersion';
  
  // Timeouts
  static const Duration connectionTimeout = Duration(seconds: 30);
  static const Duration receiveTimeout = Duration(seconds: 30);
  static const Duration sendTimeout = Duration(seconds: 30);
  
  // Pagination
  static const int pageSize = 20;
  static const int maxPageSize = 100;
  
  // Cache
  static const Duration cacheExpiry = Duration(hours: 1);
  static const Duration shortCacheExpiry = Duration(minutes: 15);
  static const Duration longCacheExpiry = Duration(days: 1);
  
  // Session
  static const Duration sessionTimeout = Duration(minutes: 15);
  static const Duration tokenRefreshThreshold = Duration(minutes: 5);
  
  // File Upload
  static const int maxFileSize = 10 * 1024 * 1024; // 10 MB
  static const int maxImageSize = 5 * 1024 * 1024; // 5 MB
  static const List<String> allowedImageFormats = ['jpg', 'jpeg', 'png'];
  static const List<String> allowedDocumentFormats = ['pdf', 'doc', 'docx'];
  
  // Video Call
  static const Duration maxConsultationDuration = Duration(hours: 1);
  static const Duration consultationWarningTime = Duration(minutes: 5);
  
  // Prescription
  static const int maxMedicationsPerPrescription = 10;
  static const int maxPrescriptionNoteLength = 500;
  
  // Validation
  static const int minPasswordLength = 8;
  static const int maxPasswordLength = 50;
  static const int minNameLength = 2;
  static const int maxNameLength = 50;
  
  // UI
  static const Duration animationDuration = Duration(milliseconds: 300);
  static const Duration shortAnimationDuration = Duration(milliseconds: 150);
  static const Duration longAnimationDuration = Duration(milliseconds: 500);
  
  // Debounce
  static const Duration searchDebounce = Duration(milliseconds: 500);
  static const Duration typingDebounce = Duration(milliseconds: 300);
}
