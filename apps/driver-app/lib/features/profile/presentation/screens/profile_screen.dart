import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  @override
  Widget build(BuildContext context) {
    final profileAsync = ref.watch(profileProvider);
    final ratingsAsync = ref.watch(driverRatingsProvider);
    final vehiclesAsync = ref.watch(vehiclesProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: StateView<Profile>(
        isLoading: profileAsync.isLoading,
        error: profileAsync.hasError ? _errorMessage(profileAsync.error) : null,
        data: profileAsync.value,
        onRetry: () => ref.invalidate(profileProvider),
        emptyTitle: 'Profile unavailable',
        emptyBody: 'Your profile could not be loaded.',
        emptyIcon: Icons.person_off_outlined,
        builder: (profile) => RefreshIndicator(
          color: AppColors.primary,
          onRefresh: () async {
            ref.invalidate(profileProvider);
            ref.invalidate(driverRatingsProvider);
            ref.invalidate(vehiclesProvider);
          },
          child: CustomScrollView(
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: [
              SliverToBoxAdapter(
                child: _ProfileHeader(profile: profile),
              ),
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(
                  DesignTokens.screenPaddingHorizontal,
                  DesignTokens.spaceMd,
                  DesignTokens.screenPaddingHorizontal,
                  DesignTokens.spaceXxl,
                ),
                sliver: SliverList(
                  delegate: SliverChildListDelegate([
                    // ---- Personal info ----
                    _PersonalInfoCard(profile: profile),
                    const SizedBox(height: DesignTokens.spaceMd),

                    // ---- Vehicle info ----
                    _VehicleInfoCard(vehicles: vehiclesAsync.value),
                    const SizedBox(height: DesignTokens.spaceMd),

                    // ---- Rating ----
                    _RatingCard(ratings: ratingsAsync.value),
                    const SizedBox(height: DesignTokens.spaceLg),

                    // ---- Action buttons ----
                    _ActionButtons(
                      onEditProfile: () => context.push('/edit-profile'),
                      onSettings: () => context.push('/settings'),
                      onHelpSupport: () => context.push('/help-support'),
                      onSignOut: _confirmSignOut,
                    ),
                    const SizedBox(height: DesignTokens.spaceXxl),
                  ]),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _errorMessage(Object? error) {
    if (error is ApiError) return error.displayMessage;
    return error?.toString() ?? 'Something went wrong';
  }

  void _confirmSignOut() {
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sign Out?'),
        content: const Text('You will need to sign in again to continue.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(ctx);
              ref.read(authProvider.notifier).signOut();
            },
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.emergency,
            ),
            child: const Text('Sign Out',
                style: TextStyle(color: AppColors.white)),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Profile header — avatar, name, email
// ---------------------------------------------------------------------------

class _ProfileHeader extends StatelessWidget {
  const _ProfileHeader({required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        gradient: AppColors.primaryGradient,
        borderRadius: BorderRadius.vertical(bottom: Radius.circular(28)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 56, 20, 28),
      child: Column(
        children: [
          AvatarWidget(
            name: profile.displayName,
            imageUrl: profile.avatarUrl,
            size: 88,
            gradient: LinearGradient(
              colors: [
                AppColors.white.withValues(alpha: 0.3),
                AppColors.white.withValues(alpha: 0.15),
              ],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            profile.displayName,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.white,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: DesignTokens.spaceXs),
          Text(
            profile.email,
            style: TextStyle(
              fontSize: 13,
              color: AppColors.white.withValues(alpha: 0.7),
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Personal info card
// ---------------------------------------------------------------------------

class _PersonalInfoCard extends StatelessWidget {
  const _PersonalInfoCard({required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _CardTitle(
            icon: Icons.person_outline_rounded,
            title: 'Personal Information',
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          _InfoRow(
            icon: Icons.email_rounded,
            label: 'Email',
            value: profile.email,
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _InfoRow(
            icon: Icons.phone_rounded,
            label: 'Phone',
            value: profile.phoneE164 ?? 'Not set',
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _InfoRow(
            icon: Icons.translate_rounded,
            label: 'Language',
            value: profile.preferredLocale.isNotEmpty
                ? profile.preferredLocale
                : 'Not set',
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Vehicle info card
// ---------------------------------------------------------------------------

class _VehicleInfoCard extends StatelessWidget {
  const _VehicleInfoCard({required this.vehicles});
  final VehicleList? vehicles;

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _CardTitle(
            icon: Icons.directions_car_rounded,
            title: 'Vehicle Information',
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          if (vehicles == null)
            const _InfoRow(
              icon: Icons.hourglass_empty_rounded,
              label: 'Loading vehicles…',
              value: '',
            )
          else if (vehicles!.data.isEmpty)
            const _InfoRow(
              icon: Icons.no_crash_rounded,
              label: 'No vehicles registered',
              value: '',
            )
          else
            ...vehicles!.data.map((v) => Padding(
                  padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
                  child: _InfoRow(
                    icon: v.active
                        ? Icons.check_circle_rounded
                        : Icons.pause_circle_rounded,
                    label: v.plateNumber,
                    value:
                        '${v.vehicleType} · ${v.active ? "Active" : "Inactive"}',
                    iconColor:
                        v.active ? AppColors.success : AppColors.textSecondary,
                  ),
                )),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Rating card
// ---------------------------------------------------------------------------

class _RatingCard extends StatelessWidget {
  const _RatingCard({required this.ratings});
  final DriverRatingList? ratings;

  @override
  Widget build(BuildContext context) {
    final avg = ratings?.averageStars;
    final total = ratings?.totalRatings ?? 0;

    return PremiumCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const _CardTitle(
            icon: Icons.star_outline_rounded,
            title: 'Rating',
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Row(
            children: [
              // Average stars display
              Text(
                avg != null ? avg.toStringAsFixed(1) : '—',
                style: const TextStyle(
                  fontSize: 32,
                  fontWeight: FontWeight.w900,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              // Star icons row
              Row(
                children: List.generate(5, (i) {
                  final filled = avg != null && i < avg.round();
                  return Icon(
                    filled ? Icons.star_rounded : Icons.star_border_rounded,
                    color: AppColors.warning,
                    size: DesignTokens.iconMd,
                  );
                }),
              ),
              const Spacer(),
              Text(
                '$total\nratings',
                textAlign: TextAlign.right,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                  height: 1.3,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Action buttons — edit, settings, help, sign out
// ---------------------------------------------------------------------------

class _ActionButtons extends StatelessWidget {
  const _ActionButtons({
    required this.onEditProfile,
    required this.onSettings,
    required this.onHelpSupport,
    required this.onSignOut,
  });

  final VoidCallback onEditProfile;
  final VoidCallback onSettings;
  final VoidCallback onHelpSupport;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _MenuTile(
          icon: Icons.edit_rounded,
          label: 'Edit Profile',
          onTap: onEditProfile,
        ),
        const SizedBox(height: DesignTokens.spaceXs),
        _MenuTile(
          icon: Icons.settings_rounded,
          label: 'Settings',
          onTap: onSettings,
        ),
        const SizedBox(height: DesignTokens.spaceXs),
        _MenuTile(
          icon: Icons.help_outline_rounded,
          label: 'Help & Support',
          onTap: onHelpSupport,
        ),
        const SizedBox(height: DesignTokens.spaceLg),
        // Sign out — outlined danger button.
        SizedBox(
          width: double.infinity,
          child: OutlinedButton.icon(
            onPressed: onSignOut,
            icon: const Icon(Icons.logout_rounded, size: 18),
            label: const Text(
              'Sign Out',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
            ),
            style: OutlinedButton.styleFrom(
              foregroundColor: AppColors.emergency,
              side: const BorderSide(color: AppColors.emergency),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              minimumSize: const Size.fromHeight(DesignTokens.buttonHeightMd),
            ),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Shared sub-widgets
// ---------------------------------------------------------------------------

class _CardTitle extends StatelessWidget {
  const _CardTitle({required this.icon, required this.title});
  final IconData icon;
  final String title;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: AppColors.primary, size: DesignTokens.iconSm),
        const SizedBox(width: DesignTokens.spaceSm),
        Text(
          title,
          style: const TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
    this.iconColor = AppColors.textSecondary,
  });
  final IconData icon;
  final String label;
  final String value;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: iconColor, size: DesignTokens.iconSm),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: Text(
            label,
            style: const TextStyle(
              fontSize: 13,
              color: AppColors.textSecondary,
            ),
          ),
        ),
        Flexible(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
            textAlign: TextAlign.end,
          ),
        ),
      ],
    );
  }
}

class _MenuTile extends StatelessWidget {
  const _MenuTile(
      {required this.icon, required this.label, required this.onTap});
  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
      child: PremiumCard(
        child: Row(
          children: [
            Icon(icon, color: AppColors.primary, size: DesignTokens.iconSm),
            const SizedBox(width: DesignTokens.spaceSm),
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
            const Icon(Icons.chevron_right_rounded,
                color: AppColors.gray400, size: DesignTokens.iconSm),
          ],
        ),
      ),
    );
  }
}
