import 'package:flutter/material.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../theme/app_colors.dart';
import 'status_badge.dart';

/// Maps a [DeviceType] to an icon and a human-readable label.
///
/// The wire vocabulary is the single source of truth for the enum, so this
/// helper is keyed on the generated [DeviceType] (not a hand-typed string),
/// which means an invented device type cannot compile here. The `unknown`
/// case is the fallback for an unrecognized server value.
class DeviceTypeIcon {
  DeviceTypeIcon._();

  static IconData icon(DeviceType type) => switch (type) {
        DeviceType.vitalsMonitor => Icons.monitor_heart_rounded,
        DeviceType.ecg => Icons.show_chart_rounded,
        DeviceType.thermometer => Icons.thermostat_rounded,
        DeviceType.pulseOximeter => Icons.bloodtype_rounded,
        DeviceType.phone => Icons.smartphone_rounded,
        DeviceType.simulator => Icons.science_rounded,
        DeviceType.unknown => Icons.devices_other_rounded,
      };

  static String label(DeviceType type) => switch (type) {
        DeviceType.vitalsMonitor => 'Vitals Monitor',
        DeviceType.ecg => 'ECG',
        DeviceType.thermometer => 'Thermometer',
        DeviceType.pulseOximeter => 'Pulse Oximeter',
        DeviceType.phone => 'Phone',
        DeviceType.simulator => 'Simulator',
        DeviceType.unknown => 'Device',
      };
}

/// Presentation helpers for the device lifecycle state. `state` is the
/// lifecycle (provisioned/active/suspended/retired), NOT connectivity —
/// reachability is `last_seen_at`, which only ingestion writes.
extension DeviceStatePresentation on DeviceState {
  String get label => switch (this) {
        DeviceState.provisioned => 'Provisioned',
        DeviceState.active => 'Active',
        DeviceState.suspended => 'Suspended',
        DeviceState.retired => 'Retired',
        DeviceState.unknown => 'Unknown',
      };

  /// A device is assignable only when provisioned or active; the available
  /// list already filters to these, but this keeps the UI honest if a device
  /// changes state between the list load and the assign tap.
  bool get isAssignable =>
      this == DeviceState.provisioned || this == DeviceState.active;

  StatusBadgeTone get badgeTone => switch (this) {
        DeviceState.active => StatusBadgeTone.success,
        DeviceState.provisioned => StatusBadgeTone.info,
        DeviceState.suspended => StatusBadgeTone.warning,
        DeviceState.retired => StatusBadgeTone.neutral,
        DeviceState.unknown => StatusBadgeTone.neutral,
      };

  Color get iconColor => switch (this) {
        DeviceState.active => AppColors.success,
        DeviceState.provisioned => AppColors.info,
        DeviceState.suspended => AppColors.warning,
        DeviceState.retired => AppColors.gray500,
        DeviceState.unknown => AppColors.gray400,
      };
}

/// The release reason-code vocabulary, declared once as the single source so
/// an invented code cannot compile. The wire values match the backend's
/// `device_release_reason_code` enum. `unknown` is the fallback only.
class DeviceReleaseReason {
  DeviceReleaseReason._();

  static const values = <DeviceReleaseReasonCode>[
    DeviceReleaseReasonCode.administrativeRequest,
    DeviceReleaseReasonCode.deviceReplaced,
    DeviceReleaseReasonCode.deviceFault,
    DeviceReleaseReasonCode.patientDischarged,
    DeviceReleaseReasonCode.assignmentCorrection,
    DeviceReleaseReasonCode.securityIncident,
    DeviceReleaseReasonCode.offboarding,
  ];

  static String label(DeviceReleaseReasonCode code) => switch (code) {
        DeviceReleaseReasonCode.administrativeRequest =>
          'Administrative request',
        DeviceReleaseReasonCode.deviceReplaced => 'Device replaced',
        DeviceReleaseReasonCode.deviceFault => 'Device fault',
        DeviceReleaseReasonCode.patientDischarged => 'Patient discharged',
        DeviceReleaseReasonCode.assignmentCorrection =>
          'Assignment correction',
        DeviceReleaseReasonCode.securityIncident => 'Security incident',
        DeviceReleaseReasonCode.offboarding => 'Offboarding',
        DeviceReleaseReasonCode.unknown => 'Unknown',
      };
}
