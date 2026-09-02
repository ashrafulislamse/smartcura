import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/notifications/fcm_service.dart';
import '../../../../core/providers/dashboard_provider.dart';
import '../../../../core/providers/earnings_provider.dart';
import '../../../../core/providers/profile_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Doctor Profile Screen.
///
/// Wired to real backend data via Riverpod providers:
/// - [currentProfileProvider] — display name, email, phone.
/// - [activeMembershipIdProvider] — resolves the membership id for doctor-details.
/// - [doctorDetailsProvider] — specialty, experience, consultation fee, bio.
/// - [dashboardProvider] — assigned patient count.
/// - [earningsProvider] — total earned (integer sen).
///
/// All four resource states (loading, error, empty, loaded) are rendered
/// distinctly. Money is integer sen; it is formatted in exactly one place.
/// Sign out calls the real [AuthNotifier.signOut] after a confirmation dialog.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  bool _isSigningOut = false;

  @override
  void initState() {
    super.initState();
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
    );
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /// Integer sen → "RM X.XX" (the single place money is formatted here).
  String _formatSen(int sen) {
    final ringgit = sen / 100;
    return 'RM ${ringgit.toStringAsFixed(2)}';
  }

  /// First specialty from doctor-details, title-cased for display.
  String _specialtyLabel(DoctorProfessionalDetail? details) {
    final list = details?.specialties ?? const <String>[];
    if (list.isEmpty) return 'Doctor';
    return list.first;
  }

  /// Years of experience as a display string.
  String _experienceLabel(DoctorProfessionalDetail? details) {
    final years = details?.yearsExperience;
    if (years == null || years <= 0) return '';
    return '$years year${years == 1 ? '' : 's'} experience';
  }

  /// Map the membership verification status to a badge tone + label.
  ({StatusBadgeTone tone, String label}) _verificationBadge(
      Membership? membership) {
    final status = membership?.verificationStatus;
    if (status == null) {
      return (tone: StatusBadgeTone.neutral, label: 'Not Submitted');
    }
    return switch (status) {
      VerificationStatus.approved => (
          tone: StatusBadgeTone.success,
          label: 'Verified'
        ),
      VerificationStatus.pendingReview => (
          tone: StatusBadgeTone.info,
          label: 'Pending Review'
        ),
      VerificationStatus.changesRequested => (
          tone: StatusBadgeTone.warning,
          label: 'Changes Requested'
        ),
      VerificationStatus.rejected => (
          tone: StatusBadgeTone.error,
          label: 'Rejected'
        ),
      VerificationStatus.suspended => (
          tone: StatusBadgeTone.error,
          label: 'Suspended'
        ),
      VerificationStatus.expired => (
          tone: StatusBadgeTone.warning,
          label: 'Expired'
        ),
      VerificationStatus.notSubmitted => (
          tone: StatusBadgeTone.neutral,
          label: 'Not Submitted'
        ),
      VerificationStatus.unknown => (
          tone: StatusBadgeTone.neutral,
          label: 'Unknown'
        ),
    };
  }

  Future<void> _onRefresh() async {
    ref.invalidate(profileProvider);
    ref.invalidate(dashboardProvider);
    ref.invalidate(earningsProvider);
    final membershipId = ref.read(activeMembershipIdProvider);
    if (membershipId != null) {
      ref.invalidate(doctorDetailsProvider(membershipId));
    }
    await ref.read(profileProvider.future);
  }

  // ------------------------------------------------------------------
  // Avatar
  // ------------------------------------------------------------------

  Future<void> _showAvatarOptions() async {
    final action = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(DesignTokens.radiusXl),
        ),
      ),
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const SizedBox(height: DesignTokens.spaceMd),
            Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.gray300,
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            ListTile(
              leading: const Icon(Icons.photo_library_rounded,
                  color: AppColors.primary),
              title: const Text('Change Photo'),
              onTap: () => Navigator.pop(context, 'upload'),
            ),
            ListTile(
              leading: const Icon(Icons.delete_outline_rounded,
                  color: AppColors.error),
              title: const Text('Remove Photo'),
              onTap: () => Navigator.pop(context, 'remove'),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            ListTile(
              leading:
                  const Icon(Icons.close_rounded, color: AppColors.gray600),
              title: const Text('Cancel'),
              onTap: () => Navigator.pop(context),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
          ],
        ),
      ),
    );

    if (action == 'upload') {
      final notifier = ref.read(avatarUploadProvider.notifier);
      await notifier.pickAndUpload();
      _showAvatarResult(ref.read(avatarUploadProvider));
    } else if (action == 'remove') {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Remove Photo'),
          content:
              const Text('Are you sure you want to remove your profile photo?'),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: () => Navigator.pop(context, true),
              style: TextButton.styleFrom(foregroundColor: AppColors.error),
              child: const Text('Remove'),
            ),
          ],
        ),
      );
      if (confirmed == true) {
        final notifier = ref.read(avatarRemoveProvider.notifier);
        await notifier.remove();
        _showAvatarResult(ref.read(avatarRemoveProvider));
      }
    }
  }

  void _showAvatarResult(AvatarMutationState state) {
    if (!mounted) return;
    if (state.error != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(state.error!.displayMessage)),
      );
    } else if (state.value != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Profile photo updated')),
      );
    }
  }

  // ------------------------------------------------------------------
  // Sign out
  // ------------------------------------------------------------------

  Future<void> _showSignOutDialog() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Sign Out'),
        content: const Text('Are you sure you want to sign out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: const Text('Sign Out'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    await _performSignOut();
  }

  Future<void> _performSignOut() async {
    setState(() => _isSigningOut = true);
    try {
      // Revoke this device's push registration BEFORE the session is torn
      // down — after the session revoke the call would 401. Best-effort and
      // silently skipped when no device is tracked.
      await ref.read(fcmServiceProvider).revokeTrackedPushDevice();
      await ref.read(authProvider.notifier).signOut();
      // The router redirect handles the trip to /login when auth state flips.
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e is ApiError
                ? e.displayMessage
                : 'Sign out failed. Please try again.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSigningOut = false);
    }
  }

  // ------------------------------------------------------------------
  // Build
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(currentProfileProvider);
    final membershipId = ref.watch(activeMembershipIdProvider);
    final memberships = ref.watch(membershipsProvider);
    final detailsAsync = membershipId != null
        ? ref.watch(doctorDetailsProvider(membershipId))
        : null;
    final dashboardAsync = ref.watch(dashboardProvider);
    final earningsAsync = ref.watch(earningsProvider);
    final avatarUpload = ref.watch(avatarUploadProvider);
    final avatarRemove = ref.watch(avatarRemoveProvider);

    final membership =
        memberships?.where((m) => m.id == membershipId).firstOrNull;
    final displayName = profile?.displayName ?? 'Doctor';
    final avatarBusy = avatarUpload.loading || avatarRemove.loading;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        top: false,
        child: RefreshIndicator(
          color: AppColors.primary,
          onRefresh: _onRefresh,
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              // ---- Content ------------------------------------------------
              SliverToBoxAdapter(
                child: profile == null
                    ? _buildErrorOrLoading(
                        displayName, 'Unable to load your profile.')
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _buildProfileHeader(
                            displayName: displayName,
                            email: profile.email,
                            phone: profile.phoneE164,
                            avatarUrl: profile.avatarUrl,
                            avatarBusy: avatarBusy,
                            detailsAsync: detailsAsync,
                            membership: membership,
                          ),
                          const SizedBox(height: DesignTokens.spaceLg),
                          _buildStatsRow(
                            dashboardAsync: dashboardAsync,
                            earningsAsync: earningsAsync,
                            detailsAsync: detailsAsync,
                          ),
                          const SizedBox(height: DesignTokens.spaceLg),
                          _buildMenuSection(),
                          const SizedBox(height: DesignTokens.spaceXl),
                          _buildSignOutButton(),
                          const SizedBox(height: DesignTokens.space2xl),
                          _buildVersionFooter(),
                          const SizedBox(height: 120),
                        ],
                      ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Profile header (gradient)
  // ------------------------------------------------------------------

  Widget _buildProfileHeader({
    required String displayName,
    required String email,
    required String? phone,
    required String? avatarUrl,
    required bool avatarBusy,
    required AsyncValue<DoctorProfessionalDetail>? detailsAsync,
    required Membership? membership,
  }) {
    final badge = _verificationBadge(membership);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.only(
        top: DesignTokens.space2xl + 24,
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
          // Title + badge
          const Text(
            'Profile',
            style: TextStyle(
              fontSize: 20,
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
              'Doctor Account',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Colors.white.withOpacity(0.9),
              ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          // Avatar with white ring border and a tap-to-change overlay.
          GestureDetector(
            onTap: _showAvatarOptions,
            child: Container(
              padding: const EdgeInsets.all(4),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border:
                    Border.all(color: Colors.white.withOpacity(0.6), width: 3),
              ),
              child: Stack(
                alignment: Alignment.bottomRight,
                children: [
                  AvatarWidget(
                    name: displayName,
                    size: 96,
                    imageUrl: avatarUrl,
                  ),
                  Container(
                    padding: const EdgeInsets.all(4),
                    decoration: const BoxDecoration(
                      color: AppColors.white,
                      shape: BoxShape.circle,
                    ),
                    child: avatarBusy
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppColors.primary,
                            ),
                          )
                        : Icon(
                            Icons.camera_alt_rounded,
                            size: 16,
                            color: AppColors.primary,
                          ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            displayName,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: AppColors.white,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          // Specialty badge + verification badge
          Wrap(
            spacing: DesignTokens.spaceSm,
            runSpacing: DesignTokens.spaceXs,
            alignment: WrapAlignment.center,
            children: [
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: DesignTokens.spaceMd,
                  vertical: DesignTokens.spaceXs + 1,
                ),
                decoration: BoxDecoration(
                  color: Colors.white.withOpacity(0.22),
                  borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                ),
                child: detailsAsync == null
                    ? _shimmerInline(width: 90, height: 16)
                    : Text(
                        _specialtyLabel(detailsAsync.valueOrNull),
                        style: TextStyle(
                          fontSize: 13,
                          color: Colors.white.withOpacity(0.95),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
              ),
              StatusBadge(
                label: badge.label,
                tone: badge.tone,
                showDot: true,
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          // Experience line
          if (detailsAsync != null && detailsAsync.hasValue)
            Text(
              _experienceLabel(detailsAsync.valueOrNull),
              style: TextStyle(
                fontSize: 14,
                color: Colors.white.withOpacity(0.85),
              ),
            ),
          const SizedBox(height: DesignTokens.spaceSm),
          // Contact lines
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.email_outlined,
                  size: DesignTokens.iconXs,
                  color: Colors.white.withOpacity(0.85)),
              const SizedBox(width: DesignTokens.spaceXs),
              Flexible(
                child: Text(
                  email,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.white.withOpacity(0.85),
                  ),
                ),
              ),
            ],
          ),
          if (phone != null && phone.isNotEmpty) ...[
            const SizedBox(height: DesignTokens.spaceXs),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.phone_outlined,
                    size: DesignTokens.iconXs,
                    color: Colors.white.withOpacity(0.85)),
                const SizedBox(width: DesignTokens.spaceXs),
                Flexible(
                  child: Text(
                    phone,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 13,
                      color: Colors.white.withOpacity(0.85),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Stats row
  // ------------------------------------------------------------------

  Widget _buildStatsRow({
    required AsyncValue<DoctorDashboardResponse> dashboardAsync,
    required AsyncValue<DoctorEarnings> earningsAsync,
    required AsyncValue<DoctorProfessionalDetail>? detailsAsync,
  }) {
    final patientCount = dashboardAsync.valueOrNull?.data.assignedPatients ?? 0;
    final earningsLabel = earningsAsync.when(
      data: (e) => _formatSen(e.totalEarnedSen),
      loading: () => '...',
      error: (_, __) => '—',
    );
    final feeLabel = detailsAsync?.when(
          data: (d) => _formatSen(d.consultationFeeSen),
          loading: () => '...',
          error: (_, __) => '—',
        ) ??
        '—';

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Row(
        children: [
          SizedBox(
            width: 180,
            child: StatCard(
              icon: Icons.group_rounded,
              label: 'Total Patients',
              value: '$patientCount',
              tone: StatTone.primary,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          SizedBox(
            width: 180,
            child: StatCard(
              icon: Icons.payments_rounded,
              label: 'Total Earnings',
              value: earningsLabel,
              tone: StatTone.success,
              onTap: () => context.push('/earnings'),
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          SizedBox(
            width: 180,
            child: StatCard(
              icon: Icons.medical_services_rounded,
              label: 'Consult Fee',
              value: feeLabel,
              tone: StatTone.info,
            ),
          ),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Menu section
  // ------------------------------------------------------------------

  Widget _buildMenuSection() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Account',
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.gray900,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm + 2),
          _buildMenuItem(
            icon: Icons.person_outline_rounded,
            title: 'Edit Profile',
            subtitle: 'Update your personal and professional details',
            onTap: () => context.push('/edit-profile'),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildMenuItem(
            icon: Icons.settings_outlined,
            title: 'Settings',
            subtitle: 'Notifications, preferences, and security',
            onTap: () => context.push('/settings'),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildMenuItem(
            icon: Icons.help_outline_rounded,
            title: 'Help & Support',
            subtitle: 'FAQs, contact support, submit a ticket',
            onTap: () => context.push('/help-support'),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildMenuItem(
            icon: Icons.notifications_outlined,
            title: 'Notifications',
            subtitle: 'View your recent notifications',
            onTap: () => context.push('/notifications'),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildMenuItem(
            icon: Icons.bar_chart_outlined,
            title: 'Analytics',
            subtitle: 'Appointment, patient, and earnings insights',
            onTap: () => context.push('/analytics'),
          ),
        ],
      ),
    );
  }

  Widget _buildMenuItem({
    required IconData icon,
    required String title,
    required String subtitle,
    required VoidCallback onTap,
  }) {
    return PremiumCard(
      onTap: onTap,
      child: Row(
        children: [
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child:
                Icon(icon, color: AppColors.primary, size: DesignTokens.iconMd),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.gray900,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  style: TextStyle(
                    fontSize: 13,
                    color: AppColors.gray500,
                  ),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          const Icon(Icons.chevron_right_rounded,
              color: AppColors.gray400, size: DesignTokens.iconMd),
        ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Sign out button
  // ------------------------------------------------------------------

  Widget _buildSignOutButton() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: SizedBox(
        width: double.infinity,
        child: OutlinedButton(
          onPressed: _isSigningOut ? null : _showSignOutDialog,
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.error,
            side: BorderSide(
                color: AppColors.error.withOpacity(0.25), width: 1.5),
            padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
          ),
          child: _isSigningOut
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.error,
                  ),
                )
              : const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.logout_rounded, size: 20),
                    SizedBox(width: DesignTokens.spaceSm),
                    Text(
                      'Sign Out',
                      style: TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Version footer
  // ------------------------------------------------------------------

  Widget _buildVersionFooter() {
    return Center(
      child: Text(
        'SmartCura Doctor',
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: AppColors.gray400,
              fontWeight: FontWeight.w500,
            ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Fallback error / loading
  // ------------------------------------------------------------------

  Widget _buildErrorOrLoading(String displayName, String message) {
    // Shimmer profile header + stats while the profile resolves.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildShimmerHeader(),
        const SizedBox(height: DesignTokens.spaceLg),
        _buildShimmerStats(),
      ],
    );
  }

  Widget _buildShimmerHeader() {
    return Shimmer.fromColors(
      baseColor: AppColors.shimmerBase,
      highlightColor: AppColors.shimmerHighlight,
      child: Container(
        width: double.infinity,
        height: 360,
        decoration: const BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.only(
            bottomLeft: Radius.circular(DesignTokens.radius3xl),
            bottomRight: Radius.circular(DesignTokens.radius3xl),
          ),
        ),
      ),
    );
  }

  Widget _buildShimmerStats() {
    return Shimmer.fromColors(
      baseColor: AppColors.shimmerBase,
      highlightColor: AppColors.shimmerHighlight,
      child: SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
        child: Row(
          children: List.generate(
            3,
            (i) => Padding(
              padding: EdgeInsets.only(right: i < 2 ? DesignTokens.spaceMd : 0),
              child: Container(
                width: 180,
                height: 72,
                decoration: BoxDecoration(
                  color: AppColors.white,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _shimmerInline({required double width, required double height}) {
    return Shimmer.fromColors(
      baseColor: Colors.white.withOpacity(0.3),
      highlightColor: Colors.white.withOpacity(0.6),
      child: Container(
        width: width,
        height: height,
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
        ),
      ),
    );
  }
}
