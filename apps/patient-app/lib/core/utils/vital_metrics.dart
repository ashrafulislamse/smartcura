 import 'package:smartcura_contracts/smartcura_contracts.dart';

/// Human-readable label for a vital metric, for sentences like
/// "Your heart rate reading needs attention."
///
/// The `default` arm keeps this total without re-typing the enum — new
/// metrics fall back to a generic label instead of failing to compile
/// silently elsewhere.
String vitalMetricLabel(VitalMetric metric) {
  switch (metric) {
    case VitalMetric.heartRate:
      return 'heart rate';
    case VitalMetric.oxygenSaturation:
      return 'SpO₂';
    case VitalMetric.bodyTemperature:
      return 'temperature';
    case VitalMetric.systolicBp:
    case VitalMetric.diastolicBp:
    case VitalMetric.bloodPressure:
      return 'blood pressure';
    case VitalMetric.respiratoryRate:
      return 'respiratory rate';
    case VitalMetric.ecgVoltage:
      return 'ECG';
    case VitalMetric.bloodGlucose:
      return 'blood glucose';
    case VitalMetric.bodyWeight:
      return 'body weight';
    default:
      return 'vital reading';
  }
}
