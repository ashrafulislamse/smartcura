import 'dart:async';
import 'dart:ui';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart' hide Permission;

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// Audio Consultation Screen — real LiveKit integration (audio-only).
///
/// Lifecycle:
///  1. Receives [appointmentId] + [doctorName] from the route extra.
///  2. Resolves the consultation id by listing the patient's consultations
///     (GET /profiles/me/consultations) and matching on [appointmentId].
///  3. If no consultation is found, attempts to create one via
///     POST /appointments/{appointmentId}/consultation.
///  4. Requests a room token (POST /consultations/{id}/room-token).
///  5. Creates a [Room], connects with the token, publishes the mic only.
///  6. Renders a gradient background with an animated waveform, the
///     doctor's avatar, a call timer, and audio controls.
///  7. On end call, disconnects and pops.
class AudioConsultationScreen extends ConsumerStatefulWidget {
  final String appointmentId;
  final String doctorName;
  final String specialty;

  const AudioConsultationScreen({
    super.key,
    required this.appointmentId,
    required this.doctorName,
    this.specialty = '',
  });

  @override
  ConsumerState<AudioConsultationScreen> createState() =>
      _AudioConsultationScreenState();
}

/// Connection phases so the UI can render meaningful feedback at each step.
enum _CallPhase { connecting, waiting, connected, failed, ended }

class _AudioConsultationScreenState
    extends ConsumerState<AudioConsultationScreen>
    with TickerProviderStateMixin {
  _CallPhase _phase = _CallPhase.connecting;
  String _errorMessage = '';

  Room? _room;
  Timer? _timer;
  Timer? _pollTimer;
  int _seconds = 0;
  int _pollAttempts = 0;
  static const int _maxPollAttempts = 20;

  bool _isMuted = false;
  bool _isSpeakerOn = true;

  /// Audio-only consultations are not part of the demo surface. When this flag
  /// is true the screen renders a clear "not supported" message instead of
  /// attempting to connect via LiveKit.
  bool _notSupported = true;

  // Waveform animation — simulates audio bars during the call.
  late final AnimationController _waveformController;

  // Ripple animation — expanding rings around the avatar.
  late final AnimationController _rippleController;

  @override
  void initState() {
    super.initState();

    _waveformController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..repeat(reverse: true);

    _rippleController = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    )..repeat();

    // Audio-only mode is not supported for the demo; keep the screen static.
    if (!_notSupported) {
      _initCall();
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pollTimer?.cancel();
    _waveformController.dispose();
    _rippleController.dispose();
    _room?.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Call initialisation
  // ---------------------------------------------------------------------------

  Future<void> _initCall() async {
    setState(() {
      _phase = _CallPhase.connecting;
      _errorMessage = '';
    });

    try {
      // Step 0: Request microphone permission.
      final micStatus = await Permission.microphone.request();
      if (!micStatus.isGranted) {
        if (mounted) {
          setState(() {
            _phase = _CallPhase.failed;
            _errorMessage = 'Microphone permission is required for audio '
                'consultations. Please grant this permission in your phone '
                'settings and try again.';
          });
        }
        return;
      }

      final dio = ref.read(apiClientProvider);

      // Step 1: resolve the consultation id for this appointment.
      String? consultationId = await _resolveConsultationId(dio);

      if (consultationId == null) {
        if (mounted) {
          setState(() {
            _phase = _CallPhase.waiting;
            _pollAttempts = 0;
          });
          _startPolling(dio);
        }
        return;
      }

      // Step 3: request a room token.
      final tokenResp = await dio.post<Map<String, dynamic>>(
        ApiEndpoints.consultationRoomToken(consultationId),
      );
      final tokenData = ConsultationRoomToken.fromJson(
        tokenResp.data as Map<String, dynamic>,
      );

      // Step 4: connect to the LiveKit room (audio only).
      await _connectToRoom(tokenData.serverUrl, tokenData.accessToken);
    } on DioException catch (e) {
      if (mounted) {
        setState(() {
          _phase = _CallPhase.failed;
          _errorMessage = _humanizeDioError(e);
        });
      }
    } catch (e) {
      debugPrint('[AudioCall] init error: $e');
      if (mounted) {
        setState(() {
          _phase = _CallPhase.failed;
          _errorMessage = 'Could not connect to the consultation room. '
              'Please check your internet and try again.\n\n'
              'Details: $e';
        });
      }
    }
  }

  /// Fetches the patient's consultations and finds the one matching
  /// [widget.appointmentId].
  Future<String?> _resolveConsultationId(Dio dio) async {
    final resp = await dio.get<Map<String, dynamic>>(
      ApiEndpoints.profilesMeConsultations,
    );
    final data = resp.data as Map<String, dynamic>;
    final list = data['data'] as List<dynamic>;

    for (final raw in list) {
      final c = raw as Map<String, dynamic>;
      if (c['appointment_id'] == widget.appointmentId) {
        return c['consultation_id'] as String?;
      }
    }
    return null;
  }

  void _startPolling(Dio dio) {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (timer) async {
      _pollAttempts++;
      debugPrint(
          '[AudioCall] polling for consultation, attempt $_pollAttempts');
      try {
        final consultationId = await _resolveConsultationId(dio);
        if (consultationId != null) {
          timer.cancel();
          _pollTimer = null;
          final tokenResp = await dio.post<Map<String, dynamic>>(
            ApiEndpoints.consultationRoomToken(consultationId),
          );
          final tokenData = ConsultationRoomToken.fromJson(
            tokenResp.data as Map<String, dynamic>,
          );
          await _connectToRoom(tokenData.serverUrl, tokenData.accessToken);
          return;
        }
      } catch (e) {
        debugPrint('[AudioCall] poll error: $e');
      }
      if (_pollAttempts >= _maxPollAttempts) {
        timer.cancel();
        _pollTimer = null;
        if (mounted) {
          setState(() {
            _phase = _CallPhase.failed;
            _errorMessage = 'Your doctor has not started the session yet. '
                'Please wait a moment and try again, or contact your doctor. '
                'You checked in successfully — the consultation will begin '
                'once your doctor joins.';
          });
        }
      }
    });
  }

  // ---------------------------------------------------------------------------
  // LiveKit connection
  // ---------------------------------------------------------------------------

  Future<void> _connectToRoom(String url, String token) async {
    try {
      final room = Room();
      _room = room;

      await room.connect(url, token);

      // Publish microphone only (audio consultation).
      await room.localParticipant!.setMicrophoneEnabled(true);

      if (!mounted) return;

      setState(() => _phase = _CallPhase.connected);
      _startTimer();
    } catch (e) {
      debugPrint('[AudioCall] LiveKit connection error: $e');
      if (mounted) {
        setState(() {
          _phase = _CallPhase.failed;
          _errorMessage = _humanizeLiveKitError(e);
        });
      }
    }
  }

  String _humanizeLiveKitError(dynamic e) {
    if (e is ConnectException) {
      switch (e.reason) {
        case ConnectionErrorReason.NotAllowed:
          return 'The session token may have expired. Please go back and '
              'try joining again.';
        case ConnectionErrorReason.Timeout:
          return 'The connection timed out. This can happen on slow networks. '
              'Please try again.';
        case ConnectionErrorReason.InternalError:
          return 'The consultation server had an internal error. '
              'Please try again in a moment.';
      }
    }
    if (e is MediaConnectException) {
      return 'Could not establish a media connection. This may be a network '
          'issue — please check your internet and try again.';
    }
    if (e is LiveKitException) {
      return e.message;
    }
    return 'Could not connect to the consultation room. '
        'Please check your internet and try again.';
  }

  // ---------------------------------------------------------------------------
  // Timer
  // ---------------------------------------------------------------------------

  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _seconds++);
    });
  }

  String _formatDuration(int totalSeconds) {
    final minutes = totalSeconds ~/ 60;
    final seconds = totalSeconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:${seconds.toString().padLeft(2, '0')}';
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  Future<void> _toggleMute() async {
    if (_room?.localParticipant == null) return;
    setState(() => _isMuted = !_isMuted);
    await _room!.localParticipant!.setMicrophoneEnabled(!_isMuted);
  }

  void _toggleSpeaker() {
    setState(() => _isSpeakerOn = !_isSpeakerOn);
  }

  Future<void> _endCall() async {
    _timer?.cancel();
    if (_room != null) {
      try {
        await _room!.disconnect();
      } catch (_) {}
      try {
        _room!.dispose();
      } catch (_) {}
      _room = null;
    }
    if (mounted) {
      setState(() => _phase = _CallPhase.ended);
      await Future<void>.delayed(const Duration(milliseconds: 1500));
      if (mounted) context.pop();
    }
  }

  void _showEndCallDialog() {
    showDialog<void>(
      context: context,
      barrierDismissible: false,
      builder: (dialogContext) => BackdropFilter(
        filter: ImageFilter.blur(sigmaX: 10, sigmaY: 10),
        child: Dialog(
          backgroundColor: Colors.transparent,
          elevation: 0,
          child: Container(
            padding: const EdgeInsets.all(DesignTokens.spaceLg),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(DesignTokens.radius2xl),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration: const BoxDecoration(
                    color: AppColors.errorContainer,
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.call_end_rounded,
                    color: AppColors.error,
                    size: 32,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                Text(
                  'End Call?',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceMd),
                Text(
                  'Are you sure you want to end this audio consultation '
                  'with ${widget.doctorName}?',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 14,
                    height: 1.5,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceMd,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.gray50,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                    border: Border.all(color: AppColors.gray200),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.access_time_rounded,
                        size: 16,
                        color: AppColors.textSecondary,
                      ),
                      const SizedBox(width: DesignTokens.spaceSm),
                      Text(
                        'Call Duration: ${_formatDuration(_seconds)}',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.gray700,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: () => Navigator.pop(dialogContext),
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.gray700,
                          side: const BorderSide(
                            color: AppColors.gray300,
                            width: 1.5,
                          ),
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusMd),
                          ),
                        ),
                        child: Text(
                          'Continue',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: AppColors.gray700,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: DesignTokens.spaceMd),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: () {
                          Navigator.pop(dialogContext);
                          _endCall();
                        },
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.error,
                          foregroundColor: AppColors.white,
                          elevation: 0,
                          padding: const EdgeInsets.symmetric(vertical: 14),
                          shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusMd),
                          ),
                        ),
                        child: Text(
                          'End Call',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: AppColors.white,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts[0].isEmpty) return '?';
    if (parts.length == 1) {
      return parts[0].substring(0, 1).toUpperCase();
    }
    return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
  }

  /// Maps a [DioException] to a human-readable message — never exposes
  /// the raw exception or status code to the user.
  String _humanizeDioError(DioException e) {
    final apiError = e.error;
    if (apiError is ApiError) {
      if (apiError.isNetwork) {
        return 'Could not connect to the consultation room. '
            'Please check your internet and try again.';
      }
      if (apiError.isNotFound) {
        return 'Your doctor has not started the session yet. '
            'Please wait a moment and try again, or contact your doctor. '
            'You checked in successfully — the consultation will begin '
            'once your doctor joins.';
      }
      if (apiError.isConflict) {
        return 'The consultation has not started yet. '
            'Please wait for your doctor to begin the session.';
      }
      if (apiError.isServer) {
        return 'The consultation service is temporarily unavailable. '
            'Please try again in a moment.';
      }
      return apiError.userMessage;
    }
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.sendTimeout) {
      return 'Could not connect to the consultation room. '
          'Please check your internet and try again.';
    }
    return 'Could not connect to the consultation room. '
        'Please check your internet and try again.';
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    if (_notSupported) {
      return _buildNotSupported();
    }
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        statusBarBrightness: Brightness.dark,
        systemNavigationBarColor: AppColors.black,
        systemNavigationBarIconBrightness: Brightness.light,
      ),
      child: Scaffold(
        backgroundColor: AppColors.gray900,
        body: switch (_phase) {
          _CallPhase.connecting => _buildConnecting(),
          _CallPhase.waiting => _buildWaiting(),
          _CallPhase.failed => _buildFailed(),
          _CallPhase.ended => _buildEnded(),
          _CallPhase.connected => _buildCallUI(),
        },
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Not-supported phase
  // ---------------------------------------------------------------------------

  Widget _buildNotSupported() {
    return Scaffold(
      backgroundColor: AppColors.gray900,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceXl),
          child: Column(
            children: [
              const Spacer(flex: 2),
              Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  color: AppColors.primary.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.mic_off_rounded,
                  size: 40,
                  color: AppColors.primary,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceXl),
              Text(
                'Audio consultations are not supported',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: AppColors.white,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              Text(
                'Please book a video consultation instead. '
                'Audio-only appointments will be available in a future update.',
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  height: 1.6,
                  color: AppColors.white.withValues(alpha: 0.6),
                ),
              ),
              const Spacer(flex: 3),
              SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightLg,
                child: ElevatedButton(
                  onPressed: () => context.pop(),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                    ),
                  ),
                  child: Text(
                    'Go Back',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.white,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.space2xl),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Connecting phase
  // ---------------------------------------------------------------------------

  Widget _buildConnecting() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.gray900,
            AppColors.gray800,
            AppColors.gray900,
          ],
        ),
      ),
      child: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 2),
            // Avatar with ripple rings.
            _buildRippleAvatar(),
            const SizedBox(height: DesignTokens.spaceXl),
            Text(
              'Connecting to Dr. ${widget.doctorName}…',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: AppColors.white,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              'Please wait while we set up your audio consultation',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 14,
                fontWeight: FontWeight.w400,
                color: AppColors.white.withValues(alpha: 0.5),
              ),
              textAlign: TextAlign.center,
            ),
            const Spacer(flex: 3),
            // Cancel button.
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.space2xl,
              ),
              child: SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightLg,
                child: OutlinedButton(
                  onPressed: () {
                    _timer?.cancel();
                    _room?.dispose();
                    context.pop();
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.white,
                    side: BorderSide(
                      color: AppColors.white.withValues(alpha: 0.2),
                      width: 1.5,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                    ),
                  ),
                  child: Text(
                    'Cancel',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: AppColors.white.withValues(alpha: 0.8),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: DesignTokens.space2xl),
          ],
        ),
      ),
    );
  }

  Widget _buildRippleAvatar() {
    return SizedBox(
      width: 280,
      height: 280,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Expanding ripple rings.
          ...List.generate(3, (index) {
            return AnimatedBuilder(
              animation: _rippleController,
              builder: (context, child) {
                final delay = index * 0.33;
                final progress = (_rippleController.value + delay) % 1.0;
                final scale = 1.0 + (progress * 1.5);
                final opacity = 0.4 * (1.0 - progress);
                return Transform.scale(
                  scale: scale,
                  child: Container(
                    width: 176,
                    height: 176,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: AppColors.white.withValues(alpha: opacity),
                        width: 2,
                      ),
                    ),
                  ),
                );
              },
            );
          }),
          // Avatar circle with initials.
          Container(
            width: 176,
            height: 176,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.primary,
                  AppColors.primaryLight,
                ],
              ),
              border: Border.all(
                color: AppColors.white.withValues(alpha: 0.1),
                width: 4,
              ),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: 0.4),
                  blurRadius: 40,
                  spreadRadius: 4,
                  offset: const Offset(0, 20),
                ),
              ],
            ),
            child: Center(
              child: Text(
                _initials(widget.doctorName),
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 56,
                  fontWeight: FontWeight.w800,
                  color: AppColors.white,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Waiting-for-doctor phase
  // ---------------------------------------------------------------------------

  Widget _buildWaiting() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.gray900,
            AppColors.gray800,
            AppColors.gray900,
          ],
        ),
      ),
      child: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 2),
            _buildRippleAvatar(),
            const SizedBox(height: DesignTokens.spaceXl),
            Text(
              'Waiting for Dr. ${widget.doctorName}…',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: AppColors.white,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              'You\u2019re checked in. The audio call will start automatically\n'
              'once your doctor begins the session.\n'
              'Checking every 3 seconds…',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 14,
                fontWeight: FontWeight.w400,
                color: AppColors.white.withValues(alpha: 0.5),
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            Text(
              'Attempt $_pollAttempts of $_maxPollAttempts',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 12,
                fontWeight: FontWeight.w500,
                color: AppColors.white.withValues(alpha: 0.3),
              ),
            ),
            const Spacer(flex: 3),
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.space2xl,
              ),
              child: SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightLg,
                child: OutlinedButton(
                  onPressed: () {
                    _pollTimer?.cancel();
                    _room?.dispose();
                    context.pop();
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.white,
                    side: BorderSide(
                      color: AppColors.white.withValues(alpha: 0.2),
                      width: 1.5,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                    ),
                  ),
                  child: Text(
                    'Cancel',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: AppColors.white.withValues(alpha: 0.8),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: DesignTokens.space2xl),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Failed phase
  // ---------------------------------------------------------------------------

  Widget _buildFailed() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.gray900,
            AppColors.gray800,
            AppColors.gray900,
          ],
        ),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceXl),
          child: Column(
            children: [
              const Spacer(flex: 2),
              Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  color: AppColors.errorContainer.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.cloud_off_rounded,
                  size: 40,
                  color: AppColors.errorLight,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceXl),
              Text(
                'Connection Failed',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: AppColors.white,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              Text(
                _errorMessage,
                textAlign: TextAlign.center,
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  height: 1.6,
                  fontWeight: FontWeight.w400,
                  color: AppColors.white.withValues(alpha: 0.6),
                ),
              ),
              const Spacer(flex: 3),
              // Try Again button.
              SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightLg,
                child: ElevatedButton(
                  onPressed: _initCall,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                    ),
                  ),
                  child: Text(
                    'Try Again',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.white,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              // Go Back button.
              SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightLg,
                child: OutlinedButton(
                  onPressed: () => context.pop(),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.white,
                    side: BorderSide(
                      color: AppColors.white.withValues(alpha: 0.2),
                      width: 1.5,
                    ),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                    ),
                  ),
                  child: Text(
                    'Go Back',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: AppColors.white.withValues(alpha: 0.8),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.space2xl),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Ended phase
  // ---------------------------------------------------------------------------

  Widget _buildEnded() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.gray900,
            AppColors.gray800,
          ],
        ),
      ),
      child: SafeArea(
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 80,
                height: 80,
                decoration: BoxDecoration(
                  color: AppColors.success.withValues(alpha: 0.15),
                  shape: BoxShape.circle,
                ),
                child: const Icon(
                  Icons.check_circle_rounded,
                  size: 48,
                  color: AppColors.success,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceLg),
              Text(
                'Call Ended',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  color: AppColors.white,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              Text(
                _formatDuration(_seconds),
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 16,
                  fontWeight: FontWeight.w400,
                  color: AppColors.white.withValues(alpha: 0.5),
                  fontFeatures: [const FontFeature.tabularFigures()],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Active call UI
  // ---------------------------------------------------------------------------

  Widget _buildCallUI() {
    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [
            AppColors.primaryDark,
            AppColors.gray900,
            AppColors.gray900,
          ],
        ),
      ),
      child: SafeArea(
        child: Column(
          children: [
            const Spacer(flex: 2),
            // Call timer.
            _buildCallTimer(),
            const SizedBox(height: DesignTokens.space2xl),
            // Doctor avatar with animated waveform.
            _buildDoctorAvatarWithWaveform(),
            const SizedBox(height: DesignTokens.spaceXl),
            // Doctor info.
            _buildDoctorInfo(),
            const Spacer(flex: 3),
            // Bottom controls.
            _buildControls(),
            const SizedBox(height: DesignTokens.space2xl),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Call timer
  // ---------------------------------------------------------------------------

  Widget _buildCallTimer() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceLg,
        vertical: 8,
      ),
      decoration: BoxDecoration(
        color: AppColors.white.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
        border: Border.all(
          color: AppColors.white.withValues(alpha: 0.05),
        ),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(
              color: AppColors.success,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: AppColors.success.withValues(alpha: 0.6),
                  blurRadius: 8,
                  spreadRadius: 2,
                ),
              ],
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Text(
            _formatDuration(_seconds),
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: AppColors.white,
              letterSpacing: 2,
              fontFeatures: [const FontFeature.tabularFigures()],
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Doctor avatar with animated waveform
  // ---------------------------------------------------------------------------

  Widget _buildDoctorAvatarWithWaveform() {
    return SizedBox(
      width: 280,
      height: 280,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Ripple animations — subtle, continuous expansion.
          ...List.generate(3, (index) {
            return AnimatedBuilder(
              animation: _rippleController,
              builder: (context, child) {
                final delay = index * 0.33;
                final progress = (_rippleController.value + delay) % 1.0;
                final scale = 1.0 + (progress * 0.8);
                final opacity = 0.25 * (1.0 - progress);
                return Transform.scale(
                  scale: scale,
                  child: Container(
                    width: 176,
                    height: 176,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color:
                            AppColors.secondaryLight.withValues(alpha: opacity),
                        width: 2,
                      ),
                    ),
                  ),
                );
              },
            );
          }),
          // Avatar circle with initials.
          Container(
            width: 176,
            height: 176,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: const LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.primary,
                  AppColors.primaryLight,
                ],
              ),
              border: Border.all(
                color: AppColors.white.withValues(alpha: 0.1),
                width: 4,
              ),
              boxShadow: [
                BoxShadow(
                  color: AppColors.primary.withValues(alpha: 0.4),
                  blurRadius: 40,
                  spreadRadius: 4,
                  offset: const Offset(0, 20),
                ),
              ],
            ),
            child: Center(
              child: Text(
                _initials(widget.doctorName),
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 56,
                  fontWeight: FontWeight.w800,
                  color: AppColors.white,
                ),
              ),
            ),
          ),
          // Animated waveform bars around the bottom of the avatar.
          Positioned(
            bottom: 0,
            left: 0,
            right: 0,
            child: Center(child: _buildWaveform()),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Animated waveform
  // ---------------------------------------------------------------------------

  Widget _buildWaveform() {
    return AnimatedBuilder(
      animation: _waveformController,
      builder: (context, _) {
        return SizedBox(
          height: 48,
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.center,
            children: List.generate(7, (i) {
              final phase = _waveformController.value * 2 * 3.14159;
              final amplitude = 0.5 + 0.5 * ((phase + i * 0.7).abs() % 1.0);
              final height = 12.0 + amplitude * 36.0;
              return Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 100),
                  width: 5,
                  height: height,
                  decoration: BoxDecoration(
                    color: AppColors.white
                        .withValues(alpha: 0.4 + amplitude * 0.3),
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
              );
            }),
          ),
        );
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Doctor info
  // ---------------------------------------------------------------------------

  Widget _buildDoctorInfo() {
    return Column(
      children: [
        Text(
          widget.doctorName,
          style: TextStyle(
            fontFamily: 'Manrope',
            fontSize: 28,
            fontWeight: FontWeight.w800,
            color: AppColors.white,
            letterSpacing: -0.5,
            shadows: [
              Shadow(
                color: AppColors.black.withValues(alpha: 0.3),
                blurRadius: 10,
              ),
            ],
          ),
        ),
        if (widget.specialty.isNotEmpty) ...[
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            widget.specialty,
            style: TextStyle(
              fontFamily: 'Manrope',
              fontSize: 16,
              fontWeight: FontWeight.w500,
              color: AppColors.primaryLight.withValues(alpha: 0.8),
            ),
          ),
        ],
        const SizedBox(height: DesignTokens.spaceMd),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd,
            vertical: 8,
          ),
          decoration: BoxDecoration(
            color: AppColors.white.withValues(alpha: 0.06),
            borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            border: Border.all(
              color: AppColors.white.withValues(alpha: 0.05),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: AppColors.success,
                  shape: BoxShape.circle,
                  boxShadow: [
                    BoxShadow(
                      color: AppColors.success.withValues(alpha: 0.6),
                      blurRadius: 8,
                      spreadRadius: 2,
                    ),
                  ],
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Text(
                'ON CALL',
                style: TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: AppColors.successLight,
                  letterSpacing: 1.2,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Bottom controls
  // ---------------------------------------------------------------------------

  Widget _buildControls() {
    return Container(
      margin: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceLg,
      ),
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceXl,
        vertical: DesignTokens.spaceLg,
      ),
      decoration: BoxDecoration(
        color: AppColors.white.withValues(alpha: 0.06),
        borderRadius: BorderRadius.circular(DesignTokens.radius2xl),
        border: Border.all(
          color: AppColors.white.withValues(alpha: 0.08),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.4),
            blurRadius: 32,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          // Mute toggle.
          _buildControlButton(
            icon: _isMuted ? Icons.mic_off_rounded : Icons.mic_rounded,
            onPressed: _toggleMute,
            isActive: !_isMuted,
          ),
          // Speaker toggle.
          _buildControlButton(
            icon: _isSpeakerOn
                ? Icons.volume_up_rounded
                : Icons.volume_down_rounded,
            onPressed: _toggleSpeaker,
            isActive: _isSpeakerOn,
          ),
          // Divider.
          Container(
            width: 1,
            height: 32,
            color: AppColors.white.withValues(alpha: 0.1),
            margin: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceSm,
            ),
          ),
          // End call button.
          GestureDetector(
            onTap: _showEndCallDialog,
            child: Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: AppColors.error,
                shape: BoxShape.circle,
                border: Border.all(
                  color: AppColors.errorLight.withValues(alpha: 0.2),
                  width: 2,
                ),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.errorDark.withValues(alpha: 0.4),
                    blurRadius: 20,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: const Icon(
                Icons.call_end_rounded,
                color: AppColors.white,
                size: 28,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildControlButton({
    required IconData icon,
    required VoidCallback onPressed,
    bool isActive = true,
  }) {
    return GestureDetector(
      onTap: onPressed,
      child: Container(
        width: 56,
        height: 56,
        decoration: BoxDecoration(
          color: AppColors.white.withValues(alpha: isActive ? 0.1 : 0.05),
          shape: BoxShape.circle,
          border: Border.all(
            color: AppColors.white.withValues(alpha: 0.05),
          ),
        ),
        child: Icon(
          icon,
          color: isActive
              ? AppColors.white
              : AppColors.white.withValues(alpha: 0.4),
          size: 26,
        ),
      ),
    );
  }
}
