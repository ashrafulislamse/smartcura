import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/premium_card.dart';

/// Medical ID Intro Screen
///
/// A UI-only onboarding-style intro explaining what a Medical ID is and why it
/// matters. No API calls — the "Set Up" button navigates to the edit profile
/// screen where allergies, conditions, and emergency contacts are managed.
class MedicalIdIntroScreen extends StatelessWidget {
  const MedicalIdIntroScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          children: [
            // Back button row
            Padding(
              padding: const EdgeInsets.symmetric(
                  horizontal: DesignTokens.screenPaddingHorizontal, vertical: DesignTokens.spaceSm),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.gray100,
                    ),
                    child: Material(
                      color: Colors.transparent,
                      child: InkWell(
                        onTap: () => context.pop(),
                        borderRadius: BorderRadius.circular(20),
                        child: const Center(
                          child: Icon(Icons.arrow_back_ios_new,
                              size: 20, color: AppColors.textPrimary),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Expanded(
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(DesignTokens.spaceLg),
                child: Column(
                  children: [
                    const SizedBox(height: DesignTokens.spaceLg),
                    // Hero Illustration
                    Container(
                      width: 128,
                      height: 128,
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.1),
                        shape: BoxShape.circle,
                      ),
                      child: Stack(
                        children: [
                          const Center(
                            child: Icon(Icons.health_and_safety,
                                size: 64, color: AppColors.primary),
                          ),
                          Positioned(
                            bottom: -4,
                            right: -4,
                            child: Container(
                              width: 40,
                              height: 40,
                              decoration: BoxDecoration(
                                color: AppColors.surface,
                                shape: BoxShape.circle,
                                border: Border.all(color: AppColors.background, width: 2),
                                boxShadow: const [
                                  BoxShadow(color: AppColors.shadow, blurRadius: 8),
                                ],
                              ),
                              child: const Icon(Icons.phonelink_lock,
                                  color: AppColors.primary, size: 18),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceXl),
                    // Headline
                    const Text(
                      'Emergency Medical ID',
                      style: TextStyle(
                        fontSize: 32,
                        fontWeight: FontWeight.bold,
                        color: AppColors.textPrimary,
                        height: 1.2,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                    // Body Text
                    const Text(
                      'First responders look for your Medical ID. Create one to allow quick '
                      'access to your medical conditions, allergies, and emergency contacts — '
                      'without needing your passcode.',
                      style: TextStyle(
                        fontSize: 16,
                        color: AppColors.textSecondary,
                        height: 1.5,
                      ),
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: DesignTokens.space2xl),
                    // Features
                    const _FeatureRow(
                      icon: Icons.lock_open,
                      title: 'Accessible from Lock Screen',
                      description: 'Vital info available when phone is locked',
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                    const _FeatureRow(
                      icon: Icons.emergency,
                      title: 'Helps First Responders',
                      description: 'Shows allergies, blood type, and meds',
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                    const _FeatureRow(
                      icon: Icons.contact_phone,
                      title: 'Emergency Contacts',
                      description: 'Quickly call your loved ones',
                    ),
                  ],
                ),
              ),
            ),
            // Bottom Actions
            Container(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              child: Column(
                children: [
                  ElevatedButton(
                    onPressed: () => context.go('/edit-profile'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: AppColors.primary,
                      foregroundColor: AppColors.white,
                      elevation: 0,
                      minimumSize: const Size(double.infinity, 48),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: const Text(
                      'Set Up Medical ID',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  TextButton.icon(
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text(
                              'Your Medical ID data is encrypted and only accessible to you and authorized responders.'),
                          backgroundColor: AppColors.info,
                        ),
                      );
                    },
                    icon: const Icon(Icons.privacy_tip, size: 18),
                    label: const Text(
                      'Learn how your privacy is protected',
                      style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
                    ),
                    style: TextButton.styleFrom(foregroundColor: AppColors.primary),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),
                  const Text(
                    'Medical ID is optional and stored only on your device.',
                    style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FeatureRow extends StatelessWidget {
  final IconData icon;
  final String title;
  final String description;

  const _FeatureRow({
    required this.icon,
    required this.title,
    required this.description,
  });

  @override
  Widget build(BuildContext context) {
    return PremiumCard(
      margin: EdgeInsets.zero,
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              shape: BoxShape.circle,
            ),
            child: Icon(icon, color: AppColors.primary, size: 20),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  description,
                  style: const TextStyle(fontSize: 14, color: AppColors.textSecondary),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
