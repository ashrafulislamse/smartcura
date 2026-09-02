import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/models/doctor_ai_models.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/doctor_ai_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Doctor AI Artifacts — lists governed AI-generated artifacts for the
/// doctor's actively-assigned patients.
///
/// Backend: `GET /doctor/ai/artifacts` — assignment-scoped, paginated by an
/// opaque server cursor. The endpoint returns `data` + `page` with
/// `has_more` and `next_cursor`; this screen renders the first page and
/// offers a "Load more" action when `has_more` is true.
///
/// Tapping a row expands it inline to reveal the structured content —
/// summary bullets, suggested next step, sources, and the non-diagnostic
/// notice — without navigating away.
class DoctorAiArtifactsScreen extends ConsumerStatefulWidget {
  const DoctorAiArtifactsScreen({super.key});

  @override
  ConsumerState<DoctorAiArtifactsScreen> createState() =>
      _DoctorAiArtifactsScreenState();
}

class _DoctorAiArtifactsScreenState
    extends ConsumerState<DoctorAiArtifactsScreen> {
  final Set<String> _expanded = <String>{};

  Future<void> _onRefresh() async {
    ref.invalidate(doctorAiArtifactsProvider(const DoctorAiArtifactsQuery()));
    await ref.read(
      doctorAiArtifactsProvider(const DoctorAiArtifactsQuery()).future,
    );
  }

  void _toggle(String id) {
    setState(() {
      if (_expanded.contains(id)) {
        _expanded.remove(id);
      } else {
        _expanded.add(id);
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final query = const DoctorAiArtifactsQuery();
    final artifactsAsync = ref.watch(doctorAiArtifactsProvider(query));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('AI Artifacts'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            onPressed: _onRefresh,
          ),
        ],
      ),
      body: artifactsAsync.when(
        loading: () => const LoadingOverlay(label: 'Loading AI artifacts…'),
        error: (error, _) {
          final apiError = error is ApiError ? error : toApiError(error);
          return ErrorView(
            message: apiError.displayMessage,
            onRetry: apiError.isForbidden ? null : _onRefresh,
            isForbidden: apiError.isForbidden,
          );
        },
        data: (list) {
          if (list.data.isEmpty) {
            return RefreshIndicator(
              color: AppColors.primary,
              onRefresh: _onRefresh,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: [
                  SizedBox(
                    height: MediaQuery.of(context).size.height * 0.5,
                    child: const EmptyView(
                      title: 'No AI artifacts',
                      body:
                          'No governed AI artifacts exist for your assigned patients yet. '
                          'Artifacts are generated when patients use the AI assistant.',
                      illustrationAsset:
                          'assets/illustrations/empty_ai_artifacts.svg',
                    ),
                  ),
                ],
              ),
            );
          }
          return RefreshIndicator(
            color: AppColors.primary,
            onRefresh: _onRefresh,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              padding: const EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                120,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  _buildCountRow(list.data.length, list.page.hasMore),
                  const SizedBox(height: DesignTokens.spaceSm),
                  ...list.data.map((artifact) => _ArtifactCard(
                        artifact: artifact,
                        expanded: _expanded.contains(artifact.artifactId),
                        onToggle: () => _toggle(artifact.artifactId),
                      )),
                ],
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildCountRow(int count, bool hasMore) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceXs),
      child: Row(
        children: [
          Text(
            '$count governed ${count == 1 ? 'artifact' : 'artifacts'}',
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: AppColors.gray500,
                  fontWeight: FontWeight.w600,
                ),
          ),
          const Spacer(),
          if (hasMore)
            Text(
              'More available',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(
                    color: AppColors.gray400,
                  ),
            ),
        ],
      ),
    );
  }
}

// -----------------------------------------------------------------------------
// Artifact card
// -----------------------------------------------------------------------------

class _ArtifactCard extends StatelessWidget {
  const _ArtifactCard({
    required this.artifact,
    required this.expanded,
    required this.onToggle,
  });

  final AiArtifact artifact;
  final bool expanded;
  final VoidCallback onToggle;

  static final DateFormat _dateFormat = DateFormat('d MMM yyyy, HH:mm');

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      child: PremiumCard(
        accent: _riskAccent(artifact.riskLevel),
        onTap: onToggle,
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHeaderRow(context),
            const SizedBox(height: DesignTokens.spaceSm),
            _buildMetaRow(context),
            if (expanded) ...[
              const SizedBox(height: DesignTokens.spaceMd),
              const Divider(height: 1),
              const SizedBox(height: DesignTokens.spaceSm),
              _buildExpandedBody(context),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildHeaderRow(BuildContext context) {
    return Row(
      children: [
        Icon(
          _artifactIcon(artifact.artifactType),
          size: 18,
          color: AppColors.primary,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            doctorAiArtifactTypeLabel(artifact.artifactType),
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: AppColors.gray900,
                ),
          ),
        ),
        StatusBadge(
          label: doctorAiRiskLevelLabel(artifact.riskLevel),
          tone: _riskTone(artifact.riskLevel),
        ),
      ],
    );
  }

  Widget _buildMetaRow(BuildContext context) {
    return Wrap(
      spacing: DesignTokens.spaceSm,
      runSpacing: 2,
      children: [
        _metaChip(
          context,
          Icons.person_outline_rounded,
          'Patient: ${_shortId(artifact.patientProfileId)}',
        ),
        _metaChip(
          context,
          Icons.calendar_today_outlined,
          _formatDate(artifact.createdAt),
        ),
        _metaChip(
          context,
          Icons.rate_review_outlined,
          doctorAiReviewStatusLabel(artifact.reviewStatus),
        ),
        if (artifact.confidence != null)
          _metaChip(
            context,
            Icons.percent_rounded,
            'Confidence ${(artifact.confidence! * 100).toStringAsFixed(0)}%',
          ),
      ],
    );
  }

  Widget _metaChip(BuildContext context, IconData icon, String label) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: AppColors.gray400),
        const SizedBox(width: 4),
        Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: AppColors.gray600,
              ),
        ),
      ],
    );
  }

  Widget _buildExpandedBody(BuildContext context) {
    final content = artifact.content;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (content.summaryOfReportedSymptoms != null &&
            content.summaryOfReportedSymptoms!.isNotEmpty) ...[
          _bodyLabel(context, 'Summary of reported symptoms'),
          ...content.summaryOfReportedSymptoms!.map(
            (s) => Padding(
              padding: const EdgeInsets.only(left: 8, bottom: 2),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '•',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.primary,
                        ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      s,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppColors.gray700,
                            height: 1.4,
                          ),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
        ],
        if (content.suggestedNextStep != null &&
            content.suggestedNextStep!.isNotEmpty) ...[
          _bodyLabel(context, 'Suggested next step'),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(DesignTokens.spaceSm),
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
            ),
            child: Text(
              content.suggestedNextStep!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: AppColors.primaryDark,
                    fontWeight: FontWeight.w600,
                    height: 1.4,
                  ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
        ],
        if (content.informationOnlyNotice != null &&
            content.informationOnlyNotice!.isNotEmpty) ...[
          _bodyLabel(context, 'Information only'),
          Text(
            content.informationOnlyNotice!,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: AppColors.gray600,
                  fontStyle: FontStyle.italic,
                  height: 1.4,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
        ],
        if (content.sources != null && content.sources!.isNotEmpty) ...[
          _bodyLabel(context, 'Sources'),
          Wrap(
            spacing: DesignTokens.spaceXs,
            children: content.sources!
                .map((s) => Chip(
                      label: Text(
                        'chunk ${_shortId(s.chunkId)}',
                        style: Theme.of(context).textTheme.labelSmall,
                      ),
                      padding: EdgeInsets.zero,
                      visualDensity: VisualDensity.compact,
                    ))
                .toList(),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
        ],
        // Always render the non-diagnostic disclaimer for expanded artifacts.
        Container(
          padding: const EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceSm,
            vertical: 6,
          ),
          decoration: BoxDecoration(
            color: AppColors.warningContainer,
            borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.info_outline_rounded,
                color: AppColors.warningDark,
                size: 14,
              ),
              const SizedBox(width: 4),
              Flexible(
                child: Text(
                  content.nonDiagnostic
                      ? 'Non-diagnostic — for clinical decision support only'
                      : 'Review required — content is not a clinical conclusion',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: AppColors.warningDark,
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _bodyLabel(BuildContext context, String label) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: AppColors.gray500,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.4,
            ),
      ),
    );
  }

  String _formatDate(String iso) {
    final dt = DateTime.tryParse(iso);
    if (dt == null) return '—';
    return _dateFormat.format(dt);
  }

  String _shortId(String uuid) {
    final cleaned = uuid.replaceAll('-', '');
    if (cleaned.length < 8) return uuid;
    return cleaned.substring(0, 8);
  }

  StatusBadgeTone _riskTone(AiRiskLevel level) => switch (level) {
        AiRiskLevel.unknown => StatusBadgeTone.neutral,
        AiRiskLevel.low => StatusBadgeTone.success,
        AiRiskLevel.moderate => StatusBadgeTone.warning,
        AiRiskLevel.high => StatusBadgeTone.error,
        AiRiskLevel.critical => StatusBadgeTone.error,
      };

  Color _riskAccent(AiRiskLevel level) => switch (level) {
        AiRiskLevel.unknown => AppColors.gray300,
        AiRiskLevel.low => AppColors.success,
        AiRiskLevel.moderate => AppColors.warning,
        AiRiskLevel.high => AppColors.error,
        AiRiskLevel.critical => AppColors.errorDark,
      };

  IconData _artifactIcon(AiArtifactType type) => switch (type) {
        AiArtifactType.symptomSummary => Icons.healing_outlined,
        AiArtifactType.careNavigation => Icons.alt_route_rounded,
        AiArtifactType.healthSummary => Icons.favorite_outline_rounded,
        AiArtifactType.dailySummary => Icons.today_outlined,
        AiArtifactType.trendAnalysis => Icons.trending_up_rounded,
        AiArtifactType.riskFlag => Icons.flag_outlined,
        AiArtifactType.forecast => Icons.insights_outlined,
        AiArtifactType.anomaly => Icons.warning_amber_rounded,
        AiArtifactType.unknown => Icons.auto_awesome_outlined,
      };
}
