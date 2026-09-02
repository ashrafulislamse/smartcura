import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/notifications/fcm_service.dart';
import '../../../../core/providers/notification_provider.dart';
import '../../../../core/providers/profile_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Doctor Settings Screen.
///
/// Wired to real backend data via Riverpod providers:
/// - [currentProfileProvider] — doctor name for the header.
/// - [notificationPreferencesProvider] (GET /notifications/preferences/me) — real
///   per-category/channel preferences.
/// - [updatePreferencesProvider] (PUT /notifications/preferences/me) — persists
///   toggle changes with CSRF.
///
/// Notification toggles persist immediately on change, with an inline loading
/// indicator while the PUT is in flight. Quiet hours use a time picker. Sign out
/// calls the real [AuthNotifier.signOut] after a confirmation dialog.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _isSigningOut = false;
  String? _savingCategoryKey;

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /// Build a stable map key for a preference (category + channel).
  String _prefKey(NotificationPreference p) =>
      '${p.category.name}:${p.channel}';

  /// Find a preference by category + channel from the loaded list.
  NotificationPreference? _findPref(
      List<NotificationPreference> prefs,
      NotificationCategory category,
      String channel) {
    return prefs
        .where((p) => p.category == category && p.channel == channel)
        .firstOrNull;
  }

  /// Toggle a single preference and persist it via PUT. Sends the full list
  /// (the endpoint replaces the entire set) with the one row flipped.
  Future<void> _togglePref({
    required NotificationCategory category,
    required String channel,
    required bool newValue,
    required List<NotificationPreference> allPrefs,
  }) async {
    final key = '${category.name}:$channel';
    setState(() => _savingCategoryKey = key);

    final updated = allPrefs.map((p) {
      if (p.category == category && p.channel == channel) {
        return NotificationPreference(
          category: p.category,
          channel: p.channel,
          enabled: newValue,
          quietHoursStart: p.quietHoursStart,
          quietHoursEnd: p.quietHoursEnd,
          timezone: p.timezone,
        );
      }
      return p;
    }).toList();

    final notifier = ref.read(updatePreferencesProvider.notifier);
    final ok = await notifier.call(updated);
    if (ok) {
      ref.invalidate(notificationPreferencesProvider);
    } else {
      final err = ref.read(updatePreferencesProvider).error;
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(err is ApiError
                ? err.displayMessage
                : 'Could not update preference.'),
          ),
        );
      }
    }
    if (mounted) setState(() => _savingCategoryKey = null);
  }

  // ------------------------------------------------------------------
  // Sign out
  // ------------------------------------------------------------------

  Future<void> _showLogoutDialog() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Log Out'),
        content: const Text('Are you sure you want to log out?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.error),
            child: const Text('Log Out'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    setState(() => _isSigningOut = true);
    try {
      // Revoke this device's push registration BEFORE the session is torn
      // down — after the session revoke the call would 401. Best-effort and
      // silently skipped when no device is tracked.
      await ref.read(fcmServiceProvider).revokeTrackedPushDevice();
      await ref.read(authProvider.notifier).signOut();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e is ApiError
                ? e.displayMessage
                : 'Log out failed. Please try again.'),
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isSigningOut = false);
    }
  }

  // ------------------------------------------------------------------
  // Clear cache
  // ------------------------------------------------------------------

  Future<void> _showClearCacheDialog() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Clear Cache'),
        content: const Text(
            'This will clear cached images and temporary data. '
            'Your account data will not be affected.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.primary),
            child: const Text('Clear'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;
    // Clear the in-memory image cache.
    PaintingBinding.instance.imageCache.clear();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Cache cleared successfully'),
        backgroundColor: AppColors.primary,
        duration: Duration(seconds: 2),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Change password (Firebase reset email)
  // ------------------------------------------------------------------

  Future<void> _changePassword() async {
    final profile = ref.read(currentProfileProvider);
    final email = profile?.email;
    if (email == null || email.isEmpty) {
      _showSnack('No email on file for this account.');
      return;
    }
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Change Password'),
        content: Text(
            'A password-reset email will be sent to:\n$email\n\n'
            'Follow the link in the email to set a new password.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: AppColors.primary),
            child: const Text('Send Email'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    final ok = await ref.read(authProvider.notifier).sendPasswordReset(email);
    if (!mounted) return;
    _showSnack(ok
        ? 'Password-reset email sent to $email'
        : ref.read(authProvider).error ??
            'Could not send reset email. Try again later.');
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  // ------------------------------------------------------------------
  // Quiet hours time picker
  // ------------------------------------------------------------------

  Future<void> _pickTime({
    required bool isStart,
    required NotificationPreference pref,
    required List<NotificationPreference> allPrefs,
  }) async {
    final current = isStart ? pref.quietHoursStart : pref.quietHoursEnd;
    TimeOfDay initial = const TimeOfDay(hour: 22, minute: 0);
    if (current != null && current.isNotEmpty) {
      final parts = current.split(':');
      if (parts.length >= 2) {
        initial = TimeOfDay(
          hour: int.tryParse(parts[0]) ?? 22,
          minute: int.tryParse(parts[1]) ?? 0,
        );
      }
    }
    final picked = await showTimePicker(
      context: context,
      initialTime: initial,
      helpText: isStart ? 'Select quiet hours start' : 'Select quiet hours end',
    );
    if (picked == null) return;

    final formatted =
        '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}';
    final key = '${pref.category.name}:${pref.channel}';
    setState(() => _savingCategoryKey = key);

    final updated = allPrefs.map((p) {
      if (p.category == pref.category && p.channel == pref.channel) {
        return NotificationPreference(
          category: p.category,
          channel: p.channel,
          enabled: p.enabled,
          quietHoursStart: isStart ? formatted : p.quietHoursStart,
          quietHoursEnd: isStart ? p.quietHoursEnd : formatted,
          timezone: p.timezone,
        );
      }
      return p;
    }).toList();

    final notifier = ref.read(updatePreferencesProvider.notifier);
    final ok = await notifier.call(updated);
    if (ok) {
      ref.invalidate(notificationPreferencesProvider);
    } else {
      if (mounted) _showSnack('Could not update quiet hours.');
    }
    if (mounted) setState(() => _savingCategoryKey = null);
  }

  // ------------------------------------------------------------------
  // Build
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(currentProfileProvider);
    final prefsAsync = ref.watch(notificationPreferencesProvider);
    final membershipId = ref.watch(activeMembershipIdProvider);
    final detailsAsync = membershipId != null
        ? ref.watch(doctorDetailsProvider(membershipId))
        : null;

    final displayName = profile?.displayName ?? 'Doctor';
    final specialty = detailsAsync?.valueOrNull?.specialties.isNotEmpty == true
        ? detailsAsync!.valueOrNull!.specialties.first
        : 'Doctor';

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: AppColors.gray900),
          onPressed: () => context.pop(),
        ),
        title: Text(
          'Settings',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.gray900,
              ),
        ),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Profile header
            _buildProfileHeader(displayName, specialty),
            const SizedBox(height: DesignTokens.spaceLg),

            // Notifications
            _buildSectionHeader('NOTIFICATIONS'),
            prefsAsync.when(
              data: (list) => _buildNotificationSection(list.data),
              loading: () => const Padding(
                padding: EdgeInsets.all(DesignTokens.spaceXl),
                child: LoadingOverlay(label: 'Loading preferences…'),
              ),
              error: (err, _) => _buildInlineError(err, _retryPrefs),
            ),

            const SizedBox(height: DesignTokens.spaceXl),

            // General
            _buildSectionHeader('GENERAL'),
            _buildGeneralSection(profile),

            const SizedBox(height: DesignTokens.spaceXl),

            // Privacy & Security
            _buildSectionHeader('PRIVACY & SECURITY'),
            _buildSecuritySection(),

            const SizedBox(height: DesignTokens.spaceXl),

            // Data & Storage
            _buildSectionHeader('DATA & STORAGE'),
            _buildDataSection(),

            const SizedBox(height: DesignTokens.spaceXl),

            // Log out
            _buildLogoutButton(),

            const SizedBox(height: DesignTokens.spaceLg),
            _buildVersionFooter(),
            const SizedBox(height: DesignTokens.space2xl),
          ],
        ),
      ),
    );
  }

  void _retryPrefs() {
    ref.invalidate(notificationPreferencesProvider);
  }

  // ------------------------------------------------------------------
  // Profile header
  // ------------------------------------------------------------------

  Widget _buildProfileHeader(String displayName, String specialty) {
    return Container(
      margin: const EdgeInsets.fromLTRB(
          DesignTokens.spaceMd, DesignTokens.spaceSm, DesignTokens.spaceMd, 0),
      child: PremiumCard(
        child: Row(
          children: [
            AvatarWidget(name: displayName, size: DesignTokens.avatar2xl),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    displayName,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: AppColors.gray900,
                        ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    specialty,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.gray500,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXs),
                  GestureDetector(
                    onTap: () => context.push('/edit-profile'),
                    child: Text(
                      'Edit Profile',
                      style: Theme.of(context).textTheme.labelMedium?.copyWith(
                            color: AppColors.primary,
                            fontWeight: FontWeight.w600,
                          ),
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

  // ------------------------------------------------------------------
  // Notification section
  // ------------------------------------------------------------------

  Widget _buildNotificationSection(List<NotificationPreference> prefs) {
    if (prefs.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd),
        child: PremiumCard(
          child: Text(
            'No notification preferences found.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray500,
                ),
          ),
        ),
      );
    }

    // Define the toggles we surface, mapped to category + channel.
    final toggleDefs = <_ToggleDef>[
      _ToggleDef(
        icon: Icons.calendar_today_rounded,
        iconTone: StatTone.info,
        category: NotificationCategory.appointments,
        channel: 'push',
        title: 'Appointment Requests',
      ),
      _ToggleDef(
        icon: Icons.chat_bubble_outline_rounded,
        iconTone: StatTone.success,
        category: NotificationCategory.messages,
        channel: 'push',
        title: 'Patient Messages',
      ),
      _ToggleDef(
        icon: Icons.notifications_outlined,
        iconTone: StatTone.warning,
        category: NotificationCategory.appointments,
        channel: 'email',
        title: 'Appointment Reminders',
      ),
      _ToggleDef(
        icon: Icons.monitor_heart_outlined,
        iconTone: StatTone.error,
        category: NotificationCategory.vitalsAlerts,
        channel: 'push',
        title: 'Vitals Alerts',
      ),
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: PremiumCard(
        child: Column(
          children: [
            for (int i = 0; i < toggleDefs.length; i++) ...[
              _buildPrefToggle(toggleDefs[i], prefs),
              if (i < toggleDefs.length - 1)
                const Padding(
                  padding: EdgeInsets.symmetric(
                      vertical: DesignTokens.spaceXs),
                  child: Divider(
                      height: 1, thickness: 0.5, color: AppColors.gray200),
                ),
            ],
            const SizedBox(height: DesignTokens.spaceMd),
            // Quiet hours row
            _buildQuietHoursRow(prefs),
          ],
        ),
      ),
    );
  }

  Widget _buildPrefToggle(_ToggleDef def, List<NotificationPreference> prefs) {
    final pref = _findPref(prefs, def.category, def.channel);
    final isEnabled = pref?.enabled ?? false;
    final key = '${def.category.name}:${def.channel}';
    final isSaving = _savingCategoryKey == key;

    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: _toneContainer(def.iconTone),
            borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
          ),
          child: Icon(def.icon, color: _toneFg(def.iconTone), size: 18),
        ),
        const SizedBox(width: DesignTokens.spaceSm + 2),
        Expanded(
          child: Text(
            def.title,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: AppColors.gray900,
                ),
          ),
        ),
        if (isSaving)
          const SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppColors.primary,
            ),
          )
        else
          Switch(
            value: isEnabled,
            onChanged: pref == null
                ? null
                : (v) => _togglePref(
                      category: def.category,
                      channel: def.channel,
                      newValue: v,
                      allPrefs: prefs,
                    ),
            activeColor: AppColors.primary,
          ),
      ],
    );
  }

  Widget _buildQuietHoursRow(List<NotificationPreference> prefs) {
    // Use the first push preference that has quiet hours, or the first push pref.
    final pushPref = prefs
        .where((p) => p.channel == 'push')
        .firstOrNull;
    if (pushPref == null) return const SizedBox.shrink();

    final key = _prefKey(pushPref);
    final isSaving = _savingCategoryKey == key;
    final start = pushPref.quietHoursStart ?? '--:--';
    final end = pushPref.quietHoursEnd ?? '--:--';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Divider(height: 1, thickness: 0.5, color: AppColors.gray200),
        const SizedBox(height: DesignTokens.spaceMd),
        Text(
          'Quiet Hours',
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray700,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        Row(
          children: [
            Expanded(
              child: _buildTimeTile(
                label: 'Start',
                value: start,
                isSaving: isSaving,
                onTap: () => _pickTime(
                    isStart: true, pref: pushPref, allPrefs: prefs),
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm + 2),
            Expanded(
              child: _buildTimeTile(
                label: 'End',
                value: end,
                isSaving: isSaving,
                onTap: () => _pickTime(
                    isStart: false, pref: pushPref, allPrefs: prefs),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildTimeTile({
    required String label,
    required String value,
    required bool isSaving,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: isSaving ? null : onTap,
      borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd, vertical: DesignTokens.spaceSm + 2),
        decoration: BoxDecoration(
          color: AppColors.surfaceVariant,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        ),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.schedule_rounded,
                size: DesignTokens.iconXs, color: AppColors.primary),
            const SizedBox(width: DesignTokens.spaceXs),
            Text(
              value,
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w600,
                    color: AppColors.gray900,
                  ),
            ),
            const SizedBox(width: DesignTokens.spaceXs),
            Text(
              label,
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: AppColors.gray500,
                  ),
            ),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // General section
  // ------------------------------------------------------------------

  Widget _buildGeneralSection(Profile? profile) {
    final locale = profile?.preferredLocale ?? 'en';
    final timezone = profile?.timezone ?? 'UTC';
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: PremiumCard(
        child: Column(
          children: [
            _buildNavTile(
              icon: Icons.language_rounded,
              iconTone: StatTone.info,
              title: 'Language',
              trailing: _localeLabel(locale),
              onTap: () {},
            ),
            const Divider(
                height: 1, thickness: 0.5, color: AppColors.gray200),
            _buildNavTile(
              icon: Icons.dark_mode_outlined,
              iconTone: StatTone.neutral,
              title: 'Theme',
              trailing: 'Light',
              onTap: () {},
            ),
            const Divider(
                height: 1, thickness: 0.5, color: AppColors.gray200),
            _buildNavTile(
              icon: Icons.schedule_rounded,
              iconTone: StatTone.primary,
              title: 'Time Zone',
              trailing: timezone,
              onTap: () {},
            ),
          ],
        ),
      ),
    );
  }

  String _localeLabel(String locale) {
    return switch (locale) {
      'en' => 'English',
      'ms' => 'Bahasa Melayu',
      'zh' => '中文',
      _ => locale,
    };
  }

  // ------------------------------------------------------------------
  // Security section
  // ------------------------------------------------------------------

  Widget _buildSecuritySection() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: PremiumCard(
        child: Column(
          children: [
            _buildNavTile(
              icon: Icons.lock_outline_rounded,
              iconTone: StatTone.neutral,
              title: 'Change Password',
              onTap: _changePassword,
            ),
            const Divider(
                height: 1, thickness: 0.5, color: AppColors.gray200),
            _buildNavTile(
              icon: Icons.security_outlined,
              iconTone: StatTone.info,
              title: 'Two-Factor Auth',
              trailing: 'Not Enabled',
              onTap: () {},
            ),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Data section
  // ------------------------------------------------------------------

  Widget _buildDataSection() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: PremiumCard(
        onTap: _showClearCacheDialog,
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: AppColors.infoContainer,
                borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
              ),
              child: const Icon(Icons.cleaning_services_outlined,
                  color: AppColors.info, size: 18),
            ),
            const SizedBox(width: DesignTokens.spaceSm + 2),
            Expanded(
              child: Text(
                'Clear Cache',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: AppColors.info,
                    ),
              ),
            ),
            const Icon(Icons.chevron_right_rounded,
                color: AppColors.gray400, size: DesignTokens.iconMd),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Logout button
  // ------------------------------------------------------------------

  Widget _buildLogoutButton() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: SizedBox(
        width: double.infinity,
        child: OutlinedButton(
          onPressed: _isSigningOut ? null : _showLogoutDialog,
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.error,
            side: BorderSide(
                color: AppColors.error.withValues(alpha: 0.25), width: 1.5),
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
              : const Text(
                  'Log Out',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                  ),
                ),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Shared tiles
  // ------------------------------------------------------------------

  Widget _buildNavTile({
    required IconData icon,
    required StatTone iconTone,
    required String title,
    String? trailing,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
      child: Padding(
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceSm,
            vertical: DesignTokens.spaceSm + 2),
        child: Row(
          children: [
            Container(
              width: 36,
              height: 36,
              decoration: BoxDecoration(
                color: _toneContainer(iconTone),
                borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
              ),
              child: Icon(icon, color: _toneFg(iconTone), size: 18),
            ),
            const SizedBox(width: DesignTokens.spaceSm + 2),
            Expanded(
              child: Text(
                title,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: AppColors.gray900,
                    ),
              ),
            ),
            if (trailing != null) ...[
              Text(
                trailing,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppColors.gray500,
                    ),
              ),
              const SizedBox(width: DesignTokens.spaceXs),
            ],
            const Icon(Icons.chevron_right_rounded,
                color: AppColors.gray400, size: DesignTokens.iconMd),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(DesignTokens.spaceMd + 4,
          0, DesignTokens.spaceMd, DesignTokens.spaceSm),
      child: Text(
        title,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              color: AppColors.gray500,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.5,
            ),
      ),
    );
  }

  Widget _buildInlineError(Object err, VoidCallback onRetry) {
    final apiError = err is ApiError ? err : toApiError(err);
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: PremiumCard(
        child: Column(
          children: [
            Icon(Icons.error_outline_rounded,
                color: apiError.isForbidden
                    ? AppColors.warning
                    : AppColors.error,
                size: DesignTokens.iconLg),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              apiError.displayMessage,
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.gray600,
                  ),
            ),
            if (!apiError.isForbidden) ...[
              const SizedBox(height: DesignTokens.spaceMd),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('Retry'),
              ),
            ],
          ],
        ),
      ),
    );
  }

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
  // Tone color helpers (mirror StatCard's internal mapping)
  // ------------------------------------------------------------------

  Color _toneContainer(StatTone tone) => switch (tone) {
        StatTone.primary => AppColors.primaryContainer,
        StatTone.success => AppColors.successContainer,
        StatTone.warning => AppColors.warningContainer,
        StatTone.error => AppColors.errorContainer,
        StatTone.info => AppColors.infoContainer,
        StatTone.neutral => AppColors.gray100,
      };

  Color _toneFg(StatTone tone) => switch (tone) {
        StatTone.primary => AppColors.primary,
        StatTone.success => AppColors.success,
        StatTone.warning => AppColors.warning,
        StatTone.error => AppColors.error,
        StatTone.info => AppColors.info,
        StatTone.neutral => AppColors.gray500,
      };
}

/// Internal model for a notification toggle definition.
class _ToggleDef {
  const _ToggleDef({
    required this.icon,
    required this.iconTone,
    required this.category,
    required this.channel,
    required this.title,
  });
  final IconData icon;
  final StatTone iconTone;
  final NotificationCategory category;
  final String channel;
  final String title;
}
