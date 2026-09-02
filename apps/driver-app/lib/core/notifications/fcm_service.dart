import 'dart:async';
import 'dart:io';

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_provider.dart' as auth;
import '../auth/firebase_initializer.dart';
import '../navigation/deep_link_handler.dart';
import '../network/api_client.dart';
import 'notification_copy.dart';
import 'push_device_store.dart';

/// Android notification channels matching the `androidChannel` values the
/// worker sends in the FCM android config (`fcm-push.provider.ts` sets
/// `notification.channel_id` from the server catalogue). They must exist on the
/// device before a notification references them, or Android silently drops it
/// onto a fallback channel — `createAndroidChannels` runs once at app init.
///
/// 'emergency' is high-importance with sound (heads-up); the rest carry the
/// platform default importance so routine updates do not buzz.
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
    'Appointments & deliveries',
    description: 'Appointment and delivery schedule updates',
    importance: Importance.defaultImportance,
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
    importance: Importance.defaultImportance,
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

/// Provides the [FcmService] singleton.
final fcmServiceProvider = Provider<FcmService>((ref) {
  return FcmService(
    api: ref.watch(apiClientProvider),
    deepLinks: ref.watch(deepLinkHandlerProvider),
  );
});

/// Watches the auth state and drives the FCM lifecycle: once the user is
/// authenticated, the token is registered with the backend and the message
/// streams are opened; when the session goes away the subscriptions close so a
/// different user signing in on the same device re-registers cleanly.
///
/// Registration is idempotent — re-registering the same token is a server-side
/// upsert (`ON CONFLICT (token_hash) DO UPDATE`). Failure is non-fatal and
/// retried on the next token refresh or app launch.
final fcmRegistrationProvider = Provider<void>((ref) {
  final status = ref.watch(auth.authProvider.select((s) => s.status));
  if (status == auth.AuthStatus.unknown) return;
  final service = ref.read(fcmServiceProvider);
  if (status != auth.AuthStatus.authenticated) {
    service.dispose();
    return;
  }
  // Fire-and-forget: push registration must never block the UI.
  Future(() async {
    await service.registerToken();
    service.listenForegroundMessages();
  });
});

/// Coordinates Firebase Cloud Messaging with the SmartCura backend.
///
/// Responsibilities:
///  - Request notification permission and obtain the FCM registration token.
///  - Register the token with `POST /notifications/push-devices` and persist the
///    returned `push_device_id` (see [PushDeviceStore]) for sign-out revocation.
///  - Re-register on `onTokenRefresh`.
///  - Display foreground messages through `flutter_local_notifications` on the
///    channel matching the message's urgency.
///  - Route notification taps (`onMessageOpenedApp`, local-notification taps,
///    and the cold-start launch notification) through [DeepLinkHandler].
///
/// Every method short-circuits when Firebase is not configured
/// (`firebaseConfigured == false`), so the app runs without FCM in that state.
///
/// There is deliberately no background-message handler: the worker always sends
/// an FCM `notification` field, so Android's system tray already displays
/// background/terminated pushes — a data-message handler would show every
/// notification twice.
class FcmService {
  FcmService({required ApiClient api, required DeepLinkHandler deepLinks})
      : _api = api,
        _deepLinks = deepLinks,
        _localNotifications = FlutterLocalNotificationsPlugin();

  final ApiClient _api;
  final DeepLinkHandler _deepLinks;
  final FlutterLocalNotificationsPlugin _localNotifications;

  StreamSubscription<String>? _tokenRefreshSub;
  StreamSubscription<RemoteMessage>? _onMessageSub;
  StreamSubscription<RemoteMessage>? _onMessageOpenedAppSub;
  bool _permissionRequested = false;

  /// Request permission, fetch the FCM token, and register it with the backend.
  Future<void> registerToken() async {
    if (!firebaseConfigured) return;
    if (!_permissionRequested) {
      await FirebaseMessaging.instance
          .requestPermission(alert: true, badge: true, sound: true);
      _permissionRequested = true;
    }

    final token = await FirebaseMessaging.instance.getToken();
    if (token != null && token.isNotEmpty) {
      await _registerWithBackend(token);
    }

    // Re-register whenever the OS rotates the token.
    _tokenRefreshSub ??=
        FirebaseMessaging.instance.onTokenRefresh.listen(_registerWithBackend);
  }

  /// Display foreground data messages as local notifications. Call once the
  /// widget tree is mounted (idempotent).
  void listenForegroundMessages() {
    if (!firebaseConfigured) return;
    _onMessageSub ??=
        FirebaseMessaging.onMessage.listen(_showForegroundNotification);
  }

  /// Route FCM notification taps — both the cold-start launch notification
  /// (`getInitialMessage`) and tray taps while backgrounded/foregrounded
  /// (`onMessageOpenedApp`) — through the deep-link handler. Call once from the
  /// app widget before sign-in completes so an unauthenticated cold start still
  /// stashes the destination for after login. Idempotent.
  void listenForNotificationTaps() {
    if (!firebaseConfigured) return;
    _onMessageOpenedAppSub ??= FirebaseMessaging.onMessageOpenedApp.listen(
      (message) => _deepLinks.handleNotificationPayload(
        message.data['deep_link'] as String?,
      ),
    );
    FirebaseMessaging.instance.getInitialMessage().then((message) {
      if (message != null) {
        _deepLinks.handleNotificationPayload(
          message.data['deep_link'] as String?,
        );
      }
    });
  }

  /// Route the notification that launched the app (cold start via a
  /// locally-displayed notification tap). Call once after the widget tree is
  /// mounted — before sign-in completes — so an unauthenticated cold start still
  /// stashes the destination for after login.
  Future<void> checkInitialNotification() async {
    try {
      final details =
          await _localNotifications.getNotificationAppLaunchDetails();
      if (details == null || !details.didNotificationLaunchApp) return;
      _deepLinks
          .handleNotificationPayload(details.notificationResponse?.payload);
    } catch (e) {
      debugPrint('[FCM] initial notification check failed: $e');
    }
  }

  /// Cancel the token-refresh and message subscriptions. Called on sign-out so
  /// the next user re-registers cleanly. The push-device revocation is handled
  /// separately by the auth service's sign-out, which needs the session alive.
  void dispose() {
    _tokenRefreshSub?.cancel();
    _tokenRefreshSub = null;
    _onMessageSub?.cancel();
    _onMessageSub = null;
    _onMessageOpenedAppSub?.cancel();
    _onMessageOpenedAppSub = null;
  }

  Future<void> _registerWithBackend(String token) async {
    try {
      final body = await _api.post(
        ApiEndpoints.pushDevices,
        body: <String, dynamic>{
          'platform': Platform.isIOS ? 'ios' : 'android',
          'token': token,
        },
      );
      final pushDeviceId = body['push_device_id'] as String?;
      if (pushDeviceId != null && pushDeviceId.isNotEmpty) {
        final store = await PushDeviceStore.load();
        await store.save(pushDeviceId);
        debugPrint('[FCM] push device registered: $pushDeviceId');
      } else {
        debugPrint('[FCM] registration response carried no push_device_id');
      }
    } catch (e) {
      // Non-fatal: re-registered on the next refresh or app launch. Logged so a
      // permission misconfiguration is visible in dev.
      debugPrint('[FCM] token registration failed: $e');
    }
  }

  void _showForegroundNotification(RemoteMessage message) {
    final data = message.data;
    final priority = data['priority'] as String? ?? 'normal';
    final isUrgent = priority == 'critical' || priority == 'high';
    // Urgent messages ride the high-importance 'emergency' channel; everything
    // else lands on the default 'system' channel.
    final channel = _channelById(isUrgent ? 'emergency' : 'system');
    final notification = message.notification;
    final copy = NotificationCopy.forCode(data['title_code'] as String?);
    final title = notification?.title ?? copy.title;
    final body = notification?.body ?? copy.body;
    final deepLink = data['deep_link'] as String?;

    _localNotifications.show(
      message.hashCode,
      title,
      body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          channel.id,
          channel.name,
          channelDescription: channel.description,
          importance: isUrgent ? Importance.high : Importance.defaultImportance,
          priority: isUrgent ? Priority.high : Priority.defaultPriority,
          icon: '@mipmap/ic_launcher',
        ),
        iOS: const DarwinNotificationDetails(),
      ),
      payload: deepLink,
    );
  }

  AndroidNotificationChannel _channelById(String id) =>
      kAndroidChannels.firstWhere((c) => c.id == id);
}
