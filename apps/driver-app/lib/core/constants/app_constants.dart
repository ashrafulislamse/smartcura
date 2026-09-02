class AppConstants {
  AppConstants._();
  static const String appName = 'SmartCura Driver';
  static const String apiBaseUrl = String.fromEnvironment(
    'SMARTCURA_API_BASE_URL',
    defaultValue: 'https://api.smartcura.app/api/v1',
  );
  static const String sessionCookieName = '__Host-smartcura_session';
  static const String csrfHeaderName = 'X-CSRF-Token';
  static const String idempotencyHeaderName = 'Idempotency-Key';
  static const String clientType = 'driver_flutter';
  static const Duration connectionTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 30);
  static const Duration sendTimeout = Duration(seconds: 30);
}
