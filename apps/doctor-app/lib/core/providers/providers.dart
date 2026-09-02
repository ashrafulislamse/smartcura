/// Barrel file for all doctor-domain Riverpod providers.
///
/// Import this single file to access every API-backed provider. Each provider
/// is a FutureProvider (for reads) or a StateNotifierProvider (for mutations /
/// complex state). Money is integer sen throughout; never parse it as a double.
library;

export 'provider_helpers.dart';
export 'dashboard_provider.dart';
export 'analytics_provider.dart';
export 'earnings_provider.dart';
export 'patient_provider.dart';
export 'appointment_provider.dart';
export 'schedule_provider.dart';
export 'consultation_provider.dart';
export 'message_provider.dart';
export 'template_provider.dart';
export 'ai_provider.dart';
export 'doctor_ai_provider.dart';
export 'iot_provider.dart';
export 'notification_provider.dart';
export 'profile_provider.dart';
export 'verification_provider.dart';
export 'support_ticket_provider.dart';
