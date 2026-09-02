import 'dart:async';
import 'dart:ui';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart' hide ConnectionState;
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart' hide Permission;

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/health_provider.dart';
import '../../../../core/providers/message_provider.dart';
import '../../../../core/providers/prescription_provider.dart';
import '../../../../core/models/search_params.dart';
import '../../../../core/models/session_bootstrap.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../components/video_consultation_chat_panel.dart';
import '../components/video_consultation_vitals_sheet.dart';

/// Video Consultation Screen — production-quality telemedicine flow.
///
/// Lifecycle:
///  1. Receives [appointmentId] (+ optional [doctorName], [specialty],
///     [doctorImageUrl]) from the route extra.
///  2. Loads the appointment details and doctor profile from the backend.
///  3. Shows a pre-join screen with appointment info and preparation guidance.
///  4. When the patient taps "Join Consultation", checks camera + microphone
///     permissions and enters the waiting/connecting flow.
///  5. Resolves the consultation id, requests a LiveKit room token, and
///     connects to the room.
///  6. Renders remote video full-screen, local camera as a draggable PiP,
///     call controls, connection quality, and in-call actions (chat, vitals,
///     health, appointment).
///  7. On end call, shows a real summary with duration and next actions.
class VideoConsultationScreen extends ConsumerStatefulWidget {
  final String appointmentId;
  final String doctorName;
  final String specialty;
  final String? doctorImageUrl;

  const VideoConsultationScreen({
    super.key,
    required this.appointmentId,
    required this.doctorName,
    this.specialty = '',
    this.doctorImageUrl,
  });

  @override
  ConsumerState<VideoConsultationScreen> createState() =>
      _VideoConsultationScreenState();
}

/// Phases of the video consultation flow.
enum _CallPhase {
  loading,
  preJoin,
  checkingPermissions,
  micPermissionDenied,
  cameraPermissionDenied,
  waiting,
  connecting,
  connected,
  poorConnection,
  doctorNotConnected,
  doctorDisconnected,
  patientDisconnected,
  ended,
  unavailable,
  failed,
}

class _VideoConsultationScreenState
    extends ConsumerState<VideoConsultationScreen>
    with TickerProviderStateMixin {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  _CallPhase _phase = _CallPhase.loading;
  String _errorMessage = '';
  String _lastErrorDetail = '';

  // Appointment / doctor data.
  Appointment? _appointment;
  DoctorDirectoryItem? _doctor;
  Profile? _patientProfile;
  Consultation? _consultation;
  List<Prescription> _consultationPrescriptions = [];

  // LiveKit.
  Room? _room;
  bool _connectAttemptInProgress = false;
  Timer? _timer;
  Timer? _pollTimer;
  Timer? _networkTimer;
  int _seconds = 0;
  int _pollAttempts = 0;
  static const int _maxPollAttempts = 40; // ~2 minutes at 3s intervals

  // Media controls.
  bool _isMuted = false;
  bool _isCameraOn = true;
  bool _isSpeakerOn = true;

  // Tracks.
  TrackPublication? _remoteVideoTrack;
  LocalTrackPublication? _localVideoTrack;
  bool _isRemoteConnected = false;
  bool _isRemoteVideoEnabled = false;

  // PiP position.
  double _pipRight = 16;
  double _pipTop = 100;

  // Connection quality from the SDK.
  ConnectionQuality _connectionQuality = ConnectionQuality.unknown;

  // Overlay panels.
  bool _isChatOpen = false;
  bool _isHealthPanelOpen = false;
  bool _isAppointmentPanelOpen = false;
  bool _isMoreMenuOpen = false;

  // Permission states.
  PermissionStatus _micPermission = PermissionStatus.denied;
  PermissionStatus _cameraPermission = PermissionStatus.denied;
  _PermissionKind _deniedPermission = _PermissionKind.none;

  // Animations.
  late final AnimationController _pulseController;
  late final AnimationController _connectionPulseController;

  // Call timing for summary.
  DateTime? _callStartedAt;
  DateTime? _callEndedAt;

  // Network.
  bool _isNetworkAvailable = true;

  @override
  void initState() {
    super.initState();
    _pulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1800),
    )..repeat();
    _connectionPulseController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1200),
    )..repeat();

    _loadInitialData();
    _startNetworkMonitoring();
  }

  @override
  void dispose() {
    _timer?.cancel();
    _pollTimer?.cancel();
    _networkTimer?.cancel();
    _pulseController.dispose();
    _connectionPulseController.dispose();
    _cleanupRoom();
    super.dispose();
  }

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  Future<void> _loadInitialData() async {
    setState(() => _phase = _CallPhase.loading);
    try {
      final dio = ref.read(apiClientProvider);

      // Appointment details.
      final apptResponse = await dio.get<Map<String, dynamic>>(
        ApiEndpoints.appointment(widget.appointmentId),
      );
      _appointment = AppointmentMapper.fromJson(
        apptResponse.data as Map<String, dynamic>,
      );

      // Patient profile.
      try {
        final profileResponse = await dio.get<Map<String, dynamic>>(
          ApiEndpoints.profilesMe,
        );
        _patientProfile = ProfileMapper.fromJson(
          profileResponse.data as Map<String, dynamic>,
        );
      } catch (e) {
        debugPrint('[VideoCall] profile load error: $e');
      }

      // Doctor details.
      try {
        final doctorResponse = await dio.get<Map<String, dynamic>>(
          ApiEndpoints.doctor(_appointment!.doctorMembershipId),
        );
        _doctor = DoctorDirectoryItemMapper.fromJson(
          doctorResponse.data as Map<String, dynamic>,
        );
      } on DioException catch (e) {
        debugPrint('[VideoCall] doctor load error: $e');
      }

      if (!mounted) return;

      // Decide if the appointment is joinable.
      final status = _appointment!.status;
      if (_isAppointmentUnavailable(status)) {
        setState(() => _phase = _CallPhase.unavailable);
        return;
      }

      // Audio-only consultations are not supported by this screen.
      if (_appointment!.mode != AppointmentMode.video) {
        setState(() {
          _phase = _CallPhase.failed;
          _errorMessage = 'This appointment is not a video consultation. '
              'Please use the audio or chat option instead.';
        });
        return;
      }

      setState(() => _phase = _CallPhase.preJoin);
    } on DioException catch (e) {
      if (!mounted) return;
      setState(() {
        _phase = _CallPhase.failed;
        _errorMessage = _humanizeDioError(e);
      });
    } catch (e) {
      debugPrint('[VideoCall] load error: $e');
      if (!mounted) return;
      setState(() {
        _phase = _CallPhase.failed;
        _errorMessage = 'Could not load appointment details. '
            'Please check your internet and try again.';
        _lastErrorDetail = _sanitizeConnectionError(e);
      });
    }
  }

  bool _isAppointmentUnavailable(AppointmentStatus status) {
    return status == AppointmentStatus.cancelled ||
        status == AppointmentStatus.completed ||
        status == AppointmentStatus.noShow ||
        status == AppointmentStatus.rescheduled;
  }

  String _unavailableStatusLabel(AppointmentStatus status) {
    switch (status) {
      case AppointmentStatus.cancelled:
        return 'Cancelled';
      case AppointmentStatus.completed:
        return 'Completed';
      case AppointmentStatus.noShow:
        return 'No-show';
      case AppointmentStatus.rescheduled:
        return 'Rescheduled';
      default:
        return 'Unavailable';
    }
  }

  // ---------------------------------------------------------------------------
  // Network monitoring
  // ---------------------------------------------------------------------------

  void _startNetworkMonitoring() {
    _networkTimer = Timer.periodic(const Duration(seconds: 2), (_) async {
      final result = await Connectivity().checkConnectivity();
      final available = result != ConnectivityResult.none;
      if (available != _isNetworkAvailable) {
        setState(() => _isNetworkAvailable = available);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  Future<void> _onJoinPressed() async {
    HapticFeedback.mediumImpact();
    setState(() => _phase = _CallPhase.checkingPermissions);
    await _checkPermissions();
  }

  Future<void> _checkPermissions() async {
    _micPermission = await Permission.microphone.status;
    _cameraPermission = await Permission.camera.status;

    if (_micPermission.isPermanentlyDenied ||
        _cameraPermission.isPermanentlyDenied) {
      if (_micPermission.isPermanentlyDenied &&
          _cameraPermission.isPermanentlyDenied) {
        if (mounted) {
          setState(() {
            _deniedPermission = _PermissionKind.both;
            _phase = _CallPhase.micPermissionDenied;
          });
        }
        return;
      }
      if (_micPermission.isPermanentlyDenied) {
        if (mounted) {
          setState(() {
            _deniedPermission = _PermissionKind.microphone;
            _phase = _CallPhase.micPermissionDenied;
          });
        }
        return;
      }
      if (_cameraPermission.isPermanentlyDenied) {
        if (mounted) {
          setState(() {
            _deniedPermission = _PermissionKind.camera;
            _phase = _CallPhase.cameraPermissionDenied;
          });
        }
        return;
      }
    }

    if (!_micPermission.isGranted || !_cameraPermission.isGranted) {
      final micResult = await Permission.microphone.request();
      final cameraResult = await Permission.camera.request();
      _micPermission = micResult;
      _cameraPermission = cameraResult;
    }

    if (_micPermission.isGranted && _cameraPermission.isGranted) {
      if (mounted) await _initCall();
      return;
    }

    if (!_micPermission.isGranted) {
      if (mounted) {
        setState(() {
          _deniedPermission = _PermissionKind.microphone;
          _phase = _CallPhase.micPermissionDenied;
        });
      }
      return;
    }

    if (!_cameraPermission.isGranted) {
      if (mounted) {
        setState(() {
          _deniedPermission = _PermissionKind.camera;
          _phase = _CallPhase.cameraPermissionDenied;
        });
      }
    }
  }

  Future<void> _openAppSettings() async {
    await openAppSettings();
  }

  Future<void> _retryAfterPermission() async {
    _micPermission = await Permission.microphone.status;
    _cameraPermission = await Permission.camera.status;

    if (_micPermission.isGranted && _cameraPermission.isGranted) {
      if (mounted) await _initCall();
      return;
    }

    // If only camera is still denied, let the patient proceed audio-only.
    if (_micPermission.isGranted) {
      setState(() => _isCameraOn = false);
      if (mounted) await _initCall();
      return;
    }

    // Otherwise stay on the permission screen.
    setState(() {});
  }

  // ---------------------------------------------------------------------------
  // Call initialisation
  // ---------------------------------------------------------------------------

  Future<void> _initCall() async {
    if (_connectAttemptInProgress) return;
    _connectAttemptInProgress = true;

    setState(() {
      _phase = _CallPhase.connecting;
      _errorMessage = '';
    });

    try {
      final dio = ref.read(apiClientProvider);

      // Resolve the consultation id for this appointment.
      final consultationId = await _resolveConsultationId(dio);

      if (consultationId == null) {
        // Doctor hasn't created the consultation yet; enter the waiting room.
        if (mounted) {
          setState(() {
            _phase = _CallPhase.waiting;
            _pollAttempts = 0;
          });
          _startPolling(dio);
        }
        _connectAttemptInProgress = false;
        return;
      }

      await _fetchConsultationAndConnect(dio, consultationId);
    } on DioException catch (e) {
      _connectAttemptInProgress = false;
      if (mounted) {
        setState(() {
          _phase = _CallPhase.failed;
          _errorMessage = _humanizeDioError(e);
        });
      }
    } catch (e) {
      _connectAttemptInProgress = false;
      debugPrint('[VideoCall] init error: $e');
      if (mounted) {
        setState(() {
          _phase = _CallPhase.failed;
          _errorMessage = 'Could not connect to the consultation room. '
              'Please check your internet and try again.';
          _lastErrorDetail = _sanitizeConnectionError(e);
        });
      }
    }
  }

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

  Future<void> _fetchConsultationAndConnect(
      Dio dio, String consultationId) async {
    try {
      final consultationResponse = await dio.get<Map<String, dynamic>>(
        ApiEndpoints.consultation(consultationId),
      );
      _consultation = ConsultationMapper.fromJson(
        consultationResponse.data as Map<String, dynamic>,
      );
    } catch (e) {
      debugPrint('[VideoCall] consultation fetch error: $e');
    }

    final tokenResp = await dio.post<Map<String, dynamic>>(
      ApiEndpoints.consultationRoomToken(consultationId),
    );
    final tokenData = ConsultationRoomToken.fromJson(
      tokenResp.data as Map<String, dynamic>,
    );

    await _connectToRoom(tokenData.serverUrl, tokenData.accessToken);
  }

  void _startPolling(Dio dio) {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(const Duration(seconds: 3), (timer) async {
      _pollAttempts++;
      debugPrint(
          '[VideoCall] polling for consultation, attempt $_pollAttempts');
      try {
        final consultationId = await _resolveConsultationId(dio);
        if (consultationId != null) {
          timer.cancel();
          _pollTimer = null;
          debugPrint('[VideoCall] consultation found: $consultationId');
          await _fetchConsultationAndConnect(dio, consultationId);
          return;
        }
      } catch (e) {
        debugPrint('[VideoCall] poll error: $e');
      }
      if (_pollAttempts >= _maxPollAttempts) {
        timer.cancel();
        _pollTimer = null;
        if (mounted) {
          setState(() {
            _phase = _CallPhase.failed;
            _errorMessage = 'Your doctor has not started the session yet. '
                'Please wait a moment and try again, or contact your doctor. '
                'You checked in successfully — the consultation will begin once '
                'your doctor joins.';
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
      await _cleanupRoom();

      // Disable WebRTC audio processing (AEC/NS/AGC) on devices where it fails
      // to initialize. Quality is lower but the call can proceed.
      final room = Room(
        roomOptions: const RoomOptions(
          defaultAudioCaptureOptions: AudioCaptureOptions(
            noiseSuppression: false,
            echoCancellation: false,
            autoGainControl: false,
          ),
        ),
      );
      _room = room;

      room.events.on<RoomEvent>(_onRoomEvent);

      await room.connect(url, token);

      await room.localParticipant!.setCameraEnabled(_isCameraOn);
      await room.localParticipant!.setMicrophoneEnabled(!_isMuted);

      if (!mounted) return;

      setState(() {
        _phase = _CallPhase.connected;
        _connectAttemptInProgress = false;
      });
      _callStartedAt = DateTime.now();
      _startTimer();
      _updateLocalTracks();
      _updateRemoteTracks();
      _updateConnectionQuality();
    } catch (e) {
      _connectAttemptInProgress = false;
      final detail = _sanitizeConnectionError(e);
      debugPrint('[VideoCall] LiveKit connection error: $detail');
      if (mounted) {
        setState(() {
          _phase = _CallPhase.failed;
          _errorMessage = _humanizeLiveKitError(e);
          _lastErrorDetail = detail;
        });
      }
    }
  }

  void _onRoomEvent(RoomEvent event) {
    if (event is TrackSubscribedEvent ||
        event is TrackUnsubscribedEvent ||
        event is ParticipantConnectedEvent ||
        event is ParticipantDisconnectedEvent) {
      _updateRemoteTracks();
    } else if (event is LocalTrackPublishedEvent ||
        event is LocalTrackUnpublishedEvent) {
      _updateLocalTracks();
    }
  }

  void _updateConnectionQuality() {
    // LiveKit connection quality is best-effort. We derive a simple indicator
    // from whether a remote participant is present and the local state.
    if (!mounted) return;
    if (_room == null) {
      setState(() => _connectionQuality = ConnectionQuality.unknown);
      return;
    }
    final hasRemote = _room!.remoteParticipants.isNotEmpty;
    setState(() => _connectionQuality =
        hasRemote ? ConnectionQuality.good : ConnectionQuality.unknown);
  }

  void _updateRemoteTracks() {
    if (_room == null || !mounted) return;

    TrackPublication? videoTrack;
    bool remoteConnected = false;

    for (final participant in _room!.remoteParticipants.values) {
      remoteConnected = true;
      for (final pub in participant.trackPublications.values) {
        if (pub.kind == TrackType.VIDEO) {
          videoTrack = pub;
          break;
        }
      }
      if (videoTrack != null) break;
    }

    final videoEnabled =
        videoTrack != null && _isTrackEnabled(videoTrack.track);

    setState(() {
      _remoteVideoTrack = videoTrack;
      _isRemoteConnected = remoteConnected;
      _isRemoteVideoEnabled = videoEnabled;
    });

    _updateConnectionQuality();

    if (_phase == _CallPhase.connected && !remoteConnected) {
      setState(() => _phase = _CallPhase.doctorDisconnected);
    } else if (_phase == _CallPhase.doctorDisconnected && remoteConnected) {
      setState(() => _phase = _CallPhase.connected);
    } else if (_phase == _CallPhase.waiting && remoteConnected) {
      setState(() => _phase = _CallPhase.connected);
    }
  }

  void _updateLocalTracks() {
    if (_room == null || !mounted) return;

    LocalTrackPublication? localVideo;
    for (final pub in _room!.localParticipant!.trackPublications.values) {
      if (pub.kind == TrackType.VIDEO) {
        localVideo = pub;
        break;
      }
    }

    setState(() => _localVideoTrack = localVideo);
  }

  Future<void> _cleanupRoom() async {
    if (_room != null) {
      try {
        await _room!.disconnect();
      } catch (_) {}
      try {
        _room!.dispose();
      } catch (_) {}
      _room = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Timer
  // ---------------------------------------------------------------------------

  void _startTimer() {
    _timer?.cancel();
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

  Future<void> _toggleCamera() async {
    if (_room?.localParticipant == null) return;
    setState(() => _isCameraOn = !_isCameraOn);
    await _room!.localParticipant!.setCameraEnabled(_isCameraOn);
    _updateLocalTracks();
  }

  Future<void> _toggleSpeaker() async {
    setState(() => _isSpeakerOn = !_isSpeakerOn);
    // Audio output routing is managed by the platform; the SDK keeps the
    // microphone stream active. This toggles the visual indicator only.
  }

  Future<void> _endCall() async {
    _timer?.cancel();
    _callEndedAt = DateTime.now();

    await _cleanupRoom();

    if (mounted) {
      setState(() {
        _phase = _CallPhase.ended;
      });

      // Load consultation prescriptions for post-call actions.
      if (_consultation != null) {
        _loadConsultationPrescriptions();
      }
    }
  }

  Future<void> _loadConsultationPrescriptions() async {
    if (_consultation == null) return;
    try {
      final dio = ref.read(apiClientProvider);
      final response = await dio.get<dynamic>(
        ApiEndpoints.consultationPrescriptions(_consultation!.consultationId),
      );
      final data = response.data;
      List<Prescription> list;
      if (data is List) {
        list = data
            .whereType<Map<String, dynamic>>()
            .map(PrescriptionMapper.fromJson)
            .toList();
      } else {
        list = ((data as Map<String, dynamic>)['data'] as List<dynamic>)
            .whereType<Map<String, dynamic>>()
            .map(PrescriptionMapper.fromJson)
            .toList();
      }
      if (mounted) setState(() => _consultationPrescriptions = list);
    } catch (e) {
      debugPrint('[VideoCall] load prescriptions error: $e');
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
                const Text(
                  'End Consultation?',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 22,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceMd),
                Text(
                  'Are you sure you want to end this consultation with ${_doctorName}?',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
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
                        'Duration: ${_formatDuration(_seconds)}',
                        style: const TextStyle(
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
                        child: const Text(
                          'Continue Consultation',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
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
                        child: const Text(
                          'End Consultation',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
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
  // In-call actions
  // ---------------------------------------------------------------------------

  void _toggleChat() {
    setState(() {
      _isChatOpen = !_isChatOpen;
      _isHealthPanelOpen = false;
      _isAppointmentPanelOpen = false;
      _isMoreMenuOpen = false;
    });
  }

  void _closeChat() => setState(() => _isChatOpen = false);

  Future<void> _openVitalsSheet() async {
    _closeAllPanels();

    final readings = await ref.read(vitalReadingsProvider.future);

    if (!mounted) return;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => VideoConsultationVitalsSheet(
        readings: readings,
        doctorName: _doctorName,
        onShare: (selected) {
          // Send a system-like message via the consultation conversation if
          // it exists. The actual share is best-effort; we never block the UI.
          _shareVitalsInChat(selected);
        },
      ),
    );
  }

  Future<void> _shareVitalsInChat(List<VitalReading> selected) async {
    if (_consultation == null) return;
    try {
      final dio = ref.read(apiClientProvider);
      final response = await dio.get<dynamic>(
        ApiEndpoints.consultationConversation(_consultation!.consultationId),
      );
      final conversation = ConversationMapper.fromJson(
        response.data as Map<String, dynamic>,
      );

      final text = selected
          .map((r) => '${_metricLabel(r.metric)}: ${r.value} ${r.unit}')
          .join('\n');

      await dio.post<dynamic>(
        ApiEndpoints.conversationMessages(conversation.conversationId),
        data: {
          'message_type': 'text',
          'text_content': 'Shared vitals:\n$text',
        },
      );
    } catch (e) {
      debugPrint('[VideoCall] share vitals error: $e');
    }
  }

  void _openHealthPanel() {
    setState(() {
      _isHealthPanelOpen = !_isHealthPanelOpen;
      _isChatOpen = false;
      _isAppointmentPanelOpen = false;
      _isMoreMenuOpen = false;
    });
  }

  void _openAppointmentPanel() {
    setState(() {
      _isAppointmentPanelOpen = !_isAppointmentPanelOpen;
      _isChatOpen = false;
      _isHealthPanelOpen = false;
      _isMoreMenuOpen = false;
    });
  }

  void _openMoreMenu() {
    setState(() {
      _isMoreMenuOpen = !_isMoreMenuOpen;
      _isChatOpen = false;
      _isHealthPanelOpen = false;
      _isAppointmentPanelOpen = false;
    });
  }

  void _closeAllPanels() {
    setState(() {
      _isChatOpen = false;
      _isHealthPanelOpen = false;
      _isAppointmentPanelOpen = false;
      _isMoreMenuOpen = false;
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /// The doctor's name without the "Dr." title, so callers can style it
  /// consistently and avoid double titles like "Dr. Dr. Nurul Aisyah Rahman".
  String get _doctorName {
    final name = _doctor?.displayName ?? widget.doctorName;
    return name
        .replaceFirst(RegExp(r'^Dr\.?\s*', caseSensitive: false), '')
        .trim();
  }

  String get _doctorSpecialty => _doctor?.primarySpecialty ?? widget.specialty;

  /// Human-readable specialty label (e.g. `general_practice` -> General Practice).
  String get _displaySpecialty {
    final raw = _doctorSpecialty;
    if (raw.isEmpty) return 'Medical Practitioner';
    return _specialtyLabel(raw);
  }

  String? get _doctorImageUrl => _doctor?.imageUrl ?? widget.doctorImageUrl;

  String _specialtyLabel(String raw) {
    const map = {
      'general_practice': 'General Practice',
      'cardiology': 'Cardiology',
      'dermatology': 'Dermatology',
      'endocrinology': 'Endocrinology',
      'gastroenterology': 'Gastroenterology',
      'neurology': 'Neurology',
      'oncology': 'Oncology',
      'orthopedics': 'Orthopedics',
      'pediatrics': 'Pediatrics',
      'psychiatry': 'Psychiatry',
      'radiology': 'Radiology',
      'surgery': 'Surgery',
      'urology': 'Urology',
      'obstetrics_gynecology': 'Obstetrics & Gynecology',
      'internal_medicine': 'Internal Medicine',
      'family_medicine': 'Family Medicine',
      'emergency_medicine': 'Emergency Medicine',
      'anesthesiology': 'Anesthesiology',
      'ophthalmology': 'Ophthalmology',
      'ent': 'ENT',
      'dentistry': 'Dentistry',
      'physiotherapy': 'Physiotherapy',
      'nutrition': 'Nutrition',
      'mental_health': 'Mental Health',
    };
    return map[raw.toLowerCase()] ?? _titleCaseSnake(raw);
  }

  String _titleCaseSnake(String raw) {
    return raw.split('_').map((w) {
      if (w.isEmpty) return '';
      return '${w[0].toUpperCase()}${w.substring(1)}';
    }).join(' ');
  }

  String _sanitizeConnectionError(dynamic e) {
    var text = e.toString();
    // Strip any JWT-like token to avoid leaking session credentials in the UI.
    text = text.replaceAll(
      RegExp(r'[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}'),
      '[TOKEN]',
    );
    if (text.length > 300) text = '${text.substring(0, 300)}...';
    return text;
  }

  String _metricLabel(VitalMetric metric) {
    switch (metric) {
      case VitalMetric.heartRate:
        return 'Heart Rate';
      case VitalMetric.oxygenSaturation:
        return 'SpO₂';
      case VitalMetric.bodyTemperature:
        return 'Temperature';
      case VitalMetric.systolicBp:
        return 'Systolic BP';
      case VitalMetric.diastolicBp:
        return 'Diastolic BP';
      case VitalMetric.bloodPressure:
        return 'Blood Pressure';
      case VitalMetric.bloodGlucose:
        return 'Blood Glucose';
      case VitalMetric.bodyWeight:
        return 'Weight';
      case VitalMetric.respiratoryRate:
        return 'Respiratory Rate';
      case VitalMetric.ecgVoltage:
        return 'ECG';
      case VitalMetric.unknown:
        return 'Unknown';
    }
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts[0].isEmpty) return '?';
    if (parts.length == 1) {
      return parts[0].substring(0, 1).toUpperCase();
    }
    return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
  }

  bool _isTrackEnabled(Track? track) {
    if (track == null) return false;
    try {
      return track.mediaStreamTrack.enabled;
    } catch (_) {
      return true;
    }
  }

  String _humanizeDioError(DioException e) {
    final apiError = e.error;
    if (apiError is ApiError) {
      if (apiError.isNetwork) {
        return 'Could not connect to the consultation room. '
            'Please check your internet and try again.';
      }
      if (apiError.isNotFound) {
        return 'No consultation found for this appointment. '
            'The doctor may need to start the session first.';
      }
      if (apiError.isConflict) {
        return 'The consultation has not started yet. '
            'Please wait for your doctor to begin the session.';
      }
      if (apiError.isForbidden) {
        return 'You are not authorized to join this consultation. '
            'Please check your appointment details.';
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

  String _humanizeLiveKitError(dynamic e) {
    if (e is ConnectException) {
      switch (e.reason) {
        case ConnectionErrorReason.NotAllowed:
          return 'The session token may have expired. Please go back and try joining again.';
        case ConnectionErrorReason.Timeout:
          return 'The connection timed out. This can happen on slow networks. Please try again.';
        case ConnectionErrorReason.InternalError:
          return 'The consultation server had an internal error. Please try again in a moment.';
      }
    }
    if (e is MediaConnectException) {
      return 'Could not establish a media connection. This may be a network issue — please check your internet and try again.';
    }
    if (e is LiveKitException) {
      return e.message;
    }
    return 'Could not connect to the consultation room. '
        'Please check your internet and try again.';
  }

  Color _connectionQualityColor() {
    switch (_connectionQuality) {
      case ConnectionQuality.excellent:
      case ConnectionQuality.good:
        return AppColors.success;
      case ConnectionQuality.poor:
        return AppColors.warning;
      default:
        return AppColors.gray400;
    }
  }

  String _formatDate(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final dt = DateTime.parse(iso).toLocal();
    return DateFormat('EEE, MMM d, yyyy').format(dt);
  }

  String _formatTime(String? iso) {
    if (iso == null || iso.isEmpty) return '—';
    final dt = DateTime.parse(iso).toLocal();
    return DateFormat('h:mm a').format(dt);
  }

  String _durationLabel(int totalSeconds) {
    final minutes = totalSeconds ~/ 60;
    final seconds = totalSeconds % 60;
    if (minutes > 0) {
      return '${minutes}m ${seconds.toString().padLeft(2, '0')}s';
    }
    return '${seconds}s';
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final isLightPhase = _phase == _CallPhase.loading ||
        _phase == _CallPhase.preJoin ||
        _phase == _CallPhase.waiting ||
        _phase == _CallPhase.connecting ||
        _phase == _CallPhase.doctorNotConnected ||
        _phase == _CallPhase.micPermissionDenied ||
        _phase == _CallPhase.cameraPermissionDenied ||
        _phase == _CallPhase.ended ||
        _phase == _CallPhase.unavailable ||
        _phase == _CallPhase.failed;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness:
            isLightPhase ? Brightness.dark : Brightness.light,
        statusBarBrightness: isLightPhase ? Brightness.light : Brightness.dark,
        systemNavigationBarColor:
            isLightPhase ? AppColors.background : AppColors.black,
        systemNavigationBarIconBrightness:
            isLightPhase ? Brightness.dark : Brightness.light,
      ),
      child: Scaffold(
        backgroundColor:
            isLightPhase ? AppColors.background : AppColors.gray900,
        body: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    switch (_phase) {
      case _CallPhase.loading:
        return _buildLoading();
      case _CallPhase.preJoin:
        return _buildPreJoin();
      case _CallPhase.checkingPermissions:
        return _buildCheckingPermissions();
      case _CallPhase.micPermissionDenied:
      case _CallPhase.cameraPermissionDenied:
        return _buildPermissionDenied();
      case _CallPhase.waiting:
        return _buildWaiting();
      case _CallPhase.connecting:
        return _buildConnecting();
      case _CallPhase.connected:
      case _CallPhase.poorConnection:
      case _CallPhase.doctorNotConnected:
      case _CallPhase.doctorDisconnected:
      case _CallPhase.patientDisconnected:
        return _buildCallUI();
      case _CallPhase.ended:
        return _buildEnded();
      case _CallPhase.unavailable:
        return _buildUnavailable();
      case _CallPhase.failed:
        return _buildFailed();
    }
  }

  // ---------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------

  Widget _buildLoading() {
    return SafeArea(
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(color: AppColors.primary),
            const SizedBox(height: DesignTokens.spaceLg),
            const Text(
              'Loading your appointment...',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 16,
                color: AppColors.textSecondary,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Pre-join screen
  // ---------------------------------------------------------------------------

  Widget _buildPreJoin() {
    final joinable = _appointment != null &&
        (_appointment!.status == AppointmentStatus.confirmed ||
            _appointment!.status == AppointmentStatus.checkedIn ||
            _appointment!.status == AppointmentStatus.inProgress);

    return SafeArea(
      child: Column(
        children: [
          _buildLightAppBar(showBack: true),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              children: [
                // Doctor info card.
                Container(
                  padding: const EdgeInsets.all(DesignTokens.spaceMd),
                  decoration: BoxDecoration(
                    color: AppColors.surface,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.shadow,
                        blurRadius: 8,
                        offset: const Offset(0, 2),
                      ),
                    ],
                  ),
                  child: Row(
                    children: [
                      AvatarWidget(
                        imageUrl: _doctorImageUrl,
                        name: _doctorName,
                        size: 64,
                      ),
                      const SizedBox(width: DesignTokens.spaceMd),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Dr. $_doctorName',
                              style: const TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              _displaySpecialty,
                              style: const TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 14,
                                color: AppColors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceMd),

                // Appointment card.
                Container(
                  padding: const EdgeInsets.all(DesignTokens.spaceMd),
                  decoration: BoxDecoration(
                    color: AppColors.primaryContainer,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Container(
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withValues(alpha: 0.1),
                              borderRadius:
                                  BorderRadius.circular(DesignTokens.radiusMd),
                            ),
                            child: const Icon(
                              Icons.videocam_rounded,
                              color: AppColors.primary,
                              size: 20,
                            ),
                          ),
                          const SizedBox(width: DesignTokens.spaceMd),
                          const Expanded(
                            child: Text(
                              'Video Consultation',
                              style: TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 16,
                                fontWeight: FontWeight.w700,
                                color: AppColors.primaryOnContainer,
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: DesignTokens.spaceMd),
                      _buildInfoRow(
                        Icons.calendar_today_outlined,
                        'Date',
                        _formatDate(_appointment?.startsAt),
                      ),
                      const SizedBox(height: DesignTokens.spaceSm),
                      _buildInfoRow(
                        Icons.access_time_rounded,
                        'Time',
                        '${_formatTime(_appointment?.startsAt)} - ${_formatTime(_appointment?.endsAt)}',
                      ),
                      if (_appointment != null) ...[
                        const SizedBox(height: DesignTokens.spaceSm),
                        _buildInfoRow(
                          Icons.hourglass_bottom_outlined,
                          'Duration',
                          _durationLabel(
                            DateTime.parse(_appointment!.endsAt)
                                .difference(
                                    DateTime.parse(_appointment!.startsAt))
                                .inSeconds,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),

                // Preparation guidance.
                const Text(
                  'Before you join',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceMd),
                _buildGuidanceTile(
                  Icons.wifi_rounded,
                  'Check your internet connection',
                ),
                _buildGuidanceTile(
                  Icons.mic_rounded,
                  'Allow microphone access',
                ),
                _buildGuidanceTile(
                  Icons.videocam_rounded,
                  'Allow camera access',
                ),
                _buildGuidanceTile(
                  Icons.access_time_filled_rounded,
                  'Join a few minutes early',
                ),
                _buildGuidanceTile(
                  Icons.volume_off_rounded,
                  'Find a quiet, private place',
                ),
                const SizedBox(height: DesignTokens.spaceLg),

                // Privacy note.
                Container(
                  padding: const EdgeInsets.all(DesignTokens.spaceMd),
                  decoration: BoxDecoration(
                    color: AppColors.gray100,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  child: const Row(
                    children: [
                      Icon(
                        Icons.info_outline_rounded,
                        size: 18,
                        color: AppColors.textSecondary,
                      ),
                      SizedBox(width: DesignTokens.spaceMd),
                      Expanded(
                        child: Text(
                          'Your consultation uses an authenticated video connection managed by SmartCura.',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 12,
                            color: AppColors.textSecondary,
                            height: 1.4,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
              ],
            ),
          ),
          // CTA area.
          Container(
            padding: EdgeInsets.fromLTRB(
              DesignTokens.spaceMd,
              DesignTokens.spaceMd,
              DesignTokens.spaceMd,
              MediaQuery.of(context).padding.bottom + DesignTokens.spaceMd,
            ),
            decoration: BoxDecoration(
              color: AppColors.surface,
              border: Border(top: BorderSide(color: AppColors.border)),
            ),
            child: Column(
              children: [
                SizedBox(
                  width: double.infinity,
                  height: DesignTokens.buttonHeightLg,
                  child: ElevatedButton.icon(
                    onPressed: joinable ? _onJoinPressed : null,
                    icon: const Icon(Icons.videocam_rounded),
                    label: const Text(
                      'Join Consultation',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: AppColors.white,
                      disabledBackgroundColor: AppColors.gray200,
                      disabledForegroundColor: AppColors.gray400,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusLg),
                      ),
                    ),
                  ),
                ),
                if (!joinable) ...[
                  const SizedBox(height: DesignTokens.spaceSm),
                  Text(
                    'This appointment is not ready to join yet.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 13,
                      color: AppColors.textSecondary.withValues(alpha: 0.8),
                    ),
                  ),
                ],
                const SizedBox(height: DesignTokens.spaceMd),
                SizedBox(
                  width: double.infinity,
                  height: DesignTokens.buttonHeightMd,
                  child: TextButton(
                    onPressed: () => context.push('/help-support'),
                    child: const Text(
                      'Need help?',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 15,
                        fontWeight: FontWeight.w600,
                        color: AppColors.primary,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLightAppBar({required bool showBack}) {
    return Container(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceSm,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
      ),
      child: Row(
        children: [
          if (showBack)
            IconButton(
              onPressed: () => context.pop(),
              icon: const Icon(Icons.arrow_back_rounded),
              tooltip: 'Go back',
            )
          else
            const SizedBox(width: 48),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.center,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  'Dr. $_doctorName',
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                  overflow: TextOverflow.ellipsis,
                ),
                if (_displaySpecialty.isNotEmpty)
                  Text(
                    _displaySpecialty,
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 12,
                      color: AppColors.textSecondary,
                    ),
                  ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => _showOptionsMenu(),
            icon: const Icon(Icons.more_vert_rounded),
            tooltip: 'More options',
          ),
        ],
      ),
    );
  }

  void _showOptionsMenu() {
    showModalBottomSheet<void>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.help_outline_rounded),
              title: const Text('Need help?'),
              onTap: () {
                Navigator.pop(context);
                context.push('/help-support');
              },
            ),
            ListTile(
              leading: const Icon(Icons.report_problem_outlined),
              title: const Text('Report a problem'),
              onTap: () {
                Navigator.pop(context);
                context.push('/help-support');
              },
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(IconData icon, String label, String value) {
    return Row(
      children: [
        Icon(
          icon,
          size: 18,
          color: AppColors.textSecondary,
        ),
        const SizedBox(width: DesignTokens.spaceMd),
        Expanded(
          child: Text(
            label,
            style: const TextStyle(
              fontFamily: 'Manrope',
              fontSize: 13,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            fontFamily: 'Manrope',
            fontSize: 13,
            fontWeight: FontWeight.w600,
            color: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }

  Widget _buildGuidanceTile(IconData icon, String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon,
              size: 18,
              color: AppColors.primary,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Text(
              text,
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontSize: 14,
                color: AppColors.textPrimary,
              ),
            ),
          ),
          const Icon(
            Icons.check_circle_rounded,
            size: 18,
            color: AppColors.success,
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Checking permissions
  // ---------------------------------------------------------------------------

  Widget _buildCheckingPermissions() {
    return SafeArea(
      child: Column(
        children: [
          _buildLightAppBar(showBack: true),
          Expanded(
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(color: AppColors.primary),
                  const SizedBox(height: DesignTokens.spaceLg),
                  const Text(
                    'Checking microphone and camera...',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Permission denied
  // ---------------------------------------------------------------------------

  Widget _buildPermissionDenied() {
    final isMic = _phase == _CallPhase.micPermissionDenied;
    final isBoth = _deniedPermission == _PermissionKind.both;
    final title = isBoth
        ? 'Microphone & Camera Access Needed'
        : isMic
            ? 'Microphone Access Needed'
            : 'Camera Access Needed';
    final body = isBoth
        ? 'We need access to your microphone and camera so the doctor can see and hear you during the consultation.'
        : isMic
            ? 'We need access to your microphone so the doctor can hear you.'
            : 'We need access to your camera so the doctor can see you.';
    final icon = isMic ? Icons.mic_off_rounded : Icons.videocam_off_rounded;
    final iconColor = isMic ? AppColors.error : AppColors.warning;

    return SafeArea(
      child: Column(
        children: [
          _buildLightAppBar(showBack: true),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              child: Column(
                children: [
                  const Spacer(flex: 2),
                  Container(
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(
                      color: iconColor.withValues(alpha: 0.1),
                      shape: BoxShape.circle,
                    ),
                    child: Icon(
                      icon,
                      size: 48,
                      color: iconColor,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),
                  Text(
                    title,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 22,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  Text(
                    body,
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 14,
                      color: AppColors.textSecondary,
                      height: 1.5,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXl),
                  Container(
                    padding: const EdgeInsets.all(DesignTokens.spaceMd),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'How to enable',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceMd),
                        _buildStepRow(1, 'Go to Settings'),
                        _buildStepRow(2, 'Tap Privacy'),
                        if (isMic || isBoth) _buildStepRow(3, 'Tap Microphone'),
                        if (!isMic && !isBoth) _buildStepRow(3, 'Tap Camera'),
                        _buildStepRow(
                          isMic || isBoth ? 4 : 4,
                          'Enable SmartCura',
                          isLast: true,
                        ),
                      ],
                    ),
                  ),
                  const Spacer(flex: 3),
                  SizedBox(
                    width: double.infinity,
                    height: DesignTokens.buttonHeightLg,
                    child: ElevatedButton(
                      onPressed: _openAppSettings,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: AppColors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusLg),
                        ),
                      ),
                      child: const Text(
                        'Open Settings',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  SizedBox(
                    width: double.infinity,
                    height: DesignTokens.buttonHeightLg,
                    child: TextButton(
                      onPressed: _retryAfterPermission,
                      child: const Text(
                        'I\'ll do it later',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStepRow(int step, String text, {bool isLast = false}) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 24,
          height: 24,
          decoration: BoxDecoration(
            color: AppColors.primaryContainer,
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              '$step',
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontSize: 12,
                fontWeight: FontWeight.w700,
                color: AppColors.primary,
              ),
            ),
          ),
        ),
        const SizedBox(width: DesignTokens.spaceMd),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                text,
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  color: AppColors.textPrimary,
                ),
              ),
              if (!isLast)
                Container(
                  margin: const EdgeInsets.only(
                    left: 11,
                    top: 4,
                    bottom: 4,
                  ),
                  width: 2,
                  height: 16,
                  color: AppColors.border,
                ),
            ],
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Waiting-for-doctor phase
  // ---------------------------------------------------------------------------

  Widget _buildWaiting() {
    return Container(
      color: AppColors.background,
      child: SafeArea(
        child: Column(
          children: [
            _buildLightAppBar(showBack: true),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                child: Column(
                  children: [
                    const Spacer(flex: 2),
                    _buildPulseAvatar(),
                    const SizedBox(height: DesignTokens.spaceXl),
                    Text(
                      'Waiting for the doctor to join...',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceSm),
                    Text(
                      'Your appointment is at ${_formatTime(_appointment?.startsAt)}.',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 14,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                    Text(
                      'Please stay on this screen. You\'ll be connected automatically when the doctor joins.',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 13,
                        color: AppColors.textSecondary.withValues(alpha: 0.8),
                        height: 1.5,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                    Container(
                      padding: const EdgeInsets.all(DesignTokens.spaceMd),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusLg),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Your appointment',
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.textPrimary,
                            ),
                          ),
                          const SizedBox(height: DesignTokens.spaceMd),
                          _buildInfoRow(
                            Icons.person_outline_rounded,
                            'Doctor',
                            'Dr. $_doctorName',
                          ),
                          const SizedBox(height: DesignTokens.spaceSm),
                          _buildInfoRow(
                            Icons.calendar_today_outlined,
                            'Date',
                            _formatDate(_appointment?.startsAt),
                          ),
                          const SizedBox(height: DesignTokens.spaceSm),
                          _buildInfoRow(
                            Icons.videocam_outlined,
                            'Type',
                            'Video Consultation',
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                    Container(
                      padding: const EdgeInsets.all(DesignTokens.spaceMd),
                      decoration: BoxDecoration(
                        color: AppColors.successContainer,
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusLg),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.verified_user_outlined,
                            color: AppColors.success,
                            size: 20,
                          ),
                          const SizedBox(width: DesignTokens.spaceMd),
                          Expanded(
                            child: Text(
                              'Please keep this screen open. You will be connected automatically.',
                              style: TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 13,
                                color: AppColors.successDark
                                    .withValues(alpha: 0.9),
                                height: 1.4,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Spacer(flex: 3),
                    SizedBox(
                      width: double.infinity,
                      height: DesignTokens.buttonHeightLg,
                      child: OutlinedButton(
                        onPressed: () {
                          _pollTimer?.cancel();
                          _cleanupRoom();
                          context.pop();
                        },
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.textPrimary,
                          side: BorderSide(color: AppColors.borderDark),
                          shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusLg),
                          ),
                        ),
                        child: const Text(
                          'Cancel',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
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

  Widget _buildPulseAvatar() {
    return SizedBox(
      width: 220,
      height: 220,
      child: Stack(
        alignment: Alignment.center,
        children: [
          ...List.generate(3, (index) {
            return AnimatedBuilder(
              animation: _pulseController,
              builder: (context, child) {
                final delay = index * 0.33;
                final progress = (_pulseController.value + delay) % 1.0;
                final scale = 1.0 + (progress * 0.6);
                final opacity = 0.25 * (1.0 - progress);
                return Transform.scale(
                  scale: scale,
                  child: Container(
                    width: 140,
                    height: 140,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      border: Border.all(
                        color: AppColors.primary.withValues(alpha: opacity),
                        width: 2,
                      ),
                    ),
                  ),
                );
              },
            );
          }),
          Container(
            width: 120,
            height: 120,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [AppColors.primary, AppColors.primaryLight],
              ),
            ),
            child: Center(
              child: Text(
                _initials(_doctorName),
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 40,
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
  // Connecting phase
  // ---------------------------------------------------------------------------

  Widget _buildConnecting() {
    return Container(
      color: AppColors.background,
      child: SafeArea(
        child: Column(
          children: [
            _buildLightAppBar(showBack: true),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                child: Column(
                  children: [
                    const Spacer(flex: 2),
                    SizedBox(
                      width: 120,
                      height: 120,
                      child: CircularProgressIndicator(
                        strokeWidth: 4,
                        color: AppColors.primary,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceXl),
                    const Text(
                      'Connecting securely...',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                    Text(
                      'Establishing your consultation connection',
                      textAlign: TextAlign.center,
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 14,
                        color: AppColors.textSecondary.withValues(alpha: 0.8),
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                    Container(
                      padding: const EdgeInsets.all(DesignTokens.spaceMd),
                      decoration: BoxDecoration(
                        color: AppColors.primaryContainer,
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusLg),
                      ),
                      child: Row(
                        children: [
                          const Icon(
                            Icons.lock_outline_rounded,
                            color: AppColors.primary,
                            size: 20,
                          ),
                          const SizedBox(width: DesignTokens.spaceMd),
                          Expanded(
                            child: Text(
                              'Please do not leave this screen. This may take a few seconds.',
                              style: TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 13,
                                color: AppColors.primaryOnContainer
                                    .withValues(alpha: 0.9),
                                height: 1.4,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Spacer(flex: 3),
                    SizedBox(
                      width: double.infinity,
                      height: DesignTokens.buttonHeightLg,
                      child: OutlinedButton(
                        onPressed: () {
                          _connectAttemptInProgress = false;
                          _cleanupRoom();
                          if (mounted)
                            setState(() => _phase = _CallPhase.preJoin);
                        },
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.textPrimary,
                          side: BorderSide(color: AppColors.borderDark),
                          shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusLg),
                          ),
                        ),
                        child: const Text(
                          'Cancel',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
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

  // ---------------------------------------------------------------------------
  // Active call UI
  // ---------------------------------------------------------------------------

  Widget _buildCallUI() {
    return Stack(
      children: [
        // Remote video.
        Positioned.fill(child: _buildRemoteVideo()),

        // Top gradient overlay.
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          height: 160,
          child: IgnorePointer(
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    AppColors.black.withValues(alpha: 0.6),
                    AppColors.black.withValues(alpha: 0.0),
                  ],
                ),
              ),
            ),
          ),
        ),

        // Top status bar.
        Positioned(
          top: 0,
          left: 0,
          right: 0,
          child: SafeArea(
            bottom: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceSm,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
              ),
              child: _buildTopBar(),
            ),
          ),
        ),

        // Local camera PIP.
        Positioned(
          right: _pipRight,
          top: _pipTop + MediaQuery.of(context).padding.top,
          child: Draggable(
            feedback: _buildPipContainer(isDragging: true),
            childWhenDragging: const SizedBox.shrink(),
            onDragEnd: (details) {
              setState(() {
                final screenWidth = MediaQuery.of(context).size.width;
                final screenHeight = MediaQuery.of(context).size.height;
                const pipWidth = 120.0;
                const pipHeight = 180.0;
                const padding = 16.0;

                _pipRight = (screenWidth - details.offset.dx - pipWidth)
                    .clamp(padding, screenWidth - pipWidth - padding);
                _pipTop =
                    (details.offset.dy - MediaQuery.of(context).padding.top)
                        .clamp(padding, screenHeight - pipHeight - 220);
              });
            },
            child: _buildPipContainer(),
          ),
        ),

        // Bottom gradient overlay.
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          height: 260,
          child: IgnorePointer(
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [
                    AppColors.black.withValues(alpha: 0.0),
                    AppColors.black.withValues(alpha: 0.8),
                  ],
                ),
              ),
            ),
          ),
        ),

        // Bottom controls and actions.
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          child: SafeArea(
            top: false,
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                DesignTokens.spaceLg,
                DesignTokens.spaceMd,
                DesignTokens.spaceLg,
                MediaQuery.of(context).padding.bottom + DesignTokens.spaceMd,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  _buildControls(),
                  const SizedBox(height: DesignTokens.spaceMd),
                  _buildEndCallButton(),
                  const SizedBox(height: DesignTokens.spaceMd),
                  _buildBottomActions(),
                ],
              ),
            ),
          ),
        ),

        // Overlays.
        if (_phase == _CallPhase.poorConnection) _buildPoorConnectionOverlay(),
        if (_phase == _CallPhase.doctorDisconnected)
          _buildDoctorDisconnectedOverlay(),
        if (_phase == _CallPhase.patientDisconnected)
          _buildPatientDisconnectedOverlay(),
        if (_isChatOpen) _buildChatOverlay(),
        if (_isHealthPanelOpen) _buildHealthOverlay(),
        if (_isAppointmentPanelOpen) _buildAppointmentOverlay(),
        if (_isMoreMenuOpen) _buildMoreMenuOverlay(),
      ],
    );
  }

  Widget _buildTopBar() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Row(
            children: [
              AvatarWidget(
                imageUrl: _doctorImageUrl,
                name: _doctorName,
                size: 40,
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Dr. $_doctorName',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 16,
                        fontWeight: FontWeight.w700,
                        color: AppColors.white,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: _phase == _CallPhase.connected
                                ? AppColors.success
                                : AppColors.warning,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            _phase == _CallPhase.connected
                                ? 'Connected'
                                : _connectionStatusText(),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontSize: 12,
                              fontWeight: FontWeight.w600,
                              color: AppColors.white.withValues(alpha: 0.9),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: DesignTokens.spaceMd),
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceSm,
            vertical: 6,
          ),
          decoration: BoxDecoration(
            color: AppColors.black.withValues(alpha: 0.3),
            borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            border: Border.all(
              color: AppColors.white.withValues(alpha: 0.1),
            ),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                Icons.fiber_manual_record,
                color: _connectionQualityColor(),
                size: 8,
              ),
              const SizedBox(width: 4),
              Text(
                _formatDuration(_seconds),
                style: const TextStyle(
                  fontFamily: 'Manrope',
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.white,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _connectionStatusText() {
    switch (_phase) {
      case _CallPhase.poorConnection:
        return 'Poor connection';
      case _CallPhase.doctorDisconnected:
        return 'Doctor disconnected';
      case _CallPhase.patientDisconnected:
        return 'Reconnecting';
      case _CallPhase.doctorNotConnected:
        return 'Waiting';
      default:
        return 'Connecting';
    }
  }

  Widget _buildRemoteVideo() {
    if (_remoteVideoTrack != null &&
        _remoteVideoTrack!.track != null &&
        _isRemoteVideoEnabled) {
      final videoTrack = _remoteVideoTrack!.track as VideoTrack;
      return VideoTrackRenderer(
        videoTrack,
        fit: VideoViewFit.contain,
      );
    }

    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [AppColors.gray900, AppColors.gray800, AppColors.gray900],
        ),
      ),
      child: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AvatarWidget(
              imageUrl: _doctorImageUrl,
              name: _doctorName,
              size: 120,
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            Text(
              'Dr. $_doctorName',
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontSize: 20,
                fontWeight: FontWeight.w700,
                color: AppColors.white,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              _isRemoteConnected
                  ? 'Camera is off'
                  : 'Waiting for the doctor to join...',
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 14,
                color: AppColors.white.withValues(alpha: 0.6),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPipContainer({bool isDragging = false}) {
    return Container(
      width: 120,
      height: 180,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(
          color: isDragging
              ? AppColors.primaryLight.withValues(alpha: 0.8)
              : AppColors.white.withValues(alpha: 0.25),
          width: isDragging ? 3 : 2,
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: isDragging ? 0.7 : 0.5),
            blurRadius: isDragging ? 30 : 20,
            offset: Offset(0, isDragging ? 15 : 10),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(14),
        child: Stack(
          children: [
            if (_isCameraOn && _localVideoTrack != null)
              VideoTrackRenderer(
                _localVideoTrack!.track as VideoTrack,
                fit: VideoViewFit.cover,
                mirrorMode: VideoViewMirrorMode.mirror,
              )
            else
              Container(
                color: AppColors.gray900,
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(
                      Icons.videocam_off_rounded,
                      color: AppColors.white.withValues(alpha: 0.5),
                      size: 32,
                    ),
                    const SizedBox(height: DesignTokens.spaceSm),
                    Text(
                      'Camera Off',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppColors.white.withValues(alpha: 0.5),
                      ),
                    ),
                  ],
                ),
              ),
            if (!isDragging)
              Positioned(
                top: 8,
                left: 0,
                right: 0,
                child: Center(
                  child: Container(
                    width: 30,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.white.withValues(alpha: 0.4),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
              ),
            if (_isMuted)
              Positioned(
                bottom: 8,
                right: 8,
                child: Container(
                  padding: const EdgeInsets.all(6),
                  decoration: BoxDecoration(
                    color: AppColors.black.withValues(alpha: 0.7),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.mic_off_rounded,
                    size: 14,
                    color: AppColors.white,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildControls() {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceEvenly,
      children: [
        _buildControlButton(
          icon: _isMuted ? Icons.mic_off_rounded : Icons.mic_rounded,
          label: _isMuted ? 'Unmute' : 'Mute',
          onPressed: _toggleMute,
          isActive: !_isMuted,
          semanticLabel: _isMuted ? 'Unmute microphone' : 'Mute microphone',
        ),
        _buildControlButton(
          icon:
              _isCameraOn ? Icons.videocam_rounded : Icons.videocam_off_rounded,
          label: _isCameraOn ? 'Camera' : 'Camera Off',
          onPressed: _toggleCamera,
          isActive: _isCameraOn,
          semanticLabel: _isCameraOn ? 'Turn camera off' : 'Turn camera on',
        ),
        _buildControlButton(
          icon:
              _isSpeakerOn ? Icons.volume_up_rounded : Icons.volume_off_rounded,
          label: 'Speaker',
          onPressed: _toggleSpeaker,
          isActive: _isSpeakerOn,
          semanticLabel: _isSpeakerOn ? 'Turn speaker off' : 'Turn speaker on',
        ),
        _buildControlButton(
          icon: Icons.more_vert_rounded,
          label: 'More',
          onPressed: _openMoreMenu,
          isActive: true,
          semanticLabel: 'Open more actions',
        ),
      ],
    );
  }

  Widget _buildEndCallButton() {
    return Semantics(
      label: 'End consultation',
      button: true,
      child: GestureDetector(
        onTap: _showEndCallDialog,
        child: Container(
          width: 64,
          height: 64,
          decoration: const BoxDecoration(
            color: AppColors.error,
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: Color(0x66EF4444),
                blurRadius: 20,
                spreadRadius: 2,
                offset: Offset(0, 8),
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
    );
  }

  Widget _buildControlButton({
    required IconData icon,
    required String label,
    required VoidCallback onPressed,
    required bool isActive,
    required String semanticLabel,
  }) {
    final buttonColor = isActive
        ? AppColors.white.withValues(alpha: 0.18)
        : AppColors.error.withValues(alpha: 0.35);
    final iconColor = isActive ? AppColors.white : AppColors.errorLight;

    return Semantics(
      label: semanticLabel,
      button: true,
      child: GestureDetector(
        onTap: onPressed,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 56,
              height: 56,
              decoration: BoxDecoration(
                color: buttonColor,
                shape: BoxShape.circle,
                border: Border.all(
                  color: AppColors.white.withValues(alpha: 0.1),
                  width: 1,
                ),
              ),
              child: Icon(icon, color: iconColor, size: 24),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              label,
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.white.withValues(alpha: 0.9),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBottomActions() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceSm),
      decoration: BoxDecoration(
        color: AppColors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(
          color: AppColors.white.withValues(alpha: 0.1),
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildBottomAction(
            icon: Icons.favorite_border_rounded,
            label: 'Share Vitals',
            onTap: _openVitalsSheet,
            semanticLabel: 'Share health readings',
          ),
          _buildBottomAction(
            icon: Icons.health_and_safety_outlined,
            label: 'View Health',
            onTap: _openHealthPanel,
            semanticLabel: 'View health information',
          ),
          _buildBottomAction(
            icon: Icons.calendar_today_outlined,
            label: 'Appointment',
            onTap: _openAppointmentPanel,
            semanticLabel: 'View appointment details',
          ),
          _buildBottomAction(
            icon: Icons.chat_bubble_outline_rounded,
            label: 'Chat',
            onTap: _toggleChat,
            isActive: _isChatOpen,
            semanticLabel: 'Open chat',
          ),
        ],
      ),
    );
  }

  Widget _buildBottomAction({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
    required String semanticLabel,
    bool isActive = false,
  }) {
    return Semantics(
      label: semanticLabel,
      button: true,
      child: GestureDetector(
        onTap: onTap,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              color: isActive ? AppColors.primary : AppColors.white,
              size: 22,
            ),
            const SizedBox(height: 4),
            Text(
              label,
              style: TextStyle(
                fontFamily: 'Manrope',
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: isActive
                    ? AppColors.primary
                    : AppColors.white.withValues(alpha: 0.9),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Overlays
  // ---------------------------------------------------------------------------

  Widget _buildPoorConnectionOverlay() {
    return Positioned(
      top: 100 + MediaQuery.of(context).padding.top,
      left: DesignTokens.spaceMd,
      right: DesignTokens.spaceMd,
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.warning.withValues(alpha: 0.9),
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        ),
        child: Row(
          children: [
            const Icon(
              Icons.signal_cellular_connected_no_internet_4_bar_rounded,
              color: AppColors.white,
              size: 22,
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Poor connection',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.white,
                    ),
                  ),
                  Text(
                    'Trying to improve your connection...',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 12,
                      color: AppColors.white.withValues(alpha: 0.9),
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

  Widget _buildDoctorDisconnectedOverlay() {
    return Container(
      color: AppColors.black.withValues(alpha: 0.6),
      child: SafeArea(
        child: Center(
          child: Container(
            margin: const EdgeInsets.all(DesignTokens.spaceLg),
            padding: const EdgeInsets.all(DesignTokens.spaceXl),
            decoration: BoxDecoration(
              color: AppColors.gray900.withValues(alpha: 0.95),
              borderRadius: BorderRadius.circular(DesignTokens.radius2xl),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    color: AppColors.warning.withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.wifi_tethering_error_rounded,
                    color: AppColors.warning,
                    size: 36,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                const Text(
                  'Doctor disconnected',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: AppColors.white,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                Text(
                  'Trying to reconnect...',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 14,
                    color: AppColors.white.withValues(alpha: 0.7),
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                Text(
                  _formatDuration(_seconds),
                  style: const TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: AppColors.white,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildPatientDisconnectedOverlay() {
    return Container(
      color: AppColors.black.withValues(alpha: 0.6),
      child: SafeArea(
        child: Center(
          child: Container(
            margin: const EdgeInsets.all(DesignTokens.spaceLg),
            padding: const EdgeInsets.all(DesignTokens.spaceXl),
            decoration: BoxDecoration(
              color: AppColors.gray900.withValues(alpha: 0.95),
              borderRadius: BorderRadius.circular(DesignTokens.radius2xl),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 72,
                  height: 72,
                  decoration: BoxDecoration(
                    color: AppColors.warning.withValues(alpha: 0.15),
                    shape: BoxShape.circle,
                  ),
                  child: const Icon(
                    Icons.cloud_off_rounded,
                    color: AppColors.warning,
                    size: 36,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                const Text(
                  'Connection lost',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 20,
                    fontWeight: FontWeight.w700,
                    color: AppColors.white,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                Text(
                  'Trying to reconnect...',
                  style: TextStyle(
                    fontFamily: 'Manrope',
                    fontSize: 14,
                    color: AppColors.white.withValues(alpha: 0.7),
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                SizedBox(
                  width: double.infinity,
                  height: DesignTokens.buttonHeightMd,
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
                    child: const Text(
                      'Reconnect Now',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildChatOverlay() {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: VideoConsultationChatPanel(
        consultationId: _consultation?.consultationId ?? widget.appointmentId,
        doctorName: _doctorName,
        doctorImageUrl: _doctorImageUrl,
        patientName: _patientProfile?.displayName ?? 'You',
        onClose: _closeChat,
      ),
    );
  }

  Widget _buildHealthOverlay() {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: Container(
        height: MediaQuery.of(context).size.height * 0.55,
        decoration: const BoxDecoration(
          color: AppColors.gray900,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(DesignTokens.radius2xl),
            topRight: Radius.circular(DesignTokens.radius2xl),
          ),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                decoration: BoxDecoration(
                  color: AppColors.gray800.withValues(alpha: 0.5),
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(DesignTokens.radius2xl),
                    topRight: Radius.circular(DesignTokens.radius2xl),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.health_and_safety_outlined,
                        color: AppColors.white),
                    const SizedBox(width: DesignTokens.spaceMd),
                    const Expanded(
                      child: Text(
                        'Your Health',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppColors.white,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () =>
                          setState(() => _isHealthPanelOpen = false),
                      icon: const Icon(Icons.close, color: AppColors.white),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Consumer(
                  builder: (context, ref, child) {
                    final vitalsAsync = ref.watch(vitalReadingsProvider);
                    return vitalsAsync.when(
                      loading: () => const Center(
                        child:
                            CircularProgressIndicator(color: AppColors.primary),
                      ),
                      error: (error, _) => Center(
                        child: Text(
                          'Could not load health data.',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            color: AppColors.gray400,
                          ),
                        ),
                      ),
                      data: (readings) => readings.isEmpty
                          ? Center(
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Icon(
                                    Icons.monitor_heart_outlined,
                                    size: 48,
                                    color: AppColors.gray400,
                                  ),
                                  const SizedBox(height: DesignTokens.spaceMd),
                                  const Text(
                                    'No health data available',
                                    style: TextStyle(
                                      fontFamily: 'Manrope',
                                      color: AppColors.gray400,
                                    ),
                                  ),
                                ],
                              ),
                            )
                          : ListView.builder(
                              padding:
                                  const EdgeInsets.all(DesignTokens.spaceMd),
                              itemCount: readings.length,
                              itemBuilder: (context, index) {
                                final reading = readings[index];
                                return Container(
                                  margin: const EdgeInsets.only(
                                      bottom: DesignTokens.spaceMd),
                                  padding: const EdgeInsets.all(
                                      DesignTokens.spaceMd),
                                  decoration: BoxDecoration(
                                    color: AppColors.gray800,
                                    borderRadius: BorderRadius.circular(
                                        DesignTokens.radiusMd),
                                  ),
                                  child: Row(
                                    children: [
                                      Icon(
                                        Icons.favorite_rounded,
                                        color: _metricColor(reading.metric),
                                      ),
                                      const SizedBox(
                                          width: DesignTokens.spaceMd),
                                      Expanded(
                                        child: Column(
                                          crossAxisAlignment:
                                              CrossAxisAlignment.start,
                                          children: [
                                            Text(
                                              _metricLabel(reading.metric),
                                              style: const TextStyle(
                                                fontFamily: 'Manrope',
                                                color: AppColors.white,
                                                fontWeight: FontWeight.w600,
                                              ),
                                            ),
                                            Text(
                                              DateFormat('MMM d, h:mm a')
                                                  .format(
                                                DateTime.parse(
                                                        reading.recordedAt)
                                                    .toLocal(),
                                              ),
                                              style: const TextStyle(
                                                fontFamily: 'Manrope',
                                                color: AppColors.gray400,
                                                fontSize: 12,
                                              ),
                                            ),
                                          ],
                                        ),
                                      ),
                                      Text(
                                        '${reading.value} ${reading.unit}',
                                        style: TextStyle(
                                          fontFamily: 'Manrope',
                                          color: _metricColor(reading.metric),
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ],
                                  ),
                                );
                              },
                            ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Color _metricColor(VitalMetric metric) {
    switch (metric) {
      case VitalMetric.heartRate:
        return AppColors.heartRate;
      case VitalMetric.oxygenSaturation:
        return AppColors.oxygen;
      case VitalMetric.bodyTemperature:
        return AppColors.temperature;
      case VitalMetric.systolicBp:
      case VitalMetric.diastolicBp:
      case VitalMetric.bloodPressure:
        return AppColors.bloodPressure;
      case VitalMetric.bloodGlucose:
        return AppColors.glucose;
      case VitalMetric.bodyWeight:
        return AppColors.secondary;
      case VitalMetric.respiratoryRate:
        return AppColors.primary;
      case VitalMetric.ecgVoltage:
        return AppColors.emergency;
      case VitalMetric.unknown:
        return AppColors.gray500;
    }
  }

  Widget _buildAppointmentOverlay() {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      child: Container(
        height: MediaQuery.of(context).size.height * 0.45,
        decoration: const BoxDecoration(
          color: AppColors.gray900,
          borderRadius: BorderRadius.only(
            topLeft: Radius.circular(DesignTokens.radius2xl),
            topRight: Radius.circular(DesignTokens.radius2xl),
          ),
        ),
        child: SafeArea(
          top: false,
          child: Column(
            children: [
              Container(
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                decoration: BoxDecoration(
                  color: AppColors.gray800.withValues(alpha: 0.5),
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(DesignTokens.radius2xl),
                    topRight: Radius.circular(DesignTokens.radius2xl),
                  ),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.calendar_today_outlined,
                        color: AppColors.white),
                    const SizedBox(width: DesignTokens.spaceMd),
                    const Expanded(
                      child: Text(
                        'Appointment Details',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                          color: AppColors.white,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: () =>
                          setState(() => _isAppointmentPanelOpen = false),
                      icon: const Icon(Icons.close, color: AppColors.white),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(DesignTokens.spaceMd),
                  child: Column(
                    children: [
                      _buildDarkInfoRow(Icons.person_outline_rounded, 'Doctor',
                          'Dr. $_doctorName'),
                      _buildDarkInfoRow(Icons.medical_services_outlined,
                          'Specialty', _displaySpecialty),
                      _buildDarkInfoRow(Icons.calendar_today_outlined, 'Date',
                          _formatDate(_appointment?.startsAt)),
                      _buildDarkInfoRow(Icons.access_time_rounded, 'Time',
                          '${_formatTime(_appointment?.startsAt)} - ${_formatTime(_appointment?.endsAt)}'),
                      _buildDarkInfoRow(
                        Icons.info_outline_rounded,
                        'Status',
                        _appointment?.status.name ?? '—',
                      ),
                      _buildDarkInfoRow(
                        Icons.videocam_outlined,
                        'Type',
                        'Video Consultation',
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildDarkInfoRow(IconData icon, String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.gray400),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Text(
              label,
              style: const TextStyle(
                fontFamily: 'Manrope',
                fontSize: 13,
                color: AppColors.gray400,
              ),
            ),
          ),
          Text(
            value,
            style: const TextStyle(
              fontFamily: 'Manrope',
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.white,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMoreMenuOverlay() {
    return Positioned(
      bottom: 180,
      left: 0,
      right: 0,
      child: Center(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceLg),
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: AppColors.gray900.withValues(alpha: 0.95),
            borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
            border: Border.all(
              color: AppColors.white.withValues(alpha: 0.1),
            ),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildMoreMenuItem(
                icon: Icons.favorite_border_rounded,
                label: 'Share Vitals',
                onTap: () {
                  _closeAllPanels();
                  _openVitalsSheet();
                },
              ),
              _buildMoreMenuItem(
                icon: Icons.health_and_safety_outlined,
                label: 'View Health',
                onTap: () {
                  _closeAllPanels();
                  _openHealthPanel();
                },
              ),
              _buildMoreMenuItem(
                icon: Icons.calendar_today_outlined,
                label: 'View Appointment',
                onTap: () {
                  _closeAllPanels();
                  _openAppointmentPanel();
                },
              ),
              _buildMoreMenuItem(
                icon: Icons.chat_bubble_outline_rounded,
                label: 'Chat',
                onTap: () {
                  _closeAllPanels();
                  _toggleChat();
                },
              ),
              _buildMoreMenuItem(
                icon: Icons.report_problem_outlined,
                label: 'Report a problem',
                onTap: () {
                  _closeAllPanels();
                  context.push('/help-support');
                },
              ),
              const Divider(color: AppColors.gray700),
              _buildMoreMenuItem(
                icon: Icons.close_rounded,
                label: 'Close menu',
                onTap: _closeAllPanels,
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMoreMenuItem({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return ListTile(
      leading: Icon(icon, color: AppColors.white, size: 22),
      title: Text(
        label,
        style: const TextStyle(
          fontFamily: 'Manrope',
          color: AppColors.white,
          fontSize: 14,
        ),
      ),
      onTap: onTap,
      dense: true,
    );
  }

  // ---------------------------------------------------------------------------
  // Ended phase
  // ---------------------------------------------------------------------------

  Widget _buildEnded() {
    final hasPrescription = _consultationPrescriptions.isNotEmpty;

    return Container(
      color: AppColors.background,
      child: SafeArea(
        child: Column(
          children: [
            _buildLightAppBar(showBack: false),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                children: [
                  const SizedBox(height: DesignTokens.spaceLg),
                  Center(
                    child: Container(
                      width: 88,
                      height: 88,
                      decoration: BoxDecoration(
                        color: AppColors.successContainer,
                        shape: BoxShape.circle,
                      ),
                      child: const Icon(
                        Icons.check_circle_rounded,
                        size: 48,
                        color: AppColors.success,
                      ),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),
                  const Center(
                    child: Text(
                      'Consultation Ended',
                      style: TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceSm),
                  Center(
                    child: Text(
                      'Thank you for consulting with Dr. $_doctorName',
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 14,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXl),

                  // Summary card.
                  Container(
                    padding: const EdgeInsets.all(DesignTokens.spaceMd),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.shadow,
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        ),
                      ],
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Consultation Summary',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceMd),
                        _buildInfoRow(
                          Icons.hourglass_bottom_outlined,
                          'Duration',
                          _durationLabel(_seconds),
                        ),
                        const SizedBox(height: DesignTokens.spaceSm),
                        _buildInfoRow(
                          Icons.play_circle_outline_rounded,
                          'Start Time',
                          _callStartedAt != null
                              ? DateFormat('h:mm a').format(_callStartedAt!)
                              : '—',
                        ),
                        const SizedBox(height: DesignTokens.spaceSm),
                        _buildInfoRow(
                          Icons.stop_circle_outlined,
                          'End Time',
                          _callEndedAt != null
                              ? DateFormat('h:mm a').format(_callEndedAt!)
                              : '—',
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),

                  // What's next.
                  const Text(
                    'What\'s next?',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  if (hasPrescription)
                    _buildActionTile(
                      icon: Icons.description_outlined,
                      title: 'View prescription',
                      subtitle: '${_consultationPrescriptions.length} issued',
                      onTap: () => context.push(
                        '/prescriptions/${_consultationPrescriptions.first.prescriptionId}',
                      ),
                    ),
                  _buildActionTile(
                    icon: Icons.calendar_today_outlined,
                    title: 'View appointment details',
                    onTap: () => context.push(
                      '/appointment-details',
                      extra: widget.appointmentId,
                    ),
                  ),
                  _buildActionTile(
                    icon: Icons.rate_review_outlined,
                    title: 'Provide feedback',
                    onTap: () => context.push(
                      '/appointment-details',
                      extra: widget.appointmentId,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),
                ],
              ),
            ),
            Container(
              padding: EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                MediaQuery.of(context).padding.bottom + DesignTokens.spaceMd,
              ),
              decoration: BoxDecoration(
                color: AppColors.surface,
                border: Border(top: BorderSide(color: AppColors.border)),
              ),
              child: SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightLg,
                child: ElevatedButton(
                  onPressed: () => context.go('/home'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                    ),
                  ),
                  child: const Text(
                    'Back to Home',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 16,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildActionTile({
    required IconData icon,
    required String title,
    String? subtitle,
    required VoidCallback onTap,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        child: Container(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(color: AppColors.border),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: AppColors.primary, size: 20),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    if (subtitle != null)
                      Text(
                        subtitle,
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 12,
                          color: AppColors.textSecondary,
                        ),
                      ),
                  ],
                ),
              ),
              const Icon(
                Icons.chevron_right_rounded,
                color: AppColors.textSecondary,
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Unavailable phase
  // ---------------------------------------------------------------------------

  Widget _buildUnavailable() {
    final status = _appointment?.status ?? AppointmentStatus.unknown;
    final statusLabel = _unavailableStatusLabel(status);

    return SafeArea(
      child: Column(
        children: [
          _buildLightAppBar(showBack: true),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              child: Column(
                children: [
                  const Spacer(flex: 2),
                  Container(
                    width: 96,
                    height: 96,
                    decoration: BoxDecoration(
                      color: AppColors.errorContainer,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.event_busy_rounded,
                      size: 48,
                      color: AppColors.error,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),
                  const Text(
                    'Unable to Join',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  Text(
                    'This appointment is no longer available.',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 14,
                      color: AppColors.textSecondary.withValues(alpha: 0.8),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),
                  Container(
                    padding: const EdgeInsets.all(DesignTokens.spaceMd),
                    decoration: BoxDecoration(
                      color: AppColors.surface,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusLg),
                      border: Border.all(color: AppColors.border),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Appointment Status',
                          style: TextStyle(
                            fontFamily: 'Manrope',
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceMd),
                        _buildInfoRow(
                          Icons.info_outline_rounded,
                          'Status',
                          statusLabel,
                        ),
                        const SizedBox(height: DesignTokens.spaceSm),
                        _buildInfoRow(
                          Icons.calendar_today_outlined,
                          'Date',
                          _formatDate(_appointment?.startsAt),
                        ),
                        const SizedBox(height: DesignTokens.spaceSm),
                        _buildInfoRow(
                          Icons.access_time_rounded,
                          'Time',
                          _formatTime(_appointment?.startsAt),
                        ),
                      ],
                    ),
                  ),
                  const Spacer(flex: 3),
                  SizedBox(
                    width: double.infinity,
                    height: DesignTokens.buttonHeightLg,
                    child: ElevatedButton(
                      onPressed: () => context.go('/schedule'),
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: AppColors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusLg),
                        ),
                      ),
                      child: const Text(
                        'View Appointments',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  SizedBox(
                    width: double.infinity,
                    height: DesignTokens.buttonHeightLg,
                    child: TextButton(
                      onPressed: () => context.push('/help-support'),
                      child: const Text(
                        'Need help?',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Failed phase
  // ---------------------------------------------------------------------------

  Widget _buildFailed() {
    return SafeArea(
      child: Column(
        children: [
          _buildLightAppBar(showBack: true),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              child: Column(
                children: [
                  const Spacer(flex: 2),
                  Container(
                    width: 80,
                    height: 80,
                    decoration: BoxDecoration(
                      color: AppColors.errorContainer,
                      shape: BoxShape.circle,
                    ),
                    child: const Icon(
                      Icons.cloud_off_rounded,
                      size: 40,
                      color: AppColors.error,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXl),
                  const Text(
                    'Unable to connect',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  Text(
                    _isNetworkAvailable
                        ? _errorMessage
                        : 'Please check your internet connection.',
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 14,
                      height: 1.6,
                      color: AppColors.textSecondary,
                    ),
                  ),
                  if (_lastErrorDetail.isNotEmpty) ...[
                    const SizedBox(height: DesignTokens.spaceMd),
                    Container(
                      padding: const EdgeInsets.all(DesignTokens.spaceMd),
                      decoration: BoxDecoration(
                        color: AppColors.gray100,
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusLg),
                      ),
                      child: Text(
                        _lastErrorDetail,
                        textAlign: TextAlign.center,
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 12,
                          height: 1.5,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ),
                  ],
                  const Spacer(flex: 3),
                  SizedBox(
                    width: double.infinity,
                    height: DesignTokens.buttonHeightLg,
                    child: ElevatedButton(
                      onPressed: _isNetworkAvailable ? _initCall : null,
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: AppColors.white,
                        disabledBackgroundColor: AppColors.gray200,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusLg),
                        ),
                      ),
                      child: const Text(
                        'Try Again',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  SizedBox(
                    width: double.infinity,
                    height: DesignTokens.buttonHeightLg,
                    child: OutlinedButton(
                      onPressed: () => context.pop(),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.textPrimary,
                        side: BorderSide(color: AppColors.borderDark),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusLg),
                        ),
                      ),
                      child: const Text(
                        'Go Back',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Permission kind helper
// ---------------------------------------------------------------------------

enum _PermissionKind { none, microphone, camera, both }
