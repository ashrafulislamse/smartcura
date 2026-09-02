import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Onboarding screen — shown once before the first sign-in.
///
/// Persists a `hasSeenOnboarding` flag in [SharedPreferences] so returning
/// users skip straight to `/login`. Each page transition fires haptic feedback,
/// and the hero area uses a layered radial-gradient with glow shadows.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  static const _hasSeenKey = 'hasSeenOnboarding';

  final PageController _pageController = PageController();
  int _currentPage = 0;
  bool _checking = true;

  static const _pages = <_OnboardingPageData>[
    _OnboardingPageData(
      icon: Icons.local_shipping_rounded,
      title: 'Fast & Reliable Deliveries',
      subtitle:
          'Accept medicine delivery orders in real-time and navigate to patients efficiently with turn-by-turn guidance.',
      glowColor: AppColors.primary,
    ),
    _OnboardingPageData(
      icon: Icons.emergency_rounded,
      title: 'Ambulance Operations',
      subtitle:
          'Respond to emergency SOS calls instantly. Monitor patient vitals and coordinate with hospital dispatch teams.',
      glowColor: AppColors.emergency,
    ),
    _OnboardingPageData(
      icon: Icons.account_balance_wallet_rounded,
      title: 'Track Your Earnings',
      subtitle:
          'View daily, weekly and monthly earnings. Withdraw anytime directly to your bank account.',
      glowColor: AppColors.secondary,
    ),
  ];

  @override
  void initState() {
    super.initState();
    _maybeSkipIfSeen();
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _maybeSkipIfSeen() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;
    if (prefs.getBool(_hasSeenKey) == true) {
      context.go('/login');
      return;
    }
    setState(() => _checking = false);
  }

  Future<void> _finish() async {
    HapticFeedback.mediumImpact();
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(_hasSeenKey, true);
    if (!mounted) return;
    context.go('/login');
  }

  void _next() {
    HapticFeedback.selectionClick();
    if (_currentPage < _pages.length - 1) {
      _pageController.nextPage(
        duration: DesignTokens.animDurationMedium,
        curve: Curves.easeInOut,
      );
    } else {
      _finish();
    }
  }

  void _skip() {
    HapticFeedback.selectionClick();
    _finish();
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final page = _pages[_currentPage];

    return Scaffold(
      body: Stack(
        children: [
          // Layered radial-gradient hero background with glow shadows.
          _HeroBackground(glowColor: page.glowColor),
          SafeArea(
            child: Column(
              children: [
                Align(
                  alignment: Alignment.centerRight,
                  child: Padding(
                    padding: const EdgeInsets.only(
                      top: DesignTokens.spaceSm,
                      right: DesignTokens.spaceMd,
                    ),
                    child: TextButton(
                      onPressed: _skip,
                      child: Text(
                        'Skip',
                        style: TextStyle(
                          color: AppColors.white.withValues(alpha: 0.85),
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
                ),
                Expanded(
                  child: PageView.builder(
                    controller: _pageController,
                    itemCount: _pages.length,
                    onPageChanged: (i) {
                      HapticFeedback.selectionClick();
                      setState(() => _currentPage = i);
                    },
                    itemBuilder: (_, i) => _OnboardingPage(data: _pages[i]),
                  ),
                ),
                _GlowDotIndicator(
                  count: _pages.length,
                  current: _currentPage,
                ),
                const SizedBox(height: DesignTokens.spaceXl),
                Padding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceLg,
                  ),
                  child: PrimaryButton(
                    text: _currentPage == _pages.length - 1
                        ? 'Get Started'
                        : 'Next',
                    icon: Icons.arrow_forward_rounded,
                    onPressed: _next,
                    height: DesignTokens.buttonHeightLg,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceXxl),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Data for a single onboarding page.
class _OnboardingPageData {
  const _OnboardingPageData({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.glowColor,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Color glowColor;
}

/// One onboarding page: glowing icon, title and subtitle inside a PremiumCard.
class _OnboardingPage extends StatelessWidget {
  const _OnboardingPage({required this.data});

  final _OnboardingPageData data;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceLg),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 132,
            height: 132,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: [
                  data.glowColor.withValues(alpha: 0.35),
                  data.glowColor.withValues(alpha: 0.08),
                  Colors.transparent,
                ],
              ),
            ),
            child: Container(
              margin: const EdgeInsets.all(DesignTokens.spaceMd),
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: AppColors.white.withValues(alpha: 0.18),
                boxShadow: [
                  BoxShadow(
                    color: data.glowColor.withValues(alpha: 0.4),
                    blurRadius: 30,
                    spreadRadius: 2,
                  ),
                ],
              ),
              child: Icon(data.icon, size: 56, color: AppColors.white),
            ),
          ),
          const SizedBox(height: DesignTokens.spaceXl),
          PremiumCard(
            child: Column(
              children: [
                Text(
                  data.title,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        height: DesignTokens.lineHeightTight,
                      ),
                ),
                const SizedBox(height: DesignTokens.spaceMd),
                Text(
                  data.subtitle,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: AppColors.textSecondary,
                        height: DesignTokens.lineHeightNormal,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Layered radial-gradient hero background with two glow blobs that recolour
/// to the active page's accent.
class _HeroBackground extends StatelessWidget {
  const _HeroBackground({required this.glowColor});

  final Color glowColor;

  @override
  Widget build(BuildContext context) {
    return Stack(
      children: [
        Container(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: const Alignment(0, -0.6),
              radius: 1.4,
              colors: [
                glowColor.withValues(alpha: 0.9),
                AppColors.primaryDark,
                AppColors.darkBackground,
              ],
            ),
          ),
        ),
        Positioned(
          top: -120,
          right: -120,
          child: Container(
            width: 320,
            height: 320,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: glowColor.withValues(alpha: 0.18),
            ),
          ),
        ),
        Positioned(
          top: 220,
          left: -100,
          child: Container(
            width: 240,
            height: 240,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: AppColors.secondary.withValues(alpha: 0.12),
            ),
          ),
        ),
      ],
    );
  }
}

/// Glowing pill dot indicators for the current page.
class _GlowDotIndicator extends StatelessWidget {
  const _GlowDotIndicator({required this.count, required this.current});

  final int count;
  final int current;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(count, (i) {
        final active = i == current;
        return AnimatedContainer(
          duration: DesignTokens.animDurationMedium,
          curve: Curves.easeInOut,
          margin: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceXs),
          width: active ? 28 : 8,
          height: 8,
          decoration: BoxDecoration(
            color: active ? AppColors.white : AppColors.white.withValues(alpha: 0.3),
            borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
            boxShadow: active
                ? [
                    BoxShadow(
                      color: AppColors.white.withValues(alpha: 0.5),
                      blurRadius: 12,
                      spreadRadius: 1,
                    ),
                  ]
                : null,
          ),
        );
      }),
    );
  }
}
