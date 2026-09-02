import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/iot_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../../core/widgets/status_badge.dart';
import '../providers/iot_device_management_provider.dart';
import '../utils/iot_device_helpers.dart';

/// Device Vitals — a focused view of one SmartCura device and its readings.
///
/// Reached from the device list. It shows the device identity, a summary of the
/// latest heart rate, SpO₂ and temperature readings, and the full history of
/// readings from this device. All data comes from the patient-self endpoints
/// `GET /profiles/me/devices/{id}` and
/// `GET /profiles/me/devices/{id}/vital-readings`.
class DeviceVitalsScreen extends ConsumerStatefulWidget {
  final String deviceId;
  final Device? initialDevice;

  const DeviceVitalsScreen({
    super.key,
    required this.deviceId,
    this.initialDevice,
  });

  @override
  ConsumerState<DeviceVitalsScreen> createState() => _DeviceVitalsScreenState();
}

class _DeviceVitalsScreenState extends ConsumerState<DeviceVitalsScreen> {
  static final _timeFormatter = DateFormat('h:mm a');
  static final _dateFormatter = DateFormat('MMM d, y');

  @override
  void initState() {
    super.initState();
    // Clear any stale release result from a previous visit so the action
    // section starts clean.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      ref.read(releaseAssignmentProvider.notifier).reset();
    });
  }

  static String _metricLabel(VitalMetric metric) {
    return switch (metric) {
      VitalMetric.heartRate => 'Heart Rate',
      VitalMetric.oxygenSaturation => 'SpO₂',
      VitalMetric.bodyTemperature => 'Temperature',
      VitalMetric.systolicBp => 'Systolic BP',
      VitalMetric.diastolicBp => 'Diastolic BP',
      VitalMetric.respiratoryRate => 'Respiratory Rate',
      VitalMetric.bloodGlucose => 'Blood Glucose',
      VitalMetric.bloodPressure => 'Blood Pressure',
      VitalMetric.ecgVoltage => 'ECG',
      VitalMetric.bodyWeight => 'Weight',
      _ => 'Reading',
    };
  }

  static String _metricUnit(VitalMetric metric) {
    return switch (metric) {
      VitalMetric.heartRate => 'bpm',
      VitalMetric.oxygenSaturation => '%',
      VitalMetric.bodyTemperature => '°C',
      VitalMetric.systolicBp ||
      VitalMetric.diastolicBp ||
      VitalMetric.bloodPressure =>
        'mmHg',
      VitalMetric.respiratoryRate => 'rpm',
      VitalMetric.bloodGlucose => 'mg/dL',
      VitalMetric.ecgVoltage => 'mV',
      VitalMetric.bodyWeight => 'kg',
      _ => '',
    };
  }

  static (Color, IconData) _metricVisual(VitalMetric metric) {
    return switch (metric) {
      VitalMetric.heartRate => (AppColors.heartRate, Icons.favorite),
      VitalMetric.oxygenSaturation => (AppColors.oxygen, Icons.air),
      VitalMetric.bodyTemperature => (AppColors.temperature, Icons.thermostat),
      _ => (AppColors.primary, Icons.monitor_heart),
    };
  }

  static String _formatRecordedAt(String isoTimestamp) {
    try {
      final dt = DateTime.parse(isoTimestamp).toLocal();
      return '${_dateFormatter.format(dt)} at ${_timeFormatter.format(dt)}';
    } catch (_) {
      return isoTimestamp;
    }
  }

  String _errMsg(Object e) {
    final s = e.toString();
    return s.isEmpty ? 'Unable to load device data.' : s;
  }

  Future<void> _refresh() async {
    ref.invalidate(patientDeviceDetailProvider(widget.deviceId));
    ref.invalidate(patientDeviceReadingsProvider(widget.deviceId));
  }

  @override
  Widget build(BuildContext context) {
    final detailAsync = ref.watch(patientDeviceDetailProvider(widget.deviceId));
    final readingsAsync =
        ref.watch(patientDeviceReadingsProvider(widget.deviceId));
    final releaseState = ref.watch(releaseAssignmentProvider);

    // Prefer the optimistic summary from the list for an instant header; once
    // the read-one resolves it becomes the source of truth.
    final Device? headerDevice = detailAsync.maybeWhen(
      data: (d) => d,
      orElse: () => widget.initialDevice,
    );

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back, color: AppColors.textPrimary),
          onPressed: () => context.pop(),
        ),
        title: Text(
          'Device Vitals',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
        ),
        centerTitle: true,
      ),
      body: SafeArea(
        bottom: false,
        child: RefreshIndicator(
          onRefresh: _refresh,
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
              if (headerDevice != null) _DeviceHeader(device: headerDevice),
              if (headerDevice == null && detailAsync is AsyncLoading)
                _buildHeaderSkeleton(),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildSummary(readingsAsync),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildReadingsHistory(readingsAsync),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildDeviceInfo(detailAsync),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildDeviceActions(detailAsync, releaseState),
            ],
          ),
        ),
      ),
    );
  }

  Widget _DeviceHeader({required Device device}) {
    final (icon, color) = deviceIconAndColor(device.deviceType);
    final (stateText, stateTone) = deviceStateStyle(device.state);

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
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
      child: Row(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: Icon(icon, color: color, size: 28),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  deviceTypeLabel(device.deviceType),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'SN: ${device.serialNumber}',
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Last seen ${formatLastSeen(device.lastSeenAt)}',
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          StatusBadge(text: stateText, tone: stateTone, small: true),
        ],
      ),
    );
  }

  Widget _buildHeaderSkeleton() {
    return Shimmer.fromColors(
      baseColor: AppColors.gray100,
      highlightColor: AppColors.white,
      child: Container(
        height: 104,
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        ),
      ),
    );
  }

  Widget _buildSummary(AsyncValue<List<VitalReading>> readingsAsync) {
    return readingsAsync.when(
      loading: () => _buildSummarySkeleton(),
      error: (e, _) => const SizedBox.shrink(),
      data: (readings) {
        if (readings.isEmpty) return const SizedBox.shrink();
        final latest = _latestByMetric(readings);
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _sectionTitle('Latest Readings'),
            const SizedBox(height: DesignTokens.spaceSm),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  for (final entry in latest.entries) ...[
                    _MetricSummaryCard(
                      metric: entry.key,
                      reading: entry.value,
                    ),
                    const SizedBox(width: DesignTokens.spaceMd),
                  ],
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildSummarySkeleton() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle('Latest Readings'),
        const SizedBox(height: DesignTokens.spaceSm),
        Row(
          children: [
            Expanded(child: _SkeletonCard(height: 120)),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(child: _SkeletonCard(height: 120)),
          ],
        ),
      ],
    );
  }

  Widget _buildReadingsHistory(AsyncValue<List<VitalReading>> readingsAsync) {
    return StateView<List<VitalReading>>(
      isLoading: readingsAsync is AsyncLoading,
      error: readingsAsync.asError?.error,
      onRetry: () =>
          ref.invalidate(patientDeviceReadingsProvider(widget.deviceId)),
      isEmpty: readingsAsync.valueOrNull?.isEmpty ?? false,
      data: readingsAsync.valueOrNull,
      emptyTitle: 'No readings yet',
      emptyBody: 'Vitals from this device will appear here as they are sent.',
      emptyIcon: Icons.show_chart,
      builder: (readings) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _sectionTitle('History'),
            const SizedBox(height: DesignTokens.spaceSm),
            for (final reading in readings) ...[
              _ReadingCard(reading: reading),
              const SizedBox(height: DesignTokens.spaceSm),
            ],
          ],
        );
      },
    );
  }

  Widget _buildDeviceInfo(AsyncValue<Device> detailAsync) {
    return StateView<Device>(
      isLoading: detailAsync is AsyncLoading && widget.initialDevice == null,
      error: detailAsync.asError?.error,
      onRetry: () =>
          ref.invalidate(patientDeviceDetailProvider(widget.deviceId)),
      isEmpty: detailAsync.valueOrNull == null,
      data: detailAsync.valueOrNull,
      emptyTitle: 'Device details unavailable',
      emptyIcon: Icons.devices_outlined,
      builder: (device) {
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _sectionTitle('Device Info'),
            const SizedBox(height: DesignTokens.spaceSm),
            Container(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                children: [
                  _InfoRow(label: 'Device ID', value: device.id),
                  _InfoRow(label: 'Serial', value: device.serialNumber),
                  if (device.firmwareVersion != null)
                    _InfoRow(label: 'Firmware', value: device.firmwareVersion!),
                  if (device.hardwareRevision != null)
                    _InfoRow(
                        label: 'Hardware', value: device.hardwareRevision!),
                  _InfoRow(
                    label: 'Provisioned',
                    value: formatLastSeen(device.provisionedAt),
                  ),
                ],
              ),
            ),
          ],
        );
      },
    );
  }

  Widget _buildDeviceActions(
    AsyncValue<Device> detailAsync,
    ReleaseAssignmentNotifierState releaseState,
  ) {
    final device = detailAsync.valueOrNull;
    final result = releaseState.result;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _sectionTitle('Device Actions'),
        const SizedBox(height: DesignTokens.spaceSm),
        Container(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (result != null) ...[
                _ReleaseResultBanner(
                  result: result,
                  onDismiss: () =>
                      ref.read(releaseAssignmentProvider.notifier).reset(),
                ),
                const SizedBox(height: DesignTokens.spaceMd),
              ],
              SizedBox(
                width: double.infinity,
                child: OutlinedButton.icon(
                  onPressed: (device != null &&
                          device.activeAssignment != null &&
                          !releaseState.isLoading)
                      ? () => _confirmRelease(context, device)
                      : null,
                  icon: const Icon(Icons.link_off, size: 18),
                  label: const Text('Remove Device'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.error,
                    padding: const EdgeInsets.symmetric(
                        vertical: DesignTokens.spaceSm),
                    side: const BorderSide(color: AppColors.error),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: DesignTokens.spaceXs),
              Text(
                'Unassigns this device from your profile. Your past readings remain attributed to you.',
                style: TextStyle(
                  fontSize: 12,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _confirmRelease(BuildContext context, Device device) {
    showDialog<void>(
      context: context,
      builder: (dialogContext) => _ReleaseConfirmDialog(device: device),
    );
  }

  Widget _sectionTitle(String text) => Text(
        text,
        style: const TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w700,
          color: AppColors.textPrimary,
        ),
      );

  Map<VitalMetric, VitalReading> _latestByMetric(List<VitalReading> readings) {
    final latest = <VitalMetric, VitalReading>{};
    for (final reading in readings) {
      if (!latest.containsKey(reading.metric) ||
          reading.recordedAt.compareTo(latest[reading.metric]!.recordedAt) >
              0) {
        latest[reading.metric] = reading;
      }
    }
    return latest;
  }
}

class _MetricSummaryCard extends StatelessWidget {
  final VitalMetric metric;
  final VitalReading reading;

  const _MetricSummaryCard({required this.metric, required this.reading});

  @override
  Widget build(BuildContext context) {
    final (color, icon) = _DeviceVitalsScreenState._metricVisual(metric);
    final label = _DeviceVitalsScreenState._metricLabel(metric);
    final unit = _DeviceVitalsScreenState._metricUnit(metric);

    return Container(
      width: 150,
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: color, size: 18),
              const SizedBox(width: 4),
              Text(
                label,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            reading.value.toStringAsFixed(
                metric == VitalMetric.oxygenSaturation ? 0 : 1),
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w800,
              color: color,
            ),
          ),
          Text(
            unit,
            style: const TextStyle(
              fontSize: 12,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            formatLastSeen(reading.recordedAt),
            style: const TextStyle(
              fontSize: 11,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

class _ReadingCard extends StatelessWidget {
  final VitalReading reading;

  const _ReadingCard({required this.reading});

  @override
  Widget build(BuildContext context) {
    final (color, icon) =
        _DeviceVitalsScreenState._metricVisual(reading.metric);
    final label = _DeviceVitalsScreenState._metricLabel(reading.metric);
    final unit = reading.unit;

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withValues(alpha: 0.10),
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  _DeviceVitalsScreenState._formatRecordedAt(
                      reading.recordedAt),
                  style: const TextStyle(
                    fontSize: 11,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                '${reading.value.toStringAsFixed(reading.metric == VitalMetric.oxygenSaturation ? 0 : 1)} $unit',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                reading.quality.name,
                style: const TextStyle(
                  fontSize: 11,
                  color: AppColors.textSecondary,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: const TextStyle(
              fontSize: 13,
              color: AppColors.textSecondary,
            ),
          ),
          Text(
            value,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _SkeletonCard extends StatelessWidget {
  final double height;

  const _SkeletonCard({required this.height});

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: AppColors.gray100,
      highlightColor: AppColors.white,
      child: Container(
        height: height,
        decoration: BoxDecoration(
          color: AppColors.white,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Release confirmation dialog
// ---------------------------------------------------------------------------

class _ReleaseConfirmDialog extends ConsumerStatefulWidget {
  final Device device;
  const _ReleaseConfirmDialog({required this.device});

  @override
  ConsumerState<_ReleaseConfirmDialog> createState() =>
      _ReleaseConfirmDialogState();
}

class _ReleaseConfirmDialogState extends ConsumerState<_ReleaseConfirmDialog> {
  DeviceReleaseReasonCode _reason =
      DeviceReleaseReasonCode.administrativeRequest;

  @override
  Widget build(BuildContext context) {
    final releaseState = ref.watch(releaseAssignmentProvider);
    return AlertDialog(
      title: const Text('Remove device?'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'This unassigns ${deviceTypeLabel(widget.device.deviceType)} '
              '(SN: ${widget.device.serialNumber}) from your profile. '
              'Your past readings stay attributed to you; the device becomes '
              'available for reassignment.',
              style: const TextStyle(
                color: AppColors.textSecondary,
                fontSize: 13,
                fontFamily: 'Manrope',
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            const Text(
              'Reason',
              style: TextStyle(
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
                fontFamily: 'Manrope',
              ),
            ),
            const SizedBox(height: DesignTokens.spaceXs),
            DropdownButtonFormField<DeviceReleaseReasonCode>(
              value: _reason,
              decoration: const InputDecoration(
                border: OutlineInputBorder(),
                isDense: true,
              ),
              items: const [
                DropdownMenuItem(
                  value: DeviceReleaseReasonCode.administrativeRequest,
                  child: Text('Administrative request'),
                ),
                DropdownMenuItem(
                  value: DeviceReleaseReasonCode.deviceReplaced,
                  child: Text('Device replaced'),
                ),
                DropdownMenuItem(
                  value: DeviceReleaseReasonCode.deviceFault,
                  child: Text('Device fault'),
                ),
                DropdownMenuItem(
                  value: DeviceReleaseReasonCode.patientDischarged,
                  child: Text('Patient discharged'),
                ),
                DropdownMenuItem(
                  value: DeviceReleaseReasonCode.assignmentCorrection,
                  child: Text('Assignment correction'),
                ),
                DropdownMenuItem(
                  value: DeviceReleaseReasonCode.securityIncident,
                  child: Text('Security incident'),
                ),
                DropdownMenuItem(
                  value: DeviceReleaseReasonCode.offboarding,
                  child: Text('Offboarding'),
                ),
              ],
              onChanged: (v) {
                if (v != null) setState(() => _reason = v);
              },
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed:
              releaseState.isLoading ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: releaseState.isLoading ? null : _doRelease,
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.error,
            foregroundColor: AppColors.white,
          ),
          child: releaseState.isLoading
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.white,
                  ),
                )
              : const Text('Remove'),
        ),
      ],
    );
  }

  Future<void> _doRelease() async {
    final result = await ref.read(releaseAssignmentProvider.notifier).release(
          deviceId: widget.device.id,
          expectedVersion: widget.device.version,
          reasonCode: _reason,
        );
    if (!mounted) return;
    if (result is ReleaseAssignmentSuccess) {
      Navigator.of(context).pop(); // close dialog
      context.pop(); // leave detail screen back to the device list
    }
    // On step-up / conflict / failure, keep the dialog open so the banner can
    // show the message; the user can dismiss or retry.
  }
}

// ---------------------------------------------------------------------------
// Release result banner
// ---------------------------------------------------------------------------

class _ReleaseResultBanner extends StatelessWidget {
  final ReleaseAssignmentResult result;
  final VoidCallback onDismiss;
  const _ReleaseResultBanner({required this.result, required this.onDismiss});

  @override
  Widget build(BuildContext context) {
    final (Color bg, Color fg, IconData icon, String message) =
        switch (result) {
      ReleaseAssignmentSuccess(:final device) => (
          AppColors.successContainer,
          AppColors.successDark,
          Icons.check_circle,
          'Device released. It is now available for reassignment.',
        ),
      ReleaseAssignmentStepUp(:final message) => (
          AppColors.warningContainer,
          AppColors.warningDark,
          Icons.verified_user,
          message,
        ),
      ReleaseAssignmentConflict(:final message) => (
          AppColors.warningContainer,
          AppColors.warningDark,
          Icons.sync_problem,
          message,
        ),
      ReleaseAssignmentFailure(:final message) => (
          AppColors.errorContainer,
          AppColors.errorDark,
          Icons.error_outline,
          message,
        ),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(DesignTokens.spaceSm),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: fg, size: 18),
          const SizedBox(width: DesignTokens.spaceXs),
          Expanded(
            child: Text(
              message,
              style: TextStyle(
                color: fg,
                fontSize: 12,
                fontWeight: FontWeight.w500,
                fontFamily: 'Manrope',
              ),
            ),
          ),
          InkWell(
            onTap: onDismiss,
            child: Icon(Icons.close, color: fg, size: 16),
          ),
        ],
      ),
    );
  }
}
