import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// A line chart for plotting a patient's vital readings over time. Each point
/// is a (sequence index, value) pair; the x-axis is the reading order and the
/// y-axis is the measured value in the provided [unit].
///
/// Pass [spots] as already-sorted (x, y) pairs. The widget does no aggregation —
/// the caller is responsible for bucketing a large series.
class VitalChartWidget extends StatelessWidget {
  const VitalChartWidget({
    super.key,
    required this.spots,
    required this.unit,
    this.title,
    this.color = AppColors.primary,
    this.minY,
    this.maxY,
    this.height = 180,
  });

  final List<FlSpot> spots;
  final String unit;
  final String? title;
  final Color color;
  final double? minY;
  final double? maxY;
  final double height;

  @override
  Widget build(BuildContext context) {
    final hasData = spots.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (title != null)
          Padding(
            padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
            child: Row(
              children: [
                Text(
                  title!,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
                const Spacer(),
                Text(
                  unit,
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: AppColors.gray500,
                      ),
                ),
              ],
            ),
          ),
        SizedBox(
          height: height,
          child: hasData
              ? LineChart(
                  LineChartData(
                    minY: minY,
                    maxY: maxY,
                    gridData: FlGridData(
                      show: true,
                      drawVerticalLine: false,
                      horizontalInterval: 1,
                      getDrawingHorizontalLine: (_) => _horizontalGrid,
                    ),
                    titlesData: const FlTitlesData(
                      leftTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 32,
                          interval: 1,
                        ),
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
                        color: color,
                        barWidth: 2.5,
                        dotData: const FlDotData(show: false),
                        belowBarData: BarAreaData(
                          show: true,
                          color: color.withOpacity(0.08),
                        ),
                      ),
                    ],
                    lineTouchData: const LineTouchData(
                      touchTooltipData: LineTouchTooltipData(
                        getTooltipItems: _defaultTooltip,
                      ),
                    ),
                  ),
                )
              : Center(
                  child: Text(
                    'No readings yet',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.gray400,
                        ),
                  ),
                ),
        ),
      ],
    );
  }
}

const _horizontalGrid = FlLine(
  color: AppColors.gray100,
  strokeWidth: 1,
);

List<LineTooltipItem> _defaultTooltip(List<LineBarSpot> spots) {
  return spots
      .map((s) => LineTooltipItem(
            '${s.y.toStringAsFixed(1)}',
            const TextStyle(
              color: AppColors.white,
              fontWeight: FontWeight.w600,
              fontSize: 12,
            ),
          ))
      .toList();
}
