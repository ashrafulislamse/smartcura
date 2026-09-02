import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/auth/firebase_initializer.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/premium_card.dart';
import '../../../../core/widgets/smartcura_logo.dart';

/// Forgot Password Screen — real Firebase password reset.
///
/// Calls `ref.read(authProvider.notifier).sendPasswordReset(email)` which
/// delegates to `FirebaseAuth.sendPasswordResetEmail`. No session is created.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();

  bool _isLoading = false;
  bool _emailSent = false;

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
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _handleSendResetLink() async {
    if (!_formKey.currentState!.validate()) return;

    ref.read(authProvider.notifier).clearError();

    setState(() => _isLoading = true);

    final success = await ref
        .read(authProvider.notifier)
        .sendPasswordReset(_emailController.text.trim());

    if (!mounted) return;
    setState(() => _isLoading = false);

    if (success) {
      setState(() => _emailSent = true);
    } else {
      final error =
          ref.read(authProvider).error ?? 'Failed to send reset email.';
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(error),
          backgroundColor: AppColors.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  void _handleBackToLogin() {
    context.go('/login');
  }

  void _handleResend() {
    setState(() => _emailSent = false);
    _handleSendResetLink();
  }

  InputDecoration _inputDecoration({
    required String label,
    required IconData icon,
  }) {
    return InputDecoration(
      labelText: label,
      prefixIcon: Icon(icon, color: AppColors.gray400, size: 22),
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

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            _buildHeader(),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(DesignTokens.spaceLg),
                child: Column(
                  children: [
                    const SizedBox(height: DesignTokens.spaceXl),

                    // Firebase not configured.
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
                                crossAxisAlignment: CrossAxisAlignment.start,
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
                                    'Password reset requires Firebase '
                                    'Authentication. Contact your '
                                    'administrator.',
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

                    if (_emailSent) _buildSuccessState() else _buildFormState(),

                    const SizedBox(height: DesignTokens.spaceXl),

                    TextButton(
                      onPressed: _handleBackToLogin,
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          const Icon(Icons.arrow_back_rounded, size: 18),
                          const SizedBox(width: 6),
                          Text(
                            'Back to Log In',
                            style: TextStyle(
                              color: AppColors.primary,
                              fontWeight: FontWeight.w600,
                              fontSize: 14,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
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
        top: DesignTokens.spaceXl,
        bottom: DesignTokens.spaceXl,
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
          Align(
            alignment: Alignment.centerLeft,
            child: Padding(
              padding: const EdgeInsets.only(left: DesignTokens.spaceSm),
              child: IconButton(
                icon: const Icon(
                  Icons.arrow_back_rounded,
                  color: AppColors.white,
                ),
                onPressed: () => Navigator.pop(context),
              ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.12),
              shape: BoxShape.circle,
              border: Border.all(
                color: Colors.white.withOpacity(0.2),
                width: 1.5,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.white.withOpacity(0.1),
                  blurRadius: 16,
                  spreadRadius: 2,
                ),
              ],
            ),
            child: const Icon(
              Icons.lock_reset_rounded,
              size: 32,
              color: AppColors.white,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            'Forgot Password',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: AppColors.white,
              letterSpacing: -0.3,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFormState() {
    return PremiumCard(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Reset Your Password',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.w800,
                color: AppColors.gray900,
                letterSpacing: -0.3,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: DesignTokens.spaceSm),
            Text(
              'Enter your registered email address and we\'ll send '
              'you instructions to reset your password.',
              style: TextStyle(
                fontSize: 14,
                color: AppColors.gray500,
                height: 1.5,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: DesignTokens.spaceXl),

            TextFormField(
              controller: _emailController,
              enabled: !_isLoading && firebaseConfigured,
              keyboardType: TextInputType.emailAddress,
              decoration: _inputDecoration(
                label: 'Email Address',
                icon: Icons.email_outlined,
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Please enter your email';
                }
                if (!value.contains('@') || !value.contains('.')) {
                  return 'Please enter a valid email';
                }
                return null;
              },
            ),

            const SizedBox(height: DesignTokens.spaceLg),

            SizedBox(
              width: double.infinity,
              height: DesignTokens.buttonHeightLg,
              child: ElevatedButton(
                onPressed: (_isLoading || !firebaseConfigured)
                    ? null
                    : _handleSendResetLink,
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.primary,
                  foregroundColor: AppColors.white,
                  disabledBackgroundColor: AppColors.gray200,
                  disabledForegroundColor: AppColors.gray400,
                  elevation: 0,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(
                      DesignTokens.radiusMd,
                    ),
                  ),
                ),
                child: _isLoading
                    ? Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              valueColor: AlwaysStoppedAnimation<Color>(
                                AppColors.white,
                              ),
                            ),
                          ),
                          const SizedBox(width: 10),
                          const Text(
                            'Sending...',
                            style: TextStyle(
                              fontSize: 15,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      )
                    : const Text(
                        'Send Reset Link',
                        style: TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
              ),
            ),

            const SizedBox(height: DesignTokens.spaceLg),

            // Info card.
            Container(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              decoration: BoxDecoration(
                color: AppColors.primaryContainer.withOpacity(0.3),
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(
                        Icons.info_outline_rounded,
                        size: 18,
                        color: AppColors.primaryDark,
                      ),
                      const SizedBox(width: 8),
                      const Text(
                        'How it works:',
                        style: TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.primaryDark,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  _buildStep('Enter your registered email'),
                  _buildStep('Check your inbox for a reset link'),
                  _buildStep('Click the link in the email'),
                  _buildStep('Create a new password'),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSuccessState() {
    return PremiumCard(
      accent: AppColors.secondary,
      padding: const EdgeInsets.all(DesignTokens.spaceXl),
      child: Column(
        children: [
          Container(
            width: 72,
            height: 72,
            decoration: BoxDecoration(
              color: AppColors.successContainer,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.mark_email_read_rounded,
              size: 36,
              color: AppColors.successDark,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          Text(
            'Check Your Email',
            style: TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w800,
              color: AppColors.gray900,
              letterSpacing: -0.3,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            'We\'ve sent password reset instructions to\n${_emailController.text.trim()}',
            style: TextStyle(
              fontSize: 14,
              color: AppColors.gray500,
              height: 1.5,
            ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: DesignTokens.spaceXl),
          SizedBox(
            width: double.infinity,
            height: DesignTokens.buttonHeightMd,
            child: TextButton(
              onPressed: _handleResend,
              style: TextButton.styleFrom(
                foregroundColor: AppColors.primary,
              ),
              child: const Text(
                'Resend Email',
                style: TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStep(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Padding(
            padding: EdgeInsets.only(top: 2),
            child: Icon(
              Icons.check_circle_outline_rounded,
              size: 15,
              color: AppColors.primaryDark,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                fontSize: 13,
                color: AppColors.gray700,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
