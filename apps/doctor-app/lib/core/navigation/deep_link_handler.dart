import 'dart:async';
import 'dart:convert';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

/// Deep-link handling for `smartcura://` URIs (FCM notification taps).
///
/// The backend's push payload carries a `deep_link` such as
/// `smartcura://appointments/<uuid>`; tapping a notification must land the
/// doctor on the matching screen. This module owns three things:
///
/// 1. A pure URI-to-route mapping ([mapDeepLinkToLocation]) that validates the
///    resource id as a UUID before interpolating it into a route.
/// 2. Cold-start + stream plumbing via the `app_links` plugin: the link that
///    launched the app ([AppLinks.getInitialLink]) and any link opened while
///    the app runs ([AppLinks.uriLinkStream]).
/// 3. A pending-destination stash: a link that arrives while the doctor is not
///    (yet) authenticated is remembered and applied once at the post-login
///    `/dashboard` landing — the router redirect and the splash screen both
///    call [consumePendingLocation] so the destination wins exactly once,
///    whichever landing fires first.
///
/// A static singleton ([instance]) exists so `main.dart`'s local-notification
/// tap callback can route through this handler before the ProviderScope is
/// created. The Riverpod [deepLinkHandlerProvider] returns the same instance;
/// [init] injects the router resolver and auth-state checker once providers
/// are available.
///
/// This file deliberately does NOT import the router provider: the router's
/// redirect reads this handler, and importing it back would create a provider
/// initialization cycle. Navigation goes through the [GoRouter] instance
/// handed to [init] by the app shell.
class DeepLinkHandler {
  DeepLinkHandler._();

  /// Static singleton — accessible before the ProviderScope exists so
  /// `main.dart`'s local-notification tap callback can route immediately.
  /// The Riverpod [deepLinkHandlerProvider] returns this same instance.
  static final DeepLinkHandler instance = DeepLinkHandler._();

  /// Resolves the live router. Injected by the app shell (which owns the
  /// router through `goRouterProvider`) rather than read from the provider,
  /// to avoid a provider-initialization cycle with the router's redirect.
  GoRouter Function()? _resolveRouter;

  /// Returns whether the user is authenticated and bootstrapped-ready.
  /// Injected by the app shell so the handler can check auth state without
  /// holding a `Ref` (the static instance exists before the ProviderScope).
  bool Function()? _isAuthenticated;

  AppLinks? _appLinks;
  StreamSubscription<Uri>? _linkSub;
  bool _initialized = false;

  /// Route location waiting to be applied at the next authenticated landing.
  String? _pendingLocation;

  /// UUID-shaped resource id: 8-4-4-4-12 hex groups. The backend ids are
  /// UUIDv7, so a loose canonical-UUID check (not a strict version check) is
  /// the right validation before the id is interpolated into a route.
  static final RegExp _uuidLike = RegExp(
    r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  );

  /// Starts cold-start + stream handling. Idempotent. Call once the widget
  /// tree is mounted and the router + auth providers exist.
  void init({
    required GoRouter Function() resolveRouter,
    required bool Function() isAuthenticated,
  }) {
    _resolveRouter = resolveRouter;
    _isAuthenticated = isAuthenticated;
    if (_initialized) return;
    _initialized = true;
    try {
      _appLinks = AppLinks();
    } catch (e) {
      debugPrint('[DeepLink] AppLinks unavailable: $e');
      return;
    }

    // Cold start: the link that launched the app. If the session is not yet
    // restored it is stashed and applied at the post-login landing.
    _appLinks!.getInitialLink().then((uri) {
      if (uri != null) handleUri(uri);
    }).catchError((e) {
      debugPrint('[DeepLink] initial link error: $e');
    });

    // Warm: links opened while the app is running.
    _linkSub = _appLinks!.uriLinkStream.listen(
      handleUri,
      onError: (e) => debugPrint('[DeepLink] stream error: $e'),
    );
  }

  /// Entry point for every deep link (cold start, stream, notification tap).
  ///
  /// Authenticated + bootstrapped-ready doctors navigate immediately;
  /// everything else (signed out, mid-bootstrap, verification pending) stashes
  /// the destination for the next authenticated landing.
  void handleUri(Uri uri) {
    final location = mapDeepLinkToLocation(uri);
    if (location == null) return;

    final ready = _isAuthenticated?.call() ?? false;
    if (!ready) {
      _pendingLocation = location;
      debugPrint('[DeepLink] stashed pending destination: $location');
      return;
    }
    _go(location);
  }

  /// Routes an FCM data payload (notification tap). Prefers the payload's
  /// `deep_link`; falls back to synthesising one from `resource_type` +
  /// `resource_id` using the same host vocabulary the worker catalogue emits.
  void handleNotificationData(Map<String, dynamic> data) {
    final rawLink = data['deep_link'] as String?;
    if (rawLink != null && rawLink.isNotEmpty) {
      final uri = Uri.tryParse(rawLink);
      if (uri != null) {
        handleUri(uri);
        return;
      }
    }
    final resourceType = data['resource_type'] as String?;
    final resourceId = data['resource_id'] as String?;
    if (resourceType == null || resourceId == null) return;
    final synthesized = deepLinkForResource(resourceType, resourceId);
    if (synthesized == null) return;
    handleUri(Uri.parse(synthesized));
  }

  /// Routes a local-notification tap payload. Handles both a direct
  /// `smartcura://` URI and a JSON-encoded FCM data map (the payload format
  /// used by [_showForegroundNotification] and the background handler).
  void openDeepLink(String? payload) {
    if (payload == null || payload.isEmpty) return;
    // Try as a direct smartcura:// URI.
    final uri = Uri.tryParse(payload);
    if (uri != null && uri.scheme == 'smartcura') {
      handleUri(uri);
      return;
    }
    // Fall back: JSON-encoded FCM data map (legacy payload format).
    try {
      final decoded = jsonDecode(payload);
      if (decoded is Map<String, dynamic>) {
        handleNotificationData(decoded);
      }
    } catch (_) {
      // Not a URI or JSON — drop silently.
    }
  }

  /// The stashed destination, without clearing it. Lets the router redirect
  /// decide whether the pending destination wins before committing to it.
  String? peekPendingLocation() => _pendingLocation;

  /// Returns and clears the stashed destination. Called by the post-login
  /// `/dashboard` landings (router redirect + splash) so a deep link that
  /// arrived before login is preferred over the dashboard exactly once.
  String? consumePendingLocation() {
    final pending = _pendingLocation;
    _pendingLocation = null;
    return pending;
  }

  void _go(String location) {
    final router = _resolveRouter?.call();
    if (router == null) {
      _pendingLocation = location;
      return;
    }
    router.go(location);
  }

  void dispose() {
    _linkSub?.cancel();
    _linkSub = null;
    _appLinks = null;
    _initialized = false;
  }
}

/// Maps a `smartcura://` URI to an in-app route location, or null when the URI
/// is not a deep link this app handles.
///
/// Host vocabulary (mirrors the worker's `deepLinkForResource` catalogue):
///   smartcura://appointments/{id}    -> /appointment-details?id={id}
///   smartcura://patients/{id}        -> /patient-details?id={id}
///   smartcura://conversations/{id}   -> /chat-consultation?id={id}
///   smartcura://notifications        -> /notifications
///   anything else (or a bad id)      -> /notifications
///
/// The id is validated as UUID-shaped before interpolation — an unvalidated
/// id could smuggle path segments or query parameters into the route.
String? mapDeepLinkToLocation(Uri uri) {
  if (uri.scheme != 'smartcura') return null;

  final host = uri.host;
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();

  switch (host) {
    case 'notifications':
      return '/notifications';
    case 'appointments':
      return _idLocation('/appointment-details', segments);
    case 'patients':
      return _idLocation('/patient-details', segments);
    case 'conversations':
      return _idLocation('/chat-consultation', segments);
    case 'consultations':
      // No consultation-summary route yet; land on the notification centre.
      return '/notifications';
    default:
      // Unknown host (prescriptions, pharmacy-orders, dispatch orders, …)
      // has no dedicated screen in the doctor app — land on the inbox, where
      // the notification row itself carries the context.
      return '/notifications';
  }
}

String _idLocation(String base, List<String> segments) {
  if (segments.length != 1 ||
      !DeepLinkHandler._uuidLike.hasMatch(segments.first)) {
    return '/notifications';
  }
  return '$base?id=${segments.first}';
}

/// Synthesises a `smartcura://` deep link from an FCM payload's
/// `resource_type` + `resource_id`, using the same host vocabulary the worker
/// emits. Returns null when the resource type has no link. Hosts without a
/// doctor-app screen are still produced — [mapDeepLinkToLocation] folds them
/// onto `/notifications`, keeping this catalogue identical to the server's.
String? deepLinkForResource(String resourceType, String resourceId) {
  if (!DeepLinkHandler._uuidLike.hasMatch(resourceId)) return null;
  switch (resourceType) {
    case 'prescription':
      return 'smartcura://prescriptions/$resourceId';
    case 'pharmacy_order':
      return 'smartcura://pharmacy-orders/$resourceId';
    case 'appointment':
      return 'smartcura://appointments/$resourceId';
    case 'conversation':
      return 'smartcura://conversations/$resourceId';
    case 'dispatch_assignment':
      return 'smartcura://orders/$resourceId';
    case 'consultation':
      return 'smartcura://consultations/$resourceId';
    case 'broadcast':
      return 'smartcura://notifications';
    default:
      return null;
  }
}

/// Provides the app-wide [DeepLinkHandler] singleton. Returns
/// [DeepLinkHandler.instance] so that `main.dart`'s notification tap callback
/// and the Riverpod-dependent code share the same handler.
final deepLinkHandlerProvider = Provider<DeepLinkHandler>((ref) {
  ref.onDispose(DeepLinkHandler.instance.dispose);
  return DeepLinkHandler.instance;
});
