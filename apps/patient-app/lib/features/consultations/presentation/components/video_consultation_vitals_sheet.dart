import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// A bottom sheet that lets the patient select vital readings to share with
/// the doctor during a video consultation. It shows a preview and only shares
/// what the patient explicitly selects.
class VideoConsultationVitalsSheet extends StatefulWidget {
  final List<VitalReading> readings;
  final String doctorName;
  final void Function(List<VitalReading> selected) onShare;

  const VideoConsultationVitalsSheet({
    super.key,
    required this.readings,
    required this.doctorName,
    required this.onShare,
  });

  @override
  State<VideoConsultationVitalsSheet> createState() =>
      _VideoConsultationVitalsSheetState();
}

class _VideoConsultationVitalsSheetState
    extends State<VideoConsultationVitalsSheet> {
  final Set<String> _selectedIds = {};

  List<VitalReading> get _selectedReadings =>
      widget.readings.where((r) => _selectedIds.contains(r.id)).toList();

  String _formatValue(VitalReading reading) {
    if (reading.metric == VitalMetric.bloodPressure) {
      // Blood pressure may arrive as a single reading; show value + unit.
      return '${reading.value.toStringAsFixed(0)} ${reading.unit}';
    }
    return '${reading.value.toStringAsFixed(reading.value == reading.value.toInt() ? 0 : 1)} ${reading.unit}';
  }

  String _metricLabel(VitalMetric metric) {
    switch (metric) {
      case VitalMetric.heartRate:
        return 'Heart Rate';
      case VitalMetric.oxygenSaturation:
        return 'SpO₂';
      case VitalMetric.bodyTemperature:
        return 'Temperature';
      case VitalMetric.systolicBp:
        return 'Systolic BP';
      case VitalMetric.diastolicBp:
        return 'Diastolic BP';
      case VitalMetric.bloodPressure:
        return 'Blood Pressure';
      case VitalMetric.bloodGlucose:
        return 'Blood Glucose';
      case VitalMetric.bodyWeight:
        return 'Weight';
      case VitalMetric.respiratoryRate:
        return 'Respiratory Rate';
      case VitalMetric.ecgVoltage:
        return 'ECG';
      case VitalMetric.unknown:
        return 'Unknown';
    }
  }

  IconData _metricIcon(VitalMetric metric) {
    switch (metric) {
      case VitalMetric.heartRate:
        return Icons.favorite_rounded;
      case VitalMetric.oxygenSaturation:
        return Icons.water_drop_rounded;
      case VitalMetric.bodyTemperature:
        return Icons.thermostat_rounded;
      case VitalMetric.systolicBp:
      case VitalMetric.diastolicBp:
      case VitalMetric.bloodPressure:
        return Icons.speed_rounded;
      case VitalMetric.bloodGlucose:
        return Icons.opacity_rounded;
      case VitalMetric.bodyWeight:
        return Icons.monitor_weight_rounded;
      case VitalMetric.respiratoryRate:
        return Icons.air_rounded;
      case VitalMetric.ecgVoltage:
        return Icons.monitor_heart_rounded;
      case VitalMetric.unknown:
        return Icons.help_outline_rounded;
    }
  }

  Color _metricColor(VitalMetric metric) {
    switch (metric) {
      case VitalMetric.heartRate:
        return AppColors.heartRate;
      case VitalMetric.oxygenSaturation:
        return AppColors.oxygen;
      case VitalMetric.bodyTemperature:
        return AppColors.temperature;
      case VitalMetric.systolicBp:
      case VitalMetric.diastolicBp:
      case VitalMetric.bloodPressure:
        return AppColors.bloodPressure;
      case VitalMetric.bloodGlucose:
        return AppColors.glucose;
      case VitalMetric.bodyWeight:
        return AppColors.secondary;
      case VitalMetric.respiratoryRate:
        return AppColors.primary;
      case VitalMetric.ecgVoltage:
        return AppColors.emergency;
      case VitalMetric.unknown:
        return AppColors.gray500;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height * 0.7,
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(DesignTokens.radius2xl),
          topRight: Radius.circular(DesignTokens.radius2xl),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Handle and header.
            Container(
              padding: const EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceSm,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
              ),
              decoration: BoxDecoration(
                color: AppColors.background,
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(DesignTokens.radius2xl),
                  topRight: Radius.circular(DesignTokens.radius2xl),
                ),
              ),
              child: Column(
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(
                        color: AppColors.gray300,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  Row(
                    children: [
                      Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: AppColors.primaryContainer,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.favorite_rounded,
                          color: AppColors.primary,
                        ),
                      ),
                      const SizedBox(width: DesignTokens.spaceMd),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Text(
                              'Share Vitals',
                              style: TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 18,
                                fontWeight: FontWeight.w700,
                                color: AppColors.textPrimary,
                              ),
                            ),
                            Text(
                              'Select readings to share with ${widget.doctorName}',
                              style: const TextStyle(
                                fontFamily: 'Manrope',
                                fontSize: 13,
                                color: AppColors.textSecondary,
                              ),
                            ),
                          ],
                        ),
                      ),
                      IconButton(
                        onPressed: () => Navigator.pop(context),
                        icon: const Icon(Icons.close),
                        tooltip: 'Close',
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // Explanation.
            Padding(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              child: Container(
                padding: const EdgeInsets.all(DesignTokens.spaceMd),
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: const Row(
                  children: [
                    Icon(
                      Icons.privacy_tip_outlined,
                      color: AppColors.primary,
                      size: 20,
                    ),
                    SizedBox(width: DesignTokens.spaceMd),
                    Expanded(
                      child: Text(
                        'You choose what to share. Only selected readings are shown to the doctor.',
                        style: TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 13,
                          color: AppColors.primaryOnContainer,
                          height: 1.4,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // Vitals list.
            Expanded(
              child: widget.readings.isEmpty
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            Icons.monitor_heart_outlined,
                            size: 48,
                            color: AppColors.gray400,
                          ),
                          const SizedBox(height: DesignTokens.spaceMd),
                          const Text(
                            'No vitals available',
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontSize: 16,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textSecondary,
                            ),
                          ),
                          const SizedBox(height: DesignTokens.spaceSm),
                          const Text(
                            'Record or sync vitals from your Health tab first.',
                            textAlign: TextAlign.center,
                            style: TextStyle(
                              fontFamily: 'Manrope',
                              fontSize: 13,
                              color: AppColors.textSecondary,
                            ),
                          ),
                        ],
                      ),
                    )
                  : ListView.builder(
                      padding: const EdgeInsets.symmetric(
                        horizontal: DesignTokens.spaceMd,
                      ),
                      itemCount: widget.readings.length,
                      itemBuilder: (context, index) {
                        final reading = widget.readings[index];
                        final selected = _selectedIds.contains(reading.id);
                        return _buildVitalTile(reading, selected);
                      },
                    ),
            ),

            // Preview + share button.
            Container(
              padding: EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                MediaQuery.of(context).padding.bottom + DesignTokens.spaceMd,
              ),
              decoration: BoxDecoration(
                color: AppColors.background,
                border: Border(
                  top: BorderSide(color: AppColors.border),
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (_selectedReadings.isNotEmpty) ...[
                    Text(
                      'Preview (${_selectedReadings.length} selected)',
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceSm),
                    Container(
                      width: double.infinity,
                      padding: const EdgeInsets.all(DesignTokens.spaceMd),
                      decoration: BoxDecoration(
                        color: AppColors.surface,
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusMd),
                        border: Border.all(color: AppColors.border),
                      ),
                      child: Wrap(
                        spacing: DesignTokens.spaceMd,
                        runSpacing: DesignTokens.spaceSm,
                        children: _selectedReadings
                            .map((r) => _buildPreviewChip(r))
                            .toList(),
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                  ],
                  SizedBox(
                    width: double.infinity,
                    height: DesignTokens.buttonHeightLg,
                    child: ElevatedButton(
                      onPressed: _selectedReadings.isEmpty
                          ? null
                          : () {
                              HapticFeedback.lightImpact();
                              widget.onShare(_selectedReadings);
                              Navigator.pop(context);
                            },
                      style: ElevatedButton.styleFrom(
                        backgroundColor: AppColors.primary,
                        foregroundColor: AppColors.white,
                        disabledBackgroundColor: AppColors.gray200,
                        disabledForegroundColor: AppColors.gray400,
                        elevation: 0,
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusLg),
                        ),
                      ),
                      child: Text(
                        _selectedReadings.isEmpty
                            ? 'Select at least one reading'
                            : 'Share ${_selectedReadings.length} Reading${_selectedReadings.length == 1 ? '' : 's'}',
                        style: const TextStyle(
                          fontFamily: 'Manrope',
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
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

  Widget _buildVitalTile(VitalReading reading, bool selected) {
    final color = _metricColor(reading.metric);
    final recordedAt = DateTime.parse(reading.recordedAt).toLocal();
    final timeText = DateFormat('MMM d, h:mm a').format(recordedAt);

    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      child: InkWell(
        onTap: () {
          setState(() {
            if (selected) {
              _selectedIds.remove(reading.id);
            } else {
              _selectedIds.add(reading.id);
            }
          });
          HapticFeedback.selectionClick();
        },
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        child: Container(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: selected ? color.withValues(alpha: 0.08) : AppColors.surface,
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            border: Border.all(
              color: selected ? color : AppColors.border,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  shape: BoxShape.circle,
                ),
                child: Icon(
                  _metricIcon(reading.metric),
                  color: color,
                  size: 22,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _metricLabel(reading.metric),
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      timeText,
                      style: const TextStyle(
                        fontFamily: 'Manrope',
                        fontSize: 12,
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
                    _formatValue(reading),
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                      color: color,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    reading.quality.name == 'good' ? 'Good' : 'Fair',
                    style: TextStyle(
                      fontFamily: 'Manrope',
                      fontSize: 12,
                      color: AppColors.textSecondary.withValues(alpha: 0.8),
                    ),
                  ),
                ],
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              SizedBox(
                width: 24,
                height: 24,
                child: Checkbox(
                  value: selected,
                  onChanged: (_) {
                    setState(() {
                      if (selected) {
                        _selectedIds.remove(reading.id);
                      } else {
                        _selectedIds.add(reading.id);
                      }
                    });
                    HapticFeedback.selectionClick();
                  },
                  activeColor: color,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusXs),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPreviewChip(VitalReading reading) {
    final color = _metricColor(reading.metric);
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceMd,
        vertical: DesignTokens.spaceSm,
      ),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
      ),
      child: Text(
        '${_metricLabel(reading.metric)}: ${_formatValue(reading)}',
        style: TextStyle(
          fontFamily: 'Manrope',
          fontSize: 12,
          fontWeight: FontWeight.w600,
          color: color,
        ),
      ),
    );
  }
}
