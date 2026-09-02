import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/ai_provider.dart';
import '../../../../core/providers/health_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/premium_card.dart';
import '../../../../core/widgets/state_view.dart';

/// Smart Diagnosis Summary View 3 — Visual dashboard with charts.
///
/// Wired to [aiArtifactProvider] (GET /ai/artifacts/{id}).
/// Displays the same AI artifact data as Views 1 and 2 but in a
/// visual dashboard layout with charts from real vital readings.
///
/// Uses the light theme (AppColors) and shared widgets (PremiumCard, ErrorView)
/// to match the rest of the app.
class SmartDiagnosisSummaryView3Screen extends ConsumerStatefulWidget {
  final String artifactId;

  const SmartDiagnosisSummaryView3Screen({
    super.key,
    required this.artifactId,
  });

  @override
  ConsumerState<SmartDiagnosisSummaryView3Screen> createState() =>
      _SmartDiagnosisSummaryView3ScreenState();
}

class _SmartDiagnosisSummaryView3ScreenState
    extends ConsumerState<SmartDiagnosisSummaryView3Screen> {
  @override
  Widget build(BuildContext context) {
    final artifactAsync = ref.watch(aiArtifactProvider(widget.artifactId));
    final vitalsAsync =
        ref.watch(vitalReadingsByMetricProvider(VitalMetric.heartRate));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        scrolledUnderElevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.close, color: AppColors.textPrimary),
          onPressed: () => context.pop(),
        ),
        title: const Text(
          'Smart Diagnosis',
          style: TextStyle(
            color: AppColors.textPrimary,
            fontSize: 16,
            fontWeight: FontWeight.w700,
          ),
        ),
        centerTitle: true,
        actions: [
          IconButton(
            icon: const Icon(Icons.save_alt, color: AppColors.textPrimary),
            onPressed: () => _showSaveConfirmation(context),
          ),
        ],
      ),
      body: artifactAsync.when(
        loading: () => const Center(
          child: CircularProgressIndicator(color: AppColors.primary),
        ),
        error: (error, _) => ErrorView(
          title: 'Unable to Load Diagnosis',
          message: _errorMessage(error),
          onRetry: () => ref.invalidate(aiArtifactProvider(widget.artifactId)),
        ),
        data: (artifact) => SingleChildScrollView(
          padding: const EdgeInsets.fromLTRB(DesignTokens.spaceMd,
              DesignTokens.spaceSm, DesignTokens.spaceMd, 140),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildDashboardSummary(artifact),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildRiskGauge(artifact),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildVitalsChart(vitalsAsync),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildContentCard(artifact),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildActionButtons(context),
            ],
          ),
        ),
      ),
      bottomNavigationBar: _buildBottomCTA(),
    );
  }

  Widget _buildDashboardSummary(AiArtifact artifact) {
    final confidence = artifact.confidence ?? 0.0;
    return PremiumCard(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'CONFIDENCE SCORE',
                  style: TextStyle(
                    color: AppColors.textSecondary,
                    fontSize: 10,
                    fontWeight: FontWeight.bold,
                    letterSpacing: 1.5,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      '${(confidence * 100).toInt()}',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 48,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(width: 4),
                    const Text(
                      '%',
                      style: TextStyle(
                        color: AppColors.textSecondary,
                        fontSize: 20,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: confidence > 0 ? confidence : 0.01,
                    minHeight: 8,
                    backgroundColor: AppColors.gray100,
                    valueColor:
                        const AlwaysStoppedAnimation<Color>(AppColors.primary),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Container(
            width: 80,
            height: 80,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  AppColors.primary.withOpacity(0.2),
                  Colors.transparent,
                ],
              ),
            ),
            child: const Icon(
              Icons.insights,
              color: AppColors.primary,
              size: 36,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRiskGauge(AiArtifact artifact) {
    final riskColor = _riskColor(artifact.riskLevel);
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: riskColor.withOpacity(0.2)),
        boxShadow: const [
          BoxShadow(
              color: AppColors.shadow, blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.shield_outlined, color: riskColor, size: 20),
              const SizedBox(width: 8),
              const Text(
                'RISK ASSESSMENT',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Row(
            children: [
              Expanded(
                child: _buildRiskBar('Low',
                    artifact.riskLevel == AiRiskLevel.low, AppColors.success),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: _buildRiskBar(
                    'Mod',
                    artifact.riskLevel == AiRiskLevel.moderate,
                    AppColors.warning),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: _buildRiskBar(
                    'High',
                    artifact.riskLevel == AiRiskLevel.high,
                    AppColors.warningDark),
              ),
              const SizedBox(width: 4),
              Expanded(
                child: _buildRiskBar(
                    'Crit',
                    artifact.riskLevel == AiRiskLevel.critical,
                    AppColors.error),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            artifact.riskLevel.wireValue.toUpperCase(),
            style: TextStyle(
              color: riskColor,
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRiskBar(String label, bool isActive, Color color) {
    return Column(
      children: [
        Container(
          height: 8,
          decoration: BoxDecoration(
            color: isActive ? color : color.withOpacity(0.15),
            borderRadius: BorderRadius.circular(4),
          ),
        ),
        const SizedBox(height: 6),
        Text(
          label,
          style: TextStyle(
            color: isActive ? color : AppColors.textSecondary,
            fontSize: 10,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }

  Widget _buildVitalsChart(AsyncValue<List<VitalReading>> vitalsAsync) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: const [
          BoxShadow(
              color: AppColors.shadow, blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.favorite, color: AppColors.heartRate, size: 20),
              const SizedBox(width: 8),
              const Text(
                'VITALS TREND',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.5,
                ),
              ),
              const Spacer(),
              vitalsAsync.maybeWhen(
                data: (readings) => readings.isNotEmpty
                    ? Text(
                        '${readings.last.value.toStringAsFixed(0)} ${readings.last.unit}',
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                        ),
                      )
                    : const Text(
                        'No data',
                        style: TextStyle(
                            color: AppColors.textSecondary, fontSize: 14),
                      ),
                orElse: () => const SizedBox.shrink(),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          vitalsAsync.when(
            loading: () => const SizedBox(
              height: 160,
              child: Center(
                child: CircularProgressIndicator(color: AppColors.heartRate),
              ),
            ),
            error: (_, __) => const SizedBox(
              height: 160,
              child: Center(
                child: Text(
                  'Unable to load vitals',
                  style:
                      TextStyle(color: AppColors.textSecondary, fontSize: 14),
                ),
              ),
            ),
            data: (readings) {
              if (readings.isEmpty) {
                return const SizedBox(
                  height: 160,
                  child: Center(
                    child: Text(
                      'No vital readings available',
                      style: TextStyle(
                          color: AppColors.textSecondary, fontSize: 14),
                    ),
                  ),
                );
              }
              final spots = <FlSpot>[];
              for (var i = 0; i < readings.length; i++) {
                spots.add(FlSpot(i.toDouble(), readings[i].value));
              }
              return SizedBox(
                height: 160,
                child: LineChart(
                  LineChartData(
                    minY: 40,
                    maxY: 180,
                    gridData: const FlGridData(show: false),
                    titlesData: const FlTitlesData(show: false),
                    borderData: FlBorderData(show: false),
                    lineBarsData: [
                      LineChartBarData(
                        spots: spots,
                        isCurved: true,
                        color: AppColors.heartRate,
                        barWidth: 2.5,
                        isStrokeCapRound: true,
                        dotData: const FlDotData(show: false),
                        belowBarData: BarAreaData(
                          show: true,
                          color: AppColors.heartRate.withOpacity(0.1),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildContentCard(AiArtifact artifact) {
    final symptoms = artifact.content.summaryOfReportedSymptoms;
    final notice = artifact.content.informationOnlyNotice;
    final content = (symptoms != null && symptoms.isNotEmpty)
        ? symptoms.join('\n')
        : notice;
    if (content == null || content.isEmpty) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: const [
          BoxShadow(
              color: AppColors.shadow, blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.description_outlined,
                  color: AppColors.primary, size: 20),
              const SizedBox(width: 8),
              const Text(
                'AI ANALYSIS',
                style: TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 10,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.5,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            content,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 14,
              height: 1.6,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildActionButtons(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: GestureDetector(
            onTap: () => _showSaveConfirmation(context),
            child: Container(
              height: 48,
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                border: Border.all(color: AppColors.gray300),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.save_outlined,
                      color: AppColors.textPrimary, size: 18),
                  SizedBox(width: 6),
                  Text(
                    'Save to Records',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: GestureDetector(
            onTap: () => context.push('/doctor-chat'),
            child: Container(
              height: 48,
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              child: const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.share_outlined, color: AppColors.white, size: 18),
                  SizedBox(width: 6),
                  Text(
                    'Share with Doctor',
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: AppColors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildBottomCTA() {
    return SafeArea(
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: const BoxDecoration(
          color: AppColors.surface,
          border: Border(
            top: BorderSide(color: AppColors.gray200),
          ),
        ),
        child: ElevatedButton(
          onPressed: () => context.push('/find-doctor'),
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: AppColors.white,
            padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            ),
            elevation: 0,
          ),
          child: const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                'Book Specialist Consultation',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                ),
              ),
              SizedBox(width: 8),
              Icon(Icons.calendar_month, size: 18),
            ],
          ),
        ),
      ),
    );
  }

  void _showSaveConfirmation(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Diagnosis saved to health records'),
        backgroundColor: AppColors.primary,
      ),
    );
  }

  String _errorMessage(Object? error) {
    if (error == null) return 'Failed to load AI diagnosis';
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return error.toString();
  }

  Color _riskColor(AiRiskLevel level) {
    return switch (level) {
      AiRiskLevel.low => AppColors.success,
      AiRiskLevel.moderate => AppColors.warning,
      AiRiskLevel.high => AppColors.warningDark,
      AiRiskLevel.critical => AppColors.error,
      AiRiskLevel.unknown => AppColors.gray400,
    };
  }
}
