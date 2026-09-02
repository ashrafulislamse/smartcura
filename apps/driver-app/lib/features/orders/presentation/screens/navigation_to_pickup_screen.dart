import 'dart:async';

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Navigation-to-pickup screen.
///
/// Shows a live [GoogleMap] with the driver's current GPS position (streamed
/// via [Geolocator.getPositionStream]), the pickup destination marker and a
/// dashed bearing line from
/// [dispatchAssignmentStopsProvider], overlaid with real pickup/delivery info
/// from [dispatchAssignmentRecipientProvider]. While navigating, the driver's
/// position is reported to `POST /dispatch/assignments/{id}/waypoints`
/// (client-throttled; the server additionally throttles to one ordinary point
/// every 15 seconds). The "Arrived at Pickup" button advances the assignment
/// to `arrived_pickup` and navigates to the pickup confirmation screen. The
/// "Navigate" button hands off to the external Google Maps app for
/// turn-by-turn directions.
///
/// The bearing line is straight, not a routed path: no directions provider is
/// integrated, so the polyline only communicates direction and distance to the
/// destination. Real turn-by-turn stays on the external Navigate hand-off.
class NavigationToPickupScreen extends ConsumerStatefulWidget {
  final String orderId;

  const NavigationToPickupScreen({super.key, required this.orderId});

  @override
  ConsumerState<NavigationToPickupScreen> createState() =>
      _NavigationToPickupScreenState();
}

class _NavigationToPickupScreenState
    extends ConsumerState<NavigationToPickupScreen> {
  String get _assignmentId => widget.orderId;

  // ---- Map / location state ------------------------------------------------

  GoogleMapController? _mapController;
  Position? _currentPosition;
  StreamSubscription<Position>? _positionStream;
  bool _acquiringLocation = true;
  bool _locationDenied = false;
  String? _locationMessage;

  // ---- Live tracking (waypoint reporting) state ----------------------------

  DateTime? _lastWaypointAt;
  Position? _lastWaypointPosition;

  /// Minimum metres between reported ordinary points. Below this the position
  /// carries no new route information, so posting it only burns battery and
  /// server throttle budget.
  static const double _waypointMinDistanceMetres = 50;

  /// A point at least this far from the previous one is `significant`, which
  /// the server always keeps because route audit depends on large deviations.
  static const double _waypointSignificantMetres = 200;

  /// The pickup stop's coordinates from [dispatchAssignmentStopsProvider],
  /// or null while the stops disclosure is loading, 404 (no active
  /// assignment), or carrying unparsable coordinates.
  LatLng? get _destinationLatLng => _stopLatLng('pickup');

  /// Resolves one stop's coordinates from the stops disclosure. The strings
  /// are decimal degrees; a malformed pair yields null so the map falls back
  /// to the driver-only view rather than rendering a wrong point.
  LatLng? _stopLatLng(String kind) {
    final stops = ref
        .read(dispatchAssignmentStopsProvider(_assignmentId))
        .valueOrNull;
    if (stops == null) return null;
    for (final stop in stops.stops) {
      if (stop.kind != kind) continue;
      final lat = double.tryParse(stop.latitude);
      final lng = double.tryParse(stop.longitude);
      if (lat != null && lng != null) return LatLng(lat, lng);
    }
    return null;
  }

  /// Kuala Lumpur — a sensible default camera target before the first GPS fix.
  static const LatLng _defaultCamera = LatLng(3.1390, 101.6869);

  @override
  void initState() {
    super.initState();
    _initLocationTracking();
  }

  @override
  void dispose() {
    _positionStream?.cancel();
    _mapController?.dispose();
    super.dispose();
  }

  Future<void> _initLocationTracking() async {
    // 1. Location services must be enabled on the device.
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) {
      if (!mounted) return;
      setState(() {
        _acquiringLocation = false;
        _locationDenied = true;
        _locationMessage =
            'Location services are disabled. Enable GPS to show your '
            'position on the map.';
      });
      return;
    }

    // 2. Request permission, prompting the user once if not yet decided.
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.denied) {
      if (!mounted) return;
      setState(() {
        _acquiringLocation = false;
        _locationDenied = true;
        _locationMessage =
            'Location permission was denied. Grant access to track your '
            'position on the map.';
      });
      return;
    }
    if (permission == LocationPermission.deniedForever) {
      if (!mounted) return;
      setState(() {
        _acquiringLocation = false;
        _locationDenied = true;
        _locationMessage =
            'Location permission is permanently denied. Enable it in your '
            'device settings to use navigation.';
      });
      return;
    }

    // 3. Seed with the last known position so the map has a target promptly.
    try {
      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
      );
      if (!mounted) return;
      setState(() {
        _currentPosition = position;
        _acquiringLocation = false;
      });
      _fitCamera();
      _maybeRecordWaypoint(position);
    } catch (_) {
      if (!mounted) return;
      setState(() => _acquiringLocation = false);
    }

    // 4. Stream updates so the driver marker moves in real time.
    _positionStream = Geolocator.getPositionStream(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 10,
      ),
    ).listen((position) {
      if (!mounted) return;
      setState(() {
        _currentPosition = position;
        _acquiringLocation = false;
      });
      _fitCamera();
      _maybeRecordWaypoint(position);
    });
  }

  /// Reports the position to the waypoints endpoint, client-throttled.
  ///
  /// A point is sent when it is the first of the trip or moves at least
  /// [_waypointMinDistanceMetres] and the last send was >= 15 s ago (matching
  /// the server's ordinary-point throttle). Large deviations
  /// (>= [_waypointSignificantMetres]) are flagged `significant`, which the
  /// server always stores. Failures are swallowed by the notifier: telemetry
  /// must never interrupt navigation.
  void _maybeRecordWaypoint(Position position) {
    final last = _lastWaypointPosition;
    final lastAt = _lastWaypointAt;
    final moved = last == null
        ? double.infinity
        : Geolocator.distanceBetween(
            last.latitude, last.longitude, position.latitude, position.longitude);
    final elapsedSeconds = lastAt == null
        ? double.infinity
        : DateTime.now().difference(lastAt).inSeconds;
    final significant = moved >= _waypointSignificantMetres;
    if (!(last == null || significant || (elapsedSeconds >= 15 && moved >= _waypointMinDistanceMetres))) {
      return;
    }
    _lastWaypointPosition = position;
    _lastWaypointAt = DateTime.now();
    ref.read(recordWaypointNotifier.notifier).call(
          assignmentId: _assignmentId,
          latitude: position.latitude,
          longitude: position.longitude,
          accuracyMetres: position.accuracy.isFinite ? position.accuracy : null,
          significant: significant,
        );
  }

  void _onMapCreated(GoogleMapController controller) {
    _mapController = controller;
    _fitCamera();
  }

  /// Frames the camera around the driver, or around both the driver and the
  /// destination when destination coordinates are available.
  void _fitCamera() {
    final controller = _mapController;
    final pos = _currentPosition;
    if (controller == null || pos == null) return;

    final dest = _destinationLatLng;
    if (dest != null) {
      final bounds = LatLngBounds(
        southwest: LatLng(
          math.min(pos.latitude, dest.latitude),
          math.min(pos.longitude, dest.longitude),
        ),
        northeast: LatLng(
          math.max(pos.latitude, dest.latitude),
          math.max(pos.longitude, dest.longitude),
        ),
      );
      controller
          .animateCamera(CameraUpdate.newLatLngBounds(bounds, 80));
    } else {
      controller.animateCamera(
        CameraUpdate.newLatLngZoom(LatLng(pos.latitude, pos.longitude), 15),
      );
    }
  }

  Set<Marker> _buildMarkers() {
    final markers = <Marker>{};
    final pos = _currentPosition;
    if (pos != null) {
      markers.add(
        Marker(
          markerId: const MarkerId('driver'),
          position: LatLng(pos.latitude, pos.longitude),
          infoWindow: const InfoWindow(title: 'Your location'),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
        ),
      );
    }
    final dest = _destinationLatLng;
    if (dest != null) {
      markers.add(
        Marker(
          markerId: const MarkerId('pickup'),
          position: dest,
          infoWindow: const InfoWindow(title: 'Pickup location'),
          icon: BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed),
        ),
      );
    }
    return markers;
  }

  Set<Polyline> _buildPolylines() {
    final pos = _currentPosition;
    final dest = _destinationLatLng;
    if (pos == null || dest == null) return const {};
    return {
      Polyline(
        polylineId: const PolylineId('bearing'),
        points: [LatLng(pos.latitude, pos.longitude), dest],
        color: AppColors.primary,
        width: 4,
        // Dashed so the line reads as a bearing, not a routed path — no
        // directions provider is integrated.
        patterns: [PatternItem.dash(20), PatternItem.gap(12)],
      ),
    };
  }

  @override
  Widget build(BuildContext context) {
    final assignment = ref.watch(dispatchAssignmentProvider(_assignmentId));
    final recipient =
        ref.watch(dispatchAssignmentRecipientProvider(_assignmentId));
    // Watching the stops disclosure rebuilds markers/polylines the moment
    // destination coordinates arrive.
    ref.watch(dispatchAssignmentStopsProvider(_assignmentId));

    return Scaffold(
      body: Stack(
        children: [
          _mapWidget(context),
          _topBar(context, recipient),
          _bottomSheet(context, assignment, recipient),
        ],
      ),
    );
  }

  // ---- Map ------------------------------------------------------------------

  Widget _mapWidget(BuildContext context) {
    if (_locationDenied) {
      return Container(
        width: double.infinity,
        height: double.infinity,
        color: const Color(0xFFE8F0F7),
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(DesignTokens.spaceLg),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.location_off_rounded,
                    size: 48, color: AppColors.textSecondary),
                const SizedBox(height: DesignTokens.spaceMd),
                Text(
                  _locationMessage ?? 'Location unavailable.',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 14,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceMd),
                TextButton.icon(
                  onPressed: () {
                    setState(() {
                      _acquiringLocation = true;
                      _locationDenied = false;
                      _locationMessage = null;
                    });
                    _initLocationTracking();
                  },
                  icon: const Icon(Icons.refresh_rounded, size: 18),
                  label: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final pos = _currentPosition;
    final initialCamera = CameraPosition(
      target: pos != null ? LatLng(pos.latitude, pos.longitude) : _defaultCamera,
      zoom: 15,
    );

    return Stack(
      children: [
        GoogleMap(
          initialCameraPosition: initialCamera,
          onMapCreated: _onMapCreated,
          markers: _buildMarkers(),
          polylines: _buildPolylines(),
          myLocationEnabled: true,
          myLocationButtonEnabled: true,
          zoomControlsEnabled: true,
          compassEnabled: true,
          mapToolbarEnabled: false,
        ),
        if (_acquiringLocation && pos == null) _acquiringOverlay(context),
      ],
    );
  }

  Widget _acquiringOverlay(BuildContext context) {
    return Container(
      width: double.infinity,
      height: double.infinity,
      color: Colors.white.withValues(alpha: 0.6),
      child: const Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(
                strokeWidth: 2.5,
                color: AppColors.primary,
              ),
            ),
            SizedBox(height: DesignTokens.spaceSm),
            Text(
              'Acquiring your location\u2026',
              style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
            ),
          ],
        ),
      ),
    );
  }

  // ---- Top bar -------------------------------------------------------------

  Widget _topBar(
      BuildContext context, AsyncValue<RecipientDisclosure> recipient) {
    final addressLine = recipient.maybeWhen(
      data: (r) => _formatAddress(r),
      orElse: () => 'Loading destination\u2026',
    );

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd, vertical: DesignTokens.spaceSm),
        child: Row(
          children: [
            GestureDetector(
              onTap: () => context.pop(),
              child: Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.1),
                      blurRadius: 8,
                    ),
                  ],
                ),
                child: const Icon(Icons.arrow_back_ios_new_rounded,
                    size: 18, color: AppColors.textPrimary),
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm + 4),
            Expanded(
              child: Container(
                padding: const EdgeInsets.symmetric(
                    horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.1),
                      blurRadius: 8,
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    const Icon(Icons.navigation_rounded,
                        color: AppColors.primary, size: 18),
                    const SizedBox(width: DesignTokens.spaceSm),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Text(
                            'Heading to Pickup',
                            style: TextStyle(
                              fontSize: 11,
                              color: AppColors.textSecondary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                          Text(
                            addressLine,
                            style: const TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---- Bottom sheet --------------------------------------------------------

  Widget _bottomSheet(
    BuildContext context,
    AsyncValue<DispatchAssignmentSummary> assignment,
    AsyncValue<RecipientDisclosure> recipient,
  ) {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: Container(
        padding: const EdgeInsets.fromLTRB(
            DesignTokens.spaceLg, DesignTokens.spaceLg, DesignTokens.spaceLg, 36),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 36,
              height: 4,
              margin: const EdgeInsets.only(bottom: DesignTokens.spaceLg),
              decoration: BoxDecoration(
                color: AppColors.gray200,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            // Destination info from recipient disclosure
            _destinationInfo(recipient),
            const SizedBox(height: DesignTokens.spaceMd),
            // Navigate hand-off to external Google Maps
            _navigateButton(recipient),
            const SizedBox(height: DesignTokens.spaceMd),
            // Arrived button
            _arrivedButton(assignment),
          ],
        ),
      ),
    );
  }

  Widget _destinationInfo(AsyncValue<RecipientDisclosure> recipient) {
    return recipient.when(
      loading: () => const Padding(
        padding: EdgeInsets.all(DesignTokens.spaceMd),
        child: Center(
          child: SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(
                strokeWidth: 2, color: AppColors.primary),
          ),
        ),
      ),
      error: (e, _) => const Padding(
        padding: EdgeInsets.all(DesignTokens.spaceMd),
        child: Text(
          'Unable to load destination details.',
          style: TextStyle(fontSize: 13, color: AppColors.error),
        ),
      ),
      data: (r) => Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: AppColors.primary.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          border: Border.all(
              color: AppColors.primary.withValues(alpha: 0.15)),
        ),
        child: Row(
          children: [
            const Icon(Icons.store_rounded,
                color: AppColors.primary, size: 20),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Pickup Destination',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    _formatAddress(r),
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _navigateButton(AsyncValue<RecipientDisclosure> recipient) {
    final dest = recipient.valueOrNull;
    final address = dest != null ? _formatAddress(dest) : '';
    final enabled = address.isNotEmpty;

    return SizedBox(
      width: double.infinity,
      height: DesignTokens.buttonHeightLg,
      child: OutlinedButton.icon(
        onPressed: enabled ? () => _launchNavigation(address) : null,
        icon: const Icon(Icons.directions_rounded, size: 20),
        label: const Text('Navigate',
            style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.primary)),
        style: OutlinedButton.styleFrom(
          side: BorderSide(color: AppColors.primary.withValues(alpha: 0.5)),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          ),
        ),
      ),
    );
  }

  Future<void> _launchNavigation(String destinationAddress) async {
    // The Google Maps directions URL accepts an address string as the
    // destination, so no coordinates are required. The backend withholds
    // precise destination coordinates by privacy design.
    final encoded = Uri.encodeQueryComponent(destinationAddress);
    final url = Uri.parse(
      'https://www.google.com/maps/dir/?api=1'
      '&destination=$encoded'
      '&travelmode=driving',
    );
    if (await canLaunchUrl(url)) {
      await launchUrl(url, mode: LaunchMode.externalApplication);
    } else if (mounted) {
      AppSnackbar.error(context, 'Could not open Google Maps.');
    }
  }

  Widget _arrivedButton(AsyncValue<DispatchAssignmentSummary> assignment) {
    final loading = ref.watch(advanceAssignmentNotifier).loading;
    final version = assignment.value?.version ?? 0;

    return SizedBox(
      width: double.infinity,
      height: DesignTokens.buttonHeightLg,
      child: ElevatedButton.icon(
        onPressed: loading ? null : () => _arrivedAtPickup(version),
        icon: const Icon(Icons.check_circle_rounded, size: 20),
        label: loading
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                    strokeWidth: 2, color: Colors.white),
              )
            : const Text('I Have Arrived at Pickup',
                style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: Colors.white)),
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.secondary,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          ),
        ),
      ),
    );
  }

  // ---- State transitions ---------------------------------------------------

  Future<void> _arrivedAtPickup(int expectedVersion) async {
    final notifier = ref.read(advanceAssignmentNotifier.notifier);
    final ok = await notifier.call(
      assignmentId: _assignmentId,
      status: 'arrived_pickup',
      expectedVersion: expectedVersion,
    );
    if (!mounted) return;
    if (ok) {
      ref.invalidate(dispatchAssignmentProvider(_assignmentId));
      context.pushReplacement('/pickup-confirm?id=$_assignmentId');
    } else {
      final err = ref.read(advanceAssignmentNotifier).error;
      _handleError(err);
    }
  }

  void _handleError(ApiError? error) {
    if (error == null) {
      AppSnackbar.error(context, 'Something went wrong');
      return;
    }
    if (error.isConflict) {
      AppSnackbar.warning(context, 'Assignment was updated. Refreshing...');
      ref.invalidate(dispatchAssignmentProvider(_assignmentId));
    } else {
      AppSnackbar.error(context, error.displayMessage);
    }
  }

  // ---- Helpers -------------------------------------------------------------

  String _formatAddress(RecipientDisclosure r) {
    final parts = <String>[
      r.addressLine1,
      if (r.addressLine2 != null && r.addressLine2!.isNotEmpty)
        r.addressLine2!,
      '${r.postcode} ${r.city}',
      r.stateCode,
    ].where((s) => s.isNotEmpty).join(', ');
    return parts;
  }
}
