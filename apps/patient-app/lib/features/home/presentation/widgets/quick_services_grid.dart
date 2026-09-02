import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import 'central_action_sheet.dart';

/// "What do you need?" — four primary services as tinted cards.
///
/// Navigation-only: no API data. Every tile maps to a real route; the
/// "View all services" link opens the central action sheet for the
/// secondary actions (pharmacy, devices, manual vitals entry).
class QuickServicesGrid extends StatelessWidget {
  const QuickServicesGrid({super.key});

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          child: Text(
            'WHAT DO YOU NEED?',
            style: TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w800,
              color: AppColors.textPrimary,
              letterSpacing: 0.6,
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
          child: Column(
            children: [
              Row(
                children: [
                  Expanded(
                    child: _ServiceTile(
                      icon: Icons.search_rounded,
                      label: 'Find Doctor',
                      sublabel: 'Book a visit',
                      color: AppColors.primary,
                      onTap: () => context.push('/find-doctor'),
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Expanded(
                    child: _ServiceTile(
                      icon: Icons.calendar_month_rounded,
                      label: 'Appointments',
                      sublabel: 'Your schedule',
                      color: AppColors.warning,
                      onTap: () => context.go('/schedule'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              Row(
                children: [
                  Expanded(
                    child: _ServiceTile(
                      icon: Icons.chat_bubble_outline_rounded,
                      label: 'Messages',
                      sublabel: 'Chat with your doctor',
                      color: AppColors.success,
                      onTap: () => context.go('/messages'),
                    ),
                  ),
                  const SizedBox(width: DesignTokens.spaceSm),
                  Expanded(
                    child: _ServiceTile(
                      icon: Icons.favorite_rounded,
                      label: 'My Health',
                      sublabel: 'Vitals & records',
                      color: AppColors.bloodPressure,
                      onTap: () => context.go('/health'),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: DesignTokens.spaceSm),
        Center(
          child: TextButton(
            onPressed: () => showCentralActionSheet(context),
            style: TextButton.styleFrom(
              foregroundColor: AppColors.primary,
              padding: const EdgeInsets.symmetric(horizontal: 12),
              minimumSize: const Size(0, 36),
            ),
            child: const Text(
              'View all services',
              style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700),
            ),
          ),
        ),
      ],
    );
  }
}

/// One tinted service card: icon chip + label + sublabel.
class _ServiceTile extends StatefulWidget {
  final IconData icon;
  final String label;
  final String sublabel;
  final Color color;
  final VoidCallback onTap;

  const _ServiceTile({
    required this.icon,
    required this.label,
    required this.sublabel,
    required this.color,
    required this.onTap,
  });

  @override
  State<_ServiceTile> createState() => _ServiceTileState();
}

class _ServiceTileState extends State<_ServiceTile> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: widget.label,
      button: true,
      hint: 'Opens ${widget.label.toLowerCase()}',
      child: GestureDetector(
        onTapDown: (_) => setState(() => _isPressed = true),
        onTapUp: (_) => setState(() => _isPressed = false),
        onTapCancel: () => setState(() => _isPressed = false),
        onTap: () {
          HapticFeedback.lightImpact();
          widget.onTap();
        },
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: DesignTokens.animationFast,
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: widget.color.withValues(alpha: _isPressed ? 0.16 : 0.08),
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(
              color: widget.color.withValues(alpha: 0.18),
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.white,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                  boxShadow: [
                    BoxShadow(
                      color: widget.color.withValues(alpha: 0.18),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Icon(widget.icon, color: widget.color, size: 20),
              ),
              const SizedBox(height: DesignTokens.spaceSm),
              Text(
                widget.label,
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 2),
              Text(
                widget.sublabel,
                style: TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textSecondary.withValues(alpha: 0.9),
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
