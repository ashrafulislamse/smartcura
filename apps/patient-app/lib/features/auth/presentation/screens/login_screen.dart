import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
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

/// Login Screen — real email/password sign-in wired to [AuthNotifier.login]
/// plus Google Sign-In wired to [AuthNotifier.signInWithGoogle].
///
/// Matches the redesigned reference UI: light header with a hero illustration,
/// branded form card, "or continue with" divider, and a Google-only social
/// button. Biometric and OTP options are intentionally removed (user request).
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen>
    with SingleTickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _rememberMe = false;
  bool _isLoggingIn = false;
  bool _isGoogleSigningIn = false;
  String? _inlineError;

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
  }

  @override
  void dispose() {
    _animationController.dispose();
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
      // Keep the default — the backend only uses this for session labelling.
    }
  }

  bool _validateForm() {
    if (_emailController.text.trim().isEmpty) {
      setState(() => _inlineError = 'Please enter your email address.');
      return false;
    }
    if (_passwordController.text.isEmpty) {
      setState(() => _inlineError = 'Please enter your password.');
      return false;
    }
    if (_passwordController.text.length < AppConstants.minPasswordLength) {
      setState(() => _inlineError = AppStrings.invalidPassword);
      return false;
    }
    return true;
  }

  Future<void> _handleLogin() async {
    if (!_validateForm()) return;

    setState(() {
      _isLoggingIn = true;
      _inlineError = null;
    });

    await ref.read(authProvider.notifier).login(
          _emailController.text.trim(),
          _passwordController.text,
          _deviceName,
        );

    if (!mounted) return;

    final auth = ref.read(authProvider);
    setState(() => _isLoggingIn = false);

    if (auth.status == AuthStatus.unauthenticated &&
        auth.errorMessage != null) {
      setState(() => _inlineError = auth.errorMessage);
      _showErrorSnackbar(auth.errorMessage!);
    }
    // If authenticated, the router auto-redirects to the bootstrap route.
  }

  Future<void> _handleGoogleSignIn() async {
    setState(() {
      _isGoogleSigningIn = true;
      _inlineError = null;
    });

    await ref.read(authProvider.notifier).signInWithGoogle(_deviceName);

    if (!mounted) return;

    final auth = ref.read(authProvider);
    setState(() => _isGoogleSigningIn = false);

    if (auth.status == AuthStatus.unauthenticated &&
        auth.errorMessage != null) {
      setState(() => _inlineError = auth.errorMessage);
      _showErrorSnackbar(auth.errorMessage!);
    }
    // If authenticated, the router auto-redirects.
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
    final theme = Theme.of(context);

    return Scaffold(
      backgroundColor: AppColors.background,
      resizeToAvoidBottomInset: true,
      body: Stack(
        children: [
          const AuthBackgroundDecor(),
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
                    top: DesignTokens.spaceLg,
                    bottom: DesignTokens.space2xl + bottomInset,
                  ),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        // Header: logo + hero illustration.
                        _LoginHeader(theme: theme),

                        SizedBox(height: DesignTokens.space2xl),

                        // Firebase not configured warning.
                        if (!fbReady) ...[
                          const FirebaseNotConfiguredCard(),
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

                              CustomTextField(
                                label: 'Email',
                                hint: 'ex. patient@email.com',
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

                              PasswordField(
                                hint: '••••••••',
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
                              SizedBox(height: DesignTokens.spaceMd),

                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  _RememberMeToggle(
                                    value: _rememberMe,
                                    onChanged: (v) =>
                                        setState(() => _rememberMe = v),
                                  ),
                                  TextButton(
                                    onPressed: () {
                                      HapticFeedback.lightImpact();
                                      context.push('/forgot-password');
                                    },
                                    child: Text(
                                      AppStrings.forgotPassword,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w600,
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                              SizedBox(height: DesignTokens.spaceLg),

                              PrimaryButton(
                                text: AppStrings.login,
                                onPressed: fbReady && !_isGoogleSigningIn
                                    ? _handleLogin
                                    : null,
                                isLoading: _isLoggingIn,
                                semanticLabel: 'Log in to your account',
                              ),
                            ],
                          ),
                        ),

                        if (fbReady) ...[
                          SizedBox(height: DesignTokens.spaceXl),
                          _Divider(),
                          SizedBox(height: DesignTokens.spaceLg),
                          _GoogleSignInButton(
                            onPressed:
                                !_isLoggingIn ? _handleGoogleSignIn : null,
                            isLoading: _isGoogleSigningIn,
                          ),
                        ],

                        SizedBox(height: DesignTokens.space2xl),

                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              AppStrings.dontHaveAccount,
                              style: theme.textTheme.bodyMedium?.copyWith(
                                color: AppColors.textSecondary,
                              ),
                            ),
                            TextButton(
                              onPressed: () {
                                HapticFeedback.lightImpact();
                                context.go('/signup');
                              },
                              child: Text(
                                AppStrings.signUp,
                                style: const TextStyle(
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ),
                          ],
                        ),

                        SizedBox(height: DesignTokens.spaceLg),

                        Text(
                          'Your data is protected with enterprise-grade encryption '
                          'and never shared without your consent.',
                          textAlign: TextAlign.center,
                          style: theme.textTheme.bodySmall?.copyWith(
                            color: AppColors.textSecondary,
                          ),
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
// Header
// ---------------------------------------------------------------------------

class _LoginHeader extends StatelessWidget {
  final ThemeData theme;

  const _LoginHeader({required this.theme});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            const BrandLogo(size: 56, iconSize: 28),
            const SizedBox(width: DesignTokens.spaceMd),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  AppStrings.appName,
                  style: theme.textTheme.titleLarge?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: AppColors.textPrimary,
                  ),
                ),
                Text(
                  AppStrings.appTagline,
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ],
        ),
        SizedBox(height: DesignTokens.spaceXl),
        Container(
          height: 180,
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [
                AppColors.primary.withOpacity(0.12),
                AppColors.secondary.withOpacity(0.12),
              ],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          ),
          child: Stack(
            alignment: Alignment.center,
            children: [
              Positioned(
                left: DesignTokens.spaceLg,
                top: DesignTokens.spaceLg,
                child: _HeroBubble(
                  icon: Icons.favorite_rounded,
                  color: AppColors.heartRate,
                  size: 48,
                ),
              ),
              Positioned(
                right: DesignTokens.spaceLg,
                bottom: DesignTokens.spaceLg,
                child: _HeroBubble(
                  icon: Icons.medical_services_rounded,
                  color: AppColors.primary,
                  size: 56,
                ),
              ),
              Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.health_and_safety_rounded,
                    size: 80,
                    color: AppColors.primary,
                  ),
                  SizedBox(height: DesignTokens.spaceSm),
                  Text(
                    'Welcome Back',
                    style: theme.textTheme.headlineSmall?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  Text(
                    'Sign in to manage your health',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _HeroBubble extends StatelessWidget {
  final IconData icon;
  final Color color;
  final double size;

  const _HeroBubble({
    required this.icon,
    required this.color,
    required this.size,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: AppColors.white,
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: color.withOpacity(0.15),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Icon(icon, color: color, size: size * 0.5),
    );
  }
}

// ---------------------------------------------------------------------------
// Sub-widgets
// ---------------------------------------------------------------------------

class _RememberMeToggle extends StatelessWidget {
  final bool value;
  final ValueChanged<bool> onChanged;

  const _RememberMeToggle({required this.value, required this.onChanged});

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: () {
        HapticFeedback.lightImpact();
        onChanged(!value);
      },
      borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
      child: Padding(
        padding: const EdgeInsets.all(4.0),
        child: Row(
          mainAxisSize: MainAxisSize.min,
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
            const SizedBox(width: DesignTokens.spaceSm),
            Text(
              AppStrings.rememberMe,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ],
        ),
      ),
    );
  }
}

class _Divider extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        const Expanded(
          child: Divider(color: AppColors.border, thickness: 1),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          child: Text(
            AppStrings.orContinueWith,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: AppColors.textSecondary,
                ),
          ),
        ),
        const Expanded(
          child: Divider(color: AppColors.border, thickness: 1),
        ),
      ],
    );
  }
}

class _GoogleSignInButton extends StatelessWidget {
  final VoidCallback? onPressed;
  final bool isLoading;

  const _GoogleSignInButton({
    required this.onPressed,
    this.isLoading = false,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      enabled: !isLoading && onPressed != null,
      label: AppStrings.signInWithGoogle,
      child: MouseRegion(
        cursor: onPressed != null && !isLoading
            ? SystemMouseCursors.click
            : SystemMouseCursors.basic,
        child: SizedBox(
          height: DesignTokens.buttonHeightMd,
          child: OutlinedButton(
            onPressed: isLoading ? null : onPressed,
            style: OutlinedButton.styleFrom(
              backgroundColor: AppColors.white,
              foregroundColor: AppColors.textPrimary,
              side: const BorderSide(color: AppColors.border),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceMd,
              ),
            ),
            child: isLoading
                ? SizedBox(
                    height: 20,
                    width: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(
                        AppColors.primary,
                      ),
                    ),
                  )
                : Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      _GoogleIcon(),
                      const SizedBox(width: DesignTokens.spaceMd),
                      Text(
                        AppStrings.signInWithGoogle,
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}

class _GoogleIcon extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final svg = '''
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
</svg>
'''
        .trim();
    return SvgPicture.string(
      svg,
      width: 22,
      height: 22,
    );
  }
}
