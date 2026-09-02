import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/auth/firebase_initializer.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Login screen — email + password sign-in backed by Firebase Auth and the
/// SmartCura session layer.
///
/// Submitting calls `authProvider.notifier.signIn`, which mints a Firebase
/// id token and `POST /sessions`. On success the auth state flips to
/// `authenticated` and the router redirect routes the user to `/dashboard`
/// (or `/verification-pending` when the bootstrap state requires it), so this
/// screen never navigates on success itself.
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
  bool _loading = false;

  late final AnimationController _animController;
  late final Animation<double> _fade;
  late final Animation<Offset> _slide;

  @override
  void initState() {
    super.initState();
    _animController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 600),
    );
    _fade = CurvedAnimation(
      parent: _animController,
      curve: const Interval(0.0, 0.6, curve: Curves.easeOut),
    );
    _slide = Tween<Offset>(
      begin: const Offset(0, 0.04),
      end: Offset.zero,
    ).animate(
      CurvedAnimation(
        parent: _animController,
        curve: const Interval(0.15, 1.0, curve: Curves.easeOut),
      ),
    );
    _animController.forward();
  }

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    _animController.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    if (!_formKey.currentState!.validate()) return;
    HapticFeedback.lightImpact();
    ref.read(authProvider.notifier).clearError();
    setState(() => _loading = true);
    await ref
        .read(authProvider.notifier)
        .signIn(email: _emailController.text, password: _passwordController.text);
    if (!mounted) return;
    setState(() => _loading = false);
    // No manual navigation: the router redirect reacts to the auth state.
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      body: Stack(
        children: [
          const AuthBackgroundDecor(),
          SafeArea(
            child: FadeTransition(
              opacity: _fade,
              child: SlideTransition(
                position: _slide,
                child: SingleChildScrollView(
                  padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceLg,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const SizedBox(height: DesignTokens.spaceXxl),
                      const Center(child: BrandLogo()),
                      const SizedBox(height: DesignTokens.spaceLg),
                      Text(
                        'Welcome Back',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                              fontWeight: FontWeight.w800,
                              color: AppColors.textPrimary,
                            ),
                      ),
                      const SizedBox(height: DesignTokens.spaceXs),
                      Text(
                        'Sign in to your driver account',
                        textAlign: TextAlign.center,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: AppColors.textSecondary,
                            ),
                      ),
                      const SizedBox(height: DesignTokens.spaceXl),
                      if (!firebaseConfigured) ...[
                        const FirebaseNotConfiguredCard(),
                        const SizedBox(height: DesignTokens.spaceLg),
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
                                  label: 'Email',
                                  hint: 'driver@email.com',
                                  controller: _emailController,
                                  keyboardType: TextInputType.emailAddress,
                                  prefixIcon: Icons.email_outlined,
                                  validator: _validateEmail,
                                  onChanged: (_) => _clearErrorIfAny(),
                                ),
                                const SizedBox(height: DesignTokens.spaceMd),
                                PasswordField(
                                  controller: _passwordController,
                                  validator: _validatePassword,
                                ),
                                Align(
                                  alignment: Alignment.centerRight,
                                  child: TextButton(
                                    onPressed: _loading
                                        ? null
                                        : () => context.push('/forgot-password'),
                                    child: const Text('Forgot password?'),
                                  ),
                                ),
                                const SizedBox(height: DesignTokens.spaceSm),
                                PrimaryButton(
                                  text: 'Sign In',
                                  icon: Icons.login_rounded,
                                  isLoading: _loading,
                                  onPressed: _signIn,
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
                            "Don't have an account? ",
                            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  color: AppColors.textSecondary,
                                ),
                          ),
                          GestureDetector(
                            onTap: _loading ? null : () => context.go('/register'),
                            child: Text(
                              'Sign up',
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

  String? _validatePassword(String? value) {
    if (value == null || value.isEmpty) return 'Password is required';
    return null;
  }

  void _clearErrorIfAny() {
    if (ref.read(authProvider).error != null) {
      ref.read(authProvider.notifier).clearError();
    }
  }
}
