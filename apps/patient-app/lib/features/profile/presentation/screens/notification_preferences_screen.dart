import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/notification_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/loading_overlay.dart';
import '../../../../core/widgets/premium_card.dart';
import '../../../../core/widgets/state_view.dart';

/// Notification Preferences Screen
///
/// Loads real preferences from [notificationPreferencesProvider] and lets the
/// user toggle individual category/channel combinations. Changes are persisted
/// immediately via [updateNotificationPreferences]. The Save button does a bulk
/// update via [updateNotificationPreferencesProvider].
class NotificationPreferencesScreen extends ConsumerStatefulWidget {
  const NotificationPreferencesScreen({super.key});

  @override
  ConsumerState<NotificationPreferencesScreen> createState() =>
      _NotificationPreferencesScreenState();
}

class _NotificationPreferencesScreenState
    extends ConsumerState<NotificationPreferencesScreen> {
  /// Local working copy of preferences, updated from the provider on first load.
  List<NotificationPreference>? _localPrefs;
  bool _isSaving = false;
  bool _hasChanges = false;

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
                  child: prefsAsync.when(
                    loading: () => const Center(
                        child: CircularProgressIndicator(
                            color: AppColors.primary)),
                    error: (err, _) => ErrorView(
                      message:
                          err is ApiError ? err.userMessage : err.toString(),
                      onRetry: () =>
                          ref.invalidate(notificationPreferencesProvider),
                    ),
                    data: (prefs) {
                      // Sync local copy when the provider data changes and there
                      // are no pending local edits.
                      if (_localPrefs == null || !_hasChanges) {
                        _localPrefs = List.of(prefs);
                      }
                      return _buildBody();
                    },
                  ),
                ),
              ],
            ),
            if (_isSaving) const LoadingOverlay(message: 'Saving preferences…'),
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
              horizontal: DesignTokens.screenPaddingHorizontal, vertical: 14),
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
                  'Notification Preferences',
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

  Widget _buildBody() {
    final prefs = _localPrefs ?? [];
    if (prefs.isEmpty) {
      return const EmptyView(
        title: 'No notification preferences',
        body:
            'Notification preferences will appear here once they are configured.',
        icon: Icons.notifications_off_outlined,
      );
    }

    // Group by channel.
    final channels = <String, List<NotificationPreference>>{};
    for (final p in prefs) {
      channels.putIfAbsent(p.channel, () => []).add(p);
    }

    return SingleChildScrollView(
      physics: const BouncingScrollPhysics(),
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            for (final entry in channels.entries) ...[
              _buildChannelSection(entry.key, entry.value),
              const SizedBox(height: DesignTokens.spaceLg),
            ],
            _buildFooterNote(),
            const SizedBox(height: DesignTokens.spaceLg),
            if (_hasChanges) _buildSaveButton(),
            const SizedBox(height: DesignTokens.spaceLg),
          ],
        ),
      ),
    );
  }

  Widget _buildChannelSection(
      String channel, List<NotificationPreference> channelPrefs) {
    final channelLabel = _channelLabel(channel);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionHeader(channelLabel),
        const SizedBox(height: DesignTokens.spaceSm),
        PremiumCard(
          margin: EdgeInsets.zero,
          child: Column(
            children: [
              for (int i = 0; i < channelPrefs.length; i++) ...[
                _buildPreferenceTile(channelPrefs[i]),
                if (i < channelPrefs.length - 1) _buildDivider(),
              ],
            ],
          ),
        ),
        // Quiet hours editor for push channel.
        if (channel == 'push') ...[
          const SizedBox(height: DesignTokens.spaceMd),
          _buildQuietHoursEditor(channelPrefs),
        ],
      ],
    );
  }

  Widget _buildPreferenceTile(NotificationPreference pref) {
    final isEmergency = pref.category == NotificationCategory.emergency ||
        pref.category == NotificationCategory.accountSecurity;

    return Padding(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _categoryLabel(pref.category),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textPrimary,
                  ),
                ),
                if (isEmergency) ...[
                  const SizedBox(height: 2),
                  const Text(
                    'Critical alerts cannot be disabled',
                    style:
                        TextStyle(fontSize: 12, color: AppColors.textSecondary),
                  ),
                ],
              ],
            ),
          ),
          if (isEmergency)
            Opacity(
              opacity: 0.6,
              child: _buildCustomSwitch(value: true, onChanged: (_) {}),
            )
          else
            _buildCustomSwitch(
              value: pref.enabled,
              onChanged: (value) => _onToggle(pref, value),
            ),
        ],
      ),
    );
  }

  void _onToggle(NotificationPreference pref, bool value) {
    HapticFeedback.lightImpact();
    setState(() {
      final idx = _localPrefs!.indexWhere(
          (p) => p.category == pref.category && p.channel == pref.channel);
      if (idx >= 0) {
        _localPrefs![idx] = NotificationPreference(
          category: pref.category,
          channel: pref.channel,
          enabled: value,
          quietHoursStart: pref.quietHoursStart,
          quietHoursEnd: pref.quietHoursEnd,
          timezone: pref.timezone,
        );
      }
      _hasChanges = true;
    });
  }

  Widget _buildQuietHoursEditor(List<NotificationPreference> pushPrefs) {
    // Use the first push preference's quiet hours as representative.
    final first = pushPrefs.isNotEmpty ? pushPrefs.first : null;
    final start = first?.quietHoursStart;
    final end = first?.quietHoursEnd;

    return PremiumCard(
      margin: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.bedtime, color: AppColors.primary, size: 20),
              SizedBox(width: DesignTokens.spaceSm),
              Text(
                'Quiet Hours',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          const Text(
            'Pause non-critical notifications during these hours.',
            style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          Row(
            children: [
              Expanded(
                child: _buildTimePicker(
                  label: 'Start',
                  time: start,
                  onPicked: (t) => _setQuietHours(start: t, end: end),
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: _buildTimePicker(
                  label: 'End',
                  time: end,
                  onPicked: (t) => _setQuietHours(start: start, end: t),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildTimePicker({
    required String label,
    required String? time,
    required ValueChanged<String> onPicked,
  }) {
    return GestureDetector(
      onTap: () async {
        HapticFeedback.lightImpact();
        final initial = _parseTime(time);
        final picked = await showTimePicker(
          context: context,
          initialTime: initial ?? TimeOfDay.now(),
          builder: (ctx, child) => Theme(
            data: Theme.of(ctx).copyWith(
              colorScheme: const ColorScheme.light(primary: AppColors.primary),
            ),
            child: child!,
          ),
        );
        if (picked != null) {
          onPicked(
              '${picked.hour.toString().padLeft(2, '0')}:${picked.minute.toString().padLeft(2, '0')}');
        }
      },
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd, vertical: 12),
        decoration: BoxDecoration(
          color: AppColors.gray50,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: AppColors.gray200),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              label.toUpperCase(),
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              time ?? 'Not set',
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w500,
                color: AppColors.textPrimary,
              ),
            ),
          ],
        ),
      ),
    );
  }

  TimeOfDay? _parseTime(String? time) {
    if (time == null || time.isEmpty) return null;
    final parts = time.split(':');
    if (parts.length != 2) return null;
    return TimeOfDay(
        hour: int.tryParse(parts[0]) ?? 0, minute: int.tryParse(parts[1]) ?? 0);
  }

  void _setQuietHours({String? start, String? end}) {
    setState(() {
      _localPrefs = _localPrefs!.map((p) {
        if (p.channel == 'push') {
          return NotificationPreference(
            category: p.category,
            channel: p.channel,
            enabled: p.enabled,
            quietHoursStart: start,
            quietHoursEnd: end,
            timezone: p.timezone,
          );
        }
        return p;
      }).toList();
      _hasChanges = true;
    });
  }

  Widget _buildSaveButton() {
    return SizedBox(
      width: double.infinity,
      child: ElevatedButton(
        onPressed: _isSaving ? null : _save,
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.primary,
          foregroundColor: AppColors.white,
          padding: const EdgeInsets.symmetric(vertical: 14),
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
        child: const Text('Save Changes',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
      ),
    );
  }

  Future<void> _save() async {
    if (_localPrefs == null) return;
    HapticFeedback.lightImpact();
    setState(() => _isSaving = true);

    await ref
        .read(updateNotificationPreferencesProvider.notifier)
        .bulkUpdate(_localPrefs!);

    final state = ref.read(updateNotificationPreferencesProvider);
    if (mounted) setState(() => _isSaving = false);

    if (state is AsyncData && mounted) {
      setState(() => _hasChanges = false);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Preferences saved'),
          backgroundColor: AppColors.success,
        ),
      );
    } else if (state is AsyncError && mounted) {
      final err = state.error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(err is ApiError ? err.userMessage : 'Failed to save'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(left: DesignTokens.spaceSm),
      child: Text(
        title,
        style: const TextStyle(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: AppColors.textSecondary,
          letterSpacing: 1,
        ),
      ),
    );
  }

  Widget _buildDivider() => Container(
        height: 1,
        margin: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
        color: AppColors.gray100,
      );

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
              boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 2)],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildFooterNote() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: RichText(
        textAlign: TextAlign.center,
        text: TextSpan(
          style: const TextStyle(
              fontSize: 12, color: AppColors.gray400, height: 1.5),
          children: const [
            TextSpan(
                text:
                    'To change your contact details, phone number, or email address, please visit '),
            TextSpan(
              text: 'Profile Settings',
              style: TextStyle(
                  color: AppColors.primary, fontWeight: FontWeight.w500),
            ),
            TextSpan(text: '.'),
          ],
        ),
      ),
    );
  }

  // --- Label helpers -------------------------------------------------------

  String _channelLabel(String channel) {
    return switch (channel) {
      'push' => 'PUSH NOTIFICATIONS',
      'email' => 'EMAIL UPDATES',
      'sms' => 'SMS TEXT MESSAGES',
      _ => channel.toUpperCase(),
    };
  }

  String _categoryLabel(NotificationCategory category) {
    return switch (category) {
      NotificationCategory.accountSecurity => 'Account & Security',
      NotificationCategory.appointments => 'Appointment Reminders',
      NotificationCategory.consultations => 'Consultation Updates',
      NotificationCategory.messages => 'Provider Messages',
      NotificationCategory.prescriptions => 'Prescription Updates',
      NotificationCategory.vitalsAlerts => 'Vitals & Lab Results',
      NotificationCategory.vitalsUpdate => 'Health Data Updates',
      NotificationCategory.aiReview => 'AI Review Alerts',
      NotificationCategory.delivery => 'Delivery Updates',
      NotificationCategory.dispatch => 'Dispatch Alerts',
      NotificationCategory.emergency => 'Emergency Alerts',
      NotificationCategory.system => 'System Announcements',
      NotificationCategory.unknown => 'Other',
    };
  }
}
