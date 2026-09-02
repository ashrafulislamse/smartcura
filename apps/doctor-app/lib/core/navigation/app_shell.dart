import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../providers/message_provider.dart';
import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// App Shell with Bottom Navigation
///
/// Provides persistent bottom navigation bar for main app screens
/// Uses go_router's ShellRoute for state preservation
class AppShell extends StatelessWidget {
  final Widget child;

  const AppShell({
    super.key,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        systemNavigationBarColor: AppColors.white,
        systemNavigationBarIconBrightness: Brightness.dark,
        systemNavigationBarDividerColor: AppColors.white,
      ),
      child: Scaffold(
        body: child,
        extendBody: true,
        bottomNavigationBar: const _BottomNavBar(),
      ),
    );
  }
}

class _BottomNavBar extends ConsumerWidget {
  const _BottomNavBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentLocation = GoRouterState.of(context).uri.toString();

    // Real unread-messages count from the inbox; the badge is never faked.
    final unreadMessages = ref
            .watch(doctorInboxProvider(null))
            .valueOrNull
            ?.data
            .fold<int>(0, (sum, c) => sum + c.unreadCount) ??
        0;

    // Determine current index based on location
    int currentIndex = 0;
    if (currentLocation.startsWith('/dashboard')) {
      currentIndex = 0;
    } else if (currentLocation.startsWith('/appointments') ||
        currentLocation.startsWith('/my-schedule')) {
      currentIndex = 1;
    } else if (currentLocation.startsWith('/messages')) {
      currentIndex = 2;
    } else if (currentLocation.startsWith('/patients')) {
      currentIndex = 3;
    } else if (currentLocation.startsWith('/profile')) {
      currentIndex = 4;
    }

    return Container(
      // White background extends behind the system nav bar area
      color: AppColors.white,
      child: SafeArea(
        top: false,
        child: Container(
          decoration: const BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.only(
              topLeft: Radius.circular(24),
              topRight: Radius.circular(24),
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.shadowPrimary,
                blurRadius: 16,
                offset: Offset(0, -2),
                spreadRadius: 0,
              ),
            ],
          ),
          child: SizedBox(
            height: DesignTokens.bottomNavHeight,
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _NavItem(
                  icon: Icons.home_outlined,
                  activeIcon: Icons.home_rounded,
                  label: 'Home',
                  isActive: currentIndex == 0,
                  onTap: () => context.go('/dashboard'),
                ),
                _NavItem(
                  icon: Icons.calendar_today_outlined,
                  activeIcon: Icons.calendar_month_rounded,
                  label: 'Schedule',
                  isActive: currentIndex == 1,
                  onTap: () => context.go('/appointments'),
                ),
                _NavItem(
                  icon: Icons.chat_bubble_outline_rounded,
                  activeIcon: Icons.chat_bubble_rounded,
                  label: 'Chat',
                  isActive: currentIndex == 2,
                  onTap: () => context.go('/messages'),
                  hasNotification: unreadMessages > 0,
                ),
                _NavItem(
                  icon: Icons.people_outline_rounded,
                  activeIcon: Icons.people_rounded,
                  label: 'Patients',
                  isActive: currentIndex == 3,
                  onTap: () => context.go('/patients'),
                ),
                _NavItem(
                  icon: Icons.person_outline_rounded,
                  activeIcon: Icons.person_rounded,
                  label: 'Profile',
                  isActive: currentIndex == 4,
                  onTap: () => context.go('/profile'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final bool isActive;
  final VoidCallback onTap;
  final bool hasNotification;

  const _NavItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.isActive,
    required this.onTap,
    this.hasNotification = false,
  });

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          mainAxisSize: MainAxisSize.min,
          children: [
            // Icon with active indicator pill
            Stack(
              clipBehavior: Clip.none,
              children: [
                AnimatedContainer(
                  duration: const Duration(milliseconds: 250),
                  curve: Curves.easeOutQuart,
                  padding: EdgeInsets.symmetric(
                    horizontal: isActive ? 16 : 8,
                    vertical: isActive ? 7 : 6,
                  ),
                  decoration: BoxDecoration(
                    color: isActive
                        ? AppColors.primaryContainer
                        : Colors.transparent,
                    borderRadius:
                        BorderRadius.circular(DesignTokens.radiusFull),
                  ),
                  child: Icon(
                    isActive ? activeIcon : icon,
                    color: isActive ? AppColors.primary : AppColors.gray400,
                    size: DesignTokens.bottomNavIconSize,
                  ),
                ),
                if (hasNotification)
                  Positioned(
                    top: 2,
                    right: 4,
                    child: Container(
                      width: 9,
                      height: 9,
                      decoration: BoxDecoration(
                        color: AppColors.error,
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: AppColors.white,
                          width: 2,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            // Label
            AnimatedDefaultTextStyle(
              duration: const Duration(milliseconds: 200),
              style: TextStyle(
                fontSize: 10,
                fontWeight: isActive ? FontWeight.w700 : FontWeight.w500,
                color: isActive ? AppColors.primary : AppColors.gray400,
                fontFamily: 'Inter',
              ),
              child: Text(label),
            ),
          ],
        ),
      ),
    );
  }
}
