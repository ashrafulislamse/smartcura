import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:workmanager/workmanager.dart';

import 'core/auth/auth_provider.dart';
import 'core/auth/firebase_initializer.dart';
import 'core/background/health_sync.dart';
import 'core/constants/app_constants.dart';
import 'core/navigation/deep_link_handler.dart';
import 'core/notifications/fcm_service.dart';
import 'core/router/app_router.dart';
import 'core/theme/app_theme.dart';

/// SmartCura Patient App Entry Point.
///
/// Startup order:
///  1. WidgetsFlutterBinding.ensureInitialized()
///  2. Firebase (graceful fallback if not configured)
///  3. Local notifications plugin
///  4. Image cache configuration
///  5. System UI + orientation
///  6. runApp(ProviderScope)
///
/// The [SmartCuraApp] is a [ConsumerWidget] so it can read [goRouterProvider].
/// Session restore is handled entirely by the splash screen — **not** here.
/// Calling `restoreSession()` in `build()` caused duplicate network calls on
/// every rebuild and contributed to the "webpage reload" behavior.

void main() async {
  // Ensure Flutter binding is initialized before any async work.
  WidgetsFlutterBinding.ensureInitialized();

  // Initialise Firebase. Sets firebaseConfigured = false on failure (no
  // google-services.json / GoogleService-Info.plist) so auth screens can show
  // a "contact admin" state instead of crashing.
  await initializeFirebase();

  // Local notifications for push (FCM tokens are registered via the backend
  // POST /notifications/push-devices once a session exists).
  flutterLocalNotificationsPlugin = FlutterLocalNotificationsPlugin();
  await _initializeLocalNotifications();

  // Register the FCM background isolate handler. The handler must be a
  // top-level function; registering it here lets the OS wake it for data
  // messages even before the UI is launched. No-op when Firebase is not
  // configured.
  FcmService.registerBackgroundHandler();

  // Background Health Connect sync (workmanager). The callback runs in a
  // separate isolate; it is registered here so the OS can wake it even before
  // the UI is launched. The periodic task is only scheduled when the user has
  // enabled auto-sync — see the toggle on the Sync Vitals screen.
  await Workmanager().initialize(callbackDispatcher);
  if (await getAutoSyncEnabled()) {
    await registerBackgroundHealthSync();
  }

  // Configure image cache BEFORE runApp.
  PaintingBinding.instance.imageCache.maximumSize = 100;
  PaintingBinding.instance.imageCache.maximumSizeBytes = 50 << 20; // 50 MB

  // Portrait only.
  await SystemChrome.setPreferredOrientations([
    DeviceOrientation.portraitUp,
    DeviceOrientation.portraitDown,
  ]);

  // Global system UI overlay style.
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
      statusBarBrightness: Brightness.light,
      systemNavigationBarColor: Color(0xFFF6F6F8),
      systemNavigationBarIconBrightness: Brightness.dark,
      systemNavigationBarDividerColor: Colors.transparent,
    ),
  );

  runApp(
    const ProviderScope(
      child: SmartCuraApp(),
    ),
  );
}

/// Initialise the local notifications plugin with default Android/iOS settings.
/// Taps on locally-posted FCM notifications route through the deep-link
/// handler; the payload is the `smartcura://` link carried by the message.
Future<void> _initializeLocalNotifications() async {
  const androidInit = AndroidInitializationSettings('@mipmap/ic_launcher');
  const iosInit = DarwinInitializationSettings(
    requestAlertPermission: false,
    requestBadgePermission: false,
    requestSoundPermission: false,
  );
  const settings = InitializationSettings(
    android: androidInit,
    iOS: iosInit,
  );
  try {
    await flutterLocalNotificationsPlugin.initialize(
      settings,
      onDidReceiveNotificationResponse: (response) {
        DeepLinkHandler.instance.openDeepLink(response.payload);
      },
    );
    // Channels must exist before a notification references them, or Android
    // drops it onto a fallback channel.
    await createAndroidChannels(flutterLocalNotificationsPlugin);
  } catch (e) {
    debugPrint('[Notifications] local notifications init failed: $e');
  }
}

class SmartCuraApp extends ConsumerWidget {
  const SmartCuraApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(goRouterProvider);
    // Activate FCM token registration: the provider watches auth state and
    // registers the token with the backend once the user is authenticated.
    ref.watch(fcmTokenRegistrationProvider);

    // Deep links (smartcura://): cold start + stream. The auth probe is read
    // lazily so an event always sees the current session state; an
    // unauthenticated tap is parked as the pending post-login location.
    DeepLinkHandler.instance.bind(
      router: router,
      isAuthenticated: () =>
          ref.read(authProvider).status == AuthStatus.authenticated,
    );

    // Route notification taps that launched the app from the terminated state
    // and taps delivered while in foreground/background (FCM data messages).
    FcmService.listenForNotificationTaps();

    return MaterialApp.router(
      title: AppConstants.appName,
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      routerConfig: router,
    );
  }
}
