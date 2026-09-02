import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A line chart that plots vital readings over time. Used on the health screen
/// for heart rate, SpO2, temperature, etc. The x-axis is time (by index), the
/// y-axis is the reading value.
class VitalChartWidget extends StatelessWidget {
  final List<VitalReading> readings;
  final Color lineColor;
  final String unit;
  final double minY;
  final double maxY;
  final String title;

  const VitalChartWidget({
    super.key,
    required this.readings,
    this.lineColor = AppColors.heartRate,
    this.unit = '',
    this.minY = 0,
    this.maxY = 100,
    this.title = '',
  });

  @override
  Widget build(BuildContext context) {
    if (readings.isEmpty) {
      return SizedBox(
        height: 180,
        child: Center(
          child: Text(
            'No data available',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.textSecondary,
                ),
          ),
        ),
      );
    }

    final spots = <FlSpot>[];
    for (var i = 0; i < readings.length; i++) {
      spots.add(FlSpot(i.toDouble(), readings[i].value));
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (title.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
            child: Text(
              title,
              style: Theme.of(context).textTheme.titleSmall,
            ),
          ),
        SizedBox(
          height: 180,
          child: LineChart(
            LineChartData(
              minY: minY,
              maxY: maxY,
              gridData: FlGridData(
                show: true,
                drawVerticalLine: false,
                horizontalInterval: _interval(minY, maxY),
                getDrawingHorizontalLine: (value) => FlLine(
                  color: AppColors.gray100,
                  strokeWidth: 1,
                ),
              ),
              titlesData: const FlTitlesData(
                leftTitles: AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
                bottomTitles: AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
                rightTitles: AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
                topTitles: AxisTitles(
                  sideTitles: SideTitles(showTitles: false),
                ),
              ),
              borderData: FlBorderData(show: false),
              lineBarsData: [
                LineChartBarData(
                  spots: spots,
                  isCurved: true,
                  color: lineColor,
                  barWidth: 2.5,
                  isStrokeCapRound: true,
                  dotData: const FlDotData(show: false),
                  belowBarData: BarAreaData(
                    show: true,
                    color: lineColor.withOpacity(0.1),
                  ),
                ),
              ],
              lineTouchData: LineTouchData(
                touchTooltipData: LineTouchTooltipData(
                  getTooltipItems: (touchedSpots) {
                    return touchedSpots.map((spot) {
                      final reading = readings[spot.spotIndex];
                      return LineTooltipItem(
                        '${reading.value.toStringAsFixed(1)} $unit',
                        TextStyle(
                          color: AppColors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                        ),
                      );
                    }).toList();
                  },
                ),
              ),
            ),
          ),
        ),
      ],
    );
  }

  double _interval(double minY, double maxY) {
    final range = maxY - minY;
    if (range <= 0) return 1;
    return range / 4;
  }
}
