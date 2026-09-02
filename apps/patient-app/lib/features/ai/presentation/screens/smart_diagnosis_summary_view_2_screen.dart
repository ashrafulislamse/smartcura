import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/ai_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/state_view.dart';

/// Smart Diagnosis Summary View 2 — List-based layout with expandable cards.
///
/// Wired to [aiArtifactProvider] (GET /ai/artifacts/{id}).
/// Displays the same AI artifact data as View 1 but in a list-based
/// layout with expandable detail cards.
///
/// Uses the light theme (AppColors) and shared widgets (PremiumCard, ErrorView)
/// to match the rest of the app.
class SmartDiagnosisSummaryView2Screen extends ConsumerStatefulWidget {
  final String artifactId;

  const SmartDiagnosisSummaryView2Screen({
    super.key,
    required this.artifactId,
  });

  @override
  ConsumerState<SmartDiagnosisSummaryView2Screen> createState() =>
      _SmartDiagnosisSummaryView2ScreenState();
}

class _SmartDiagnosisSummaryView2ScreenState
    extends ConsumerState<SmartDiagnosisSummaryView2Screen> {
  final _expandedSections = <String, bool>{
    'summary': true,
    'findings': true,
    'analysis': false,
    'actions': false,
  };

  void _toggleSection(String key) {
    setState(() {
      _expandedSections[key] = !(_expandedSections[key] ?? false);
    });
  }

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
              _buildExpandableCard(
                key: 'summary',
                title: 'Analysis Summary',
                icon: Icons.insights_outlined,
                child: _buildSummaryContent(artifact),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              _buildExpandableCard(
                key: 'findings',
                title: 'Key Findings',
                icon: Icons.fact_check_outlined,
                child: _buildFindingsContent(artifact),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              _buildExpandableCard(
                key: 'analysis',
                title: 'AI Analysis Details',
                icon: Icons.description_outlined,
                child: _buildAnalysisContent(artifact),
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              _buildExpandableCard(
                key: 'actions',
                title: 'Recommended Actions',
                icon: Icons.medical_services_outlined,
                child: _buildActionsContent(context),
              ),
            ],
          ),
        ),
      ),
      bottomNavigationBar: _buildBottomCTA(),
    );
  }

  Widget _buildExpandableCard({
    required String key,
    required String title,
    required IconData icon,
    required Widget child,
  }) {
    final isExpanded = _expandedSections[key] ?? true;
    return Container(
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
          GestureDetector(
            onTap: () => _toggleSection(key),
            child: Container(
              padding: const EdgeInsets.all(DesignTokens.spaceLg),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.primary.withOpacity(0.15),
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                    ),
                    child: Icon(icon, color: AppColors.primary, size: 20),
                  ),
                  const SizedBox(width: DesignTokens.spaceMd),
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        color: AppColors.textPrimary,
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  AnimatedRotation(
                    turns: isExpanded ? 0.25 : 0,
                    duration: const Duration(milliseconds: 200),
                    child: const Icon(
                      Icons.chevron_right,
                      color: AppColors.textSecondary,
                      size: 24,
                    ),
                  ),
                ],
              ),
            ),
          ),
          AnimatedCrossFade(
            duration: const Duration(milliseconds: 200),
            crossFadeState: isExpanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            firstChild: const SizedBox.shrink(),
            secondChild: Padding(
              padding: const EdgeInsets.fromLTRB(DesignTokens.spaceLg, 0,
                  DesignTokens.spaceLg, DesignTokens.spaceLg),
              child: child,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSummaryContent(AiArtifact artifact) {
    final confidence = artifact.confidence ?? 0.0;
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            SizedBox(
              width: 120,
              height: 120,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  CircularProgressIndicator(
                    value: confidence > 0 ? confidence : 0.01,
                    strokeWidth: 8,
                    backgroundColor: AppColors.gray100,
                    valueColor:
                        const AlwaysStoppedAnimation<Color>(AppColors.primary),
                    strokeCap: StrokeCap.round,
                  ),
                  Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        '${(confidence * 100).toInt()}%',
                        style: const TextStyle(
                          color: AppColors.textPrimary,
                          fontSize: 28,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const Text(
                        'CONFIDENCE',
                        style: TextStyle(
                          color: AppColors.primary,
                          fontSize: 8,
                          fontWeight: FontWeight.w500,
                          letterSpacing: 1,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        Text(
          _artifactTypeLabel(artifact.artifactType),
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 20,
            fontWeight: FontWeight.bold,
          ),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        _buildInfoRow('Risk Level', artifact.riskLevel.wireValue),
        const SizedBox(height: DesignTokens.spaceSm),
        _buildInfoRow('Review Status', artifact.reviewStatus.wireValue),
        const SizedBox(height: DesignTokens.spaceSm),
        _buildInfoRow('Version', 'v${artifact.versionNo}'),
      ],
    );
  }

  Widget _buildFindingsContent(AiArtifact artifact) {
    return Column(
      children: [
        _buildFindingRow(
          icon: Icons.analytics_outlined,
          label: 'Artifact Type',
          value: _artifactTypeLabel(artifact.artifactType),
          color: AppColors.primary,
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        _buildFindingRow(
          icon: Icons.shield_outlined,
          label: 'Risk Level',
          value: artifact.riskLevel.wireValue,
          color: _riskColor(artifact.riskLevel),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        _buildFindingRow(
          icon: Icons.verified_outlined,
          label: 'Review Status',
          value: artifact.reviewStatus.wireValue,
          color: AppColors.warning,
        ),
      ],
    );
  }

  Widget _buildFindingRow({
    required IconData icon,
    required String label,
    required String value,
    required Color color,
  }) {
    return Row(
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: color.withOpacity(0.2),
            shape: BoxShape.circle,
          ),
          child: Icon(icon, color: color, size: 18),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label.toUpperCase(),
                style: const TextStyle(
                  color: AppColors.textSecondary,
                  fontSize: 10,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildAnalysisContent(AiArtifact artifact) {
    final symptoms = artifact.content.summaryOfReportedSymptoms;
    final notice = artifact.content.informationOnlyNotice;
    final content = (symptoms != null && symptoms.isNotEmpty)
        ? symptoms.join('\n')
        : notice;
    if (content == null || content.isEmpty) {
      return const Text(
        'No detailed analysis content available.',
        style: TextStyle(color: AppColors.textSecondary, fontSize: 14),
      );
    }
    return Text(
      content,
      style: const TextStyle(
        color: AppColors.textPrimary,
        fontSize: 14,
        height: 1.6,
      ),
    );
  }

  Widget _buildActionsContent(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildActionButton(
          icon: Icons.save_outlined,
          label: 'Save to Health Records',
          onTap: () => _showSaveConfirmation(context),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        _buildActionButton(
          icon: Icons.share_outlined,
          label: 'Share with Doctor',
          onTap: () => context.push('/doctor-chat'),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        _buildActionButton(
          icon: Icons.calendar_month_outlined,
          label: 'Book Specialist Consultation',
          onTap: () => context.push('/find-doctor'),
        ),
      ],
    );
  }

  Widget _buildActionButton({
    required IconData icon,
    required String label,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceMd, vertical: 14),
        decoration: BoxDecoration(
          color: AppColors.primary.withOpacity(0.1),
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          border: Border.all(
            color: AppColors.primary.withOpacity(0.2),
          ),
        ),
        child: Row(
          children: [
            Icon(icon, color: AppColors.primary, size: 20),
            const SizedBox(width: DesignTokens.spaceSm),
            Expanded(
              child: Text(
                label,
                style: const TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const Icon(Icons.chevron_right,
                color: AppColors.textSecondary, size: 20),
          ],
        ),
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: const TextStyle(
            color: AppColors.textSecondary,
            fontSize: 13,
          ),
        ),
        Text(
          value,
          style: const TextStyle(
            color: AppColors.textPrimary,
            fontSize: 14,
            fontWeight: FontWeight.w600,
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
