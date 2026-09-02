import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/models/search_params.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/doctor_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../../core/widgets/status_badge.dart';

/// Find Doctor Screen — doctor discovery (search → filter → compare → profile).
///
/// Wired to the real backend directory (`GET /doctors`). Everything rendered on
/// a card comes from the `DoctorDirectoryItem` contract: name, image (nullable,
/// initials fallback), specialty, rating/review count, years of experience,
/// consultation fee (integer sen), accepting-new-patients state, verified
/// state and languages.
///
/// The backend does NOT provide clinic location or consultation modes, so this
/// screen deliberately does not render those fields (never fabricate data).
class FindDoctorScreen extends ConsumerStatefulWidget {
  const FindDoctorScreen({super.key});

  @override
  ConsumerState<FindDoctorScreen> createState() => _FindDoctorScreenState();
}

class _FindDoctorScreenState extends ConsumerState<FindDoctorScreen> {
  final TextEditingController _searchController = TextEditingController();
  final ScrollController _scrollController = ScrollController();
  final FocusNode _searchFocusNode = FocusNode();

  String _debouncedQuery = '';
  String _fieldText = '';
  bool _isSearchFocused = false;

  String? _selectedSpecialty;
  bool? _filterAcceptingNewPatients;
  String? _filterLanguage;

  /// Specialty vocabulary. Keys are API wire values (lowercase, underscores —
  /// matches pattern `^[a-z][a-z0-9_]{1,62}$`); values are display labels.
  static const _specialtyLabels = <String, String>{
    'cardiology': 'Cardiology',
    'dermatology': 'Dermatology',
    'psychiatry': 'Psychiatry',
    'pediatrics': 'Pediatrics',
    'orthopedics': 'Orthopedics',
    'general_practice': 'General Medicine',
    'neurology': 'Neurology',
    'gastroenterology': 'Gastroenterology',
    'endocrinology': 'Endocrinology',
    'oncology': 'Oncology',
    'urology': 'Urology',
    'nephrology': 'Nephrology',
    'ophthalmology': 'Ophthalmology',
    'ent': 'ENT',
    'obstetrics_gynecology': 'Obstetrics & Gynecology',
    'psychology': 'Psychology',
    'nutrition': 'Nutrition',
    'physiotherapy': 'Physiotherapy',
    'dietitian': 'Dietitian',
  };

  /// The quick-access chip row (matches the reference layout).
  static const _specialtyChips = <(String?, String)>[
    (null, 'All'),
    ('cardiology', 'Cardiology'),
    ('dermatology', 'Dermatology'),
    ('psychiatry', 'Psychiatry'),
    ('orthopedics', 'Orthopedics'),
    ('general_practice', 'General Medicine'),
  ];

  /// Language vocabulary for the filter sheet. The keys are the ISO 639-2
  /// alpha-3 codes stored in `doctor_professional_languages` — the backend
  /// `language` filter is an exact match on that column, so alpha-2 codes
  /// would never match. Alpha-2 aliases are normalized on display only.
  static const _languageLabels = <String?, String>{
    null: 'All languages',
    'eng': 'English',
    'msa': 'Bahasa Melayu',
    'zho': 'Mandarin',
    'tam': 'Tamil',
    'ara': 'Arabic',
  };

  static const _languageAliases = <String, String>{
    'en': 'eng',
    'ms': 'msa',
    'zh': 'zho',
    'ta': 'tam',
    'ar': 'ara',
  };

  Timer? _debounce;

  @override
  void initState() {
    super.initState();
    _searchFocusNode.addListener(_onSearchFocusChange);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _searchController.dispose();
    _scrollController.dispose();
    _searchFocusNode.removeListener(_onSearchFocusChange);
    _searchFocusNode.dispose();
    super.dispose();
  }

  void _onSearchFocusChange() {
    if (!mounted) return;
    setState(() => _isSearchFocused = _searchFocusNode.hasFocus);
  }

  void _onSearchChanged(String value) {
    setState(() => _fieldText = value);
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 500), () {
      if (!mounted) return;
      setState(() => _debouncedQuery = value.trim());
    });
  }

  void _clearSearch() {
    _searchController.clear();
    _debounce?.cancel();
    setState(() {
      _fieldText = '';
      _debouncedQuery = '';
    });
  }

  DoctorSearchParams get _currentParams => DoctorSearchParams(
        query: _debouncedQuery.isEmpty ? null : _debouncedQuery,
        specialty: _selectedSpecialty,
        languages: _filterLanguage != null ? [_filterLanguage!] : const [],
        acceptsNewPatients: _filterAcceptingNewPatients,
        limit: 20,
      );

  int get _activeFilterCount {
    var count = 0;
    if (_selectedSpecialty != null) count++;
    if (_filterAcceptingNewPatients != null) count++;
    if (_filterLanguage != null) count++;
    return count;
  }

  String _specialtyLabel(String value) {
    return _specialtyLabels[value] ??
        value
            .split('_')
            .map(
                (s) => s.isEmpty ? s : '${s[0].toUpperCase()}${s.substring(1)}')
            .join(' ');
  }

  void _openDoctor(DoctorDirectoryItem doctor) {
    HapticFeedback.lightImpact();
    ref.read(selectedDoctorProvider.notifier).state = doctor;
    context.push('/doctor-profile');
  }

  Future<void> _showFilterSheet() async {
    final result = await showModalBottomSheet<_FilterSet>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => _FilterBottomSheet(
        initial: _FilterSet(
          specialty: _selectedSpecialty,
          acceptsNewPatients: _filterAcceptingNewPatients,
          language: _filterLanguage,
        ),
        specialtyLabels: _specialtyLabels,
        languageLabels: _languageLabels,
      ),
    );
    if (result == null) return;
    setState(() {
      _selectedSpecialty = result.specialty;
      _filterAcceptingNewPatients = result.acceptsNewPatients;
      _filterLanguage = result.language;
    });
  }

  void _clearFilters() {
    _searchController.clear();
    _debounce?.cancel();
    setState(() {
      _selectedSpecialty = null;
      _filterAcceptingNewPatients = null;
      _filterLanguage = null;
      _fieldText = '';
      _debouncedQuery = '';
    });
  }

  @override
  Widget build(BuildContext context) {
    final doctorsAsync = ref.watch(doctorsProvider(_currentParams));

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.background,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Column(
            children: [
              _buildHeader(),
              _buildSearchBar(),
              _buildSpecialtyChips(),
              const SizedBox(height: DesignTokens.spaceSm),
              Expanded(
                child: doctorsAsync.when(
                  loading: () => _buildSkeletonList(),
                  error: (error, _) => _buildErrorView(error),
                  data: (doctors) {
                    if (doctors.isEmpty) {
                      return _buildEmptyState();
                    }
                    return _buildDoctorList(doctors);
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------

  Widget _buildHeader() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceLg,
        DesignTokens.spaceMd,
        DesignTokens.spaceLg,
        DesignTokens.spaceSm,
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: () => context.pop(),
            behavior: HitTestBehavior.opaque,
            child: Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.surface,
                shape: BoxShape.circle,
                border: Border.all(color: AppColors.border),
              ),
              child: const Icon(
                Icons.arrow_back,
                size: 20,
                color: AppColors.textPrimary,
                semanticLabel: 'Back',
              ),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Find a Doctor',
                  style: TextStyle(
                    fontSize: 24,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                    letterSpacing: DesignTokens.letterSpacingTight,
                    fontFamily: 'Manrope',
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Find the right care for you',
                  style: TextStyle(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                    fontFamily: 'Manrope',
                  ),
                ),
              ],
            ),
          ),
          _buildFilterButton(),
        ],
      ),
    );
  }

  Widget _buildFilterButton() {
    return GestureDetector(
      onTap: _showFilterSheet,
      child: Container(
        height: 40,
        padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
          border: Border.all(color: AppColors.border),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.tune, size: 18, color: AppColors.textPrimary),
            const SizedBox(width: 6),
            Text(
              'Filter',
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
                fontFamily: 'Manrope',
              ),
            ),
            if (_activeFilterCount > 0) ...[
              const SizedBox(width: 6),
              Container(
                width: 18,
                height: 18,
                alignment: Alignment.center,
                decoration: const BoxDecoration(
                  color: AppColors.primary,
                  shape: BoxShape.circle,
                ),
                child: Text(
                  '$_activeFilterCount',
                  style: const TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: AppColors.white,
                    fontFamily: 'Manrope',
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Search bar
  // -------------------------------------------------------------------------

  Widget _buildSearchBar() {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceLg,
        DesignTokens.spaceSm,
        DesignTokens.spaceLg,
        DesignTokens.spaceSm,
      ),
      child: Container(
        height: DesignTokens.inputHeightMd,
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(
            color: _isSearchFocused ? AppColors.primary : AppColors.border,
            width: _isSearchFocused
                ? DesignTokens.borderWidthMedium
                : DesignTokens.borderWidthThin,
          ),
        ),
        child: Row(
          children: [
            const Padding(
              padding: EdgeInsets.only(left: DesignTokens.spaceMd),
              child: Icon(Icons.search, size: 20, color: AppColors.gray400),
            ),
            Expanded(
              child: TextField(
                controller: _searchController,
                focusNode: _searchFocusNode,
                textInputAction: TextInputAction.search,
                style: const TextStyle(
                  fontSize: 15,
                  color: AppColors.textPrimary,
                  fontFamily: 'Manrope',
                ),
                decoration: const InputDecoration(
                  hintText: 'Search doctor, specialty, or symptom',
                  hintStyle: TextStyle(
                    fontSize: 15,
                    color: AppColors.textDisabled,
                    fontFamily: 'Manrope',
                  ),
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  contentPadding: EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceSm,
                    vertical: DesignTokens.spaceMd,
                  ),
                  isDense: true,
                ),
                onChanged: _onSearchChanged,
                onSubmitted: (_) => FocusScope.of(context).unfocus(),
              ),
            ),
            if (_fieldText.isNotEmpty)
              GestureDetector(
                onTap: _clearSearch,
                child: const Padding(
                  padding: EdgeInsets.only(
                    left: DesignTokens.spaceSm,
                    right: DesignTokens.spaceMd,
                  ),
                  child: Icon(
                    Icons.close,
                    size: 20,
                    color: AppColors.gray400,
                    semanticLabel: 'Clear search',
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Specialty chips
  // -------------------------------------------------------------------------

  Widget _buildSpecialtyChips() {
    return SizedBox(
      height: 40,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceLg),
        itemCount: _specialtyChips.length,
        separatorBuilder: (_, __) =>
            const SizedBox(width: DesignTokens.spaceSm),
        itemBuilder: (context, index) {
          final (apiValue, label) = _specialtyChips[index];
          final isSelected = _selectedSpecialty == apiValue;

          return GestureDetector(
            onTap: () => setState(() => _selectedSpecialty = apiValue),
            child: AnimatedContainer(
              duration: DesignTokens.animationFast,
              padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.spaceMd,
                vertical: DesignTokens.spaceSm,
              ),
              decoration: BoxDecoration(
                color: isSelected ? AppColors.primary : AppColors.surface,
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                border: Border.all(
                  color: isSelected ? AppColors.primary : AppColors.border,
                ),
              ),
              child: Center(
                child: Text(
                  label,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: isSelected ? FontWeight.w700 : FontWeight.w600,
                    color: isSelected ? AppColors.white : AppColors.textPrimary,
                    fontFamily: 'Manrope',
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Doctor list
  // -------------------------------------------------------------------------

  Widget _buildDoctorList(List<DoctorDirectoryItem> doctors) {
    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(doctorsProvider(_currentParams));
        await ref.read(doctorsProvider(_currentParams).future);
      },
      color: AppColors.primary,
      child: ListView.builder(
        controller: _scrollController,
        padding: const EdgeInsets.fromLTRB(
          DesignTokens.spaceLg,
          0,
          DesignTokens.spaceLg,
          DesignTokens.space2xl,
        ),
        itemCount: doctors.length,
        itemBuilder: (context, index) {
          return Padding(
            padding: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
            child: _DoctorCard(
              doctor: doctors[index],
              specialtyLabel: _specialtyLabel,
              onTap: () => _openDoctor(doctors[index]),
            ),
          );
        },
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------

  Widget _buildSkeletonList() {
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(
        DesignTokens.spaceLg,
        0,
        DesignTokens.spaceLg,
        DesignTokens.space2xl,
      ),
      physics: const NeverScrollableScrollPhysics(),
      itemCount: 6,
      itemBuilder: (_, __) => _buildSkeletonCard(),
    );
  }

  Widget _buildSkeletonCard() {
    final base = AppColors.gray200;
    return Shimmer.fromColors(
      baseColor: base,
      highlightColor: AppColors.gray100,
      child: Container(
        margin: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
        padding: const EdgeInsets.all(DesignTokens.spaceMd),
        decoration: BoxDecoration(
          color: AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          border: Border.all(color: AppColors.border),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 64,
                  height: 64,
                  decoration:
                      BoxDecoration(color: base, shape: BoxShape.circle),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        height: 16,
                        width: 160,
                        decoration: BoxDecoration(
                          color: base,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceSm),
                      Container(
                        height: 12,
                        width: 120,
                        decoration: BoxDecoration(
                          color: base,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                      const SizedBox(height: DesignTokens.spaceSm),
                      Container(
                        height: 12,
                        width: 180,
                        decoration: BoxDecoration(
                          color: base,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      height: 16,
                      width: 60,
                      decoration: BoxDecoration(
                        color: base,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                    const SizedBox(height: 2),
                    Container(
                      height: 10,
                      width: 64,
                      decoration: BoxDecoration(
                        color: base,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ),
                  ],
                ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            Row(
              children: [
                Container(
                  height: 12,
                  width: 110,
                  decoration: BoxDecoration(
                    color: base,
                    borderRadius: BorderRadius.circular(4),
                  ),
                ),
                const Spacer(),
                Container(
                  height: 36,
                  width: 116,
                  decoration: BoxDecoration(
                    color: base,
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // Error
  // -------------------------------------------------------------------------

  Widget _buildErrorView(Object error) {
    String message = 'Something went wrong';
    bool isForbidden = false;

    if (error is DioException) {
      final apiError = error.error as ApiError?;
      if (apiError != null) {
        if (apiError.isForbidden) {
          isForbidden = true;
          message =
              'You don\'t have permission to browse the doctor directory.';
        } else if (apiError.isUnauthenticated) {
          message = 'Your session has expired. Please sign in again.';
        } else if (apiError.isNetwork) {
          message = 'Cannot reach SmartCura. Check your internet connection.';
        } else if (apiError.isServer) {
          message =
              'The server is having trouble. Please try again in a moment.';
        } else {
          message = apiError.userMessage;
        }
      } else {
        switch (error.type) {
          case DioExceptionType.connectionTimeout:
          case DioExceptionType.sendTimeout:
          case DioExceptionType.receiveTimeout:
            message = 'The request timed out. Please try again.';
            break;
          case DioExceptionType.connectionError:
            message = 'Cannot reach SmartCura. Check your internet connection.';
            break;
          default:
            message = 'Something went wrong. Please try again.';
        }
      }
    } else if (error is ApiError) {
      isForbidden = error.isForbidden;
      message = error.userMessage;
    } else {
      try {
        final m = (error as dynamic).userMessage;
        if (m is String && m.isNotEmpty) message = m;
      } catch (_) {}
    }

    return ErrorView(
      title: 'Could not load doctors',
      message: message,
      onRetry: isForbidden
          ? null
          : () => ref.invalidate(doctorsProvider(_currentParams)),
    );
  }

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  Widget _buildEmptyState() {
    final hasFilters = _debouncedQuery.isNotEmpty ||
        _selectedSpecialty != null ||
        _filterAcceptingNewPatients != null ||
        _filterLanguage != null;

    return RefreshIndicator(
      onRefresh: () async => ref.invalidate(doctorsProvider(_currentParams)),
      color: AppColors.primary,
      child: SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.5,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              EmptyView(
                title: hasFilters ? 'No doctors found' : 'No doctors available',
                body: hasFilters
                    ? 'Try adjusting your search or filters.'
                    : 'There are no doctors in the directory yet. Check back later.',
                icon: hasFilters
                    ? Icons.search_off
                    : Icons.medical_services_outlined,
              ),
              if (hasFilters) ...[
                const SizedBox(height: DesignTokens.spaceMd),
                OutlinedButton.icon(
                  onPressed: _clearFilters,
                  icon: const Icon(Icons.clear_all, size: 18),
                  label: const Text(
                    'Clear filters',
                    style: TextStyle(fontFamily: 'Manrope'),
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.primary,
                    side: const BorderSide(color: AppColors.primary),
                    shape: RoundedRectangleBorder(
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                    ),
                    padding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceMd,
                      vertical: DesignTokens.spaceSm,
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// _FilterSet — the values returned by the filter bottom sheet
// =============================================================================

class _FilterSet {
  final String? specialty;
  final bool? acceptsNewPatients;
  final String? language;

  const _FilterSet({
    this.specialty,
    this.acceptsNewPatients,
    this.language,
  });
}

// =============================================================================
// _FilterBottomSheet — specialty / availability / language, backed by real
// backend query parameters only.
// =============================================================================

class _FilterBottomSheet extends StatefulWidget {
  final _FilterSet initial;
  final Map<String, String> specialtyLabels;
  final Map<String?, String> languageLabels;

  const _FilterBottomSheet({
    required this.initial,
    required this.specialtyLabels,
    required this.languageLabels,
  });

  @override
  State<_FilterBottomSheet> createState() => _FilterBottomSheetState();
}

class _FilterBottomSheetState extends State<_FilterBottomSheet> {
  late String? _specialty;
  late bool? _acceptsNewPatients;
  late String? _language;

  @override
  void initState() {
    super.initState();
    _specialty = widget.initial.specialty;
    _acceptsNewPatients = widget.initial.acceptsNewPatients;
    _language = widget.initial.language;
  }

  void _apply() {
    Navigator.pop(
      context,
      _FilterSet(
        specialty: _specialty,
        acceptsNewPatients: _acceptsNewPatients,
        language: _language,
      ),
    );
  }

  void _clearAll() {
    setState(() {
      _specialty = null;
      _acceptsNewPatients = null;
      _language = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final bottomPadding = MediaQuery.of(context).padding.bottom;

    return Container(
      decoration: const BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(DesignTokens.radius2xl),
          topRight: Radius.circular(DesignTokens.radius2xl),
        ),
      ),
      child: SafeArea(
        top: false,
        child: Padding(
          padding: EdgeInsets.only(
            left: DesignTokens.spaceLg,
            right: DesignTokens.spaceLg,
            top: DesignTokens.spaceMd,
            bottom: bottomPadding + DesignTokens.spaceMd,
          ),
          child: SingleChildScrollView(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Drag handle
                Center(
                  child: Container(
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: AppColors.gray300,
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceMd),

                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text(
                      'Filters',
                      style: TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                        fontFamily: 'Manrope',
                      ),
                    ),
                    GestureDetector(
                      onTap: () => Navigator.pop(context),
                      child: Container(
                        width: 32,
                        height: 32,
                        decoration: const BoxDecoration(
                          color: AppColors.gray100,
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(
                          Icons.close,
                          size: 18,
                          color: AppColors.gray500,
                          semanticLabel: 'Close filters',
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: DesignTokens.spaceLg),

                const Text(
                  'Specialty',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                    fontFamily: 'Manrope',
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                Wrap(
                  spacing: DesignTokens.spaceSm,
                  runSpacing: DesignTokens.spaceSm,
                  children: [
                    _buildChip(
                      label: 'All',
                      selected: _specialty == null,
                      onTap: () => setState(() => _specialty = null),
                    ),
                    ...widget.specialtyLabels.entries.map(
                      (e) => _buildChip(
                        label: e.value,
                        selected: _specialty == e.key,
                        onTap: () => setState(() => _specialty = e.key),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: DesignTokens.spaceLg),

                Container(
                  decoration: BoxDecoration(
                    color: AppColors.gray50,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
                    border: Border.all(color: AppColors.border),
                  ),
                  child: SwitchListTile(
                    value: _acceptsNewPatients == true,
                    onChanged: (value) {
                      setState(() => _acceptsNewPatients = value ? true : null);
                    },
                    title: const Text(
                      'Accepting patients only',
                      style: TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textPrimary,
                        fontFamily: 'Manrope',
                      ),
                    ),
                    activeColor: AppColors.primary,
                    contentPadding: const EdgeInsets.symmetric(
                      horizontal: DesignTokens.spaceMd,
                    ),
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),

                const Text(
                  'Language',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                    fontFamily: 'Manrope',
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                Wrap(
                  spacing: DesignTokens.spaceSm,
                  runSpacing: DesignTokens.spaceSm,
                  children: widget.languageLabels.entries
                      .map(
                        (e) => _buildChip(
                          label: e.value,
                          selected: _language == e.key,
                          onTap: () => setState(() => _language = e.key),
                        ),
                      )
                      .toList(),
                ),
                const SizedBox(height: DesignTokens.spaceLg),

                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: _clearAll,
                        style: OutlinedButton.styleFrom(
                          foregroundColor: AppColors.textPrimary,
                          side: const BorderSide(color: AppColors.border),
                          shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusLg),
                          ),
                          padding: const EdgeInsets.symmetric(
                            vertical: DesignTokens.spaceMd,
                          ),
                        ),
                        child: const Text(
                          'Clear all',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontFamily: 'Manrope',
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(width: DesignTokens.spaceMd),
                    Expanded(
                      child: ElevatedButton(
                        onPressed: _apply,
                        style: ElevatedButton.styleFrom(
                          backgroundColor: AppColors.primary,
                          foregroundColor: AppColors.white,
                          elevation: 0,
                          shape: RoundedRectangleBorder(
                            borderRadius:
                                BorderRadius.circular(DesignTokens.radiusLg),
                          ),
                          padding: const EdgeInsets.symmetric(
                            vertical: DesignTokens.spaceMd,
                          ),
                        ),
                        child: const Text(
                          'Apply',
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontFamily: 'Manrope',
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildChip({
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: DesignTokens.animationFast,
        padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.spaceMd,
          vertical: DesignTokens.spaceSm,
        ),
        decoration: BoxDecoration(
          color: selected ? AppColors.primary : AppColors.surface,
          borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
          border: Border.all(
            color: selected ? AppColors.primary : AppColors.border,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 13,
            fontWeight: selected ? FontWeight.w700 : FontWeight.w600,
            color: selected ? AppColors.white : AppColors.textPrimary,
            fontFamily: 'Manrope',
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// _DoctorCard — directory card, real data only
// =============================================================================

class _DoctorCard extends StatelessWidget {
  final DoctorDirectoryItem doctor;
  final String Function(String) specialtyLabel;
  final VoidCallback onTap;

  const _DoctorCard({
    required this.doctor,
    required this.specialtyLabel,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final primary = doctor.primarySpecialty;
    final primaryLabel = primary != null ? specialtyLabel(primary) : null;
    final secondaryLabel = _secondaryLabel();
    final fee = MoneyFormatter.formatCompact(
      doctor.consultationFeeSen,
      doctor.currency,
    );
    final available = doctor.acceptsNewPatients;
    // The directory has rows carrying both alpha-2 and alpha-3 codes for the
    // same language; normalize then dedupe so a doctor never shows twice.
    final languages = doctor.languages.map(_languageLabel).toSet().join(', ');

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Semantics(
        button: true,
        label: '${doctor.displayName}, ${primaryLabel ?? "doctor"}, '
            'rating ${doctor.ratingAverage.toStringAsFixed(1)}, '
            'fee $fee',
        child: Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(color: AppColors.border),
          ),
          child: Padding(
            padding: const EdgeInsets.all(DesignTokens.spaceMd),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Avatar + availability dot
                    Stack(
                      clipBehavior: Clip.none,
                      children: [
                        AvatarWidget(
                          imageUrl: doctor.imageUrl,
                          name: doctor.displayName,
                          size: 64,
                        ),
                        Positioned(
                          bottom: 0,
                          right: 0,
                          child: Container(
                            width: 14,
                            height: 14,
                            decoration: BoxDecoration(
                              color: available
                                  ? AppColors.success
                                  : AppColors.gray400,
                              shape: BoxShape.circle,
                              border: Border.all(
                                color: AppColors.surface,
                                width: 2.5,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(width: 12),

                    // Identity
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Flexible(
                                child: Text(
                                  doctor.displayName,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.textPrimary,
                                    fontFamily: 'Manrope',
                                  ),
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              if (doctor.verified) ...[
                                const SizedBox(width: 6),
                                const Icon(
                                  Icons.verified,
                                  size: 16,
                                  color: AppColors.primary,
                                  semanticLabel:
                                      'Verified healthcare professional',
                                ),
                              ],
                            ],
                          ),
                          const SizedBox(height: 4),
                          if (primaryLabel != null) ...[
                            Text(
                              primaryLabel,
                              style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w700,
                                color: AppColors.primary,
                                fontFamily: 'Manrope',
                              ),
                            ),
                            const SizedBox(height: 2),
                          ],
                          if (secondaryLabel.isNotEmpty)
                            Text(
                              secondaryLabel,
                              style: const TextStyle(
                                fontSize: 12,
                                color: AppColors.textSecondary,
                                fontFamily: 'Manrope',
                              ),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                        ],
                      ),
                    ),

                    const SizedBox(width: 8),

                    // Fee only — the status badge lives on the bottom row so
                    // the name column keeps enough width on 360dp screens.
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        Text(
                          fee,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w800,
                            color: AppColors.textPrimary,
                            fontFamily: 'Manrope',
                          ),
                        ),
                        const Text(
                          'Consultation fee',
                          style: TextStyle(
                            fontSize: 11,
                            color: AppColors.textSecondary,
                            fontFamily: 'Manrope',
                          ),
                        ),
                      ],
                    ),
                  ],
                ),

                const SizedBox(height: 12),

                // Rating / reviews / experience
                Row(
                  children: [
                    if (doctor.reviewCount > 0) ...[
                      const Icon(
                        Icons.star_rounded,
                        size: 16,
                        color: AppColors.warning,
                        semanticLabel: 'Rating',
                      ),
                      const SizedBox(width: 4),
                      Text(
                        doctor.ratingAverage.toStringAsFixed(1),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w700,
                          color: AppColors.textPrimary,
                          fontFamily: 'Manrope',
                        ),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        '${doctor.reviewCount} '
                        '${doctor.reviewCount == 1 ? 'review' : 'reviews'}',
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.gray500,
                          fontFamily: 'Manrope',
                        ),
                      ),
                    ] else
                      const Text(
                        'No reviews yet',
                        style: TextStyle(
                          fontSize: 12,
                          color: AppColors.gray500,
                          fontFamily: 'Manrope',
                        ),
                      ),
                    if (doctor.yearsExperience > 0) ...[
                      const SizedBox(width: DesignTokens.spaceSm),
                      Container(
                        width: 3,
                        height: 3,
                        decoration: const BoxDecoration(
                          color: AppColors.gray400,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: DesignTokens.spaceSm),
                      Text(
                        '${doctor.yearsExperience} years exp.',
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.gray500,
                          fontFamily: 'Manrope',
                        ),
                      ),
                    ],
                  ],
                ),

                if (languages.isNotEmpty) ...[
                  const SizedBox(height: 12),
                  _DoctorTag(icon: Icons.language_outlined, text: languages),
                ],

                const SizedBox(height: 12),

                // Availability + primary action (never book from the card)
                Row(
                  children: [
                    StatusBadge(
                      text: available
                          ? 'Accepting patients'
                          : 'Currently unavailable',
                      tone: available ? StatusTone.success : StatusTone.neutral,
                      icon: available
                          ? Icons.check_circle
                          : Icons.remove_circle_outline,
                      small: true,
                    ),
                    const Spacer(),
                    OutlinedButton(
                      onPressed: onTap,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.primary,
                        side: const BorderSide(color: AppColors.primary),
                        shape: RoundedRectangleBorder(
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusMd),
                        ),
                        padding: const EdgeInsets.symmetric(
                          horizontal: DesignTokens.spaceMd,
                          vertical: DesignTokens.spaceSm,
                        ),
                        minimumSize: const Size(120, 40),
                      ),
                      child: const Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            'View Profile',
                            style: TextStyle(
                              fontWeight: FontWeight.w700,
                              fontFamily: 'Manrope',
                            ),
                          ),
                          SizedBox(width: 4),
                          Icon(Icons.arrow_forward_ios, size: 14),
                        ],
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String _secondaryLabel() {
    final primary = doctor.primarySpecialty;
    final others = doctor.specialties
        .where((s) => s != primary)
        .map(specialtyLabel)
        .toList();
    if (others.isNotEmpty) return others.join(' • ');
    if (doctor.practiceName.isNotEmpty) return doctor.practiceName;
    return '';
  }

  String _languageLabel(String code) {
    final canonical = _FindDoctorScreenState._languageAliases[code] ?? code;
    return _FindDoctorScreenState._languageLabels[canonical] ??
        code.toUpperCase();
  }
}

// =============================================================================
// _DoctorTag — compact info tag (only real backend fields)
// =============================================================================

class _DoctorTag extends StatelessWidget {
  final IconData icon;
  final String text;

  const _DoctorTag({required this.icon, required this.text});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceSm,
        vertical: 4,
      ),
      decoration: BoxDecoration(
        color: AppColors.gray50,
        borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
        border: Border.all(color: AppColors.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: AppColors.gray500),
          const SizedBox(width: 4),
          Flexible(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 12,
                color: AppColors.gray600,
                fontFamily: 'Manrope',
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}
