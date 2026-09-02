import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/notification_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/loading_overlay.dart';
import '../../../../core/widgets/premium_card.dart';

/// Settings Screen
///
/// Wires notification toggles to [notificationPreferencesProvider] and persists
/// changes via [updateNotificationPreferences]. "Clear Cache" clears the
/// in-memory image cache. "Logout" calls [AuthNotifier.signOut].
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;
  bool _isSigningOut = false;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 500),
      vsync: this,
    );
    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeOut),
    );
    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, 0.05),
      end: Offset.zero,
    ).animate(CurvedAnimation(
        parent: _animationController, curve: Curves.easeOutCubic));
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
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Sign Out?',
            style: TextStyle(
                fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
        content: const Text(
            'You will need to sign in again to access your account.',
            style: TextStyle(color: AppColors.textSecondary)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: AppColors.white,
            ),
            child: const Text('Sign Out',
                style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    setState(() => _isSigningOut = true);
    await ref.read(authProvider.notifier).signOut();
    if (mounted) setState(() => _isSigningOut = false);
  }

  Future<void> _clearCache() async {
    HapticFeedback.lightImpact();
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
        title: const Text('Clear Cache?',
            style: TextStyle(
                fontWeight: FontWeight.w700, color: AppColors.textPrimary)),
        content: const Text(
            'This will clear cached images and temporary data. '
            'Your medical data will not be affected.',
            style: TextStyle(color: AppColors.textSecondary)),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel',
                style: TextStyle(color: AppColors.textSecondary)),
          ),
          ElevatedButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              foregroundColor: AppColors.white,
            ),
            child: const Text('Clear',
                style: TextStyle(fontWeight: FontWeight.w700)),
          ),
        ],
      ),
    );

    if (confirmed != true || !mounted) return;

    // Clear the image cache.
    PaintingBinding.instance.imageCache.clear();
    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Cache cleared'),
          backgroundColor: AppColors.success,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final prefsAsync = ref.watch(notificationPreferencesProvider);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Stack(
          children: [
            Column(
              children: [
                _buildHeader(),
                Expanded(
                  child: FadeTransition(
                    opacity: _fadeAnimation,
                    child: SlideTransition(
                      position: _slideAnimation,
                      child: SingleChildScrollView(
                        physics: const BouncingScrollPhysics(),
                        child: Padding(
                          padding: const EdgeInsets.all(DesignTokens.spaceMd),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              _buildSectionHeader('ACCOUNT'),
                              const SizedBox(height: DesignTokens.spaceSm),
                              _buildAccountSection(),
                              const SizedBox(height: DesignTokens.spaceLg),
                              _buildSectionHeader('NOTIFICATIONS'),
                              const SizedBox(height: DesignTokens.spaceSm),
                              _buildNotificationsSection(prefsAsync),
                              const SizedBox(height: DesignTokens.spaceLg),
                              _buildSectionHeader('PRIVACY & SECURITY'),
                              const SizedBox(height: DesignTokens.spaceSm),
                              _buildPrivacySection(),
                              const SizedBox(height: DesignTokens.spaceLg),
                              _buildSectionHeader('PREFERENCES'),
                              const SizedBox(height: DesignTokens.spaceSm),
                              _buildPreferencesSection(),
                              const SizedBox(height: DesignTokens.spaceLg),
                              _buildLogoutButton(),
                              const SizedBox(height: DesignTokens.spaceMd),
                              _buildVersionInfo(),
                              const SizedBox(height: DesignTokens.spaceLg),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
            if (_isSigningOut) const LoadingOverlay(message: 'Signing out…'),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      color: AppColors.background,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.screenPaddingHorizontal,
              vertical: DesignTokens.spaceMd),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: AppColors.gray100,
                ),
                child: Material(
                  color: Colors.transparent,
                  child: InkWell(
                    onTap: () => context.pop(),
                    borderRadius: BorderRadius.circular(20),
                    child: const Center(
                      child: Icon(Icons.arrow_back_ios_new,
                          size: 20, color: AppColors.primary),
                    ),
                  ),
                ),
              ),
              const Expanded(
                child: Text(
                  'Settings',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.bold,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              const SizedBox(width: 40),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(left: DesignTokens.spaceMd),
      child: Text(
        title,
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.bold,
          color: AppColors.secondary.withOpacity(0.8),
          letterSpacing: 1.2,
        ),
      ),
    );
  }

  Widget _buildAccountSection() {
    return PremiumCard(
      margin: EdgeInsets.zero,
      child: Column(
        children: [
          _buildSettingItem(
            icon: Icons.person,
            title: 'Edit Profile',
            onTap: () => context.push('/edit-profile'),
          ),
          _buildDivider(),
          // Password changes are not yet supported by the backend; hide the row
          // to avoid a dead-end snackbar during the demo.
          // _buildSettingItem(
          //   icon: Icons.lock,
          //   title: 'Email & Password',
          //   onTap: () { ... },
          // ),
        ],
      ),
    );
  }

  Widget _buildNotificationsSection(
      AsyncValue<List<NotificationPreference>> prefsAsync) {
    return PremiumCard(
      margin: EdgeInsets.zero,
      child: prefsAsync.when(
        loading: () => const Center(
          child: Padding(
            padding: EdgeInsets.all(DesignTokens.spaceLg),
            child: CircularProgressIndicator(color: AppColors.primary),
          ),
        ),
        error: (err, _) => Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceLg),
          child: Text(
            err is ApiError ? err.userMessage : 'Could not load preferences',
            style: const TextStyle(color: AppColors.error, fontSize: 13),
          ),
        ),
        data: (prefs) {
          // Aggregate by channel to show master toggles.
          final pushEnabled = _isChannelEnabled(prefs, 'push');
          final emailEnabled = _isChannelEnabled(prefs, 'email');

          return Column(
            children: [
              _buildToggleItem(
                icon: Icons.notifications,
                title: 'Push Notifications',
                value: pushEnabled,
                onChanged: (value) => _toggleChannel(prefs, 'push', value),
              ),
              _buildDivider(),
              _buildToggleItem(
                icon: Icons.mail,
                title: 'Email Alerts',
                value: emailEnabled,
                onChanged: (value) => _toggleChannel(prefs, 'email', value),
              ),
              _buildDivider(),
              _buildSettingItem(
                icon: Icons.tune,
                title: 'Notification Preferences',
                trailing: 'Details',
                onTap: () => context.push('/notification-preferences'),
              ),
            ],
          );
        },
      ),
    );
  }

  bool _isChannelEnabled(List<NotificationPreference> prefs, String channel) {
    final channelPrefs = prefs.where((p) => p.channel == channel).toList();
    if (channelPrefs.isEmpty) return false;
    // Master toggle is on if any category under this channel is enabled.
    return channelPrefs.any((p) => p.enabled);
  }

  Future<void> _toggleChannel(
      List<NotificationPreference> prefs, String channel, bool enabled) async {
    HapticFeedback.lightImpact();
    // Update all preferences for this channel.
    for (final p in prefs.where((p) => p.channel == channel)) {
      await updateNotificationPreferences(ref,
          category: p.category.wireValue, channel: channel, enabled: enabled);
    }
  }

  Widget _buildPrivacySection() {
    return PremiumCard(
      margin: EdgeInsets.zero,
      child: Column(
        children: [
          _buildSettingItem(
            icon: Icons.cleaning_services,
            title: 'Clear Cache',
            onTap: _clearCache,
          ),
          _buildDivider(),
          // Data sharing settings are not yet supported; hide the row to keep
          // the demo surface clean.
          // _buildSettingItem(
          //   icon: Icons.share,
          //   title: 'Data Sharing',
          //   onTap: () { ... },
          // ),
        ],
      ),
    );
  }

  Widget _buildPreferencesSection() {
    return PremiumCard(
      margin: EdgeInsets.zero,
      child: Column(
        children: [
          _buildSettingItem(
            icon: Icons.language,
            title: 'Language',
            trailing: 'English',
            onTap: () => context.push('/edit-profile'),
          ),
          _buildDivider(),
          // Theme switching is not yet supported; only Light is implemented.
          // Keep the row read-only to show the current theme without a dead-end.
          _buildSettingItem(
            icon: Icons.light_mode,
            title: 'Theme',
            trailing: 'Light',
            onTap: () {},
          ),
        ],
      ),
    );
  }

  Widget _buildSettingItem({
    required IconData icon,
    required String title,
    String? trailing,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: () {
          HapticFeedback.lightImpact();
          onTap();
        },
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.primary.withOpacity(0.1),
                  shape: BoxShape.circle,
                ),
                child: Icon(icon, color: AppColors.primary, size: 20),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Text(
                  title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              if (trailing != null) ...[
                Text(
                  trailing,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
              ],
              const Icon(Icons.chevron_right,
                  color: AppColors.gray400, size: 20),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildToggleItem({
    required IconData icon,
    required String title,
    required bool value,
    required ValueChanged<bool> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: AppColors.primary, size: 20),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Text(
              title,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
          ),
          _buildCustomSwitch(value: value, onChanged: onChanged),
        ],
      ),
    );
  }

  Widget _buildCustomSwitch(
      {required bool value, required ValueChanged<bool> onChanged}) {
    return GestureDetector(
      onTap: () => onChanged(!value),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        width: 51,
        height: 31,
        decoration: BoxDecoration(
          color: value ? AppColors.primary : AppColors.gray200,
          borderRadius: BorderRadius.circular(20),
        ),
        padding: const EdgeInsets.all(2),
        child: AnimatedAlign(
          duration: const Duration(milliseconds: 200),
          alignment: value ? Alignment.centerRight : Alignment.centerLeft,
          child: Container(
            width: 27,
            height: 27,
            decoration: const BoxDecoration(
              color: AppColors.white,
              shape: BoxShape.circle,
              boxShadow: [
                BoxShadow(
                    color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDivider() => Container(
        height: 1,
        margin: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
        color: AppColors.gray100,
      );

  Widget _buildLogoutButton() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: PremiumCard(
        margin: EdgeInsets.zero,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: _isSigningOut ? null : _signOut,
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            child: const Padding(
              padding: EdgeInsets.all(DesignTokens.spaceMd),
              child: Center(
                child: Text(
                  'Sign Out',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                    color: AppColors.error,
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildVersionInfo() {
    return const Center(
      child: Text(
        'SmartCura Patient',
        style: TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          color: AppColors.gray400,
        ),
      ),
    );
  }
}
