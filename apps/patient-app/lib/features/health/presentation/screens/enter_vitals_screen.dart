import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/background/health_sync.dart';
import '../../../../core/providers/health_connect_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// Sync Vitals from Watch screen.
///
/// Reads vitals from Google Health Connect (which aggregates data from any
/// paired smartwatch — Amazfit, Xiaomi Mi Band, Samsung Galaxy Watch — via
/// their companion apps) and submits them to the backend through the existing
/// device ingestion endpoint.
///
/// The backend resolves the patient server-side from the device's open
/// assignment, so this screen never sends a patient identifier. The deviceId
/// comes from GET /profiles/me/devices.
class EnterVitalsScreen extends ConsumerStatefulWidget {
  const EnterVitalsScreen({super.key});

  @override
  ConsumerState<EnterVitalsScreen> createState() => _EnterVitalsScreenState();
}

class _EnterVitalsScreenState extends ConsumerState<EnterVitalsScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _animationController;
  late final Animation<double> _fadeAnimation;
  late final Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: DesignTokens.animationNormal,
      vsync: this,
    );
    _fadeAnimation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeOut,
    );
    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, 0.04),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeOutCubic,
    ));
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final syncState = ref.watch(healthConnectProvider);
    final devicesAsync = ref.watch(ownDevicesProvider);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Column(
            children: [
              _buildHeader(),
              Expanded(
                child: FadeTransition(
                  opacity: _fadeAnimation,
                  child: SlideTransition(
                    position: _slideAnimation,
                    child: SingleChildScrollView(
                      physics: const BouncingScrollPhysics(),
                      padding: const EdgeInsets.symmetric(
                        horizontal: DesignTokens.screenPaddingHorizontal,
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          const SizedBox(height: DesignTokens.spaceMd),
                          _SyncCard(syncState: syncState),
                          const SizedBox(height: DesignTokens.spaceLg),
                          const _AutoSyncCard(),
                          const SizedBox(height: DesignTokens.spaceLg),
                          _DevicesSection(devicesAsync: devicesAsync),
                          const SizedBox(height: DesignTokens.spaceLg),
                          const _HowItWorksSection(),
                          const SizedBox(height: DesignTokens.space2xl + 16),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.screenPaddingHorizontal,
        vertical: DesignTokens.spaceSm,
      ),
      child: Row(
        children: [
          Semantics(
            button: true,
            label: 'Go back',
            child: GestureDetector(
              onTap: () {
                HapticFeedback.lightImpact();
                context.pop();
              },
              behavior: HitTestBehavior.opaque,
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.white,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  border: Border.all(color: AppColors.gray200),
                ),
                alignment: Alignment.center,
                child: const Icon(
                  Icons.arrow_back_ios_new_rounded,
                  size: 18,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
          ),
          const Expanded(
            child: Text(
              'Sync Vitals',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w800,
                color: AppColors.textPrimary,
                letterSpacing: -0.3,
              ),
            ),
          ),
          const SizedBox(width: 44),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sync card — the main hero card with gradient background and sync button
// ---------------------------------------------------------------------------

class _SyncCard extends ConsumerWidget {
  final HealthConnectSyncState syncState;

  const _SyncCard({required this.syncState});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (syncState.isSuccess) {
      return _SyncResultCard(
        state: syncState,
        onDismiss: () => ref.read(healthConnectProvider.notifier).reset(),
      );
    }

    if (syncState.isError) {
      return _SyncErrorCard(
        state: syncState,
        onRetry: () => ref.read(healthConnectProvider.notifier).syncFromWatch(),
        onOpenSettings: () => ref
            .read(healthConnectProvider.notifier)
            .openHealthConnectSettings(),
        onDismiss: () => ref.read(healthConnectProvider.notifier).reset(),
      );
    }

    // Idle or busy — show the main sync hero card.
    return Container(
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            Color(0xFF2563EB),
            Color(0xFF1D4ED8),
            Color(0xFF1E40AF),
          ],
        ),
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.25),
            blurRadius: 24,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceLg,
          vertical: DesignTokens.spaceXl,
        ),
        child: Column(
          children: [
            // Animated icon container
            Container(
              width: 80,
              height: 80,
              decoration: BoxDecoration(
                color: Colors.white.withValues(alpha: 0.15),
                shape: BoxShape.circle,
                border: Border.all(
                  color: Colors.white.withValues(alpha: 0.25),
                  width: 1.5,
                ),
              ),
              child: syncState.isBusy
                  ? const Padding(
                      padding: EdgeInsets.all(22),
                      child: CircularProgressIndicator(
                        color: Colors.white,
                        strokeWidth: 3,
                      ),
                    )
                  : const Icon(
                      Icons.watch,
                      size: 36,
                      color: Colors.white,
                    ),
            ),
            const SizedBox(height: DesignTokens.spaceLg),

            // Title
            const Text(
              'Sync from Watch',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: Colors.white,
                letterSpacing: -0.3,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceXs),

            // Subtitle or progress message
            Text(
              syncState.isBusy
                  ? (syncState.message ?? 'Syncing...')
                  : 'Pull vitals from Google Health Connect into your '
                      'SmartCura health record.',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w500,
                color: Colors.white.withValues(alpha: 0.85),
                height: 1.5,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceLg),

            // Sync button
            SizedBox(
              width: double.infinity,
              height: 52,
              child: ElevatedButton(
                onPressed: syncState.isBusy
                    ? null
                    : () {
                        HapticFeedback.mediumImpact();
                        ref
                            .read(healthConnectProvider.notifier)
                            .syncFromWatch();
                      },
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.white,
                  foregroundColor: AppColors.primary,
                  disabledBackgroundColor: Colors.white.withValues(alpha: 0.7),
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                  ),
                ),
                child: syncState.isBusy
                    ? const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.5,
                              color: AppColors.primary,
                            ),
                          ),
                          SizedBox(width: 10),
                          Text(
                            'Syncing...',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      )
                    : const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.download_rounded, size: 20),
                          SizedBox(width: 8),
                          Text(
                            'Sync Now',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ],
                      ),
              ),
            ),

            // Last synced
            if (syncState.lastSyncedAt != null) ...[
              const SizedBox(height: DesignTokens.spaceSm),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.check_circle_outline_rounded,
                    size: 14,
                    color: Colors.white.withValues(alpha: 0.6),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    'Last synced ${_formatTimeAgo(syncState.lastSyncedAt!)}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: Colors.white.withValues(alpha: 0.6),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sync result card — shown after successful sync
// ---------------------------------------------------------------------------

class _SyncResultCard extends StatelessWidget {
  final HealthConnectSyncState state;
  final VoidCallback onDismiss;

  const _SyncResultCard({required this.state, required this.onDismiss});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(
          color: AppColors.success.withValues(alpha: 0.2),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.success.withValues(alpha: 0.08),
            blurRadius: 20,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceLg),
        child: Column(
          children: [
            SvgPicture.asset(
              'assets/illustrations/empty_health_connect_success.svg',
              width: 96,
              height: 96,
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            Text(
              state.message ?? 'Sync complete',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
                height: 1.4,
              ),
            ),
            if (state.accepted != null || state.deduplicated != null) ...[
              const SizedBox(height: DesignTokens.spaceMd),
              Container(
                padding: const EdgeInsets.symmetric(
                  vertical: DesignTokens.spaceSm + 2,
                ),
                decoration: BoxDecoration(
                  color: AppColors.gray50,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                  children: [
                    if (state.accepted != null)
                      _StatChip(
                        label: 'Synced',
                        value: state.accepted!,
                        color: AppColors.success,
                      ),
                    if (state.deduplicated != null)
                      _StatChip(
                        label: 'Duplicates',
                        value: state.deduplicated!,
                        color: AppColors.warning,
                      ),
                    if (state.rejected != null && state.rejected! > 0)
                      _StatChip(
                        label: 'Rejected',
                        value: state.rejected!,
                        color: AppColors.error,
                      ),
                  ],
                ),
              ),
            ],
            if (state.alertsRaised != null && state.alertsRaised! > 0) ...[
              const SizedBox(height: DesignTokens.spaceSm),
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: DesignTokens.spaceMd,
                  vertical: DesignTokens.spaceSm + 2,
                ),
                decoration: BoxDecoration(
                  color: AppColors.errorContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.warning_amber_rounded,
                        color: AppColors.error, size: 20),
                    const SizedBox(width: DesignTokens.spaceSm),
                    Expanded(
                      child: Text(
                        '${state.alertsRaised} health alert${state.alertsRaised! > 1 ? 's' : ''} raised — '
                        'check your Alerts tab.',
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.error,
                          height: 1.3,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: DesignTokens.spaceMd),
            Row(
              children: [
                Expanded(
                  child: OutlinedButton(
                    onPressed: onDismiss,
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.textSecondary,
                      side: const BorderSide(color: AppColors.gray300),
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusMd),
                      ),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    child: const Text(
                      'Dismiss',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
                Expanded(
                  child: FilledButton(
                    onPressed: () => context.go('/health'),
                    style: FilledButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: Colors.white,
                      shape: RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusMd),
                      ),
                      padding: const EdgeInsets.symmetric(vertical: 12),
                    ),
                    child: const Text(
                      'View Health',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sync error card — shown when sync fails
// ---------------------------------------------------------------------------

class _SyncErrorCard extends StatelessWidget {
  final HealthConnectSyncState state;
  final VoidCallback onRetry;
  final VoidCallback onOpenSettings;
  final VoidCallback onDismiss;

  const _SyncErrorCard({
    required this.state,
    required this.onRetry,
    required this.onOpenSettings,
    required this.onDismiss,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(
          color: AppColors.error.withValues(alpha: 0.2),
          width: 1.5,
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.error.withValues(alpha: 0.08),
            blurRadius: 20,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceLg),
        child: Column(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: const BoxDecoration(
                color: AppColors.errorContainer,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.error_outline_rounded,
                color: AppColors.error,
                size: 34,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            Text(
              state.message ?? 'Sync failed',
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
                height: 1.5,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            SizedBox(
              width: double.infinity,
              child: FilledButton(
                onPressed: onRetry,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
                child: const Text(
                  'Retry',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: onOpenSettings,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  side: const BorderSide(color: AppColors.primary),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
                child: const Text(
                  'Open Health Connect',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            SizedBox(
              width: double.infinity,
              child: OutlinedButton(
                onPressed: onDismiss,
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.textSecondary,
                  side: const BorderSide(color: AppColors.gray300),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
                child: const Text(
                  'Dismiss',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Stat chip
// ---------------------------------------------------------------------------

class _StatChip extends StatelessWidget {
  final String label;
  final int value;
  final Color color;

  const _StatChip({
    required this.label,
    required this.value,
    required this.color,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          '$value',
          style: TextStyle(
            fontSize: 22,
            fontWeight: FontWeight.w800,
            color: color,
            height: 1,
            letterSpacing: -0.5,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
            color: AppColors.textSecondary,
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Auto-sync card — background periodic sync toggle
// ---------------------------------------------------------------------------

class _AutoSyncCard extends StatefulWidget {
  const _AutoSyncCard();

  @override
  State<_AutoSyncCard> createState() => _AutoSyncCardState();
}

class _AutoSyncCardState extends State<_AutoSyncCard> {
  bool? _enabled;
  DateTime? _lastSyncAt;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadState();
  }

  Future<void> _loadState() async {
    final enabled = await getAutoSyncEnabled();
    final lastAt = await getLastBackgroundSyncAt();
    if (mounted) {
      setState(() {
        _enabled = enabled;
        _lastSyncAt = lastAt;
      });
    }
  }

  Future<void> _onChanged(bool value) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await setAutoSyncEnabled(value);
      if (value) {
        await registerBackgroundHealthSync();
      } else {
        await cancelBackgroundHealthSync();
      }
      if (mounted) {
        setState(() {
          _enabled = value;
          _busy = false;
        });
      }
    } on Object catch (_) {
      // Revert the toggle if scheduling/cancellation failed.
      if (mounted) {
        setState(() => _busy = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final enabled = _enabled ?? false;
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(
          color: enabled
              ? AppColors.primary.withValues(alpha: 0.25)
              : AppColors.gray200,
          width: enabled ? 1.5 : 1,
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color:
                      enabled ? AppColors.primaryContainer : AppColors.gray100,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: Icon(
                  Icons.sync_outlined,
                  color: enabled ? AppColors.primary : AppColors.gray400,
                  size: 22,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const Text(
                      'Background auto-sync',
                      style: TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      enabled
                          ? 'Vitals sync every 15 min when online'
                          : 'Off — sync manually with the button above',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              Switch.adaptive(
                value: enabled,
                onChanged: _busy ? null : _onChanged,
                activeTrackColor: AppColors.primary,
              ),
            ],
          ),
          if (enabled && _lastSyncAt != null) ...[
            const SizedBox(height: DesignTokens.spaceSm),
            Row(
              children: [
                Icon(
                  Icons.history_rounded,
                  size: 14,
                  color: AppColors.textSecondary.withValues(alpha: 0.7),
                ),
                const SizedBox(width: 4),
                Text(
                  'Last background sync ${_formatTimeAgoStr(_lastSyncAt!.toIso8601String())}',
                  style: const TextStyle(
                    fontSize: 11,
                    fontWeight: FontWeight.w500,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Devices section
// ---------------------------------------------------------------------------

class _DevicesSection extends ConsumerWidget {
  final AsyncValue<List<Device>> devicesAsync;

  const _DevicesSection({required this.devicesAsync});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text(
          'Connected Devices',
          style: TextStyle(
            fontSize: 17,
            fontWeight: FontWeight.w800,
            color: AppColors.textPrimary,
            letterSpacing: -0.3,
          ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        devicesAsync.when(
          loading: () => _buildDeviceShimmer(),
          error: (e, _) => _buildDeviceError(),
          data: (devices) {
            if (devices.isEmpty) {
              return _buildEmptyDevices();
            }
            return Column(
              children: devices.map((device) {
                final isActive = device.state == DeviceState.active;
                return Padding(
                  padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
                  child: _DeviceCard(
                    device: device,
                    isActive: isActive,
                  ),
                );
              }).toList(),
            );
          },
        ),
      ],
    );
  }

  Widget _buildDeviceShimmer() {
    return Shimmer.fromColors(
      baseColor: AppColors.gray200,
      highlightColor: AppColors.gray100,
      child: Column(
        children: List.generate(
          2,
          (_) => Padding(
            padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
            child: Container(
              height: 68,
              decoration: BoxDecoration(
                color: AppColors.gray200,
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildDeviceError() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
      ),
      child: const Row(
        children: [
          Icon(Icons.cloud_off_rounded, color: AppColors.gray400, size: 24),
          SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Text(
              'Could not load devices. Pull down to refresh.',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w500,
                color: AppColors.textSecondary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmptyDevices() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: const BoxDecoration(
              color: AppColors.gray100,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.devices_outlined,
              size: 28,
              color: AppColors.gray400,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          const Text(
            'No devices connected',
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceXs),
          const Text(
            'Ask your clinic to assign a device to your profile '
            'so you can sync vitals from your watch.',
            textAlign: TextAlign.center,
            style: TextStyle(
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

// ---------------------------------------------------------------------------
// Device card
// ---------------------------------------------------------------------------

class _DeviceCard extends StatelessWidget {
  final Device device;
  final bool isActive;

  const _DeviceCard({required this.device, required this.isActive});

  @override
  Widget build(BuildContext context) {
    final (icon, color) = _visualFor(device.deviceType);
    final (stateText, stateColor) = _stateVisual(device);
    final isPhone = device.deviceType == DeviceType.phone;

    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
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
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.10),
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              child: Icon(icon, color: color, size: 22),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    _typeLabel(device.deviceType),
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    isPhone
                        ? 'Health Connect · sync to send readings'
                        : device.serialNumber,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: AppColors.textSecondary,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (!isPhone && device.lastSeenAt != null) ...[
                    const SizedBox(height: 4),
                    Row(
                      children: [
                        Icon(
                          Icons.circle,
                          size: 6,
                          color:
                              isActive ? AppColors.success : AppColors.gray400,
                        ),
                        const SizedBox(width: 4),
                        Flexible(
                          child: Text(
                            isActive
                                ? 'Active • Last seen ${_formatTimeAgoStr(device.lastSeenAt!)}'
                                : 'Last seen ${_formatTimeAgoStr(device.lastSeenAt!)}',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.w500,
                              color: isActive
                                  ? AppColors.success
                                  : AppColors.textSecondary,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 10,
                vertical: 5,
              ),
              decoration: BoxDecoration(
                color: stateColor.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
              ),
              child: Text(
                stateText,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w700,
                  color: stateColor,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  (IconData, Color) _visualFor(DeviceType type) {
    return switch (type) {
      DeviceType.phone => (Icons.smartphone, AppColors.primary),
      DeviceType.vitalsMonitor => (Icons.monitor_heart, AppColors.heartRate),
      DeviceType.ecg => (Icons.favorite, AppColors.error),
      DeviceType.thermometer => (Icons.thermostat, AppColors.temperature),
      DeviceType.pulseOximeter => (Icons.air, AppColors.oxygen),
      DeviceType.simulator => (Icons.science, AppColors.secondary),
      DeviceType.unknown => (Icons.devices, AppColors.gray500),
    };
  }

  (String, Color) _stateVisual(Device device) {
    // A phone device is assigned to the patient as soon as the backend has an
    // open assignment, but it is not "active" in the sense of having published
    // readings until a Health Connect sync actually runs. Show "Assigned" so
    // the patient does not confuse assignment with synced data.
    if (device.deviceType == DeviceType.phone) {
      return switch (device.state) {
        DeviceState.active => ('Assigned', AppColors.info),
        DeviceState.provisioned => ('Provisioned', AppColors.info),
        DeviceState.suspended => ('Suspended', AppColors.warning),
        DeviceState.retired => ('Retired', AppColors.gray400),
        _ => ('Unknown', AppColors.gray400),
      };
    }
    return switch (device.state) {
      DeviceState.active => ('Active', AppColors.success),
      DeviceState.provisioned => ('Provisioned', AppColors.info),
      DeviceState.suspended => ('Suspended', AppColors.warning),
      DeviceState.retired => ('Retired', AppColors.gray400),
      _ => ('Unknown', AppColors.gray400),
    };
  }

  String _typeLabel(DeviceType type) {
    return switch (type) {
      DeviceType.phone => 'Phone (Health Connect)',
      DeviceType.vitalsMonitor => 'Vitals Monitor',
      DeviceType.ecg => 'ECG Monitor',
      DeviceType.thermometer => 'Thermometer',
      DeviceType.pulseOximeter => 'Pulse Oximeter',
      DeviceType.simulator => 'Simulator',
      DeviceType.unknown => 'Device',
    };
  }
}

// ---------------------------------------------------------------------------
// How it works section
// ---------------------------------------------------------------------------

class _HowItWorksSection extends StatelessWidget {
  const _HowItWorksSection();

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: AppColors.primaryContainer,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                  ),
                  child: const Icon(
                    Icons.school_rounded,
                    color: AppColors.primary,
                    size: 18,
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
                const Text(
                  'How it works',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    letterSpacing: -0.2,
                  ),
                ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            const _HowItWorksStep(
              icon: Icons.watch_rounded,
              color: AppColors.primary,
              title: 'Wear your watch',
              description: 'Put on your Amazfit, Mi Band, or Galaxy Watch. The '
                  'companion app (Zepp, Mi Fitness, Samsung Health) records '
                  'your vitals automatically.',
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            const _HowItWorksStep(
              icon: Icons.health_and_safety_rounded,
              color: AppColors.secondary,
              title: 'Enable Health Connect',
              description: 'Your watch\'s companion app syncs to Google Health '
                  'Connect. Enable Health Connect in the companion app '
                  'settings and grant permission when prompted.',
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            const _HowItWorksStep(
              icon: Icons.sync_rounded,
              color: AppColors.heartRate,
              title: 'Tap Sync',
              description: 'SmartCura reads from Health Connect and saves the '
                  'readings to your health record. Your doctor can see them '
                  'in real time.',
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            Container(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              decoration: BoxDecoration(
                color: AppColors.primaryContainer,
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              child: const Row(
                children: [
                  Icon(Icons.info_outline_rounded,
                      color: AppColors.primary, size: 18),
                  SizedBox(width: DesignTokens.spaceSm),
                  Expanded(
                    child: Text(
                      'Works with any watch that syncs to Google Health '
                      'Connect: Samsung Galaxy Watch, Xiaomi Mi Band, '
                      'Amazfit, and more.',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textSecondary,
                        height: 1.4,
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
}

class _HowItWorksStep extends StatelessWidget {
  final IconData icon;
  final Color color;
  final String title;
  final String description;

  const _HowItWorksStep({
    required this.icon,
    required this.color,
    required this.title,
    required this.description,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: BoxDecoration(
            color: color.withValues(alpha: 0.10),
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          ),
          child: Icon(icon, color: color, size: 22),
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
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                description,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w500,
                  color: AppColors.textSecondary,
                  height: 1.4,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

String _formatTimeAgo(DateTime time) {
  final now = DateTime.now();
  final diff = now.difference(time);
  if (diff.inMinutes < 1) return 'just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  return '${diff.inDays}d ago';
}

String _formatTimeAgoStr(String isoTimestamp) {
  try {
    return _formatTimeAgo(DateTime.parse(isoTimestamp));
  } catch (_) {
    return '—';
  }
}
