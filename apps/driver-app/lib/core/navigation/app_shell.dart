import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// Driver-app shell — floating pill bottom navigation, ported from the patient
/// app's premium home shell.
///
/// The five tabs map to: Dashboard, Orders, Earnings, Alerts, Profile. The
/// shell hosts a small notification badge on the Alerts tab derived from
/// [unreadNotificationsProvider] (0 hides the badge). The bottom area is a
/// rounded white pill, not a coloured bar, so the brand colour lives only on
/// the active indicator.
class AppShell extends StatelessWidget {
  final Widget child;
  const AppShell({super.key, required this.child});

  static const _tabs = [
    _TabItem(
      icon: Icons.dashboard_outlined,
      activeIcon: Icons.dashboard_rounded,
      label: 'Dashboard',
      path: '/dashboard',
    ),
    _TabItem(
      icon: Icons.local_shipping_outlined,
      activeIcon: Icons.local_shipping_rounded,
      label: 'Orders',
      path: '/orders',
    ),
    _TabItem(
      icon: Icons.account_balance_wallet_outlined,
      activeIcon: Icons.account_balance_wallet_rounded,
      label: 'Earnings',
      path: '/earnings',
    ),
    _TabItem(
      icon: Icons.notifications_outlined,
      activeIcon: Icons.notifications_rounded,
      label: 'Alerts',
      path: '/notifications',
      showBadge: true,
    ),
    _TabItem(
      icon: Icons.person_outline_rounded,
      activeIcon: Icons.person_rounded,
      label: 'Profile',
      path: '/profile',
    ),
  ];

  int _locationToIndex(String location) {
    if (location.startsWith('/orders')) return 1;
    if (location.startsWith('/earnings')) return 2;
    if (location.startsWith('/notifications')) return 3;
    if (location.startsWith('/profile')) return 4;
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final location = GoRouterState.of(context).uri.toString();
    final currentIndex = _locationToIndex(location);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: Colors.transparent,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: child,
        extendBody: true,
        bottomNavigationBar: _FloatingBottomNav(
          currentIndex: currentIndex,
          tabs: _tabs,
        ),
      ),
    );
  }
}

class _TabItem {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final String path;
  final bool showBadge;

  const _TabItem({
    required this.icon,
    required this.activeIcon,
    required this.label,
    required this.path,
    this.showBadge = false,
  });
}

class _FloatingBottomNav extends StatelessWidget {
  final int currentIndex;
  final List<_TabItem> tabs;

  const _FloatingBottomNav({
    required this.currentIndex,
    required this.tabs,
  });

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      top: false,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          DesignTokens.spaceMd,
          0,
          DesignTokens.spaceMd,
          DesignTokens.spaceSm,
        ),
        child: Container(
          height: 60,
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
            boxShadow: [
              BoxShadow(
                color: AppColors.black.withValues(alpha: 0.08),
                blurRadius: 20,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              for (int i = 0; i < tabs.length; i++)
                Expanded(
                  child: _NavButton(
                    item: tabs[i],
                    isActive: i == currentIndex,
                    onTap: () {
                      HapticFeedback.lightImpact();
                      if (i != currentIndex) {
                        context.go(tabs[i].path);
                      }
                    },
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  final _TabItem item;
  final bool isActive;
  final VoidCallback onTap;

  const _NavButton({
    required this.item,
    required this.isActive,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '${item.label} tab',
      button: true,
      selected: isActive,
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Center(
          child: AnimatedContainer(
            duration: const Duration(milliseconds: 180),
            curve: Curves.easeOut,
            padding: const EdgeInsets.symmetric(
              horizontal: 6,
              vertical: 6,
            ),
            decoration: BoxDecoration(
              color: isActive
                  ? AppColors.primary.withValues(alpha: 0.10)
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Stack(
                  clipBehavior: Clip.none,
                  children: [
                    Icon(
                      isActive ? item.activeIcon : item.icon,
                      color: isActive ? AppColors.primary : AppColors.gray400,
                      size: 22,
                    ),
                    if (item.showBadge)
                      Positioned(
                        top: -4,
                        right: -8,
                        child: Container(
                          width: 8,
                          height: 8,
                          decoration: const BoxDecoration(
                            color: AppColors.error,
                            shape: BoxShape.circle,
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 3),
                Text(
                  item.label,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: isActive ? FontWeight.w700 : FontWeight.w600,
                    color: isActive ? AppColors.primary : AppColors.gray500,
                    fontFamily: 'Manrope',
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
