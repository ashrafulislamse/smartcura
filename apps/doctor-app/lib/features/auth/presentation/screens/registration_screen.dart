import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/auth/firebase_initializer.dart';
import '../../../../core/constants/app_constants.dart';
import '../../../../core/network/api_client.dart';
import '../../../../core/providers/verification_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/premium_card.dart';
import '../../../../core/widgets/smartcura_logo.dart';

/// Doctor Registration Screen — multi-step real registration.
///
/// Converted to [ConsumerStatefulWidget]. The submit flow:
///  1. Firebase `createUserWithEmailAndPassword` + `POST /sessions`
///     (via `authProvider.notifier.signUp`).
///  2. If `bootstrap_state` is `profile_required`: `PATCH /profiles/me`
///     with the display name and phone.
///  3. Upload the license photo: request an upload target, PUT the file
///     bytes to the presigned URL, then finalize the upload.
///  4. Navigate to `/verification-pending`.
///
/// Each step surfaces its own error; a progress overlay shows the current
/// step so the user understands the multi-phase nature of the operation.
class RegistrationScreen extends ConsumerStatefulWidget {
  const RegistrationScreen({super.key});

  @override
  ConsumerState<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends ConsumerState<RegistrationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _fullNameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _passwordController = TextEditingController();
  final _licenseController = TextEditingController();

  String? _selectedSpecialty;
  XFile? _licensePhoto;
  bool _obscurePassword = true;
  bool _agreeToTerms = false;
  bool _isSubmitting = false;
  String _currentStep = '';

  /// Predefined medical specialties. No backend endpoint exists for this
  /// list yet; when one is added it should replace this constant.
  static const List<String> _specialties = [
    'General Practice',
    'Cardiology',
    'Dermatology',
    'Emergency Medicine',
    'Endocrinology',
    'Gastroenterology',
    'Neurology',
    'Obstetrics & Gynecology',
    'Oncology',
    'Orthopedics',
    'Pediatrics',
    'Psychiatry',
    'Pulmonology',
    'Radiology',
    'Surgery',
    'Urology',
  ];

  @override
  void initState() {
    super.initState();
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
    );
  }

  @override
  void dispose() {
    _fullNameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _passwordController.dispose();
    _licenseController.dispose();
    super.dispose();
  }

  Future<void> _pickLicensePhoto() async {
    final picker = ImagePicker();
    final XFile? image = await picker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
    );
    if (image != null) {
      setState(() => _licensePhoto = image);
    }
  }

  InputDecoration _inputDecoration({
    required String label,
    required IconData icon,
    Widget? suffixIcon,
  }) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, color: AppColors.gray400, size: 22),
      suffixIcon: suffixIcon,
      filled: true,
      fillColor: AppColors.gray50,
      labelStyle: const TextStyle(
          color: AppColors.gray500, fontSize: 14, fontWeight: FontWeight.w500),
      hintStyle: const TextStyle(color: AppColors.gray400, fontSize: 14),
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
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
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        borderSide: const BorderSide(color: AppColors.error, width: 1.5),
      ),
      focusedErrorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        borderSide: const BorderSide(color: AppColors.error, width: 1.5),
      ),
    );
  }

  void _showError(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: AppColors.error,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 5),
      ),
    );
  }

  Future<void> _handleSubmit() async {
    if (!_formKey.currentState!.validate()) return;
    if (!_agreeToTerms) {
      _showError('Please agree to the Terms & Conditions and Privacy Policy.');
      return;
    }
    if (_licensePhoto == null) {
      _showError('Please upload your medical license photo.');
      return;
    }

    setState(() {
      _isSubmitting = true;
      _currentStep = 'Creating your account...';
    });

    try {
      // Step 1: Firebase sign-up + session bootstrap.
      final displayName = _fullNameController.text.trim();
      final email = _emailController.text.trim();
      final password = _passwordController.text;

      final success = await ref.read(authProvider.notifier).signUp(
            email: email,
            password: password,
            displayName: displayName,
          );

      if (!success) {
        final error =
            ref.read(authProvider).error ?? 'Account creation failed.';
        _showError(error);
        return;
      }

      final authState = ref.read(authProvider);
      final bootstrapState = authState.bootstrapState;

      // Step 2: Patch profile if the server says it's still required.
      if (bootstrapState == BootstrapState.profileRequired) {
        setState(() => _currentStep = 'Setting up your profile...');

        final apiClient = ref.read(apiClientProvider);
        final phone = _phoneController.text.trim();

        await apiClient.patch(
          ApiEndpoints.profilesMe,
          body: <String, dynamic>{
            'display_name': displayName,
            if (phone.isNotEmpty) 'phone_e164': phone,
          },
        );
      }

      // Step 3: Upload the license document.
      final memberships = authState.memberships;
      if (memberships == null || memberships.isEmpty) {
        // No membership to attach the document to — proceed to pending screen.
        _navigateToVerificationPending();
        return;
      }

      // Find the doctor membership.
      final doctorMembership = memberships.firstWhere(
        (m) => m.role == RoleId.doctor,
        orElse: () => memberships.first,
      );

      setState(() => _currentStep = 'Uploading your license...');

      final uploaded = await _uploadLicenseDocument(
        membershipId: doctorMembership.id,
      );

      if (!uploaded) return;

      // Step 4: Navigate to verification pending.
      _navigateToVerificationPending();
    } catch (e) {
      _showError('Registration failed: $e');
    } finally {
      if (mounted) {
        setState(() {
          _isSubmitting = false;
          _currentStep = '';
        });
      }
    }
  }

  Future<bool> _uploadLicenseDocument({
    required String membershipId,
  }) async {
    final photo = _licensePhoto;
    if (photo == null) return true; // No photo — skip upload.

    try {
      // Read file bytes and compute SHA-256.
      final bytes = await photo.readAsBytes();
      final hash = sha256.convert(bytes);
      final hexHash = hash.toString();
      final contentType = photo.mimeType ?? 'image/jpeg';

      // Request an upload target.
      final requestNotifier = ref.read(requestUploadTargetProvider.notifier);
      final requestSuccess = await requestNotifier(
        membershipId: membershipId,
        req: RequestVerificationUploadRequest(
          documentKind: VerificationDocumentKind.medicalLicense,
          contentType: contentType,
          byteSize: bytes.length,
          declaredSha256: hexHash,
        ),
      );

      if (!requestSuccess) {
        final error = ref.read(requestUploadTargetProvider).error;
        _showError(error?.displayMessage ??
            'Failed to request upload target for your license.');
        return false;
      }

      final uploadTarget = ref.read(requestUploadTargetProvider).value;
      if (uploadTarget == null) {
        _showError('Upload target response was empty.');
        return false;
      }

      // Upload the file bytes to the presigned URL.
      final uploadDio = Dio();
      final uploadUrl = uploadTarget.upload.url;
      final method = uploadTarget.upload.method.toUpperCase();
      final headers = <String, dynamic>{
        'Content-Type': contentType,
        ...uploadTarget.upload.requiredHeaders.map((k, v) => MapEntry(k, v)),
      };

      if (method == 'PUT') {
        await uploadDio.put(
          uploadUrl,
          data: Stream.fromIterable([bytes]),
          options: Options(
            headers: {
              ...headers,
              'Content-Length': bytes.length,
            },
            contentType: contentType,
          ),
        );
      } else {
        await uploadDio.request(
          uploadUrl,
          data: bytes,
          options: Options(
            method: method,
            headers: {
              ...headers,
              'Content-Length': bytes.length,
            },
            contentType: contentType,
          ),
        );
      }

      // Finalize the upload with the reported SHA-256.
      final documentId = uploadTarget.document.documentId;
      final finalizeNotifier = ref.read(finalizeUploadProvider.notifier);
      final finalizeSuccess = await finalizeNotifier(
        membershipId: membershipId,
        documentId: documentId,
        reportedSha256: hexHash,
      );

      if (!finalizeSuccess) {
        final error = ref.read(finalizeUploadProvider).error;
        _showError(
            error?.displayMessage ?? 'Failed to finalize your license upload.');
        return false;
      }

      return true;
    } on DioException catch (e) {
      _showError('License upload failed: ${e.message ?? e.toString()}');
      return false;
    } catch (e) {
      _showError('License upload failed: $e');
      return false;
    }
  }

  void _navigateToVerificationPending() {
    if (mounted) {
      // Refresh bootstrap to pick up the new verification status.
      ref.read(authProvider.notifier).bootstrap();
      context.go('/verification-pending');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Stack(
          children: [
            SingleChildScrollView(
              child: Column(
                children: [
                  _buildHeader(),
                  Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceLg,
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const SizedBox(height: DesignTokens.spaceLg),

                        // Firebase not configured warning
                        if (!firebaseConfigured) ...[
                          PremiumCard(
                            accent: AppColors.warning,
                            padding: const EdgeInsets.all(DesignTokens.spaceMd),
                            child: Row(
                              children: [
                                const Icon(
                                  Icons.cloud_off_rounded,
                                  color: AppColors.warningDark,
                                  size: DesignTokens.iconLg,
                                ),
                                const SizedBox(width: DesignTokens.spaceMd),
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        'Firebase Not Configured',
                                        style: TextStyle(
                                          fontSize: 15,
                                          fontWeight: FontWeight.w700,
                                          color: AppColors.warningDark,
                                        ),
                                      ),
                                      const SizedBox(height: 4),
                                      Text(
                                        'Registration requires Firebase '
                                        'Authentication. Contact your '
                                        'administrator to configure Firebase '
                                        'on this device.',
                                        style: TextStyle(
                                          fontSize: 13,
                                          color: AppColors.gray600,
                                          height: 1.4,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(height: DesignTokens.spaceLg),
                        ],

                        // Registration form
                        PremiumCard(
                          padding: const EdgeInsets.all(DesignTokens.spaceLg),
                          child: Form(
                            key: _formKey,
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.stretch,
                              children: [
                                // Title
                                Text(
                                  'Create Your Account',
                                  style: TextStyle(
                                    fontSize: 24,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.gray900,
                                    letterSpacing: -0.5,
                                  ),
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Verify your credentials to join our '
                                  'professional network',
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: AppColors.gray500,
                                  ),
                                ),
                                const SizedBox(height: DesignTokens.spaceXl),

                                // Account section label
                                _sectionLabel('Account Details'),
                                const SizedBox(height: DesignTokens.spaceMd),

                                // Full Name
                                TextFormField(
                                  controller: _fullNameController,
                                  enabled: !_isSubmitting,
                                  textCapitalization: TextCapitalization.words,
                                  textInputAction: TextInputAction.next,
                                  decoration: _inputDecoration(
                                    label: 'Full Name',
                                    icon: Icons.person_outline,
                                  ),
                                  validator: (v) {
                                    if (v == null || v.trim().isEmpty) {
                                      return 'Please enter your full name';
                                    }
                                    if (v.trim().length < 2) {
                                      return 'Name must be at least 2 characters';
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: DesignTokens.spaceMd),

                                // Email
                                TextFormField(
                                  controller: _emailController,
                                  enabled: !_isSubmitting,
                                  keyboardType: TextInputType.emailAddress,
                                  textInputAction: TextInputAction.next,
                                  decoration: _inputDecoration(
                                    label: 'Email Address',
                                    icon: Icons.email_outlined,
                                  ),
                                  validator: (v) {
                                    if (v == null || v.trim().isEmpty) {
                                      return 'Please enter your email';
                                    }
                                    if (!v.contains('@') || !v.contains('.')) {
                                      return 'Please enter a valid email';
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: DesignTokens.spaceMd),

                                // Phone
                                TextFormField(
                                  controller: _phoneController,
                                  enabled: !_isSubmitting,
                                  keyboardType: TextInputType.phone,
                                  textInputAction: TextInputAction.next,
                                  decoration: _inputDecoration(
                                    label: 'Phone Number',
                                    icon: Icons.phone_outlined,
                                  ),
                                  validator: (v) {
                                    if (v == null || v.trim().isEmpty) {
                                      return 'Please enter your phone number';
                                    }
                                    if (v.trim().length < 7) {
                                      return 'Please enter a valid phone number';
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: DesignTokens.spaceMd),

                                // Password
                                TextFormField(
                                  controller: _passwordController,
                                  enabled: !_isSubmitting,
                                  obscureText: _obscurePassword,
                                  textInputAction: TextInputAction.next,
                                  decoration: _inputDecoration(
                                    label: 'Password',
                                    icon: Icons.lock_outline,
                                    suffixIcon: IconButton(
                                      icon: Icon(
                                        _obscurePassword
                                            ? Icons.visibility_outlined
                                            : Icons.visibility_off_outlined,
                                        color: AppColors.gray400,
                                        size: 20,
                                      ),
                                      onPressed: () {
                                        setState(() {
                                          _obscurePassword = !_obscurePassword;
                                        });
                                      },
                                    ),
                                  ),
                                  validator: (v) {
                                    if (v == null || v.isEmpty) {
                                      return 'Please enter a password';
                                    }
                                    if (v.length < 8) {
                                      return 'Password must be at least 8 characters';
                                    }
                                    return null;
                                  },
                                ),

                                const SizedBox(height: DesignTokens.spaceXl),

                                // Professional section label
                                _sectionLabel('Professional Credentials'),
                                const SizedBox(height: DesignTokens.spaceMd),

                                // License Number
                                TextFormField(
                                  controller: _licenseController,
                                  enabled: !_isSubmitting,
                                  textCapitalization:
                                      TextCapitalization.characters,
                                  textInputAction: TextInputAction.next,
                                  decoration: _inputDecoration(
                                    label: 'Medical License #',
                                    icon: Icons.badge_outlined,
                                  ),
                                  validator: (v) {
                                    if (v == null || v.trim().isEmpty) {
                                      return 'Please enter your medical license number';
                                    }
                                    return null;
                                  },
                                ),
                                const SizedBox(height: DesignTokens.spaceMd),

                                // Specialty Dropdown
                                DropdownButtonFormField<String>(
                                  value: _selectedSpecialty,
                                  decoration: _inputDecoration(
                                    label: 'Specialty',
                                    icon: Icons.medical_services_outlined,
                                  ),
                                  items: _specialties
                                      .map((s) => DropdownMenuItem(
                                            value: s,
                                            child: Text(s),
                                          ))
                                      .toList(),
                                  onChanged: _isSubmitting
                                      ? null
                                      : (v) => setState(
                                          () => _selectedSpecialty = v),
                                  validator: (v) => v == null
                                      ? 'Please select your specialty'
                                      : null,
                                ),
                                const SizedBox(height: DesignTokens.spaceLg),

                                // License Photo Upload
                                Text(
                                  'Medical License Photo',
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w500,
                                    color: AppColors.gray900,
                                  ),
                                ),
                                const SizedBox(height: DesignTokens.spaceSm),
                                GestureDetector(
                                  onTap:
                                      _isSubmitting ? null : _pickLicensePhoto,
                                  child: Container(
                                    height: 140,
                                    decoration: BoxDecoration(
                                      color: AppColors.gray50,
                                      border: Border.all(
                                        color: _licensePhoto == null
                                            ? AppColors.gray200
                                            : AppColors.primary,
                                        width: 2,
                                      ),
                                      borderRadius: BorderRadius.circular(
                                        DesignTokens.radiusMd,
                                      ),
                                    ),
                                    child: _licensePhoto != null
                                        ? ClipRRect(
                                            borderRadius: BorderRadius.circular(
                                              DesignTokens.radiusMd,
                                            ),
                                            child: Image.file(
                                              File(_licensePhoto!.path),
                                              fit: BoxFit.cover,
                                            ),
                                          )
                                        : Center(
                                            child: Column(
                                              mainAxisAlignment:
                                                  MainAxisAlignment.center,
                                              children: [
                                                const Icon(
                                                  Icons.add_a_photo_rounded,
                                                  size: 36,
                                                  color: AppColors.primary,
                                                ),
                                                const SizedBox(
                                                    height:
                                                        DesignTokens.spaceSm),
                                                Text(
                                                  'Tap to upload license photo',
                                                  style: TextStyle(
                                                    fontSize: 14,
                                                    color: AppColors.gray500,
                                                  ),
                                                ),
                                                const SizedBox(height: 4),
                                                Text(
                                                  'JPG or PNG, max 5 MB',
                                                  style: TextStyle(
                                                    fontSize: 12,
                                                    color: AppColors.gray400,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                  ),
                                ),
                                if (_licensePhoto != null) ...[
                                  const SizedBox(height: DesignTokens.spaceSm),
                                  Align(
                                    alignment: Alignment.centerRight,
                                    child: TextButton.icon(
                                      onPressed: _isSubmitting
                                          ? null
                                          : () => setState(
                                              () => _licensePhoto = null),
                                      icon: const Icon(Icons.close, size: 18),
                                      label: const Text('Remove photo'),
                                      style: TextButton.styleFrom(
                                        foregroundColor: AppColors.error,
                                      ),
                                    ),
                                  ),
                                ],

                                const SizedBox(height: DesignTokens.spaceLg),

                                // Terms Checkbox
                                Row(
                                  children: [
                                    SizedBox(
                                      width: 24,
                                      height: 24,
                                      child: Checkbox(
                                        value: _agreeToTerms,
                                        onChanged: _isSubmitting
                                            ? null
                                            : (v) => setState(() =>
                                                _agreeToTerms = v ?? false),
                                        activeColor: AppColors.primary,
                                        shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.circular(4),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: DesignTokens.spaceSm),
                                    Expanded(
                                      child: Text(
                                        'I agree to the Terms & Conditions and '
                                        'Privacy Policy',
                                        style: TextStyle(
                                          fontSize: 13,
                                          color: AppColors.gray700,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),

                                const SizedBox(height: DesignTokens.spaceXl),

                                // Submit Button
                                SizedBox(
                                  width: double.infinity,
                                  height: DesignTokens.buttonHeightLg,
                                  child: ElevatedButton(
                                    onPressed:
                                        (_isSubmitting || !firebaseConfigured)
                                            ? null
                                            : _handleSubmit,
                                    style: ElevatedButton.styleFrom(
                                      backgroundColor: AppColors.primary,
                                      foregroundColor: AppColors.white,
                                      disabledBackgroundColor:
                                          AppColors.gray200,
                                      disabledForegroundColor:
                                          AppColors.gray400,
                                      elevation: 0,
                                      shape: RoundedRectangleBorder(
                                        borderRadius: BorderRadius.circular(
                                          DesignTokens.radiusMd,
                                        ),
                                      ),
                                    ),
                                    child: _isSubmitting
                                        ? Row(
                                            mainAxisAlignment:
                                                MainAxisAlignment.center,
                                            children: [
                                              const SizedBox(
                                                width: 20,
                                                height: 20,
                                                child:
                                                    CircularProgressIndicator(
                                                  strokeWidth: 2,
                                                  valueColor:
                                                      AlwaysStoppedAnimation<
                                                          Color>(
                                                    AppColors.white,
                                                  ),
                                                ),
                                              ),
                                              const SizedBox(
                                                  width: DesignTokens.spaceSm),
                                              Expanded(
                                                child: Text(
                                                  _currentStep.isNotEmpty
                                                      ? _currentStep
                                                      : 'Submitting...',
                                                  style: const TextStyle(
                                                    fontSize: 15,
                                                    fontWeight: FontWeight.w600,
                                                  ),
                                                  overflow:
                                                      TextOverflow.ellipsis,
                                                ),
                                              ),
                                            ],
                                          )
                                        : const Text(
                                            'Submit for Verification',
                                            style: TextStyle(
                                              fontSize: 16,
                                              fontWeight: FontWeight.w700,
                                            ),
                                          ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),

                        const SizedBox(height: DesignTokens.spaceMd),

                        // Login Link
                        Center(
                          child: TextButton(
                            onPressed: _isSubmitting
                                ? null
                                : () => Navigator.pop(context),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(
                                  'Already have an account? ',
                                  style: TextStyle(
                                    fontSize: 14,
                                    color: AppColors.gray500,
                                  ),
                                ),
                                Text(
                                  'Log in',
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.primary,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),

                        const SizedBox(height: DesignTokens.space2xl),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            // Submission progress overlay
            if (_isSubmitting)
              Container(
                color: AppColors.overlayLight,
                child: Center(
                  child: PremiumCard(
                    padding: const EdgeInsets.all(DesignTokens.spaceXl),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const SizedBox(
                          width: 40,
                          height: 40,
                          child: CircularProgressIndicator(
                            strokeWidth: 3,
                            color: AppColors.primary,
                          ),
                        ),
                        const SizedBox(height: DesignTokens.spaceLg),
                        Text(
                          _currentStep.isNotEmpty
                              ? _currentStep
                              : 'Processing...',
                          style: TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w600,
                            color: AppColors.gray900,
                          ),
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: DesignTokens.spaceSm),
                        Text(
                          'Please do not close the app during registration.',
                          style: TextStyle(
                            fontSize: 13,
                            color: AppColors.gray500,
                          ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.only(
        top: DesignTokens.space2xl,
        bottom: DesignTokens.space2xl + 8,
      ),
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [AppColors.primary, AppColors.primaryDark],
        ),
        borderRadius: BorderRadius.only(
          bottomLeft: Radius.circular(DesignTokens.radius3xl),
          bottomRight: Radius.circular(DesignTokens.radius3xl),
        ),
      ),
      child: Column(
        children: [
          // Logo
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.12),
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              border: Border.all(
                color: Colors.white.withOpacity(0.2),
                width: 1.5,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.white.withOpacity(0.1),
                  blurRadius: 20,
                  spreadRadius: 2,
                ),
              ],
            ),
            child: const SmartCuraLogo(size: 46),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            AppConstants.appName,
            style: const TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w800,
              color: AppColors.white,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 4),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.15),
              borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            ),
            child: Text(
              'Doctor Registration',
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: Colors.white.withOpacity(0.9),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _sectionLabel(String text) {
    return Row(
      children: [
        Container(
          width: 4,
          height: 16,
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(2),
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Text(
          text,
          style: TextStyle(
            fontSize: 15,
            fontWeight: FontWeight.w700,
            color: AppColors.gray900,
          ),
        ),
      ],
    );
  }
}
