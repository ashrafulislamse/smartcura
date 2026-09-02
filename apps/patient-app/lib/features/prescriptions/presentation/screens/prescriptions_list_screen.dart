import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/prescription_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/stat_card.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../../core/widgets/status_badge.dart';

/// Prescriptions List Screen
///
/// Displays the patient's own signed prescriptions from
/// [prescriptionsProvider] (GET /profiles/me/prescriptions).
/// Filter tabs: Active / Past / All.
/// Stat cards show total active and total past counts.
class PrescriptionsListScreen extends ConsumerStatefulWidget {
  const PrescriptionsListScreen({super.key});

  @override
  ConsumerState<PrescriptionsListScreen> createState() =>
      _PrescriptionsListScreenState();
}

/// Filter options for the prescriptions list.
enum PrescriptionFilter { active, past, all }

class _PrescriptionsListScreenState
    extends ConsumerState<PrescriptionsListScreen>
    with SingleTickerProviderStateMixin {
  PrescriptionFilter _selectedFilter = PrescriptionFilter.active;
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;

  @override
  void initState() {
    super.initState();
    _animationController = AnimationController(
      duration: const Duration(milliseconds: 600),
      vsync: this,
    );
    _fadeAnimation = CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeOut,
    );
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
  }

  /// A prescription is "active" if it is signed and has not expired.
  bool _isActive(Prescription p) {
    if (p.status != PrescriptionStatus.signed) return false;
    if (p.expiresAt != null) {
      try {
        return DateTime.parse(p.expiresAt!).isAfter(DateTime.now());
      } catch (_) {
        return true;
      }
    }
    return true;
  }

  List<Prescription> _applyFilter(
      List<Prescription> all, PrescriptionFilter filter) {
    return switch (filter) {
      PrescriptionFilter.active => all.where(_isActive).toList(),
      PrescriptionFilter.past => all.where((p) => !_isActive(p)).toList(),
      PrescriptionFilter.all => all,
    };
  }

  StatusTone _statusTone(PrescriptionStatus status) {
    return switch (status) {
      PrescriptionStatus.signed => StatusTone.success,
      PrescriptionStatus.expired => StatusTone.warning,
      PrescriptionStatus.cancelled => StatusTone.error,
      PrescriptionStatus.superseded => StatusTone.neutral,
      PrescriptionStatus.discarded => StatusTone.neutral,
      PrescriptionStatus.draft => StatusTone.info,
      PrescriptionStatus.unknown => StatusTone.neutral,
    };
  }

  String _formatDate(String? isoDate) {
    if (isoDate == null) return '—';
    try {
      final dt = DateTime.parse(isoDate).toLocal();
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '—';
    }
  }

  String _shortId(String id) {
    if (id.length <= 12) return id;
    return '${id.substring(0, 8)}…';
  }

  @override
  Widget build(BuildContext context) {
    final prescriptionsAsync = ref.watch(prescriptionsProvider);

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark.copyWith(
        statusBarColor: Colors.transparent,
        systemNavigationBarColor: const Color(0xFFF6F6F8),
      ),
      child: Scaffold(
        backgroundColor: const Color(0xFFF6F6F8),
        body: SafeArea(
          bottom: false,
          child: Column(
            children: [
              _buildHeader(),
              Expanded(
                child: prescriptionsAsync.when(
                  loading: () => const Center(
                    child: CircularProgressIndicator(color: AppColors.primary),
                  ),
                  error: (error, _) => ErrorView(
                    message: _errorMessage(error),
                    onRetry: () => ref.invalidate(prescriptionsProvider),
                  ),
                  data: (allPrescriptions) {
                    final active = allPrescriptions.where(_isActive).length;
                    final past = allPrescriptions.length - active;
                    final filtered =
                        _applyFilter(allPrescriptions, _selectedFilter);
                    return FadeTransition(
                      opacity: _fadeAnimation,
                      child: Column(
                        children: [
                          _buildStatsRow(active, past),
                          _buildFilterTabs(),
                          Expanded(
                            child: filtered.isEmpty
                                ? _buildEmptyState()
                                : _buildPrescriptionsList(filtered),
                          ),
                        ],
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Semantics(
                label: 'Back button',
                button: true,
                child: GestureDetector(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    context.pop();
                  },
                  behavior: HitTestBehavior.opaque,
                  child: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(
                      Icons.arrow_back_rounded,
                      size: 20,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
              ),
              Semantics(
                label: 'Refresh',
                button: true,
                child: GestureDetector(
                  onTap: () {
                    HapticFeedback.lightImpact();
                    ref.invalidate(prescriptionsProvider);
                  },
                  behavior: HitTestBehavior.opaque,
                  child: Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: const Icon(
                      Icons.refresh_rounded,
                      size: 20,
                      color: AppColors.textPrimary,
                    ),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          const Text(
            'My Prescriptions',
            style: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w900,
              color: AppColors.textPrimary,
              letterSpacing: -0.5,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildStatsRow(int activeCount, int pastCount) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Row(
        children: [
          Expanded(
            child: StatCard(
              icon: Icons.medication_rounded,
              iconColor: AppColors.success,
              iconBackgroundColor: AppColors.successContainer,
              label: 'Active',
              value: '$activeCount',
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: StatCard(
              icon: Icons.history_rounded,
              iconColor: AppColors.textSecondary,
              iconBackgroundColor: AppColors.gray100,
              label: 'Past',
              value: '$pastCount',
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildFilterTabs() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
      child: Container(
        padding: const EdgeInsets.all(4),
        decoration: BoxDecoration(
          color: Colors.grey.shade200,
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            _buildFilterTab('Active', PrescriptionFilter.active),
            _buildFilterTab('Past', PrescriptionFilter.past),
            _buildFilterTab('All', PrescriptionFilter.all),
          ],
        ),
      ),
    );
  }

  Widget _buildFilterTab(String label, PrescriptionFilter filter) {
    final isSelected = _selectedFilter == filter;
    return Expanded(
      child: GestureDetector(
        onTap: () {
          HapticFeedback.lightImpact();
          setState(() => _selectedFilter = filter);
        },
        behavior: HitTestBehavior.opaque,
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(vertical: 10),
          decoration: BoxDecoration(
            color: isSelected ? AppColors.primary : Colors.transparent,
            borderRadius: BorderRadius.circular(10),
            boxShadow: isSelected
                ? [
                    BoxShadow(
                      color: AppColors.primary.withOpacity(0.3),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ]
                : null,
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: isSelected ? Colors.white : AppColors.textSecondary,
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    final message = switch (_selectedFilter) {
      PrescriptionFilter.active =>
        'You have no active prescriptions. New prescriptions from your '
            'doctor will appear here.',
      PrescriptionFilter.past => 'No past prescriptions found.',
      PrescriptionFilter.all =>
        'You have no prescriptions yet. Prescriptions from your '
            'doctor will appear here.',
    };
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(prescriptionsProvider),
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.5,
          child: EmptyView(
            title: 'No prescriptions',
            body: message,
            icon: Icons.medication_outlined,
            illustrationAsset: 'assets/illustrations/empty_prescriptions.svg',
          ),
        ),
      ),
    );
  }

  Widget _buildPrescriptionsList(List<Prescription> prescriptions) {
    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(prescriptionsProvider),
      child: ListView.builder(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
        physics: const BouncingScrollPhysics(),
        itemCount: prescriptions.length,
        itemBuilder: (context, index) {
          final p = prescriptions[index];
          final isActive = _isActive(p);
          return Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: _buildPrescriptionCard(p, isActive),
          );
        },
      ),
    );
  }

  Widget _buildPrescriptionCard(Prescription p, bool isActive) {
    return GestureDetector(
      onTap: () {
        HapticFeedback.lightImpact();
        context.push('/prescriptions/${p.prescriptionId}');
      },
      behavior: HitTestBehavior.opaque,
      child: AnimatedOpacity(
        duration: const Duration(milliseconds: 200),
        opacity: isActive ? 1.0 : 0.75,
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: Colors.grey.shade200),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.04),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: AppColors.primaryContainer,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Icon(
                      Icons.medication_rounded,
                      color: AppColors.primary,
                      size: 20,
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Prescription ${_shortId(p.prescriptionId)}',
                          style: const TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 2),
                        Text(
                          'Consultation ${_shortId(p.consultationId)}',
                          style: TextStyle(
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                            color: AppColors.textSecondary,
                          ),
                        ),
                      ],
                    ),
                  ),
                  StatusBadge(
                    text: p.status.wireValue,
                    tone: _statusTone(p.status),
                    small: true,
                  ),
                ],
              ),
              const SizedBox(height: 16),
              if (p.items.isNotEmpty)
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.grey.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.grey.shade200),
                  ),
                  child: Column(
                    children: p.items.asMap().entries.map((entry) {
                      final index = entry.key;
                      final item = entry.value;
                      return Column(
                        children: [
                          if (index > 0) ...[
                            const SizedBox(height: 12),
                            Container(
                              height: 1,
                              color: Colors.grey.shade200,
                            ),
                            const SizedBox(height: 12),
                          ],
                          Row(
                            children: [
                              Icon(
                                Icons.medication_rounded,
                                size: 20,
                                color: isActive
                                    ? AppColors.primary
                                    : Colors.grey.shade400,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Text(
                                  item,
                                  style: TextStyle(
                                    fontSize: 14,
                                    fontWeight: FontWeight.w700,
                                    color: isActive
                                        ? AppColors.textPrimary
                                        : Colors.grey.shade700,
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      );
                    }).toList(),
                  ),
                )
              else
                Text(
                  'No medication details available',
                  style: TextStyle(
                    fontSize: 13,
                    color: Colors.grey.shade500,
                  ),
                ),
              const SizedBox(height: 16),
              Container(
                height: 1,
                color: Colors.grey.shade200,
              ),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Signed: ${_formatDate(p.signedAt)}',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: Colors.grey.shade400,
                    ),
                  ),
                  if (p.expiresAt != null)
                    Text(
                      'Expires: ${_formatDate(p.expiresAt)}',
                      style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: Colors.grey.shade400,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: [
                  GestureDetector(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      context.push('/prescriptions/${p.prescriptionId}');
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: AppColors.primary.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(
                          color: AppColors.primary.withOpacity(0.2),
                        ),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'View Details',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              color: AppColors.primary,
                            ),
                          ),
                          SizedBox(width: 4),
                          Icon(
                            Icons.arrow_forward_rounded,
                            size: 16,
                            color: AppColors.primary,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  String _errorMessage(Object? error) {
    if (error == null) return 'Something went wrong';
    try {
      final m = (error as dynamic).userMessage;
      if (m is String && m.isNotEmpty) return m;
    } catch (_) {}
    return error.toString();
  }
}
