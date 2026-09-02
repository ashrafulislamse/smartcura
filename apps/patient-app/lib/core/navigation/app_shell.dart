import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/home/presentation/widgets/central_action_sheet.dart';
import '../providers/message_provider.dart';
import '../theme/app_colors.dart';
import '../theme/design_tokens.dart';

/// App Shell with a compact, professional bottom navigation bar.
///
/// Tabs: Home, Schedule, [central + action], Messages, Health.
/// Profile is NOT a tab — it is reached through the header avatar; when the
/// profile route is active no tab is highlighted.
///
/// The center button opens the central action sheet (book, sync health data,
/// medications, pharmacy, devices, emergency). The Messages tab carries an
/// unread badge derived from [patientUnreadMessageCountProvider].
///
/// Back-button handling:
/// * On a non-home shell tab, the first back press returns to `/home`.
/// * On `/home`, a double-tap within 2 seconds exits the app; a single tap
///   shows a "Tap again to exit" hint.
class AppShell extends ConsumerStatefulWidget {
  final Widget child;

  const AppShell({
    super.key,
    required this.child,
  });

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  DateTime? _lastBackPress;

  bool get _isHome {
    final location = GoRouterState.of(context).uri.toString();
    return location == '/home';
  }

  void _onPopInvoked(bool didPop, dynamic result) {
    if (didPop) return;

    if (!_isHome) {
      HapticFeedback.lightImpact();
      context.go('/home');
      return;
    }

    final now = DateTime.now();
    if (_lastBackPress != null &&
        now.difference(_lastBackPress!) < const Duration(seconds: 2)) {
      SystemNavigator.pop();
      return;
    }

    _lastBackPress = now;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Tap back again to exit'),
        duration: Duration(seconds: 2),
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.textPrimary,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: PopScope(
        canPop: false,
        onPopInvokedWithResult: _onPopInvoked,
        child: widget.child,
      ),
      extendBody: true,
      bottomNavigationBar: const _FloatingBottomNav(),
    );
  }
}

class _NavItemData {
  final IconData icon;
  final IconData activeIcon;
  final String label;
  final String? route;
  final bool isCenter;

  const _NavItemData({
    required this.icon,
    required this.activeIcon,
    required this.label,
    this.route,
    this.isCenter = false,
  });
}

class _FloatingBottomNav extends ConsumerWidget {
  const _FloatingBottomNav();

  static const _items = [
    _NavItemData(
      icon: Icons.home_outlined,
      activeIcon: Icons.home_rounded,
      label: 'Home',
      route: '/home',
    ),
    _NavItemData(
      icon: Icons.calendar_today_outlined,
      activeIcon: Icons.calendar_today_rounded,
      label: 'Schedule',
      route: '/schedule',
    ),
    _NavItemData(
      icon: Icons.add_rounded,
      activeIcon: Icons.add_rounded,
      label: 'Quick Actions',
      isCenter: true,
    ),
    _NavItemData(
      icon: Icons.chat_bubble_outline_rounded,
      activeIcon: Icons.chat_bubble_rounded,
      label: 'Messages',
      route: '/messages',
    ),
    _NavItemData(
      icon: Icons.favorite_outline_rounded,
      activeIcon: Icons.favorite_rounded,
      label: 'Health',
      route: '/health',
    ),
  ];

  /// Index of the active tab for the current route; -1 when the route is
  /// not one of the shell tabs (e.g. /profile or a full-screen flow).
  int _selectedIndex(String location) {
    if (location.startsWith('/home')) return 0;
    if (location.startsWith('/schedule')) return 1;
    if (location.startsWith('/messages')) return 2;
    if (location.startsWith('/health')) return 3;
    return -1;
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final currentLocation = GoRouterState.of(context).uri.toString();
    // Tabs 0-3 in _items correspond to routes; the center slot (index 2 in
    // the row) is the action button, hence the offset for slots 3 and 4.
    final routeIndex = _selectedIndex(currentLocation);
    final unreadAsync = ref.watch(patientUnreadMessageCountProvider);
    final unreadCount = unreadAsync.valueOrNull ?? 0;

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
          height: 56,
          decoration: BoxDecoration(
            color: AppColors.white,
            borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
            border: Border.all(color: AppColors.border),
            boxShadow: [
              BoxShadow(
                color: AppColors.black.withValues(alpha: 0.06),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              for (int i = 0; i < _items.length; i++)
                Expanded(
                  child: _items[i].isCenter
                      ? _CenterActionButton(
                          onTap: () {
                            HapticFeedback.lightImpact();
                            showCentralActionSheet(context);
                          },
                        )
                      : _NavButton(
                          item: _items[i],
                          isActive: _tabIndexFor(i) == routeIndex,
                          badgeCount:
                              _items[i].route == '/messages' ? unreadCount : 0,
                          onTap: () {
                            if (_tabIndexFor(i) != routeIndex) {
                              HapticFeedback.lightImpact();
                              context.go(_items[i].route!);
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

  /// Maps a row slot (0-4, center at 2) to the route index space (0-3).
  int _tabIndexFor(int slot) {
    if (slot < 2) return slot;
    return slot - 1;
  }
}

/// The raised central Quick Actions button.
class _CenterActionButton extends StatelessWidget {
  final VoidCallback onTap;

  const _CenterActionButton({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Quick actions',
      button: true,
      hint: 'Opens the list of actions',
      child: GestureDetector(
        onTap: onTap,
        behavior: HitTestBehavior.opaque,
        child: Center(
          child: Transform.translate(
            offset: const Offset(0, -12),
            child: Container(
              width: 54,
              height: 54,
              decoration: BoxDecoration(
                color: AppColors.primary,
                shape: BoxShape.circle,
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.25),
                    blurRadius: 12,
                    offset: const Offset(0, 4),
                  ),
                ],
              ),
              child: const Icon(
                Icons.add_rounded,
                color: AppColors.white,
                size: 28,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _NavButton extends StatelessWidget {
  final _NavItemData item;
  final bool isActive;
  final int badgeCount;
  final VoidCallback onTap;

  const _NavButton({
    required this.item,
    required this.isActive,
    required this.onTap,
    this.badgeCount = 0,
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
            duration: DesignTokens.animationFast,
            curve: Curves.easeOut,
            padding: const EdgeInsets.symmetric(
              horizontal: 6,
              vertical: 6,
            ),
            decoration: BoxDecoration(
              color: isActive
                  ? AppColors.primary.withValues(alpha: 0.08)
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
                    if (badgeCount > 0)
                      Positioned(
                        top: -3,
                        right: -7,
                        child: Container(
                          constraints: const BoxConstraints(
                            minWidth: 16,
                            minHeight: 16,
                          ),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 4,
                            vertical: 1,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.error,
                            borderRadius: BorderRadius.circular(8),
                            border:
                                Border.all(color: AppColors.white, width: 1.5),
                          ),
                          alignment: Alignment.center,
                          child: Text(
                            badgeCount > 9 ? '9+' : '$badgeCount',
                            style: const TextStyle(
                              color: AppColors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 2),
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
