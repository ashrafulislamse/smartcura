import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../auth/auth_provider.dart';
import '../../features/dashboard/presentation/screens/dashboard_screen.dart';
import '../../features/appointments/presentation/screens/appointments_list_screen.dart';
import '../../features/appointments/presentation/screens/appointment_details_screen.dart';
import '../../features/patients/presentation/screens/patients_list_screen.dart';
import '../../features/profile/presentation/screens/profile_screen.dart';
import '../../features/auth/presentation/screens/splash_screen.dart';
import '../../features/auth/presentation/screens/onboarding_screen.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/registration_screen.dart';
import '../../features/auth/presentation/screens/verification_pending_screen.dart';
import '../../features/auth/presentation/screens/forgot_password_screen.dart';
import '../../features/notifications/presentation/screens/notifications_screen.dart';
import '../../features/schedule/presentation/screens/my_schedule_screen.dart';
import '../../features/consultation/presentation/screens/video_consultation_screen.dart';
import '../../features/consultation/presentation/screens/chat_consultation_screen.dart';
import '../../features/consultation/presentation/screens/consultation_notes_screen.dart';
import '../../features/consultation/presentation/screens/e_prescription_screen.dart';
import '../../features/messages/presentation/screens/messages_list_screen.dart';
import '../../features/patients/presentation/screens/patient_details_screen.dart';
import '../../features/profile/presentation/screens/settings_screen.dart';
import '../../features/profile/presentation/screens/edit_profile_screen.dart';
import '../../features/support/presentation/screens/help_support_screen.dart';
import '../../features/ai/presentation/screens/doctor_ai_assistant_screen.dart';
import '../../features/ai/presentation/screens/doctor_ai_artifacts_screen.dart';
import '../../features/analytics/presentation/screens/doctor_analytics_screen.dart';
import '../../features/earnings/presentation/screens/doctor_earnings_screen.dart';
import '../navigation/app_shell.dart';
import '../navigation/deep_link_handler.dart';

/// Routes that exist purely for the auth flow and must be reachable without a
/// session. Everything else is treated as protected.
const _publicRoutes = <String>{
  '/splash',
  '/onboarding',
  '/login',
  '/register',
  '/verification-pending',
  '/forgot-password',
};

/// A [Listenable] that forwards [StateNotifier] state changes to [GoRouter]'s
/// [refreshListenable], so the router re-evaluates its redirect without being
/// recreated. This avoids the infinite-rebuild loop that happens when
/// `ref.watch(authProvider)` is used inside the router provider.
class _AuthRefreshListenable extends ChangeNotifier {
  _AuthRefreshListenable(Ref ref) {
    ref.listen<AuthState>(authProvider, (_, __) {
      debugPrint('[Router] auth state changed, refreshing redirect');
      notifyListeners();
    });
  }
}

/// Creates the [GoRouter] once. The [redirect] reads the current auth state
/// via [ref.read] (not [ref.watch]) so the router is never recreated.
final goRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/splash',
    debugLogDiagnostics: true,
    refreshListenable: _AuthRefreshListenable(ref),
    redirect: (context, state) {
      final auth = ref.read(authProvider);
      final deepLinks = ref.read(deepLinkHandlerProvider);
      // Peek, don't consume: the stash must survive redirects that do not end
      // at the post-login dashboard landing. It is consumed below only when
      // the guard actually returns it.
      final destination =
          _guard(auth, state.matchedLocation, deepLinks.peekPendingLocation());
      if (destination != null &&
          destination == deepLinks.peekPendingLocation()) {
        deepLinks.consumePendingLocation();
      }
      return destination;
    },
    routes: _routes,
  );
});

String? _guard(AuthState auth, String location, String? pendingDeepLink) {
  final isPublic = _publicRoutes.contains(location);

  // While bootstrap is unresolved, keep the user on splash.
  if (auth.status == AuthStatus.unknown) {
    return location == '/splash' ? null : '/splash';
  }

  // Unauthenticated: allow public routes, force everything else to login.
  if (auth.status != AuthStatus.authenticated) {
    return isPublic ? null : '/login';
  }

  // Authenticated. Branch on bootstrap state for routing hints.
  final bootstrap = auth.bootstrapState;
  if (bootstrap == BootstrapState.verificationPending &&
      location != '/verification-pending') {
    return '/verification-pending';
  }
  if (bootstrap == BootstrapState.profileRequired &&
      location != '/onboarding') {
    return '/onboarding';
  }

  // An authenticated user lingering on a public auth route goes to dashboard,
  // unless a stashed deep-link destination is waiting — e.g. a notification
  // tapped before login. The caller consumes the stash when this branch wins,
  // so the destination is preferred exactly once no matter how many landings
  // race.
  if (isPublic && location != '/splash') {
    return pendingDeepLink ?? '/dashboard';
  }
  return null;
}

// ---- Static keys + routes (kept top-level so they are not rebuilt) ----------

final GlobalKey<NavigatorState> _rootNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<NavigatorState> _shellNavigatorKey =
    GlobalKey<NavigatorState>();

final List<RouteBase> _routes = [
  // Splash Screen (Entry Point)
  GoRoute(
    path: '/splash',
    name: 'splash',
    builder: (context, state) => const SplashScreen(),
  ),
  // Onboarding (First-time users / profile setup)
  GoRoute(
    path: '/onboarding',
    name: 'onboarding',
    builder: (context, state) => const OnboardingScreen(),
  ),
  // Login Screen
  GoRoute(
    path: '/login',
    name: 'login',
    builder: (context, state) => const LoginScreen(),
  ),
  // Registration Screen
  GoRoute(
    path: '/register',
    name: 'register',
    builder: (context, state) => const RegistrationScreen(),
  ),
  // Verification Pending Screen
  GoRoute(
    path: '/verification-pending',
    name: 'verification-pending',
    builder: (context, state) => const VerificationPendingScreen(),
  ),
  // Forgot Password Screen
  GoRoute(
    path: '/forgot-password',
    name: 'forgot-password',
    builder: (context, state) => const ForgotPasswordScreen(),
  ),
  // Main App with Persistent Bottom Navigation (5 tabs)
  ShellRoute(
    navigatorKey: _shellNavigatorKey,
    builder: (context, state, child) => AppShell(child: child),
    routes: [
      GoRoute(
        path: '/dashboard',
        name: 'dashboard',
        pageBuilder: (context, state) =>
            NoTransitionPage(child: DashboardScreen(key: state.pageKey)),
      ),
      GoRoute(
        path: '/appointments',
        name: 'appointments',
        pageBuilder: (context, state) =>
            const NoTransitionPage(child: AppointmentsListScreen()),
      ),
      GoRoute(
        path: '/messages',
        name: 'messages',
        pageBuilder: (context, state) =>
            const NoTransitionPage(child: MessagesListScreen()),
      ),
      GoRoute(
        path: '/patients',
        name: 'patients',
        pageBuilder: (context, state) =>
            const NoTransitionPage(child: PatientsListScreen()),
      ),
      GoRoute(
        path: '/profile',
        name: 'profile',
        pageBuilder: (context, state) =>
            const NoTransitionPage(child: ProfileScreen()),
      ),
    ],
  ),
  // Full Screen Routes (No bottom nav) - OUTSIDE ShellRoute
  GoRoute(
    path: '/notifications',
    name: 'notifications',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const NotificationsScreen(),
  ),
  GoRoute(
    path: '/appointment-details',
    name: 'appointment-details',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => AppointmentDetailsScreen(
      // Deep links land here as /appointment-details?id=<uuid>; in-app
      // navigation pushes the id via `extra`. Query param first, extra as
      // fallback.
      appointmentId: state.uri.queryParameters['id'] ?? state.extra as String?,
    ),
  ),
  GoRoute(
    path: '/my-schedule',
    name: 'my-schedule',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const MyScheduleScreen(),
  ),
  GoRoute(
    path: '/video-consultation',
    name: 'video-consultation',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const VideoConsultationScreen(),
  ),
  GoRoute(
    path: '/chat-consultation',
    name: 'chat-consultation',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const ChatConsultationScreen(),
  ),
  GoRoute(
    path: '/consultation-notes',
    name: 'consultation-notes',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const ConsultationNotesScreen(),
  ),
  GoRoute(
    path: '/e-prescription',
    name: 'e-prescription',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const EPrescriptionScreen(),
  ),
  GoRoute(
    path: '/patient-details',
    name: 'patient-details',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => PatientDetailsScreen(
      // Deep links land here as /patient-details?id=<uuid>; in-app navigation
      // pushes the id via `extra`. Query param first, extra as fallback.
      patientId: state.uri.queryParameters['id'] ?? state.extra as String?,
    ),
  ),
  GoRoute(
    path: '/settings',
    name: 'settings',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const SettingsScreen(),
  ),
  GoRoute(
    path: '/edit-profile',
    name: 'edit-profile',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const EditProfileScreen(),
  ),
  GoRoute(
    path: '/help-support',
    name: 'help-support',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const HelpSupportScreen(),
  ),
  GoRoute(
    path: '/analytics',
    name: 'analytics',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const DoctorAnalyticsScreen(),
  ),
  GoRoute(
    path: '/earnings',
    name: 'earnings',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const DoctorEarningsScreen(),
  ),
  GoRoute(
    path: '/doctor-ai',
    name: 'doctor-ai',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const DoctorAiAssistantScreen(),
  ),
  GoRoute(
    path: '/doctor-ai/artifacts',
    name: 'doctor-ai-artifacts',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const DoctorAiArtifactsScreen(),
  ),
];
