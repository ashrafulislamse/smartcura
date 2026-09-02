import 'package:flutter/material.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';

class GlassBottomNav extends StatelessWidget {
  final int selectedIndex;
  final Function(int) onItemSelected;

  const GlassBottomNav({
    super.key,
    required this.selectedIndex,
    required this.onItemSelected,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        color: Color(0xFFF6F6F8),
      ),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _NavItem(
                icon: Icons.home,
                label: 'Home',
                isSelected: selectedIndex == 0,
                onTap: () => onItemSelected(0),
                filled: true,
              ),
              _NavItem(
                icon: Icons.calendar_month,
                label: 'Schedule',
                isSelected: selectedIndex == 1,
                onTap: () => onItemSelected(1),
              ),
              _NavItem(
                icon: Icons.chat_bubble_outline,
                label: 'Chat',
                isSelected: selectedIndex == 2,
                onTap: () => onItemSelected(2),
              ),
              _NavItem(
                icon: Icons.favorite_border,
                label: 'Vitals',
                isSelected: selectedIndex == 3,
                onTap: () => onItemSelected(3),
              ),
              _NavItem(
                icon: Icons.person_outline,
                label: 'Profile',
                isSelected: selectedIndex == 4,
                onTap: () => onItemSelected(4),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool isSelected;
  final VoidCallback onTap;
  final bool filled;

  const _NavItem({
    required this.icon,
    required this.label,
    required this.isSelected,
    required this.onTap,
    this.filled = false,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: DesignTokens.animationFast,
        curve: Curves.easeOut,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected
              ? AppColors.primary.withValues(alpha: 0.12)
              : Colors.transparent,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 22,
              color: isSelected ? AppColors.primary : AppColors.gray500,
              weight: isSelected ? 600 : 400,
            ),
            const SizedBox(height: 3),
            Text(
              label,
              style: TextStyle(
                fontSize: 10,
                fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
                color: isSelected ? AppColors.primary : AppColors.gray600,
                fontFamily: 'Manrope',
              ),
            ),
          ],
        ),
      ),
    );
  }
}
