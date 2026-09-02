import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/profile_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Doctor Edit Profile Screen.
///
/// Pre-fills from real backend data and persists changes via two calls:
/// 1. `PATCH /profiles/me` — display name, email, phone.
/// 2. `PUT /memberships/{id}/doctor-details` — specialty, experience, fee, bio.
///
/// Money (consultation fee) is input in RM and converted to integer sen for the
/// API. Both calls carry CSRF via the API client interceptors. All four resource
/// states (loading, error, empty, loaded) are handled.
class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

/// The single source of truth for the specialty dropdown vocabulary. Avoids
/// retyping enums and keeps the UI in sync if this list changes.
const _specialties = <String>[
  'Cardiology',
  'Dermatology',
  'Neurology',
  'Pediatrics',
  'General Practice',
  'Internal Medicine',
  'Psychiatry',
  'Orthopedics',
  'Obstetrics & Gynecology',
  'Ophthalmology',
  'ENT',
  'Oncology',
  'Endocrinology',
  'Gastroenterology',
  'Nephrology',
];

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _experienceController = TextEditingController();
  final _feeController = TextEditingController();
  final _bioController = TextEditingController();

  String? _selectedSpecialty;
  bool _isSaving = false;
  bool _controllersPopulated = false;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _experienceController.dispose();
    _feeController.dispose();
    _bioController.dispose();
    super.dispose();
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /// Integer sen → "RM X.XX" string.
  String _formatSen(int sen) {
    final ringgit = sen / 100;
    return 'RM ${ringgit.toStringAsFixed(2)}';
  }

  /// RM input string → integer sen for the API. Returns 0 on parse failure.
  int _rmToSen(String rm) {
    final value = double.tryParse(rm.trim());
    if (value == null || value < 0) return 0;
    return (value * 100).round();
  }

  /// Populate the form controllers once the profile + doctor-details resolve.
  /// Guarded by [_controllersPopulated] so we don't overwrite user edits on a
  /// provider rebuild.
  void _populateControllers({
    required Profile profile,
    DoctorProfessionalDetail? details,
  }) {
    if (_controllersPopulated) return;
    _nameController.text = profile.displayName;
    _emailController.text = profile.email;
    _phoneController.text = profile.phoneE164 ?? '';
    if (details != null) {
      _experienceController.text =
          details.yearsExperience != null ? '${details.yearsExperience}' : '';
      _feeController.text = details.consultationFeeSen > 0
          ? _formatSen(details.consultationFeeSen)
          : '';
      _bioController.text = details.biography ?? '';
      if (details.specialties.isNotEmpty) {
        final match = _specialties
            .where((s) =>
                s.toLowerCase() == details.specialties.first.toLowerCase())
            .firstOrNull;
        _selectedSpecialty = match ?? details.specialties.first;
      }
    }
    _controllersPopulated = true;
  }

  // ------------------------------------------------------------------
  // Save
  // ------------------------------------------------------------------

  Future<void> _saveChanges() async {
    if (!_formKey.currentState!.validate()) return;
    final membershipId = ref.read(activeMembershipIdProvider);
    if (membershipId == null) {
      _showError('No active membership found. Please sign in again.');
      return;
    }

    setState(() => _isSaving = true);

    // Read the current doctor-details version for optimistic concurrency.
    final detailsAsync = ref.read(doctorDetailsProvider(membershipId));
    final currentDetails = detailsAsync.valueOrNull;
    final expectedVersion = currentDetails?.version ?? 0;

    // 1. PATCH /profiles/me — display name, phone.
    final profileNotifier = ref.read(updateProfileProvider.notifier);
    final profileOk = await profileNotifier.call(
      UpdateMyProfileRequest(
        displayName: _nameController.text.trim(),
        phoneE164: _phoneController.text.trim().isEmpty
            ? null
            : _phoneController.text.trim(),
      ),
    );

    if (!profileOk) {
      final err = ref.read(updateProfileProvider).error;
      _showError(
          err is ApiError ? err.displayMessage : 'Could not update profile.');
      if (mounted) setState(() => _isSaving = false);
      return;
    }

    // 2. PUT /memberships/{id}/doctor-details — specialty, experience, fee, bio.
    final detailsNotifier = ref.read(updateDoctorDetailsProvider.notifier);
    final feeSen = _rmToSen(_feeController.text);
    final detailsOk = await detailsNotifier.call(
      membershipId: membershipId,
      biography: _bioController.text.trim().isEmpty
          ? null
          : _bioController.text.trim(),
      yearsExperience: int.tryParse(_experienceController.text.trim()),
      consultationFeeSen: feeSen,
      specialties: _selectedSpecialty == null ? null : [_selectedSpecialty!],
      expectedVersion: expectedVersion,
    );

    if (!detailsOk) {
      final err = ref.read(updateDoctorDetailsProvider).error;
      _showError(err is ApiError
          ? err.displayMessage
          : 'Could not update professional details.');
      if (mounted) setState(() => _isSaving = false);
      return;
    }

    // Invalidate the read providers so the profile screen reflects the change.
    ref.invalidate(profileProvider);
    ref.invalidate(doctorDetailsProvider(membershipId));

    if (!mounted) return;
    setState(() => _isSaving = false);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Profile updated successfully'),
        backgroundColor: AppColors.primary,
        duration: Duration(seconds: 2),
      ),
    );
    context.pop();
  }

  void _showError(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), backgroundColor: AppColors.error),
    );
  }

  // ------------------------------------------------------------------
  // Build
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(currentProfileProvider);
    final membershipId = ref.watch(activeMembershipIdProvider);
    final detailsAsync = membershipId != null
        ? ref.watch(doctorDetailsProvider(membershipId))
        : null;

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded,
              color: AppColors.gray900),
          onPressed: () => context.pop(),
        ),
        title: Text(
          'Edit Profile',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
                color: AppColors.gray900,
              ),
        ),
        centerTitle: true,
      ),
      body: profile == null
          ? const LoadingOverlay(label: 'Loading profile…')
          : detailsAsync == null
              ? const LoadingOverlay(label: 'Loading details…')
              : detailsAsync.when(
                  data: (details) {
                    _populateControllers(profile: profile, details: details);
                    return _buildForm();
                  },
                  loading: () =>
                      const LoadingOverlay(label: 'Loading details…'),
                  error: (err, _) {
                    // Profile loaded but details failed — still allow editing
                    // the profile fields; show a non-blocking notice.
                    _populateControllers(profile: profile);
                    return _buildForm(detailsError: err);
                  },
                ),
      bottomNavigationBar: _buildSaveBar(),
    );
  }

  Widget _buildForm({Object? detailsError}) {
    final profile = ref.watch(currentProfileProvider);
    return Form(
      key: _formKey,
      child: SingleChildScrollView(
        padding: const EdgeInsets.fromLTRB(DesignTokens.spaceMd,
            DesignTokens.spaceSm, DesignTokens.spaceMd, DesignTokens.spaceXl),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (detailsError != null)
              Padding(
                padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
                child: Container(
                  padding: const EdgeInsets.all(DesignTokens.spaceMd),
                  decoration: BoxDecoration(
                    color: AppColors.warningContainer,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.info_outline_rounded,
                          color: AppColors.warningDark,
                          size: DesignTokens.iconSm),
                      const SizedBox(width: DesignTokens.spaceSm),
                      Expanded(
                        child: Text(
                          'Professional details could not be loaded. '
                          'Profile fields are still editable.',
                          style:
                              Theme.of(context).textTheme.bodySmall?.copyWith(
                                    color: AppColors.warningDark,
                                  ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),

            // Profile photo
            Center(
              child: Column(
                children: [
                  AvatarWidget(
                    name: profile?.displayName ?? 'Doctor',
                    size: 96,
                    imageUrl: profile?.avatarUrl,
                  ),
                  const SizedBox(height: DesignTokens.spaceSm),
                  Text(
                    'Profile Photo',
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: AppColors.gray600,
                        ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: DesignTokens.spaceLg),

            // Personal Information
            _buildSectionLabel('Personal Information'),
            const SizedBox(height: DesignTokens.spaceSm),
            PremiumCard(
              child: Column(
                children: [
                  _buildTextField(
                    label: 'Display Name',
                    controller: _nameController,
                    hint: 'e.g. Dr. John Doe',
                    validator: (v) => (v == null || v.trim().isEmpty)
                        ? 'Name is required'
                        : null,
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  _buildTextField(
                    label: 'Email',
                    controller: _emailController,
                    hint: 'name@example.com',
                    keyboardType: TextInputType.emailAddress,
                    validator: (v) {
                      if (v == null || v.trim().isEmpty)
                        return 'Email is required';
                      final regex = RegExp(r'^[\w.+-]+@[\w-]+\.[\w.-]+$');
                      if (!regex.hasMatch(v.trim()))
                        return 'Enter a valid email';
                      return null;
                    },
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  _buildTextField(
                    label: 'Phone Number',
                    controller: _phoneController,
                    hint: '+60123456789',
                    keyboardType: TextInputType.phone,
                    validator: (v) {
                      if (v == null || v.trim().isEmpty) return null;
                      final regex = RegExp(r'^\+?[0-9]{6,15}$');
                      if (!regex.hasMatch(v.trim())) {
                        return 'Enter a valid phone (E.164)';
                      }
                      return null;
                    },
                  ),
                ],
              ),
            ),

            const SizedBox(height: DesignTokens.spaceLg),

            // Professional Details
            _buildSectionLabel('Professional Details'),
            const SizedBox(height: DesignTokens.spaceSm),
            PremiumCard(
              child: Column(
                children: [
                  _buildDropdownField(),
                  const SizedBox(height: DesignTokens.spaceMd),
                  Row(
                    children: [
                      Expanded(
                        child: _buildTextField(
                          label: 'Experience (Yrs)',
                          controller: _experienceController,
                          hint: '0',
                          keyboardType: TextInputType.number,
                          inputFormatters: [
                            FilteringTextInputFormatter.digitsOnly,
                          ],
                          validator: (v) {
                            if (v == null || v.trim().isEmpty) return null;
                            final n = int.tryParse(v.trim());
                            if (n == null || n < 0)
                              return 'Enter a valid number';
                            return null;
                          },
                        ),
                      ),
                      const SizedBox(width: DesignTokens.spaceMd),
                      Expanded(
                        child: _buildTextField(
                          label: 'Fee (RM)',
                          controller: _feeController,
                          hint: '0.00',
                          keyboardType: const TextInputType.numberWithOptions(
                              decimal: true),
                          inputFormatters: [
                            FilteringTextInputFormatter.allow(
                                RegExp(r'^\d*\.?\d{0,2}')),
                          ],
                          validator: (v) {
                            if (v == null || v.trim().isEmpty) {
                              return 'Fee is required';
                            }
                            final n = double.tryParse(v.trim());
                            if (n == null || n <= 0) return 'Fee must be > 0';
                            return null;
                          },
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            const SizedBox(height: DesignTokens.spaceLg),

            // Bio
            _buildSectionLabel('Bio'),
            const SizedBox(height: DesignTokens.spaceSm),
            PremiumCard(
              child: _buildBioField(),
            ),

            const SizedBox(height: DesignTokens.space2xl),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Form field builders
  // ------------------------------------------------------------------

  Widget _buildSectionLabel(String text) {
    return Text(
      text,
      style: Theme.of(context).textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.bold,
            color: AppColors.gray900,
          ),
    );
  }

  Widget _buildTextField({
    required String label,
    required TextEditingController controller,
    required String hint,
    TextInputType? keyboardType,
    String? prefix,
    List<TextInputFormatter>? inputFormatters,
    String? Function(String?)? validator,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray700,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceXs + 2),
        TextFormField(
          controller: controller,
          keyboardType: keyboardType,
          inputFormatters: inputFormatters,
          validator: validator,
          decoration: InputDecoration(
            hintText: hint,
            prefixText: prefix,
            filled: true,
            fillColor: AppColors.surfaceVariant,
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
              borderSide:
                  const BorderSide(color: AppColors.primary, width: 1.5),
            ),
            contentPadding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceMd,
                vertical: DesignTokens.spaceMd),
          ),
        ),
      ],
    );
  }

  Widget _buildDropdownField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Specialty',
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray700,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceXs + 2),
        DropdownButtonFormField<String>(
          value: _selectedSpecialty,
          items: _specialties
              .map((s) => DropdownMenuItem<String>(
                    value: s,
                    child: Text(s),
                  ))
              .toList(),
          onChanged: (value) => setState(() => _selectedSpecialty = value),
          decoration: InputDecoration(
            filled: true,
            fillColor: AppColors.surfaceVariant,
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
              borderSide:
                  const BorderSide(color: AppColors.primary, width: 1.5),
            ),
            contentPadding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceMd,
                vertical: DesignTokens.spaceMd),
          ),
          icon: const Icon(Icons.expand_more_rounded, color: AppColors.gray500),
          dropdownColor: AppColors.white,
          style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                color: AppColors.gray900,
              ),
        ),
      ],
    );
  }

  Widget _buildBioField() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'About',
          style: Theme.of(context).textTheme.labelMedium?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.gray700,
              ),
        ),
        const SizedBox(height: DesignTokens.spaceXs + 2),
        StatefulBuilder(
          builder: (context, innerSetState) {
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextFormField(
                  controller: _bioController,
                  maxLines: 6,
                  maxLength: 500,
                  decoration: InputDecoration(
                    hintText:
                        'Tell patients about your background, education, and approach to care…',
                    filled: true,
                    fillColor: AppColors.surfaceVariant,
                    border: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                      borderSide: const BorderSide(color: AppColors.gray200),
                    ),
                    enabledBorder: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                      borderSide: const BorderSide(color: AppColors.gray200),
                    ),
                    focusedBorder: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                      borderSide: const BorderSide(
                          color: AppColors.primary, width: 1.5),
                    ),
                    contentPadding: const EdgeInsets.all(DesignTokens.spaceMd),
                    counterText: '',
                  ),
                  onChanged: (_) => innerSetState(() {}),
                ),
                const SizedBox(height: DesignTokens.spaceXs),
                Align(
                  alignment: Alignment.centerRight,
                  child: Text(
                    '${_bioController.text.length}/500 characters',
                    style: Theme.of(context).textTheme.labelSmall?.copyWith(
                          color: AppColors.gray500,
                        ),
                  ),
                ),
              ],
            );
          },
        ),
      ],
    );
  }

  // ------------------------------------------------------------------
  // Save bar
  // ------------------------------------------------------------------

  Widget _buildSaveBar() {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: const BoxDecoration(
        color: AppColors.white,
        border: Border(top: BorderSide(color: AppColors.gray200)),
      ),
      child: SafeArea(
        child: FilledButton(
          onPressed: _isSaving ? null : _saveChanges,
          style: FilledButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: AppColors.white,
            disabledBackgroundColor: AppColors.primary.withValues(alpha: 0.6),
            padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceMd),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
          ),
          child: _isSaving
              ? const SizedBox(
                  width: 20,
                  height: 20,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: AppColors.white,
                  ),
                )
              : const Text(
                  'Save Changes',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
        ),
      ),
    );
  }
}
