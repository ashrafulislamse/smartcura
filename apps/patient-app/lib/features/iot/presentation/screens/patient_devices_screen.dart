import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/iot_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../data/pending_provisioning_device_store.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../../core/widgets/status_badge.dart';
import '../utils/iot_device_helpers.dart';

/// My Devices — the patient-facing list of IoT devices assigned to them.
///
/// Data comes from `GET /profiles/me/devices` (self-scoped). Each card shows
/// the device type, serial number, lifecycle state, and last-seen time. Tapping
/// a card opens its detail screen. Patients can also add and assign devices
/// themselves via the "Add Device" flow; the pending card covers the brief
/// window between BLE provisioning and the backend self-assignment completing.
class PatientDevicesScreen extends ConsumerWidget {
  const PatientDevicesScreen({super.key});

  String _errMsg(Object e) {
    final s = e.toString();
    return s.isEmpty ? 'Unable to load your devices.' : s;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final devicesAsync = ref.watch(myDevicesProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        centerTitle: false,
        titleSpacing: DesignTokens.spaceMd,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.textPrimary),
          onPressed: () => context.pop(),
          tooltip: 'Back',
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'My Devices',
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
            ),
            Text(
              'SmartCura health monitors assigned to you',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.textSecondary,
                  ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.add, color: AppColors.primary),
            tooltip: 'Add device',
            onPressed: () => context.push('/iot/add-device'),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
        ],
      ),
      body: SafeArea(
        child: FutureBuilder<String?>(
          future: PendingProvisioningDeviceStore.getPendingDeviceId(),
          builder: (context, pendingSnapshot) {
            final pendingId = pendingSnapshot.data;
            return devicesAsync.when(
              loading: () => _buildLoading(pendingId: pendingId),
              error: (e, _) =>
                  _buildError(context, ref, e, pendingId: pendingId),
              data: (devices) =>
                  _buildContent(context, ref, devices, pendingId: pendingId),
            );
          },
        ),
      ),
    );
  }

  Widget _buildLoading({String? pendingId}) {
    return ListView(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      children: [
        if (pendingId != null && pendingId.isNotEmpty) ...[
          _PendingDeviceCard(deviceId: pendingId),
          const SizedBox(height: DesignTokens.spaceMd),
        ],
        const _SkeletonCard(),
        const SizedBox(height: DesignTokens.spaceMd),
        const _SkeletonCard(),
      ],
    );
  }

  Widget _buildError(BuildContext context, WidgetRef ref, Object e,
      {String? pendingId}) {
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(myDevicesProvider),
      color: AppColors.primary,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.6,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (pendingId != null && pendingId.isNotEmpty) ...[
                _PendingDeviceCard(deviceId: pendingId),
                const SizedBox(height: DesignTokens.spaceMd),
              ],
              ErrorView(
                message: _errMsg(e),
                onRetry: () => ref.invalidate(myDevicesProvider),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildContent(
      BuildContext context, WidgetRef ref, List<Device> devices,
      {String? pendingId}) {
    final hasPendingId = pendingId != null && pendingId.isNotEmpty;
    final pendingNowApproved =
        hasPendingId && devices.any((d) => d.id == pendingId);
    if (pendingNowApproved) {
      // The care provider has approved the device; it is now in the API list.
      // Clear the local pending marker so the card disappears on next refresh.
      PendingProvisioningDeviceStore.clearPendingDeviceId();
    }
    final showPendingCard = hasPendingId && !pendingNowApproved;

    if (devices.isEmpty && !showPendingCard) {
      return RefreshIndicator(
        onRefresh: () async => ref.invalidate(myDevicesProvider),
        color: AppColors.primary,
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          child: SizedBox(
            height: MediaQuery.of(context).size.height * 0.65,
            child: const EmptyView(
              title: 'No devices yet',
              body: 'Add a SmartCura device to start tracking your vitals. '
                  'Once assigned, it will appear here and begin syncing readings.',
              icon: Icons.monitor_heart_outlined,
              illustrationAsset: 'assets/illustrations/empty_devices.svg',
            ),
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(myDevicesProvider),
      color: AppColors.primary,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
          DesignTokens.spaceMd,
          DesignTokens.spaceSm,
          DesignTokens.spaceMd,
          DesignTokens.space2xl,
        ),
        children: [
          if (showPendingCard) ...[
            _PendingDeviceCard(deviceId: pendingId),
            const SizedBox(height: DesignTokens.spaceMd),
          ],
          for (final device in devices) ...[
            _DeviceCard(
              device: device,
              onTap: () => _openDetail(context, device),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
          ],
          _AddDeviceCard(onTap: () => context.push('/iot/add-device')),
          const SizedBox(height: DesignTokens.spaceMd),
          _SafetyInfoCard(),
        ],
      ),
    );
  }

  void _openDetail(BuildContext context, Device device) {
    context.push('/iot/device-management/${device.id}', extra: device);
  }
}

class _DeviceCard extends StatelessWidget {
  final Device device;
  final VoidCallback onTap;

  const _DeviceCard({required this.device, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final (icon, color) = deviceIconAndColor(device.deviceType);
    final (stateText, stateTone) = deviceStateStyle(device.state);

    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.border),
          boxShadow: [
            BoxShadow(
              color: AppColors.black.withValues(alpha: 0.04),
              blurRadius: 10,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.10),
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: Icon(icon, color: color, size: 24),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      deviceTypeLabel(device.deviceType),
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w700,
                        color: AppColors.textPrimary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'SN: ${device.serialNumber}',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textSecondary,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (device.firmwareVersion != null) ...[
                      const SizedBox(height: 2),
                      Text(
                        'Firmware ${device.firmwareVersion}',
                        style: const TextStyle(
                          fontSize: 11,
                          fontWeight: FontWeight.w500,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                    const SizedBox(height: 2),
                    Text(
                      'Last seen ${formatLastSeen(device.lastSeenAt)}',
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w500,
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                ),
              ),
              StatusBadge(text: stateText, tone: stateTone, small: true),
            ],
          ),
        ),
      ),
    );
  }
}

class _PendingDeviceCard extends StatelessWidget {
  final String deviceId;

  const _PendingDeviceCard({required this.deviceId});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.warningContainer.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.warning.withValues(alpha: 0.3)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Row(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: AppColors.warning.withValues(alpha: 0.12),
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              child: const Icon(
                Icons.pending_outlined,
                color: AppColors.warning,
                size: 24,
              ),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'SmartCura Vitals Monitor',
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Device ID: ${deviceId.substring(0, deviceId.length > 12 ? 12 : deviceId.length)}...',
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: AppColors.textSecondary,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    'Finish setup to assign this device to your account. '
                    'Once assigned, it will sync vitals automatically.',
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ),
            const StatusBadge(
              text: 'Pending approval',
              tone: StatusTone.warning,
              small: true,
            ),
          ],
        ),
      ),
    );
  }
}

class _AddDeviceCard extends StatelessWidget {
  final VoidCallback onTap;

  const _AddDeviceCard({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: CustomPaint(
        painter: const _DashedRRectPainter(
          color: AppColors.primaryLight,
          radius: 16,
        ),
        child: Container(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: AppColors.primaryContainer.withValues(alpha: 0.25),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Container(
                width: 48,
                height: 48,
                decoration: const BoxDecoration(
                  color: AppColors.primaryContainer,
                  shape: BoxShape.circle,
                ),
                child:
                    const Icon(Icons.add, color: AppColors.primary, size: 24),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Add New Device',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: AppColors.primary,
                          ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Learn how to connect a SmartCura monitor',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppColors.textSecondary,
                          ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: AppColors.gray500),
            ],
          ),
        ),
      ),
    );
  }
}

class _SafetyInfoCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.infoContainer.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.surface,
              shape: BoxShape.circle,
              border:
                  Border.all(color: AppColors.primary.withValues(alpha: 0.2)),
            ),
            child: const Icon(Icons.shield_outlined,
                color: AppColors.primary, size: 24),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Your data is safe',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Device readings are sent over encrypted connections (TLS) '
                  'and stored securely in your health record.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondary,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _SkeletonCard extends StatelessWidget {
  const _SkeletonCard();

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: AppColors.gray100,
      highlightColor: AppColors.white,
      child: Container(
        height: 92,
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        ),
      ),
    );
  }
}

class _DashedRRectPainter extends CustomPainter {
  final Color color;
  final double radius;

  const _DashedRRectPainter({required this.color, required this.radius});

  @override
  void paint(Canvas canvas, Size size) {
    final rrect =
        RRect.fromRectAndRadius(Offset.zero & size, Radius.circular(radius));
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;
    final dashWidth = 6.0;
    final dashSpace = 4.0;
    final path = Path()..addRRect(rrect);
    final dashedPath = Path();
    final metrics = path.computeMetrics().toList();
    for (final metric in metrics) {
      var distance = 0.0;
      while (distance < metric.length) {
        dashedPath.addPath(
          metric.extractPath(distance, distance + dashWidth),
          Offset.zero,
        );
        distance += dashWidth + dashSpace;
      }
    }
    canvas.drawPath(dashedPath, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
