import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/auth/firebase_initializer.dart';
import '../../../../core/constants/app_constants.dart';
import '../../../../core/constants/app_strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/auth_widgets.dart';
import '../../../../core/widgets/buttons/primary_button.dart';
import '../../../../core/widgets/inputs/custom_text_field.dart';
import '../../../../core/widgets/inputs/password_field.dart';
import '../../../../core/widgets/premium_card.dart';

/// Sign Up Screen — real account creation wired to [AuthNotifier.signUp].
///
/// Validates the form, resolves a device name, and calls the auth notifier
/// with email, password, display name, and device name. Loading is shown on
/// the button; errors surface inline and via snackbar. When
/// [firebaseConfigured] is false a prominent warning is shown and the
/// submit button is disabled. On success the router auto-redirects based on
/// the bootstrap state (typically profile setup).
class SignUpScreen extends ConsumerStatefulWidget {
  const SignUpScreen({super.key});

  @override
  ConsumerState<SignUpScreen> createState() => _SignUpScreenState();
}

class _SignUpScreenState extends ConsumerState<SignUpScreen>
    with SingleTickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _acceptTerms = false;
  bool _isSubmitting = false;
  String? _inlineError;
  int _passwordStrength = 0;

  String _deviceName = AppConstants.defaultDeviceName;

  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;

  @override
  void initState() {
    super.initState();

    _animationController = AnimationController(
      duration: DesignTokens.animationSlow,
      vsync: this,
    );

    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeIn),
    );

    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, 0.06),
      end: Offset.zero,
    ).animate(
      CurvedAnimation(parent: _animationController, curve: Curves.easeOutCubic),
    );

    _animationController.forward();
    _resolveDeviceName();
    _passwordController.addListener(_updatePasswordStrength);
  }

  @override
  void dispose() {
    _animationController.dispose();
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _resolveDeviceName() async {
    try {
      final info = DeviceInfoPlugin();
      String name;
      if (Platform.isAndroid) {
        final android = await info.androidInfo;
        name = '${android.brand} ${android.model}';
      } else if (Platform.isIOS) {
        final ios = await info.iosInfo;
        name = ios.name;
      } else {
        name = AppConstants.defaultDeviceName;
      }
      if (mounted) setState(() => _deviceName = name);
    } catch (_) {
      // Keep the default.
    }
  }

  void _updatePasswordStrength() {
    final password = _passwordController.text;
    int strength = 0;
    if (password.length >= AppConstants.minPasswordLength) strength++;
    if (password.contains(RegExp(r'[A-Z]'))) strength++;
    if (password.contains(RegExp(r'[0-9]'))) strength++;
    if (password.contains(RegExp(r'[!@#$%^&*(),.?":{}|<>]'))) strength++;
    setState(() => _passwordStrength = strength);
  }

  String _getPasswordStrengthText() {
    return switch (_passwordStrength) {
      0 || 1 => 'Weak',
      2 => 'Fair',
      3 => 'Strong',
      4 => 'Very Strong',
      _ => '',
    };
  }

  Color _getPasswordStrengthColor() {
    return switch (_passwordStrength) {
      0 || 1 => AppColors.error,
      2 => AppColors.warning,
      3 => AppColors.success,
      4 => AppColors.successDark,
      _ => AppColors.gray400,
    };
  }

  Future<void> _handleSignUp() async {
    if (!_acceptTerms) {
      setState(() => _inlineError =
          'Please accept the Terms of Service and Privacy Policy.');
      return;
    }
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isSubmitting = true;
      _inlineError = null;
    });

    await ref.read(authProvider.notifier).signUp(
          _emailController.text.trim(),
          _passwordController.text,
          _nameController.text.trim(),
          _deviceName,
        );

    if (!mounted) return;

    final auth = ref.read(authProvider);
    setState(() => _isSubmitting = false);

    if (auth.status == AuthStatus.unauthenticated &&
        auth.errorMessage != null) {
      setState(() => _inlineError = auth.errorMessage);
      _showErrorSnackbar(auth.errorMessage!);
    }
    // If authenticated, the router auto-redirects to the bootstrap route
    // (typically /edit-profile for a brand-new account).
  }

  void _showErrorSnackbar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: AppColors.error,
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final fbReady = firebaseConfigured;
    final bottomInset = MediaQuery.of(context).viewInsets.bottom;

    return Scaffold(
      backgroundColor: AppColors.background,
      resizeToAvoidBottomInset: true,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded,
              color: AppColors.textPrimary),
          onPressed: () {
            HapticFeedback.lightImpact();
            context.go('/login');
          },
        ),
        title: Text(
          'Create Account',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                fontWeight: FontWeight.bold,
              ),
        ),
        centerTitle: true,
      ),
      body: Stack(
        children: [
          // Background decorative circles.
          const AuthBackgroundDecor(),

          // Main content.
          SafeArea(
            child: FadeTransition(
              opacity: _fadeAnimation,
              child: SlideTransition(
                position: _slideAnimation,
                child: SingleChildScrollView(
                  physics: const BouncingScrollPhysics(),
                  padding: EdgeInsets.only(
                    left: DesignTokens.screenPaddingHorizontal,
                    right: DesignTokens.screenPaddingHorizontal,
                    top: DesignTokens.spaceSm,
                    bottom: DesignTokens.space2xl + bottomInset,
                  ),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // Brand logo.
                        const Center(
                          child: BrandLogo(
                            size: 64,
                            iconSize: 32,
                            gradient: AppColors.secondaryGradient,
                          ),
                        ),

                        SizedBox(height: DesignTokens.spaceLg),

                        // Title & subtitle.
                        Text(
                          'Start your health journey',
                          textAlign: TextAlign.center,
                          style: Theme.of(context)
                              .textTheme
                              .headlineMedium
                              ?.copyWith(
                                fontWeight: FontWeight.bold,
                                fontSize: 24,
                                letterSpacing: -0.5,
                              ),
                        ),
                        SizedBox(height: DesignTokens.spaceXs),
                        Text(
                          'Fill in your details to register safely',
                          textAlign: TextAlign.center,
                          style:
                              Theme.of(context).textTheme.bodyLarge?.copyWith(
                                    color: AppColors.textSecondary,
                                  ),
                        ),

                        SizedBox(height: DesignTokens.spaceXl),

                        // Firebase not configured warning.
                        if (!fbReady) ...[
                          const FirebaseNotConfiguredCard(
                            feature: 'account creation',
                          ),
                          SizedBox(height: DesignTokens.spaceLg),
                        ],

                        // Form card.
                        PremiumCard(
                          margin: EdgeInsets.zero,
                          padding: const EdgeInsets.all(DesignTokens.spaceLg),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              // Inline error banner.
                              if (_inlineError != null) ...[
                                AuthErrorBanner(message: _inlineError!),
                                SizedBox(height: DesignTokens.spaceMd),
                              ],

                              // Full name.
                              CustomTextField(
                                label: 'Full Name',
                                hint: 'e.g. John Doe',
                                controller: _nameController,
                                prefixIcon: Icons.person_outlined,
                                enabled: fbReady,
                                validator: (value) {
                                  if (value == null || value.trim().isEmpty) {
                                    return AppStrings.fieldRequired;
                                  }
                                  if (value.trim().length <
                                      AppConstants.minNameLength) {
                                    return 'Name is too short';
                                  }
                                  return null;
                                },
                              ),
                              SizedBox(height: DesignTokens.spaceMd),

                              // Email.
                              CustomTextField(
                                label: 'Email Address',
                                hint: 'john@example.com',
                                controller: _emailController,
                                keyboardType: TextInputType.emailAddress,
                                prefixIcon: Icons.email_outlined,
                                enabled: fbReady,
                                validator: (value) {
                                  if (value == null || value.trim().isEmpty) {
                                    return AppStrings.fieldRequired;
                                  }
                                  if (!value.contains('@')) {
                                    return AppStrings.invalidEmail;
                                  }
                                  return null;
                                },
                              ),
                              SizedBox(height: DesignTokens.spaceMd),

                              // Password.
                              PasswordField(
                                hint: 'Min. 8 characters',
                                controller: _passwordController,
                                validator: (value) {
                                  if (value == null || value.isEmpty) {
                                    return AppStrings.fieldRequired;
                                  }
                                  if (value.length <
                                      AppConstants.minPasswordLength) {
                                    return AppStrings.invalidPassword;
                                  }
                                  return null;
                                },
                              ),

                              // Password strength indicator.
                              if (_passwordController.text.isNotEmpty) ...[
                                SizedBox(height: DesignTokens.spaceSm),
                                _PasswordStrengthBar(
                                  strength: _passwordStrength,
                                  color: _getPasswordStrengthColor(),
                                  label: _getPasswordStrengthText(),
                                ),
                              ],

                              SizedBox(height: DesignTokens.spaceMd),

                              // Terms & privacy checkbox.
                              _TermsCheckbox(
                                value: _acceptTerms,
                                onChanged: (v) =>
                                    setState(() => _acceptTerms = v),
                              ),
                              SizedBox(height: DesignTokens.spaceLg),

                              // Create account button.
                              PrimaryButton(
                                text: 'Create Account',
                                onPressed: fbReady ? _handleSignUp : null,
                                isLoading: _isSubmitting,
                                semanticLabel: 'Create your new account',
                              ),
                            ],
                          ),
                        ),

                        SizedBox(height: DesignTokens.spaceMd),

                        // Login link.
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              AppStrings.alreadyHaveAccount,
                              style: Theme.of(context)
                                  .textTheme
                                  .bodyMedium
                                  ?.copyWith(
                                    color: AppColors.textSecondary,
                                  ),
                            ),
                            TextButton(
                              onPressed: () {
                                HapticFeedback.lightImpact();
                                context.go('/login');
                              },
                              child: Text(
                                AppStrings.login,
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sub-widgets
// ---------------------------------------------------------------------------

class _PasswordStrengthBar extends StatelessWidget {
  final int strength;
  final Color color;
  final String label;

  const _PasswordStrengthBar({
    required this.strength,
    required this.color,
    required this.label,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: List.generate(4, (index) {
            return Expanded(
              child: Container(
                height: 6,
                margin: EdgeInsets.only(
                  right: index < 3 ? DesignTokens.spaceXs : 0,
                ),
                decoration: BoxDecoration(
                  color: index < strength ? color : AppColors.border,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                ),
              ),
            );
          }),
        ),
        SizedBox(height: DesignTokens.spaceXs),
        Align(
          alignment: Alignment.centerRight,
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: color,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ),
      ],
    );
  }
}

class _TermsCheckbox extends StatelessWidget {
  final bool value;
  final ValueChanged<bool> onChanged;

  const _TermsCheckbox({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          height: 20,
          width: 20,
          child: Checkbox(
            value: value,
            onChanged: (v) => onChanged(v ?? false),
            activeColor: AppColors.primary,
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(4),
            ),
          ),
        ),
        SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: GestureDetector(
            onTap: () => onChanged(!value),
            child: RichText(
              text: TextSpan(
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondary,
                    ),
                children: [
                  const TextSpan(text: 'I agree to the '),
                  TextSpan(
                    text: AppStrings.termsConditions,
                    style: const TextStyle(
                      color: AppColors.primary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const TextSpan(text: ' and '),
                  TextSpan(
                    text: AppStrings.privacyPolicy,
                    style: const TextStyle(
                      color: AppColors.primary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const TextSpan(text: '.'),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
