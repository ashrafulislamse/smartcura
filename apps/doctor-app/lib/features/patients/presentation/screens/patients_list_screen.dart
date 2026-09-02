import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';

import '../../../../core/providers/patient_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Patient list tabs. The labels mirror the reference language, but the data
/// semantics are grounded in what the API actually returns:
/// - all: every assigned patient.
/// - recent: assigned in the last 7 days.
/// - active: status is `active` or `pending`.
/// - archived: status is `suspended` or `deactivated`.
enum _PatientTab { all, recent, active, archived }

class PatientsListScreen extends ConsumerStatefulWidget {
  const PatientsListScreen({super.key});

  @override
  ConsumerState<PatientsListScreen> createState() => _PatientsListScreenState();
}

class _PatientsListScreenState extends ConsumerState<PatientsListScreen> {
  String _searchQuery = '';
  _PatientTab _selectedTab = _PatientTab.all;

  @override
  void initState() {
    super.initState();
    SystemChrome.setSystemUIOverlayStyle(
      const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
    );
  }

  // ------------------------------------------------------------------
  // Vocabularies
  // ------------------------------------------------------------------

  static const _tabs = [
    _TabOption(value: _PatientTab.all, label: 'All Patients'),
    _TabOption(value: _PatientTab.recent, label: 'Recent'),
    _TabOption(value: _PatientTab.active, label: 'Active'),
    _TabOption(value: _PatientTab.archived, label: 'Archived'),
  ];

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  DateTime? _parseTimestamp(String? iso) {
    if (iso == null || iso.isEmpty) return null;
    return DateTime.tryParse(iso);
  }

  String _formatAssignedDate(String? iso) {
    final dt = _parseTimestamp(iso);
    if (dt == null) return '';
    return DateFormat('MMM d, yyyy').format(dt);
  }

  bool _isRecent(DoctorAssignedPatient p) {
    final dt = _parseTimestamp(p.assignedAt);
    if (dt == null) return false;
    return DateTime.now().difference(dt) <= const Duration(days: 7);
  }

  bool _isActiveStatus(String status) =>
      status == 'active' || status == 'pending';

  bool _isArchivedStatus(String status) =>
      status == 'suspended' || status == 'deactivated';

  StatusBadgeTone _statusTone(String status) => switch (status) {
        'active' => StatusBadgeTone.success,
        'pending' => StatusBadgeTone.info,
        'suspended' => StatusBadgeTone.warning,
        'deactivated' => StatusBadgeTone.neutral,
        _ => StatusBadgeTone.neutral,
      };

  String _statusLabel(String status) => switch (status) {
        'active' => 'Active',
        'pending' => 'Pending',
        'suspended' => 'Suspended',
        'deactivated' => 'Deactivated',
        _ => 'Unknown',
      };

  Future<void> _onRefresh() async {
    ref.invalidate(doctorPatientsProvider(null));
    await ref.read(doctorPatientsProvider(null).future);
  }

  // ------------------------------------------------------------------
  // Build
  // ------------------------------------------------------------------

  @override
  Widget build(BuildContext context) {
    final patientsAsync = ref.watch(doctorPatientsProvider(null));
    final all =
        patientsAsync.valueOrNull?.data ?? const <DoctorAssignedPatient>[];

    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _buildHeader(),
            _buildSearchAndTabs(),
            _buildStats(all),
            Expanded(
              child: patientsAsync.when(
                data: (page) {
                  if (page.data.isEmpty) return _buildEmpty();
                  return _buildPatientList(page.data);
                },
                loading: () => _buildShimmerList(),
                error: (err, _) {
                  final apiError = err is ApiError ? err : toApiError(err);
                  return ErrorView(
                    message: apiError.displayMessage,
                    onRetry: apiError.isForbidden ? null : _onRefresh,
                    isForbidden: apiError.isForbidden,
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Sub-builders
  // ------------------------------------------------------------------

  Widget _buildHeader() {
    final topPadding = MediaQuery.of(context).viewPadding.top;
    return Padding(
      padding: EdgeInsets.fromLTRB(
        DesignTokens.spaceMd,
        topPadding + DesignTokens.spaceMd,
        DesignTokens.spaceMd,
        DesignTokens.spaceMd,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Patients',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: AppColors.gray900,
                  letterSpacing: -0.5,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceXs),
          Text(
            'Manage and view your patients',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: AppColors.gray500,
                  fontWeight: FontWeight.w500,
                ),
          ),
        ],
      ),
    );
  }

  Widget _buildSearchAndTabs() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
          DesignTokens.spaceMd, 0, DesignTokens.spaceMd, DesignTokens.spaceMd),
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: SearchBarWidget(
                  onChanged: (v) => setState(() => _searchQuery = v),
                  hint: 'Search by name or phone',
                ),
              ),
              const SizedBox(width: DesignTokens.spaceSm),
              _FilterButton(
                selected: _selectedTab,
                onSelected: (tab) => setState(() => _selectedTab = tab),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          _TabStrip(
            options: _tabs,
            selected: _selectedTab,
            onSelected: (tab) => setState(() => _selectedTab = tab),
          ),
        ],
      ),
    );
  }

  Widget _buildStats(List<DoctorAssignedPatient> all) {
    final activeCount = all.where((p) => _isActiveStatus(p.status)).length;
    final recentCount = all.where(_isRecent).length;
    final now = DateTime.now();
    final newThisMonth = all.where((p) {
      final dt = _parseTimestamp(p.assignedAt);
      if (dt == null) return false;
      return dt.year == now.year && dt.month == now.month;
    }).length;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
          DesignTokens.spaceMd, 0, DesignTokens.spaceMd, DesignTokens.spaceMd),
      child: Row(
        children: [
          Expanded(
            child: _StatPill(
              icon: Icons.people_alt_rounded,
              value: '${all.length}',
              label: 'Total Patients',
              tint: AppColors.primary.withValues(alpha: 0.12),
              iconColor: AppColors.primary,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: _StatPill(
              icon: Icons.calendar_today_rounded,
              value: '$recentCount',
              label: 'Recent',
              tint: AppColors.info.withValues(alpha: 0.12),
              iconColor: AppColors.info,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: _StatPill(
              icon: Icons.verified_user_rounded,
              value: '$activeCount',
              label: 'Active',
              tint: AppColors.success.withValues(alpha: 0.12),
              iconColor: AppColors.success,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceSm),
          Expanded(
            child: _StatPill(
              icon: Icons.person_add_alt_1_rounded,
              value: '$newThisMonth',
              label: 'New This Month',
              tint: AppColors.warning.withValues(alpha: 0.12),
              iconColor: AppColors.warning,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildEmpty() {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _onRefresh,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: [
          SizedBox(
            height: MediaQuery.of(context).size.height * 0.5,
            child: const EmptyView(
              title: 'No patients assigned yet',
              body:
                  'When patients are assigned to your care, they will appear here.',
              illustrationAsset: 'assets/illustrations/empty_patients.svg',
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPatientList(List<DoctorAssignedPatient> all) {
    var filtered = all;
    if (_searchQuery.isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      filtered = filtered.where((p) {
        return p.displayName.toLowerCase().contains(q) ||
            (p.phoneE164?.toLowerCase().contains(q) ?? false) ||
            p.email.toLowerCase().contains(q);
      }).toList();
    }

    switch (_selectedTab) {
      case _PatientTab.all:
        break;
      case _PatientTab.recent:
        filtered = filtered.where(_isRecent).toList();
        break;
      case _PatientTab.active:
        filtered = filtered.where((p) => _isActiveStatus(p.status)).toList();
        break;
      case _PatientTab.archived:
        filtered = filtered.where((p) => _isArchivedStatus(p.status)).toList();
        break;
    }

    if (filtered.isEmpty) {
      return RefreshIndicator(
        color: AppColors.primary,
        onRefresh: _onRefresh,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            SizedBox(
              height: MediaQuery.of(context).size.height * 0.4,
              child: const EmptyView(
                title: 'No patients match this filter',
                body: 'Try a different filter or clear the search.',
                illustrationAsset: 'assets/illustrations/empty_patients.svg',
              ),
            ),
          ],
        ),
      );
    }

    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _onRefresh,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(
            DesignTokens.spaceMd, 0, DesignTokens.spaceMd, 120),
        itemCount: filtered.length,
        separatorBuilder: (_, __) =>
            const SizedBox(height: DesignTokens.spaceSm),
        itemBuilder: (context, index) => _buildPatientCard(filtered[index]),
      ),
    );
  }

  Widget _buildPatientCard(DoctorAssignedPatient p) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        boxShadow: [
          BoxShadow(
            color: AppColors.gray900.withValues(alpha: 0.04),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        child: InkWell(
          onTap: () => context.push('/patient-details', extra: p.profileId),
          borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
          child: Padding(
            padding: const EdgeInsets.all(DesignTokens.spaceMd),
            child: Row(
              children: [
                AvatarWidget(name: p.displayName, size: DesignTokens.avatarLg),
                const SizedBox(width: DesignTokens.spaceMd),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              p.displayName,
                              style: Theme.of(context)
                                  .textTheme
                                  .titleSmall
                                  ?.copyWith(
                                    fontWeight: FontWeight.w700,
                                    color: AppColors.gray900,
                                    letterSpacing: -0.2,
                                  ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          const SizedBox(width: DesignTokens.spaceSm),
                          StatusBadge(
                            label: _statusLabel(p.status),
                            tone: _statusTone(p.status),
                            showDot: true,
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        _contactLine(p),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: AppColors.gray500,
                              fontWeight: FontWeight.w500,
                            ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(
                            Icons.event_available_rounded,
                            size: 14,
                            color: AppColors.gray400,
                          ),
                          const SizedBox(width: 5),
                          Text(
                            'Assigned ${_formatAssignedDate(p.assignedAt)}',
                            style: Theme.of(context)
                                .textTheme
                                .labelSmall
                                ?.copyWith(
                                  color: AppColors.gray400,
                                  fontWeight: FontWeight.w500,
                                ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
                Icon(
                  Icons.chevron_right_rounded,
                  color: AppColors.gray400,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _contactLine(DoctorAssignedPatient p) {
    final phone = p.phoneE164;
    if (phone != null && phone.isNotEmpty) {
      return phone;
    }
    if (p.email.isNotEmpty) {
      return p.email;
    }
    return 'No contact info';
  }

  Widget _buildShimmerList() {
    return Shimmer.fromColors(
      baseColor: AppColors.shimmerBase,
      highlightColor: AppColors.shimmerHighlight,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
            DesignTokens.spaceMd, 0, DesignTokens.spaceMd, 120),
        physics: const NeverScrollableScrollPhysics(),
        children: List.generate(4, (_) => _buildShimmerCard()),
      ),
    );
  }

  Widget _buildShimmerCard() {
    return Container(
      margin: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
      ),
      child: Row(
        children: [
          Container(
            width: DesignTokens.avatarLg,
            height: DesignTokens.avatarLg,
            decoration: const BoxDecoration(
              color: AppColors.white,
              shape: BoxShape.circle,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  height: 16,
                  width: 140,
                  decoration: BoxDecoration(
                    color: AppColors.white,
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                const SizedBox(height: 8),
                Container(
                  height: 12,
                  width: 100,
                  decoration: BoxDecoration(
                    color: AppColors.white,
                    borderRadius: BorderRadius.circular(6),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------------------
// Local widgets
// ------------------------------------------------------------------------------

class _TabOption {
  const _TabOption({required this.value, required this.label});
  final _PatientTab value;
  final String label;
}

class _TabStrip extends StatelessWidget {
  const _TabStrip({
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  final List<_TabOption> options;
  final _PatientTab selected;
  final ValueChanged<_PatientTab> onSelected;

  @override
  Widget build(BuildContext context) {
    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      child: Row(
        children: options.map((option) {
          final isSelected = option.value == selected;
          return Padding(
            padding: const EdgeInsets.only(right: DesignTokens.spaceSm),
            child: ChoiceChip(
              label: Text(option.label),
              selected: isSelected,
              onSelected: (_) => onSelected(option.value),
              selectedColor: AppColors.primary,
              backgroundColor: AppColors.white,
              side: BorderSide(
                color: isSelected ? AppColors.primary : AppColors.gray200,
              ),
              labelStyle: TextStyle(
                color: isSelected ? AppColors.white : AppColors.gray700,
                fontWeight: FontWeight.w600,
                fontSize: 13,
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
              ),
              padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceMd,
                vertical: DesignTokens.spaceSm,
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _FilterButton extends StatelessWidget {
  const _FilterButton({
    required this.selected,
    required this.onSelected,
  });

  final _PatientTab selected;
  final ValueChanged<_PatientTab> onSelected;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
      ),
      child: PopupMenuButton<_PatientTab>(
        initialValue: selected,
        onSelected: onSelected,
        icon: Icon(
          Icons.tune_rounded,
          color: AppColors.gray700,
          size: DesignTokens.iconMd,
        ),
        itemBuilder: (_) => _PatientTab.values.map((tab) {
          final label = switch (tab) {
            _PatientTab.all => 'All Patients',
            _PatientTab.recent => 'Recent',
            _PatientTab.active => 'Active',
            _PatientTab.archived => 'Archived',
          };
          return PopupMenuItem(
            value: tab,
            child: Text(
              label,
              style: TextStyle(
                color: tab == selected ? AppColors.primary : AppColors.gray900,
                fontWeight: tab == selected ? FontWeight.w700 : FontWeight.w500,
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _StatPill extends StatelessWidget {
  const _StatPill({
    required this.icon,
    required this.value,
    required this.label,
    required this.tint,
    required this.iconColor,
  });

  final IconData icon;
  final String value;
  final String label;
  final Color tint;
  final Color iconColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceSm + 4),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        boxShadow: [
          BoxShadow(
            color: AppColors.gray900.withValues(alpha: 0.03),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: tint,
              shape: BoxShape.circle,
            ),
            child: Icon(
              icon,
              color: iconColor,
              size: DesignTokens.iconSm,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            value,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w800,
                  color: AppColors.gray900,
                ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: AppColors.gray500,
                  fontWeight: FontWeight.w500,
                ),
            textAlign: TextAlign.center,
            maxLines: 2,
          ),
        ],
      ),
    );
  }
}
