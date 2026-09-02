import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// Emergency SOS button — compact, professional design.
///
/// Shows a prominent red gradient bar with an SOS icon and label.
/// Tapping opens a confirmation dialog before navigating to the
/// emergency-sos flow, preventing accidental triggers.
class EmergencyButton extends StatelessWidget {
  final VoidCallback? onPressed;

  const EmergencyButton({super.key, this.onPressed});

  void _handleEmergencyTap(BuildContext context) {
    HapticFeedback.mediumImpact();
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        backgroundColor: AppColors.surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        ),
        title: const Text(
          'Emergency Alert',
          style: TextStyle(
            fontSize: 18,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        content: const Text(
          'Are you experiencing a medical emergency? This will alert emergency services and your emergency contacts.',
          style: TextStyle(
            fontSize: 14,
            color: AppColors.textSecondary,
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: const Text(
              'Cancel',
              style: TextStyle(color: AppColors.textSecondary),
            ),
          ),
          FilledButton(
            onPressed: () {
              Navigator.pop(context);
              context.push('/emergency-sos');
            },
            style: FilledButton.styleFrom(
              backgroundColor: AppColors.emergency,
              foregroundColor: AppColors.white,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
              ),
            ),
            child: const Text(
              'Confirm',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Emergency help button. Tap for immediate 24/7 medical assistance',
      button: true,
      hint: 'Double tap to activate emergency alert',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () => _handleEmergencyTap(context),
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceMd,
              vertical: DesignTokens.spaceMd,
            ),
            decoration: BoxDecoration(
              gradient: AppColors.emergencyGradient,
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              boxShadow: [
                BoxShadow(
                  color: AppColors.emergency.withValues(alpha: 0.20),
                  blurRadius: 12,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.white.withValues(alpha: 0.20),
                    borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                  ),
                  child: const Icon(
                    Icons.emergency,
                    color: AppColors.white,
                    size: 22,
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceMd),
                Expanded(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: const [
                      Text(
                        'Emergency SOS',
                        style: TextStyle(
                          color: AppColors.white,
                          fontSize: 16,
                          fontWeight: FontWeight.w800,
                          height: 1.1,
                        ),
                      ),
                      SizedBox(height: 2),
                      Text(
                        '24/7 medical assistance',
                        style: TextStyle(
                          color: AppColors.white,
                          fontSize: 12,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.arrow_forward_ios,
                  color: AppColors.white,
                  size: 16,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
