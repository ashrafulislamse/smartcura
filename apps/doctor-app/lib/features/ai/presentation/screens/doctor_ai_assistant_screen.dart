import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/models/doctor_ai_models.dart';
import '../../../../core/models/doctor_patient_page.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/doctor_ai_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Doctor AI Clinical Assistant — synchronous decision-support call.
///
/// Backend flow:
/// 1. The doctor picks an assigned patient (optional) and types a clinical
///    question, then taps Ask.
/// 2. `POST /doctor/ai/assistant` with an `Idempotency-Key` (auto-attached
///    by `ApiClient`'s interceptor) and a JSON body carrying `prompt` and
///    `patient_profile_id` if a patient was selected.
/// 3. The backend either returns 200 with the response, 501 if the
///    deployment has no AI provider configured, 403 if the doctor is not
///    assigned to the chosen patient, or another 4xx/5xx error.
///
/// The response is **non-diagnostic by contract** — the disclaimer is shown
/// alongside every response so the doctor is never led to confuse a decision
/// support answer with a clinical conclusion.
class DoctorAiAssistantScreen extends ConsumerStatefulWidget {
  const DoctorAiAssistantScreen({super.key});

  @override
  ConsumerState<DoctorAiAssistantScreen> createState() =>
      _DoctorAiAssistantScreenState();
}

class _DoctorAiAssistantScreenState
    extends ConsumerState<DoctorAiAssistantScreen> {
  static const int _promptMaxChars = 8000;

  final TextEditingController _promptController = TextEditingController();

  String? _selectedPatientId;

  @override
  void initState() {
    super.initState();
    _promptController.addListener(() => setState(() {}));
    // Prime the patient list once. Subsequent navigations reuse the cached
    // page so the user does not see a spinner on every push.
    Future<void>.microtask(() => ref.read(doctorPatientsProvider(null)));
  }

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  Future<void> _onAsk() async {
    final text = _promptController.text.trim();
    if (text.isEmpty) return;

    // Collapse the keyboard before the loading spinner takes over so the
    // scrim does not fight the focus ring.
    FocusScope.of(context).unfocus();

    final notifier = ref.read(doctorAiAssistantProvider.notifier);
    await notifier.call(DoctorAiAssistantParams(
      prompt: text,
      patientProfileId: _selectedPatientId,
    ));
  }

  void _openArtifacts() => context.push('/doctor-ai/artifacts');

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(doctorAiAssistantProvider);
    final patientsAsync = ref.watch(doctorPatientsProvider(null));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('AI Clinical Assistant'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            tooltip: 'View AI artifacts',
            icon: const Icon(Icons.auto_awesome_outlined),
            onPressed: _openArtifacts,
          ),
        ],
      ),
      body: SingleChildScrollView(
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
            _buildIntroCard(),
            const SizedBox(height: DesignTokens.spaceMd),
            _buildPatientPicker(patientsAsync),
            const SizedBox(height: DesignTokens.spaceMd),
            _buildPromptCard(state),
            const SizedBox(height: DesignTokens.spaceMd),
            if (state.notConfigured) _buildNotConfiguredCard(),
            if (state.providerUnavailable) _buildProviderUnavailableCard(),
            if (state.error != null &&
                !state.notConfigured &&
                !state.providerUnavailable)
              _buildErrorCard(state.error!),
            if (state.response != null) _buildResponseCard(state.response!),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------------

  Widget _buildIntroCard() {
    return PremiumCard(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(DesignTokens.spaceSm),
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: const Icon(
              Icons.psychology_outlined,
              color: AppColors.primaryDark,
              size: 28,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Synchronous clinical decision support',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.gray900,
                      ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Ask a clinical question and receive a governed AI response in the same request. '
                  'AI output is decision support, not a diagnosis — always apply your own clinical judgment.',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.gray600,
                        height: 1.4,
                      ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                _buildDisclaimerPill(),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDisclaimerPill() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceSm,
        vertical: 4,
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
          Text(
            'Non-diagnostic — for clinical decision support only',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: AppColors.warningDark,
                  fontWeight: FontWeight.w700,
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildPatientPicker(
      AsyncValue<DoctorAssignedPatientPage> patientsAsync) {
    return PremiumCard(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Patient (optional)',
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.gray800,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          patientsAsync.when(
            loading: () => const SizedBox(
              height: 56,
              child: Center(
                child: SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
              ),
            ),
            error: (error, _) {
              final apiError = error is ApiError ? error : toApiError(error);
              return _buildInlineErrorRow(
                'Could not load patient list',
                apiError.displayMessage,
              );
            },
            data: (page) {
              final patients = page.data;
              return DropdownButtonFormField<String?>(
                initialValue: _selectedPatientId,
                isExpanded: true,
                decoration: _inputDecoration(
                  'Select a patient to scope the question',
                ),
                items: <DropdownMenuItem<String?>>[
                  const DropdownMenuItem<String?>(
                    value: null,
                    child: Text('No specific patient'),
                  ),
                  ...patients.map((p) => DropdownMenuItem<String?>(
                        value: p.profileId,
                        child: Text(
                          p.displayName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      )),
                ],
                onChanged: (value) =>
                    setState(() => _selectedPatientId = value),
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildPromptCard(DoctorAiAssistantUiState state) {
    final canSubmit =
        !state.loading && _promptController.text.trim().isNotEmpty;
    return PremiumCard(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Clinical question',
            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.gray800,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          TextField(
            controller: _promptController,
            minLines: 5,
            maxLines: 10,
            maxLength: _promptMaxChars,
            textInputAction: TextInputAction.newline,
            decoration: _inputDecoration(
              'Describe the patient, the question, and any relevant context…',
            ).copyWith(counterText: ''),
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '${_promptController.text.length} / $_promptMaxChars characters',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: AppColors.gray500,
                    ),
              ),
              FilledButton.icon(
                onPressed: canSubmit ? _onAsk : null,
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  disabledBackgroundColor: AppColors.gray200,
                  foregroundColor: AppColors.white,
                  padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceMd,
                    vertical: DesignTokens.spaceSm,
                  ),
                ),
                icon: state.loading
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          valueColor: AlwaysStoppedAnimation<Color>(
                            AppColors.white,
                          ),
                        ),
                      )
                    : const Icon(Icons.send_rounded, size: 18),
                label: Text(state.loading ? 'Asking…' : 'Ask'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildNotConfiguredCard() {
    return _buildStateCard(
      icon: Icons.warning_amber_rounded,
      iconColor: AppColors.warningDark,
      background: AppColors.warningContainer,
      title: 'AI assistant not configured',
      body:
          'This deployment has no AI provider configured. Contact your administrator to enable the AI integration.',
    );
  }

  Widget _buildProviderUnavailableCard() {
    return _buildStateCard(
      icon: Icons.cloud_off_rounded,
      iconColor: AppColors.errorDark,
      background: AppColors.errorContainer,
      title: 'AI provider unavailable',
      body:
          'The configured provider is currently unreachable. Try again later.',
    );
  }

  Widget _buildErrorCard(ApiError error) {
    return _buildStateCard(
      icon: Icons.error_outline_rounded,
      iconColor: AppColors.errorDark,
      background: AppColors.errorContainer,
      title: 'Could not get a response',
      body: error.displayMessage,
      footer: error.correlationId == null
          ? null
          : 'Reference: ${error.correlationId}',
      // A forbidden retry cannot succeed — the patient (if any) is simply
      // not assigned to this doctor, and a retry will get the same answer.
      onRetry: error.isForbidden ? null : _onAsk,
    );
  }

  Widget _buildResponseCard(DoctorAiAssistantResponse response) {
    return PremiumCard(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                ),
                child: const Icon(
                  Icons.auto_awesome,
                  color: AppColors.primaryDark,
                  size: 18,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Text(
                'AI response',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w800,
                      color: AppColors.gray900,
                    ),
              ),
              const Spacer(),
              Text(
                '${response.provider} · ${response.model}',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: AppColors.gray500,
                    ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(DesignTokens.spaceMd),
            decoration: BoxDecoration(
              color: AppColors.gray50,
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              border: Border.all(color: AppColors.gray200),
            ),
            child: Text(
              response.response,
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.gray800,
                    height: 1.5,
                  ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Wrap(
            spacing: DesignTokens.spaceMd,
            runSpacing: 4,
            children: [
              _buildResponseStat(
                'Tokens in',
                response.promptTokens.toString(),
              ),
              _buildResponseStat(
                'Tokens out',
                response.completionTokens.toString(),
              ),
              _buildResponseStat(
                'Latency',
                '${response.latencyMs} ms',
              ),
              if (response.patientProfileId != null)
                _buildResponseStat(
                  'Patient',
                  _shortId(response.patientProfileId!),
                ),
              _buildResponseStat(
                'Correlation',
                _shortId(response.correlationId),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          const Divider(height: 1),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildDisclaimerPill(),
        ],
      ),
    );
  }

  Widget _buildResponseStat(String label, String value) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          '$label: ',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: AppColors.gray500,
                fontWeight: FontWeight.w600,
              ),
        ),
        Text(
          value,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: AppColors.gray700,
                fontWeight: FontWeight.w700,
              ),
        ),
      ],
    );
  }

  Widget _buildStateCard({
    required IconData icon,
    required Color iconColor,
    required Color background,
    required String title,
    required String body,
    String? footer,
    VoidCallback? onRetry,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      child: Container(
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: background,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: iconColor.withValues(alpha: 0.2)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(icon, color: iconColor, size: 22),
                const SizedBox(width: DesignTokens.spaceSm),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title,
                        style: Theme.of(context).textTheme.titleSmall?.copyWith(
                              fontWeight: FontWeight.w800,
                              color: AppColors.gray900,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        body,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: AppColors.gray700,
                              height: 1.4,
                            ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            if (footer != null) ...[
              const SizedBox(height: DesignTokens.spaceSm),
              Text(
                footer,
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: AppColors.gray500,
                    ),
              ),
            ],
            if (onRetry != null) ...[
              const SizedBox(height: DesignTokens.spaceSm),
              Align(
                alignment: Alignment.centerLeft,
                child: TextButton.icon(
                  onPressed: onRetry,
                  icon: const Icon(Icons.refresh_rounded, size: 16),
                  label: const Text('Retry'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _buildInlineErrorRow(String title, String detail) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceSm,
        vertical: DesignTokens.spaceSm,
      ),
      decoration: BoxDecoration(
        color: AppColors.errorContainer,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.error_outline_rounded,
            color: AppColors.errorDark,
            size: 18,
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        color: AppColors.errorDark,
                        fontWeight: FontWeight.w700,
                      ),
                ),
                Text(
                  detail,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.errorDark,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  InputDecoration _inputDecoration(String hint) => InputDecoration(
        hintText: hint,
        filled: true,
        fillColor: AppColors.gray50,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceMd,
          vertical: DesignTokens.spaceSm,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(color: AppColors.gray200),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(color: AppColors.gray200),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
        ),
      );

  String _shortId(String uuid) {
    // Render the first 8 hex chars so a long correlation id does not push
    // the metadata wrap out of view.
    final cleaned = uuid.replaceAll('-', '');
    if (cleaned.length < 8) return uuid;
    return cleaned.substring(0, 8);
  }
}
