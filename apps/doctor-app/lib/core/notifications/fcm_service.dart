import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_provider.dart' as auth;
import '../auth/firebase_initializer.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../navigation/deep_link_handler.dart';
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
    description: 'Critical emergency and dispatch alerts',
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
/// doctor is authenticated, then starts foreground message listening.
/// Re-evaluates whenever the auth status flips. Registration is idempotent —
/// re-registering the same token is a server-side upsert.
final fcmTokenRegistrationProvider = Provider<void>((ref) {
  final status = ref.watch(auth.authProvider.select((s) => s.status));
  if (status != auth.AuthStatus.authenticated) return;
  final service = ref.read(fcmServiceProvider);
  Future(() async {
    await service.registerToken();
    service.listenForegroundMessages();
  });
});

/// Coordinates Firebase Cloud Messaging with the SmartCura backend for the
/// doctor app.
///
/// Responsibilities:
///  - Request notification permission and obtain the FCM registration token.
///  - Register the token with `POST /notifications/push-devices` and track the
///    returned `push_device_id` for sign-out revocation.
///  - Re-register on `onTokenRefresh`.
///  - Display foreground messages through `flutter_local_notifications` on the
///    channel matching the message's urgency.
///  - Route notification taps (`getInitialMessage`, `onMessageOpenedApp`, and
///    local-notification taps) through [DeepLinkHandler.instance].
///
/// Every method short-circuits when Firebase is not configured
/// (`firebaseConfigured == false`), so the app runs without FCM in that state.
class FcmService {
  FcmService(this._api);

  final ApiClient _api;
  StreamSubscription<String>? _tokenRefreshSub;
  StreamSubscription<RemoteMessage>? _onMessageSub;
  bool _permissionRequested = false;
  bool _channelsCreated = false;

  /// Registers the top-level background handler. Static so it can be called
  /// before the ProviderScope exists. No-op when Firebase is not configured.
  static void registerBackgroundHandler() {
    if (!firebaseConfigured) return;
    FirebaseMessaging.onBackgroundMessage(_firebaseBackgroundHandler);
  }

  /// Requests notification permission, fetches the FCM token, and registers it
  /// with the backend. Idempotent.
  Future<void> registerToken() async {
    if (!firebaseConfigured) return;
    if (!_permissionRequested) {
      await FirebaseMessaging.instance
          .requestPermission(alert: true, badge: true, sound: true);
      _permissionRequested = true;
      await _ensureAndroidChannels();
    }

    final token = await FirebaseMessaging.instance.getToken();
    if (token != null && token.isNotEmpty) {
      await _registerWithBackend(token);
    }

    _tokenRefreshSub ??=
        FirebaseMessaging.instance.onTokenRefresh.listen(_registerWithBackend);
  }

  /// Sets up the foreground message stream so data messages are displayed as
  /// local notifications while the app is open. Call once after the widget
  /// tree is mounted (idempotent).
  void listenForegroundMessages() {
    if (!firebaseConfigured) return;
    _onMessageSub ??=
        FirebaseMessaging.onMessage.listen(_showForegroundNotification);
  }

  /// Handles notification taps from both cold-start (terminated app launch via
  /// FCM tray tap) and warm (app was backgrounded). Call once from the app
  /// widget — before sign-in completes — so an unauthenticated cold start
  /// still stashes the destination for after login.
  ///
  /// Static so it can be called without a provider reference. Routes through
  /// [DeepLinkHandler.instance], which stashes the destination when the user
  /// is not yet authenticated and navigates when they are.
  static bool _tapsListening = false;

  static Future<void> listenForNotificationTaps() async {
    if (!firebaseConfigured || _tapsListening) return;
    _tapsListening = true;
    // Warm: tray taps while the app was backgrounded/foreground.
    FirebaseMessaging.onMessageOpenedApp.listen(_routeTap);
    // Cold start: the FCM tray notification that launched the terminated app.
    // Call-once semantics — getInitialMessage keeps returning the launch
    // message, so it must not be polled.
    final initialMessage = await FirebaseMessaging.instance.getInitialMessage();
    if (initialMessage != null) {
      _routeTap(initialMessage);
    }
  }

  /// Cancels subscriptions. Called on sign-out so a new doctor signing in on the
  /// same device re-registers cleanly.
  void dispose() {
    _tokenRefreshSub?.cancel();
    _tokenRefreshSub = null;
    _onMessageSub?.cancel();
    _onMessageSub = null;
  }

  /// Best-effort revocation of this device's push registration
  /// (`PUT /notifications/push-devices/{id}/revocation`). Called before the
  /// session is revoked on sign-out; after it, the call would 401. Skipped
  /// silently when no device is tracked. Never throws — sign-out must proceed
  /// even when the backend is unreachable.
  Future<void> revokeTrackedPushDevice() async {
    final store = await PushDeviceStore.load();
    final deviceId = store.pushDeviceId;
    if (deviceId == null || deviceId.isEmpty) return;
    try {
      await _api.put(ApiEndpoints.pushDeviceRevocation(deviceId));
      debugPrint('[FCM] revoked push device $deviceId');
    } catch (e) {
      debugPrint('[FCM] push-device revocation failed (continuing): $e');
    } finally {
      await store.clear();
      dispose();
    }
  }

  Future<void> _registerWithBackend(String token) async {
    final platform = Platform.isIOS ? 'ios' : 'android';
    try {
      final body = await _api.post(
        ApiEndpoints.pushDevices,
        body: {'platform': platform, 'token': token},
      );
      final deviceId = body['push_device_id'] as String?;
      if (deviceId != null && deviceId.isNotEmpty) {
        final store = await PushDeviceStore.load();
        await store.save(deviceId);
      }
      debugPrint('[FCM] registered token with backend ($platform)');
    } catch (e) {
      debugPrint('[FCM] token registration failed: $e');
    }
  }

  // ---- Tap routing ---------------------------------------------------------

  /// Routes an FCM notification tap through the deep-link handler. Static so
  /// [listenForNotificationTaps] can call it without an instance.
  static void _routeTap(RemoteMessage message) {
    DeepLinkHandler.instance.handleNotificationData(message.data);
  }

  // ---- Foreground display --------------------------------------------------

  void _showForegroundNotification(RemoteMessage message) {
    final copy = NotificationCopy.forCode(
      message.data['title_code'] as String?,
    );
    final notification = message.notification;
    // The server-side catalogue already renders real title/body into the
    // `notification` field; the client catalogue is the fallback for data-only
    // messages and mirrors the same wording.
    final title = notification?.title ?? copy.title;
    final body = notification?.body ?? copy.body;
    final channel = _channelById(_channelIdForMessage(message));
    final isUrgent = channel.importance == Importance.high;
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
          priority: isUrgent ? Priority.high : Priority.defaultPriority,
          icon: '@mipmap/ic_launcher',
        ),
        iOS: const DarwinNotificationDetails(),
      ),
      // The tap callback (installed in main.dart) routes this payload through
      // DeepLinkHandler.instance.openDeepLink. The payload is the JSON-encoded
      // FCM data map, which openDeepLink parses and dispatches.
      payload: jsonEncode(message.data),
    );
  }

  /// Creates all Android notification channels once per process. Channels are
  /// also created eagerly in `main.dart` at init; this is a safety net for the
  /// case where a foreground message arrives before init completes.
  Future<void> _ensureAndroidChannels() async {
    if (_channelsCreated) return;
    _channelsCreated = true;
    await createAndroidChannels(flutterLocalNotificationsPlugin);
  }
}

/// Top-level background message handler. Must be a top-level (or static) function
/// so it can be registered as an isolate entry point. Displays the notification
/// via the local-notifications plugin; the plugin is re-initialised here because
/// the background isolate does not share state with the main isolate.
@pragma('vm:entry-point')
Future<void> _firebaseBackgroundHandler(RemoteMessage message) async {
  if (!firebaseConfigured) return;
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
  final copy = NotificationCopy.forCode(
    message.data['title_code'] as String?,
  );
  final notification = message.notification;
  final title = notification?.title ?? copy.title;
  final body = notification?.body ?? copy.body;
  final isUrgent = channel.importance == Importance.high;
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
        priority: isUrgent ? Priority.high : Priority.defaultPriority,
        icon: '@mipmap/ic_launcher',
      ),
      iOS: const DarwinNotificationDetails(),
    ),
    // Same payload contract as the foreground display: the tap lands in
    // DeepLinkHandler.instance.openDeepLink once the main isolate is up.
    payload: jsonEncode(message.data),
  );
}
