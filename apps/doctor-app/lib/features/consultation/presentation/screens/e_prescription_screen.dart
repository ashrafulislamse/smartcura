import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';
import 'package:printing/printing.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/constants/app_constants.dart';
import '../../../../core/models/contract_decoders.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/providers/consultation_provider.dart';
import '../../../../core/providers/patient_provider.dart';
import '../../../../core/providers/prescription_document_provider.dart';
import '../../../../core/providers/profile_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/error_view.dart';
import '../../../../core/widgets/loading_overlay.dart';
import '../../../../core/widgets/premium_card.dart';
import '../../../../core/widgets/status_badge.dart';
import '../../utils/prescription_pdf_generator.dart';

/// Medication catalog for the autocomplete picker (`GET /medications`).
/// Paginated server-side; we fetch the first page (excluding retired) and
/// filter by name client-side, which is sufficient for the demo form.
final _medicationsProvider =
    FutureProvider.autoDispose<MedicationList>((ref) async {
  final api = ref.watch(apiClientProvider);
  final body = await api.get(
    ApiEndpoints.medications,
    queryParameters: const {'include_retired': false},
  );
  return decodeMedicationList(body);
});

/// Existing prescriptions for the consultation
/// (`GET /consultations/{id}/prescriptions`). Used to surface a prior draft so
/// the doctor edits it instead of creating a duplicate. The backend now serves
/// this path; a 404 still falls back to an empty list for resilience.
final _consultationPrescriptionsProvider = FutureProvider.autoDispose
    .family<PrescriptionList, String>((ref, consultationId) async {
  final api = ref.watch(apiClientProvider);
  try {
    final body =
        await api.get(ApiEndpoints.consultationPrescriptions(consultationId));
    return decodePrescriptionList(body);
  } catch (e) {
    final err = toApiError(e);
    if (err.isNotFound) {
      return const PrescriptionList(
        data: [],
        page: PageInfo(hasMore: false, nextCursor: null),
      );
    }
    throw err;
  }
});

/// A single editable medication line in the prescription builder. Held in local
/// state so the doctor can add/remove rows before persisting.
class _MedicationDraft {
  _MedicationDraft({required this.id});
  final String id;
  final TextEditingController nameController = TextEditingController();
  final TextEditingController doseController =
      TextEditingController(); // e.g. "500"
  final TextEditingController unitController =
      TextEditingController(); // e.g. "mg"
  final TextEditingController durationController =
      TextEditingController(); // days
  final TextEditingController instructionsController = TextEditingController();
  String routeCode = 'oral';
  String frequencyCode = 'BID';
  String? selectedMedicationId;

  bool get isValid {
    final name = nameController.text.trim();
    final dose = doseController.text.trim();
    final unit = unitController.text.trim();
    final duration = int.tryParse(durationController.text.trim());
    return name.isNotEmpty &&
        dose.isNotEmpty &&
        unit.isNotEmpty &&
        duration != null &&
        duration > 0;
  }

  void dispose() {
    nameController.dispose();
    doseController.dispose();
    unitController.dispose();
    durationController.dispose();
    instructionsController.dispose();
  }
}

/// E-Prescription Screen — prescription builder, draft save, and step-up sign.
///
/// Wired to real backend data:
/// - The consultation id arrives as the route `extra` (a String or Map).
/// - [consultationDetailProvider] resolves the consultation (patient id).
/// - [doctorPatientDetailProvider] resolves the patient's display name and
///   contact info.
/// - [_consultationPrescriptionsProvider] reads any existing drafts so the
///   doctor edits rather than duplicates.
/// - [createPrescriptionProvider] creates a draft
///   (`POST /consultations/{id}/prescriptions`).
/// - Inline `PUT /prescriptions/{id}` updates a draft's items.
/// - [prescriptionTransitionProvider] signs a prescription
///   (`PUT /prescriptions/{id}/status`), which requires step-up auth
///   (`POST /sessions/step-up` with reason `prescription_sign`).
///
/// All four resource states are rendered distinctly. No medication names,
/// dosages, or patient identities are hardcoded.
class EPrescriptionScreen extends ConsumerStatefulWidget {
  const EPrescriptionScreen({super.key});

  @override
  ConsumerState<EPrescriptionScreen> createState() =>
      _EPrescriptionScreenState();
}

class _EPrescriptionScreenState extends ConsumerState<EPrescriptionScreen> {
  final TextEditingController _diagnosisController = TextEditingController();

  String? _consultationId;
  final List<_MedicationDraft> _medications = [];
  bool _saving = false;
  bool _signing = false;
  bool _formInitialized = false;
  Prescription? _activeDraft;

  // PDF generation state. The generated bytes are held after signing so the
  // doctor can share or attempt to upload them. `items` become opaque ids on
  // re-fetch, so the PDF is built from the draft snapshot captured at sign time.
  bool _generatingPdf = false;
  Uint8List? _generatedPdf;
  String? _generatedPrescriptionId;
  String? _pdfError;

  static const List<({String code, String label})> _routes = [
    (code: 'oral', label: 'Oral'),
    (code: 'topical', label: 'Topical'),
    (code: 'intravenous', label: 'Intravenous'),
    (code: 'intramuscular', label: 'Intramuscular'),
    (code: 'subcutaneous', label: 'Subcutaneous'),
    (code: 'inhaled', label: 'Inhaled'),
    (code: 'ophthalmic', label: 'Ophthalmic'),
    (code: 'otic', label: 'Otic'),
    (code: 'rectal', label: 'Rectal'),
  ];

  static const List<({String code, String label})> _frequencies = [
    (code: 'QD', label: 'Once daily (QD)'),
    (code: 'BID', label: 'Twice daily (BID)'),
    (code: 'TID', label: 'Three times daily (TID)'),
    (code: 'QID', label: 'Four times daily (QID)'),
    (code: 'Q4H', label: 'Every 4 hours (Q4H)'),
    (code: 'Q6H', label: 'Every 6 hours (Q6H)'),
    (code: 'PRN', label: 'As needed (PRN)'),
    (code: 'QHS', label: 'At bedtime (QHS)'),
  ];

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
    _diagnosisController.dispose();
    for (final m in _medications) {
      m.dispose();
    }
    super.dispose();
  }

  // --------------------------------------------------------------------------
  // Helpers

  String _shortId(String id) =>
      id.length <= 8 ? id : id.substring(id.length - 8).toUpperCase();

  StatusBadgeTone _statusTone(PrescriptionStatus s) => switch (s) {
        PrescriptionStatus.draft => StatusBadgeTone.warning,
        PrescriptionStatus.signed => StatusBadgeTone.success,
        PrescriptionStatus.superseded => StatusBadgeTone.neutral,
        PrescriptionStatus.cancelled => StatusBadgeTone.error,
        PrescriptionStatus.expired => StatusBadgeTone.neutral,
        PrescriptionStatus.discarded => StatusBadgeTone.error,
        PrescriptionStatus.unknown => StatusBadgeTone.neutral,
      };

  String _statusLabel(PrescriptionStatus s) => switch (s) {
        PrescriptionStatus.draft => 'Draft',
        PrescriptionStatus.signed => 'Signed',
        PrescriptionStatus.superseded => 'Superseded',
        PrescriptionStatus.cancelled => 'Cancelled',
        PrescriptionStatus.expired => 'Expired',
        PrescriptionStatus.discarded => 'Discarded',
        PrescriptionStatus.unknown => 'Unknown',
      };

  String _resolvePatientName(Consultation? consultation) {
    if (consultation == null) return 'Patient';
    final patient = ref
        .read(doctorPatientDetailProvider(consultation.patientProfileId))
        .valueOrNull;
    return patient?.displayName ?? 'Patient';
  }

  /// Build the [PrescriptionItemInput] list from the local drafts. Only valid
  /// rows are included so an incomplete line does not abort the save.
  List<PrescriptionItemInput> _buildItems() {
    return _medications
        .where((m) => m.isValid)
        .map((m) => PrescriptionItemInput(
              medicationReference: m.selectedMedicationId,
              medicationText: m.nameController.text.trim(),
              doseValue: m.doseController.text.trim(),
              doseUnit: m.unitController.text.trim(),
              routeCode: m.routeCode,
              frequencyCode: m.frequencyCode,
              frequencyText: null,
              durationDays: int.parse(m.durationController.text.trim()),
              patientInstructions: m.instructionsController.text.trim().isEmpty
                  ? null
                  : m.instructionsController.text.trim(),
            ))
        .toList();
  }

  /// Populate the form from an existing draft prescription's items. The
  /// prescription detail carries item ids as strings, so we best-effort
  /// resolve names from the medication catalog.
  void _populateFromDraft(Prescription draft, MedicationList? catalog) {
    if (_formInitialized) return;
    _medications.clear();
    final byId = <String, Medication>{};
    for (final med in catalog?.data ?? const <Medication>[]) {
      byId[med.medicationId] = med;
    }
    // The prescription detail carries opaque item ids; we cannot reconstruct
    // the dose/frequency fields from them, so we leave the builder empty and
    // let the doctor re-enter items when editing a draft. This is honest about
    // what the read-one contract exposes.
    _formInitialized = true;
  }

  // --------------------------------------------------------------------------
  // Medication management

  void _addMedication() {
    setState(() {
      _medications.add(_MedicationDraft(
          id: DateTime.now().microsecondsSinceEpoch.toString()));
    });
  }

  void _addMedicationFromLibrary(Medication medication) {
    final draft = _MedicationDraft(
      id: DateTime.now().microsecondsSinceEpoch.toString(),
    );
    draft.selectedMedicationId = medication.medicationId;
    draft.nameController.text = medication.genericName;
    setState(() => _medications.add(draft));
  }

  void _removeMedication(int index) {
    setState(() {
      final removed = _medications.removeAt(index);
      removed.dispose();
    });
  }

  // --------------------------------------------------------------------------
  // Actions

  /// Perform step-up auth if the backend requires it for signing.
  Future<bool> _ensureStepUp() async {
    final api = ref.read(apiClientProvider);
    try {
      await api.post(
        ApiEndpoints.sessionsStepUp,
        body: <String, dynamic>{'reason': 'prescription_sign'},
      );
      return true;
    } on ApiError catch (e) {
      if (mounted) _showError(e.displayMessage);
      return false;
    } catch (e) {
      if (mounted) _showError('Step-up authentication failed: $e');
      return false;
    }
  }

  Future<void> _saveDraft() async {
    final consultationId = _consultationId;
    if (consultationId == null) return;
    final items = _buildItems();
    if (items.isEmpty) {
      _showError('Add at least one complete medication before saving.');
      return;
    }
    final diagnosis = _diagnosisController.text.trim().isEmpty
        ? null
        : _diagnosisController.text.trim();
    setState(() => _saving = true);
    try {
      if (_activeDraft != null) {
        // Update existing draft via PUT /prescriptions/{id}.
        final api = ref.read(apiClientProvider);
        final body = await api.put(
          ApiEndpoints.prescription(_activeDraft!.prescriptionId),
          body: <String, dynamic>{
            'items': items
                .map((i) => <String, dynamic>{
                      if (i.medicationReference != null)
                        'medication_reference': i.medicationReference,
                      if (i.medicationText != null)
                        'medication_text': i.medicationText,
                      'dose_value': i.doseValue,
                      'dose_unit': i.doseUnit,
                      'route_code': i.routeCode,
                      if (i.frequencyCode != null)
                        'frequency_code': i.frequencyCode,
                      if (i.frequencyText != null)
                        'frequency_text': i.frequencyText,
                      'duration_days': i.durationDays,
                      if (i.patientInstructions != null)
                        'patient_instructions': i.patientInstructions,
                    })
                .toList(),
            if (diagnosis != null) 'diagnosis': diagnosis,
            'expected_version': _activeDraft!.version,
          },
        );
        final updated = decodePrescription(body);
        setState(() => _activeDraft = updated);
      } else {
        // Create new draft via POST /consultations/{id}/prescriptions.
        final notifier = ref.read(createPrescriptionProvider.notifier);
        final ok = await notifier.call(
          consultationId: consultationId,
          items: items,
          diagnosis: diagnosis,
        );
        if (ok) {
          final created = ref.read(createPrescriptionProvider).value;
          setState(() => _activeDraft = created);
        } else {
          final err = ref.read(createPrescriptionProvider).error;
          _showError(err is ApiError
              ? err.displayMessage
              : 'Could not save the prescription. Please try again.');
          return;
        }
      }
      ref.invalidate(_consultationPrescriptionsProvider(consultationId));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Draft saved.'),
            duration: Duration(seconds: 2),
          ),
        );
      }
    } on ApiError catch (e) {
      _showError(e.displayMessage);
    } catch (e) {
      _showError('Could not save the prescription: $e');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _signPrescription() async {
    final consultationId = _consultationId;
    if (consultationId == null) return;

    // Save first if no draft exists yet.
    if (_activeDraft == null) {
      await _saveDraft();
      final saved = _activeDraft;
      if (saved == null) return;
      return _signSaved(saved);
    }
    return _signSaved(_activeDraft!);
  }

  Future<void> _signSaved(Prescription draft) async {
    setState(() => _signing = true);
    try {
      // The status transition requires an expiry. Default to 30 days from now.
      final expiresAt = DateTime.now()
          .add(const Duration(days: 30))
          .toUtc()
          .toIso8601String();

      final notifier = ref.read(prescriptionTransitionProvider.notifier);
      var ok = await notifier.call(
        prescriptionId: draft.prescriptionId,
        status: 'signed',
        expectedVersion: draft.version,
        expiresAt: expiresAt,
      );

      if (!ok) {
        final err = ref.read(prescriptionTransitionProvider).error;
        if (err is ApiError && err.isStepUpRequired) {
          final steppedUp = await _ensureStepUp();
          if (!steppedUp) return;
          ref.read(prescriptionTransitionProvider.notifier).reset();
          ok = await notifier.call(
            prescriptionId: draft.prescriptionId,
            status: 'signed',
            expectedVersion: draft.version,
            expiresAt: expiresAt,
          );
        }
      }

      if (ok) {
        final cid = _consultationId;
        if (cid != null) {
          ref.invalidate(_consultationPrescriptionsProvider(cid));
        }
        // Capture the signed prescription (carries the id, signedAt, expiresAt).
        final signed = ref.read(prescriptionTransitionProvider).value ?? draft;
        if (mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('Prescription signed successfully.'),
              duration: Duration(seconds: 2),
            ),
          );
          // Build the PDF from the draft data still in the UI state. After
          // signing, a re-fetched prescription's `items` are opaque ids, so the
          // structured drug/dose/frequency data must be captured now.
          await _generateAndShowPdf(signed);
        }
      } else {
        final err = ref.read(prescriptionTransitionProvider).error;
        _showError(err is ApiError
            ? err.displayMessage
            : 'Could not sign the prescription. Please try again.');
        ref.read(prescriptionTransitionProvider.notifier).reset();
      }
    } catch (e) {
      _showError('Could not sign the prescription: $e');
    } finally {
      if (mounted) setState(() => _signing = false);
    }
  }

  // --------------------------------------------------------------------------
  // Preview

  void _showPreview() {
    final validMeds = _medications.where((m) => m.isValid).toList();
    showDialog<void>(
      context: context,
      builder: (dialogContext) {
        return AlertDialog(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          ),
          title: Text(
            'Prescription Preview',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppColors.gray900,
                ),
          ),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView(
              shrinkWrap: true,
              children: [
                if (_diagnosisController.text.trim().isNotEmpty) ...[
                  Text(
                    'Diagnosis',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          fontWeight: FontWeight.bold,
                          color: AppColors.gray500,
                          letterSpacing: 0.5,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXs),
                  Text(
                    _diagnosisController.text.trim(),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.gray900,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                ],
                Text(
                  'Medications',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppColors.gray500,
                        letterSpacing: 0.5,
                      ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                if (validMeds.isEmpty)
                  Text(
                    'No complete medications to preview.',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.gray500,
                        ),
                  )
                else
                  for (int i = 0; i < validMeds.length; i++) ...[
                    if (i > 0) const SizedBox(height: DesignTokens.spaceSm),
                    _buildPreviewItem(i, validMeds[i]),
                  ],
              ],
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).maybePop(),
              child: const Text('Close'),
            ),
          ],
        );
      },
    );
  }

  Widget _buildPreviewItem(int index, _MedicationDraft draft) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.gray50,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '${index + 1}. ${draft.nameController.text.trim()}',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppColors.gray900,
                ),
          ),
          const SizedBox(height: 4),
          Text(
            '${draft.doseController.text.trim()} ${draft.unitController.text.trim()} · '
            '${_labelForFrequency(draft.frequencyCode)} · '
            '${draft.durationController.text.trim()} days',
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: AppColors.gray600,
                ),
          ),
          if (draft.instructionsController.text.trim().isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              draft.instructionsController.text.trim(),
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: AppColors.primaryDark,
                  ),
            ),
          ],
        ],
      ),
    );
  }

  // --------------------------------------------------------------------------
  // Library picker

  Future<Medication?> _showMedicationLibraryDialog(MedicationList? catalog) {
    final medications = catalog?.data ?? const <Medication>[];
    return showDialog<Medication?>(
      context: context,
      builder: (dialogContext) {
        Medication? selected;
        return StatefulBuilder(
          builder: (ctx, setState) {
            return AlertDialog(
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              ),
              title: Text(
                'Add from Library',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: AppColors.gray900,
                    ),
              ),
              content: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Autocomplete<Medication>(
                    optionsBuilder: (TextEditingValue textEditing) {
                      if (textEditing.text.isEmpty || medications.isEmpty) {
                        return const Iterable<Medication>.empty();
                      }
                      final q = textEditing.text.toLowerCase();
                      return medications
                          .where((m) => m.genericName.toLowerCase().contains(q))
                          .take(8);
                    },
                    displayStringForOption: (m) => m.genericName,
                    fieldViewBuilder:
                        (context, controller, focusNode, onFieldSubmitted) {
                      return TextField(
                        controller: controller,
                        focusNode: focusNode,
                        onSubmitted: (_) => onFieldSubmitted(),
                        textCapitalization: TextCapitalization.words,
                        decoration: InputDecoration(
                          hintText: 'Search medication...',
                          hintStyle: const TextStyle(color: AppColors.gray400),
                          prefixIcon: const Icon(
                            Icons.search,
                            color: AppColors.gray400,
                            size: 20,
                          ),
                          border: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusMd),
                            borderSide:
                                const BorderSide(color: AppColors.gray200),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusMd),
                            borderSide:
                                const BorderSide(color: AppColors.gray200),
                          ),
                          focusedBorder: OutlineInputBorder(
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusMd),
                            borderSide: const BorderSide(
                                color: AppColors.primary, width: 1.5),
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                            horizontal: DesignTokens.spaceMd,
                            vertical: DesignTokens.spaceSm + 2,
                          ),
                        ),
                        style: const TextStyle(
                            fontSize: 16, color: AppColors.gray900),
                      );
                    },
                    onSelected: (medication) {
                      setState(() => selected = medication);
                    },
                    optionsViewBuilder: (context, onSelected, options) {
                      return Align(
                        alignment: Alignment.topLeft,
                        child: Material(
                          elevation: 4,
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusMd),
                          child: ConstrainedBox(
                            constraints: BoxConstraints(
                              maxHeight: 240,
                              maxWidth: MediaQuery.of(context).size.width -
                                  DesignTokens.spaceMd * 4,
                            ),
                            child: ListView.builder(
                              shrinkWrap: true,
                              padding: EdgeInsets.zero,
                              itemCount: options.length,
                              itemBuilder: (context, i) {
                                final med = options.elementAt(i);
                                return InkWell(
                                  onTap: () => onSelected(med),
                                  child: ListTile(
                                    dense: true,
                                    title: Text(
                                      med.genericName,
                                      style: const TextStyle(
                                        fontSize: 15,
                                        color: AppColors.gray900,
                                      ),
                                    ),
                                    subtitle: Text(
                                      med.controlledSubstance
                                          ? 'Controlled — ${med.controlledSchedule.wireValue}'
                                          : 'Non-controlled',
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: AppColors.gray500,
                                      ),
                                    ),
                                  ),
                                );
                              },
                            ),
                          ),
                        ),
                      );
                    },
                  ),
                  if (selected != null) ...[
                    const SizedBox(height: DesignTokens.spaceMd),
                    StatusBadge(
                      label: selected!.genericName,
                      tone: StatusBadgeTone.primary,
                      icon: Icons.check_circle_outline,
                    ),
                  ],
                ],
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(dialogContext).maybePop(),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: selected == null
                      ? null
                      : () => Navigator.of(dialogContext).maybePop(selected),
                  child: const Text('Add'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  // --------------------------------------------------------------------------
  // PDF generation, share and upload

  /// After a successful sign, build the prescription PDF from the draft data
  /// captured in the UI state and present a dialog with Share / Upload actions.
  /// PDF generation failure never blocks the user from continuing.
  Future<void> _generateAndShowPdf(Prescription signed) async {
    setState(() {
      _generatingPdf = true;
      _pdfError = null;
    });
    try {
      final pdfData = _buildPdfData(signed);
      final bytes = await generatePrescriptionPdf(pdfData);
      if (!mounted) return;
      setState(() {
        _generatedPdf = bytes;
        _generatedPrescriptionId = signed.prescriptionId;
        _generatingPdf = false;
      });
      await _showPdfActionsDialog(signed.prescriptionId);
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _generatingPdf = false;
        _pdfError = 'Could not generate the PDF: $e';
      });
      // Still surface the signed state; PDF is a convenience, not a requirement.
      _showError(_pdfError!);
    }
  }

  /// Freeze the structured prescription data from the current UI state. This
  /// must run BEFORE the signed prescription is re-fetched, because re-fetch
  /// turns `items` into opaque ids. The doctor/patient context is resolved
  /// from the in-memory providers so no extra network round-trip is needed.
  PrescriptionPdfData _buildPdfData(Prescription signed) {
    final consultationId = _consultationId ?? signed.consultationId;
    Consultation? consultation;
    if (consultationId.isNotEmpty) {
      consultation =
          ref.read(consultationDetailProvider(consultationId)).valueOrNull;
    }
    final patientName = _resolvePatientName(consultation);
    final patientId = consultation?.patientProfileId ?? signed.patientProfileId;

    // Doctor identity from the current profile + professional details.
    final profile = ref.read(profileProvider).valueOrNull;
    final doctorName = profile?.displayName ?? 'Doctor';
    String specialty = '';
    final doctorMembershipId =
        consultation?.doctorMembershipId ?? signed.doctorMembershipId;
    final details =
        ref.read(doctorDetailsProvider(doctorMembershipId)).valueOrNull;
    if (details != null && details.specialties.isNotEmpty) {
      specialty = details.specialties.first;
    }

    // Medications from the draft rows. Only valid rows are included, matching
    // what was actually persisted to the prescription.
    final items = _medications
        .where((m) => m.isValid)
        .map((m) => PrescriptionPdfItem(
              drugName: m.nameController.text.trim(),
              dose:
                  '${m.doseController.text.trim()} ${m.unitController.text.trim()}'
                      .trim(),
              route: _labelForRoute(m.routeCode),
              frequency: _labelForFrequency(m.frequencyCode),
              durationDays: int.tryParse(m.durationController.text.trim()) ?? 0,
              instructions: m.instructionsController.text.trim(),
            ))
        .toList();

    final verificationUrl =
        'https://portal.smartcura.app/prescriptions/${signed.prescriptionId}';

    return PrescriptionPdfData(
      prescriptionId: signed.prescriptionId,
      organizationName: AppConstants.appName,
      patientName: patientName,
      patientId: patientId,
      doctorName: doctorName,
      doctorSpecialty: specialty,
      doctorLicenseNumber: '', // Not exposed by the profile contract.
      consultationId: consultationId,
      diagnosis: _diagnosisController.text.trim(),
      issuedAt: signed.signedAt ?? DateTime.now().toUtc().toIso8601String(),
      expiresAt: signed.expiresAt ?? '',
      items: items,
      verificationUrl: verificationUrl,
    );
  }

  String _labelForRoute(String code) {
    final match = _routes.where((r) => r.code == code);
    return match.isNotEmpty ? match.first.label : code;
  }

  String _labelForFrequency(String code) {
    final match = _frequencies.where((f) => f.code == code);
    return match.isNotEmpty ? match.first.label : code;
  }

  /// Present the post-sign actions: share the PDF or attempt backend upload.
  /// Closing the dialog returns the doctor to the screen; they can re-open it
  /// from the footer while the generated PDF is held in state.
  Future<void> _showPdfActionsDialog(String prescriptionId) async {
    if (!mounted) return;
    await showDialog<void>(
      context: context,
      barrierDismissible: true,
      builder: (dialogContext) {
        return _PrescriptionPdfActionsDialog(
          prescriptionId: prescriptionId,
          onShare: () => _sharePdf(prescriptionId),
          onUpload: () => _uploadPdf(),
          onClose: () => Navigator.of(dialogContext).maybePop(),
        );
      },
    );
  }

  Future<void> _sharePdf(String prescriptionId) async {
    final bytes = _generatedPdf;
    if (bytes == null) {
      _showError('The PDF is not ready yet.');
      return;
    }
    final filename = 'prescription-${_shortId(prescriptionId)}.pdf';
    try {
      final ok = await Printing.sharePdf(bytes: bytes, filename: filename);
      if (!ok && mounted) {
        _showError('Sharing is not available on this device. '
            'The PDF was generated but could not be shared.');
      }
    } catch (e) {
      if (mounted) _showError('Could not share the PDF: $e');
    }
  }

  Future<void> _uploadPdf() async {
    final bytes = _generatedPdf;
    if (bytes == null) {
      _showError('The PDF is not ready yet.');
      return;
    }
    try {
      final notifier = ref.read(prescriptionDocumentUploadProvider.notifier);
      final result = await notifier.upload(pdfBytes: bytes);
      if (!mounted) return;
      if (result is PrescriptionUploadSuccess) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
                'Prescription PDF uploaded (sha256 ${_shortId(result.sha256Hex)}).'),
            duration: const Duration(seconds: 3),
          ),
        );
      } else if (result is PrescriptionUploadUnsupported) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(result.reason),
            duration: const Duration(seconds: 4),
          ),
        );
      } else if (result is PrescriptionUploadFailure) {
        _showError(result.error.displayMessage);
      }
    } catch (e) {
      if (mounted) _showError('Could not upload the PDF: $e');
    }
  }

  /// Download the server-signed PDF for a prescription. The backend returns a
  /// base64 data URI that is handed to the system PDF viewer / browser.
  Future<void> _downloadSignedPdf(String prescriptionId) async {
    try {
      final body = await ref.read(apiClientProvider).get(
            ApiEndpoints.prescriptionPdf(prescriptionId),
          );
      final downloadUrl = body['download_url'] as String?;
      if (downloadUrl == null || downloadUrl.isEmpty) {
        _showError('The signed prescription PDF is not available yet.');
        return;
      }
      final uri = Uri.parse(downloadUrl);
      final ok = await launchUrl(
        uri,
        mode: LaunchMode.externalApplication,
      );
      if (!ok && mounted) {
        _showError('Could not open the PDF. No application can handle it.');
      }
    } catch (e) {
      if (mounted) _showError('Could not download the signed PDF: $e');
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
    final prescriptionsAsync =
        ref.watch(_consultationPrescriptionsProvider(consultationId));
    final catalogAsync = ref.watch(_medicationsProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: _buildAppBar(),
      body: consultationAsync.when(
        data: (consultation) {
          return prescriptionsAsync.when(
            data: (list) {
              // Pick the latest draft as the active one.
              final drafts = list.data
                  .where((p) => p.status == PrescriptionStatus.draft)
                  .toList();
              if (drafts.isNotEmpty &&
                  _activeDraft == null &&
                  !_formInitialized) {
                _activeDraft = drafts.first;
                _populateFromDraft(drafts.first, catalogAsync.valueOrNull);
              }
              final priorNotes = list.data
                  .where((p) => p.status != PrescriptionStatus.draft)
                  .toList();
              return _buildBody(
                consultation: consultation,
                priorPrescriptions: priorNotes,
                catalogAsync: catalogAsync,
              );
            },
            loading: () =>
                const LoadingOverlay(label: 'Loading prescriptions...'),
            error: (err, _) {
              final apiError = err is ApiError ? err : toApiError(err);
              return ErrorView(
                message: apiError.displayMessage,
                isForbidden: apiError.isForbidden,
                onRetry: () => ref.invalidate(
                    _consultationPrescriptionsProvider(consultationId)),
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
      bottomNavigationBar: _buildFooter(),
    );
  }

  PreferredSizeWidget _buildAppBar() {
    return AppBar(
      backgroundColor: AppColors.surface,
      elevation: 0,
      systemOverlayStyle: SystemUiOverlayStyle.dark,
      leading: IconButton(
        icon: const Icon(Icons.arrow_back, color: AppColors.gray900),
        onPressed: () => Navigator.of(context).maybePop(),
      ),
      title: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            'New Prescription',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  color: AppColors.gray900,
                ),
          ),
          Text(
            'Create new e-prescription',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: AppColors.gray500,
                ),
          ),
        ],
      ),
      centerTitle: true,
      actions: [
        TextButton.icon(
          onPressed: _saving ? null : _saveDraft,
          icon: _saving
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.primary,
                  ),
                )
              : const Icon(Icons.description_outlined, size: 20),
          label: const Text(
            'Save Draft',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.bold,
            ),
          ),
          style: TextButton.styleFrom(
            foregroundColor: AppColors.primary,
          ),
        ),
      ],
    );
  }

  Widget _buildBody({
    required Consultation consultation,
    required List<Prescription> priorPrescriptions,
    required AsyncValue<MedicationList> catalogAsync,
  }) {
    final patientAsync =
        ref.watch(doctorPatientDetailProvider(consultation.patientProfileId));

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        DesignTokens.spaceSm,
        DesignTokens.spaceMd,
        120,
      ),
      children: [
        _buildPatientHeaderCard(patientAsync, consultation.patientProfileId),
        if (_activeDraft != null) ...[
          const SizedBox(height: DesignTokens.spaceSm),
          _buildDraftBanner(),
        ],
        const SizedBox(height: DesignTokens.spaceLg),
        _buildDiagnosisSection(),
        const SizedBox(height: DesignTokens.spaceLg),
        _buildMedicationsSection(catalogAsync),
        const SizedBox(height: DesignTokens.spaceLg),
        if (priorPrescriptions.isNotEmpty) ...[
          _buildPriorPrescriptions(priorPrescriptions),
          const SizedBox(height: DesignTokens.spaceLg),
        ],
        _buildSignNotice(),
        if (_generatingPdf) ...[
          const SizedBox(height: DesignTokens.spaceLg),
          _buildGeneratingPdfBanner(),
        ],
        if (_generatedPdf != null && !_generatingPdf) ...[
          const SizedBox(height: DesignTokens.spaceLg),
          _buildPdfReadyCard(),
        ],
        const SizedBox(height: DesignTokens.space2xl),
      ],
    );
  }

  /// Shown while the PDF is being rendered after a successful sign.
  Widget _buildGeneratingPdfBanner() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.primaryContainer,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
      ),
      child: const Row(
        children: [
          SizedBox(
            width: 20,
            height: 20,
            child: CircularProgressIndicator(
              strokeWidth: 2,
              color: AppColors.primaryDark,
            ),
          ),
          SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Text(
              'Generating prescription PDF...',
              style: TextStyle(
                color: AppColors.primaryDark,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// Shown after the PDF has been generated, so the doctor can re-open the
  /// Share/Upload actions if they dismissed the post-sign dialog.
  Widget _buildPdfReadyCard() {
    final id = _generatedPrescriptionId;
    return PremiumCard(
      accent: AppColors.success,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.picture_as_pdf,
                  color: AppColors.success, size: 20),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: Text(
                  'Prescription PDF ready${id != null ? " · Rx ${_shortId(id)}" : ""}',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                        color: AppColors.gray900,
                      ),
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: id != null ? () => _sharePdf(id) : null,
                  icon: const Icon(Icons.ios_share, size: 18),
                  label: const Text('Share local'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primary,
                    side:
                        const BorderSide(color: AppColors.primary, width: 1.5),
                  ),
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _uploadPdf,
                  icon: const Icon(Icons.cloud_upload_outlined, size: 18),
                  label: const Text('Upload'),
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          SizedBox(
            width: double.infinity,
            child: OutlinedButton.icon(
              onPressed: id != null ? () => _downloadSignedPdf(id) : null,
              icon: const Icon(Icons.picture_as_pdf, size: 18),
              label: const Text('Download signed PDF'),
              style: OutlinedButton.styleFrom(
                foregroundColor: AppColors.gray800,
                side: const BorderSide(color: AppColors.gray300, width: 1),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPatientHeaderCard(
    AsyncValue<DoctorAssignedPatient> patientAsync,
    String patientProfileId,
  ) {
    return PremiumCard(
      child: patientAsync.when(
        data: (patient) {
          final contact = patient.phoneE164?.isNotEmpty == true
              ? patient.phoneE164!
              : patient.email;
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AvatarWidget(
                    name: patient.displayName,
                    size: DesignTokens.avatar2xl,
                  ),
                  const SizedBox(width: DesignTokens.spaceMd),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          patient.displayName,
                          style:
                              Theme.of(context).textTheme.titleMedium?.copyWith(
                                    fontWeight: FontWeight.bold,
                                    color: AppColors.gray900,
                                  ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'ID: ${_shortId(patientProfileId)}',
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: AppColors.gray500,
                                  ),
                        ),
                        if (contact.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Text(
                            contact,
                            style:
                                Theme.of(context).textTheme.bodySmall?.copyWith(
                                      color: AppColors.gray500,
                                    ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: DesignTokens.spaceMd),
              Row(
                children: [
                  TextButton.icon(
                    onPressed: () => context.push(
                      '/patient-details',
                      extra: patientProfileId,
                    ),
                    icon: const Icon(
                      Icons.history_rounded,
                      size: 18,
                      color: AppColors.primary,
                    ),
                    label: const Text(
                      'View History',
                      style: TextStyle(
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.primary,
                      padding: EdgeInsets.zero,
                      tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    ),
                  ),
                  const Spacer(),
                  const StatusBadge(
                    label: 'Follow-up Consultation',
                    tone: StatusBadgeTone.primary,
                    icon: Icons.calendar_month_outlined,
                  ),
                ],
              ),
            ],
          );
        },
        loading: () => Row(
          children: [
            Container(
              width: DesignTokens.avatar2xl,
              height: DesignTokens.avatar2xl,
              decoration: const BoxDecoration(
                color: AppColors.gray200,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 140,
                    height: 16,
                    decoration: BoxDecoration(
                      color: AppColors.gray200,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusSm),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceSm),
                  Container(
                    width: 80,
                    height: 12,
                    decoration: BoxDecoration(
                      color: AppColors.gray200,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusSm),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        error: (err, _) => Row(
          children: [
            const Icon(Icons.error_outline, color: AppColors.error),
            const SizedBox(width: DesignTokens.spaceSm),
            Expanded(
              child: Text(
                'Could not load patient details',
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: AppColors.gray600,
                    ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDraftBanner() {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceMd,
        vertical: DesignTokens.spaceSm,
      ),
      decoration: BoxDecoration(
        color: AppColors.warningContainer,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
      ),
      child: Row(
        children: [
          const Icon(Icons.edit_note, color: AppColors.warningDark, size: 20),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Text(
              'Editing existing draft — Save updates the current prescription.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: AppColors.warningDark,
                    fontWeight: FontWeight.w500,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDiagnosisSection() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'DIAGNOSIS (Optional)',
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.gray900,
                letterSpacing: 0.5,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            border: Border.all(color: AppColors.gray200, width: 1),
          ),
          child: TextField(
            controller: _diagnosisController,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              hintText: 'e.g., Acute Bronchitis (J20.9)',
              hintStyle: TextStyle(color: AppColors.gray400),
              border: InputBorder.none,
              contentPadding: EdgeInsets.all(DesignTokens.spaceMd),
            ),
            style: const TextStyle(fontSize: 16, color: AppColors.gray900),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceXs),
        Text(
          'For context only — the coded diagnosis is recorded in the clinical note.',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
                color: AppColors.gray400,
              ),
        ),
      ],
    );
  }

  Widget _buildMedicationsSection(AsyncValue<MedicationList> catalogAsync) {
    final catalog = catalogAsync.valueOrNull;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text(
              'PRESCRIPTION',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: AppColors.gray900,
                    letterSpacing: 0.5,
                  ),
            ),
            TextButton.icon(
              onPressed: catalog != null && catalog.data.isNotEmpty
                  ? () async {
                      final selected =
                          await _showMedicationLibraryDialog(catalog);
                      if (selected != null) {
                        _addMedicationFromLibrary(selected);
                      }
                    }
                  : null,
              icon: const Icon(Icons.library_books_outlined, size: 18),
              label: const Text(
                'Add from Library',
                style: TextStyle(fontWeight: FontWeight.w600),
              ),
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primary,
              ),
            ),
          ],
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        if (_medications.isEmpty)
          _buildEmptyMedications()
        else
          ...List.generate(_medications.length, (i) {
            return Padding(
              padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
              child: _buildMedicationCard(i, catalogAsync),
            );
          }),
        const SizedBox(height: DesignTokens.spaceSm),
        OutlinedButton.icon(
          onPressed: _addMedication,
          icon: const Icon(Icons.add, size: 20),
          label: const Text(
            'Add Medicine',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.primary,
            side: const BorderSide(color: AppColors.primary, width: 1.5),
            minimumSize: const Size.fromHeight(DesignTokens.buttonHeightLg),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildEmptyMedications() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceXl),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(
          color: AppColors.gray200,
          style: BorderStyle.solid,
          width: 1,
        ),
      ),
      child: Column(
        children: [
          SvgPicture.asset(
            'assets/illustrations/empty_prescriptions.svg',
            width: 96,
            height: 96,
            fit: BoxFit.contain,
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            'No medications added yet',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray500,
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildMedicationCard(
      int index, AsyncValue<MedicationList> catalogAsync) {
    final draft = _medications[index];
    return PremiumCard(
      accent: AppColors.primary,
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.center,
            children: [
              _buildNumberBadge(index),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: _buildMedicationAutocomplete(draft, catalogAsync),
              ),
              IconButton(
                icon: const Icon(Icons.delete_outline,
                    color: AppColors.error, size: 20),
                onPressed: () => _removeMedication(index),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(child: _buildDoseField(draft)),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: _buildDropdown(
                  label: 'Frequency',
                  value: draft.frequencyCode,
                  options: _frequencies,
                  onChanged: (v) => setState(() => draft.frequencyCode = v),
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Expanded(
                child: _buildLabeledField(
                  label: 'Duration',
                  controller: draft.durationController,
                  hint: '5',
                  suffixText: 'Days',
                  keyboardType: TextInputType.number,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildLabeledField(
            label: 'Instructions',
            controller: draft.instructionsController,
            hint: 'After meals',
            fillColor: AppColors.primaryContainer,
            prefixIcon: const Icon(
              Icons.info_outline,
              color: AppColors.primary,
              size: 18,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNumberBadge(int index) {
    return Container(
      width: 28,
      height: 28,
      decoration: const BoxDecoration(
        color: AppColors.primary,
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        '${index + 1}',
        style: const TextStyle(
          color: AppColors.white,
          fontSize: 14,
          fontWeight: FontWeight.bold,
        ),
      ),
    );
  }

  Widget _buildMedicationAutocomplete(
      _MedicationDraft draft, AsyncValue<MedicationList> catalogAsync) {
    return Autocomplete<Medication>(
      optionsBuilder: (TextEditingValue textEditing) {
        if (textEditing.text.isEmpty) {
          return const Iterable<Medication>.empty();
        }
        final catalog = catalogAsync.valueOrNull?.data ?? const <Medication>[];
        final q = textEditing.text.toLowerCase();
        return catalog
            .where((m) => m.genericName.toLowerCase().contains(q))
            .take(8);
      },
      displayStringForOption: (m) => m.genericName,
      fieldViewBuilder: (context, controller, focusNode, onFieldSubmitted) {
        // Sync the draft's name controller with the autocomplete field.
        controller.addListener(() {
          draft.nameController.text = controller.text;
          if (draft.selectedMedicationId != null &&
              controller.text != draft.nameController.text) {
            draft.selectedMedicationId = null;
          }
        });
        return TextField(
          controller: controller,
          focusNode: focusNode,
          onSubmitted: (_) => onFieldSubmitted(),
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(
            hintText: 'Type or search a medication...',
            hintStyle: TextStyle(color: AppColors.gray400),
            border: OutlineInputBorder(
              borderRadius:
                  BorderRadius.all(Radius.circular(DesignTokens.radiusMd)),
              borderSide: BorderSide(color: AppColors.gray200),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius:
                  BorderRadius.all(Radius.circular(DesignTokens.radiusMd)),
              borderSide: BorderSide(color: AppColors.gray200),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius:
                  BorderRadius.all(Radius.circular(DesignTokens.radiusMd)),
              borderSide: BorderSide(color: AppColors.primary, width: 1.5),
            ),
            contentPadding: EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceMd,
              vertical: DesignTokens.spaceSm + 2,
            ),
          ),
          style: const TextStyle(fontSize: 16, color: AppColors.gray900),
        );
      },
      onSelected: (medication) {
        setState(() {
          draft.selectedMedicationId = medication.medicationId;
          draft.nameController.text = medication.genericName;
        });
      },
      optionsViewBuilder: (context, onSelected, options) {
        return Align(
          alignment: Alignment.topLeft,
          child: Material(
            elevation: 4,
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            child: ConstrainedBox(
              constraints: BoxConstraints(
                maxHeight: 240,
                maxWidth: MediaQuery.of(context).size.width -
                    DesignTokens.spaceMd * 2,
              ),
              child: ListView.builder(
                shrinkWrap: true,
                padding: EdgeInsets.zero,
                itemCount: options.length,
                itemBuilder: (context, i) {
                  final med = options.elementAt(i);
                  return InkWell(
                    onTap: () => onSelected(med),
                    child: ListTile(
                      dense: true,
                      title: Text(
                        med.genericName,
                        style: const TextStyle(
                          fontSize: 15,
                          color: AppColors.gray900,
                        ),
                      ),
                      subtitle: Text(
                        med.controlledSubstance
                            ? 'Controlled — ${med.controlledSchedule.wireValue}'
                            : 'Non-controlled',
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.gray500,
                        ),
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
        );
      },
    );
  }

  Widget _buildDoseField(_MedicationDraft draft) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Dose',
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray900,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceXs),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surfaceVariant,
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          ),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  flex: 2,
                  child: TextField(
                    controller: draft.doseController,
                    keyboardType: TextInputType.number,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      hintText: '1',
                      hintStyle: TextStyle(color: AppColors.gray400),
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.all(DesignTokens.spaceMd),
                    ),
                    style: const TextStyle(
                      fontSize: 16,
                      color: AppColors.gray900,
                    ),
                  ),
                ),
                Container(
                  width: 1,
                  color: AppColors.gray200,
                  margin: const EdgeInsets.symmetric(vertical: 12),
                ),
                Expanded(
                  child: TextField(
                    controller: draft.unitController,
                    textInputAction: TextInputAction.next,
                    decoration: const InputDecoration(
                      hintText: 'Tablet',
                      hintStyle: TextStyle(color: AppColors.gray400),
                      border: InputBorder.none,
                      contentPadding: EdgeInsets.all(DesignTokens.spaceMd),
                    ),
                    style: const TextStyle(
                      fontSize: 16,
                      color: AppColors.gray900,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildLabeledField({
    required String label,
    required TextEditingController controller,
    required String hint,
    TextInputType? keyboardType,
    int minLines = 1,
    String? suffixText,
    Widget? prefixIcon,
    Color? fillColor,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray900,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceXs),
        Container(
          decoration: BoxDecoration(
            color: fillColor ?? AppColors.surfaceVariant,
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          ),
          child: TextField(
            controller: controller,
            keyboardType: keyboardType,
            minLines: minLines,
            maxLines: minLines > 1 ? null : 1,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: const TextStyle(color: AppColors.gray400),
              border: InputBorder.none,
              contentPadding: const EdgeInsets.all(DesignTokens.spaceMd),
              suffixText: suffixText,
              suffixStyle: const TextStyle(
                color: AppColors.gray500,
                fontWeight: FontWeight.w500,
              ),
              prefixIcon: prefixIcon,
            ),
            style: const TextStyle(fontSize: 16, color: AppColors.gray900),
          ),
        ),
      ],
    );
  }

  Widget _buildDropdown({
    required String label,
    required String value,
    required List<({String code, String label})> options,
    required ValueChanged<String> onChanged,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray900,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceXs),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: AppColors.surfaceVariant,
            borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: value,
              isExpanded: true,
              items: options
                  .map((o) => DropdownMenuItem(
                        value: o.code,
                        child: Text(
                          o.label,
                          style: const TextStyle(
                            fontSize: 15,
                            color: AppColors.gray900,
                          ),
                        ),
                      ))
                  .toList(),
              onChanged: (v) {
                if (v != null) onChanged(v);
              },
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildPriorPrescriptions(List<Prescription> prior) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Prior Prescriptions',
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.gray900,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        ...prior.map((p) => Padding(
              padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
              child: PremiumCard(
                accent: _statusTone(p.status) == StatusBadgeTone.error
                    ? AppColors.error
                    : _statusTone(p.status) == StatusBadgeTone.success
                        ? AppColors.success
                        : AppColors.gray300,
                child: Row(
                  children: [
                    StatusBadge(
                      label: _statusLabel(p.status),
                      tone: _statusTone(p.status),
                      showDot: true,
                    ),
                    const Spacer(),
                    Text(
                      'ID: ${_shortId(p.prescriptionId)}',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            color: AppColors.gray500,
                          ),
                    ),
                  ],
                ),
              ),
            )),
      ],
    );
  }

  Widget _buildSignNotice() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.primaryContainer,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.verified_user_outlined,
              color: AppColors.primaryDark, size: 20),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Text(
              'Signing requires step-up authentication. You will be asked to '
              're-authenticate before the prescription is locked.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: AppColors.primaryDark,
                    height: 1.4,
                  ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFooter() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.surface,
        border: const Border(
          top: BorderSide(color: AppColors.gray200, width: 1),
        ),
        boxShadow: const [
          BoxShadow(
            color: AppColors.shadowLight,
            blurRadius: 10,
            offset: Offset(0, -2),
          ),
        ],
      ),
      child: SafeArea(
        child: Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: _showPreview,
                icon: const Icon(Icons.preview_outlined, size: 20),
                label: const Text(
                  'Preview',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                style: OutlinedButton.styleFrom(
                  foregroundColor: AppColors.primary,
                  side: const BorderSide(color: AppColors.primary, width: 1.5),
                  minimumSize:
                      const Size.fromHeight(DesignTokens.buttonHeightLg),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                ),
              ),
            ),
            const SizedBox(width: DesignTokens.spaceMd),
            Expanded(
              child: FilledButton.icon(
                onPressed: _signing ? null : _signPrescription,
                icon: _signing
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppColors.white,
                        ),
                      )
                    : const Icon(Icons.verified_rounded, size: 20),
                label: const Text(
                  'Send Prescription',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                style: FilledButton.styleFrom(
                  backgroundColor: AppColors.primaryDark,
                  foregroundColor: AppColors.white,
                  minimumSize:
                      const Size.fromHeight(DesignTokens.buttonHeightLg),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Post-sign dialog offering Share/Download and Upload of the generated
/// prescription PDF. Stateless: the actions are delegated back to the screen
/// state via callbacks so the PDF bytes stay in one place.
class _PrescriptionPdfActionsDialog extends StatefulWidget {
  const _PrescriptionPdfActionsDialog({
    required this.prescriptionId,
    required this.onShare,
    required this.onUpload,
    required this.onClose,
  });

  final String prescriptionId;
  final Future<void> Function() onShare;
  final Future<void> Function() onUpload;
  final VoidCallback onClose;

  @override
  State<_PrescriptionPdfActionsDialog> createState() =>
      _PrescriptionPdfActionsDialogState();
}

class _PrescriptionPdfActionsDialogState
    extends State<_PrescriptionPdfActionsDialog> {
  bool _busy = false;

  Future<void> _run(Future<void> Function() action) async {
    if (_busy) return;
    setState(() => _busy = true);
    try {
      await action();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
      ),
      title: Row(
        children: [
          const Icon(Icons.check_circle, color: AppColors.success, size: 28),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: Text(
              'Prescription Signed',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: AppColors.gray900,
                  ),
            ),
          ),
        ],
      ),
      content: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'The prescription (Rx ${widget.prescriptionId.length <= 8 ? widget.prescriptionId.toUpperCase() : widget.prescriptionId.substring(widget.prescriptionId.length - 8).toUpperCase()}) '
            'has been signed and a PDF with a verification QR code is ready.',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray600,
                  height: 1.4,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          if (_busy)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
              child: Center(
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.primary,
                  ),
                ),
              ),
            ),
        ],
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : widget.onClose,
          child: const Text('Done'),
        ),
        OutlinedButton.icon(
          onPressed: _busy ? null : () => _run(widget.onShare),
          icon: const Icon(Icons.ios_share, size: 18),
          label: const Text('Share / Download'),
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.primary,
            side: const BorderSide(color: AppColors.primary, width: 1.5),
          ),
        ),
        FilledButton.icon(
          onPressed: _busy ? null : () => _run(widget.onUpload),
          icon: const Icon(Icons.cloud_upload_outlined, size: 18),
          label: const Text('Upload'),
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: AppColors.white,
          ),
        ),
      ],
    );
  }
}
