import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Shows the driver that their profile is pending verification.
///
/// After registration the backend may return a `verification_pending` bootstrap
/// state, meaning the account exists but an administrator has not yet approved
/// it. This screen lets the driver refresh or sign out while they wait.
class VerificationPendingScreen extends ConsumerWidget {
  const VerificationPendingScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      body: SafeArea(
        child: Stack(
          children: [
            const Positioned.fill(child: AuthBackgroundDecor()),
            Center(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: DesignTokens.screenPaddingHorizontal,
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const BrandLogo(),
                    const SizedBox(height: DesignTokens.spaceLg),
                    Text(
                      'Verification Pending',
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                    ),
                    const SizedBox(height: DesignTokens.spaceSm),
                    Text(
                      'Your account is awaiting administrator approval. '
                      'You will be able to access the app once your profile '
                      'has been verified.',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: AppColors.textSecondary,
                          ),
                    ),
                    const SizedBox(height: DesignTokens.spaceXl),
                    PrimaryButton(
                      text: 'Refresh',
                      icon: Icons.refresh_rounded,
                      onPressed: () {
                        // Re-check session status — the router redirect will
                        // navigate away if verification has been completed.
                        ref.read(authProvider.notifier).bootstrap();
                      },
                    ),
                    const SizedBox(height: DesignTokens.spaceSm),
                    TextButton(
                      onPressed: () async {
                        await ref.read(authProvider.notifier).signOut();
                        if (context.mounted) context.go('/login');
                      },
                      child: const Text('Sign Out'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
