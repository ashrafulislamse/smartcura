import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// Compact Emergency Assistance row shown directly below the Health Status
/// card and before the Next Appointment card.
///
/// Highly discoverable without dominating the normal screen: red is reserved
/// for the icon and the SOS flow itself, not for a full-bleed banner.
class EmergencyAssistRow extends StatelessWidget {
  const EmergencyAssistRow({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Emergency assistance. Need urgent medical help?',
      button: true,
      hint: 'Opens the emergency SOS flow after confirmation',
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: () {
            HapticFeedback.mediumImpact();
            confirmAndOpenEmergency(context);
          },
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          child: Container(
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceMd,
              vertical: DesignTokens.spaceSm + 4,
            ),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              border: Border.all(
                color: AppColors.emergency.withValues(alpha: 0.25),
              ),
            ),
            child: Row(
              children: [
                Container(
                  width: 40,
                  height: 40,
                  decoration: BoxDecoration(
                    color: AppColors.emergencyLight,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  child: const Icon(
                    Icons.emergency_rounded,
                    color: AppColors.emergency,
                    size: 22,
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceMd),
                const Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Text(
                        'Emergency assistance',
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      SizedBox(height: 1),
                      Text(
                        'Need urgent medical help?',
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.chevron_right_rounded,
                  color: AppColors.emergency,
                  size: 20,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Shows the accidental-trigger guard, then opens the Emergency SOS screen.
///
/// Shared by the home Emergency Assistance row, the central "+" action sheet
/// and the critical health-status card so the confirmation wording lives in
/// one place.
Future<void> confirmAndOpenEmergency(BuildContext context) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
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
          onPressed: () => Navigator.pop(dialogContext, false),
          child: const Text(
            'Cancel',
            style: TextStyle(color: AppColors.textSecondary),
          ),
        ),
        FilledButton(
          onPressed: () => Navigator.pop(dialogContext, true),
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
  if (confirmed == true && context.mounted) {
    context.push('/emergency-sos');
  }
}
