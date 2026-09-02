import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'core/auth/auth_provider.dart';
import 'core/auth/auth_service.dart';
import 'core/auth/firebase_initializer.dart';
import 'core/constants/app_constants.dart';
import 'core/navigation/deep_link_handler.dart';
import 'core/notifications/fcm_service.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

/// SmartCura Doctor App Entry Point
///
/// Global Configuration:
/// - System UI: Transparent status bar, light navigation bar (#F6F6F8)
/// - Orientation: Portrait only
/// - Theme: Material 3 with Teal theme (professional medical) + dark theme
/// - Navigation: go_router with ShellRoute for persistent bottom nav (5 tabs)
/// - Auth: Firebase initialised gracefully (falls back when unconfigured),
///   then the session is restored from secure storage and the router redirect
///   routes on bootstrap state.
///
/// Performance Optimizations:
/// - Image cache configured for optimal memory usage
/// - Deferred loading of heavy dependencies
/// - Minimal main thread blocking
/// - Production-grade standards
Future<void> main() async {
  // CRITICAL: Ensure Flutter binding is initialized before any async work.
  WidgetsFlutterBinding.ensureInitialized();

  // Configure image cache BEFORE runApp.
  PaintingBinding.instance.imageCache.maximumSize = 100;
  PaintingBinding.instance.imageCache.maximumSizeBytes = 50 << 20; // 50 MB

  // Portrait only.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Teal status bar / green nav bar to prevent white flash on splash.
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Color(0xFF0F766E), // Teal-700
      statusBarIconBrightness: Brightness.light,
      statusBarBrightness: Brightness.dark,
      systemNavigationBarColor: Color(0xFF10B981), // Green-500
      systemNavigationBarIconBrightness: Brightness.light,
      systemNavigationBarDividerColor: Colors.transparent,
    ),
  );

  // Initialise Firebase gracefully (sets firebaseConfigured=false on failure).
  await initializeFirebase();

  // Load environment variables (non-fatal if absent).
  try {
    await dotenv.load(fileName: '.env');
  } catch (_) {
    // No .env file — continue with compiled-in constants.
  }

  // Initialise the local-notifications plugin instance and create channels.
  flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();
  await _initLocalNotifications();

  // Register the FCM background isolate handler. No-op when Firebase is not
  // configured.
  FcmService.registerBackgroundHandler();

  runApp(
    const ProviderScope(
      child: SmartCuraDoctorApp(),
    ),
  );
}

/// Initialise the local notifications plugin with default Android/iOS settings.
/// Taps on locally-posted FCM notifications route through the deep-link handler
/// singleton ([DeepLinkHandler.instance]); the payload is the JSON-encoded FCM
/// data map, which [DeepLinkHandler.openDeepLink] parses and dispatches.
Future<void> _initLocalNotifications() async {
  const initSettings = InitializationSettings(
    android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    iOS: DarwinInitializationSettings(
      requestAlertPermission: false,
      requestBadgePermission: false,
      requestSoundPermission: false,
    ),
  );
  try {
    await flutterLocalNotificationsPlugin.initialize(
      initSettings,
      // Taps on locally-posted notifications (foreground display + background
      // data messages) route directly through the deep-link handler singleton.
      // This works even before auth completes — the handler stashes the
      // destination and applies it at the post-login landing.
      onDidReceiveNotificationResponse: (response) {
        DeepLinkHandler.instance.openDeepLink(response.payload);
      },
    );
    // Channels must exist before a notification references them, or Android
    // drops it onto a fallback channel.
    await createAndroidChannels(flutterLocalNotificationsPlugin);
  } catch (e) {
    debugPrint('Local notifications init skipped: $e');
  }
}

class SmartCuraDoctorApp extends ConsumerStatefulWidget {
  const SmartCuraDoctorApp({super.key});

  @override
  ConsumerState<SmartCuraDoctorApp> createState() => _SmartCuraDoctorAppState();
}

class _SmartCuraDoctorAppState extends ConsumerState<SmartCuraDoctorApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Restore the session once on launch; the router redirect reacts to the
    // resulting auth state.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(authProvider.notifier).bootstrap();
    });
    // Start deep-link handling (cold start + stream). The router resolver and
    // auth-state checker are injected here because the router provider is
    // created by the build below, and the handler is also read from the
    // router's own redirect.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(deepLinkHandlerProvider).init(
            resolveRouter: () => ref.read(goRouterProvider),
            isAuthenticated: () {
              final auth = ref.read(authProvider);
              return auth.status == AuthStatus.authenticated &&
                  auth.bootstrapState == BootstrapState.ready;
            },
          );
    });
    // Route FCM notification taps that launched the app from the terminated
    // state (getInitialMessage) and taps delivered while in
    // foreground/background (onMessageOpenedApp). Called early so an
    // unauthenticated cold start still stashes the destination.
    FcmService.listenForNotificationTaps();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      // Touch the session when returning from background so the demo stays
      // logged in while the evaluator moves between apps or screens.
      ref.read(authProvider.notifier).touchSession();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final router = ref.watch(goRouterProvider);
    // Activate FCM token registration: the provider watches auth state and
    // registers the token with the backend once the doctor is authenticated.
    ref.watch(fcmTokenRegistrationProvider);
    return MaterialApp.router(
      title: AppConstants.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      routerConfig: router,
    );
  }
}
