import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/auth/auth_provider.dart';
import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/health_provider.dart';
import '../../../../core/providers/message_provider.dart';
import '../../../../core/providers/notification_provider.dart';
import '../../../../core/providers/prescription_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../widgets/emergency_assist_row.dart';
import '../widgets/glass_header.dart';
import '../widgets/health_snapshot_section.dart';
import '../widgets/health_status_card.dart';
import '../widgets/next_appointment_hero.dart';
import '../widgets/quick_services_grid.dart';
import '../widgets/recent_activity_section.dart';
import '../widgets/today_timeline_section.dart';

/// Home Screen — premium patient dashboard.
///
/// Section order (per the home redesign brief):
/// header → health status → emergency assistance → next appointment →
/// what do you need → your health snapshot → today → recent activity.
///
/// Everything is wired to real backend providers:
/// - [currentProfileProvider] for the greeting
/// - [notificationsProvider] for the bell badge
/// - [healthAlertsProvider] + [vitalReadingsProvider] (status card, snapshot)
/// - [nextAppointmentProvider] / [appointmentsProvider] (hero, today)
/// - [prescriptionsProvider] (today medication rows, recent activity)
class HomeScreenV2 extends ConsumerStatefulWidget {
  const HomeScreenV2({super.key});

  @override
  ConsumerState<HomeScreenV2> createState() => _HomeScreenV2State();
}

class _HomeScreenV2State extends ConsumerState<HomeScreenV2>
    with WidgetsBindingObserver {
  Timer? _autoRefreshTimer;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _autoRefreshTimer =
        Timer.periodic(const Duration(seconds: 30), (_) => _autoRefresh());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _autoRefresh();
  }

  void _autoRefresh() {
    ref.invalidate(notificationsProvider);
    ref.invalidate(vitalReadingsProvider);
    ref.invalidate(healthAlertsProvider);
  }

  @override
  void dispose() {
    _autoRefreshTimer?.cancel();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  Future<void> _onRefresh() async {
    ref
      ..invalidate(notificationsProvider)
      ..invalidate(nextAppointmentProvider)
      ..invalidate(appointmentsProvider)
      ..invalidate(vitalReadingsProvider)
      ..invalidate(healthAlertsProvider)
      ..invalidate(prescriptionsProvider)
      ..invalidate(patientUnreadMessageCountProvider);
    await Future<void>.delayed(const Duration(milliseconds: 400));
  }

  @override
  Widget build(BuildContext context) {
    final profile = ref.watch(currentProfileProvider);
    final notificationsAsync =
        ref.watch(notificationsProvider(allNotifications));

    final userName = profile?.displayName ?? 'Guest';
    final avatarUrl = profile?.avatarUrl;
    final unreadCount = notificationsAsync.maybeWhen(
      data: (notifs) => notifs.where((n) => n.readAt == null).length,
      orElse: () => 0,
    );

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
        body: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            onRefresh: _onRefresh,
            color: AppColors.primary,
            child: SingleChildScrollView(
              physics: const AlwaysScrollableScrollPhysics(
                parent: BouncingScrollPhysics(),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Header: greeting, date, avatar, notifications.
                  HomeHeader(
                    userName: userName,
                    notificationCount: unreadCount,
                    avatarUrl: avatarUrl,
                  ),

                  const SizedBox(height: DesignTokens.spaceSm),

                  // Health status — the most clinically relevant signal.
                  const HealthStatusCard(),

                  const SizedBox(height: DesignTokens.spaceMd),

                  // Compact emergency assistance row.
                  const Padding(
                    padding: EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceMd,
                    ),
                    child: EmergencyAssistRow(),
                  ),

                  const SizedBox(height: DesignTokens.spaceMd),

                  // Next appointment hero.
                  const NextAppointmentHero(),

                  const SizedBox(height: DesignTokens.spaceXl),

                  // What do you need? (4 primary services).
                  const QuickServicesGrid(),

                  const SizedBox(height: DesignTokens.spaceXl),

                  // Your health — four-vital snapshot.
                  const HealthSnapshotSection(),

                  const SizedBox(height: DesignTokens.spaceXl),

                  // Today — appointments + active prescriptions timeline.
                  const TodayTimelineSection(),

                  const SizedBox(height: DesignTokens.spaceXl),

                  // Recent activity — merged low-weight feed.
                  const RecentActivitySection(),

                  // Keep content clear of the floating bottom nav.
                  const SizedBox(height: 120),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
