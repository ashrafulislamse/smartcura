import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/smartcura_logo.dart';

/// Premium Onboarding Screen — 3-slide carousel for the doctor app.
///
/// Stateful (UI-only, no Riverpod). "Get Started" persists
/// `onboardingCompleted` to [SharedPreferences] and navigates to `/login`.
class OnboardingScreen extends StatefulWidget {
  const OnboardingScreen({super.key});

  @override
  State<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends State<OnboardingScreen>
    with SingleTickerProviderStateMixin {
  final PageController _pageController = PageController();
  int _currentPage = 0;
  late AnimationController _fadeController;

  final List<_OnboardingSlide> _slides = const [
    _OnboardingSlide(
      icon: Icons.calendar_today_rounded,
      title: 'Manage Appointments',
      description:
          'Effortlessly accept new patient requests and organize your daily '
          'schedule. Sync your availability in real-time and never miss a '
          'booking.',
      gradientColors: [AppColors.primary, AppColors.primaryLight],
    ),
    _OnboardingSlide(
      icon: Icons.video_call_rounded,
      title: 'Video Consultations',
      description:
          'Connect with patients securely through HD video calls. Diagnose '
          'remotely and issue e-prescriptions instantly within the app.',
      gradientColors: [AppColors.accent, AppColors.accentLight],
    ),
    _OnboardingSlide(
      icon: Icons.psychology_rounded,
      title: 'IoT + AI Insights',
      description:
          'Leverage IoT integration for real-time patient vitals and utilize '
          'our AI assistant for data-driven diagnostic support at the bedside.',
      gradientColors: [AppColors.secondary, AppColors.secondaryLight],
    ),
  ];

  @override
  void initState() {
    super.initState();
    _fadeController = AnimationController(
      duration: const Duration(milliseconds: 400),
      vsync: this,
    );
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
    );
  }

  @override
  void dispose() {
    _pageController.dispose();
    _fadeController.dispose();
    super.dispose();
  }

  void _onPageChanged(int page) {
    setState(() => _currentPage = page);
    _fadeController.forward(from: 0);
  }

  void _nextPage() {
    if (_currentPage < _slides.length - 1) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 350),
        curve: Curves.easeInOut,
      );
    } else {
      _completeOnboarding();
    }
  }

  void _skipOnboarding() {
    _completeOnboarding();
  }

  Future<void> _completeOnboarding() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('onboardingCompleted', true);
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
            // Top bar with logo + skip.
            Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceMd,
                vertical: DesignTokens.spaceSm,
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          gradient: AppColors.primaryGradient,
                          borderRadius: BorderRadius.circular(
                            DesignTokens.radiusSm,
                          ),
                          boxShadow: [
                            BoxShadow(
                              color: AppColors.primary.withOpacity(0.2),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: const SmartCuraLogo(
                            size: 26, color: AppColors.white),
                      ),
                      const SizedBox(width: DesignTokens.spaceSm),
                      Text(
                        'SmartCura',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          color: AppColors.primary,
                          letterSpacing: -0.3,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(
                          color: AppColors.primaryContainer,
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusFull),
                        ),
                        child: Text(
                          'Doctor',
                          style: TextStyle(
                            fontSize: 10,
                            fontWeight: FontWeight.w700,
                            color: AppColors.primaryDark,
                          ),
                        ),
                      ),
                    ],
                  ),
                  TextButton(
                    onPressed: _skipOnboarding,
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.gray500,
                      padding: const EdgeInsets.symmetric(
                        horizontal: DesignTokens.spaceMd,
                        vertical: DesignTokens.spaceSm,
                      ),
                    ),
                    child: const Text(
                      'Skip',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),

            // PageView.
            Expanded(
              child: PageView.builder(
                controller: _pageController,
                onPageChanged: _onPageChanged,
                itemCount: _slides.length,
                itemBuilder: (context, index) {
                  return _OnboardingSlideWidget(
                    slide: _slides[index],
                    isActive: index == _currentPage,
                  );
                },
              ),
            ),

            // Page indicators.
            Padding(
              padding: const EdgeInsets.symmetric(
                vertical: DesignTokens.spaceMd,
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: List.generate(
                  _slides.length,
                  (index) => _PageIndicator(isActive: index == _currentPage),
                ),
              ),
            ),

            // Bottom action button.
            Padding(
              padding: const EdgeInsets.fromLTRB(
                DesignTokens.spaceLg,
                0,
                DesignTokens.spaceLg,
                DesignTokens.spaceXl,
              ),
              child: SizedBox(
                width: double.infinity,
                height: DesignTokens.buttonHeightLg,
                child: ElevatedButton(
                  onPressed: _nextPage,
                  style: ElevatedButton.styleFrom(
                    backgroundColor: AppColors.primary,
                    foregroundColor: AppColors.white,
                    elevation: 0,
                    shadowColor: AppColors.shadowPrimary,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(
                        DesignTokens.radiusLg,
                      ),
                    ),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        _currentPage == _slides.length - 1
                            ? 'Get Started'
                            : 'Continue',
                        style: const TextStyle(
                          fontSize: 16,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(width: DesignTokens.spaceSm),
                      const Icon(Icons.arrow_forward_rounded, size: 20),
                    ],
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Onboarding slide data.
class _OnboardingSlide {
  const _OnboardingSlide({
    required this.icon,
    required this.title,
    required this.description,
    required this.gradientColors,
  });

  final IconData icon;
  final String title;
  final String description;
  final List<Color> gradientColors;
}

/// Onboarding slide widget with a premium illustration card.
class _OnboardingSlideWidget extends StatelessWidget {
  const _OnboardingSlideWidget({
    required this.slide,
    required this.isActive,
  });

  final _OnboardingSlide slide;
  final bool isActive;

  @override
  Widget build(BuildContext context) {
    return AnimatedOpacity(
      opacity: isActive ? 1.0 : 0.4,
      duration: const Duration(milliseconds: 300),
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceXl,
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Illustration card.
            TweenAnimationBuilder<double>(
              tween: Tween(begin: 0.8, end: 1.0),
              duration: const Duration(milliseconds: 700),
              curve: Curves.elasticOut,
              builder: (context, scale, child) {
                return Transform.scale(scale: scale, child: child);
              },
              child: Container(
                width: 180,
                height: 180,
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: slide.gradientColors,
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(
                    DesignTokens.radius3xl,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: slide.gradientColors.first.withOpacity(0.25),
                      blurRadius: 24,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: Stack(
                  alignment: Alignment.center,
                  children: [
                    // Decorative circles.
                    Positioned(
                      top: -20,
                      right: -20,
                      child: Container(
                        width: 70,
                        height: 70,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withOpacity(0.1),
                        ),
                      ),
                    ),
                    Positioned(
                      bottom: -15,
                      left: -15,
                      child: Container(
                        width: 50,
                        height: 50,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: Colors.white.withOpacity(0.08),
                        ),
                      ),
                    ),
                    // Main icon.
                    Icon(
                      slide.icon,
                      size: 80,
                      color: AppColors.white,
                    ),
                  ],
                ),
              ),
            ),

            const SizedBox(height: DesignTokens.space2xl),

            // Title.
            Text(
              slide.title,
              style: const TextStyle(
                fontSize: 26,
                fontWeight: FontWeight.w800,
                color: AppColors.gray900,
                letterSpacing: -0.5,
              ),
              textAlign: TextAlign.center,
            ),

            const SizedBox(height: DesignTokens.spaceMd),

            // Description.
            Text(
              slide.description,
              style: const TextStyle(
                fontSize: 15,
                color: AppColors.gray500,
                height: 1.6,
              ),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

/// Animated page indicator dot.
class _PageIndicator extends StatelessWidget {
  const _PageIndicator({required this.isActive});

  final bool isActive;

  @override
  Widget build(BuildContext context) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      curve: Curves.easeInOut,
      margin: const EdgeInsets.symmetric(horizontal: 4),
      width: isActive ? 28 : 8,
      height: 8,
      decoration: BoxDecoration(
        color: isActive ? AppColors.primary : AppColors.gray300,
        borderRadius: BorderRadius.circular(4),
      ),
    );
  }
}
