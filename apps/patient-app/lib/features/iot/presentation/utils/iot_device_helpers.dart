import 'package:flutter/material.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/status_badge.dart';

/// Shared IoT device presentation helpers.
///
/// These were duplicated across `PatientDevicesScreen` and `DeviceVitalsScreen`.
/// Keeping them in one place guarantees that a new `DeviceType` or
/// `DeviceState` is rendered consistently everywhere.
(IconData, Color) deviceIconAndColor(DeviceType type) {
  return switch (type) {
    DeviceType.vitalsMonitor => (Icons.monitor_heart, AppColors.heartRate),
    DeviceType.ecg => (Icons.favorite, AppColors.error),
    DeviceType.thermometer => (Icons.thermostat, AppColors.temperature),
    DeviceType.pulseOximeter => (Icons.air, AppColors.oxygen),
    DeviceType.simulator => (Icons.science, AppColors.primary),
    DeviceType.phone => (Icons.smartphone, AppColors.primary),
    _ => (Icons.devices, AppColors.gray500),
  };
}

(String, StatusTone) deviceStateStyle(DeviceState state) {
  return switch (state) {
    DeviceState.active => ('Active', StatusTone.success),
    DeviceState.provisioned => ('Provisioned', StatusTone.info),
    DeviceState.suspended => ('Suspended', StatusTone.warning),
    DeviceState.retired => ('Disconnected', StatusTone.neutral),
    _ => ('Unknown', StatusTone.neutral),
  };
}

String deviceTypeLabel(DeviceType type) {
  return switch (type) {
    DeviceType.vitalsMonitor => 'Vitals Monitor',
    DeviceType.ecg => 'ECG Device',
    DeviceType.thermometer => 'Thermometer',
    DeviceType.pulseOximeter => 'Pulse Oximeter',
    DeviceType.simulator => 'Simulator',
    DeviceType.phone => 'Phone (Health Connect)',
    _ => 'Device',
  };
}

String formatLastSeen(String? isoTimestamp) {
  if (isoTimestamp == null) return 'Not synced yet';
  try {
    final dt = DateTime.parse(isoTimestamp);
    final diff = DateTime.now().difference(dt);
    if (diff.inMinutes < 1) return 'Just now';
    if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
    if (diff.inHours < 24) return '${diff.inHours}h ago';
    if (diff.inDays < 7) return '${diff.inDays}d ago';
    return '${dt.month}/${dt.day}/${dt.year}';
  } catch (_) {
    return '—';
  }
}
