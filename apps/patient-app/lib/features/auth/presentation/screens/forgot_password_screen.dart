import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/auth/auth_service.dart';
import '../../../../core/auth/firebase_initializer.dart';
import '../../../../core/constants/app_strings.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/auth_widgets.dart';
import '../../../../core/widgets/buttons/primary_button.dart';
import '../../../../core/widgets/inputs/custom_text_field.dart';
import '../../../../core/widgets/premium_card.dart';

/// Forgot Password Screen — real password reset wired to
/// [AuthService.sendPasswordReset].
///
/// Validates the email, calls the auth service to send a Firebase reset
/// email, then transitions to a success state with a "check your email"
/// message. If [firebaseConfigured] is false a prominent warning is shown
/// instead of the form. Errors (network, invalid email) surface inline.
class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen>
    with SingleTickerProviderStateMixin {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  bool _isSubmitting = false;
  bool _emailSent = false;
  String? _inlineError;

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
  }

  @override
  void dispose() {
    _animationController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _handleSendResetLink() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() {
      _isSubmitting = true;
      _inlineError = null;
    });

    try {
      await ref
          .read(authServiceProvider)
          .sendPasswordReset(_emailController.text.trim());

      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _emailSent = true;
      });
    } on ApiError catch (e) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _inlineError = e.userMessage;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _isSubmitting = false;
        _inlineError =
            'Could not send reset link. Please check your connection and try again.';
      });
    }
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
      ),
      body: Stack(
        children: [
          // Background decorative circle.
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
                    top: DesignTokens.spaceLg,
                    bottom: DesignTokens.space2xl + bottomInset,
                  ),
                  child: _emailSent
                      ? _SuccessView(email: _emailController.text.trim())
                      : _buildForm(fbReady),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildForm(bool fbReady) {
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Gradient hero icon.
          Center(
            child: Container(
              height: 88,
              width: 88,
              decoration: BoxDecoration(
                gradient: AppColors.primaryGradient,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withOpacity(0.3),
                    blurRadius: 20,
                    offset: const Offset(0, 8),
                  ),
                ],
              ),
              child: const Icon(
                Icons.lock_reset_rounded,
                size: 44,
                color: Colors.white,
              ),
            ),
          ),

          SizedBox(height: DesignTokens.spaceXl),

          // Title & subtitle.
          Text(
            'Forgot Password?',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                  fontSize: 28,
                  letterSpacing: -0.5,
                ),
          ),
          SizedBox(height: DesignTokens.spaceSm),
          Text(
            "Don't worry, it happens. Enter the email address associated "
            'with your account and we\'ll send you a reset link.',
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                  color: AppColors.textSecondary,
                  height: 1.5,
                ),
          ),
          SizedBox(height: DesignTokens.space2xl),

          // Firebase not configured warning.
          if (!fbReady) ...[
            const FirebaseNotConfiguredCard(
              feature: 'password reset',
            ),
            SizedBox(height: DesignTokens.spaceLg),
          ],

          // Form inside a premium card.
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

                // Email field.
                CustomTextField(
                  label: 'Email Address',
                  hint: 'e.g. jane@example.com',
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
                SizedBox(height: DesignTokens.spaceLg),

                // Send reset link button.
                PrimaryButton(
                  text: 'Send Reset Link',
                  onPressed: fbReady ? _handleSendResetLink : null,
                  isLoading: _isSubmitting,
                  icon: Icons.lock_reset_rounded,
                  semanticLabel: 'Send password reset link',
                ),
              ],
            ),
          ),

          SizedBox(height: DesignTokens.space2xl),

          // How it works card.
          _HowItWorksCard(),

          SizedBox(height: DesignTokens.spaceLg),

          // Back to login.
          Center(
            child: TextButton.icon(
              onPressed: () {
                HapticFeedback.lightImpact();
                context.go('/login');
              },
              icon: const Icon(Icons.arrow_back_rounded, size: 18),
              label: const Text(
                'Back to Log In',
                style: TextStyle(fontWeight: FontWeight.w600),
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

class _HowItWorksCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.primary.withOpacity(0.05),
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.primary.withOpacity(0.1)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(
                Icons.info_outline,
                size: 20,
                color: AppColors.primary,
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              Text(
                'How it works',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          _buildStep(
              context, 1, 'Request a link', 'Enter your email address above.'),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildStep(context, 2, 'Check your inbox',
              "You'll receive a secure reset link."),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildStep(context, 3, 'Verify identity',
              "Click the link to confirm it's you."),
          const SizedBox(height: DesignTokens.spaceSm),
          _buildStep(
              context, 4, 'New password', 'Create a new secure password.'),
        ],
      ),
    );
  }

  Widget _buildStep(
      BuildContext context, int number, String title, String description) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          height: 24,
          width: 24,
          decoration: const BoxDecoration(
            color: AppColors.primary,
            shape: BoxShape.circle,
          ),
          child: Center(
            child: Text(
              number.toString(),
              style: const TextStyle(
                color: Colors.white,
                fontSize: 10,
                fontWeight: FontWeight.bold,
              ),
            ),
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                title,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
              ),
              Text(
                description,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: AppColors.textSecondary,
                      fontSize: 12,
                    ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Success state shown after the reset email is sent.
class _SuccessView extends StatelessWidget {
  final String email;

  const _SuccessView({required this.email});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SizedBox(height: DesignTokens.space2xl),

        // Animated success icon.
        Center(
          child: TweenAnimationBuilder<double>(
            tween: Tween(begin: 0.0, end: 1.0),
            duration: DesignTokens.animationSlow,
            curve: Curves.easeOutBack,
            builder: (context, value, child) {
              return Transform.scale(scale: value, child: child);
            },
            child: Container(
              height: 96,
              width: 96,
              decoration: const BoxDecoration(
                color: AppColors.successContainer,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.mark_email_read_rounded,
                size: 48,
                color: AppColors.successDark,
              ),
            ),
          ),
        ),

        SizedBox(height: DesignTokens.spaceXl),

        PremiumCard(
          margin: EdgeInsets.zero,
          padding: const EdgeInsets.all(DesignTokens.spaceLg),
          child: Column(
            children: [
              Text(
                'Check Your Email',
                style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      fontSize: 24,
                    ),
                textAlign: TextAlign.center,
              ),
              SizedBox(height: DesignTokens.spaceMd),
              Text(
                'We sent a password reset link to',
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      color: AppColors.textSecondary,
                    ),
                textAlign: TextAlign.center,
              ),
              SizedBox(height: DesignTokens.spaceXs),
              Text(
                email,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: AppColors.primary,
                    ),
                textAlign: TextAlign.center,
              ),
              SizedBox(height: DesignTokens.spaceMd),
              Text(
                'Check your email and follow the link to reset your '
                'password. The link will expire after a limited time.',
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppColors.textSecondary,
                      height: 1.5,
                    ),
                textAlign: TextAlign.center,
              ),
              SizedBox(height: DesignTokens.spaceXl),
              PrimaryButton(
                text: 'Back to Log In',
                onPressed: () {
                  HapticFeedback.lightImpact();
                  context.go('/login');
                },
                icon: Icons.arrow_back_rounded,
                width: double.infinity,
              ),
            ],
          ),
        ),

        SizedBox(height: DesignTokens.spaceLg),

        Center(
          child: TextButton(
            onPressed: () {
              HapticFeedback.lightImpact();
              context.go('/forgot-password');
            },
            child: Text(
              "Didn't receive it? Resend",
              style: TextStyle(
                color: AppColors.textSecondary,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ),
      ],
    );
  }
}
