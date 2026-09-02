import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../auth/auth_provider.dart';
import '../../features/auth/presentation/screens/splash_screen.dart';
import '../../features/auth/presentation/screens/onboarding_screen.dart';
import '../../features/auth/presentation/screens/login_screen.dart';
import '../../features/auth/presentation/screens/registration_screen.dart';
import '../../features/auth/presentation/screens/verification_pending_screen.dart';
import '../../features/auth/presentation/screens/forgot_password_screen.dart';
import '../../features/dashboard/presentation/screens/driver_dashboard_screen.dart';
import '../../features/orders/presentation/screens/available_orders_screen.dart';
import '../../features/orders/presentation/screens/order_details_screen.dart';
import '../../features/orders/presentation/screens/order_history_screen.dart';
import '../../features/orders/presentation/screens/navigation_to_pickup_screen.dart';
import '../../features/orders/presentation/screens/pickup_confirmation_screen.dart';
import '../../features/orders/presentation/screens/navigation_to_hospital_screen.dart';
import '../../features/orders/presentation/screens/delivery_confirmation_screen.dart';
import '../../features/orders/presentation/screens/trip_complete_screen.dart';
import '../../features/earnings/presentation/screens/earnings_screen.dart';
import '../../features/earnings/presentation/screens/withdrawal_screen.dart';
import '../../features/notifications/presentation/screens/notifications_screen.dart';
import '../../features/profile/presentation/screens/profile_screen.dart';
import '../../features/profile/presentation/screens/edit_profile_screen.dart';
import '../../features/settings/presentation/screens/settings_screen.dart';
import '../../features/support/presentation/screens/help_support_screen.dart';
import '../navigation/app_shell.dart';

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

/// Modern App Router using go_router with ShellRoute and an auth redirect.
///
/// The redirect reads [authProvider] so navigation reacts to session state:
///  - `unknown` → stay on `/splash` until bootstrap resolves.
///  - `unauthenticated` → protected routes redirect to `/login`.
///  - `authenticated` on `/login` → redirect to `/dashboard`.
///  - `verification_pending` bootstrap → redirect to `/verification-pending`.
///  - `profile_required` bootstrap → redirect to `/onboarding` (profile setup).
///  - `role_selection_required` → for now, fall through to `/dashboard`; the
///    role picker screen is Phase 3.
final goRouterProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authProvider);

  return GoRouter(
    navigatorKey: _rootNavigatorKey,
    initialLocation: '/splash',
    debugLogDiagnostics: true,
    redirect: (context, state) =>
        _guard(authState, state.matchedLocation),
    routes: _routes,
  );
});

String? _guard(AuthState auth, String location) {
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

  // An authenticated user lingering on a public auth route goes to dashboard.
  if (isPublic && location != '/splash') {
    return '/dashboard';
  }
  return null;
}

// ---- Static keys + routes (kept top-level so they are not rebuilt) ----------

final GlobalKey<NavigatorState> _rootNavigatorKey = GlobalKey<NavigatorState>();
final GlobalKey<NavigatorState> _shellNavigatorKey = GlobalKey<NavigatorState>();

final List<RouteBase> _routes = [
  // ---- Public auth routes ------------------------------------------------
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
    path: '/register',
    name: 'register',
    builder: (context, state) => const RegistrationScreen(),
  ),
  GoRoute(
    path: '/verification-pending',
    name: 'verification-pending',
    builder: (context, state) => const VerificationPendingScreen(),
  ),
  GoRoute(
    path: '/forgot-password',
    name: 'forgot-password',
    builder: (context, state) => const ForgotPasswordScreen(),
  ),

  // ---- Main app with persistent bottom navigation (5 tabs) ---------------
  ShellRoute(
    navigatorKey: _shellNavigatorKey,
    builder: (context, state, child) => AppShell(child: child),
    routes: [
      GoRoute(
        path: '/dashboard',
        name: 'dashboard',
        pageBuilder: (context, state) =>
            NoTransitionPage(child: DriverDashboardScreen(key: state.pageKey)),
      ),
      GoRoute(
        path: '/orders',
        name: 'orders',
        pageBuilder: (context, state) =>
            NoTransitionPage(child: AvailableOrdersScreen(key: state.pageKey)),
      ),
      GoRoute(
        path: '/earnings',
        name: 'earnings',
        pageBuilder: (context, state) =>
            NoTransitionPage(child: EarningsScreen(key: state.pageKey)),
      ),
      GoRoute(
        path: '/notifications',
        name: 'notifications',
        pageBuilder: (context, state) =>
            NoTransitionPage(child: NotificationsScreen(key: state.pageKey)),
      ),
      GoRoute(
        path: '/profile',
        name: 'profile',
        pageBuilder: (context, state) =>
            NoTransitionPage(child: ProfileScreen(key: state.pageKey)),
      ),
    ],
  ),

  // ---- Full-screen delivery flow (no bottom nav) -------------------------
  GoRoute(
    path: '/order-details',
    name: 'order-details',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => OrderDetailsScreen(
        orderId: state.uri.queryParameters['id'] ?? ''),
  ),
  GoRoute(
    path: '/navigation-pickup',
    name: 'navigation-pickup',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => NavigationToPickupScreen(
        orderId: state.uri.queryParameters['id'] ?? ''),
  ),
  GoRoute(
    path: '/pickup-confirm',
    name: 'pickup-confirm',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => PickupConfirmationScreen(
        orderId: state.uri.queryParameters['id'] ?? ''),
  ),
  GoRoute(
    path: '/navigation-hospital',
    name: 'navigation-hospital',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => NavigationToHospitalScreen(
        orderId: state.uri.queryParameters['id'] ?? ''),
  ),
  GoRoute(
    path: '/delivery-confirm',
    name: 'delivery-confirm',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => DeliveryConfirmationScreen(
        orderId: state.uri.queryParameters['id'] ?? ''),
  ),
  GoRoute(
    path: '/trip-complete',
    name: 'trip-complete',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => TripCompleteScreen(
        orderId: state.uri.queryParameters['id'] ?? ''),
  ),
  GoRoute(
    path: '/order-history',
    name: 'order-history',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const OrderHistoryScreen(),
  ),
  GoRoute(
    path: '/withdraw',
    name: 'withdraw',
    parentNavigatorKey: _rootNavigatorKey,
    builder: (context, state) => const WithdrawalScreen(),
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
];
