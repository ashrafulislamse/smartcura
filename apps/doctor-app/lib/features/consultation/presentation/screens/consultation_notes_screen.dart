import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/models/contract_decoders.dart';
import '../../../../core/providers/consultation_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/loading_overlay.dart';
import '../../../../core/widgets/premium_card.dart';
import '../../../../core/widgets/status_badge.dart';

/// Consultation Notes Screen — clinical note authoring and signing.
///
/// Wired to real backend data:
/// - The consultation id arrives as the route `extra` (a String).
/// - [consultationDetailProvider] resolves the consultation (patient id).
/// - [doctorPatientDetailProvider] resolves the patient's display name.
/// - [consultationNotesProvider] reads existing notes
///   (`GET /consultations/{id}/notes`).
/// - [createNoteProvider] creates a draft (`POST /consultations/{id}/notes`).
/// - Inline `PUT /clinical-notes/{id}` updates a draft's content.
/// - [signNoteProvider] signs a note (`PUT /clinical-notes/{id}/status`),
///   which may require step-up auth (`POST /sessions/step-up` with reason
///   `prescription_sign`).
///
/// All four resource states are rendered distinctly. Patient name, id and date
/// come from the appointment/consultation chain — never hardcoded.
class ConsultationNotesScreen extends ConsumerStatefulWidget {
  const ConsultationNotesScreen({super.key});

  @override
  ConsumerState<ConsultationNotesScreen> createState() =>
      _ConsultationNotesScreenState();
}

class _ConsultationNotesScreenState
    extends ConsumerState<ConsultationNotesScreen> {
  final TextEditingController _chiefComplaintController =
      TextEditingController();
  final TextEditingController _symptomsController = TextEditingController();
  final TextEditingController _diagnosisController = TextEditingController();
  final TextEditingController _treatmentController = TextEditingController();

  String? _consultationId;
  bool _saving = false;
  bool _signing = false;
  ClinicalNote? _activeDraft;
  bool _formPopulated = false;
  bool _didExtractExtra = false;

  @override
  void initState() {
    super.initState();
  }

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_didExtractExtra) return;
    _didExtractExtra = true;
    final extra = GoRouterState.of(context).extra;
    if (extra is String) {
      _consultationId = extra;
    } else if (extra is Map<String, dynamic>) {
      _consultationId = extra['consultationId'] as String?;
    }
  }

  @override
  void dispose() {
    _chiefComplaintController.dispose();
    _symptomsController.dispose();
    _diagnosisController.dispose();
    _treatmentController.dispose();
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // Helpers

  DateTime? _parseTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso);
  }

  String _formatDate(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '--';
    return DateFormat('MMM d, yyyy • HH:mm').format(dt);
  }

  String _shortId(String id) =>
      id.length <= 8 ? id : id.substring(id.length - 8).toUpperCase();

  StatusBadgeTone _noteStatusTone(ClinicalNoteStatus status) =>
      switch (status) {
        ClinicalNoteStatus.draft => StatusBadgeTone.warning,
        ClinicalNoteStatus.signed => StatusBadgeTone.success,
        ClinicalNoteStatus.superseded => StatusBadgeTone.neutral,
        ClinicalNoteStatus.discarded => StatusBadgeTone.error,
        ClinicalNoteStatus.unknown => StatusBadgeTone.neutral,
      };

  String _noteStatusLabel(ClinicalNoteStatus status) => switch (status) {
        ClinicalNoteStatus.draft => 'Draft',
        ClinicalNoteStatus.signed => 'Signed',
        ClinicalNoteStatus.superseded => 'Superseded',
        ClinicalNoteStatus.discarded => 'Discarded',
        ClinicalNoteStatus.unknown => 'Unknown',
      };

  /// Build the structured note content map from the form fields.
  Map<String, Object?> _buildContent() {
    return <String, Object?>{
      'chief_complaint': _chiefComplaintController.text.trim(),
      'symptoms': _symptomsController.text.trim(),
      'diagnosis': _diagnosisController.text.trim(),
      'treatment_plan': _treatmentController.text.trim(),
    };
  }

  /// Populate the form from an existing draft note's content.
  void _populateFromNote(ClinicalNote note) {
    if (_formPopulated) return;
    final content = note.content;
    _chiefComplaintController.text =
        (content['chief_complaint'] as String?) ?? '';
    _symptomsController.text = (content['symptoms'] as String?) ?? '';
    _diagnosisController.text = (content['diagnosis'] as String?) ?? '';
    _treatmentController.text = (content['treatment_plan'] as String?) ?? '';
    _formPopulated = true;
  }

  // --------------------------------------------------------------------------
  // Actions

  /// Perform step-up auth if the backend requires it for signing.
  /// Returns true on success or when not required.
  Future<bool> _ensureStepUp() async {
    final api = ref.read(apiClientProvider);
    try {
      await api.post(
        ApiEndpoints.sessionsStepUp,
        body: <String, dynamic>{
          'reason': 'prescription_sign',
        },
      );
      return true;
    } on ApiError catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.displayMessage)),
        );
      }
      return false;
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Step-up authentication failed: $e')),
        );
      }
      return false;
    }
  }

  Future<void> _saveDraft() async {
    final consultationId = _consultationId;
    if (consultationId == null) return;
    setState(() => _saving = true);
    try {
      final content = _buildContent();
      if (_activeDraft != null) {
        // Update existing draft via PUT /clinical-notes/{id}.
        final api = ref.read(apiClientProvider);
        final body = await api.put(
          ApiEndpoints.clinicalNote(_activeDraft!.noteId),
          body: <String, dynamic>{
            'content': content,
            'expected_version': _activeDraft!.version,
          },
        );
        final updated = decodeClinicalNote(body);
        setState(() => _activeDraft = updated);
      } else {
        // Create new draft via POST /consultations/{id}/notes.
        final notifier = ref.read(createNoteProvider.notifier);
        final ok = await notifier.call(
          consultationId: consultationId,
          content: content,
        );
        if (ok) {
          final created = ref.read(createNoteProvider).value;
          setState(() => _activeDraft = created);
        } else {
          final err = ref.read(createNoteProvider).error;
          _showError(err is ApiError
              ? err.displayMessage
              : 'Could not save the note. Please try again.');
          return;
        }
      }
      // Refresh the notes list.
      ref.invalidate(consultationNotesProvider(consultationId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Draft saved.'), duration: Duration(seconds: 2)),
        );
      }
    } on ApiError catch (e) {
      _showError(e.displayMessage);
    } catch (e) {
      _showError('Could not save the note: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _signNote() async {
    final draft = _activeDraft;
    if (draft == null) {
      // Save first, then sign.
      await _saveDraft();
      final saved = _activeDraft;
      if (saved == null) return;
      return _signSavedNote(saved);
    }
    return _signSavedNote(draft);
  }

  Future<void> _signSavedNote(ClinicalNote draft) async {
    setState(() => _signing = true);
    try {
      // Attempt to sign. If the backend requires step-up, it returns 403
      // with code step_up_required; we then perform step-up and retry.
      final notifier = ref.read(signNoteProvider.notifier);
      var ok = await notifier.call(
        noteId: draft.noteId,
        status: 'signed',
        expectedVersion: draft.version,
      );

      if (!ok) {
        final err = ref.read(signNoteProvider).error;
        if (err is ApiError && err.isStepUpRequired) {
          // Step-up auth required — perform it and retry.
          final steppedUp = await _ensureStepUp();
          if (!steppedUp) return;
          ref.read(signNoteProvider.notifier).reset();
          ok = await notifier.call(
            noteId: draft.noteId,
            status: 'signed',
            expectedVersion: draft.version,
          );
        }
      }

      if (ok) {
        final consultationId = _consultationId;
        if (consultationId != null) {
          ref.invalidate(consultationNotesProvider(consultationId));
        }
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Note signed successfully.'),
              duration: Duration(seconds: 2),
            ),
          );
          Navigator.of(context).maybePop();
        }
      } else {
        final err = ref.read(signNoteProvider).error;
        _showError(err is ApiError
            ? err.displayMessage
            : 'Could not sign the note. Please try again.');
        ref.read(signNoteProvider.notifier).reset();
      }
    } catch (e) {
      _showError('Could not sign the note: $e');
    } finally {
      if (mounted) setState(() => _signing = false);
    }
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }

  // --------------------------------------------------------------------------
  // Build

  @override
  Widget build(BuildContext context) {
    final consultationId = _consultationId;

    if (consultationId == null || consultationId.isEmpty) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: _buildAppBar(),
        body: const ErrorView(
          message: 'No consultation was selected.',
          isForbidden: true,
        ),
      );
    }

    final consultationAsync =
        ref.watch(consultationDetailProvider(consultationId));
    final notesAsync = ref.watch(consultationNotesProvider(consultationId));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: _buildAppBar(),
      body: consultationAsync.when(
        data: (consultation) {
          final patientName = _resolvePatientName(consultation);
          return notesAsync.when(
            data: (noteList) {
              // Find the active draft (the latest draft note) and populate
              // the form from it.
              final drafts = noteList.data
                  .where((n) => n.status == ClinicalNoteStatus.draft)
                  .toList();
              if (drafts.isNotEmpty && _activeDraft == null) {
                _activeDraft = drafts.first;
                _populateFromNote(drafts.first);
              }
              return _buildBody(
                patientName: patientName,
                consultation: consultation,
                notes: noteList.data,
              );
            },
            loading: () => const LoadingOverlay(label: 'Loading notes...'),
            error: (err, _) {
              final apiError = err is ApiError ? err : toApiError(err);
              return ErrorView(
                message: apiError.displayMessage,
                isForbidden: apiError.isForbidden,
                onRetry: () =>
                    ref.invalidate(consultationNotesProvider(consultationId)),
              );
            },
          );
        },
        loading: () => const LoadingOverlay(label: 'Loading consultation...'),
        error: (err, _) {
          final apiError = err is ApiError ? err : toApiError(err);
          return ErrorView(
            message: apiError.displayMessage,
            isForbidden: apiError.isForbidden,
            onRetry: () =>
                ref.invalidate(consultationDetailProvider(consultationId)),
          );
        },
      ),
    );
  }

  String _resolvePatientName(Consultation? consultation) {
    if (consultation == null) return 'Patient';
    final patient = ref
        .read(doctorPatientDetailProvider(consultation.patientProfileId))
        .valueOrNull;
    return patient?.displayName ?? 'Patient';
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: AppColors.surface,
      elevation: 0,
      systemOverlayStyle: SystemUiOverlayStyle.dark,
      leading: IconButton(
        icon: const Icon(Icons.close, color: AppColors.gray900),
        onPressed: () => Navigator.of(context).maybePop(),
      ),
      title: Text(
        'Consultation Notes',
        style: Theme.of(context).textTheme.titleMedium?.copyWith(
              fontWeight: FontWeight.bold,
              color: AppColors.gray900,
            ),
      ),
      actions: [
        IconButton(
          icon: _saving
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: AppColors.primary),
                )
              : const Icon(Icons.save, color: AppColors.primary),
          onPressed: _saving ? null : _saveDraft,
        ),
      ],
    );
  }

  Widget _buildBody({
    required String patientName,
    Consultation? consultation,
    required List<ClinicalNote> notes,
  }) {
    return ListView(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      children: [
        _buildPatientContext(patientName, consultation),
        const SizedBox(height: DesignTokens.spaceLg),
        // Existing notes list.
        if (notes.isNotEmpty) ...[
          Text(
            'Existing Notes',
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppColors.gray900,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          ...notes.map((n) => _buildNoteSummaryCard(n)),
          const SizedBox(height: DesignTokens.spaceLg),
          Text(
            'Edit Draft',
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppColors.gray900,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
        ],
        // Note form.
        PremiumCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              _buildTextField(
                label: 'Chief Complaint',
                controller: _chiefComplaintController,
                placeholder: 'e.g., Severe migraine with aura...',
                minLines: 3,
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              _buildTextField(
                label: 'Symptoms',
                controller: _symptomsController,
                placeholder: 'List observed symptoms...',
                minLines: 3,
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              _buildTextField(
                label: 'Diagnosis',
                controller: _diagnosisController,
                placeholder: 'Preliminary diagnosis...',
                minLines: 3,
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              _buildTextField(
                label: 'Treatment Plan',
                controller: _treatmentController,
                placeholder: 'Prescriptions, follow-up, referrals...',
                minLines: 4,
              ),
            ],
          ),
        ),
        const SizedBox(height: DesignTokens.spaceLg),
        // Save button.
        FilledButton.icon(
          onPressed: _saving ? null : _saveDraft,
          icon: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: AppColors.white),
                )
              : const Icon(Icons.check, size: 20),
          label: const Text(
            'Save Draft',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: AppColors.white,
            minimumSize: const Size.fromHeight(DesignTokens.buttonHeightLg),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        // Sign button.
        FilledButton.icon(
          onPressed: _signing ? null : _signNote,
          icon: _signing
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                      strokeWidth: 2, color: AppColors.white),
                )
              : const Icon(Icons.draw_rounded, size: 20),
          label: const Text(
            'Sign & Lock Note',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primaryDark,
            foregroundColor: AppColors.white,
            minimumSize: const Size.fromHeight(DesignTokens.buttonHeightLg),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        TextButton(
          onPressed: () => Navigator.of(context).maybePop(),
          child: const Text(
            'Discard Changes',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w500,
              color: AppColors.error,
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.space2xl),
      ],
    );
  }

  Widget _buildPatientContext(String name, Consultation? consultation) {
    return PremiumCard(
      child: Row(
        children: [
          Container(
            width: DesignTokens.avatarXl,
            height: DesignTokens.avatarXl,
            decoration: const BoxDecoration(
              gradient: AppColors.primaryGradient,
              shape: BoxShape.circle,
            ),
            alignment: Alignment.center,
            child: Text(
              _initials(name),
              style: const TextStyle(
                color: AppColors.white,
                fontSize: 22,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppColors.gray900,
                      ),
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Icon(Icons.calendar_today_rounded,
                        size: 14, color: AppColors.gray500),
                    const SizedBox(width: 6),
                    Text(
                      _formatDate(consultation?.createdAt),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppColors.gray500,
                          ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Row(
                  children: [
                    Icon(Icons.badge_outlined,
                        size: 14, color: AppColors.gray500),
                    const SizedBox(width: 6),
                    Text(
                      consultation != null
                          ? 'ID: ${_shortId(consultation.patientProfileId)}'
                          : 'ID: --',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppColors.gray500,
                          ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNoteSummaryCard(ClinicalNote note) {
    final content = note.content;
    final complaint = (content['chief_complaint'] as String?) ?? '';
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      child: PremiumCard(
        accent: _noteStatusTone(note.status) == StatusBadgeTone.error
            ? AppColors.error
            : _noteStatusTone(note.status) == StatusBadgeTone.success
                ? AppColors.success
                : _noteStatusTone(note.status) == StatusBadgeTone.warning
                    ? AppColors.warning
                    : AppColors.gray300,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                StatusBadge(
                  label: _noteStatusLabel(note.status),
                  tone: _noteStatusTone(note.status),
                  showDot: true,
                ),
                const Spacer(),
                Text(
                  _formatDate(note.updatedAt),
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: AppColors.gray500,
                      ),
                ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceXs),
            Text(
              complaint.isNotEmpty ? complaint : 'No chief complaint recorded',
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                    color: AppColors.gray700,
                  ),
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
            ),
            if (note.status == ClinicalNoteStatus.signed &&
                note.signedAt != null) ...[
              const SizedBox(height: DesignTokens.spaceXs),
              Text(
                'Signed: ${_formatDate(note.signedAt)}',
                style: Theme.of(context).textTheme.labelSmall?.copyWith(
                      color: AppColors.successDark,
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  String _initials(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts[1].substring(0, 1))
        .toUpperCase();
  }

  Widget _buildTextField({
    required String label,
    required TextEditingController controller,
    required String placeholder,
    required int minLines,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.labelLarge?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray900,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surfaceVariant,
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          ),
          child: TextField(
            controller: controller,
            maxLines: null,
            minLines: minLines,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              hintText: placeholder,
              hintStyle: const TextStyle(color: AppColors.gray400),
              border: InputBorder.none,
              contentPadding: const EdgeInsets.all(DesignTokens.spaceMd),
            ),
            style: const TextStyle(
              fontSize: 16,
              color: AppColors.gray900,
            ),
          ),
        ),
      ],
    );
  }
}
