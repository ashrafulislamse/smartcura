import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/providers/profile_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/loading_overlay.dart';
import '../../../../core/widgets/status_badge.dart';

/// Profile Screen — premium patient profile.
///
/// Displays real data from the backend:
///  - [currentProfileProvider] / [profileProvider] → name, email, phone
///  - [allergiesProvider] → allergy list
///  - [conditionsProvider] → medical conditions
///  - [emergencyContactsProvider] → emergency contacts list
///
/// Sign Out calls [AuthNotifier.signOut] which clears the session.
class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  bool _isSigningOut = false;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 400),
      vsync: this,
    );
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeOut),
    );
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  Future<void> _signOut() async {
    HapticFeedback.mediumImpact();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        ),
        title: const Text(
          'Sign Out?',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
          ),
        ),
        content: const Text(
          'You will need to sign in again to access your account.',
          style: TextStyle(
            fontSize: 14,
            color: AppColors.textSecondary,
            height: 1.4,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text(
              'Cancel',
              style: TextStyle(
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: AppColors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
            ),
            child: const Text(
              'Sign Out',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _isSigningOut = true);
    await ref.read(authProvider.notifier).signOut();
    if (mounted) setState(() => _isSigningOut = false);
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(currentProfileProvider);
    final allergiesAsync = ref.watch(allergiesProvider);
    final conditionsAsync = ref.watch(conditionsProvider);
    final contactsAsync = ref.watch(emergencyContactsProvider);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        statusBarBrightness: Brightness.dark,
        systemNavigationBarColor: Colors.transparent,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Stack(
          children: [
            RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(allergiesProvider);
                ref.invalidate(conditionsProvider);
                ref.invalidate(emergencyContactsProvider);
                ref.invalidate(profileProvider);
              },
              color: AppColors.primary,
              child: FadeTransition(
                opacity: _fadeAnimation,
                child: CustomScrollView(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  slivers: [
                    // Gradient header with avatar
                    SliverToBoxAdapter(
                      child: _buildProfileHeader(profile),
                    ),
                    // Content cards
                    SliverToBoxAdapter(
                      child: Column(
                        children: [
                          const SizedBox(height: DesignTokens.spaceMd),
                          _buildPersonalInfoCard(context, profile),
                          const SizedBox(height: DesignTokens.spaceMd),
                          _buildMedicalInfoCard(
                            context,
                            allergiesAsync,
                            conditionsAsync,
                          ),
                          const SizedBox(height: DesignTokens.spaceMd),
                          _buildEmergencyContactsCard(context, contactsAsync),
                          const SizedBox(height: DesignTokens.spaceMd),
                          _buildAccountSection(context),
                          const SizedBox(height: DesignTokens.spaceMd),
                          _buildSignOutButton(),
                          const SizedBox(height: 120),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            if (_isSigningOut) const LoadingOverlay(message: 'Signing out…'),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Profile header — gradient background with avatar, name, email
  // ---------------------------------------------------------------------------
  Widget _buildProfileHeader(Profile? profile) {
    final displayName = profile?.displayName ?? '—';
    final email = profile?.email ?? '—';
    final phone = profile?.phoneE164 ?? '';

    return Container(
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF2563EB),
            Color(0xFF1D4ED8),
            Color(0xFF1E40AF),
          ],
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            DesignTokens.spaceMd,
            DesignTokens.spaceSm,
            DesignTokens.spaceMd,
            DesignTokens.spaceXl,
          ),
          child: Column(
            children: [
              // Title row
              Row(
                children: [
                  const Text(
                    'Profile',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.w800,
                      color: Colors.white,
                      letterSpacing: -0.5,
                    ),
                  ),
                  const Spacer(),
                  GestureDetector(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      context.push('/edit-profile');
                    },
                    child: Container(
                      width: 40,
                      height: 40,
                      decoration: BoxDecoration(
                        color: Colors.white.withValues(alpha: 0.15),
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusMd),
                      ),
                      child: const Icon(
                        Icons.edit_rounded,
                        color: Colors.white,
                        size: 20,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: DesignTokens.spaceLg),

              // Avatar with edit badge
              GestureDetector(
                onTap: () => context.push('/edit-profile'),
                child: Stack(
                  children: [
                    Container(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: Colors.white.withValues(alpha: 0.3),
                          width: 3,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.15),
                            blurRadius: 16,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: AvatarWidget(
                        imageUrl: profile?.avatarUrl,
                        name: displayName,
                        size: 88,
                      ),
                    ),
                    Positioned(
                      bottom: 2,
                      right: 2,
                      child: Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: AppColors.white,
                          shape: BoxShape.circle,
                          border: Border.all(
                            color: const Color(0xFF1D4ED8),
                            width: 2,
                          ),
                        ),
                        child: const Icon(
                          Icons.edit_rounded,
                          color: Color(0xFF1D4ED8),
                          size: 14,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: DesignTokens.spaceMd),

              // Name
              Text(
                displayName,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: Colors.white,
                  letterSpacing: -0.3,
                ),
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 4),

              // Email
              Text(
                email,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w500,
                  color: Colors.white.withValues(alpha: 0.85),
                ),
                textAlign: TextAlign.center,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),

              // Phone
              if (phone.isNotEmpty) ...[
                const SizedBox(height: 2),
                Text(
                  phone,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w500,
                    color: Colors.white.withValues(alpha: 0.7),
                  ),
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],

              // Patient ID badge
              if (profile != null) ...[
                const SizedBox(height: DesignTokens.spaceSm),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 12,
                    vertical: 5,
                  ),
                  decoration: BoxDecoration(
                    color: Colors.white.withValues(alpha: 0.15),
                    borderRadius:
                        BorderRadius.circular(DesignTokens.radiusFull),
                    border: Border.all(
                      color: Colors.white.withValues(alpha: 0.2),
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.badge_outlined,
                        size: 14,
                        color: Colors.white.withValues(alpha: 0.7),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        'ID: ${_shortId(profile.id)}',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: Colors.white.withValues(alpha: 0.8),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _shortId(String id) {
    if (id.length <= 8) return id;
    return id.substring(id.length - 8).toUpperCase();
  }

  // ---------------------------------------------------------------------------
  // Personal info card
  // ---------------------------------------------------------------------------
  Widget _buildPersonalInfoCard(BuildContext context, Profile? profile) {
    return _SectionCard(
      icon: Icons.person_rounded,
      title: 'Personal Information',
      actionLabel: 'Edit',
      onAction: () => context.push('/edit-profile'),
      child: Column(
        children: [
          _InfoRow(
            icon: Icons.language_rounded,
            label: 'Language',
            value: profile?.preferredLocale.isNotEmpty == true
                ? profile!.preferredLocale.toUpperCase()
                : '—',
          ),
          const SizedBox(height: 1),
          _Divider(),
          _InfoRow(
            icon: Icons.schedule_rounded,
            label: 'Timezone',
            value: profile?.timezone ?? '—',
          ),
          const SizedBox(height: 1),
          _Divider(),
          _InfoRow(
            icon: Icons.phone_rounded,
            label: 'Phone',
            value: profile?.phoneE164 ?? 'Not set',
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Medical info card
  // ---------------------------------------------------------------------------
  Widget _buildMedicalInfoCard(
    BuildContext context,
    AsyncValue<List<PatientAllergy>> allergiesAsync,
    AsyncValue<List<PatientCondition>> conditionsAsync,
  ) {
    return _SectionCard(
      icon: Icons.medical_services_rounded,
      title: 'Medical Information',
      actionLabel: 'Medical ID',
      onAction: () => context.push('/medical-id-intro'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Allergies
          const _SubLabel(text: 'Allergies'),
          const SizedBox(height: DesignTokens.spaceXs),
          allergiesAsync.when(
            loading: () => _buildShimmerLine(),
            error: (err, _) => const _ErrorLine(
                message: 'Could not load allergies. Pull to refresh.'),
            data: (allergies) => allergies.isEmpty
                ? const _EmptyLine(text: 'No known allergies')
                : Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: allergies.map((a) {
                      final tone = _severityTone(a.severity);
                      return StatusBadge(
                        text:
                            '${a.substance}${a.reaction != null ? ' (${a.reaction})' : ''}',
                        tone: tone,
                        icon: Icons.warning_amber_rounded,
                      );
                    }).toList(),
                  ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          _Divider(),
          const SizedBox(height: DesignTokens.spaceLg),

          // Conditions
          const _SubLabel(text: 'Chronic Conditions'),
          const SizedBox(height: DesignTokens.spaceXs),
          conditionsAsync.when(
            loading: () => _buildShimmerLine(),
            error: (err, _) => const _ErrorLine(
                message: 'Could not load conditions. Pull to refresh.'),
            data: (conditions) => conditions.isEmpty
                ? const _EmptyLine(text: 'No chronic conditions')
                : Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: conditions.map((c) {
                      return Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 12,
                          vertical: 6,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.gray50,
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusSm),
                          border: Border.all(color: AppColors.gray200),
                        ),
                        child: Text(
                          c.conditionName,
                          style: const TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textPrimary,
                          ),
                        ),
                      );
                    }).toList(),
                  ),
          ),
        ],
      ),
    );
  }

  StatusTone _severityTone(String severity) {
    switch (severity.toLowerCase()) {
      case 'severe':
      case 'life_threatening':
        return StatusTone.error;
      case 'high':
      case 'moderate':
        return StatusTone.warning;
      default:
        return StatusTone.info;
    }
  }

  // ---------------------------------------------------------------------------
  // Emergency contacts card
  // ---------------------------------------------------------------------------
  Widget _buildEmergencyContactsCard(
    BuildContext context,
    AsyncValue<List<EmergencyContact>> contactsAsync,
  ) {
    return _SectionCard(
      icon: Icons.contact_phone_rounded,
      title: 'Emergency Contacts',
      actionLabel: 'Manage',
      actionColor: AppColors.secondary,
      onAction: () => context.push('/emergency-contacts-setup'),
      child: contactsAsync.when(
        loading: () => _buildShimmerContacts(),
        error: (err, _) => const _ErrorLine(
            message: 'Could not load emergency contacts. Pull to refresh.'),
        data: (contacts) => contacts.isEmpty
            ? const _EmptyState(
                icon: Icons.contact_phone_outlined,
                text: 'No emergency contacts yet.\nTap "Manage" to add one.',
              )
            : Column(
                children: contacts
                    .map((contact) => _EmergencyContactTile(
                          contact: contact,
                          key: ValueKey(contact.id),
                        ))
                    .toList(),
              ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Account section
  // ---------------------------------------------------------------------------
  Widget _buildAccountSection(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(
              bottom: DesignTokens.spaceXs,
              left: 4,
            ),
            child: Text(
              'ACCOUNT',
              style: TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w800,
                color: AppColors.textSecondary,
                letterSpacing: 1.2,
              ),
            ),
          ),
          Container(
            decoration: BoxDecoration(
              color: AppColors.surface,
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              border: Border.all(color: AppColors.gray200),
              boxShadow: [
                BoxShadow(
                  color: AppColors.black.withValues(alpha: 0.03),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: Column(
              children: [
                _AccountItem(
                  icon: Icons.settings_rounded,
                  title: 'Settings',
                  onTap: () => context.push('/settings'),
                ),
                _Divider(),
                _AccountItem(
                  icon: Icons.notifications_rounded,
                  title: 'Notification Preferences',
                  onTap: () => context.push('/notification-preferences'),
                ),
                _Divider(),
                _AccountItem(
                  icon: Icons.help_outline_rounded,
                  title: 'Help & Support',
                  onTap: () => context.push('/help-support'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Sign out button
  // ---------------------------------------------------------------------------
  Widget _buildSignOutButton() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: SizedBox(
        width: double.infinity,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: _isSigningOut ? null : _signOut,
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            child: Container(
              padding: const EdgeInsets.symmetric(
                vertical: DesignTokens.spaceMd,
              ),
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                color: AppColors.errorContainer,
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.logout_rounded,
                    color: AppColors.error,
                    size: 20,
                  ),
                  SizedBox(width: 8),
                  Text(
                    'Sign Out',
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.error,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Shimmer helpers
  // ---------------------------------------------------------------------------
  Widget _buildShimmerLine() {
    return Shimmer.fromColors(
      baseColor: AppColors.gray200,
      highlightColor: AppColors.gray100,
      child: Container(
        height: 28,
        decoration: BoxDecoration(
          color: AppColors.gray200,
          borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
        ),
      ),
    );
  }

  Widget _buildShimmerContacts() {
    return Shimmer.fromColors(
      baseColor: AppColors.gray200,
      highlightColor: AppColors.gray100,
      child: Column(
        children: List.generate(
          2,
          (_) => Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                Container(
                  width: 44,
                  height: 44,
                  decoration: const BoxDecoration(
                    color: AppColors.gray200,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
                Expanded(
                  child: Container(
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.gray200,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusSm),
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
}

// ---------------------------------------------------------------------------
// Reusable section card
// ---------------------------------------------------------------------------
class _SectionCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String actionLabel;
  final Color? actionColor;
  final VoidCallback onAction;
  final Widget child;

  const _SectionCard({
    required this.icon,
    required this.title,
    required this.actionLabel,
    this.actionColor,
    required this.onAction,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          border: Border.all(color: AppColors.gray200),
          boxShadow: [
            BoxShadow(
              color: AppColors.black.withValues(alpha: 0.03),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header row
              Row(
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(
                      color: AppColors.primaryContainer,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusSm),
                    ),
                    child: Icon(icon, color: AppColors.primary, size: 20),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        letterSpacing: -0.2,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  GestureDetector(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      onAction();
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: (actionColor ?? AppColors.primary)
                            .withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(
                          DesignTokens.radiusFull,
                        ),
                      ),
                      child: Text(
                        actionLabel,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          color: actionColor ?? AppColors.primary,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              child,
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Info row with icon
// ---------------------------------------------------------------------------
class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.textSecondary),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textSecondary,
                    letterSpacing: 0.5,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  value,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textPrimary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Account item
// ---------------------------------------------------------------------------
class _AccountItem extends StatelessWidget {
  final IconData icon;
  final String title;
  final VoidCallback onTap;

  const _AccountItem({
    required this.icon,
    required this.title,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          onTap();
        },
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                decoration: const BoxDecoration(
                  color: AppColors.primaryContainer,
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: AppColors.primary, size: 20),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              const Icon(
                Icons.chevron_right_rounded,
                color: AppColors.gray400,
                size: 22,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Emergency contact tile
// ---------------------------------------------------------------------------
class _EmergencyContactTile extends StatelessWidget {
  final EmergencyContact contact;

  const _EmergencyContactTile({required this.contact, super.key});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          AvatarWidget(name: contact.name, size: 44),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Flexible(
                      child: Text(
                        contact.name,
                        style: const TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    const SizedBox(width: 4),
                    Flexible(
                      child: Text(
                        '(${contact.relationship})',
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textSecondary,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  contact.phoneE164,
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          if (contact.isPrimary) ...[
            const SizedBox(width: 4),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: AppColors.successContainer,
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
              ),
              child: const Text(
                'Primary',
                style: TextStyle(
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: AppColors.success,
                ),
              ),
            ),
          ],
          const SizedBox(width: 4),
          GestureDetector(
            onTap: () async {
              final uri = Uri.parse('tel:${contact.phoneE164}');
              if (await canLaunchUrl(uri)) {
                await launchUrl(uri);
              }
            },
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.secondaryContainer,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.call_rounded,
                color: AppColors.secondary,
                size: 20,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Small reusable widgets
// ---------------------------------------------------------------------------
class _Divider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(height: 1, color: AppColors.gray100);
  }
}

class _SubLabel extends StatelessWidget {
  final String text;
  const _SubLabel({required this.text});

  @override
  Widget build(BuildContext context) {
    return Text(
      text.toUpperCase(),
      style: const TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w800,
        color: AppColors.textSecondary,
        letterSpacing: 0.8,
      ),
    );
  }
}

class _EmptyLine extends StatelessWidget {
  final String text;
  const _EmptyLine({required this.text});

  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: const TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w500,
        color: AppColors.textSecondary,
      ),
    );
  }
}

class _ErrorLine extends StatelessWidget {
  final String message;
  const _ErrorLine({required this.message});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Icon(Icons.error_outline_rounded,
            color: AppColors.error, size: 16),
        const SizedBox(width: 6),
        Expanded(
          child: Text(
            message,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.error,
            ),
          ),
        ),
      ],
    );
  }
}

class _EmptyState extends StatelessWidget {
  final IconData icon;
  final String text;
  const _EmptyState({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
      child: Column(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.gray100,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, size: 24, color: AppColors.gray400),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            text,
            textAlign: TextAlign.center,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w500,
              color: AppColors.textSecondary,
              height: 1.4,
            ),
          ),
        ],
      ),
    );
  }
}
