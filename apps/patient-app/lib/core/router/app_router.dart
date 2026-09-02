import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../auth/auth_provider.dart';
import '../navigation/deep_link_handler.dart';
import '../network/api_client.dart';
import '../../features/auth/presentation/screens/splash_screen.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/signup_screen.dart';
import '../../features/auth/presentation/screens/forgot_password_screen.dart';
import '../../features/onboarding/presentation/screens/onboarding_screen.dart';
import '../../features/home/presentation/screens/home_screen_v2.dart';
import '../../features/consultations/presentation/screens/appointments_screen.dart';
import '../../features/consultations/presentation/screens/find_doctor_screen.dart';
import '../../features/consultations/presentation/screens/doctor_profile_screen.dart';
import '../../features/consultations/presentation/screens/book_appointment_screen.dart';
import '../../features/consultations/presentation/screens/video_consultation_screen.dart';
import '../../features/consultations/presentation/screens/audio_consultation_screen.dart';
import '../../features/consultations/presentation/screens/appointment_details_screen.dart';
import '../../features/consultations/presentation/screens/reschedule_appointment_screen.dart';
import '../../features/consultations/presentation/screens/reschedule_success_screen.dart';
import '../../features/consultations/presentation/screens/payment_screen.dart';
import '../../features/consultations/presentation/screens/payment_success_screen.dart';
import '../../features/consultations/presentation/screens/payment_failed_screen.dart';
import '../../features/home/presentation/screens/notifications_screen.dart';
import '../../features/messages/presentation/screens/doctor_chat_screen.dart';
import '../../features/messages/presentation/screens/ai_chat_screen.dart';
import '../../features/messages/presentation/screens/messages_list_screen.dart';
import '../../features/health/presentation/screens/health_screen.dart';
import '../../features/health/presentation/screens/enter_vitals_screen.dart';
import '../../features/profile/presentation/screens/profile_screen.dart';
import '../../features/profile/presentation/screens/edit_profile_screen.dart';
import '../../features/profile/presentation/screens/settings_screen.dart';
import '../../features/profile/presentation/screens/notification_preferences_screen.dart';
import '../../features/profile/presentation/screens/help_support_screen.dart';
import '../../features/profile/presentation/screens/medical_id_intro_screen.dart';
import '../../features/prescriptions/presentation/screens/prescriptions_list_screen.dart';
import '../../features/prescriptions/presentation/screens/prescription_details_screen.dart';
import '../../features/pharmacy/presentation/screens/pharmacy_orders_list_screen.dart';
import '../../features/pharmacy/presentation/screens/pharmacy_order_details_screen.dart';
import '../../features/emergency/presentation/screens/emergency_sos_screen.dart';
import '../../features/emergency/presentation/screens/emergency_contacts_setup_screen.dart';
// IoT Screens
import '../../features/iot/presentation/screens/patient_devices_screen.dart';
import '../../features/iot/presentation/screens/device_vitals_screen.dart';
import '../../features/iot/presentation/screens/add_device_screen.dart';
// AI Screens
import '../../features/ai/presentation/screens/smart_diagnosis_summary_view_1_screen.dart';
import '../../features/ai/presentation/screens/smart_diagnosis_summary_view_2_screen.dart';
import '../../features/ai/presentation/screens/smart_diagnosis_summary_view_3_screen.dart';
import '../navigation/app_shell.dart';
import '../navigation/full_screen_back_handler.dart';

/// Wraps a full-screen route's child with the back-button handler so the
/// system back button either pops to the previous route or returns to `/home`
/// with a double-tap-to-exit flow.
Widget _wrapFullScreen(Widget child) => FullScreenBackHandler(child: child);

/// Routes that do NOT require authentication. The redirect logic allows these
/// even when [AuthStatus] is [AuthStatus.unauthenticated].
const _publicRoutes = <String>{
  '/login',
  '/signup',
  '/forgot-password',
  '/onboarding',
  '/splash',
};

/// Routes that should be shown during the profile-setup bootstrap state.
const _profileSetupRoutes = <String>{
  '/edit-profile',
  '/onboarding',
};

/// Modern App Router using go_router with ShellRoute.
///
/// The [GoRouter] is created **once** and kept stable across auth-state
/// changes. When [authProvider] emits a new state we call `router.refresh()`
/// which re-evaluates the redirect without destroying the navigation stack.
///
/// This is the critical fix for the "webpage reload" bug: the previous
/// implementation used `ref.watch(authProvider)` inside the provider body,
/// which recreated the entire [GoRouter] on every auth-state change, resetting
/// the nav stack to `initialLocation` and causing what looked like a page
/// reload.
///
/// Bootstrap state routing:
///   profile_required → /edit-profile
///   verification_pending → /onboarding (verification screen)
///   role_selection_required → /onboarding (role picker)
///   ready → /home
final goRouterProvider = Provider<GoRouter>((ref) {
  final router = GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/splash',
    debugLogDiagnostics: false,
    redirect: (context, state) {
      // Read the current auth state on each redirect evaluation.
      // This is called by go_router on every navigation, so it always
      // sees the latest state without recreating the router.
      final authState = ref.read(authProvider);
      return _redirect(authState, state);
    },
    routes: _routes,
  );

  // When auth state changes, trigger a refresh so the redirect re-evaluates.
  // This keeps the router instance stable while still reacting to auth changes.
  ref.listen(authProvider, (_, __) {
    router.refresh();
  });

  return router;
});

/// The redirect logic. Pure function of [AuthState] + [GoRouterState] so it is
/// testable without a widget tree.
String? _redirect(AuthState auth, GoRouterState state) {
  final location = state.uri.path;

  // During the initial unknown state, send the user to splash so the app can
  // attempt a session restore without flashing the login screen.
  if (auth.status == AuthStatus.unknown) {
    if (location == '/splash') return null;
    return '/splash';
  }

  // Unauthenticated: allow public routes, redirect everything else to /login.
  if (auth.status == AuthStatus.unauthenticated) {
    if (_publicRoutes.contains(location)) return null;
    return '/login';
  }

  // Authenticated: apply bootstrap-state routing.
  if (auth.status == AuthStatus.authenticated) {
    // If the user is on /login or /signup, send them home.
    if (location == '/login' ||
        location == '/signup' ||
        location == '/splash') {
      return _bootstrapRoute(auth.bootstrapState, location);
    }

    // If the bootstrap state requires profile setup, force the user there
    // unless they are already on an allowed route.
    if (auth.bootstrapState == BootstrapState.profileRequired) {
      if (_profileSetupRoutes.contains(location)) return null;
      return '/edit-profile';
    }

    // Verification pending — keep the user on onboarding until resolved.
    if (auth.bootstrapState == BootstrapState.verificationPending) {
      if (location == '/onboarding') return null;
      return '/onboarding';
    }

    // Role selection required — keep the user on onboarding until they pick.
    if (auth.bootstrapState == BootstrapState.roleSelectionRequired) {
      if (location == '/onboarding') return null;
      return '/onboarding';
    }

    // Ready state — no redirect.
    return null;
  }

  return null;
}

/// Decide where to send an authenticated user who just landed on /login or
/// /splash, based on the bootstrap state.
///
/// A deep link that arrived while the user was unauthenticated is spent here,
/// exactly once, and only when the bootstrap state lets the user reach a
/// detail screen (profile setup / verification / role selection still win —
/// parking the link until those resolve would be pointless).
String _bootstrapRoute(BootstrapState? bootstrap, String currentLocation) {
  final bootstrapAllowsDeepLink = switch (bootstrap) {
    BootstrapState.profileRequired ||
    BootstrapState.verificationPending ||
    BootstrapState.roleSelectionRequired =>
      false,
    BootstrapState.ready || BootstrapState.unknown || null => true,
  };
  if (bootstrapAllowsDeepLink) {
    final pending = DeepLinkHandler.consumePendingLocation();
    if (pending != null) return pending;
  }
  return switch (bootstrap) {
    BootstrapState.profileRequired => '/edit-profile',
    BootstrapState.verificationPending => '/onboarding',
    BootstrapState.roleSelectionRequired => '/onboarding',
    BootstrapState.ready || null => '/home',
    BootstrapState.unknown => '/home',
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
final _shellNavigatorKey =
    GlobalKey<NavigatorState>(debugLabel: 'shellNavigator');

final List<RouteBase> _routes = [
  // Auth Routes (No bottom nav)
  GoRoute(
    path: '/splash',
    name: 'splash',
    builder: (context, state) => const SplashScreen(),
  ),
  GoRoute(
    path: '/onboarding',
    name: 'onboarding',
    builder: (context, state) => const OnboardingScreen(),
  ),
  GoRoute(
    path: '/login',
    name: 'login',
    builder: (context, state) => const LoginScreen(),
  ),
  GoRoute(
    path: '/signup',
    name: 'signup',
    builder: (context, state) => const SignUpScreen(),
  ),
  GoRoute(
    path: '/forgot-password',
    name: 'forgot-password',
    builder: (context, state) => const ForgotPasswordScreen(),
  ),

  // IoT Device Routes (Full screen, no bottom nav)
  GoRoute(
    path: '/iot/device-management',
    name: 'iot-device-management',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const PatientDevicesScreen()),
  ),
  GoRoute(
    path: '/iot/device-management/:id',
    name: 'iot-device-detail',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final id = state.pathParameters['id'] ?? '';
      // The list passes the Device summary via `extra` so the header renders
      // instantly before the patient-self read-one resolves. A deep link without
      // `extra` still works — the screen waits for patientDeviceDetailProvider.
      final extra = state.extra;
      Device? initialDevice;
      if (extra is Device) {
        initialDevice = extra;
      } else if (extra is Map<String, dynamic>) {
        // Defensive: tolerate a JSON map if a caller ever passes one.
        try {
          initialDevice = Device.fromJson(extra.cast<String, Object?>());
        } catch (_) {
          initialDevice = null;
        }
      }
      return _wrapFullScreen(DeviceVitalsScreen(
        deviceId: id,
        initialDevice: initialDevice,
      ));
    },
  ),
  GoRoute(
    path: '/iot/add-device',
    name: 'iot-add-device',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const AddDeviceScreen()),
  ),

  // AI Diagnosis Routes (Full screen, no bottom nav)
  GoRoute(
    path: '/ai/diagnosis-summary-1',
    name: 'ai-diagnosis-summary-1',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final artifactId = state.extra as String?;
      return _wrapFullScreen(
          SmartDiagnosisSummaryView1Screen(artifactId: artifactId ?? ''));
    },
  ),
  GoRoute(
    path: '/ai/diagnosis-summary-2',
    name: 'ai-diagnosis-summary-2',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final artifactId = state.extra as String?;
      return _wrapFullScreen(
          SmartDiagnosisSummaryView2Screen(artifactId: artifactId ?? ''));
    },
  ),
  GoRoute(
    path: '/ai/diagnosis-summary-3',
    name: 'ai-diagnosis-summary-3',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final artifactId = state.extra as String?;
      return _wrapFullScreen(
          SmartDiagnosisSummaryView3Screen(artifactId: artifactId ?? ''));
    },
  ),

  // Emergency Routes (Full screen, no bottom nav)
  GoRoute(
    path: '/emergency-contacts-setup',
    name: 'emergency-contacts-setup',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) =>
        _wrapFullScreen(const EmergencyContactsSetupScreen()),
  ),

  // Medical ID Route (Full screen, no bottom nav)
  GoRoute(
    path: '/medical-id-intro',
    name: 'medical-id-intro',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const MedicalIdIntroScreen()),
  ),

  // Full Screen Routes (No bottom nav) - OUTSIDE ShellRoute
  GoRoute(
    path: '/notifications',
    name: 'notifications',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const NotificationsScreen()),
  ),
  GoRoute(
    path: '/find-doctor',
    name: 'find-doctor',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const FindDoctorScreen()),
  ),
  GoRoute(
    path: '/doctor-profile',
    name: 'doctor-profile',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const DoctorProfileScreen()),
  ),
  GoRoute(
    path: '/book-appointment',
    name: 'book-appointment',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const BookAppointmentScreen()),
  ),
  GoRoute(
    path: '/video-consultation',
    name: 'video-consultation',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final extra = state.extra;
      String appointmentId = '';
      String doctorName = 'Doctor';
      String specialty = '';
      if (extra is String) {
        appointmentId = extra;
      } else if (extra is Map<String, dynamic>) {
        appointmentId = extra['appointmentId'] as String? ?? '';
        doctorName = extra['doctorName'] as String? ?? 'Doctor';
        specialty = extra['specialty'] as String? ?? '';
      }
      return _wrapFullScreen(VideoConsultationScreen(
        appointmentId: appointmentId,
        doctorName: doctorName,
        specialty: specialty,
      ));
    },
  ),
  GoRoute(
    path: '/audio-consultation',
    name: 'audio-consultation',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final extra = state.extra;
      String appointmentId = '';
      String doctorName = 'Doctor';
      String specialty = '';
      if (extra is String) {
        appointmentId = extra;
      } else if (extra is Map<String, dynamic>) {
        appointmentId = extra['appointmentId'] as String? ?? '';
        doctorName = extra['doctorName'] as String? ?? 'Doctor';
        specialty = extra['specialty'] as String? ?? '';
      }
      return _wrapFullScreen(AudioConsultationScreen(
        appointmentId: appointmentId,
        doctorName: doctorName,
        specialty: specialty,
      ));
    },
  ),
  GoRoute(
    path: '/appointment-details',
    name: 'appointment-details',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      // The id arrives either as a ?id= query param (deep links, which have
      // no extra) or from the route extra set by the appointments list.
      final queryId = state.uri.queryParameters['id'];
      final extra = state.extra;
      String? appointmentId;
      if (extra is String) {
        appointmentId = extra;
      } else if (extra is Map<String, dynamic>) {
        appointmentId = extra['appointmentId'] as String?;
      }
      return _wrapFullScreen(AppointmentDetailsScreen(
        appointmentId: queryId ?? appointmentId,
      ));
    },
  ),
  GoRoute(
    path: '/reschedule-appointment',
    name: 'reschedule-appointment',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) =>
        _wrapFullScreen(const RescheduleAppointmentScreen()),
  ),
  GoRoute(
    path: '/reschedule-success',
    name: 'reschedule-success',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final extra = state.extra;
      String? appointmentId;
      if (extra is String) {
        appointmentId = extra;
      } else if (extra is Map<String, dynamic>) {
        appointmentId = extra['appointmentId'] as String?;
      }
      return _wrapFullScreen(RescheduleSuccessScreen(
        appointmentId: appointmentId,
      ));
    },
  ),
  // Payment Routes (Full screen, no bottom nav)
  GoRoute(
    path: '/payment',
    name: 'payment',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const PaymentScreen()),
  ),
  GoRoute(
    path: '/payment-success',
    name: 'payment-success',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final extra = state.extra;
      int amountSen = 0;
      String currency = 'MYR';
      String doctorName = 'Doctor';
      String date = 'TBD';
      String time = 'TBD';
      String transactionId = 'TRX-${DateTime.now().millisecondsSinceEpoch}';
      if (extra is Map<String, dynamic>) {
        amountSen = (extra['amountSen'] as num?)?.toInt() ?? 0;
        currency = extra['currency'] as String? ?? 'MYR';
        doctorName = extra['doctorName'] as String? ?? 'Doctor';
        date = extra['date'] as String? ?? 'TBD';
        time = extra['time'] as String? ?? 'TBD';
        transactionId = extra['transactionId'] as String? ?? transactionId;
      }
      return _wrapFullScreen(PaymentSuccessScreen(
        amountSen: amountSen,
        currency: currency,
        doctorName: doctorName,
        date: date,
        time: time,
        transactionId: transactionId,
      ));
    },
  ),
  GoRoute(
    path: '/payment-failed',
    name: 'payment-failed',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final extra = state.extra;
      String? errorMessage;
      if (extra is String) {
        errorMessage = extra;
      } else if (extra is Map<String, dynamic>) {
        errorMessage = extra['errorMessage'] as String?;
      }
      return _wrapFullScreen(PaymentFailedScreen(
        errorMessage: errorMessage,
      ));
    },
  ),
  // Chat Routes (Full screen, no bottom nav)
  GoRoute(
    path: '/doctor-chat',
    name: 'doctor-chat',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      // ?id= comes from deep links; extra is the in-app path from the
      // messages list.
      final conversationId =
          state.uri.queryParameters['id'] ?? state.extra as String?;
      return _wrapFullScreen(
          DoctorChatScreen(conversationId: conversationId ?? ''));
    },
  ),
  GoRoute(
    path: '/ai-chat',
    name: 'ai-chat',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const AIChatScreen()),
  ),
  // Profile Routes (Full screen, no bottom nav)
  GoRoute(
    path: '/edit-profile',
    name: 'edit-profile',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const EditProfileScreen()),
  ),
  GoRoute(
    path: '/settings',
    name: 'settings',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const SettingsScreen()),
  ),
  GoRoute(
    path: '/notification-preferences',
    name: 'notification-preferences',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) =>
        _wrapFullScreen(const NotificationPreferencesScreen()),
  ),
  GoRoute(
    path: '/help-support',
    name: 'help-support',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const HelpSupportScreen()),
  ),
  // Prescription Routes (Full screen, no bottom nav)
  GoRoute(
    path: '/prescriptions',
    name: 'prescriptions',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) =>
        _wrapFullScreen(const PrescriptionsListScreen()),
  ),
  GoRoute(
    path: '/prescriptions/:id',
    name: 'prescription-details',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final id = state.pathParameters['id'] ?? '';
      return _wrapFullScreen(PrescriptionDetailsScreen(prescriptionId: id));
    },
  ),
  // Pharmacy Order Routes (Full screen, no bottom nav)
  GoRoute(
    path: '/pharmacy-orders',
    name: 'pharmacy-orders',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) =>
        _wrapFullScreen(const PharmacyOrdersListScreen()),
  ),
  GoRoute(
    path: '/pharmacy-orders/:id',
    name: 'pharmacy-order-details',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) {
      final id = state.pathParameters['id'] ?? '';
      return _wrapFullScreen(PharmacyOrderDetailsScreen(pharmacyOrderId: id));
    },
  ),
  // Emergency SOS Route (Full screen, no bottom nav)
  GoRoute(
    path: '/emergency-sos',
    name: 'emergency-sos',
    parentNavigatorKey: rootNavigatorKey,
    builder: (context, state) => _wrapFullScreen(const EmergencySOSScreen()),
  ),

  // Main App with Persistent Bottom Navigation - ONLY these 5 tabs
  ShellRoute(
    navigatorKey: _shellNavigatorKey,
    builder: (context, state, child) {
      return AppShell(child: child);
    },
    routes: [
      // Home Tab
      GoRoute(
        path: '/home',
        name: 'home',
        pageBuilder: (context, state) => NoTransitionPage(
          child: HomeScreenV2(key: state.pageKey),
        ),
      ),

      // Schedule Tab
      GoRoute(
        path: '/schedule',
        name: 'schedule',
        pageBuilder: (context, state) => const NoTransitionPage(
          child: AppointmentsScreen(),
        ),
      ),

      // Messages Tab
      GoRoute(
        path: '/messages',
        name: 'messages',
        pageBuilder: (context, state) => const NoTransitionPage(
          child: MessagesListScreen(),
        ),
      ),

      // Health Tab
      GoRoute(
        path: '/health',
        name: 'health',
        pageBuilder: (context, state) => const NoTransitionPage(
          child: HealthScreen(),
        ),
        routes: [
          // Enter Vitals Screen (nested under health)
          GoRoute(
            path: 'enter-vitals',
            name: 'enter-vitals',
            parentNavigatorKey: rootNavigatorKey,
            builder: (context, state) =>
                _wrapFullScreen(const EnterVitalsScreen()),
          ),
        ],
      ),

      // Profile Tab
      GoRoute(
        path: '/profile',
        name: 'profile',
        pageBuilder: (context, state) => const NoTransitionPage(
          child: ProfileScreen(),
        ),
      ),
    ],
  ),
];
