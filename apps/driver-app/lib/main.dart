import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'core/auth/auth_provider.dart';
import 'core/auth/firebase_initializer.dart';
import 'core/constants/app_constants.dart';
import 'core/navigation/deep_link_handler.dart';
import 'core/notifications/fcm_service.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

/// SmartCura Driver App Entry Point
///
/// Global Configuration:
/// - System UI: Driver primary color (#1E3FAE) status bar, light nav bar
/// - Orientation: Portrait only
/// - Theme: Material 3 with driver blue theme + dark theme
/// - Navigation: go_router with ShellRoute for persistent bottom nav (5 tabs)
/// - Auth: Firebase initialised gracefully (falls back when unconfigured),
///   then the session is restored from secure storage and the router redirect
///   routes on bootstrap state.
/// - Push: FCM token registered with the backend once authenticated
///   ([fcmRegistrationProvider]); `smartcura://` deep links and notification
///   taps route through [DeepLinkHandler], stashing the destination when the
///   user is not signed in and applying it after login.
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

  // Driver blue status bar to prevent white flash on splash.
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Color(0xFF1E3FAE), // Driver primary
      statusBarIconBrightness: Brightness.light,
      statusBarBrightness: Brightness.dark,
      systemNavigationBarColor: Color(0xFF1E3FAE),
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

  // Initialise local notifications for foreground push display, and create the
  // Android channels the worker's `androidChannel` values reference.
  await _initLocalNotifications();

  runApp(
    const ProviderScope(
      child: SmartCuraDriverApp(),
    ),
  );
}

/// Local notification plugin (singleton). Used to display FCM/data pushes when
/// the app is in the foreground.
final FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin =
    FlutterLocalNotificationsPlugin();

const _initSettings = InitializationSettings(
  android: AndroidInitializationSettings('@mipmap/ic_launcher'),
  iOS: DarwinInitializationSettings(
    requestAlertPermission: false,
    requestBadgePermission: false,
    requestSoundPermission: false,
  ),
);

Future<void> _initLocalNotifications() async {
  try {
    await flutterLocalNotificationsPlugin.initialize(_initSettings);
    // Channels must exist before a notification references them, or Android
    // drops it onto a fallback channel.
    await createAndroidChannels(flutterLocalNotificationsPlugin);
  } catch (e) {
    debugPrint('Local notifications init skipped: $e');
  }
}

class SmartCuraDriverApp extends ConsumerStatefulWidget {
  const SmartCuraDriverApp({super.key});

  @override
  ConsumerState<SmartCuraDriverApp> createState() => _SmartCuraDriverAppState();
}

class _SmartCuraDriverAppState extends ConsumerState<SmartCuraDriverApp>
    with WidgetsBindingObserver {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Restore the session once on launch; the router redirect reacts to the
    // resulting auth state. Deep links, notification taps, and the FCM
    // lifecycle are bound on the first frame, once providers exist.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _bindPushAndDeepLinks();
      ref.read(authProvider.notifier).bootstrap();
    });
  }

  /// Bind deep links (app_links cold start + stream), local-notification taps,
  /// the FCM cold-start launch notification, and the router navigation hook.
  void _bindPushAndDeepLinks() {
    final deepLinks = ref.read(deepLinkHandlerProvider);
    deepLinks.navigate = (location) => ref.read(goRouterProvider).go(location);
    // Re-initialise the plugin with the tap callback now that the deep-link
    // handler exists (callback registration is part of initialize).
    flutterLocalNotificationsPlugin
        .initialize(
      _initSettings,
      onDidReceiveNotificationResponse: (response) =>
          deepLinks.handleNotificationPayload(response.payload),
    )
        .catchError((e) {
      debugPrint('Local notifications tap binding skipped: $e');
      return false;
    });
    deepLinks.start();
    ref.read(fcmServiceProvider).checkInitialNotification();
    ref.read(fcmServiceProvider).listenForNotificationTaps();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    // Keep the auth-gated FCM registration alive: it registers the token on
    // sign-in and closes the message streams on sign-out.
    ref.watch(fcmRegistrationProvider);

    // Apply a stashed deep link the moment the user becomes authenticated
    // (session restore on cold start or an explicit sign-in) — this is where
    // the router lands after login.
    ref.listen<AuthState>(authProvider, (previous, next) {
      if (next.status != AuthStatus.authenticated) return;
      final pending = ref.read(pendingDeepLinkProvider);
      if (pending == null) return;
      ref.read(pendingDeepLinkProvider.notifier).state = null;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        ref.read(goRouterProvider).go(pending);
      });
    });

    final router = ref.watch(goRouterProvider);
    return MaterialApp.router(
      title: AppConstants.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: ThemeMode.system,
      routerConfig: router,
    );
  }
}
