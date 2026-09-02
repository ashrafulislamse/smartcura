import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../core/providers/providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// SharedPreferences keys for local preferences.
///
/// These are client-side only; backend notification preferences use
/// [notificationPreferencesProvider]. The dark-mode preference is persisted
/// here so main.dart can read it at launch (when wired up); for now we store
/// the value so the toggle survives app restarts.
const _kPrefDarkMode = 'pref_dark_mode';
const _kPrefPushOrders = 'pref_push_orders';
const _kPrefPushPayments = 'pref_push_payments';
const _kPrefPushEmergency = 'pref_push_emergency';
const _kPrefPushPromotions = 'pref_push_promotions';
const _kPrefSoundAlerts = 'pref_sound_alerts';
const _kPrefVibration = 'pref_vibration';

/// App version shown in the About section (static for now).
const _appVersion = 'v1.0.0 (Build 1)';

class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  // ---- Local preference toggles ----
  bool _darkMode = false;
  bool _pushOrders = true;
  bool _pushPayments = true;
  bool _pushEmergency = true;
  bool _pushPromotions = false;
  bool _soundAlerts = true;
  bool _vibration = true;
  bool _prefsLoaded = false;

  @override
  void initState() {
    super.initState();
    _loadPreferences();
  }

  Future<void> _loadPreferences() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    setState(() {
      _darkMode = prefs.getBool(_kPrefDarkMode) ?? false;
      _pushOrders = prefs.getBool(_kPrefPushOrders) ?? true;
      _pushPayments = prefs.getBool(_kPrefPushPayments) ?? true;
      _pushEmergency = prefs.getBool(_kPrefPushEmergency) ?? true;
      _pushPromotions = prefs.getBool(_kPrefPushPromotions) ?? false;
      _soundAlerts = prefs.getBool(_kPrefSoundAlerts) ?? true;
      _vibration = prefs.getBool(_kPrefVibration) ?? true;
      _prefsLoaded = true;
    });
  }

  Future<void> _savePref(String key, bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(key, value);
  }

  void _toggleDarkMode(bool v) {
    setState(() => _darkMode = v);
    _savePref(_kPrefDarkMode, v);
    // Note: applying ThemeMode would require main.dart to read this pref at
    // launch. For now we persist the preference; the actual theme switch is
    // wired up separately.
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(profileProvider).value;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Settings'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: _prefsLoaded
          ? SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(
                DesignTokens.screenPaddingHorizontal,
                DesignTokens.spaceSm,
                DesignTokens.screenPaddingHorizontal,
                DesignTokens.spaceXxl,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ---- Appearance ----
                  const _SectionHeader(title: 'Appearance'),
                  PremiumCard(
                    child: _SwitchRow(
                      icon: Icons.dark_mode_rounded,
                      iconColor: AppColors.textSecondary,
                      title: 'Dark Mode',
                      subtitle: 'Use dark theme throughout the app',
                      value: _darkMode,
                      onChanged: _toggleDarkMode,
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),

                  // ---- Notifications (local) ----
                  const _SectionHeader(title: 'Notifications'),
                  PremiumCard(
                    child: Column(
                      children: [
                        _SwitchRow(
                          icon: Icons.local_shipping_rounded,
                          iconColor: AppColors.primary,
                          title: 'New Order Alerts',
                          subtitle: 'Get notified when new orders are available',
                          value: _pushOrders,
                          onChanged: (v) {
                            setState(() => _pushOrders = v);
                            _savePref(_kPrefPushOrders, v);
                          },
                        ),
                        const Divider(height: 1, color: AppColors.border),
                        _SwitchRow(
                          icon: Icons.account_balance_wallet_rounded,
                          iconColor: AppColors.secondary,
                          title: 'Payment Notifications',
                          subtitle: 'Alerts for credits and withdrawals',
                          value: _pushPayments,
                          onChanged: (v) {
                            setState(() => _pushPayments = v);
                            _savePref(_kPrefPushPayments, v);
                          },
                        ),
                        const Divider(height: 1, color: AppColors.border),
                        _SwitchRow(
                          icon: Icons.emergency_rounded,
                          iconColor: AppColors.emergency,
                          title: 'Emergency SOS Alerts',
                          subtitle: 'High-priority ambulance request alerts',
                          value: _pushEmergency,
                          onChanged: (v) {
                            setState(() => _pushEmergency = v);
                            _savePref(_kPrefPushEmergency, v);
                          },
                        ),
                        const Divider(height: 1, color: AppColors.border),
                        _SwitchRow(
                          icon: Icons.campaign_rounded,
                          iconColor: AppColors.warning,
                          title: 'Promotions & Bonuses',
                          subtitle: 'Bonus zones, surge pricing alerts',
                          value: _pushPromotions,
                          onChanged: (v) {
                            setState(() => _pushPromotions = v);
                            _savePref(_kPrefPushPromotions, v);
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),

                  // ---- Sound & Vibration ----
                  const _SectionHeader(title: 'Sound & Vibration'),
                  PremiumCard(
                    child: Column(
                      children: [
                        _SwitchRow(
                          icon: Icons.volume_up_rounded,
                          iconColor: AppColors.primary,
                          title: 'Sound Alerts',
                          subtitle: 'Play sound for new orders',
                          value: _soundAlerts,
                          onChanged: (v) {
                            setState(() => _soundAlerts = v);
                            _savePref(_kPrefSoundAlerts, v);
                          },
                        ),
                        const Divider(height: 1, color: AppColors.border),
                        _SwitchRow(
                          icon: Icons.vibration_rounded,
                          iconColor: AppColors.primary,
                          title: 'Vibration',
                          subtitle: 'Vibrate on new orders and alerts',
                          value: _vibration,
                          onChanged: (v) {
                            setState(() => _vibration = v);
                            _savePref(_kPrefVibration, v);
                          },
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),

                  // ---- Account ----
                  const _SectionHeader(title: 'Account'),
                  PremiumCard(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        _InfoRow(
                          icon: Icons.person_rounded,
                          label: 'Name',
                          value: profile?.displayName ?? '—',
                        ),
                        const SizedBox(height: DesignTokens.spaceSm),
                        _InfoRow(
                          icon: Icons.email_rounded,
                          label: 'Email',
                          value: profile?.email ?? '—',
                        ),
                        const SizedBox(height: DesignTokens.spaceMd),
                        SizedBox(
                          width: double.infinity,
                          child: PrimaryButton(
                            text: 'Edit Profile',
                            icon: Icons.edit_rounded,
                            onPressed: () => context.push('/edit-profile'),
                            height: DesignTokens.buttonHeightMd,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),

                  // ---- About ----
                  const _SectionHeader(title: 'About'),
                  PremiumCard(
                    child: Column(
                      children: [
                        _NavRow(
                          icon: Icons.info_outline_rounded,
                          label: 'App Version',
                          trailing: _appVersion,
                          onTap: () {},
                        ),
                        const Divider(height: 1, color: AppColors.border),
                        _NavRow(
                          icon: Icons.privacy_tip_outlined,
                          label: 'Privacy Policy',
                          onTap: () {},
                        ),
                        const Divider(height: 1, color: AppColors.border),
                        _NavRow(
                          icon: Icons.gavel_outlined,
                          label: 'Terms of Service',
                          onTap: () {},
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXxl),
                ],
              ),
            )
          : const Center(
              child: CircularProgressIndicator(color: AppColors.primary),
            ),
    );
  }
}

// ---------------------------------------------------------------------------
// Section header
// ---------------------------------------------------------------------------

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});
  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(
        bottom: DesignTokens.spaceSm,
        left: DesignTokens.spaceXs,
      ),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          color: AppColors.textSecondary,
          letterSpacing: DesignTokens.letterSpacingWide,
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Switch row — toggle with icon, title, subtitle
// ---------------------------------------------------------------------------

class _SwitchRow extends StatelessWidget {
  const _SwitchRow({
    required this.icon,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.value,
    required this.onChanged,
  });

  final IconData icon;
  final Color iconColor;
  final String title;
  final String subtitle;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: iconColor.withValues(alpha: 0.1),
            borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
          ),
          child: Icon(icon, color: iconColor, size: DesignTokens.iconSm),
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
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                subtitle,
                style: const TextStyle(
                  fontSize: 12,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
        Switch.adaptive(
          value: value,
          onChanged: onChanged,
          activeThumbColor: AppColors.primary,
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Info row — static label/value pair
// ---------------------------------------------------------------------------

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });
  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, color: AppColors.textSecondary, size: DesignTokens.iconSm),
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

// ---------------------------------------------------------------------------
// Navigation row — icon, label, optional trailing, chevron
// ---------------------------------------------------------------------------

class _NavRow extends StatelessWidget {
  const _NavRow({
    required this.icon,
    required this.label,
    this.trailing,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String? trailing;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          vertical: DesignTokens.spaceSm + 2,
        ),
        child: Row(
          children: [
            Icon(icon, color: AppColors.textSecondary, size: DesignTokens.iconSm),
            const SizedBox(width: DesignTokens.spaceMd),
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
            if (trailing != null) ...[
              Text(
                trailing!,
                style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceXs),
            ],
            const Icon(Icons.chevron_right_rounded,
                color: AppColors.gray400, size: DesignTokens.iconSm),
          ],
        ),
      ),
    );
  }
}
