import 'dart:async';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/constants/app_constants.dart';
import '../../../../core/navigation/deep_link_handler.dart';
import '../../../../core/notifications/fcm_service.dart';
import '../../../../core/providers/verification_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/premium_card.dart';
import '../../../../core/widgets/smartcura_logo.dart';
import '../../../../core/widgets/status_badge.dart';

/// Verification Pending Screen — real verification status display with polling.
///
/// Converted to [ConsumerStatefulWidget]. Watches [bootstrapStateProvider] and
/// [membershipsProvider] to display the doctor membership's
/// [VerificationStatus]. A [Timer.periodic] polls every 10 seconds by calling
/// `bootstrap()` to refresh the session; when the status transitions to
/// `approved` the bootstrap state flips to `ready` and the router redirect
/// sends the user to `/dashboard` automatically.
///
/// For `changes_requested` and `not_submitted` states, an inline re-upload
/// flow lets the doctor submit a new license photo without leaving the screen.
class VerificationPendingScreen extends ConsumerStatefulWidget {
  const VerificationPendingScreen({super.key});

  @override
  ConsumerState<VerificationPendingScreen> createState() =>
      _VerificationPendingScreenState();
}

class _VerificationPendingScreenState
    extends ConsumerState<VerificationPendingScreen> {
  Timer? _pollTimer;
  bool _isRefreshing = false;
  bool _isUploading = false;
  String _uploadStep = '';

  @override
  void initState() {
    super.initState();
    // Poll every 10 seconds for verification status changes.
    _pollTimer = Timer.periodic(const Duration(seconds: 10), (_) {
      if (mounted && !_isRefreshing) {
        _refreshStatus();
      }
    });
  }

  @override
  void dispose() {
    _pollTimer?.cancel();
    super.dispose();
  }

  Future<void> _refreshStatus() async {
    setState(() => _isRefreshing = true);
    await ref.read(authProvider.notifier).bootstrap();
    if (mounted) {
      setState(() => _isRefreshing = false);
    }
  }

  /// Find the doctor membership from the bootstrap response.
  Membership? _findDoctorMembership(List<Membership>? memberships) {
    if (memberships == null || memberships.isEmpty) return null;
    return memberships.firstWhere(
      (m) => m.role == RoleId.doctor,
      orElse: () => memberships.first,
    );
  }

  Future<void> _handleSignOut() async {
    // Revoke the push device while the session is still alive — the endpoint
    // authenticates with it. Matches the pattern in settings_screen and
    // profile_screen; skipped silently when no device is tracked.
    await ref.read(fcmServiceProvider).revokeTrackedPushDevice();
    await ref.read(authProvider.notifier).signOut();
    // Router redirect sends to /login when unauthenticated.
  }

  Future<void> _handleReUpload() async {
    final membership = _findDoctorMembership(ref.read(membershipsProvider));
    if (membership == null) {
      _showError('No membership found. Please contact support.');
      return;
    }

    final picker = ImagePicker();
    final XFile? image = await picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
    );
    if (image == null) return;

    setState(() {
      _isUploading = true;
      _uploadStep = 'Uploading your license...';
    });

    try {
      final bytes = await image.readAsBytes();
      final hash = sha256.convert(bytes);
      final hexHash = hash.toString();
      final contentType = image.mimeType ?? 'image/jpeg';

      // Request upload target.
      setState(() => _uploadStep = 'Requesting upload target...');
      final requestNotifier = ref.read(requestUploadTargetProvider.notifier);
      final requestSuccess = await requestNotifier(
        membershipId: membership.id,
        req: RequestVerificationUploadRequest(
          documentKind: VerificationDocumentKind.medicalLicense,
          contentType: contentType,
          byteSize: bytes.length,
          declaredSha256: hexHash,
        ),
      );

      if (!requestSuccess) {
        final error = ref.read(requestUploadTargetProvider).error;
        _showError(error?.displayMessage ?? 'Failed to request upload target.');
        return;
      }

      final uploadTarget = ref.read(requestUploadTargetProvider).value;
      if (uploadTarget == null) {
        _showError('Upload target response was empty.');
        return;
      }

      // Upload to presigned URL.
      setState(() => _uploadStep = 'Uploading file...');
      final uploadDio = Dio();
      final headers = <String, dynamic>{
        'Content-Type': contentType,
        ...uploadTarget.upload.requiredHeaders.map((k, v) => MapEntry(k, v)),
      };

      final method = uploadTarget.upload.method.toUpperCase();
      if (method == 'PUT') {
        await uploadDio.put(
          uploadTarget.upload.url,
          data: Stream.fromIterable([bytes]),
          options: Options(
            headers: {
              ...headers,
              'Content-Length': bytes.length,
            },
            contentType: contentType,
          ),
        );
      } else {
        await uploadDio.request(
          uploadTarget.upload.url,
          data: bytes,
          options: Options(
            method: method,
            headers: {
              ...headers,
              'Content-Length': bytes.length,
            },
            contentType: contentType,
          ),
        );
      }

      // Finalize.
      setState(() => _uploadStep = 'Finalizing upload...');
      final finalizeNotifier = ref.read(finalizeUploadProvider.notifier);
      final finalizeSuccess = await finalizeNotifier(
        membershipId: membership.id,
        documentId: uploadTarget.document.documentId,
        reportedSha256: hexHash,
      );

      if (!finalizeSuccess) {
        final error = ref.read(finalizeUploadProvider).error;
        _showError(error?.displayMessage ?? 'Failed to finalize upload.');
        return;
      }

      // Refresh status to pick up the new document.
      await _refreshStatus();

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('License document uploaded successfully.'),
            backgroundColor: AppColors.secondary,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } on DioException catch (e) {
      _showError('Upload failed: ${e.message ?? e.toString()}');
    } catch (e) {
      _showError('Upload failed: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isUploading = false;
          _uploadStep = '';
        });
      }
    }
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: AppColors.error,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);
    final memberships = authState.memberships;
    final membership = _findDoctorMembership(memberships);
    final verificationStatus = membership?.verificationStatus;
    final displayName = authState.profile?.displayName ?? 'Doctor';

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Stack(
          children: [
            SingleChildScrollView(
              child: Column(
                children: [
                  _buildHeader(displayName),
                  Padding(
                    padding: const EdgeInsets.all(DesignTokens.spaceLg),
                    child: Column(
                      children: [
                        const SizedBox(height: DesignTokens.spaceLg),

                        // Status hero
                        _buildStatusHero(verificationStatus),

                        const SizedBox(height: DesignTokens.spaceLg),

                        // Status-specific content card
                        _buildStatusContent(verificationStatus),

                        const SizedBox(height: DesignTokens.spaceLg),

                        // Progress steps card (shown for pending/changes states)
                        if (verificationStatus == null ||
                            verificationStatus ==
                                VerificationStatus.pendingReview ||
                            verificationStatus ==
                                VerificationStatus.changesRequested ||
                            verificationStatus ==
                                VerificationStatus.notSubmitted) ...[
                          _buildProgressSteps(verificationStatus),
                          const SizedBox(height: DesignTokens.spaceLg),
                        ],

                        // Action buttons
                        _buildActionButtons(verificationStatus),

                        const SizedBox(height: DesignTokens.spaceXl),

                        // Sign Out
                        TextButton(
                          onPressed: _isUploading ? null : _handleSignOut,
                          child: const Text(
                            'Sign Out',
                            style: TextStyle(
                              color: AppColors.error,
                              fontWeight: FontWeight.w500,
                              fontSize: 14,
                            ),
                          ),
                        ),

                        const SizedBox(height: DesignTokens.spaceXl),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Upload overlay
            if (_isUploading)
              Container(
                color: AppColors.overlayLight,
                child: Center(
                  child: PremiumCard(
                    padding: const EdgeInsets.all(DesignTokens.spaceXl),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(
                          width: 40,
                          height: 40,
                          child: CircularProgressIndicator(
                            strokeWidth: 3,
                            color: AppColors.primary,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceLg),
                        Text(
                          _uploadStep.isNotEmpty ? _uploadStep : 'Uploading...',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: AppColors.gray900,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader(String displayName) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.only(
        top: DesignTokens.space2xl,
        bottom: DesignTokens.space2xl + 8,
      ),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.primary, AppColors.primaryDark],
        ),
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(DesignTokens.radius3xl),
          bottomRight: Radius.circular(DesignTokens.radius3xl),
        ),
      ),
      child: Column(
        children: [
          // Logo
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.12),
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              border: Border.all(
                color: Colors.white.withOpacity(0.2),
                width: 1.5,
              ),
            ),
            child: const SmartCuraLogo(size: 40),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            AppConstants.appName,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.white,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.15),
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            ),
            child: Text(
              'Verification Status',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Colors.white.withOpacity(0.9),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatusHero(VerificationStatus? status) {
    final config = _statusConfig(status);
    return Container(
      width: 120,
      height: 120,
      decoration: BoxDecoration(
        color: config.containerColor,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: config.iconColor.withOpacity(0.2),
            blurRadius: 24,
            spreadRadius: 4,
          ),
        ],
      ),
      child: Icon(
        config.icon,
        size: 56,
        color: config.iconColor,
      ),
    );
  }

  Widget _buildStatusContent(VerificationStatus? status) {
    final config = _statusConfig(status);
    return PremiumCard(
      accent: config.accentColor,
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      child: Column(
        children: [
          StatusBadge(
            label: config.badgeLabel,
            tone: config.badgeTone,
            showDot: true,
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          Text(
            config.title,
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: AppColors.gray900,
              letterSpacing: -0.3,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            config.description,
            style: TextStyle(
              fontSize: 15,
              color: AppColors.gray600,
              height: 1.5,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildProgressSteps(VerificationStatus? status) {
    // Step 1: Documents submitted
    final step1Complete =
        status != null && status != VerificationStatus.notSubmitted;
    // Step 2: Under review
    final step2Active = status == VerificationStatus.pendingReview;
    final step2Complete = status == VerificationStatus.approved ||
        status == VerificationStatus.changesRequested;
    // Step 3: Account activation
    final step3Complete = status == VerificationStatus.approved;

    return PremiumCard(
      title: 'What\'s Next?',
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildStepRow(
            icon: step1Complete
                ? Icons.check_circle
                : Icons.radio_button_unchecked,
            iconColor: step1Complete ? AppColors.secondary : AppColors.gray400,
            title: 'Documents Submitted',
            subtitle: step1Complete ? 'Completed' : 'Pending',
            subtitleColor:
                step1Complete ? AppColors.secondaryDark : AppColors.gray500,
            isLast: false,
          ),
          _buildStepRow(
            icon: step2Complete
                ? Icons.check_circle
                : step2Active
                    ? Icons.sync_rounded
                    : Icons.lock_outline,
            iconColor: step2Complete
                ? AppColors.secondary
                : step2Active
                    ? AppColors.warning
                    : AppColors.gray400,
            title: 'Manual Review',
            subtitle: step2Complete
                ? 'Completed'
                : step2Active
                    ? 'In Progress (typically 24-48h)'
                    : 'Pending',
            subtitleColor: step2Complete
                ? AppColors.secondaryDark
                : step2Active
                    ? AppColors.warningDark
                    : AppColors.gray500,
            isLast: false,
          ),
          _buildStepRow(
            icon: step3Complete ? Icons.check_circle : Icons.lock_outline,
            iconColor: step3Complete ? AppColors.secondary : AppColors.gray400,
            title: 'Account Activation',
            subtitle: step3Complete ? 'Completed' : 'Pending',
            subtitleColor:
                step3Complete ? AppColors.secondaryDark : AppColors.gray500,
            isLast: true,
          ),
        ],
      ),
    );
  }

  Widget _buildActionButtons(VerificationStatus? status) {
    return Column(
      children: [
        // Refresh Status button
        SizedBox(
          width: double.infinity,
          height: DesignTokens.buttonHeightMd,
          child: OutlinedButton.icon(
            onPressed: _isRefreshing || _isUploading ? null : _refreshStatus,
            icon: _isRefreshing
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: AppColors.primary,
                    ),
                  )
                : const Icon(Icons.refresh_rounded, size: 20),
            label: const Text('Refresh Status'),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.primary,
              side: const BorderSide(color: AppColors.primary, width: 1.5),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
            ),
          ),
        ),

        // Go to Dashboard (only when approved)
        if (status == VerificationStatus.approved) ...[
          const SizedBox(height: DesignTokens.spaceMd),
          SizedBox(
            width: double.infinity,
            height: DesignTokens.buttonHeightLg,
            child: ElevatedButton.icon(
              // Prefer a stashed deep-link destination once, if one arrived
              // while verification was pending.
              onPressed: () => context.go(
                  ref.read(deepLinkHandlerProvider).consumePendingLocation() ??
                      '/dashboard'),
              icon: const Icon(Icons.dashboard_rounded, size: 20),
              label: const Text(
                'Go to Dashboard',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w700,
                ),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(
                    DesignTokens.radiusMd,
                  ),
                ),
              ),
            ),
          ),
        ],

        // Re-upload document (for changes_requested and not_submitted)
        if (status == VerificationStatus.changesRequested ||
            status == VerificationStatus.notSubmitted) ...[
          const SizedBox(height: DesignTokens.spaceMd),
          SizedBox(
            width: double.infinity,
            height: DesignTokens.buttonHeightMd,
            child: ElevatedButton.icon(
              onPressed: _isUploading || _isRefreshing ? null : _handleReUpload,
              icon: const Icon(Icons.upload_file_rounded, size: 20),
              label: Text(
                status == VerificationStatus.changesRequested
                    ? 'Upload Updated Document'
                    : 'Submit License Document',
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(
                    DesignTokens.radiusMd,
                  ),
                ),
              ),
            ),
          ),
        ],

        // Re-apply (for rejected)
        if (status == VerificationStatus.rejected) ...[
          const SizedBox(height: DesignTokens.spaceMd),
          SizedBox(
            width: double.infinity,
            height: DesignTokens.buttonHeightMd,
            child: ElevatedButton.icon(
              onPressed: _isUploading || _isRefreshing ? null : _handleReUpload,
              icon: const Icon(Icons.refresh_rounded, size: 20),
              label: const Text(
                'Re-submit Application',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(
                    DesignTokens.radiusMd,
                  ),
                ),
              ),
            ),
          ),
        ],

        // Re-submit (for expired)
        if (status == VerificationStatus.expired) ...[
          const SizedBox(height: DesignTokens.spaceMd),
          SizedBox(
            width: double.infinity,
            height: DesignTokens.buttonHeightMd,
            child: ElevatedButton.icon(
              onPressed: _isUploading || _isRefreshing ? null : _handleReUpload,
              icon: const Icon(Icons.upload_file_rounded, size: 20),
              label: const Text(
                'Submit New Document',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                ),
              ),
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.white,
                elevation: 0,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(
                    DesignTokens.radiusMd,
                  ),
                ),
              ),
            ),
          ),
        ],

        // Contact Support
        const SizedBox(height: DesignTokens.spaceMd),
        TextButton.icon(
          onPressed: () => context.push('/help-support'),
          icon: const Icon(Icons.support_agent, size: 20),
          label: const Text('Contact Support'),
          style: TextButton.styleFrom(
            foregroundColor: AppColors.gray600,
          ),
        ),
      ],
    );
  }

  Widget _buildStepRow({
    required IconData icon,
    required Color iconColor,
    required String title,
    required String subtitle,
    required Color subtitleColor,
    required bool isLast,
  }) {
    return Column(
      children: [
        Row(
          children: [
            Container(
              width: 32,
              height: 32,
              decoration: BoxDecoration(
                color: iconColor.withOpacity(0.1),
                shape: BoxShape.circle,
                border: Border.all(color: iconColor, width: 2),
              ),
              child: Icon(icon, size: 16, color: iconColor),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.gray900,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: subtitleColor,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        if (!isLast) ...[
          const SizedBox(height: DesignTokens.spaceMd),
          Container(
            margin: const EdgeInsets.only(left: 15),
            width: 2,
            height: 24,
            color: AppColors.gray200,
          ),
          const SizedBox(height: DesignTokens.spaceMd),
        ],
      ],
    );
  }

  /// Configuration for each verification status: icon, colors, text.
  _StatusConfig _statusConfig(VerificationStatus? status) {
    switch (status) {
      case VerificationStatus.notSubmitted:
        return _StatusConfig(
          icon: Icons.assignment_outlined,
          iconColor: AppColors.gray500,
          containerColor: AppColors.gray100,
          accentColor: AppColors.gray400,
          badgeLabel: 'Not Submitted',
          badgeTone: StatusBadgeTone.neutral,
          title: 'No Documents Submitted',
          description: 'You haven\'t submitted your medical license for '
              'verification yet. Upload your license photo to start the '
              'review process.',
        );
      case VerificationStatus.pendingReview:
        return _StatusConfig(
          icon: Icons.hourglass_top_rounded,
          iconColor: AppColors.warningDark,
          containerColor: AppColors.warningContainer,
          accentColor: AppColors.warning,
          badgeLabel: 'Pending Review',
          badgeTone: StatusBadgeTone.warning,
          title: 'Verification Pending',
          description: 'Thank you for submitting your credentials. Our team is '
              'currently reviewing your license. This typically takes '
              '24-48 hours.',
        );
      case VerificationStatus.changesRequested:
        return _StatusConfig(
          icon: Icons.edit_note_rounded,
          iconColor: AppColors.warningDark,
          containerColor: AppColors.warningContainer,
          accentColor: AppColors.warning,
          badgeLabel: 'Changes Requested',
          badgeTone: StatusBadgeTone.warning,
          title: 'Changes Needed',
          description: 'Our review team found issues with your submission. '
              'Please review the feedback and upload an updated '
              'license document.',
        );
      case VerificationStatus.approved:
        return _StatusConfig(
          icon: Icons.verified_rounded,
          iconColor: AppColors.successDark,
          containerColor: AppColors.successContainer,
          accentColor: AppColors.secondary,
          badgeLabel: 'Verified',
          badgeTone: StatusBadgeTone.success,
          title: 'You\'re Verified!',
          description: 'Congratulations! Your medical license has been '
              'verified. You now have full access to SmartCura Doctor.',
        );
      case VerificationStatus.rejected:
        return _StatusConfig(
          icon: Icons.cancel_outlined,
          iconColor: AppColors.errorDark,
          containerColor: AppColors.errorContainer,
          accentColor: AppColors.error,
          badgeLabel: 'Rejected',
          badgeTone: StatusBadgeTone.error,
          title: 'Application Rejected',
          description: 'Your license verification was not approved. Please '
              'review the reason below and re-submit your application '
              'with the correct documents.',
        );
      case VerificationStatus.suspended:
        return _StatusConfig(
          icon: Icons.block_rounded,
          iconColor: AppColors.errorDark,
          containerColor: AppColors.errorContainer,
          accentColor: AppColors.error,
          badgeLabel: 'Suspended',
          badgeTone: StatusBadgeTone.error,
          title: 'Verification Suspended',
          description: 'Your verification has been suspended. Please contact '
              'support for more information and to resolve this issue.',
        );
      case VerificationStatus.expired:
        return _StatusConfig(
          icon: Icons.schedule_outlined,
          iconColor: AppColors.gray500,
          containerColor: AppColors.gray100,
          accentColor: AppColors.gray400,
          badgeLabel: 'Expired',
          badgeTone: StatusBadgeTone.neutral,
          title: 'Verification Expired',
          description: 'Your license verification has expired. Please submit '
              'an updated license document to renew your verification.',
        );
      case VerificationStatus.unknown:
      case null:
        return _StatusConfig(
          icon: Icons.help_outline_rounded,
          iconColor: AppColors.gray500,
          containerColor: AppColors.gray100,
          accentColor: AppColors.gray400,
          badgeLabel: 'Checking...',
          badgeTone: StatusBadgeTone.neutral,
          title: 'Checking Verification Status',
          description: 'We\'re checking your verification status. This will '
              'update automatically.',
        );
    }
  }
}

/// Visual configuration for a verification status.
class _StatusConfig {
  const _StatusConfig({
    required this.icon,
    required this.iconColor,
    required this.containerColor,
    required this.accentColor,
    required this.badgeLabel,
    required this.badgeTone,
    required this.title,
    required this.description,
  });

  final IconData icon;
  final Color iconColor;
  final Color containerColor;
  final Color accentColor;
  final String badgeLabel;
  final StatusBadgeTone badgeTone;
  final String title;
  final String description;
}
