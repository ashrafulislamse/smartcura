import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/auth/firebase_initializer.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Forgot password screen — sends a Firebase password-reset email.
///
/// The backend does not run an OTP reset flow for drivers, so the previous
/// fake OTP/phone steps are removed entirely. Submitting calls
/// `authProvider.notifier.sendPasswordReset(email)`, which delegates to
/// `FirebaseAuth.sendPasswordResetEmail`. On success the screen swaps the form
/// for a confirmation message and a "Back to Login" action.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  bool _loading = false;
  bool _sent = false;

  @override
  void dispose() {
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _sendResetLink() async {
    if (!_formKey.currentState!.validate()) return;
    HapticFeedback.lightImpact();
    ref.read(authProvider.notifier).clearError();
    setState(() => _loading = true);
    final ok = await ref
        .read(authProvider.notifier)
        .sendPasswordReset(_emailController.text.trim());
    if (!mounted) return;
    setState(() {
      _loading = false;
      if (ok) _sent = true;
    });
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: _loading ? null : () => context.go('/login'),
        ),
      ),
      body: Stack(
        children: [
          const AuthBackgroundDecor(),
          SafeArea(
            child: SingleChildScrollView(
              padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceLg,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const SizedBox(height: DesignTokens.spaceLg),
                  Container(
                    width: 64,
                    height: 64,
                    margin: const EdgeInsets.only(bottom: DesignTokens.spaceLg),
                    decoration: BoxDecoration(
                      color: AppColors.primary.withValues(alpha: 0.1),
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusXl),
                    ),
                    child: const Icon(
                      Icons.lock_reset_rounded,
                      color: AppColors.primary,
                      size: 32,
                    ),
                  ),
                  Text(
                    'Forgot Password?',
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXs),
                  Text(
                    _sent
                        ? 'Check your inbox for a reset link.'
                        : "Enter your account email and we'll send a reset link.",
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.textSecondary,
                          height: DesignTokens.lineHeightNormal,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXl),
                  if (!firebaseConfigured)
                    const FirebaseNotConfiguredCard()
                  else if (_sent)
                    _SuccessCard(email: _emailController.text.trim())
                  else
                    PremiumCard(
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            if (auth.error != null) ...[
                              AuthErrorBanner(message: auth.error!),
                              const SizedBox(height: DesignTokens.spaceMd),
                            ],
                            CustomTextField(
                              label: 'Email Address',
                              hint: 'driver@email.com',
                              controller: _emailController,
                              keyboardType: TextInputType.emailAddress,
                              prefixIcon: Icons.email_outlined,
                              validator: _validateEmail,
                              onChanged: (_) => _clearErrorIfAny(),
                            ),
                            const SizedBox(height: DesignTokens.spaceLg),
                            PrimaryButton(
                              text: 'Send Reset Link',
                              icon: Icons.send_rounded,
                              isLoading: _loading,
                              onPressed: _sendResetLink,
                              height: DesignTokens.buttonHeightLg,
                            ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: DesignTokens.spaceLg),
                  Center(
                    child: TextButton(
                      onPressed: _loading ? null : () => context.go('/login'),
                      child: const Text('Back to Login'),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXxl),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  String? _validateEmail(String? value) {
    final v = value?.trim() ?? '';
    if (v.isEmpty) return 'Email is required';
    final emailRegex = RegExp(r'^[\w.+-]+@[\w-]+\.[\w.-]+$');
    if (!emailRegex.hasMatch(v)) return 'Enter a valid email address';
    return null;
  }

  void _clearErrorIfAny() {
    if (ref.read(authProvider).error != null) {
      ref.read(authProvider.notifier).clearError();
    }
  }
}

/// Confirmation card shown after a reset email is sent successfully.
class _SuccessCard extends StatelessWidget {
  const _SuccessCard({required this.email});

  final String email;

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      accentColor: AppColors.success,
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: const BoxDecoration(
              color: AppColors.successContainer,
              shape: BoxShape.circle,
            ),
            child: const Icon(
              Icons.mark_email_read_rounded,
              color: AppColors.successDark,
              size: 28,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            'Reset link sent',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceXs),
          Text(
            email.isEmpty
                ? 'Follow the link in the email to reset your password.'
                : 'A reset link was sent to $email. Follow it to reset your '
                    'password.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.textSecondary,
                  height: DesignTokens.lineHeightNormal,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          PrimaryButton(
            text: 'Back to Login',
            icon: Icons.login_rounded,
            onPressed: () => context.go('/login'),
            height: DesignTokens.buttonHeightLg,
          ),
        ],
      ),
    );
  }
}
