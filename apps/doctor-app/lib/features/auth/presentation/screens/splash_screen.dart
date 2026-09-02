import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/constants/app_constants.dart';
import '../../../../core/navigation/deep_link_handler.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/smartcura_logo.dart';

/// Splash Screen — branded launch with animated logo and tagline.
///
/// Watches [authProvider] and navigates once the bootstrap state resolves.
/// A minimum 2-second display window keeps the branding visible even when
/// the session cookie is still warm and bootstrap resolves in milliseconds.
class SplashScreen extends ConsumerStatefulWidget {
  const SplashScreen({super.key});

  @override
  ConsumerState<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends ConsumerState<SplashScreen>
    with TickerProviderStateMixin {
  late AnimationController _logoController;
  late AnimationController _textController;
  late AnimationController _loaderController;
  late AnimationController _glowController;
  late AnimationController _particleController;

  late Animation<double> _logoScale;
  late Animation<double> _logoOpacity;
  late Animation<double> _textOpacity;
  late Animation<Offset> _textSlide;
  late Animation<double> _loaderOpacity;
  late Animation<double> _glowPulse;

  bool _hasNavigated = false;
  DateTime _createdAt = DateTime.now();

  @override
  void initState() {
    super.initState();
    _initializeAnimations();
    _startAnimationSequence();
  }

  void _initializeAnimations() {
    _logoController = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );
    _logoScale = Tween<double>(begin: 0.6, end: 1.0).animate(
      CurvedAnimation(parent: _logoController, curve: Curves.easeOutBack),
    );
    _logoOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(
        parent: _logoController,
        curve: const Interval(0.0, 0.7, curve: Curves.easeOut),
      ),
    );

    _textController = AnimationController(
      duration: const Duration(milliseconds: 400),
      vsync: this,
    );
    _textOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _textController, curve: Curves.easeOut),
    );
    _textSlide = Tween<Offset>(
      begin: const Offset(0, 0.3),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _textController, curve: Curves.easeOut));

    _loaderController = AnimationController(
      duration: const Duration(milliseconds: 300),
      vsync: this,
    );
    _loaderOpacity = Tween<double>(begin: 0.0, end: 1.0).animate(
      CurvedAnimation(parent: _loaderController, curve: Curves.easeIn),
    );

    _glowController = AnimationController(
      duration: const Duration(milliseconds: 2000),
      vsync: this,
    )..repeat(reverse: true);
    _glowPulse = Tween<double>(begin: 0.15, end: 0.45).animate(
      CurvedAnimation(parent: _glowController, curve: Curves.easeInOut),
    );

    // Subtle floating particles in the background.
    _particleController = AnimationController(
      duration: const Duration(milliseconds: 4000),
      vsync: this,
    )..repeat();
  }

  void _startAnimationSequence() async {
    await Future.delayed(const Duration(milliseconds: 200));
    if (!mounted) return;
    _logoController.forward();

    await Future.delayed(const Duration(milliseconds: 400));
    if (!mounted) return;
    _textController.forward();

    await Future.delayed(const Duration(milliseconds: 300));
    if (!mounted) return;
    _loaderController.forward();
  }

  void _onAuthStateChanged(AuthState state) {
    if (_hasNavigated || state.status == AuthStatus.unknown) return;
    _hasNavigated = true;

    final elapsed = DateTime.now().difference(_createdAt).inMilliseconds;
    const minDisplay = 2000;
    final remaining = elapsed < minDisplay ? minDisplay - elapsed : 0;

    Future.delayed(Duration(milliseconds: remaining), () {
      if (!mounted) return;
      _navigateBasedOnState(state);
    });
  }

  void _navigateBasedOnState(AuthState state) {
    if (state.status == AuthStatus.authenticated) {
      final bootstrap = state.bootstrapState;
      if (bootstrap == BootstrapState.verificationPending) {
        context.go('/verification-pending');
      } else if (bootstrap == BootstrapState.profileRequired) {
        context.go('/onboarding');
      } else {
        // A deep link that launched the app before the session was restored
        // is stashed in the handler; prefer it over the dashboard, once.
        final pending =
            ref.read(deepLinkHandlerProvider).consumePendingLocation();
        context.go(pending ?? '/dashboard');
      }
    } else {
      _checkOnboardingAndNavigate();
    }
  }

  Future<void> _checkOnboardingAndNavigate() async {
    final prefs = await SharedPreferences.getInstance();
    final onboardingCompleted = prefs.getBool('onboardingCompleted') ?? false;
    if (mounted) {
      context.go(onboardingCompleted ? '/login' : '/onboarding');
    }
  }

  @override
  void dispose() {
    _logoController.dispose();
    _textController.dispose();
    _loaderController.dispose();
    _glowController.dispose();
    _particleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);

    ref.listen<AuthState>(authProvider, (prev, next) {
      _onAuthChanged(next);
    });
    _onAuthChanged(authState);

    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.primaryDark,
        systemNavigationBarIconBrightness: Brightness.light,
      ),
    );

    return Scaffold(
      body: Stack(
        children: [
          // Background gradient.
          Container(
            width: double.infinity,
            height: double.infinity,
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  AppColors.primary,
                  AppColors.primaryDark,
                  AppColors.secondaryDark,
                ],
                stops: [0.0, 0.55, 1.0],
              ),
            ),
          ),

          // Floating particle orbs.
          ..._buildParticles(),

          // Main content.
          SafeArea(
            child: Column(
              children: [
                const Spacer(),

                // Central brand content.
                Expanded(
                  flex: 2,
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      // Logo with glow.
                      Stack(
                        alignment: Alignment.center,
                        children: [
                          // Pulsing glow.
                          AnimatedBuilder(
                            animation: _glowController,
                            builder: (context, child) {
                              return Container(
                                width: 180,
                                height: 180,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: Colors.white
                                      .withOpacity(_glowPulse.value * 0.12),
                                ),
                              );
                            },
                          ),
                          // Second glow ring.
                          AnimatedBuilder(
                            animation: _glowController,
                            builder: (context, child) {
                              return Container(
                                width: 140,
                                height: 140,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: Colors.white
                                      .withOpacity(_glowPulse.value * 0.08),
                                ),
                              );
                            },
                          ),
                          // Logo.
                          AnimatedBuilder(
                            animation: _logoController,
                            builder: (context, child) {
                              return Opacity(
                                opacity: _logoOpacity.value,
                                child: Transform.scale(
                                  scale: _logoScale.value,
                                  child: Container(
                                    width: 110,
                                    height: 110,
                                    decoration: BoxDecoration(
                                      color: Colors.white.withOpacity(0.12),
                                      borderRadius: BorderRadius.circular(
                                        DesignTokens.radiusXl,
                                      ),
                                      border: Border.all(
                                        color: Colors.white.withOpacity(0.2),
                                        width: 1.5,
                                      ),
                                      boxShadow: [
                                        BoxShadow(
                                          color: Colors.white.withOpacity(0.15),
                                          blurRadius: 30,
                                          spreadRadius: 4,
                                        ),
                                      ],
                                    ),
                                    child: const SmartCuraLogo(size: 70),
                                  ),
                                ),
                              );
                            },
                          ),
                        ],
                      ),

                      const SizedBox(height: DesignTokens.spaceLg),

                      // Animated text.
                      AnimatedBuilder(
                        animation: _textController,
                        builder: (context, child) {
                          return Opacity(
                            opacity: _textOpacity.value,
                            child: SlideTransition(
                              position: _textSlide,
                              child: Column(
                                children: [
                                  Text(
                                    AppConstants.appName,
                                    style: const TextStyle(
                                      fontSize: 32,
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.white,
                                      letterSpacing: -0.5,
                                    ),
                                    textAlign: TextAlign.center,
                                  ),
                                  const SizedBox(height: 6),
                                  Text(
                                    AppConstants.appDescription,
                                    style: TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w500,
                                      color: Colors.white.withOpacity(0.7),
                                    ),
                                    textAlign: TextAlign.center,
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ],
                  ),
                ),

                // Bottom status area.
                Expanded(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.end,
                    children: [
                      // Loading indicator.
                      AnimatedBuilder(
                        animation: _loaderController,
                        builder: (context, child) {
                          return Opacity(
                            opacity: _loaderOpacity.value,
                            child: SizedBox(
                              width: 28,
                              height: 28,
                              child: CircularProgressIndicator(
                                strokeWidth: 2.5,
                                valueColor: AlwaysStoppedAnimation<Color>(
                                  Colors.white.withOpacity(0.8),
                                ),
                                backgroundColor: Colors.white.withOpacity(0.15),
                              ),
                            ),
                          );
                        },
                      ),
                      const SizedBox(height: DesignTokens.spaceXl),
                      // Version.
                      AnimatedBuilder(
                        animation: _loaderController,
                        builder: (context, child) {
                          return Opacity(
                            opacity: _loaderOpacity.value,
                            child: Text(
                              'v${AppConstants.appVersion}',
                              style: TextStyle(
                                fontSize: 11,
                                fontWeight: FontWeight.w500,
                                color: Colors.white.withOpacity(0.4),
                                letterSpacing: 0.5,
                              ),
                            ),
                          );
                        },
                      ),
                      const SizedBox(height: DesignTokens.space2xl),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// Subtle floating orbs that drift across the background.
  List<Widget> _buildParticles() {
    final orbs = <Widget>[];
    final configs = [
      (0.15, 0.25, 60.0, 0.06),
      (0.75, 0.15, 40.0, 0.04),
      (0.85, 0.65, 50.0, 0.05),
      (0.10, 0.70, 35.0, 0.03),
    ];

    for (final (x, y, size, opacity) in configs) {
      orbs.add(
        Positioned(
          left: x * MediaQuery.of(context).size.width,
          top: y * MediaQuery.of(context).size.height,
          child: AnimatedBuilder(
            animation: _particleController,
            builder: (context, child) {
              final t = _particleController.value;
              return Transform.translate(
                offset: Offset(0, 15 * (0.5 - t).abs() - 7),
                child: Container(
                  width: size,
                  height: size,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: Colors.white.withOpacity(opacity),
                  ),
                ),
              );
            },
          ),
        ),
      );
    }
    return orbs;
  }

  void _onAuthChanged(AuthState state) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _onAuthStateChanged(state);
    });
  }
}
