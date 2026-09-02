import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_provider.dart' as auth;
import '../auth/firebase_initializer.dart';
import '../navigation/deep_link_handler.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import 'notification_copy.dart';
import 'push_device_store.dart';

/// The shared local-notifications plugin instance. Owned here so both the main
/// isolate (foreground messages) and the background isolate (background handler)
/// can post through it. `main.dart` initialises it before runApp.
late FlutterLocalNotificationsPlugin flutterLocalNotificationsPlugin;

/// Android notification channels matching the `androidChannel` values the
/// worker sends in the FCM android config (`fcm-push.provider.ts` sets
/// `notification.channel_id` from the server catalogue). They must exist on the
/// device before a notification references them, or Android silently drops it
/// onto a fallback channel — `createAndroidChannels` runs once at app init.
///
/// 'emergency' is high-importance with sound (heads-up); 'appointments' is
/// high-importance so reminders surface as heads-up; 'medical' and 'messages'
/// carry default importance; 'system' is low so general notices do not buzz.
const List<AndroidNotificationChannel> kAndroidChannels = [
  AndroidNotificationChannel(
    'emergency',
    'Emergency alerts',
    description: 'Critical emergency and SOS alerts',
    importance: Importance.high,
    playSound: true,
  ),
  AndroidNotificationChannel(
    'appointments',
    'Appointments',
    description: 'Appointment reminders and schedule updates',
    importance: Importance.high,
  ),
  AndroidNotificationChannel(
    'medical',
    'Medical updates',
    description: 'Prescription and clinical updates',
    importance: Importance.defaultImportance,
  ),
  AndroidNotificationChannel(
    'messages',
    'Messages',
    description: 'New conversation messages',
    importance: Importance.defaultImportance,
  ),
  AndroidNotificationChannel(
    'system',
    'System notices',
    description: 'General SmartCura notices',
    importance: Importance.low,
  ),
];

/// Creates the Android notification channels once. Safe to call repeatedly;
/// Android treats channel creation as an upsert of the immutable properties.
Future<void> createAndroidChannels(
    FlutterLocalNotificationsPlugin plugin) async {
  if (!Platform.isAndroid) return;
  final android = plugin.resolvePlatformSpecificImplementation<
      AndroidFlutterLocalNotificationsPlugin>();
  for (final channel in kAndroidChannels) {
    await android?.createNotificationChannel(channel);
  }
}

/// Maps a backend `priority` value to a channel id. The worker sends
/// `priority` ('critical'|'high'|'normal'|'low') and/or an explicit
/// `android_channel` ('emergency'|'appointments'|'medical'|'messages'|
/// 'system'). The explicit channel wins when present; otherwise the priority
/// is mapped: critical/high → emergency, normal → system, low → system.
String _channelIdForMessage(RemoteMessage message) {
  final data = message.data;
  final explicit = data['android_channel'] as String?;
  if (explicit != null && explicit.isNotEmpty) {
    return kAndroidChannels.any((c) => c.id == explicit) ? explicit : 'system';
  }
  final priority = data['priority'] as String? ?? 'normal';
  switch (priority) {
    case 'critical':
    case 'high':
      return 'emergency';
    case 'normal':
    case 'low':
    default:
      return 'system';
  }
}

/// Returns the [AndroidNotificationChannel] for the given id, falling back to
/// the 'system' channel (or the first channel if 'system' is somehow missing).
AndroidNotificationChannel _channelById(String id) {
  return kAndroidChannels.firstWhere(
    (c) => c.id == id,
    orElse: () => kAndroidChannels.firstWhere(
      (c) => c.id == 'system',
      orElse: () => kAndroidChannels.first,
    ),
  );
}

/// Provides the [FcmService] singleton.
final fcmServiceProvider = Provider<FcmService>((ref) {
  return FcmService(ref.watch(apiClientProvider));
});

/// Watches the auth state and registers the FCM token with the backend once the
/// user is authenticated, then starts foreground message listening. Re-evaluates
/// whenever the auth status flips. The registration is idempotent — re-registering
/// the same token is a server-side upsert (`ON CONFLICT (token_hash) DO UPDATE`).
final fcmTokenRegistrationProvider = Provider<void>((ref) {
  final status = ref.watch(auth.authProvider.select((s) => s.status));
  if (status != auth.AuthStatus.authenticated) return;
  final service = ref.read(fcmServiceProvider);
  // Fire-and-forget: registration failure is non-fatal and will be retried on
  // the next token refresh or app launch. Foreground listening is idempotent.
  Future(() async {
    await service.registerToken();
    service.listenForegroundMessages();
  });
});

/// Coordinates Firebase Cloud Messaging with the SmartCura backend.
///
/// Responsibilities:
///  - Request notification permission on first launch (when Firebase is configured).
///  - Obtain the FCM registration token and register it with
///    `POST /notifications/push-devices` so the worker can push to this device.
///  - Re-register the token on refresh (`onTokenRefresh`).
///  - Display foreground data messages via `flutter_local_notifications`.
///  - Route notification taps through the deep-link handler.
///  - Register the top-level background message handler.
///
/// The service is safe to call when Firebase is not configured (`firebaseConfigured`
/// is false): every method short-circuits so the app runs without FCM in that state.
class FcmService {
  FcmService(this._dio);

  final Dio _dio;
  StreamSubscription<String>? _tokenRefreshSub;
  StreamSubscription<RemoteMessage>? _onMessageSub;
  bool _permissionRequested = false;
  bool _channelCreated = false;

  /// Push device id returned by `POST /notifications/push-devices` for the
  /// token this process registered. [AuthService.signOut] reads it from the
  /// persisted [PushDeviceStore] so the device can be revoked even after an
  /// app restart. Null when this install never registered a token — sign-out
  /// then skips silently rather than inventing an id.
  static Future<String?> getRegisteredPushDeviceId() async {
    final store = await PushDeviceStore.load();
    return store.pushDeviceId;
  }

  /// Last message the background isolate handled. The background isolate runs
  /// on a separate heap, so a static written there is NOT visible to the main
  /// isolate and it cannot navigate — kept for diagnostics only. Taps on
  /// background notifications reach the router via `getInitialMessage`
  /// (terminated launch) and the local-notification payload (tap on the
  /// locally posted banner).
  static RemoteMessage? lastBackgroundMessage;

  /// Must be called once early in the app lifecycle (after Firebase init) to
  /// register the top-level background handler. This is a no-op when Firebase
  /// is not configured. Static so it can be called before the ProviderScope
  /// exists.
  static void registerBackgroundHandler() {
    if (!firebaseConfigured) return;
    FirebaseMessaging.onBackgroundMessage(_firebaseBackgroundHandler);
  }

  /// Requests notification permission, fetches the FCM token, and registers it
  /// with the backend. Idempotent: the permission request only happens once per
  /// process, and re-registering the same token is a server-side upsert
  /// (`ON CONFLICT (token_hash) DO UPDATE`).
  Future<void> registerToken() async {
    if (!firebaseConfigured) return;
    if (!_permissionRequested) {
      await FirebaseMessaging.instance
          .requestPermission(alert: true, badge: true, sound: true);
      _permissionRequested = await _ensureAndroidChannel();
    }

    final token = await FirebaseMessaging.instance.getToken();
    if (token != null && token.isNotEmpty) {
      await _registerWithBackend(token);
    }

    // Re-register whenever the OS rotates the token.
    _tokenRefreshSub ??=
        FirebaseMessaging.instance.onTokenRefresh.listen(_registerWithBackend);
  }

  /// Sets up the foreground message stream so data messages are displayed as
  /// local notifications while the app is open. Call once after the widget tree
  /// is mounted.
  void listenForegroundMessages() {
    if (!firebaseConfigured) return;
    _onMessageSub ??=
        FirebaseMessaging.onMessage.listen(_showForegroundNotification);
  }

  /// Cancels the token-refresh and foreground subscriptions. Called on sign-out
  /// so a new user signing in on the same device re-registers cleanly.
  void dispose() {
    _tokenRefreshSub?.cancel();
    _tokenRefreshSub = null;
    _onMessageSub?.cancel();
    _onMessageSub = null;
  }

  /// Registers notification-tap routing. Call once from the app widget:
  ///  - `getInitialMessage` covers a tray tap that launched the terminated
  ///    app (call-once semantics — it keeps returning the launch message, so
  ///    it must not be polled),
  ///  - `onMessageOpenedApp` covers tray taps while backgrounded/foreground.
  /// Taps on locally-posted banners (data messages the plugin displayed) come
  /// through the payload callback initialised in `main.dart`.
  static void listenForNotificationTaps() {
    if (!firebaseConfigured || _tapsListening) return;
    _tapsListening = true;
    FirebaseMessaging.onMessageOpenedApp.listen(_routeTap);
    FirebaseMessaging.instance.getInitialMessage().then((message) {
      if (message != null) _routeTap(message);
    });
  }

  static bool _tapsListening = false;

  /// Routes a tap through the deep-link handler, preferring the server-built
  /// `deep_link` and falling back to `resource_type` + `resource_id`.
  static void _routeTap(RemoteMessage message) {
    DeepLinkHandler.instance.openNotificationPayload(
      deepLink: message.data['deep_link'] as String?,
      resourceType: message.data['resource_type'] as String?,
      resourceId: message.data['resource_id'] as String?,
    );
  }

  Future<void> _registerWithBackend(String token) async {
    final platform = Platform.isIOS ? 'ios' : 'android';
    try {
      final response = await _dio.post<Map<String, dynamic>>(
        ApiEndpoints.pushDevices,
        data: {'platform': platform, 'token': token},
      );
      final deviceId = response.data?['push_device_id'] as String?;
      if (deviceId != null && deviceId.isNotEmpty) {
        final store = await PushDeviceStore.load();
        await store.save(deviceId);
      }
      debugPrint('[FCM] registered token with backend ($platform)');
    } catch (e) {
      // Non-fatal: the token will be re-registered on the next refresh or
      // app launch. We log so a misconfiguration is visible in dev.
      debugPrint('[FCM] token registration failed: $e');
    }
  }

  Future<void> _showForegroundNotification(RemoteMessage message) async {
    final notification = message.notification;
    final copy = copyForCode(message.data['title_code'] as String?);
    final title = notification?.title ?? copy.title;
    final body = notification?.body ?? copy.body;
    await _ensureAndroidChannel();
    final channel = _channelById(_channelIdForMessage(message));
    flutterLocalNotificationsPlugin.show(
      message.hashCode,
      title,
      body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          channel.id,
          channel.name,
          channelDescription: channel.description,
          importance: channel.importance,
          priority: channel.importance == Importance.high
              ? Priority.high
              : Priority.defaultPriority,
          icon: '@mipmap/ic_launcher',
        ),
        iOS: const DarwinNotificationDetails(),
      ),
      // The smartcura:// link the tap follows; consumed by the payload
      // callback registered in main.dart.
      payload: message.data['deep_link'] as String?,
    );
  }

  /// Creates all Android notification channels once per process. Returns true
  /// when the channels are ready (or the platform is not Android). Channels are
  /// also created eagerly in `main.dart` at init; this is a safety net for the
  /// case where a foreground message arrives before init completes.
  Future<bool> _ensureAndroidChannel() async {
    if (_channelCreated) return true;
    _channelCreated = true;
    if (!Platform.isAndroid) return true;
    await createAndroidChannels(flutterLocalNotificationsPlugin);
    return true;
  }
}

/// Top-level background message handler. Must be a top-level (or static) function
/// so it can be registered as an isolate entry point. Displays the notification
/// via the local-notifications plugin; the plugin is re-initialised here because
/// the background isolate does not share state with the main isolate.
@pragma('vm:entry-point')
Future<void> _firebaseBackgroundHandler(RemoteMessage message) async {
  // Firebase Messaging is available in the background isolate without calling
  // initializeApp again when the platform config files are present. If they
  // are absent, firebaseConfigured is false on the main isolate but the
  // background isolate never runs, so this guard is a safety net.
  if (!firebaseConfigured) return;
  // Store for the UI to inspect (diagnostics only — see the static's doc).
  FcmService.lastBackgroundMessage = message;
  final plugin = FlutterLocalNotificationsPlugin();
  await plugin.initialize(
    const InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      iOS: DarwinInitializationSettings(),
    ),
  );
  // Create all channels so the background isolate can route to the correct one.
  await createAndroidChannels(plugin);
  final channel = _channelById(_channelIdForMessage(message));
  final notification = message.notification;
  final copy = copyForCode(message.data['title_code'] as String?);
  final title = notification?.title ?? copy.title;
  final body = notification?.body ?? copy.body;
  await plugin.show(
    message.hashCode,
    title,
    body,
    NotificationDetails(
      android: AndroidNotificationDetails(
        channel.id,
        channel.name,
        channelDescription: channel.description,
        importance: channel.importance,
        priority: channel.importance == Importance.high
            ? Priority.high
            : Priority.defaultPriority,
        icon: '@mipmap/ic_launcher',
      ),
      iOS: const DarwinNotificationDetails(),
    ),
    // A tap on this banner re-launches/foregrounds the app; the payload
    // carries the smartcura:// link so the main isolate can route it.
    payload: message.data['deep_link'] as String?,
  );
}
