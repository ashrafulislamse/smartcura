import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

/// A polished service button for the quick-actions grid.
///
/// Renders a rounded icon container with a tinted background and a label
/// below. Designed to work inside an [Expanded] so it never overflows.
class ServiceButton extends StatefulWidget {
  final IconData icon;
  final String label;
  final Color color;
  final VoidCallback? onTap;

  const ServiceButton({
    super.key,
    required this.icon,
    required this.label,
    required this.color,
    this.onTap,
  });

  @override
  State<ServiceButton> createState() => _ServiceButtonState();
}

class _ServiceButtonState extends State<ServiceButton> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '${widget.label} service button',
      button: true,
      enabled: widget.onTap != null,
      hint: 'Tap to open ${widget.label}',
      child: GestureDetector(
        onTapDown: (_) => setState(() => _isPressed = true),
        onTapUp: (_) => setState(() => _isPressed = false),
        onTapCancel: () => setState(() => _isPressed = false),
        onTap: widget.onTap != null
            ? () {
                HapticFeedback.lightImpact();
                widget.onTap!();
              }
            : null,
        behavior: HitTestBehavior.opaque,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AnimatedContainer(
              duration: DesignTokens.animationFast,
              width: 52,
              height: 52,
              decoration: BoxDecoration(
                color: widget.color.withValues(
                  alpha: _isPressed ? 0.20 : 0.12,
                ),
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
              child: Icon(
                widget.icon,
                color: widget.color,
                size: 24,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceXs),
            Text(
              widget.label,
              style: const TextStyle(
                fontSize: 11,
                fontWeight: FontWeight.w600,
                color: AppColors.textSecondary,
              ),
              textAlign: TextAlign.center,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
      ),
    );
  }
}
