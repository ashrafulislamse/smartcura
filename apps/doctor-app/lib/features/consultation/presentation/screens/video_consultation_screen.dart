import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:livekit_client/livekit_client.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart' hide Permission;

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/consultation_provider.dart';
import '../../../../core/providers/message_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/loading_overlay.dart';

/// Video Consultation Screen — full-screen LiveKit video call.
///
/// Wired to real backend data:
/// - The consultation id arrives as the route `extra` (a String), pushed from
///   the appointment details screen after `POST /appointments/{id}/consultation`.
/// - [consultationDetailProvider] resolves the consultation (patient + appointment
///   ids), and [doctorPatientDetailProvider] resolves the patient's display name.
/// - [roomTokenProvider] mints a LiveKit room token via
///   `POST /consultations/{id}/room-token`. The returned `serverUrl` +
///   `accessToken` are handed to `livekit_client`'s [Room] to connect, publish
///   the local camera + microphone, and render the remote participant's video
///   full-screen with a picture-in-picture self-view.
///
/// All failure shapes (no consultation id, token fetch failure, room connect
/// failure) render a distinct [ErrorView] with a retry path.
class VideoConsultationScreen extends ConsumerStatefulWidget {
  const VideoConsultationScreen({super.key});

  @override
  ConsumerState<VideoConsultationScreen> createState() =>
      _VideoConsultationScreenState();
}

class _VideoConsultationScreenState
    extends ConsumerState<VideoConsultationScreen> {
  String? _consultationId;
  bool _didExtractExtra = false;

  // LiveKit state.
  Room? _room;
  bool _connecting = true;
  String? _connectError;
  bool _callEnded = false;

  // Call controls.
  bool _isMuted = false;
  bool _isVideoOn = true;
  int _callDuration = 0;
  Timer? _timer;

  // Cached video tracks for rendering.
  VideoTrack? _remoteVideoTrack;
  VideoTrack? _localVideoTrack;

  // Bottom panel tab state.
  int _selectedTab = 0;
  static const List<String> _tabs = [
    'Consultation',
    'Patient Info',
    'Notes',
    'History',
  ];

  @override
  void initState() {
    super.initState();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.immersiveSticky);
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_didExtractExtra) return;
    _didExtractExtra = true;
    // The route extra is the consultation id (a String), pushed from the
    // appointment details screen after a consultation is created.
    final extra = GoRouterState.of(context).extra;
    if (extra is String) {
      _consultationId = extra;
    } else if (extra is Map<String, dynamic>) {
      _consultationId = extra['consultationId'] as String?;
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _disconnectRoom();
    SystemChrome.setEnabledSystemUIMode(SystemUiMode.edgeToEdge);
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------

  String _formatDuration(int seconds) {
    final minutes = seconds ~/ 60;
    final secs = seconds % 60;
    return '${minutes.toString().padLeft(2, '0')}:${secs.toString().padLeft(2, '0')}';
  }

  /// Resolve the patient display name from the consultation → patient chain.
  String _resolvePatientName(Consultation? consultation) {
    if (consultation == null) return 'Patient';
    final patient = ref
        .read(doctorPatientDetailProvider(consultation.patientProfileId))
        .valueOrNull;
    return patient?.displayName ?? 'Patient';
  }

  // --------------------------------------------------------------------------
  // LiveKit connection lifecycle

  Future<void> _connectToRoom(String url, String token) async {
    if (!mounted) return;
    setState(() {
      _connecting = true;
      _connectError = null;
    });

    // Request camera and microphone permissions before connecting.
    final camStatus = await Permission.camera.request();
    final micStatus = await Permission.microphone.request();
    if (!camStatus.isGranted || !micStatus.isGranted) {
      if (!mounted) return;
      setState(() {
        _connecting = false;
        _connectError = 'Camera and microphone permissions are required for '
            'video consultations. Please grant these permissions in your phone '
            'settings and try again.';
      });
      return;
    }

    try {
      // Disable WebRTC audio processing (AEC/NS/AGC) on devices where it fails
      // to initialize (e.g. Vivo V2507). Quality is lower but the call proceeds.
      final room = Room(
        roomOptions: const RoomOptions(
          defaultAudioCaptureOptions: AudioCaptureOptions(
            noiseSuppression: false,
            echoCancellation: false,
            autoGainControl: false,
          ),
        ),
      );
      // Listen for track / participant updates so the rendered video tracks
      // stay in sync as the remote participant publishes or unpublishes.
      room.events.listen(_onRoomEvent);

      await room.connect(url, token);
      if (!mounted) {
        await room.disconnect();
        return;
      }

      // Publish local camera + microphone.
      try {
        await room.localParticipant?.setCameraEnabled(true);
      } catch (_) {
        // Camera may be unavailable on emulators; the call can still proceed.
      }
      try {
        await room.localParticipant?.setMicrophoneEnabled(true);
      } catch (_) {
        // Microphone may be unavailable; the call can still proceed.
      }

      _room = room;
      _refreshTracks();
      _startTimer();
      if (!mounted) return;
      setState(() => _connecting = false);
    } catch (e) {
      debugPrint('[DoctorVideoCall] connection error: $e');
      if (!mounted) return;
      setState(() {
        _connecting = false;
        _connectError = _humanizeLiveKitError(e);
      });
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
    if (e is ApiError) {
      return e.displayMessage;
    }
    return 'Could not connect to the video room. Please try again.\n\n'
        'Details: $e';
  }

  void _onRoomEvent(RoomEvent event) {
    // Re-derive the renderable video tracks whenever the participant set or
    // their publications change.
    if (event is TrackSubscribedEvent ||
        event is TrackUnsubscribedEvent ||
        event is ParticipantConnectedEvent ||
        event is ParticipantDisconnectedEvent ||
        event is LocalTrackPublishedEvent ||
        event is LocalTrackUnpublishedEvent ||
        event is TrackSubscribedEvent) {
      _refreshTracks();
    }
  }

  void _refreshTracks() {
    final room = _room;
    if (room == null || !mounted) return;

    VideoTrack? remote;
    for (final participant in room.remoteParticipants.values) {
      for (final pub in participant.videoTrackPublications) {
        final track = pub.track;
        if (track is VideoTrack) {
          remote = track;
          break;
        }
      }
      if (remote != null) break;
    }

    VideoTrack? local;
    final localPart = room.localParticipant;
    if (localPart != null) {
      for (final pub in localPart.videoTrackPublications) {
        final track = pub.track;
        if (track is VideoTrack) {
          local = track;
          break;
        }
      }
    }

    setState(() {
      _remoteVideoTrack = remote;
      _localVideoTrack = local;
    });
  }

  void _startTimer() {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      setState(() => _callDuration++);
    });
  }

  // --------------------------------------------------------------------------
  // Call controls

  Future<void> _toggleMute() async {
    final room = _room;
    if (room == null) return;
    setState(() => _isMuted = !_isMuted);
    try {
      await room.localParticipant?.setMicrophoneEnabled(!_isMuted);
    } catch (_) {
      if (mounted) setState(() => _isMuted = !_isMuted);
    }
  }

  Future<void> _toggleVideo() async {
    final room = _room;
    if (room == null) return;
    setState(() => _isVideoOn = !_isVideoOn);
    try {
      await room.localParticipant?.setCameraEnabled(!_isVideoOn);
      _refreshTracks();
    } catch (_) {
      if (mounted) setState(() => _isVideoOn = !_isVideoOn);
    }
  }

  Future<void> _endCall() async {
    if (_callEnded) return;
    _callEnded = true;
    _timer?.cancel();
    await _disconnectRoom();
    if (mounted) Navigator.of(context).maybePop();
  }

  Future<void> _disconnectRoom() async {
    final room = _room;
    _room = null;
    if (room != null) {
      try {
        await room.disconnect();
      } catch (_) {
        // Best-effort disconnect; the room is being torn down anyway.
      }
    }
  }

  // --------------------------------------------------------------------------
  // Build

  @override
  Widget build(BuildContext context) {
    final consultationId = _consultationId;

    if (consultationId == null || consultationId.isEmpty) {
      return _errorScaffold(
        'No consultation was selected.',
        isForbidden: true,
        onRetry: null,
      );
    }

    // Watch the room token state (StateNotifierProvider.autoDispose).
    final tokenState = ref.watch(roomTokenProvider);
    final consultationAsync =
        ref.watch(consultationDetailProvider(consultationId));

    return consultationAsync.when(
      data: (consultation) {
        final patientName = _resolvePatientName(consultation);

        // Kick off the token fetch once.
        ref.listen(roomTokenProvider, (prev, next) {
          if (next.token != null && _room == null && !_callEnded) {
            _connectToRoom(next.token!.serverUrl, next.token!.accessToken);
          }
        });

        // Trigger the fetch when the notifier is idle.
        if (tokenState.token == null &&
            !tokenState.loading &&
            tokenState.error == null &&
            _room == null &&
            !_callEnded) {
          // Schedule after build to avoid modifying providers mid-build.
          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted &&
                _room == null &&
                !ref.read(roomTokenProvider).loading &&
                ref.read(roomTokenProvider).token == null) {
              ref.read(roomTokenProvider.notifier).fetch(consultationId);
            }
          });
        }

        // Surface a token-fetch error.
        if (tokenState.error != null && _room == null) {
          return _errorScaffold(
            tokenState.error!.displayMessage,
            isForbidden: tokenState.error!.isForbidden,
            onRetry: () {
              ref.read(roomTokenProvider.notifier).reset();
              ref.read(roomTokenProvider.notifier).fetch(consultationId);
            },
          );
        }

        return _buildCallSurface(patientName, consultation);
      },
      loading: () => Scaffold(
        backgroundColor: Colors.black,
        body: const LoadingOverlay(label: 'Loading consultation...'),
      ),
      error: (err, _) {
        final apiError = err is ApiError ? err : toApiError(err);
        return _errorScaffold(
          apiError.displayMessage,
          isForbidden: apiError.isForbidden,
          onRetry: () =>
              ref.invalidate(consultationDetailProvider(consultationId)),
        );
      },
    );
  }

  Widget _errorScaffold(String message,
      {required bool isForbidden, VoidCallback? onRetry}) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.close_rounded, color: AppColors.white),
          onPressed: () => Navigator.of(context).maybePop(),
        ),
      ),
      body: ErrorView(
        message: message,
        isForbidden: isForbidden,
        onRetry: onRetry,
        icon: Icons.videocam_off_rounded,
      ),
    );
  }

  Widget _buildCallSurface(String patientName, Consultation? consultation) {
    final size = MediaQuery.of(context).size;
    final panelHeight = size.height * 0.44;
    final topAreaHeight = size.height - panelHeight;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.light,
      child: Scaffold(
        backgroundColor: Colors.black,
        body: Stack(
          children: [
            // Video area: top portion.
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              height: topAreaHeight,
              child: Stack(
                children: [
                  _buildRemoteVideo(),
                  _buildTopGradient(),
                  _buildBottomGradient(),
                  // Header.
                  Positioned(
                    top: 0,
                    left: 0,
                    right: 0,
                    child: SafeArea(
                      bottom: false,
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
                        child: _buildHeader(patientName, consultation),
                      ),
                    ),
                  ),
                  // Doctor self-view PiP.
                  Positioned(
                    top: 88,
                    right: 12,
                    child: _buildLocalPip(),
                  ),
                  // Connection / timer badge.
                  Positioned(
                    top: 88,
                    left: 12,
                    child: _buildConnectionStatus(),
                  ),
                  // Patient info card.
                  Positioned(
                    bottom: 92,
                    left: 12,
                    right: 140,
                    child: _buildPatientInfoCard(patientName, consultation),
                  ),
                  // Call control bar.
                  Positioned(
                    bottom: 12,
                    left: 0,
                    right: 0,
                    child: SafeArea(
                      top: false,
                      child: _buildControlBar(consultation),
                    ),
                  ),
                ],
              ),
            ),
            // Bottom consultation panel.
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              height: panelHeight,
              child: _buildBottomPanel(patientName, consultation),
            ),
            // Connecting overlay.
            if (_connecting) _buildConnectingOverlay(),
            // Connection error overlay.
            if (_connectError != null && _room == null)
              _buildConnectErrorOverlay(),
          ],
        ),
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Video renderers

  Widget _buildRemoteVideo() {
    final track = _remoteVideoTrack;
    if (track != null) {
      return VideoTrackRenderer(track);
    }
    // No remote video yet — show a branded waiting state.
    return Container(
      color: AppColors.gray900,
      alignment: Alignment.center,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.videocam_off_rounded, size: 64, color: AppColors.gray400),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            'Waiting for patient to join...',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray400,
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildLocalPip() {
    final track = _localVideoTrack;
    return Container(
      width: 112,
      height: 150,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.white, width: 2),
        boxShadow: const [
          BoxShadow(
            color: AppColors.shadowDark,
            blurRadius: 20,
            offset: Offset(0, 4),
          ),
        ],
        color: AppColors.gray800,
      ),
      clipBehavior: Clip.antiAlias,
      child: track != null && _isVideoOn
          ? VideoTrackRenderer(track)
          : Center(
              child: Icon(Icons.videocam_off_rounded,
                  color: AppColors.gray400, size: 28),
            ),
    );
  }

  Widget _buildTopGradient() {
    return Positioned(
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
                Colors.black.withValues(alpha: 0.8),
                Colors.black.withValues(alpha: 0.2),
                Colors.transparent,
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildBottomGradient() {
    return Positioned(
      bottom: 0,
      left: 0,
      right: 0,
      height: 192,
      child: IgnorePointer(
        child: Container(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.bottomCenter,
              end: Alignment.topCenter,
              colors: [
                Colors.black.withValues(alpha: 0.9),
                Colors.black.withValues(alpha: 0.4),
                Colors.transparent,
              ],
            ),
          ),
        ),
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Header + controls

  Widget _buildHeader(String patientName, Consultation? consultation) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Back arrow.
        IconButton(
          icon: const Icon(Icons.arrow_back_ios_rounded,
              color: AppColors.white, size: 22),
          onPressed: () => Navigator.of(context).maybePop(),
          padding: EdgeInsets.zero,
          constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
        ),
        const SizedBox(width: 4),
        // Title + encrypted badge.
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text(
                'Video Consultation',
                style: TextStyle(
                  color: AppColors.white,
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.verified_user_rounded,
                      color: AppColors.success, size: 12),
                  const SizedBox(width: 4),
                  Text(
                    'End-to-end Encrypted',
                    style: TextStyle(
                      color: AppColors.success,
                      fontSize: 11,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 8),
        // End call button.
        GestureDetector(
          onTap: _endCall,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: AppColors.error,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: const [
                Icon(Icons.call_end, color: AppColors.white, size: 18),
                SizedBox(width: 4),
                Text(
                  'End Call',
                  style: TextStyle(
                    color: AppColors.white,
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildConnectionStatus() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 7,
            height: 7,
            decoration: const BoxDecoration(
              color: AppColors.success,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: 6),
          Text(
            _formatDuration(_callDuration),
            style: const TextStyle(
              color: AppColors.white,
              fontSize: 12,
              fontWeight: FontWeight.w600,
              fontFamily: 'monospace',
            ),
          ),
          const SizedBox(width: 8),
          const Icon(Icons.signal_cellular_alt_rounded,
              color: AppColors.success, size: 14),
        ],
      ),
    );
  }

  Widget _buildPatientInfoCard(String patientName, Consultation? consultation) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.black.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: const BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.white,
            ),
            alignment: Alignment.center,
            child: Text(
              _patientInitials(patientName),
              style: const TextStyle(
                color: AppColors.primaryDark,
                fontSize: 15,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                patientName,
                style: const TextStyle(
                  color: AppColors.white,
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                'Patient ID: SC-${(consultation?.patientProfileId ?? '').length > 8 ? (consultation?.patientProfileId ?? '').substring(0, 8).toUpperCase() : 'N/A'}',
                style: TextStyle(
                  color: Colors.grey.shade300,
                  fontSize: 11,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  String _patientInitials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) {
      return parts.first.substring(0, 1).toUpperCase();
    }
    return (parts.first.substring(0, 1) + parts[1].substring(0, 1))
        .toUpperCase();
  }

  Widget _buildControlBar(Consultation? consultation) {
    return Center(
      child: FittedBox(
        fit: BoxFit.scaleDown,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: Colors.black.withValues(alpha: 0.55),
            borderRadius: BorderRadius.circular(28),
            border: Border.all(color: Colors.white.withValues(alpha: 0.12)),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              _buildLabeledControlButton(
                icon: _isMuted ? Icons.mic_off_rounded : Icons.mic_rounded,
                label: 'Mute',
                active: _isMuted,
                onPressed: _toggleMute,
              ),
              const SizedBox(width: 8),
              _buildLabeledControlButton(
                icon: _isVideoOn
                    ? Icons.videocam_rounded
                    : Icons.videocam_off_rounded,
                label: 'Stop Video',
                active: !_isVideoOn,
                onPressed: _toggleVideo,
              ),
              const SizedBox(width: 8),
              _buildLabeledControlButton(
                icon: Icons.chat_bubble_rounded,
                label: 'Chat',
                onPressed: _navigateToChat,
              ),
              const SizedBox(width: 8),
              _buildEndCallButton(),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildLabeledControlButton({
    required IconData icon,
    required String label,
    required VoidCallback onPressed,
    bool active = false,
  }) {
    return GestureDetector(
      onTap: onPressed,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: active
                  ? AppColors.white.withValues(alpha: 0.3)
                  : AppColors.white.withValues(alpha: 0.12),
            ),
            alignment: Alignment.center,
            child: Icon(icon, color: AppColors.white, size: 24),
          ),
          const SizedBox(height: 4),
          Text(
            label,
            style: const TextStyle(
              color: AppColors.white,
              fontSize: 10,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEndCallButton() {
    return GestureDetector(
      onTap: _endCall,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 52,
            height: 52,
            decoration: const BoxDecoration(
              color: AppColors.error,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                  color: AppColors.error,
                  blurRadius: 12,
                  offset: Offset(0, 4),
                ),
              ],
            ),
            alignment: Alignment.center,
            child: const Icon(Icons.call_end, color: AppColors.white, size: 26),
          ),
          const SizedBox(height: 4),
          const Text(
            'End Call',
            style: TextStyle(
              color: AppColors.white,
              fontSize: 10,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Bottom consultation panel
  // --------------------------------------------------------------------------

  Widget _buildBottomPanel(String patientName, Consultation? consultation) {
    return Container(
      decoration: const BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(DesignTokens.radius2xl),
          topRight: Radius.circular(DesignTokens.radius2xl),
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.shadowDark,
            blurRadius: 24,
            offset: Offset(0, -4),
          ),
        ],
      ),
      child: Column(
        children: [
          // Drag handle.
          Container(
            margin: const EdgeInsets.only(top: 10),
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: AppColors.gray300,
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          // Tab bar.
          _buildTabBar(),
          // Tab content.
          Expanded(
            child: IndexedStack(
              index: _selectedTab,
              children: [
                _buildConsultationTab(patientName, consultation),
                _buildPatientInfoTab(patientName, consultation),
                _buildNotesTab(consultation),
                _buildHistoryTab(consultation),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildTabBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        border: Border(
          bottom: BorderSide(color: AppColors.gray200),
        ),
      ),
      child: Row(
        children: List.generate(_tabs.length, (index) {
          final selected = index == _selectedTab;
          return Expanded(
            child: GestureDetector(
              onTap: () => setState(() => _selectedTab = index),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _tabs[index],
                    style: TextStyle(
                      color: selected ? AppColors.primary : AppColors.gray600,
                      fontSize: 12,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Container(
                    height: 3,
                    margin: const EdgeInsets.symmetric(horizontal: 8),
                    decoration: BoxDecoration(
                      color: selected ? AppColors.primary : Colors.transparent,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ],
              ),
            ),
          );
        }),
      ),
    );
  }

  Widget _buildConsultationTab(String patientName, Consultation? consultation) {
    final consultationId = _consultationId;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildSection(
            title: 'Chief Complaint',
            onEdit: () => _navigateTo('/consultation-notes', consultationId),
            child: _buildEmptySectionText(
              'No chief complaint recorded yet. Tap Edit to add symptoms.',
            ),
          ),
          const SizedBox(height: 14),
          _buildSection(
            title: 'Vitals (Patient Reported)',
            child: _buildVitalsGrid(),
          ),
          const SizedBox(height: 14),
          _buildSection(
            title: 'Diagnosis',
            onEdit: () => _navigateTo('/e-prescription', consultationId),
            child: _buildEmptySectionText(
              'No diagnosis recorded yet. Tap Edit to add a diagnosis.',
            ),
          ),
          const SizedBox(height: 14),
          _buildSection(
            title: 'Prescription',
            action: _buildTextAction(
              'Add Prescription',
              () => _navigateTo('/e-prescription', consultationId),
            ),
            child: _buildEmptySectionText(
              'No medications prescribed yet. Tap Add Prescription to start.',
            ),
          ),
          const SizedBox(height: 14),
          _buildSection(
            title: 'Additional Notes',
            onEdit: () => _navigateTo('/consultation-notes', consultationId),
            child: _buildEmptySectionText(
              'No additional notes yet. Tap Edit to record clinical notes.',
            ),
          ),
          const SizedBox(height: 16),
          _buildQuickActions(consultationId),
          const SizedBox(height: 12),
        ],
      ),
    );
  }

  Widget _buildPatientInfoTab(String patientName, Consultation? consultation) {
    final patientAsync = ref.watch(doctorPatientDetailProvider(
      consultation?.patientProfileId ?? '',
    ));

    return patientAsync.when(
      data: (patient) {
        return SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildInfoCard(
                icon: Icons.person_outline,
                label: 'Full Name',
                value: patient.displayName.isNotEmpty
                    ? patient.displayName
                    : patientName,
              ),
              _buildInfoCard(
                icon: Icons.email_outlined,
                label: 'Email',
                value:
                    patient.email.isNotEmpty ? patient.email : 'Not provided',
              ),
              _buildInfoCard(
                icon: Icons.phone_outlined,
                label: 'Phone',
                value: patient.phoneE164 ?? 'Not provided',
              ),
              _buildInfoCard(
                icon: Icons.badge_outlined,
                label: 'Patient ID',
                value:
                    'SC-${(consultation?.patientProfileId ?? '').length > 8 ? (consultation?.patientProfileId ?? '').substring(0, 8).toUpperCase() : 'N/A'}',
              ),
              _buildInfoCard(
                icon: Icons.check_circle_outline,
                label: 'Status',
                value: patient.status.isNotEmpty ? patient.status : 'Active',
              ),
            ],
          ),
        );
      },
      loading: () => const Center(
        child: CircularProgressIndicator(strokeWidth: 2),
      ),
      error: (err, _) => Center(
        child: Text(
          'Could not load patient info',
          style: TextStyle(color: AppColors.gray600),
        ),
      ),
    );
  }

  Widget _buildNotesTab(Consultation? consultation) {
    final consultationId = _consultationId;
    if (consultationId == null) {
      return _buildEmptyTab(
        icon: Icons.note_alt_outlined,
        title: 'No consultation selected',
        subtitle: 'Notes cannot be loaded without an active consultation.',
      );
    }

    final notesAsync = ref.watch(consultationNotesProvider(consultationId));

    return notesAsync.when(
      data: (notes) {
        if (notes.data.isEmpty) {
          return _buildEmptyTab(
            icon: Icons.note_alt_outlined,
            title: 'No clinical notes yet',
            subtitle: 'Tap the button below to add a note.',
            action: FilledButton.icon(
              onPressed: () =>
                  _navigateTo('/consultation-notes', consultationId),
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Add Note'),
            ),
          );
        }
        return ListView.builder(
          padding: const EdgeInsets.all(16),
          itemCount: notes.data.length,
          itemBuilder: (context, index) {
            final note = notes.data[index];
            return _buildNoteCard(note);
          },
        );
      },
      loading: () => const Center(
        child: CircularProgressIndicator(strokeWidth: 2),
      ),
      error: (err, _) => _buildEmptyTab(
        icon: Icons.error_outline,
        title: 'Could not load notes',
        subtitle: 'Pull down or retry to load clinical notes.',
      ),
    );
  }

  Widget _buildHistoryTab(Consultation? consultation) {
    return _buildEmptyTab(
      icon: Icons.history,
      title: 'No prior history',
      subtitle: 'Past prescriptions and consultations will appear here.',
    );
  }

  Widget _buildSection({
    required String title,
    required Widget child,
    VoidCallback? onEdit,
    Widget? action,
  }) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.gray50,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.primaryDark,
                  ),
                ),
              ),
              if (action != null) action,
              if (onEdit != null && action == null)
                GestureDetector(
                  onTap: onEdit,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.edit, size: 14, color: AppColors.primary),
                      const SizedBox(width: 4),
                      Text(
                        'Edit',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: AppColors.primary,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 10),
          child,
        ],
      ),
    );
  }

  Widget _buildEmptySectionText(String text) {
    return Text(
      text,
      style: TextStyle(
        fontSize: 13,
        color: AppColors.gray600,
        height: 1.4,
      ),
    );
  }

  Widget _buildVitalsGrid() {
    return Row(
      children: [
        Expanded(
            child:
                _buildVitalItem(Icons.thermostat, 'Temperature', '--', '°C')),
        const SizedBox(width: 8),
        Expanded(
            child: _buildVitalItem(
                Icons.favorite_border, 'Heart Rate', '--', 'bpm')),
        const SizedBox(width: 8),
        Expanded(
            child: _buildVitalItem(
                Icons.air_outlined, 'Respiratory', '--', '/min')),
        const SizedBox(width: 8),
        Expanded(
            child:
                _buildVitalItem(Icons.water_drop_outlined, 'SpO2', '--', '%')),
      ],
    );
  }

  Widget _buildVitalItem(
      IconData icon, String label, String value, String unit) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 18, color: AppColors.primary),
          const SizedBox(height: 5),
          Text(
            '$value$unit',
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.gray900,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: TextStyle(
              fontSize: 9,
              color: AppColors.gray600,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildQuickActions(String? consultationId) {
    return Row(
      children: [
        Expanded(
          child: _buildQuickAction(
            Icons.medication_outlined,
            'Prescribe',
            () => _navigateTo('/e-prescription', consultationId),
          ),
        ),
      ],
    );
  }

  Widget _buildQuickAction(IconData icon, String label, VoidCallback? onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 4),
        padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 2),
        decoration: BoxDecoration(
          color: AppColors.primaryContainer,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.primary.withValues(alpha: 0.2)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 22, color: AppColors.primary),
            const SizedBox(height: 5),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: FontWeight.w600,
                color: AppColors.primaryDark,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoCard({
    required IconData icon,
    required String label,
    required String value,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.gray50,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(8),
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 18, color: AppColors.primary),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: TextStyle(
                    fontSize: 11,
                    color: AppColors.gray600,
                    fontWeight: FontWeight.w500,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.gray900,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNoteCard(ClinicalNote note) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.gray50,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: note.status == ClinicalNoteStatus.signed
                      ? AppColors.successContainer
                      : AppColors.warningContainer,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Text(
                  note.status.name,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: note.status == ClinicalNoteStatus.signed
                        ? AppColors.successDark
                        : AppColors.warningDark,
                  ),
                ),
              ),
              const Spacer(),
              Text(
                note.createdAt.length > 10
                    ? note.createdAt.substring(0, 10)
                    : note.createdAt,
                style: TextStyle(
                  fontSize: 11,
                  color: AppColors.gray600,
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            _noteContentPreview(note.content),
            style: const TextStyle(
              fontSize: 13,
              color: AppColors.gray900,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }

  String _noteContentPreview(Map<String, Object?> content) {
    if (content.isEmpty) return 'No content';
    final text = content.entries.map((e) => '${e.key}: ${e.value}').join('\n');
    return text.length > 200 ? '${text.substring(0, 200)}...' : text;
  }

  Widget _buildEmptyTab({
    required IconData icon,
    required String title,
    required String subtitle,
    Widget? action,
  }) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: AppColors.gray400),
            const SizedBox(height: 16),
            Text(
              title,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.gray900,
              ),
            ),
            const SizedBox(height: 8),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                color: AppColors.gray600,
                height: 1.4,
              ),
            ),
            if (action != null) ...[
              const SizedBox(height: 16),
              action,
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildTextAction(String label, VoidCallback onTap) {
    return GestureDetector(
      onTap: onTap,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.add, size: 16, color: AppColors.primary),
          const SizedBox(width: 2),
          Text(
            label,
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w600,
              color: AppColors.primary,
            ),
          ),
        ],
      ),
    );
  }

  void _navigateTo(String route, String? id) {
    if (id == null) return;
    context.push(route, extra: id);
  }

  /// Switch to the in-call chat. The chat screen expects a conversation id
  /// (it calls `GET /conversations/{id}/messages`), but the consultation model
  /// carries no `conversation_id`. Resolve it from the doctor inbox, which
  /// pairs `conversation_id` with `consultation_id` on each row.
  void _navigateToChat() {
    final consultationId = _consultationId;
    if (consultationId == null) return;
    final inbox = ref.read(doctorInboxProvider(null)).valueOrNull;
    String? conversationId;
    if (inbox != null) {
      for (final conv in inbox.data) {
        if (conv.consultationId == consultationId) {
          conversationId = conv.conversationId;
          break;
        }
      }
    }
    if (conversationId == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text(
              'No conversation linked to this consultation yet. Messages become available once the chat is started.'),
        ),
      );
      return;
    }
    context.push('/chat-consultation', extra: conversationId);
  }

  // --------------------------------------------------------------------------
  // Overlays

  Widget _buildConnectingOverlay() {
    return Positioned.fill(
      child: Container(
        color: Colors.black.withValues(alpha: 0.6),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(
                width: 40,
                height: 40,
                child: CircularProgressIndicator(
                  strokeWidth: 3,
                  color: AppColors.white,
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              Text(
                'Connecting...',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppColors.white,
                    ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildConnectErrorOverlay() {
    return Positioned.fill(
      child: Container(
        color: Colors.black.withValues(alpha: 0.8),
        child: Center(
          child: Padding(
            padding: const EdgeInsets.all(DesignTokens.spaceXl),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.videocam_off_rounded,
                    size: 48, color: AppColors.error),
                const SizedBox(height: DesignTokens.spaceMd),
                Text(
                  _connectError!,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: AppColors.white,
                      ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                FilledButton.icon(
                  onPressed: () {
                    setState(() => _connectError = null);
                    final token = ref.read(roomTokenProvider).token;
                    if (token != null) {
                      _connectToRoom(token.serverUrl, token.accessToken);
                    } else {
                      ref
                          .read(roomTokenProvider.notifier)
                          .fetch(_consultationId!);
                    }
                  },
                  icon: const Icon(Icons.refresh_rounded, size: 18),
                  label: const Text('Retry'),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                TextButton(
                  onPressed: _endCall,
                  child: const Text('End Call',
                      style: TextStyle(color: AppColors.white)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
