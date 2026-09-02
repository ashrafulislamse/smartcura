import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/auth/firebase_initializer.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Registration screen — creates a Firebase user and immediately bootstraps a
/// SmartCura driver session.
///
/// Submitting calls `authProvider.notifier.signUp(email, password, displayName)`,
/// which runs `FirebaseAuth.createUserWithEmailAndPassword`, sets the display
/// name, then `POST /sessions` with `requested_role: driver`. On success the
/// auth state becomes `authenticated` and the router redirect routes the user
/// (typically to `/verification-pending` for document review), so this screen
/// does not navigate on success itself.
class RegistrationScreen extends ConsumerStatefulWidget {
  const RegistrationScreen({super.key});

  @override
  ConsumerState<RegistrationScreen> createState() => _RegistrationScreenState();
}

class _RegistrationScreenState extends ConsumerState<RegistrationScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _loading = false;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _signUp() async {
    if (!_formKey.currentState!.validate()) return;
    HapticFeedback.lightImpact();
    ref.read(authProvider.notifier).clearError();
    setState(() => _loading = true);
    await ref.read(authProvider.notifier).signUp(
          email: _emailController.text,
          password: _passwordController.text,
          displayName: _nameController.text.trim(),
        );
    if (!mounted) return;
    setState(() => _loading = false);
    // No manual navigation: the router redirect reacts to the auth state.
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
        title: const Text('Create Account'),
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
                  const SizedBox(height: DesignTokens.spaceSm),
                  const Center(child: BrandLogo()),
                  const SizedBox(height: DesignTokens.spaceLg),
                  Text(
                    'Join SmartCura',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXs),
                  Text(
                    'Create your driver account to get started',
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.textSecondary,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceXl),
                  if (!firebaseConfigured) ...[
                    const FirebaseNotConfiguredCard(),
                  ] else
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
                              label: 'Full Name',
                              hint: 'Ahmad bin Abdullah',
                              controller: _nameController,
                              prefixIcon: Icons.person_outline_rounded,
                              validator: _validateName,
                              onChanged: (_) => _clearErrorIfAny(),
                            ),
                            const SizedBox(height: DesignTokens.spaceMd),
                            CustomTextField(
                              label: 'Email Address',
                              hint: 'driver@email.com',
                              controller: _emailController,
                              keyboardType: TextInputType.emailAddress,
                              prefixIcon: Icons.email_outlined,
                              validator: _validateEmail,
                              onChanged: (_) => _clearErrorIfAny(),
                            ),
                            const SizedBox(height: DesignTokens.spaceMd),
                            PasswordField(
                              hint: 'Min 8 characters',
                              controller: _passwordController,
                              validator: _validatePassword,
                            ),
                            const SizedBox(height: DesignTokens.spaceLg),
                            PrimaryButton(
                              text: 'Create Account',
                              icon: Icons.person_add_rounded,
                              isLoading: _loading,
                              onPressed: _signUp,
                              height: DesignTokens.buttonHeightLg,
                            ),
                          ],
                        ),
                      ),
                    ),
                  const SizedBox(height: DesignTokens.spaceXl),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        'Already have an account? ',
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: AppColors.textSecondary,
                            ),
                      ),
                      GestureDetector(
                        onTap: _loading ? null : () => context.go('/login'),
                        child: Text(
                          'Sign in',
                          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                color: AppColors.primary,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                      ),
                    ],
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

  String? _validateName(String? value) {
    final v = value?.trim() ?? '';
    if (v.isEmpty) return 'Full name is required';
    if (v.length < 2) return 'Enter your full name';
    return null;
  }

  String? _validateEmail(String? value) {
    final v = value?.trim() ?? '';
    if (v.isEmpty) return 'Email is required';
    final emailRegex = RegExp(r'^[\w.+-]+@[\w-]+\.[\w.-]+$');
    if (!emailRegex.hasMatch(v)) return 'Enter a valid email address';
    return null;
  }

  String? _validatePassword(String? value) {
    if (value == null || value.isEmpty) return 'Password is required';
    if (value.length < 8) return 'Password must be at least 8 characters';
    return null;
  }

  void _clearErrorIfAny() {
    if (ref.read(authProvider).error != null) {
      ref.read(authProvider.notifier).clearError();
    }
  }
}
