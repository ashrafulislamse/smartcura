import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// Splash screen shown while the auth session is being restored.
///
/// Watches [authProvider] and reacts to its status instead of using a fixed
/// timer:
///  - [AuthStatus.unknown]  → render the branded splash (bootstrap in flight).
///  - [AuthStatus.authenticated] → navigate to `/dashboard`; the router guard
///    then re-routes to `/verification-pending` or `/onboarding` when the
///    bootstrap state demands it.
///  - anything else (unauthenticated / error) → navigate to `/onboarding`,
///    which auto-skips to `/login` when the onboarding flag is already set.
///
/// `main.dart` kicks off `AuthNotifier.bootstrap()` once on launch; this screen
/// only observes the result and hands navigation to the router.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Side-effect: navigate away the moment bootstrap resolves. Using
    // ref.listen (not ref.watch) means the callback fires only on a real state
    // transition, never during build.
    ref.listen<AuthState>(authProvider, (previous, next) {
      if (next.status == AuthStatus.unknown) return;
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!context.mounted) return;
        if (next.status == AuthStatus.authenticated) {
          context.go('/dashboard');
        } else {
          context.go('/onboarding');
        }
      });
    });

    return Scaffold(
      body: Container(
        decoration: const BoxDecoration(gradient: AppColors.primaryGradient),
        child: SafeArea(
          child: Column(
            children: [
              Expanded(
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      // White logo mark. BrandLogo's icon is hardcoded white,
                      // so a white gradient would render an invisible icon;
                      // build a white container with the brand icon instead.
                      Container(
                        width: 104,
                        height: 104,
                        decoration: BoxDecoration(
                          color: AppColors.white,
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusXxl),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.25),
                              blurRadius: 30,
                              offset: const Offset(0, 12),
                            ),
                          ],
                        ),
                        child: const Icon(
                          Icons.local_shipping_rounded,
                          color: AppColors.primary,
                          size: 52,
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceXl),
                      const Text(
                        'SmartCura',
                        style: TextStyle(
                          fontSize: 36,
                          fontWeight: FontWeight.w800,
                          color: AppColors.white,
                          letterSpacing: DesignTokens.letterSpacingTight,
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceSm),
                      Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: DesignTokens.spaceMd,
                          vertical: DesignTokens.spaceXs + 2,
                        ),
                        decoration: BoxDecoration(
                          color: AppColors.white.withValues(alpha: 0.15),
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusFull),
                          border: Border.all(
                            color: AppColors.white.withValues(alpha: 0.3),
                          ),
                        ),
                        child: const Text(
                          'Driver Portal',
                          style: TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                            color: AppColors.white,
                            letterSpacing: DesignTokens.letterSpacingWider,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              Padding(
                padding: const EdgeInsets.only(bottom: DesignTokens.spaceXxl),
                child: Column(
                  children: [
                    SizedBox(
                      width: 28,
                      height: 28,
                      child: CircularProgressIndicator(
                        color: AppColors.white.withValues(alpha: 0.7),
                        strokeWidth: 2.5,
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                    Text(
                      'Delivery & Ambulance Operations',
                      style: TextStyle(
                        color: AppColors.white.withValues(alpha: 0.7),
                        fontSize: 13,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
