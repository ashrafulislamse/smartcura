import 'package:flutter/material.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// The visual tone of a [StatusBadge].
enum StatusTone { success, warning, error, info, neutral }

/// A small pill-shaped badge that communicates a status with colour.
class StatusBadge extends StatelessWidget {
  final String text;
  final StatusTone tone;
  final IconData? icon;
  final bool small;

  const StatusBadge({
    super.key,
    required this.text,
    this.tone = StatusTone.neutral,
    this.icon,
    this.small = false,
  });

  @override
  Widget build(BuildContext context) {
    final colors = _toneColors(tone);
    return Container(
      padding: EdgeInsets.symmetric(
        horizontal: small ? DesignTokens.spaceSm : DesignTokens.spaceMd,
        vertical: small ? 2 : DesignTokens.spaceXs,
      ),
      decoration: BoxDecoration(
        color: colors.background,
        borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
        border: Border.all(color: colors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: small ? 12 : 14, color: colors.foreground),
            const SizedBox(width: 4),
          ],
          Text(
            text,
            style: TextStyle(
              color: colors.foreground,
              fontSize: small ? 11 : 12,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }

  _BadgeColors _toneColors(StatusTone tone) {
    return switch (tone) {
      StatusTone.success => const _BadgeColors(
          background: Color(0xFFD1FAE5),
          border: Color(0xFFA7F3D0),
          foreground: Color(0xFF065F46),
        ),
      StatusTone.warning => const _BadgeColors(
          background: Color(0xFFFEF3C7),
          border: Color(0xFFFDE68A),
          foreground: Color(0xFF92400E),
        ),
      StatusTone.error => const _BadgeColors(
          background: Color(0xFFFEE2E2),
          border: Color(0xFFFECACA),
          foreground: Color(0xFF991B1B),
        ),
      StatusTone.info => const _BadgeColors(
          background: Color(0xFFDBEAFE),
          border: Color(0xFFBFDBFE),
          foreground: Color(0xFF1E40AF),
        ),
      StatusTone.neutral => _BadgeColors(
          background: AppColors.gray100,
          border: AppColors.gray200,
          foreground: AppColors.gray700,
        ),
    };
  }
}

class _BadgeColors {
  final Color background;
  final Color border;
  final Color foreground;
  const _BadgeColors({
    required this.background,
    required this.border,
    required this.foreground,
  });
}
