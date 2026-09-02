import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../auth/auth_provider.dart';

/// Router location of the notification centre (an app-shell tab).
const kNotificationsLocation = '/notifications';

/// Standard UUID shape (uuidv7 included). A deep-link path segment must match
/// before it is ever interpolated into a route — an attacker-crafted link must
/// not be able to steer the query string.
final _uuidPattern = RegExp(
  r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
  caseSensitive: false,
);

/// Map a `smartcura://` URI to a driver-app router location.
///
/// The scheme is shared by every SmartCura app, so most hosts belong to the
/// patient/doctor apps; this app only owns `orders` (a dispatch assignment).
/// Unknown hosts and malformed links land on the notification centre, where the
/// notification's own body carries the context — never on a guessed detail
/// screen.
///
/// Returns null when the URI is not a `smartcura://` link at all (e.g. a stray
/// local-notification payload), meaning "do not navigate".
String? mapSmartCuraUri(Uri uri) {
  if (uri.scheme != 'smartcura') return null;
  // Two parse shapes arrive: `smartcura://orders/<uuid>` (host + path) and the
  // authority-less `smartcura:orders/<uuid>` (everything in the path).
  // Normalise both to host + remaining segments.
  var segments =
      uri.pathSegments.where((s) => s.isNotEmpty).toList(growable: false);
  String host;
  if (uri.host.isNotEmpty) {
    host = uri.host;
  } else if (segments.isNotEmpty) {
    host = segments.first;
    segments = segments.sublist(1);
  } else {
    return kNotificationsLocation;
  }
  switch (host) {
    case 'orders':
      final id = segments.isNotEmpty ? segments.first : '';
      // Only a well-formed uuid may reach the query string.
      if (!_uuidPattern.hasMatch(id)) return kNotificationsLocation;
      return '/order-details?id=$id';
    case 'notifications':
      return kNotificationsLocation;
    // prescriptions, pharmacy-orders, appointments, conversations … belong to
    // the patient/doctor apps; this install can only show the notification.
    default:
      return kNotificationsLocation;
  }
}

/// Router location for an in-app notification row, mirroring the server's
/// `deepLinkForResource` mapping (`apps/api/apps/worker/src/notification-copy.ts`).
/// Both halves live here so push taps and list taps take exactly one path.
String locationForResource(String resourceType, String resourceId) {
  final link = switch (resourceType) {
    'dispatch_assignment' => 'smartcura://orders/$resourceId',
    _ => 'smartcura://notifications',
  };
  return mapSmartCuraUri(Uri.parse(link)) ?? kNotificationsLocation;
}

/// Holds the deep link to apply once the user is authenticated. Written by
/// [DeepLinkHandler] when a link arrives while signed out; consumed by the app
/// root when the auth state flips to authenticated (the post-login landing).
final pendingDeepLinkProvider = StateProvider<String?>((ref) => null);

/// Dispatches `smartcura://` links from three sources — the app_links stream
/// (cold start + warm links), FCM `onMessageOpenedApp`, and local-notification
/// taps — through one stash-or-navigate path.
///
/// When the user is not authenticated the location is stashed in
/// [pendingDeepLinkProvider] instead of navigated; the app root applies it when
/// the session appears (cold start restore or an explicit sign-in).
class DeepLinkHandler {
  DeepLinkHandler({
    required bool Function() isAuthenticated,
    required void Function(String location) stash,
  })  : _isAuthenticated = isAuthenticated,
        _stash = stash;

  final bool Function() _isAuthenticated;
  final void Function(String location) _stash;

  AppLinks? _appLinks;
  StreamSubscription<Uri>? _linkSub;

  /// Set by the app root once the router exists: navigates to a location.
  void Function(String location)? navigate;

  /// Start listening for `smartcura://` links: the cold-start link first, then
  /// the stream for links that arrive while the app is running.
  Future<void> start() async {
    _appLinks ??= AppLinks();
    if (_linkSub != null) return;
    try {
      final initial = await _appLinks!.getInitialLink();
      if (initial != null) handleUri(initial);
    } catch (e) {
      debugPrint('[DeepLink] initial link unavailable: $e');
    }
    _linkSub = _appLinks!.uriLinkStream.listen(
      handleUri,
      onError: (e) => debugPrint('[DeepLink] stream error: $e'),
    );
  }

  /// Map and dispatch one URI. Non-`smartcura` URIs and unauthenticated users
  /// never navigate directly.
  void handleUri(Uri uri) {
    final location = mapSmartCuraUri(uri);
    if (location == null) return;
    if (_isAuthenticated()) {
      navigate?.call(location);
    } else {
      _stash(location);
    }
  }

  /// Dispatch a local-notification tap payload (the `deep_link` string the
  /// notification was shown with). Unparseable or foreign payloads are ignored.
  void handleNotificationPayload(String? payload) {
    if (payload == null || payload.isEmpty) return;
    final uri = Uri.tryParse(payload);
    if (uri != null) handleUri(uri);
  }

  void dispose() {
    _linkSub?.cancel();
    _linkSub = null;
  }
}

/// Provides the app-wide [DeepLinkHandler]. `navigate` is bound to the go-router
/// by the app root widget (avoids a router ↔ handler import cycle).
final deepLinkHandlerProvider = Provider<DeepLinkHandler>((ref) {
  final handler = DeepLinkHandler(
    isAuthenticated: () =>
        ref.read(authProvider).status == AuthStatus.authenticated,
    stash: (location) =>
        ref.read(pendingDeepLinkProvider.notifier).state = location,
  );
  ref.onDispose(handler.dispose);
  return handler;
});
