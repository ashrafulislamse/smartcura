import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/constants/app_constants.dart';
import '../../../../core/constants/app_strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// Splash Screen — premium animated brand splash with real session restore.
///
/// On init the notifier's [AuthNotifier.restoreSession] is called. While the
/// status is [AuthStatus.unknown] the animated splash is shown. When the
/// session is restored the router auto-redirects based on the bootstrap state.
/// When unauthenticated the splash checks [hasSeenOnboarding] and routes to
/// either `/onboarding` or `/login`. On a network error a retry affordance is
/// shown instead of leaving the user on a spinner.
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with TickerProviderStateMixin {
  late AnimationController _controller;
  late Animation<double> _fadeAnimation;
  late Animation<double> _scaleAnimation;
  late AnimationController _pulseController;
  late Animation<double> _pulseAnimation;

  bool _restoreStarted = false;
  bool _navigated = false;

  @override
  void initState() {
    super.initState();

    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarColor: Colors.transparent,
        systemNavigationBarIconBrightness: Brightness.light,
      ),
    );

    _controller = AnimationController(
      duration: const Duration(milliseconds: 900),
      vsync: this,
    );

    _fadeAnimation = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeIn),
    );

    _scaleAnimation = Tween<double>(begin: 0.85, end: 1.0).animate(
      CurvedAnimation(parent: _controller, curve: Curves.easeOutBack),
    );

    // Continuous pulse behind the logo.
    _pulseController = AnimationController(
      duration: const Duration(milliseconds: 2000),
      vsync: this,
    )..repeat(reverse: true);

    _pulseAnimation = Tween<double>(begin: 0.4, end: 1.0).animate(
      CurvedAnimation(parent: _pulseController, curve: Curves.easeInOut),
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      _controller.forward();
      _startRestore();
    });
  }

  Future<void> _startRestore() async {
    if (_restoreStarted) return;
    _restoreStarted = true;
    await ref.read(authProvider.notifier).restoreSession();
  }

  /// Called from [build] whenever auth state changes. Handles the
  /// unauthenticated branch (router handles authenticated automatically).
  void _maybeNavigate(AuthState auth) {
    if (_navigated) return;
    if (auth.status == AuthStatus.unauthenticated) {
      _navigated = true;
      _navigateAfterRestore();
    }
  }

  Future<void> _navigateAfterRestore() async {
    await Future<void>.delayed(const Duration(milliseconds: 500));
    if (!mounted) return;
    final prefs = await SharedPreferences.getInstance();
    final hasSeenOnboarding = prefs.getBool('hasSeenOnboarding') ?? false;
    if (!mounted) return;
    context.go(hasSeenOnboarding ? '/login' : '/onboarding');
  }

  @override
  void dispose() {
    _controller.dispose();
    _pulseController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    _maybeNavigate(auth);

    final size = MediaQuery.of(context).size;
    final hasError =
        auth.status == AuthStatus.unknown && auth.errorMessage != null;

    return Scaffold(
      body: SizedBox(
        width: size.width,
        height: size.height,
        child: Container(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                AppColors.primary,
                AppColors.primaryDark,
              ],
            ),
          ),
          child: Stack(
            children: [
              // Decorative radial glow top-left.
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: RadialGradient(
                      center: Alignment.topLeft,
                      radius: 1.5,
                      colors: [
                        Colors.white.withValues(alpha: 0.15),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),
              // Decorative radial glow bottom-right.
              Positioned.fill(
                child: DecoratedBox(
                  decoration: BoxDecoration(
                    gradient: RadialGradient(
                      center: Alignment.bottomRight,
                      radius: 1.2,
                      colors: [
                        AppColors.secondary.withValues(alpha: 0.1),
                        Colors.transparent,
                      ],
                    ),
                  ),
                ),
              ),
              // Main content.
              SafeArea(
                child: SizedBox(
                  width: double.infinity,
                  child: Column(
                    children: [
                      const Spacer(),

                      // Brand section.
                      FadeTransition(
                        opacity: _fadeAnimation,
                        child: ScaleTransition(
                          scale: _scaleAnimation,
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              // Pulsing glow behind logo.
                              AnimatedBuilder(
                                animation: _pulseAnimation,
                                builder: (context, child) {
                                  return Container(
                                    height: 160,
                                    width: 160,
                                    decoration: BoxDecoration(
                                      shape: BoxShape.circle,
                                      color: Colors.white.withValues(
                                          alpha: 0.08 * _pulseAnimation.value),
                                    ),
                                    child: child,
                                  );
                                },
                                child: Container(
                                  height: 120,
                                  width: 120,
                                  decoration: BoxDecoration(
                                    color: Colors.white.withValues(alpha: 0.12),
                                    borderRadius: BorderRadius.circular(
                                      DesignTokens.radiusXl,
                                    ),
                                    border: Border.all(
                                      color:
                                          Colors.white.withValues(alpha: 0.3),
                                      width: DesignTokens.borderWidthThin,
                                    ),
                                    boxShadow: [
                                      BoxShadow(
                                        color:
                                            Colors.white.withValues(alpha: 0.3),
                                        blurRadius: 40,
                                        spreadRadius: 0,
                                      ),
                                    ],
                                  ),
                                  child: const Icon(
                                    Icons.health_and_safety_rounded,
                                    size: 64,
                                    color: Colors.white,
                                  ),
                                ),
                              ),

                              const SizedBox(height: DesignTokens.space2xl),

                              // App name.
                              Text(
                                AppStrings.appName,
                                style: Theme.of(context)
                                    .textTheme
                                    .headlineLarge
                                    ?.copyWith(
                                      color: Colors.white,
                                      fontWeight: FontWeight.bold,
                                      fontSize: 34,
                                      letterSpacing: -0.5,
                                    ),
                              ),

                              const SizedBox(height: DesignTokens.spaceSm),

                              // Tagline.
                              Text(
                                AppStrings.appTagline,
                                style: Theme.of(context)
                                    .textTheme
                                    .bodyLarge
                                    ?.copyWith(
                                      color: Colors.white.withOpacity(0.85),
                                      fontWeight: FontWeight.w500,
                                      letterSpacing: 0.5,
                                    ),
                              ),
                            ],
                          ),
                        ),
                      ),

                      const Spacer(),

                      // Bottom: loading or retry.
                      if (hasError)
                        _RetrySection(
                          message: auth.errorMessage!,
                          onRetry: () {
                            _restoreStarted = false;
                            _navigated = false;
                            ref.read(authProvider.notifier).restoreSession();
                          },
                        )
                      else
                        FadeTransition(
                          opacity: _fadeAnimation,
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              SizedBox(
                                height: 32,
                                width: 32,
                                child: CircularProgressIndicator(
                                  strokeWidth: 3,
                                  valueColor: AlwaysStoppedAnimation<Color>(
                                    Colors.white.withOpacity(0.9),
                                  ),
                                  backgroundColor:
                                      Colors.white.withOpacity(0.2),
                                ),
                              ),
                              const SizedBox(height: DesignTokens.spaceLg),
                              Text(
                                'v${AppConstants.appVersion}',
                                style: Theme.of(context)
                                    .textTheme
                                    .bodySmall
                                    ?.copyWith(
                                      color: Colors.white.withOpacity(0.5),
                                      fontSize: 12,
                                      fontWeight: FontWeight.w300,
                                      letterSpacing: 2,
                                    ),
                              ),
                              const SizedBox(height: DesignTokens.spaceXl),
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
      ),
    );
  }
}

/// Retry widget shown when the session restore hits a network error.
class _RetrySection extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _RetrySection({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(DesignTokens.spaceLg),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            Icons.wifi_off_rounded,
            color: Colors.white.withOpacity(0.7),
            size: DesignTokens.iconLg,
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          Text(
            message,
            textAlign: TextAlign.center,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: Colors.white.withOpacity(0.85),
                ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          OutlinedButton.icon(
            onPressed: onRetry,
            icon: const Icon(Icons.refresh, color: Colors.white),
            label: const Text(
              'Retry',
              style: TextStyle(color: Colors.white),
            ),
            style: OutlinedButton.styleFrom(
              side: BorderSide(color: Colors.white.withOpacity(0.4)),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceLg,
                vertical: DesignTokens.spaceMd,
              ),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceXl),
        ],
      ),
    );
  }
}
