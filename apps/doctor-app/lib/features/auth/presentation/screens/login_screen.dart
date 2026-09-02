import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:local_auth/local_auth.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/auth/firebase_initializer.dart';
import '../../../../core/constants/app_constants.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/premium_card.dart';
import '../../../../core/widgets/smartcura_logo.dart';

/// Doctor Login Screen — real authentication via Firebase + SmartCura backend.
///
/// Calls `ref.read(authProvider.notifier).signIn(email, password)` which
/// bridges Firebase `signInWithEmailAndPassword` -> `POST /sessions`. On
/// success the router redirect sends the user to `/dashboard` (or
/// `/verification-pending` when the bootstrap state requires it).
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();

  bool _obscurePassword = true;
  bool _rememberMe = false;
  bool _isSigningIn = false;
  bool _isCheckingBiometric = false;
  bool _biometricAvailable = false;

  final LocalAuthentication _localAuth = LocalAuthentication();

  @override
  void initState() {
    super.initState();
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.white,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
    );
    _restoreSavedEmail();
    _checkBiometricAvailability();
  }

  Future<void> _restoreSavedEmail() async {
    final prefs = await SharedPreferences.getInstance();
    final savedEmail = prefs.getString('savedEmail');
    if (savedEmail != null && savedEmail.isNotEmpty && mounted) {
      setState(() {
        _emailController.text = savedEmail;
        _rememberMe = true;
      });
    }
  }

  Future<void> _checkBiometricAvailability() async {
    if (!firebaseConfigured) return;
    try {
      final canCheck = await _localAuth.canCheckBiometrics;
      final isDeviceSupported = await _localAuth.isDeviceSupported();
      if (mounted) {
        setState(() {
          _biometricAvailable = canCheck && isDeviceSupported;
        });
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  Future<void> _handleSignIn() async {
    if (!_formKey.currentState!.validate()) return;

    ref.read(authProvider.notifier).clearError();

    setState(() => _isSigningIn = true);

    final success = await ref.read(authProvider.notifier).signIn(
          email: _emailController.text,
          password: _passwordController.text,
        );

    if (!mounted) return;
    setState(() => _isSigningIn = false);

    if (success) {
      final prefs = await SharedPreferences.getInstance();
      if (_rememberMe) {
        await prefs.setString('savedEmail', _emailController.text);
      } else {
        await prefs.remove('savedEmail');
      }
    } else {
      final error = ref.read(authProvider).error ?? 'Sign-in failed.';
      _showErrorSnackBar(error);
    }
  }

  Future<void> _handleBiometricSignIn() async {
    if (!_biometricAvailable) return;

    setState(() => _isCheckingBiometric = true);

    try {
      final authenticated = await _localAuth.authenticate(
        localizedReason: 'Authenticate to sign in to SmartCura Doctor',
        options: const AuthenticationOptions(
          stickyAuth: true,
          biometricOnly: false,
        ),
      );

      if (!authenticated || !mounted) {
        setState(() => _isCheckingBiometric = false);
        return;
      }

      setState(() => _isSigningIn = true);
      await ref.read(authProvider.notifier).bootstrap();
      if (!mounted) return;
      setState(() => _isSigningIn = false);

      final authState = ref.read(authProvider);
      if (authState.status != AuthStatus.authenticated) {
        _showErrorSnackBar(
          'No saved session found. Please sign in with your credentials.',
        );
      }
    } catch (e) {
      if (!mounted) return;
      _showErrorSnackBar('Biometric authentication failed: $e');
    } finally {
      if (mounted) setState(() => _isCheckingBiometric = false);
    }
  }

  void _showErrorSnackBar(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: AppColors.error,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 4),
      ),
    );
  }

  void _handleForgotPassword() {
    context.push('/forgot-password');
  }

  void _handleRegister() {
    context.push('/register');
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

  @override
  Widget build(BuildContext context) {
    final authError = ref.watch(authProvider).error;
    final isLoading = _isSigningIn || _isCheckingBiometric;

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: SingleChildScrollView(
          child: Column(
            children: [
              _buildHeader(),
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: DesignTokens.spaceLg,
                ),
                child: Column(
                  children: [
                    const SizedBox(height: DesignTokens.spaceLg),

                    // Firebase not configured warning.
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
                                    'Contact your administrator. Authentication '
                                    'requires Firebase to be set up.',
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

                    // Login form card.
                    PremiumCard(
                      padding: const EdgeInsets.all(DesignTokens.spaceLg),
                      child: Form(
                        key: _formKey,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Text(
                              'Welcome Back',
                              style: TextStyle(
                                fontSize: 24,
                                fontWeight: FontWeight.w800,
                                color: AppColors.gray900,
                                letterSpacing: -0.5,
                              ),
                            ),
                            const SizedBox(height: 4),
                            Text(
                              'Sign in to your professional account',
                              style: TextStyle(
                                fontSize: 14,
                                color: AppColors.gray500,
                              ),
                            ),
                            const SizedBox(height: DesignTokens.spaceXl),

                            // Email.
                            TextFormField(
                              controller: _emailController,
                              enabled: !isLoading,
                              keyboardType: TextInputType.emailAddress,
                              textInputAction: TextInputAction.next,
                              decoration: _inputDecoration(
                                label: 'Email Address',
                                icon: Icons.email_outlined,
                              ),
                              validator: (value) {
                                if (value == null || value.isEmpty) {
                                  return 'Please enter your email';
                                }
                                if (!value.contains('@') ||
                                    !value.contains('.')) {
                                  return 'Please enter a valid email';
                                }
                                return null;
                              },
                            ),

                            const SizedBox(height: DesignTokens.spaceMd),

                            // Password.
                            TextFormField(
                              controller: _passwordController,
                              enabled: !isLoading,
                              obscureText: _obscurePassword,
                              textInputAction: TextInputAction.done,
                              onFieldSubmitted: (_) =>
                                  firebaseConfigured ? _handleSignIn() : null,
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
                              validator: (value) {
                                if (value == null || value.isEmpty) {
                                  return 'Please enter your password';
                                }
                                if (value.length < 6) {
                                  return 'Password must be at least 6 characters';
                                }
                                return null;
                              },
                            ),

                            const SizedBox(height: DesignTokens.spaceMd),

                            // Remember me + Forgot password.
                            Row(
                              mainAxisAlignment: MainAxisAlignment.spaceBetween,
                              children: [
                                Row(
                                  children: [
                                    SizedBox(
                                      width: 22,
                                      height: 22,
                                      child: Checkbox(
                                        value: _rememberMe,
                                        onChanged: isLoading
                                            ? null
                                            : (value) {
                                                setState(() {
                                                  _rememberMe = value ?? false;
                                                });
                                              },
                                        activeColor: AppColors.primary,
                                        shape: RoundedRectangleBorder(
                                          borderRadius:
                                              BorderRadius.circular(4),
                                        ),
                                      ),
                                    ),
                                    const SizedBox(width: 8),
                                    Text(
                                      'Remember me',
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: AppColors.gray600,
                                      ),
                                    ),
                                  ],
                                ),
                                TextButton(
                                  onPressed:
                                      isLoading ? null : _handleForgotPassword,
                                  style: TextButton.styleFrom(
                                    padding: EdgeInsets.zero,
                                    minimumSize: const Size(0, 0),
                                    tapTargetSize:
                                        MaterialTapTargetSize.shrinkWrap,
                                  ),
                                  child: const Text(
                                    'Forgot Password?',
                                    style: TextStyle(
                                      fontSize: 13,
                                      fontWeight: FontWeight.w600,
                                      color: AppColors.primary,
                                    ),
                                  ),
                                ),
                              ],
                            ),

                            // Inline error.
                            if (authError != null) ...[
                              const SizedBox(height: DesignTokens.spaceMd),
                              Container(
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: AppColors.errorContainer,
                                  borderRadius: BorderRadius.circular(
                                    DesignTokens.radiusSm,
                                  ),
                                ),
                                child: Row(
                                  children: [
                                    const Icon(
                                      Icons.error_outline_rounded,
                                      size: 18,
                                      color: AppColors.errorDark,
                                    ),
                                    const SizedBox(width: 8),
                                    Expanded(
                                      child: Text(
                                        authError,
                                        style: const TextStyle(
                                          fontSize: 13,
                                          color: AppColors.errorDark,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],

                            const SizedBox(height: DesignTokens.spaceXl),

                            // Sign in button.
                            SizedBox(
                              width: double.infinity,
                              height: DesignTokens.buttonHeightLg,
                              child: ElevatedButton(
                                onPressed: (isLoading || !firebaseConfigured)
                                    ? null
                                    : _handleSignIn,
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
                                child: _isSigningIn
                                    ? Row(
                                        mainAxisAlignment:
                                            MainAxisAlignment.center,
                                        children: [
                                          const SizedBox(
                                            width: 20,
                                            height: 20,
                                            child: CircularProgressIndicator(
                                              strokeWidth: 2,
                                              valueColor:
                                                  AlwaysStoppedAnimation<Color>(
                                                AppColors.white,
                                              ),
                                            ),
                                          ),
                                          const SizedBox(width: 10),
                                          const Text(
                                            'Signing in...',
                                            style: TextStyle(
                                              fontSize: 15,
                                              fontWeight: FontWeight.w600,
                                            ),
                                          ),
                                        ],
                                      )
                                    : const Text(
                                        'Sign In',
                                        style: TextStyle(
                                          fontSize: 16,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                              ),
                            ),

                            // Biometric login.
                            if (_biometricAvailable && firebaseConfigured) ...[
                              const SizedBox(height: DesignTokens.spaceMd),
                              SizedBox(
                                width: double.infinity,
                                height: DesignTokens.buttonHeightMd,
                                child: OutlinedButton.icon(
                                  onPressed: _isCheckingBiometric
                                      ? null
                                      : _handleBiometricSignIn,
                                  icon: _isCheckingBiometric
                                      ? const SizedBox(
                                          width: 20,
                                          height: 20,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 2,
                                            color: AppColors.primary,
                                          ),
                                        )
                                      : const Icon(Icons.fingerprint_rounded,
                                          size: 22),
                                  label: const Text('Sign in with Biometrics',
                                      style: TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w600)),
                                  style: OutlinedButton.styleFrom(
                                    foregroundColor: AppColors.primary,
                                    side: const BorderSide(
                                      color: AppColors.primary,
                                      width: 1.5,
                                    ),
                                    shape: RoundedRectangleBorder(
                                      borderRadius: BorderRadius.circular(
                                        DesignTokens.radiusMd,
                                      ),
                                    ),
                                  ),
                                ),
                              ),
                            ],
                          ],
                        ),
                      ),
                    ),

                    const SizedBox(height: DesignTokens.spaceXl),

                    // Registration link.
                    Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Text(
                          'New to SmartCura? ',
                          style: TextStyle(
                            fontSize: 14,
                            color: AppColors.gray500,
                          ),
                        ),
                        TextButton(
                          onPressed: isLoading ? null : _handleRegister,
                          style: TextButton.styleFrom(
                            padding: EdgeInsets.zero,
                            minimumSize: const Size(0, 0),
                            tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                          ),
                          child: const Text(
                            'Register as Doctor',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: AppColors.primary,
                            ),
                          ),
                        ),
                      ],
                    ),

                    const SizedBox(height: DesignTokens.spaceMd),
                    Text(
                      'For patient login, use the SmartCura Patient App',
                      style: TextStyle(
                        fontSize: 12,
                        color: AppColors.gray400,
                      ),
                      textAlign: TextAlign.center,
                    ),

                    const SizedBox(height: DesignTokens.space2xl),
                  ],
                ),
              ),
            ],
          ),
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
          // Logo.
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
              'Professional Portal',
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
}
