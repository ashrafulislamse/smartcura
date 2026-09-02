import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/appointment_provider.dart';
import '../../../../core/providers/app_state_provider.dart';
import '../../../../core/providers/doctor_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../../core/widgets/status_badge.dart';

/// Schedule Screen — premium appointment management.
///
/// Wired to real backend via [appointmentsProvider] (GET /appointments).
/// Three tabs: Upcoming, Past, Cancelled. Each card resolves doctor
/// identity through [doctorDetailProvider].
class AppointmentsScreen extends ConsumerStatefulWidget {
  const AppointmentsScreen({super.key});

  @override
  ConsumerState<AppointmentsScreen> createState() => _AppointmentsScreenState();
}

class _AppointmentsScreenState extends ConsumerState<AppointmentsScreen> {
  int _selectedTab = 0;
  static const _tabLabels = ['Upcoming', 'Past', 'Cancelled'];

  @override
  Widget build(BuildContext context) {
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
          child: Column(
            children: [
              _buildHeader(),
              _buildTabBar(),
              Expanded(child: _buildContent()),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------
  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        DesignTokens.spaceSm,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: const [
                Text(
                  'My Appointments',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    letterSpacing: -0.5,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                SizedBox(height: 2),
                Text(
                  'Manage your visits and consultations',
                  style: TextStyle(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                  ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ],
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          // Book button
          GestureDetector(
            onTap: () {
              HapticFeedback.lightImpact();
              context.push('/find-doctor');
            },
            child: Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 9,
              ),
              decoration: BoxDecoration(
                color: AppColors.primary,
                borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                boxShadow: [
                  BoxShadow(
                    color: AppColors.primary.withValues(alpha: 0.20),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: const Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(Icons.add_rounded, color: AppColors.white, size: 18),
                  SizedBox(width: 3),
                  Text(
                    'Book',
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w800,
                      color: AppColors.white,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Tab bar — pill-style segmented control
  // ---------------------------------------------------------------------------
  Widget _buildTabBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        0,
        DesignTokens.spaceMd,
        DesignTokens.spaceSm,
      ),
      child: Container(
        height: 44,
        decoration: BoxDecoration(
          color: AppColors.gray100,
          borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        ),
        padding: const EdgeInsets.all(3),
        child: Row(
          children: List.generate(_tabLabels.length, (i) {
            final isActive = _selectedTab == i;
            return Expanded(
              child: GestureDetector(
                onTap: () {
                  HapticFeedback.lightImpact();
                  setState(() => _selectedTab = i);
                },
                child: AnimatedContainer(
                  duration: DesignTokens.animationFast,
                  curve: Curves.easeOut,
                  decoration: BoxDecoration(
                    color: isActive ? AppColors.white : Colors.transparent,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                    boxShadow: isActive
                        ? [
                            BoxShadow(
                              color: AppColors.black.withValues(alpha: 0.06),
                              blurRadius: 4,
                              offset: const Offset(0, 1),
                            ),
                          ]
                        : null,
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    _tabLabels[i],
                    style: TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: isActive ? AppColors.primary : AppColors.gray500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            );
          }),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Content
  // ---------------------------------------------------------------------------
  Widget _buildContent() {
    final appointmentsAsync = ref.watch(appointmentsProvider);

    return appointmentsAsync.when(
      loading: () => _buildShimmerList(),
      error: (error, _) => _buildErrorView(error),
      data: (appointments) {
        if (appointments.isEmpty) {
          return _buildEmptyView(
            'No appointments yet',
            'Book your first consultation with a doctor.',
            Icons.calendar_today_outlined,
            showBookButton: true,
          );
        }

        final upcoming = _filterUpcoming(appointments);
        final past = _filterPast(appointments);
        final cancelled = _filterCancelled(appointments);

        final counts = [upcoming.length, past.length, cancelled.length];
        final list = switch (_selectedTab) {
          0 => upcoming,
          1 => past,
          _ => cancelled,
        };

        return Column(
          children: [
            _buildStatsRow(counts),
            Expanded(
              child: AnimatedSwitcher(
                duration: const Duration(milliseconds: 250),
                transitionBuilder: (child, animation) => FadeTransition(
                  opacity: animation,
                  child: child,
                ),
                child: list.isEmpty
                    ? _buildEmptyView(
                        'No ${_tabLabels[_selectedTab].toLowerCase()} appointments',
                        _emptyBodyForTab(_selectedTab),
                        Icons.event_available_outlined,
                        key: ValueKey('empty_$_selectedTab'),
                      )
                    : RefreshIndicator(
                        key: ValueKey('list_$_selectedTab'),
                        onRefresh: () async {
                          ref.invalidate(appointmentsProvider);
                          await ref.read(appointmentsProvider.future);
                        },
                        color: AppColors.primary,
                        child: ListView.builder(
                          padding: const EdgeInsets.fromLTRB(
                            DesignTokens.spaceMd,
                            0,
                            DesignTokens.spaceMd,
                            120,
                          ),
                          physics: const AlwaysScrollableScrollPhysics(
                            parent: BouncingScrollPhysics(),
                          ),
                          itemCount: list.length,
                          itemBuilder: (context, index) =>
                              _AppointmentCard(appointment: list[index]),
                        ),
                      ),
              ),
            ),
          ],
        );
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Stats row — compact pill-style counters
  // ---------------------------------------------------------------------------
  Widget _buildStatsRow(List<int> counts) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        0,
        DesignTokens.spaceMd,
        DesignTokens.spaceSm,
      ),
      child: Row(
        children: List.generate(3, (i) {
          final isActive = _selectedTab == i;
          final colors = [
            (AppColors.primary, AppColors.primaryContainer),
            (AppColors.secondaryDark, AppColors.secondaryContainer),
            (AppColors.errorDark, AppColors.errorContainer),
          ][i];
          final icons = [
            Icons.event_available_rounded,
            Icons.history_rounded,
            Icons.event_busy_rounded,
          ];

          return Expanded(
            child: Padding(
              padding: EdgeInsets.only(
                right: i < 2 ? DesignTokens.spaceXs : 0,
              ),
              child: GestureDetector(
                onTap: () {
                  HapticFeedback.lightImpact();
                  setState(() => _selectedTab = i);
                },
                child: AnimatedContainer(
                  duration: DesignTokens.animationFast,
                  padding: const EdgeInsets.symmetric(
                    horizontal: 10,
                    vertical: 10,
                  ),
                  decoration: BoxDecoration(
                    color: isActive ? colors.$2 : AppColors.white,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                    border: Border.all(
                      color: isActive
                          ? colors.$1.withValues(alpha: 0.25)
                          : AppColors.gray200,
                    ),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(icons[i], size: 18, color: colors.$1),
                      const SizedBox(width: 6),
                      Text(
                        '${counts[i]}',
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          color: colors.$1,
                        ),
                      ),
                      const SizedBox(width: 5),
                      Flexible(
                        child: Text(
                          _tabLabels[i],
                          style: TextStyle(
                            fontSize: 11,
                            fontWeight: FontWeight.w600,
                            color:
                                isActive ? colors.$1 : AppColors.textSecondary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        }),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Shimmer loading
  // ---------------------------------------------------------------------------
  Widget _buildShimmerList() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
      child: Shimmer.fromColors(
        baseColor: AppColors.gray200,
        highlightColor: AppColors.gray100,
        child: ListView.builder(
          physics: const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.only(top: DesignTokens.spaceSm),
          itemCount: 4,
          itemBuilder: (_, __) => Container(
            margin: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
            height: 140,
            decoration: BoxDecoration(
              color: AppColors.gray200,
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Empty / error views
  // ---------------------------------------------------------------------------
  Widget _buildEmptyView(
    String title,
    String? body,
    IconData icon, {
    bool showBookButton = false,
    Key? key,
  }) {
    return EmptyView(
      key: key,
      title: title,
      body: body,
      icon: icon,
      illustrationAsset: 'assets/illustrations/empty_appointments.svg',
      actionLabel: showBookButton ? 'Book Appointment' : null,
      actionCallback: showBookButton
          ? () {
              HapticFeedback.lightImpact();
              context.push('/find-doctor');
            }
          : null,
    );
  }

  Widget _buildErrorView(Object error) {
    String message = 'Something went wrong';
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) message = m;
    } catch (_) {}

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(DesignTokens.spaceXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: AppColors.errorContainer,
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.error_outline,
                size: 36,
                color: AppColors.error,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            const Text(
              'Could not load appointments',
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceXs),
            Text(
              message,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 13,
                color: AppColors.textSecondary,
              ),
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            FilledButton.icon(
              onPressed: () => ref.invalidate(appointmentsProvider),
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Retry'),
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.primary,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------------
  List<Appointment> _filterUpcoming(List<Appointment> all) {
    final statuses = {
      AppointmentStatus.pendingPayment,
      AppointmentStatus.confirmed,
      AppointmentStatus.checkedIn,
      AppointmentStatus.inProgress,
    };
    return all.where((a) => statuses.contains(a.status)).toList()
      ..sort((a, b) => a.startsAt.compareTo(b.startsAt));
  }

  List<Appointment> _filterPast(List<Appointment> all) {
    final statuses = {AppointmentStatus.completed, AppointmentStatus.noShow};
    return all.where((a) => statuses.contains(a.status)).toList()
      ..sort((a, b) => b.startsAt.compareTo(a.startsAt));
  }

  List<Appointment> _filterCancelled(List<Appointment> all) {
    final statuses = {
      AppointmentStatus.cancelled,
      AppointmentStatus.rescheduled,
    };
    return all.where((a) => statuses.contains(a.status)).toList()
      ..sort((a, b) => b.startsAt.compareTo(a.startsAt));
  }

  String? _emptyBodyForTab(int tab) {
    return switch (tab) {
      0 => 'Book an appointment to see it here.',
      1 => 'Your completed appointments will appear here.',
      _ => 'Cancelled or rescheduled appointments will appear here.',
    };
  }
}

// =============================================================================
// _AppointmentCard — premium card with doctor identity resolution
// =============================================================================

class _AppointmentCard extends ConsumerWidget {
  final Appointment appointment;

  const _AppointmentCard({required this.appointment});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final doctorAsync =
        ref.watch(doctorDetailProvider(appointment.doctorMembershipId));

    final doctorName =
        doctorAsync.whenOrNull(data: (d) => d.displayName) ?? 'Doctor';

    final specialty =
        doctorAsync.whenOrNull(data: (d) => d.primarySpecialty) ?? '';

    final imageUrl = doctorAsync.whenOrNull(data: (d) => d.imageUrl);

    final startsAt = DateTime.tryParse(appointment.startsAt) ?? DateTime.now();
    final accent = _accentForStatus(appointment.status);

    return Container(
      margin: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.04),
            blurRadius: 10,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          onTap: () {
            HapticFeedback.lightImpact();
            ref.read(selectedAppointmentProvider.notifier).state = appointment;
            context.push('/appointment-details', extra: {
              'appointmentId': appointment.id,
            });
          },
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                // Left accent bar
                Container(width: 4, color: accent),
                // Content
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.all(DesignTokens.spaceMd),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        // Doctor row
                        Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            AvatarWidget(
                              imageUrl: imageUrl,
                              name: doctorName,
                              size: 44,
                            ),
                            const SizedBox(width: DesignTokens.spaceSm),
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  Text(
                                    doctorName,
                                    style: const TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w800,
                                      color: AppColors.textPrimary,
                                    ),
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                  if (specialty.isNotEmpty) ...[
                                    const SizedBox(height: 2),
                                    Text(
                                      specialty,
                                      style: const TextStyle(
                                        fontSize: 12,
                                        fontWeight: FontWeight.w500,
                                        color: AppColors.textSecondary,
                                      ),
                                      maxLines: 1,
                                      overflow: TextOverflow.ellipsis,
                                    ),
                                  ],
                                ],
                              ),
                            ),
                            const SizedBox(width: 4),
                            // Mode badge
                            _ModePill(mode: appointment.mode),
                          ],
                        ),
                        const SizedBox(height: DesignTokens.spaceSm),
                        // Divider
                        Container(height: 1, color: AppColors.gray100),
                        const SizedBox(height: DesignTokens.spaceSm),
                        // Bottom row: date/time chips + status + arrow
                        Row(
                          children: [
                            _InfoChip(
                              icon: Icons.calendar_today_rounded,
                              text: _formatDate(startsAt),
                            ),
                            const SizedBox(width: DesignTokens.spaceSm),
                            _InfoChip(
                              icon: Icons.access_time_rounded,
                              text: _formatTime(startsAt),
                            ),
                            const SizedBox(width: DesignTokens.spaceSm),
                            _InfoChip(
                              icon: Icons.tag_rounded,
                              text: '#${appointment.id.substring(0, 8)}',
                            ),
                            const Spacer(),
                            _statusBadge(appointment.status),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  IconData _modeIcon(AppointmentMode mode) {
    return switch (mode) {
      AppointmentMode.video => Icons.videocam_rounded,
      AppointmentMode.audio => Icons.phone_rounded,
      AppointmentMode.inPerson => Icons.location_on_rounded,
      AppointmentMode.chat => Icons.chat_rounded,
      AppointmentMode.unknown => Icons.help_outline,
    };
  }

  String _modeLabel(AppointmentMode mode) {
    return switch (mode) {
      AppointmentMode.video => 'Video',
      AppointmentMode.audio => 'Audio',
      AppointmentMode.inPerson => 'In-person',
      AppointmentMode.chat => 'Chat',
      AppointmentMode.unknown => '—',
    };
  }

  Widget _statusBadge(AppointmentStatus status) {
    final (text, tone) = _statusMapping(status);
    return StatusBadge(text: text, tone: tone, small: true);
  }

  (String, StatusTone) _statusMapping(AppointmentStatus status) {
    return switch (status) {
      AppointmentStatus.pendingPayment => (
          'Pending Payment',
          StatusTone.warning
        ),
      AppointmentStatus.confirmed => ('Confirmed', StatusTone.info),
      AppointmentStatus.checkedIn => ('Checked In', StatusTone.info),
      AppointmentStatus.inProgress => ('In Progress', StatusTone.success),
      AppointmentStatus.completed => ('Completed', StatusTone.success),
      AppointmentStatus.cancelled => ('Cancelled', StatusTone.error),
      AppointmentStatus.noShow => ('No Show', StatusTone.neutral),
      AppointmentStatus.rescheduled => ('Rescheduled', StatusTone.warning),
      AppointmentStatus.unknown => ('Unknown', StatusTone.neutral),
    };
  }

  Color _accentForStatus(AppointmentStatus status) {
    return switch (status) {
      AppointmentStatus.pendingPayment => AppColors.warning,
      AppointmentStatus.confirmed => AppColors.info,
      AppointmentStatus.checkedIn => AppColors.info,
      AppointmentStatus.inProgress => AppColors.success,
      AppointmentStatus.completed => AppColors.success,
      AppointmentStatus.cancelled => AppColors.error,
      AppointmentStatus.noShow => AppColors.gray400,
      AppointmentStatus.rescheduled => AppColors.warning,
      AppointmentStatus.unknown => AppColors.gray400,
    };
  }

  String _formatDate(DateTime dt) {
    final now = DateTime.now();
    final isToday =
        dt.day == now.day && dt.month == now.month && dt.year == now.year;
    if (isToday) return 'Today';
    final tomorrow = now.add(const Duration(days: 1));
    final isTomorrow = dt.day == tomorrow.day &&
        dt.month == tomorrow.month &&
        dt.year == tomorrow.year;
    if (isTomorrow) return 'Tomorrow';
    return DateFormat('MMM d').format(dt);
  }

  String _formatTime(DateTime dt) {
    return DateFormat('h:mm a').format(dt);
  }
}

// =============================================================================
// _ModePill — compact mode badge
// =============================================================================

class _ModePill extends StatelessWidget {
  final AppointmentMode mode;

  const _ModePill({required this.mode});

  @override
  Widget build(BuildContext context) {
    final (label, icon) = switch (mode) {
      AppointmentMode.video => ('Video', Icons.videocam_rounded),
      AppointmentMode.audio => ('Audio', Icons.phone_rounded),
      AppointmentMode.inPerson => ('Visit', Icons.location_on_rounded),
      AppointmentMode.chat => ('Chat', Icons.chat_rounded),
      AppointmentMode.unknown => ('—', Icons.help_outline),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 3),
      decoration: BoxDecoration(
        color: AppColors.primary.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 11, color: AppColors.primary),
          const SizedBox(width: 3),
          Text(
            label,
            style: const TextStyle(
              fontSize: 10,
              fontWeight: FontWeight.w700,
              color: AppColors.primary,
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// _InfoChip — compact icon + text
// =============================================================================

class _InfoChip extends StatelessWidget {
  final IconData icon;
  final String text;

  const _InfoChip({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 12, color: AppColors.gray500),
        const SizedBox(width: 3),
        Text(
          text,
          style: const TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.w600,
            color: AppColors.gray600,
          ),
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ],
    );
  }
}
