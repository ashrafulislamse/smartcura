import 'dart:async';

import 'package:app_links/app_links.dart';
import 'package:flutter/foundation.dart';
import 'package:go_router/go_router.dart';

/// Maps `smartcura://` deep links to go-router locations and navigates.
///
/// Host table (mirrors the server's `deepLinkForResource` catalogue):
///   prescriptions/{id}     → /prescriptions/{id}
///   pharmacy-orders/{id}   → /pharmacy-orders/{id}
///   appointments/{id}      → /appointment-details?id={id}
///   conversations/{id}     → /doctor-chat?id={id}
///   notifications          → /notifications
///   enter-vitals           → /health/enter-vitals
///   sync-vitals            → /health/enter-vitals
///   health/enter-vitals    → /health/enter-vitals
///   health                 → /health
///   emergency-sos          → /emergency-sos
///   anything else          → /notifications
///
/// An id that is not a UUID is never interpolated into a route — a malformed
/// deep link lands on the notification centre instead of a broken detail page.
///
/// Auth constraint: every mapped route sits behind the router's auth
/// redirect, so navigating while unauthenticated would silently discard the
/// destination. When the link arrives before a session exists the location is
/// parked in [pendingLocation] and the router redirect spends it exactly once
/// when it decides the post-login bootstrap route (see `_bootstrapRoute` in
/// `app_router.dart`).
class DeepLinkHandler {
  DeepLinkHandler._();

  static final DeepLinkHandler instance = DeepLinkHandler._();

  static const String scheme = 'smartcura';

  /// Canonical UUID shape (uuidv4 and uuidv7 both fit). Case-insensitive.
  static final RegExp _uuidPattern = RegExp(
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}'
    r'-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$',
  );

  static String? _pendingLocation;

  AppLinks? _appLinks;
  StreamSubscription<Uri>? _linkSub;
  GoRouter? _router;
  bool Function()? _isAuthenticated;

  /// Location parked while the user was unauthenticated; consumed by the
  /// router's post-login bootstrap decision.
  static String? get pendingLocation => _pendingLocation;

  /// Returns and clears the pending location in one step so it is spent once.
  static String? consumePendingLocation() {
    final location = _pendingLocation;
    _pendingLocation = null;
    return location;
  }

  /// Maps a `smartcura://` URI to a go-router location. Always returns a
  /// valid location — malformed input falls back to `/notifications`.
  static String locationForUri(Uri uri) {
    if (uri.scheme != scheme) {
      return '/notifications';
    }
    final id = uri.pathSegments.isNotEmpty ? uri.pathSegments.first : '';
    switch (uri.host) {
      case 'prescriptions':
        return _isUuid(id) ? '/prescriptions/$id' : '/notifications';
      case 'pharmacy-orders':
        return _isUuid(id) ? '/pharmacy-orders/$id' : '/notifications';
      case 'appointments':
        // The route has no :id path segment — the screen reads ?id=.
        return _isUuid(id) ? '/appointment-details?id=$id' : '/notifications';
      case 'conversations':
        return _isUuid(id) ? '/doctor-chat?id=$id' : '/notifications';
      case 'consultations':
        // No consultation-summary route yet; land on the notification centre.
        return '/notifications';
      case 'notifications':
        return '/notifications';
      case 'enter-vitals':
      case 'sync-vitals':
        return '/health/enter-vitals';
      case 'health':
        final sub = uri.pathSegments.isNotEmpty ? uri.pathSegments.first : '';
        return sub == 'enter-vitals' ? '/health/enter-vitals' : '/health';
      case 'emergency-sos':
        return '/emergency-sos';
      default:
        return '/notifications';
    }
  }

  /// Maps an FCM/notification `resource_type` + `resource_id` pair to a
  /// location, mirroring the server's `deepLinkForResource`. This is the
  /// fallback when a payload carries no explicit `deep_link` and the mapper
  /// used by in-app notification taps.
  static String locationForResource(String? resourceType, String? resourceId) {
    final id = resourceId ?? '';
    if (!_isUuid(id)) {
      return '/notifications';
    }
    switch (resourceType) {
      case 'prescription':
        return '/prescriptions/$id';
      case 'pharmacy_order':
        return '/pharmacy-orders/$id';
      case 'appointment':
        return '/appointment-details?id=$id';
      case 'conversation':
        return '/doctor-chat?id=$id';
      case 'consultation':
        // No consultation-summary route yet; land on the notification centre.
        return '/notifications';
      case 'vital_reading':
      case 'health_alert':
        return '/health';
      default:
        return '/notifications';
    }
  }

  /// Binds the router and auth probe, then starts both cold-start and stream
  /// handling. Safe to call on every rebuild of the app widget — the stream
  /// subscription is created once and the router reference is refreshed.
  void bind({
    required GoRouter router,
    required bool Function() isAuthenticated,
  }) {
    _router = router;
    _isAuthenticated = isAuthenticated;
    unawaited(openInitialLink(router));
    listen(router);
  }

  /// Cold start: consumes the link that launched the app (if any). Must run
  /// before the first frame settles so the pending location exists when the
  /// splash/bootstrap redirect evaluates.
  Future<void> openInitialLink(GoRouter router) async {
    _appLinks ??= AppLinks();
    try {
      final initial = await _appLinks!.getInitialLink();
      if (initial != null) {
        _dispatch(initial);
      }
    } on Object catch (e) {
      debugPrint('[DeepLink] initial link read failed: $e');
    }
  }

  /// Warm start: consumes link events while the app is running.
  void listen(GoRouter router) {
    _appLinks ??= AppLinks();
    _linkSub ??= _appLinks!.uriLinkStream.listen(
      _dispatch,
      onError: (Object e) => debugPrint('[DeepLink] stream error: $e'),
    );
  }

  /// Cancels the link stream. The handler lives for the process lifetime, so
  /// this only exists for tests.
  void dispose() {
    _linkSub?.cancel();
    _linkSub = null;
    _router = null;
    _isAuthenticated = null;
  }

  /// Routes a raw deep-link string (e.g. from a local-notification payload).
  /// Null/empty/unparseable input is ignored — never invented.
  void openDeepLink(String? link) {
    if (link == null || link.isEmpty) {
      return;
    }
    final uri = Uri.tryParse(link);
    if (uri == null) {
      return;
    }
    _dispatch(uri);
  }

  /// Routes from payload pieces, preferring the server-supplied `deep_link`
  /// and falling back to `resource_type` + `resource_id`.
  void openNotificationPayload({
    String? deepLink,
    String? resourceType,
    String? resourceId,
  }) {
    if (deepLink != null && deepLink.isNotEmpty) {
      openDeepLink(deepLink);
      return;
    }
    _dispatchLocation(locationForResource(resourceType, resourceId));
  }

  void _dispatch(Uri uri) => _dispatchLocation(locationForUri(uri));

  void _dispatchLocation(String location) {
    final authenticated = _isAuthenticated?.call() ?? false;
    if (!authenticated) {
      // The router redirect would bounce an unauthenticated go() to /login
      // and lose the destination, so park it for the post-login bootstrap.
      _pendingLocation = location;
      return;
    }
    _router?.go(location);
  }

  static bool _isUuid(String value) => _uuidPattern.hasMatch(value);
}
