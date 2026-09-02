import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/ai_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/premium_card.dart';
import '../../../../core/widgets/state_view.dart';

/// Smart Diagnosis Summary View 1 — Card-based layout with sections.
///
/// Wired to [aiArtifactProvider] (GET /ai/artifacts/{id}).
/// Displays AI diagnosis findings, confidence score, risk level, and
/// recommendations from the artifact's non-diagnostic content.
///
/// Uses the light theme (AppColors) and shared widgets (PremiumCard, ErrorView)
/// to match the rest of the app.
class SmartDiagnosisSummaryView1Screen extends ConsumerStatefulWidget {
  final String artifactId;

  const SmartDiagnosisSummaryView1Screen({
    super.key,
    required this.artifactId,
  });

  @override
  ConsumerState<SmartDiagnosisSummaryView1Screen> createState() =>
      _SmartDiagnosisSummaryView1ScreenState();
}

class _SmartDiagnosisSummaryView1ScreenState
    extends ConsumerState<SmartDiagnosisSummaryView1Screen> {
  @override
  Widget build(BuildContext context) {
    final artifactAsync = ref.watch(aiArtifactProvider(widget.artifactId));

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
              _buildAnalysisSummaryCard(artifact),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildKeyFindings(artifact),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildContentSection(artifact),
              const SizedBox(height: DesignTokens.spaceLg),
              _buildActionButtons(context),
            ],
          ),
        ),
      ),
      bottomNavigationBar: _buildBottomCTA(context),
    );
  }

  Widget _buildAnalysisSummaryCard(AiArtifact artifact) {
    final confidence = artifact.confidence ?? 0.0;
    return PremiumCard(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      child: Column(
        children: [
          Text(
            'ANALYSIS SUMMARY',
            style: TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10,
              fontWeight: FontWeight.bold,
              letterSpacing: 2,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          SizedBox(
            width: 160,
            height: 160,
            child: Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 160,
                  height: 160,
                  child: CircularProgressIndicator(
                    value: confidence > 0 ? confidence : 0.01,
                    strokeWidth: 10,
                    backgroundColor: AppColors.gray100,
                    valueColor:
                        const AlwaysStoppedAnimation<Color>(AppColors.primary),
                    strokeCap: StrokeCap.round,
                  ),
                ),
                Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      '${(confidence * 100).toInt()}%',
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 36,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 4),
                    const Text(
                      'CONFIDENCE',
                      style: TextStyle(
                        color: AppColors.primary,
                        fontSize: 10,
                        fontWeight: FontWeight.w500,
                        letterSpacing: 1.5,
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            _artifactTypeLabel(artifact.artifactType),
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 24,
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            'Risk Level: ${artifact.riskLevel.wireValue}',
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 14,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildKeyFindings(AiArtifact artifact) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            'Key Findings',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        Row(
          children: [
            Expanded(
              child: _buildFindingCard(
                icon: Icons.analytics_outlined,
                label: 'Type',
                value: _artifactTypeLabel(artifact.artifactType),
                color: AppColors.primary,
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm),
            Expanded(
              child: _buildFindingCard(
                icon: Icons.shield_outlined,
                label: 'Risk',
                value: artifact.riskLevel.wireValue,
                color: _riskColor(artifact.riskLevel),
              ),
            ),
            const SizedBox(width: DesignTokens.spaceSm),
            Expanded(
              child: _buildFindingCard(
                icon: Icons.verified_outlined,
                label: 'Review',
                value: artifact.reviewStatus.wireValue,
                color: AppColors.warning,
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildFindingCard({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
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
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: color.withOpacity(0.2),
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: color, size: 20),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            label.toUpperCase(),
            style: const TextStyle(
              color: AppColors.textSecondary,
              fontSize: 10,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildContentSection(AiArtifact artifact) {
    final symptoms = artifact.content.summaryOfReportedSymptoms;
    final notice = artifact.content.informationOnlyNotice;
    final content = (symptoms != null && symptoms.isNotEmpty)
        ? symptoms.join('\n')
        : notice;
    if (content == null || content.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 4),
          child: Text(
            'AI Analysis',
            style: TextStyle(
              color: AppColors.textPrimary,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        PremiumCard(
          padding: const EdgeInsets.all(DesignTokens.spaceLg),
          child: Text(
            content,
            style: const TextStyle(
              color: AppColors.textPrimary,
              fontSize: 14,
              height: 1.6,
            ),
          ),
        ),
      ],
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

  Widget _buildBottomCTA(BuildContext context) {
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

  String _artifactTypeLabel(AiArtifactType type) {
    return switch (type) {
      AiArtifactType.symptomSummary => 'Symptom Summary',
      AiArtifactType.careNavigation => 'Care Navigation',
      AiArtifactType.healthSummary => 'Health Summary',
      AiArtifactType.dailySummary => 'Daily Summary',
      AiArtifactType.trendAnalysis => 'Trend Analysis',
      AiArtifactType.riskFlag => 'Risk Assessment',
      AiArtifactType.forecast => 'Health Forecast',
      AiArtifactType.anomaly => 'Anomaly Detection',
      AiArtifactType.unknown => 'AI Analysis',
    };
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
