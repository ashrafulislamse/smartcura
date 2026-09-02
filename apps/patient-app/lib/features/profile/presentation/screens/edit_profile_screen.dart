import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/profile_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/loading_overlay.dart';
import '../../../../core/widgets/premium_card.dart';

/// Edit Profile Screen
///
/// Pre-fills the form from [currentProfileProvider] and on save calls
/// [UpdateProfileNotifier.update] (PATCH /profiles/me) with the changed
/// fields: display name, phone, preferred locale, and timezone.
class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  late TextEditingController _nameController;
  late TextEditingController _phoneController;
  late TextEditingController _emailController;
  late TextEditingController _localeController;
  late TextEditingController _timezoneController;

  bool _controllersReady = false;
  bool _isSaving = false;

  @override
  void dispose() {
    if (_controllersReady) {
      _nameController.dispose();
      _phoneController.dispose();
      _emailController.dispose();
      _localeController.dispose();
      _timezoneController.dispose();
    }
    super.dispose();
  }

  void _initControllers(Profile profile) {
    if (_controllersReady) return;
    _nameController = TextEditingController(text: profile.displayName);
    _phoneController = TextEditingController(text: profile.phoneE164 ?? '');
    _emailController = TextEditingController(text: profile.email);
    _localeController = TextEditingController(text: profile.preferredLocale);
    _timezoneController = TextEditingController(text: profile.timezone);
    _controllersReady = true;
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    HapticFeedback.lightImpact();
    setState(() => _isSaving = true);

    await ref.read(updateProfileProvider.notifier).update(
          displayName: _nameController.text.trim(),
          phoneE164: _phoneController.text.trim().isEmpty
              ? null
              : _phoneController.text.trim(),
          preferredLocale: _localeController.text.trim(),
          timezone: _timezoneController.text.trim(),
        );

    final state = ref.read(updateProfileProvider);
    if (mounted) setState(() => _isSaving = false);

    if (state is AsyncData && mounted) {
      // Refresh the auth profile so the profile screen sees the update.
      await ref.read(authProvider.notifier).refreshProfile();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profile updated successfully'),
          backgroundColor: AppColors.success,
        ),
      );
      if (mounted) context.pop();
    } else if (state is AsyncError && mounted) {
      final err = state.error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
              err is ApiError ? err.userMessage : 'Failed to update profile'),
          backgroundColor: AppColors.error,
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(currentProfileProvider);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: Stack(
          children: [
            if (profile == null)
              const Center(
                  child: CircularProgressIndicator(color: AppColors.primary))
            else
              _buildBody(profile),
            if (_isSaving) const LoadingOverlay(message: 'Saving…'),
          ],
        ),
      ),
    );
  }

  Widget _buildBody(Profile profile) {
    _initControllers(profile);

    return Column(
      children: [
        _buildHeader(),
        Expanded(
          child: SingleChildScrollView(
            physics: const BouncingScrollPhysics(),
            child: Padding(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              child: Form(
                key: _formKey,
                child: Column(
                  children: [
                    _buildPhotoSection(profile),
                    const SizedBox(height: DesignTokens.spaceLg),
                    _buildPersonalInfoSection(),
                    const SizedBox(height: DesignTokens.spaceLg),
                    _buildPreferencesSection(),
                    const SizedBox(height: 100),
                  ],
                ),
              ),
            ),
          ),
        ),
        _buildSaveButton(),
      ],
    );
  }

  Widget _buildHeader() {
    return Container(
      color: AppColors.background,
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.screenPaddingHorizontal, vertical: 12),
          child: Row(
            children: [
              IconButton(
                onPressed: () => context.pop(),
                icon: const Icon(Icons.close, size: 24),
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                color: AppColors.textSecondary,
              ),
              const Expanded(
                child: Text(
                  'Edit Details',
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
              ),
              const SizedBox(width: 40),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildPhotoSection(Profile profile) {
    final uploadState = ref.watch(uploadAvatarProvider);
    final removeState = ref.watch(removeAvatarProvider);
    final isLoading =
        uploadState is AsyncLoading || removeState is AsyncLoading;
    final hasAvatar =
        profile.avatarUrl != null && profile.avatarUrl!.isNotEmpty;

    return Column(
      children: [
        Stack(
          alignment: Alignment.center,
          children: [
            GestureDetector(
              onTap: isLoading ? null : () => _showAvatarOptions(profile),
              child: AvatarWidget(
                imageUrl: profile.avatarUrl,
                name: profile.displayName,
                size: 112,
              ),
            ),
            if (isLoading)
              Container(
                width: 112,
                height: 112,
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.4),
                  shape: BoxShape.circle,
                ),
                child: const CircularProgressIndicator(
                  color: Colors.white,
                  strokeWidth: 2,
                ),
              ),
          ],
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        TextButton(
          onPressed: isLoading ? null : () => _showAvatarOptions(profile),
          style: TextButton.styleFrom(
            foregroundColor: AppColors.primary,
            disabledForegroundColor: AppColors.textDisabled,
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(
                isLoading ? Icons.hourglass_top : Icons.photo_camera_outlined,
                size: 16,
                color: isLoading ? AppColors.textDisabled : AppColors.primary,
              ),
              const SizedBox(width: 6),
              Text(
                isLoading
                    ? 'Updating photo…'
                    : (hasAvatar ? 'Change photo' : 'Add photo'),
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: isLoading ? AppColors.textDisabled : AppColors.primary,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  void _showAvatarOptions(Profile profile) {
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading:
                    const Icon(Icons.photo_library, color: AppColors.primary),
                title: const Text('Choose from gallery'),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickAndUpload(ImageSource.gallery);
                },
              ),
              ListTile(
                leading: const Icon(Icons.camera_alt, color: AppColors.primary),
                title: const Text('Take photo'),
                onTap: () {
                  Navigator.pop(ctx);
                  _pickAndUpload(ImageSource.camera);
                },
              ),
              if (profile.avatarUrl != null && profile.avatarUrl!.isNotEmpty)
                ListTile(
                  leading: const Icon(Icons.delete, color: AppColors.error),
                  title: const Text('Remove photo'),
                  onTap: () {
                    Navigator.pop(ctx);
                    _removePhoto();
                  },
                ),
              ListTile(
                leading:
                    const Icon(Icons.cancel, color: AppColors.textSecondary),
                title: const Text('Cancel'),
                onTap: () => Navigator.pop(ctx),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _pickAndUpload(ImageSource source) async {
    await ref.read(uploadAvatarProvider.notifier).pickAndUpload(source);
    final state = ref.read(uploadAvatarProvider);
    if (!mounted) return;

    if (state is AsyncError) {
      final err = state.error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            err is ApiError ? err.userMessage : 'Failed to upload photo',
          ),
          backgroundColor: AppColors.error,
        ),
      );
    } else if (state is AsyncData && state.value != null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profile photo updated'),
          backgroundColor: AppColors.success,
        ),
      );
    }
  }

  Future<void> _removePhoto() async {
    await ref.read(removeAvatarProvider.notifier).remove();
    final state = ref.read(removeAvatarProvider);
    if (!mounted) return;

    if (state is AsyncError) {
      final err = state.error;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            err is ApiError ? err.userMessage : 'Failed to remove photo',
          ),
          backgroundColor: AppColors.error,
        ),
      );
    } else if (state is AsyncData) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Profile photo removed'),
          backgroundColor: AppColors.success,
        ),
      );
    }
  }

  Widget _buildPersonalInfoSection() {
    return PremiumCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.person, color: AppColors.primary, size: 20),
              SizedBox(width: DesignTokens.spaceSm),
              Text(
                'Personal Information',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildField(
            label: 'FULL NAME',
            controller: _nameController,
            required: true,
            validator: (v) =>
                (v == null || v.trim().isEmpty) ? 'Name is required' : null,
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildField(
            label: 'CONTACT NUMBER',
            controller: _phoneController,
            keyboardType: TextInputType.phone,
            hint: '+1 555 123 4567',
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildField(
            label: 'EMAIL ADDRESS',
            controller: _emailController,
            keyboardType: TextInputType.emailAddress,
            readOnly: true,
            hint: 'Email cannot be changed here',
          ),
        ],
      ),
    );
  }

  Widget _buildPreferencesSection() {
    return PremiumCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.tune, color: AppColors.primary, size: 20),
              SizedBox(width: DesignTokens.spaceSm),
              Text(
                'Preferences',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildField(
            label: 'PREFERRED LOCALE',
            controller: _localeController,
            hint: 'e.g. en, ms, zh',
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          _buildField(
            label: 'TIMEZONE',
            controller: _timezoneController,
            hint: 'e.g. Asia/Kuala_Lumpur',
          ),
        ],
      ),
    );
  }

  Widget _buildField({
    required String label,
    required TextEditingController controller,
    bool required = false,
    bool readOnly = false,
    IconData? suffixIcon,
    int maxLines = 1,
    String? hint,
    TextInputType? keyboardType,
    String? Function(String?)? validator,
  }) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(
              label,
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
                letterSpacing: 0.5,
              ),
            ),
            if (required)
              const Text(' *',
                  style: TextStyle(fontSize: 12, color: AppColors.error)),
          ],
        ),
        const SizedBox(height: 6),
        TextFormField(
          controller: controller,
          readOnly: readOnly,
          maxLines: maxLines,
          keyboardType: keyboardType,
          validator: validator,
          decoration: InputDecoration(
            hintText: hint,
            hintStyle: const TextStyle(color: AppColors.textDisabled),
            filled: true,
            fillColor: AppColors.gray50,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.gray200),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.gray200),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.primary),
            ),
            disabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(12),
              borderSide: const BorderSide(color: AppColors.gray200),
            ),
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            suffixIcon: suffixIcon != null
                ? Icon(suffixIcon,
                    color: AppColors.primary.withOpacity(0.7), size: 18)
                : null,
          ),
          style: TextStyle(
            fontSize: 15,
            color: readOnly ? AppColors.textSecondary : AppColors.textPrimary,
          ),
        ),
      ],
    );
  }

  Widget _buildSaveButton() {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface.withOpacity(0.8),
        border: const Border(top: BorderSide(color: AppColors.gray200)),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          child: SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _isSaving ? null : _save,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                foregroundColor: AppColors.white,
                disabledBackgroundColor: AppColors.primary.withOpacity(0.5),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                elevation: 0,
              ),
              child: _isSaving
                  ? const SizedBox(
                      height: 20,
                      width: 20,
                      child: CircularProgressIndicator(
                        strokeWidth: 2,
                        valueColor:
                            AlwaysStoppedAnimation<Color>(AppColors.white),
                      ),
                    )
                  : const Text(
                      'Save Changes',
                      style:
                          TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                    ),
            ),
          ),
        ),
      ),
    );
  }
}
