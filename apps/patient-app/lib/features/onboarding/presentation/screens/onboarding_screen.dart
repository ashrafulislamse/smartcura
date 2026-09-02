import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../core/constants/app_strings.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/buttons/primary_button.dart';
import '../../../../core/widgets/premium_card.dart';

/// Onboarding Screen — premium carousel flow.
///
/// Each slide uses a gradient hero circle, a [PremiumCard] for the textual
/// content, and animated page indicators. On "Get Started" the
/// [hasSeenOnboarding] flag is persisted and the user is routed to `/login`.
/// This screen is UI-only — no API calls.
///
/// Overflow-safe: the content area uses [Expanded] + [SingleChildScrollView]
/// so the hero illustration and text card always fit, even on small screens.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen>
    with TickerProviderStateMixin {
  final PageController _pageController = PageController();
  int _currentPage = 0;

  late AnimationController _fadeController;
  late Animation<double> _fadeAnimation;

  static const _pages = <OnboardingPage>[
    OnboardingPage(
      icon: Icons.videocam_rounded,
      title: 'Video Consultations',
      description:
          'Connect with certified doctors from the comfort of your home. '
          'No waiting rooms, just care.',
      gradientColors: [AppColors.primary, AppColors.primaryLight],
    ),
    OnboardingPage(
      icon: Icons.emergency_rounded,
      title: 'Instant Emergency Aid',
      description:
          'Your safety is our priority. With a single tap, alert nearby '
          'emergency services and share your live location.',
      gradientColors: [AppColors.emergency, AppColors.error],
    ),
    OnboardingPage(
      icon: Icons.favorite_rounded,
      title: 'Complete Health Tracking',
      description:
          'Monitor your vitals, medications, and appointments all in one '
          'place. Your health, simplified.',
      gradientColors: [AppColors.secondary, AppColors.secondaryLight],
    ),
    OnboardingPage(
      icon: Icons.local_pharmacy_rounded,
      title: 'Easy Pharmacy Orders',
      description: 'Order medications and get them delivered to your doorstep. '
          'Fast, secure, and convenient.',
      gradientColors: [AppColors.warning, AppColors.warningLight],
    ),
  ];

  @override
  void initState() {
    super.initState();

    _fadeController = AnimationController(
      duration: DesignTokens.animationNormal,
      vsync: this,
    );
    _fadeAnimation = CurvedAnimation(
      parent: _fadeController,
      curve: Curves.easeIn,
    );
    _fadeController.forward();
  }

  @override
  void dispose() {
    _pageController.dispose();
    _fadeController.dispose();
    super.dispose();
  }

  void _onPageChanged(int page) {
    HapticFeedback.selectionClick();
    setState(() => _currentPage = page);
    _fadeController.reset();
    _fadeController.forward();
  }

  void _nextPage() {
    HapticFeedback.lightImpact();
    if (_currentPage < _pages.length - 1) {
      _pageController.nextPage(
        duration: DesignTokens.animationNormal,
        curve: Curves.easeInOut,
      );
    } else {
      _completeOnboarding();
    }
  }

  void _skipOnboarding() {
    HapticFeedback.lightImpact();
    _completeOnboarding();
  }

  Future<void> _completeOnboarding() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('hasSeenOnboarding', true);
    if (mounted) {
      context.go('/login');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            // Header with Skip button.
            Padding(
              padding: EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceMd,
                vertical: DesignTokens.spaceSm,
              ),
              child: Align(
                alignment: Alignment.centerRight,
                child: TextButton(
                  onPressed: _skipOnboarding,
                  child: Text(
                    AppStrings.skip,
                    style: TextStyle(
                      color: AppColors.textSecondary,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),
              ),
            ),

            // PageView — takes all available space between header and footer.
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                onPageChanged: _onPageChanged,
                itemCount: _pages.length,
                itemBuilder: (context, index) => _buildPage(_pages[index]),
              ),
            ),

            // Footer with indicators and button.
            Padding(
              padding: EdgeInsets.fromLTRB(
                DesignTokens.spaceLg,
                0,
                DesignTokens.spaceLg,
                MediaQuery.of(context).padding.bottom + DesignTokens.spaceLg,
              ),
              child: Column(
                children: [
                  // Page indicators.
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: List.generate(
                      _pages.length,
                      (index) => AnimatedContainer(
                        duration: DesignTokens.animationNormal,
                        margin: const EdgeInsets.symmetric(
                          horizontal: DesignTokens.spaceXs,
                        ),
                        height: 8,
                        width: _currentPage == index ? 32 : 8,
                        decoration: BoxDecoration(
                          color: _currentPage == index
                              ? AppColors.primary
                              : AppColors.border,
                          borderRadius: BorderRadius.circular(
                            DesignTokens.radiusFull,
                          ),
                          boxShadow: _currentPage == index
                              ? [
                                  BoxShadow(
                                    color: AppColors.primary.withOpacity(0.3),
                                    blurRadius: 8,
                                    spreadRadius: 0,
                                  ),
                                ]
                              : null,
                        ),
                      ),
                    ),
                  ),

                  SizedBox(height: DesignTokens.spaceLg),

                  // Next / Get Started button.
                  PrimaryButton(
                    text: _currentPage == _pages.length - 1
                        ? AppStrings.getStarted
                        : AppStrings.next,
                    onPressed: _nextPage,
                    icon: Icons.arrow_forward_rounded,
                    width: double.infinity,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPage(OnboardingPage page) {
    return LayoutBuilder(
      builder: (context, constraints) {
        return SingleChildScrollView(
          padding: EdgeInsets.symmetric(
            horizontal: DesignTokens.spaceLg,
            vertical: DesignTokens.spaceSm,
          ),
          physics: const BouncingScrollPhysics(),
          child: ConstrainedBox(
            constraints: BoxConstraints(
              minHeight: constraints.maxHeight,
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                // Gradient hero circle with icon.
                _GradientHero(page: page),

                SizedBox(height: DesignTokens.space2xl),

                // Textual content inside a premium card.
                FadeTransition(
                  opacity: _fadeAnimation,
                  child: PremiumCard(
                    margin: EdgeInsets.zero,
                    padding: const EdgeInsets.all(DesignTokens.spaceLg),
                    child: Column(
                      children: [
                        Text(
                          page.title,
                          style: Theme.of(context)
                              .textTheme
                              .headlineMedium
                              ?.copyWith(
                                fontWeight: FontWeight.w800,
                                fontSize: 26,
                                letterSpacing: -0.5,
                              ),
                          textAlign: TextAlign.center,
                        ),
                        SizedBox(height: DesignTokens.spaceMd),
                        Text(
                          page.description,
                          style:
                              Theme.of(context).textTheme.bodyLarge?.copyWith(
                                    color: AppColors.textSecondary,
                                    height: 1.6,
                                  ),
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// A circular hero illustration with a layered gradient and a centered icon.
class _GradientHero extends StatelessWidget {
  final OnboardingPage page;

  const _GradientHero({required this.page});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 240,
      height: 240,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(
          colors: page.gradientColors.map((c) => c.withOpacity(0.08)).toList(),
        ),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Outer glow.
          Container(
            width: 180,
            height: 180,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: RadialGradient(
                colors: page.gradientColors
                    .map((c) => c.withOpacity(0.12))
                    .toList(),
              ),
            ),
          ),
          // Icon disc.
          Container(
            width: 112,
            height: 112,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: LinearGradient(
                colors: page.gradientColors,
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              boxShadow: [
                BoxShadow(
                  color: page.gradientColors.first.withOpacity(0.3),
                  blurRadius: 24,
                  spreadRadius: 0,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Icon(
              page.icon,
              size: 56,
              color: Colors.white,
            ),
          ),
        ],
      ),
    );
  }
}

class OnboardingPage {
  final IconData icon;
  final String title;
  final String description;
  final List<Color> gradientColors;

  const OnboardingPage({
    required this.icon,
    required this.title,
    required this.description,
    required this.gradientColors,
  });
}
