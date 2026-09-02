import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:go_router/go_router.dart';

import '../theme/app_colors.dart';

/// Back-button behaviour for full-screen routes that live outside the
/// [AppShell] bottom-nav tree.
///
/// If the navigation stack has a route below the current one, the first back
/// press pops back to it (normal back navigation). If this route is the only
/// one on the stack, the first back press returns to `/home` and a second
/// press within 2 s exits the app — matching the double-tap-to-exit flow on
/// the shell tabs.
class FullScreenBackHandler extends StatefulWidget {
  final Widget child;

  const FullScreenBackHandler({
    super.key,
    required this.child,
  });

  @override
  State<FullScreenBackHandler> createState() => _FullScreenBackHandlerState();
}

class _FullScreenBackHandlerState extends State<FullScreenBackHandler> {
  DateTime? _lastBackPress;

  void _onPopInvoked(bool didPop, dynamic result) {
    if (didPop) return;

    // If there is a route beneath us, just pop normally so the user stays in
    // the in-app flow (e.g. notification list -> prescription detail -> back).
    if (context.canPop()) {
      HapticFeedback.lightImpact();
      context.pop();
      return;
    }

    // No route below us: this is the effective root. Mirror the shell logic.
    final location = GoRouterState.of(context).uri.toString();
    if (location == '/home') {
      final now = DateTime.now();
      if (_lastBackPress != null &&
          now.difference(_lastBackPress!) < const Duration(seconds: 2)) {
        SystemNavigator.pop();
        return;
      }

      _lastBackPress = now;
      _showExitHint();
      return;
    }

    HapticFeedback.lightImpact();
    context.go('/home');
  }

  void _showExitHint() {
    // Dismiss any previous snackbar before showing the new one so they never
    // stack if the user mashes the back button.
    ScaffoldMessenger.of(context).hideCurrentSnackBar();
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
    return PopScope(
      canPop: false,
      onPopInvokedWithResult: _onPopInvoked,
      child: widget.child,
    );
  }
}
