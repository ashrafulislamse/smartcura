import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/emergency_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/loading_overlay.dart';

enum _LocationStatus {
  unknown,
  checking,
  granted,
  denied,
  unavailable,
}

/// Emergency SOS Screen
///
/// Two-phase lifecycle:
///  1. **Pre-trigger**: the pulsing red button invites the user to send an SOS.
///     Tapping it starts a 3-second cancelable countdown, then calls
///     [RaiseEmergencyNotifier.raise] (POST /emergencies) with
///     GPS coordinates from [geolocator] when available.
///  2. **Active**: once an [EmergencyEventCreated] is returned, the screen polls
///     GET /emergencies/{id} every 3 seconds via [emergencyEventProvider] until
///     the status reaches a terminal state (resolved, cancelled, false_alarm).
///
/// "Call 999" uses [url_launcher] with the `tel:` scheme. The countdown timer
/// tracks elapsed time since the SOS was raised.
class EmergencySOSScreen extends ConsumerStatefulWidget {
  const EmergencySOSScreen({super.key});

  @override
  ConsumerState<EmergencySOSScreen> createState() => _EmergencySOSScreenState();
}

class _EmergencySOSScreenState extends ConsumerState<EmergencySOSScreen>
    with TickerProviderStateMixin {
  // --- Animations ----------------------------------------------------------
  late AnimationController _pulseController;
  late AnimationController _pingController;
  late Animation<double> _pulseAnimation;
  late Animation<double> _pingAnimation;

  // --- Timer ---------------------------------------------------------------
  Timer? _timer;
  int _elapsedSeconds = 0;

  // --- Polling -------------------------------------------------------------
  Timer? _pollTimer;
  String? _activeEventId;

  // --- Countdown -----------------------------------------------------------
  int _countdownSeconds = 0;
  Timer? _countdownTimer;

  // --- Location ------------------------------------------------------------
  bool _isFetchingLocation = false;
  _LocationStatus _locationStatus = _LocationStatus.unknown;
  ({String lat, String lng})? _capturedLocation;

  /// True after the emergency event has reached a terminal state.
  bool get _isTerminal {
    final event = _currentEvent;
    if (event == null) return false;
    return event.status == EmergencyEventStatus.resolved ||
        event.status == EmergencyEventStatus.cancelled ||
        event.status == EmergencyEventStatus.falseAlarm;
  }

  EmergencyEventView? get _currentEvent {
    if (_activeEventId == null) return null;
    final asyncEvent = ref.read(emergencyEventProvider(_activeEventId!));
    return asyncEvent.maybeWhen(data: (e) => e, orElse: () => null);
  }

  @override
  void initState() {
    super.initState();

    _pulseController = AnimationController(
      duration: const Duration(seconds: 3),
      vsync: this,
    )..repeat();

    _pulseAnimation = Tween<double>(begin: 0.8, end: 1.2).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    _pingController = AnimationController(
      duration: const Duration(seconds: 2),
      vsync: this,
    )..repeat();

    _pingAnimation = Tween<double>(begin: 1.0, end: 1.5).animate(
      CurvedAnimation(parent: _pingController, curve: Curves.easeOut),
    );

    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersive);

    // Acquire location permission as early as possible so coordinates are ready
    // before the user taps SOS. This is best-effort: the SOS still works if the
    // user denies location.
    unawaited(_preCheckLocation());
  }

  @override
  void dispose() {
    _pulseController.dispose();
    _pingController.dispose();
    _timer?.cancel();
    _pollTimer?.cancel();
    _countdownTimer?.cancel();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  // --- Actions -------------------------------------------------------------

  void _startTimer() {
    _timer?.cancel();
    _elapsedSeconds = 0;
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _elapsedSeconds++);
    });
  }

  void _startPolling(String eventId) {
    _activeEventId = eventId;
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (_) {
      if (!mounted || _isTerminal) {
        _pollTimer?.cancel();
        return;
      }
      ref.invalidate(emergencyEventProvider(eventId));
    });
  }

  /// Best-effort location pre-fetch. Called on screen load and again during the
  /// countdown so coordinates are ready before the API call. Never blocks the SOS.
  Future<void> _preCheckLocation() async {
    if (!mounted) return;
    setState(() {
      _locationStatus = _LocationStatus.checking;
      _isFetchingLocation = true;
    });
    try {
      final serviceEnabled = await Geolocator.isLocationServiceEnabled();
      if (!serviceEnabled) {
        if (mounted) {
          setState(() {
            _locationStatus = _LocationStatus.unavailable;
            _isFetchingLocation = false;
          });
        }
        return;
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        if (mounted) {
          setState(() {
            _locationStatus = _LocationStatus.denied;
            _isFetchingLocation = false;
          });
        }
        return;
      }

      final position = await Geolocator.getCurrentPosition(
        desiredAccuracy: LocationAccuracy.high,
        timeLimit: const Duration(seconds: 5),
      );
      if (!mounted) return;
      setState(() {
        _capturedLocation = (
          lat: position.latitude.toString(),
          lng: position.longitude.toString(),
        );
        _locationStatus = _LocationStatus.granted;
        _isFetchingLocation = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _locationStatus = _LocationStatus.unavailable;
        _isFetchingLocation = false;
      });
    }
  }

  void _startCountdown() {
    HapticFeedback.heavyImpact();
    setState(() => _countdownSeconds = 3);
    _countdownTimer?.cancel();
    _countdownTimer = Timer.periodic(const Duration(seconds: 1), (timer) async {
      if (!mounted) {
        timer.cancel();
        return;
      }
      final next = _countdownSeconds - 1;
      if (next <= 0) {
        timer.cancel();
        setState(() => _countdownSeconds = 0);
        await _preCheckLocation();
        await _raiseSOS();
        return;
      }
      setState(() => _countdownSeconds = next);
    });
  }

  void _cancelCountdown() {
    HapticFeedback.lightImpact();
    _countdownTimer?.cancel();
    if (mounted) setState(() => _countdownSeconds = 0);
  }

  Future<void> _raiseSOS() async {
    if (!mounted) return;

    final created = await ref.read(raiseEmergencyProvider.notifier).raise(
          categoryCode: 'general_medical',
          latitude: _capturedLocation?.lat,
          longitude: _capturedLocation?.lng,
        );

    if (created != null && mounted) {
      _startTimer();
      _startPolling(created.emergencyEventId);
      setState(() {});
    }
  }

  Future<void> _callEmergencyNumber() async {
    HapticFeedback.heavyImpact();
    final uri = Uri.parse('tel:999');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    } else if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Could not open the phone dialer.'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  Future<void> _endEmergency() async {
    HapticFeedback.mediumImpact();
    final event = _currentEvent;
    if (event == null) return;

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.white,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: const BoxDecoration(
                color: AppColors.successContainer,
                shape: BoxShape.circle,
              ),
              child: const Icon(Icons.check_circle,
                  color: AppColors.success, size: 28),
            ),
            const SizedBox(width: 12),
            const Text('End Emergency?',
                style: TextStyle(
                    fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
          ],
        ),
        content: const Text(
          'Confirm you are safe. Your emergency contacts will be notified that the emergency has ended.',
          style: TextStyle(color: AppColors.textPrimary, fontSize: 15),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.success,
              foregroundColor: AppColors.white,
              padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
            ),
            child: const Text("Yes, I'm Safe",
                style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    await ref.read(emergencyMutationProvider.notifier).resolve(
          eventId: event.emergencyEventId,
          resolutionType: 'cancelled_by_requester',
          notes: 'Patient confirmed they are safe.',
          expectedVersion: event.version,
        );

    _pollTimer?.cancel();
    _timer?.cancel();

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Row(
            children: [
              Icon(Icons.check_circle, color: AppColors.white),
              SizedBox(width: 12),
              Text('Emergency ended. Contacts notified you are safe.'),
            ],
          ),
          backgroundColor: AppColors.success,
          duration: Duration(seconds: 3),
        ),
      );
      context.pop();
    }
  }

  // --- Build ---------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final raiseState = ref.watch(raiseEmergencyProvider);

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
            colors: [
              AppColors.error,
              AppColors.errorDark,
              AppColors.gray900,
            ],
          ),
        ),
        child: SafeArea(
          child: Stack(
            children: [
              _buildBody(raiseState),
              if (_isFetchingLocation)
                const LoadingOverlay(message: 'Acquiring GPS location…'),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildBody(AsyncValue<EmergencyEventCreated?> raiseState) {
    if (_countdownSeconds > 0) return _buildCountdown();
    return raiseState.when(
      loading: () => _buildRaising(),
      error: (err, _) => _buildErrorState(err),
      data: (created) {
        if (created == null) {
          // Pre-trigger: show the SOS button.
          return _buildPreTrigger();
        }
        // Active: show the tracking screen.
        return _buildActive(created);
      },
    );
  }

  // --- Pre-trigger (SOS button) --------------------------------------------

  Widget _buildPreTrigger() {
    return Padding(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      child: Column(
        children: [
          _buildHeader(),
          const Spacer(),
          Text(
            'Tap the button below to send an emergency alert',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppColors.white.withValues(alpha: 0.7),
              fontSize: 16,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: DesignTokens.space2xl),
          _buildSOSButton(),
          const SizedBox(height: DesignTokens.spaceMd),
          _buildLocationStatus(),
          const SizedBox(height: DesignTokens.spaceXl),
          _buildCall999Chip(),
          const Spacer(),
        ],
      ),
    );
  }

  Widget _buildLocationStatus() {
    final (icon, label) = switch (_locationStatus) {
      _LocationStatus.granted => (Icons.location_on, 'Location included'),
      _LocationStatus.denied => (
          Icons.location_off,
          'Location denied — SOS will still be sent'
        ),
      _LocationStatus.unavailable => (
          Icons.location_off,
          'Location unavailable — SOS will still be sent'
        ),
      _ => (Icons.location_searching, 'Checking location…'),
    };
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: [
        Icon(
          icon,
          color: AppColors.white.withValues(alpha: 0.7),
          size: 16,
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Text(
          label,
          style: TextStyle(
            color: AppColors.white.withValues(alpha: 0.7),
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Widget _buildCountdown() {
    return Padding(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      child: Column(
        children: [
          _buildHeader(),
          const Spacer(),
          Text(
            'SOS will be sent in',
            style: TextStyle(
              color: AppColors.white.withValues(alpha: 0.8),
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            '$_countdownSeconds',
            style: const TextStyle(
              color: AppColors.white,
              fontSize: 96,
              fontWeight: FontWeight.w900,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            'Keep calm. Tap Cancel if this was accidental.',
            textAlign: TextAlign.center,
            style: TextStyle(
              color: AppColors.white.withValues(alpha: 0.6),
              fontSize: 14,
            ),
          ),
          const Spacer(),
          _buildCancelSOSButton(),
          const SizedBox(height: DesignTokens.spaceLg),
        ],
      ),
    );
  }

  Widget _buildCancelSOSButton() {
    return Semantics(
      label: 'Cancel emergency countdown',
      button: true,
      child: GestureDetector(
        onTap: _cancelCountdown,
        child: Container(
          height: 56,
          decoration: BoxDecoration(
            color: AppColors.white.withValues(alpha: 0.2),
            borderRadius: BorderRadius.circular(30),
            border: Border.all(
              color: AppColors.white.withValues(alpha: 0.5),
              width: 2,
            ),
          ),
          child: const Center(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.close, color: AppColors.white, size: 24),
                SizedBox(width: 12),
                Text(
                  'CANCEL SOS',
                  style: TextStyle(
                    color: AppColors.white,
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    letterSpacing: 0.5,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildRaising() {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const CircularProgressIndicator(color: AppColors.white),
          const SizedBox(height: DesignTokens.spaceMd),
          const Text(
            'Raising emergency alert…',
            style: TextStyle(
              color: AppColors.white,
              fontSize: 18,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            'Please stay calm. Help is being notified.',
            style: TextStyle(
              color: AppColors.white.withValues(alpha: 0.7),
              fontSize: 14,
            ),
          ),
        ],
      ),
    );
  }

  // --- Active (tracking) ---------------------------------------------------

  Widget _buildActive(EmergencyEventCreated created) {
    final AsyncValue<EmergencyEventView> eventAsync = _activeEventId != null
        ? ref.watch(emergencyEventProvider(_activeEventId!))
        : const AsyncValue<EmergencyEventView>.loading();

    return Padding(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      child: Column(
        children: [
          _buildHeader(),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildTimer(),
          const SizedBox(height: DesignTokens.spaceLg),
          Expanded(
            child: eventAsync.when(
              loading: () => const Center(
                child: CircularProgressIndicator(color: AppColors.white),
              ),
              error: (err, _) => _buildErrorState(err),
              data: (event) => _buildStatusIndicators(event),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildCancelButton(),
          const SizedBox(height: DesignTokens.spaceMd),
        ],
      ),
    );
  }

  // --- Widgets -------------------------------------------------------------

  Widget _buildHeader() {
    return Semantics(
      label: 'Emergency mode active',
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd, vertical: 10),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.2),
          borderRadius: BorderRadius.circular(30),
          border: Border.all(color: Colors.white.withOpacity(0.1)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedBuilder(
              animation: _pulseAnimation,
              builder: (context, child) => Icon(
                Icons.warning_rounded,
                color: AppColors.white,
                size: 20 * _pulseAnimation.value,
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm),
            const Text(
              'EMERGENCY MODE ACTIVE',
              style: TextStyle(
                color: AppColors.white,
                fontSize: 11,
                fontWeight: FontWeight.w700,
                letterSpacing: 1.2,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSOSButton() {
    return Center(
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Outer ping animation
          AnimatedBuilder(
            animation: _pingAnimation,
            builder: (context, child) => Opacity(
              opacity: 1 - (_pingAnimation.value - 1),
              child: Container(
                width: 256 * _pingAnimation.value,
                height: 256 * _pingAnimation.value,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.error.withOpacity(0.2),
                ),
              ),
            ),
          ),
          // Middle pulse animation
          AnimatedBuilder(
            animation: _pulseAnimation,
            builder: (context, child) => Container(
              width: 224 * _pulseAnimation.value,
              height: 224 * _pulseAnimation.value,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.error.withOpacity(0.4),
              ),
            ),
          ),
          // Main SOS button
          Semantics(
            label: 'Send SOS emergency alert',
            button: true,
            child: GestureDetector(
              onTap: _startCountdown,
              child: Container(
                width: 192,
                height: 192,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: const LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: [AppColors.white, AppColors.gray200],
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.error.withOpacity(0.6),
                      blurRadius: 40,
                      spreadRadius: 5,
                    ),
                  ],
                  border: Border.all(
                      color: AppColors.white.withOpacity(0.5), width: 4),
                ),
                child: const Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.emergency_rounded,
                        color: AppColors.error, size: 64),
                    SizedBox(height: DesignTokens.spaceSm),
                    Text(
                      'SOS',
                      style: TextStyle(
                        color: AppColors.error,
                        fontSize: 28,
                        fontWeight: FontWeight.w900,
                        letterSpacing: 0.5,
                      ),
                    ),
                    SizedBox(height: 4),
                    Text(
                      'Tap to send',
                      style: TextStyle(
                        color: AppColors.error,
                        fontSize: 11,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCall999Chip() {
    return Semantics(
      label: 'Call 999 emergency services',
      button: true,
      child: GestureDetector(
        onTap: _callEmergencyNumber,
        child: Container(
          padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceLg, vertical: 14),
          decoration: BoxDecoration(
            color: AppColors.white.withOpacity(0.15),
            borderRadius: BorderRadius.circular(30),
            border:
                Border.all(color: AppColors.white.withOpacity(0.3), width: 2),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.phone, color: AppColors.white, size: 24),
              SizedBox(width: DesignTokens.spaceSm),
              Text(
                'CALL 999',
                style: TextStyle(
                  color: AppColors.white,
                  fontSize: 18,
                  fontWeight: FontWeight.w800,
                  letterSpacing: 0.5,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTimer() {
    final hours = (_elapsedSeconds ~/ 3600).toString().padLeft(2, '0');
    final minutes = ((_elapsedSeconds % 3600) ~/ 60).toString().padLeft(2, '0');
    final seconds = (_elapsedSeconds % 60).toString().padLeft(2, '0');

    return Semantics(
      label:
          'Emergency timer: $hours hours, $minutes minutes, $seconds seconds',
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          _buildTimeUnit(hours, 'HRS'),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: DesignTokens.spaceSm),
            child: Text(':',
                style: TextStyle(
                    color: Colors.white54,
                    fontSize: 24,
                    fontWeight: FontWeight.w700)),
          ),
          _buildTimeUnit(minutes, 'MIN'),
          const Padding(
            padding: EdgeInsets.symmetric(horizontal: DesignTokens.spaceSm),
            child: Text(':',
                style: TextStyle(
                    color: Colors.white54,
                    fontSize: 24,
                    fontWeight: FontWeight.w700)),
          ),
          _buildTimeUnit(seconds, 'SEC', isActive: true),
        ],
      ),
    );
  }

  Widget _buildTimeUnit(String value, String label, {bool isActive = false}) {
    return Column(
      children: [
        Container(
          width: 48,
          height: 48,
          decoration: BoxDecoration(
            color: isActive
                ? Colors.white.withOpacity(0.1)
                : Colors.black.withOpacity(0.2),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: isActive
                  ? Colors.white.withOpacity(0.3)
                  : Colors.white.withOpacity(0.1),
            ),
          ),
          child: Center(
            child: Text(
              value,
              style: TextStyle(
                color: isActive
                    ? AppColors.white
                    : AppColors.white.withOpacity(0.87),
                fontSize: 20,
                fontWeight: FontWeight.w700,
                fontFamily: 'monospace',
              ),
            ),
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: TextStyle(
            color: isActive
                ? AppColors.white.withOpacity(0.8)
                : AppColors.white.withOpacity(0.6),
            fontSize: 10,
            fontWeight: FontWeight.w600,
            letterSpacing: 1.5,
          ),
        ),
      ],
    );
  }

  Widget _buildStatusIndicators(EmergencyEventView event) {
    // Derive real status from the API response rather than hardcoding.
    final isCreated = event.status == EmergencyEventStatus.created;
    final isTriaged = event.status == EmergencyEventStatus.triaged ||
        event.status == EmergencyEventStatus.unitAssigned ||
        event.status == EmergencyEventStatus.dispatching;
    final isResponding = event.status == EmergencyEventStatus.responding ||
        event.status == EmergencyEventStatus.onScene ||
        event.status == EmergencyEventStatus.transporting;
    final isResolved = event.status == EmergencyEventStatus.resolved ||
        event.status == EmergencyEventStatus.cancelled ||
        event.status == EmergencyEventStatus.falseAlarm;

    return Column(
      children: [
        _buildStatusCard(
          icon: event.status == EmergencyEventStatus.created
              ? Icons.hourglass_top
              : Icons.check_circle_rounded,
          title: 'Emergency Alert Sent',
          subtitle: _statusLabel(event.status),
          color: isCreated ? AppColors.warning : AppColors.success,
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        _buildStatusCard(
          icon: isTriaged || isResponding || isResolved
              ? Icons.local_hospital_rounded
              : Icons.hourglass_empty,
          title: 'Medical Response',
          subtitle: isTriaged
              ? 'Triage assessed — priority ${event.triagePriority.name}'
              : isResponding
                  ? 'Response unit dispatched'
                  : isResolved
                      ? 'Response complete'
                      : 'Awaiting triage assessment',
          color: isTriaged || isResponding
              ? AppColors.info
              : isResolved
                  ? AppColors.success
                  : AppColors.gray400,
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        _buildStatusCard(
          icon: isCreated
              ? Icons.notifications_off_rounded
              : Icons.notifications_active_rounded,
          title: 'Contacts Notified',
          subtitle:
              isCreated ? 'Pending notification' : 'Emergency contacts alerted',
          color: isCreated ? AppColors.gray400 : AppColors.success,
        ),
      ],
    );
  }

  String _statusLabel(EmergencyEventStatus status) {
    return switch (status) {
      EmergencyEventStatus.created => 'Alert received — awaiting triage',
      EmergencyEventStatus.triaged => 'Triage complete',
      EmergencyEventStatus.dispatching => 'Dispatching response unit',
      EmergencyEventStatus.unitAssigned => 'Response unit assigned',
      EmergencyEventStatus.responding => 'Response unit en route',
      EmergencyEventStatus.onScene => 'Response unit on scene',
      EmergencyEventStatus.transporting => 'Patient being transported',
      EmergencyEventStatus.resolved => 'Emergency resolved',
      EmergencyEventStatus.cancelled => 'Emergency cancelled',
      EmergencyEventStatus.falseAlarm => 'False alarm',
      EmergencyEventStatus.unknown => 'Status unknown',
    };
  }

  Widget _buildStatusCard({
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
  }) {
    return Semantics(
      label: '$title. $subtitle',
      child: Container(
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: Colors.black.withOpacity(0.3),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.1)),
        ),
        child: Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: color.withOpacity(0.2),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      color: AppColors.white,
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  Text(
                    subtitle,
                    style: TextStyle(
                        color: AppColors.white.withOpacity(0.6), fontSize: 11),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCancelButton() {
    return Column(
      children: [
        Semantics(
          label: 'I am safe, end emergency mode',
          button: true,
          child: GestureDetector(
            onTap: _endEmergency,
            child: Container(
              height: 56,
              decoration: BoxDecoration(
                color: AppColors.success.withOpacity(0.2),
                borderRadius: BorderRadius.circular(30),
                border: Border.all(
                    color: AppColors.success.withOpacity(0.5), width: 2),
              ),
              child: Center(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.check_circle,
                        color: AppColors.success, size: 24),
                    const SizedBox(width: 12),
                    const Text(
                      'I AM SAFE - END EMERGENCY',
                      style: TextStyle(
                        color: AppColors.success,
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: 12),
        Text(
          'Tap to end emergency mode and notify contacts',
          style: TextStyle(
            color: AppColors.white.withOpacity(0.5),
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
          textAlign: TextAlign.center,
        ),
      ],
    );
  }

  Widget _buildErrorState(Object err) {
    final message = err is ApiError ? err.userMessage : err.toString();
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.error_outline,
                size: DesignTokens.icon2xl, color: AppColors.white),
            const SizedBox(height: DesignTokens.spaceMd),
            Text(
              'Failed to send SOS',
              style: Theme.of(context)
                  .textTheme
                  .titleMedium
                  ?.copyWith(color: AppColors.white),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              message,
              textAlign: TextAlign.center,
              style: TextStyle(
                  color: AppColors.white.withOpacity(0.6), fontSize: 13),
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            FilledButton.icon(
              onPressed: () {
                ref.invalidate(raiseEmergencyProvider);
              },
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.white,
                foregroundColor: AppColors.error,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            TextButton(
              onPressed: _callEmergencyNumber,
              child: const Text(
                'Call 999 directly',
                style: TextStyle(
                    color: AppColors.white,
                    decoration: TextDecoration.underline),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
