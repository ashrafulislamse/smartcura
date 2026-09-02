import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Help & Support screen for the driver app.
///
/// Shows FAQs, contact options, and a link to create a support ticket.
class HelpSupportScreen extends ConsumerWidget {
  const HelpSupportScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Help & Support'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded),
          onPressed: () => context.pop(),
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.screenPaddingHorizontal,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const SizedBox(height: DesignTokens.spaceLg),
            PremiumCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      SvgPicture.asset(
                        'assets/illustrations/empty_support.svg',
                        width: 40,
                        height: 40,
                      ),
                      const SizedBox(width: DesignTokens.spaceSm),
                      Text(
                        'Need Help?',
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              fontWeight: FontWeight.w700,
                            ),
                      ),
                    ],
                  ),
                  const SizedBox(height: DesignTokens.spaceSm),
                  Text(
                    'Our support team is here to help you with any questions '
                    'or issues you may have.',
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: AppColors.textSecondary,
                        ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            PremiumCard(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Frequently Asked Questions',
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  _FaqItem(
                    icon: Icons.assignment_rounded,
                    question: 'How do I accept an order?',
                    answer: 'Go to the Available Orders tab and tap Accept '
                        'on any offer card that fits your schedule.',
                  ),
                  _FaqItem(
                    icon: Icons.payments_outlined,
                    question: 'When do I get paid?',
                    answer: 'Your earnings accumulate in real-time. You can '
                        'request a withdrawal to your registered bank account '
                        'at any time from the Earnings screen.',
                  ),
                  _FaqItem(
                    icon: Icons.star_outline_rounded,
                    question: 'How are ratings calculated?',
                    answer: 'Patients rate their delivery experience from 1 '
                        'to 5 stars. Your average is shown on your profile.',
                  ),
                ],
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            PrimaryButton(
              text: 'Contact Support',
              icon: Icons.mail_outline_rounded,
              onPressed: () {
                showDialog(
                  context: context,
                  builder: (context) => AlertDialog(
                    title: const Text('Contact Support'),
                    content: const Column(
                      mainAxisSize: MainAxisSize.min,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Email: support@smartcura.app'),
                        SizedBox(height: 8),
                        Text('Phone: +603 8000 1234'),
                        SizedBox(height: 8),
                        Text(
                          'Available Monday–Friday, 9:00 AM–6:00 PM MYT.',
                          style: TextStyle(fontSize: 12),
                        ),
                      ],
                    ),
                    actions: [
                      TextButton(
                        onPressed: () => Navigator.of(context).pop(),
                        child: const Text('Close'),
                      ),
                    ],
                  ),
                );
              },
            ),
            const SizedBox(height: DesignTokens.spaceLg),
          ],
        ),
      ),
    );
  }
}

class _FaqItem extends StatelessWidget {
  final IconData icon;
  final String question;
  final String answer;

  const _FaqItem({
    required this.icon,
    required this.question,
    required this.answer,
  });

  @override
  Widget build(BuildContext context) {
    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      iconColor: AppColors.primary,
      leading: Icon(icon, color: AppColors.primary, size: DesignTokens.iconMd),
      title: Text(
        question,
        style: Theme.of(context).textTheme.bodyLarge?.copyWith(
              fontWeight: FontWeight.w500,
            ),
      ),
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
          child: Text(
            answer,
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.textSecondary,
                  height: 1.5,
                ),
          ),
        ),
      ],
    );
  }
}
