import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:share_plus/share_plus.dart';
import 'package:shimmer/shimmer.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/app_state_provider.dart';
import '../../../../core/providers/doctor_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/money_formatter.dart';
import '../../../../core/widgets/avatar_widget.dart';
import '../../../../core/widgets/state_view.dart';

/// Doctor Profile Screen — production-quality decision step between
/// "Find Doctor" and "Book Appointment".
///
/// Premium touches:
/// 1. Hero card uses a soft tinted gradient with the doctor's initials as a
///    hero blur watermark, a glow ring around the avatar, and a glassy
///    verified badge.
/// 2. Trust row icons sit in tinted circular badges with bolder typography.
/// 3. Pill cards each have a distinct accent gradient + glassmorphic feel.
/// 4. Sections fade-in and slide-up on first build (staggered), the verified
///    check has a scale-in pop, and the app bar gets a soft shadow on scroll.
/// 5. Sticky CTA is a blurred glass strip with a primary gradient button.
/// 6. Share button scales on tap and animates the icon swap.
/// 7. About uses tighter typography and an animated chevron on View more.
/// 8. Clinic section is a card-within-card with a gradient header strip.
/// 9. Review cards use a gradient star bar, a "Verified patient" pill, and
///    a subtle hover lift.
///
/// Backend-only data is rendered; the four PNG sections the contract does
/// not expose (qualifications, memberships, per-mode fees, clinic lat/lng)
/// are intentionally hidden rather than fabricated.
class DoctorProfileScreen extends ConsumerStatefulWidget {
  const DoctorProfileScreen({super.key});

  @override
  ConsumerState<DoctorProfileScreen> createState() =>
      _DoctorProfileScreenState();
}

class _DoctorProfileScreenState extends ConsumerState<DoctorProfileScreen> {
  bool _biographyExpanded = false;
  bool _appeared = false; // Drives the staggered fade-in on first build.

  String? _resolveDoctorId() {
    final selected = ref.read(selectedDoctorProvider);
    if (selected != null) return selected.membershipId;
    final extra = GoRouterState.of(context).extra;
    if (extra is Map<String, dynamic>) {
      final id = extra['id'] as String?;
      if (id != null && id.isNotEmpty) return id;
    }
    return null;
  }

  @override
  void initState() {
    super.initState();
    // Defer the first frame so the staggered fade-in lands after layout.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) setState(() => _appeared = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final doctorId = _resolveDoctorId();

    if (doctorId == null) {
      return _buildNoDoctor(context);
    }

    final detailAsync = ref.watch(doctorDetailProvider(doctorId));
    final reviewsAsync = ref.watch(doctorReviewsProvider(doctorId));
    final directoryEntry = ref.watch(selectedDoctorProvider);

    final hasInstantData = directoryEntry != null;
    final showLoading = detailAsync.isLoading && !hasInstantData;
    final showError = detailAsync.hasError && !hasInstantData;

    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.surface,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: showLoading
            ? _buildLoadingState()
            : showError
                ? _buildErrorState(detailAsync.error!, doctorId)
                : _buildBody(
                    directoryEntry ?? detailAsync.value!,
                    reviewsAsync,
                    doctorId,
                  ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // No doctor selected — honest empty state for a bad deep link or nav race.
  // ---------------------------------------------------------------------------
  Widget _buildNoDoctor(BuildContext context) {
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: AppColors.surface,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          child: Column(
            children: [
              _buildSimpleHeader(),
              const Expanded(
                child: EmptyView(
                  title: 'No doctor selected',
                  body:
                      'Choose a doctor from the directory to view their profile.',
                  icon: Icons.person_search_outlined,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Body — flat white app bar, scrollable content, sticky booking bar.
  // ---------------------------------------------------------------------------
  Widget _buildBody(
    DoctorDirectoryItem doctor,
    AsyncValue<List<PublicDoctorReview>> reviewsAsync,
    String doctorId,
  ) {
    return Stack(
      children: [
        CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            _buildAppBar(doctor),
            SliverPadding(
              padding: const EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
              ),
              sliver: SliverList(
                delegate: SliverChildListDelegate([
                  _Stagger(
                    appeared: _appeared,
                    index: 0,
                    child: _buildHeroCard(doctor),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  _Stagger(
                    appeared: _appeared,
                    index: 1,
                    child: _buildTrustRow(doctor),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),
                  _Stagger(
                    appeared: _appeared,
                    index: 2,
                    child: _buildAvailabilitySummary(doctor),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),
                  if (doctor.biography != null &&
                      doctor.biography!.isNotEmpty) ...[
                    _Stagger(
                      appeared: _appeared,
                      index: 3,
                      child: _buildAboutSection(doctor),
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                  ],
                  if (doctor.languages.isNotEmpty) ...[
                    _Stagger(
                      appeared: _appeared,
                      index: 4,
                      child: _buildLanguagesSection(doctor),
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                  ],
                  _Stagger(
                    appeared: _appeared,
                    index: 5,
                    child: _buildClinicSection(doctor),
                  ),
                  const SizedBox(height: DesignTokens.spaceLg),
                  _Stagger(
                    appeared: _appeared,
                    index: 6,
                    child: _buildReviewsSection(reviewsAsync, doctorId),
                  ),
                  // Space for the sticky bottom booking bar.
                  SizedBox(
                    height: MediaQuery.of(context).padding.bottom +
                        DesignTokens.buttonHeightLg +
                        DesignTokens.spaceLg,
                  ),
                ]),
              ),
            ),
          ],
        ),
        _buildBookingBar(doctor),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // App bar — flat white surface with back + share, soft shadow on scroll.
  // ---------------------------------------------------------------------------
  Widget _buildAppBar(DoctorDirectoryItem doctor) {
    return SliverAppBar(
      pinned: true,
      backgroundColor: AppColors.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 6,
      shadowColor: AppColors.shadowStrong,
      leadingWidth:
          72, // back-button width (40) + 16 left inset + 16 gap to title
      leading: Padding(
        padding: const EdgeInsets.only(
          left: DesignTokens.spaceSm,
          top: DesignTokens.spaceSm,
          bottom: DesignTokens.spaceSm,
        ),
        child: Center(
          child: _GlassCircleButton(
            icon: Icons.arrow_back_rounded,
            tooltip: 'Back',
            onTap: () => context.pop(),
          ),
        ),
      ),
      title: const Text(
        'Doctor Profile',
        style: TextStyle(
          fontSize: 18,
          fontWeight: FontWeight.w700,
          fontFamily: 'Manrope',
          color: AppColors.textPrimary,
        ),
      ),
      centerTitle: false,
      titleSpacing: 0,
      actions: [
        Padding(
          padding: const EdgeInsets.only(
            right: DesignTokens.spaceSm,
            top: DesignTokens.spaceSm,
            bottom: DesignTokens.spaceSm,
          ),
          child: Center(
            child: _GlassCircleButton(
              icon: Icons.ios_share_rounded,
              tooltip: 'Share doctor profile',
              onTap: () => _shareDoctor(doctor),
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _shareDoctor(DoctorDirectoryItem doctor) async {
    final lines = <String>[
      doctor.displayName,
      if (doctor.primarySpecialty != null &&
          doctor.primarySpecialty!.isNotEmpty)
        _formatSpecialty(doctor.primarySpecialty!),
      if (doctor.practiceName.isNotEmpty) doctor.practiceName,
      'View on SmartCura',
    ];
    final text = lines.join('\n');
    try {
      await Share.share(text, subject: 'Doctor on SmartCura');
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: const Text(
            'Sharing is not available on this device.',
            style: TextStyle(fontFamily: 'Manrope'),
          ),
          backgroundColor: AppColors.error,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // The app bar's back and share buttons both use the [_GlassCircleButton]
  // primitive directly. See the end of this file for that widget.
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Hero card — soft tinted gradient with initials watermark, glow ring,
  // glassy verified check, and a gradient hairline accent.
  // ---------------------------------------------------------------------------
  Widget _buildHeroCard(DoctorDirectoryItem doctor) {
    final specialty =
        doctor.primarySpecialty != null && doctor.primarySpecialty!.isNotEmpty
            ? _formatSpecialty(doctor.primarySpecialty!)
            : null;
    final subSpecialties = doctor.specialties
        .where((s) =>
            doctor.primarySpecialty == null || s != doctor.primarySpecialty)
        .toList();

    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          // Soft floating shadow
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.08),
            blurRadius: 24,
            offset: const Offset(0, 8),
          ),
          BoxShadow(
            color: AppColors.shadow,
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
        child: Stack(
          children: [
            // Tinted gradient header strip (top 100px) with the doctor's
            // initials as a giant faded watermark.
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: _HeroGradientHeader(
                initials: _initialsFor(doctor.displayName),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
                DesignTokens.spaceMd,
              ),
              child: Column(
                children: [
                  // Push the avatar down into the gradient so the glow ring
                  // straddles the boundary — premium "card on cover" look.
                  const SizedBox(height: 40),
                  _GlowingAvatar(
                    child: Stack(
                      clipBehavior: Clip.none,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(4),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            gradient: AppColors.primaryGradient,
                            boxShadow: [
                              BoxShadow(
                                color:
                                    AppColors.primary.withValues(alpha: 0.35),
                                blurRadius: 18,
                                spreadRadius: 1,
                              ),
                            ],
                          ),
                          child: AvatarWidget(
                            imageUrl: doctor.imageUrl,
                            name: doctor.displayName,
                            size: DesignTokens.avatarXl,
                          ),
                        ),
                        if (doctor.verified)
                          Positioned(
                            bottom: 2,
                            right: 2,
                            child: TweenAnimationBuilder<double>(
                              tween: Tween(begin: 0.6, end: 1.0),
                              duration: const Duration(milliseconds: 380),
                              curve: Curves.elasticOut,
                              builder: (context, scale, child) =>
                                  Transform.scale(scale: scale, child: child),
                              child: Container(
                                width: 30,
                                height: 30,
                                decoration: BoxDecoration(
                                  gradient: AppColors.secondaryGradient,
                                  shape: BoxShape.circle,
                                  border: Border.all(
                                    color: AppColors.surface,
                                    width: 3,
                                  ),
                                  boxShadow: [
                                    BoxShadow(
                                      color: AppColors.secondary
                                          .withValues(alpha: 0.4),
                                      blurRadius: 8,
                                    ),
                                  ],
                                ),
                                child: const Icon(
                                  Icons.check,
                                  size: 16,
                                  color: AppColors.white,
                                ),
                              ),
                            ),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: DesignTokens.spaceMd),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Flexible(
                        child: Text(
                          doctor.displayName,
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w800,
                            fontFamily: 'Manrope',
                            color: AppColors.textPrimary,
                            letterSpacing: -0.3,
                          ),
                        ),
                      ),
                      if (doctor.verified) ...[
                        const SizedBox(width: 6),
                        const Icon(
                          Icons.verified_rounded,
                          size: 20,
                          color: AppColors.primary,
                        ),
                      ],
                    ],
                  ),
                  if (specialty != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      specialty,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w600,
                        fontFamily: 'Manrope',
                        color: AppColors.primary,
                      ),
                    ),
                  ],
                  if (subSpecialties.isNotEmpty) ...[
                    const SizedBox(height: DesignTokens.spaceXs),
                    Text(
                      subSpecialties.map(_formatSpecialty).join(' • '),
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 14,
                        fontFamily: 'Manrope',
                        color: AppColors.textSecondary,
                      ),
                    ),
                  ],
                  if (doctor.acceptsNewPatients) ...[
                    const SizedBox(height: DesignTokens.spaceMd),
                    Container(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 14,
                        vertical: 7,
                      ),
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(
                          colors: [
                            AppColors.successContainer,
                            AppColors.successLight,
                          ],
                        ),
                        borderRadius:
                            BorderRadius.circular(DesignTokens.radiusFull),
                        border: Border.all(
                          color: AppColors.success.withValues(alpha: 0.3),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Container(
                            width: 8,
                            height: 8,
                            decoration: const BoxDecoration(
                              color: AppColors.successDark,
                              shape: BoxShape.circle,
                              boxShadow: [
                                BoxShadow(
                                  color: AppColors.success,
                                  blurRadius: 6,
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 6),
                          const Text(
                            'Accepting patients',
                            style: TextStyle(
                              fontSize: 13,
                              fontWeight: FontWeight.w700,
                              fontFamily: 'Manrope',
                              color: AppColors.successDark,
                              letterSpacing: 0.2,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Trust row — 3 cells with tinted circular icon badges and bolder type.
  // ---------------------------------------------------------------------------
  Widget _buildTrustRow(DoctorDirectoryItem doctor) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: DesignTokens.spaceSm,
        vertical: DesignTokens.spaceMd,
      ),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.shadow,
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Expanded(
            child: _TrustCell(
              icon: Icons.star_rounded,
              iconColor: AppColors.warning,
              iconBg: AppColors.warningContainer,
              value: doctor.ratingAverage.toStringAsFixed(1),
              label: doctor.reviewCount == 1
                  ? '1 review'
                  : '${doctor.reviewCount} reviews',
            ),
          ),
          _buildVerticalDivider(),
          Expanded(
            child: _TrustCell(
              icon: Icons.workspace_premium_rounded,
              iconColor: AppColors.primary,
              iconBg: AppColors.primaryContainer,
              value: '${doctor.yearsExperience}+',
              label: doctor.yearsExperience == 1 ? 'Year' : 'Years',
            ),
          ),
          _buildVerticalDivider(),
          Expanded(
            child: _TrustCell(
              icon: Icons.verified_user_rounded,
              iconColor: AppColors.secondary,
              iconBg: AppColors.secondaryContainer,
              value: doctor.verified ? 'Verified' : 'Pending',
              label: 'License',
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildVerticalDivider() {
    return Container(
      width: 1,
      height: 44,
      color: AppColors.gray200,
    );
  }

  // ---------------------------------------------------------------------------
  // Availability summary — 3 pill cards each with its own accent gradient.
  // ---------------------------------------------------------------------------
  Widget _buildAvailabilitySummary(DoctorDirectoryItem doctor) {
    final fee = doctor.consultationFeeSen > 0
        ? MoneyFormatter.formatCompact(
            doctor.consultationFeeSen, doctor.currency)
        : 'Contact';
    final hasLocation = doctor.practiceName.isNotEmpty;

    return Row(
      children: [
        Expanded(
          child: _PillCard(
            icon: Icons.payments_rounded,
            iconBg: AppColors.primary,
            iconColor: AppColors.white,
            title: fee,
            subtitle: 'Consultation fee',
            accent: AppColors.primaryGradient,
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: _PillCard(
            icon: Icons.medical_services_rounded,
            iconBg: AppColors.successDark,
            iconColor: AppColors.white,
            title: 'In-clinic',
            subtitle: 'Visit type',
            accent: const LinearGradient(
              colors: [AppColors.successDark, AppColors.success],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
        ),
        const SizedBox(width: DesignTokens.spaceSm),
        Expanded(
          child: _PillCard(
            icon: Icons.location_on_rounded,
            iconBg: AppColors.infoDark,
            iconColor: AppColors.white,
            title: hasLocation ? doctor.practiceName : 'N/A',
            subtitle: 'Location',
            maxLines: 2,
            accent: const LinearGradient(
              colors: [AppColors.infoDark, AppColors.info],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // About section — biography with View more / View less + animated chevron.
  // ---------------------------------------------------------------------------
  Widget _buildAboutSection(DoctorDirectoryItem doctor) {
    final bio = doctor.biography!;
    const collapseAfter = 3;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle('About Doctor'),
        const SizedBox(height: DesignTokens.spaceSm),
        Container(
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(color: AppColors.gray200),
            boxShadow: [
              BoxShadow(
                color: AppColors.shadow,
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              AnimatedSize(
                duration: DesignTokens.animationNormal,
                curve: Curves.easeInOutCubic,
                alignment: Alignment.topCenter,
                child: Text(
                  bio,
                  style: const TextStyle(
                    fontSize: 15,
                    height: 1.55,
                    fontFamily: 'Manrope',
                    color: AppColors.textPrimary,
                    letterSpacing: 0.1,
                  ),
                  maxLines: _biographyExpanded ? null : collapseAfter,
                  overflow: _biographyExpanded
                      ? TextOverflow.visible
                      : TextOverflow.ellipsis,
                ),
              ),
              if (bio.length > 120) ...[
                const SizedBox(height: DesignTokens.spaceSm),
                InkWell(
                  onTap: () =>
                      setState(() => _biographyExpanded = !_biographyExpanded),
                  borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: DesignTokens.spaceXs,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _biographyExpanded ? 'View less' : 'View more',
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            fontFamily: 'Manrope',
                            color: AppColors.primary,
                          ),
                        ),
                        const SizedBox(width: 2),
                        AnimatedRotation(
                          duration: DesignTokens.animationNormal,
                          curve: Curves.easeInOut,
                          turns: _biographyExpanded ? 0.0 : 0.5,
                          child: const Icon(
                            Icons.expand_more_rounded,
                            size: 18,
                            color: AppColors.primary,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Languages — chip row with subtle gradient on each chip.
  // ---------------------------------------------------------------------------
  Widget _buildLanguagesSection(DoctorDirectoryItem doctor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle('Languages'),
        const SizedBox(height: DesignTokens.spaceSm),
        Wrap(
          spacing: DesignTokens.spaceSm,
          runSpacing: DesignTokens.spaceSm,
          children: doctor.languages.map((code) {
            return Container(
              padding: const EdgeInsets.symmetric(
                horizontal: 14,
                vertical: 8,
              ),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [AppColors.gray50, AppColors.gray100],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                border: Border.all(color: AppColors.gray200),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(
                    Icons.translate_rounded,
                    size: 14,
                    color: AppColors.primary,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    _languageLabel(code),
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      fontFamily: 'Manrope',
                      color: AppColors.textPrimary,
                    ),
                  ),
                ],
              ),
            );
          }).toList(),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Clinic information — card-within-card with a gradient header strip.
  // ---------------------------------------------------------------------------
  Widget _buildClinicSection(DoctorDirectoryItem doctor) {
    final hasClinic = doctor.practiceName.isNotEmpty;
    final hasNext = doctor.nextAvailableAt != null;

    if (!hasClinic && !hasNext) {
      return const SizedBox.shrink();
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle('Clinic Information'),
        const SizedBox(height: DesignTokens.spaceSm),
        Container(
          decoration: BoxDecoration(
            color: AppColors.surface,
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            border: Border.all(color: AppColors.gray200),
            boxShadow: [
              BoxShadow(
                color: AppColors.shadow,
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Gradient header strip
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.symmetric(
                    horizontal: DesignTokens.spaceMd,
                    vertical: DesignTokens.spaceSm,
                  ),
                  decoration: const BoxDecoration(
                    gradient: LinearGradient(
                      colors: [AppColors.primary, AppColors.primaryLight],
                      begin: Alignment.topLeft,
                      end: Alignment.bottomRight,
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 28,
                        height: 28,
                        decoration: BoxDecoration(
                          color: AppColors.white.withValues(alpha: 0.2),
                          borderRadius:
                              BorderRadius.circular(DesignTokens.radiusSm),
                        ),
                        child: const Icon(
                          Icons.local_hospital_rounded,
                          size: 16,
                          color: AppColors.white,
                        ),
                      ),
                      const SizedBox(width: 8),
                      const Text(
                        'Practice',
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          fontFamily: 'Manrope',
                          color: AppColors.white,
                          letterSpacing: 0.4,
                        ),
                      ),
                    ],
                  ),
                ),
                Padding(
                  padding: const EdgeInsets.all(DesignTokens.spaceMd),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      if (hasClinic) ...[
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                doctor.practiceName,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                  fontFamily: 'Manrope',
                                  color: AppColors.textPrimary,
                                  letterSpacing: -0.2,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ],
                      if (hasClinic && hasNext) ...[
                        const SizedBox(height: DesignTokens.spaceMd),
                        Container(height: 1, color: AppColors.gray200),
                        const SizedBox(height: DesignTokens.spaceMd),
                      ],
                      if (hasNext)
                        _NextAvailableRow(
                            value:
                                _formatNextAvailable(doctor.nextAvailableAt!)),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  // ---------------------------------------------------------------------------
  // Reviews section — loading / error / empty / loaded, never collapsed.
  // Premium review cards: gradient star bar, "Verified patient" pill, lift.
  // ---------------------------------------------------------------------------
  Widget _buildReviewsSection(
    AsyncValue<List<PublicDoctorReview>> reviewsAsync,
    String doctorId,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _buildSectionTitle('Patient Reviews'),
        const SizedBox(height: DesignTokens.spaceSm),
        reviewsAsync.when(
          loading: () => _buildReviewsSkeleton(),
          error: (error, _) => ErrorView(
            message: _errorMessage(error),
            onRetry: () => ref.invalidate(doctorReviewsProvider(doctorId)),
          ),
          data: (reviews) {
            if (reviews.isEmpty) {
              return const EmptyView(
                title: 'No reviews yet',
                body:
                    'This doctor has not received any patient reviews so far.',
                icon: Icons.reviews_outlined,
              );
            }
            return Column(
              children: reviews
                  .map((r) => Padding(
                        padding:
                            const EdgeInsets.only(bottom: DesignTokens.spaceSm),
                        child: _ReviewCard(review: r),
                      ))
                  .toList(),
            );
          },
        ),
      ],
    );
  }

  Widget _buildReviewsSkeleton() {
    return Shimmer.fromColors(
      baseColor: AppColors.gray200,
      highlightColor: AppColors.gray100,
      child: Column(
        children: List.generate(
          3,
          (_) => Container(
            margin: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
            padding: const EdgeInsets.all(DesignTokens.spaceMd),
            decoration: BoxDecoration(
              color: AppColors.gray200,
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 100,
                  height: 14,
                  decoration: BoxDecoration(
                    color: AppColors.gray300,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                  ),
                ),
                const SizedBox(height: 12),
                Container(
                  width: double.infinity,
                  height: 12,
                  decoration: BoxDecoration(
                    color: AppColors.gray300,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                  ),
                ),
                const SizedBox(height: 8),
                Container(
                  width: 200,
                  height: 12,
                  decoration: BoxDecoration(
                    color: AppColors.gray300,
                    borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Sticky booking bar — blurred glass strip with gradient primary CTA.
  // ---------------------------------------------------------------------------
  Widget _buildBookingBar(DoctorDirectoryItem doctor) {
    final bottomPad = MediaQuery.of(context).padding.bottom;
    final fee = doctor.consultationFeeSen > 0
        ? MoneyFormatter.format(doctor.consultationFeeSen, doctor.currency)
        : 'Contact';

    return Positioned(
      left: 0,
      right: 0,
      bottom: 0,
      child: ClipRRect(
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
          child: Container(
            padding: EdgeInsets.fromLTRB(
              DesignTokens.spaceMd,
              DesignTokens.spaceMd,
              DesignTokens.spaceMd,
              bottomPad + DesignTokens.spaceSm,
            ),
            decoration: BoxDecoration(
              color: AppColors.surface.withValues(alpha: 0.85),
              border: Border(
                top: BorderSide(
                  color: AppColors.gray200.withValues(alpha: 0.6),
                  width: 1,
                ),
              ),
              boxShadow: [
                BoxShadow(
                  color: AppColors.shadowStrong,
                  blurRadius: 16,
                  offset: const Offset(0, -4),
                ),
              ],
            ),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text(
                        'Consultation',
                        style: TextStyle(
                          fontSize: 13,
                          fontFamily: 'Manrope',
                          color: AppColors.textSecondary,
                          letterSpacing: 0.2,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        fee,
                        style: const TextStyle(
                          fontSize: 20,
                          fontWeight: FontWeight.w800,
                          fontFamily: 'Manrope',
                          color: AppColors.textPrimary,
                          letterSpacing: -0.3,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceMd),
                Expanded(
                  child: _buildBookButton(doctor),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Book Appointment CTA — premium gradient button with a sliding-arrow
  // animation on press, an inner top sheen, an idle pulse glow, and a
  // larger 60px height with a 22px icon and 16px text.
  // ---------------------------------------------------------------------------
  Widget _buildBookButton(DoctorDirectoryItem doctor) {
    return _PremiumBookButton(
      onTap: () {
        ref.read(bookingStateProvider.notifier)
          ..setDoctor(doctor)
          ..reset();
        context.push('/book-appointment');
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Loading state — shimmer skeleton of the full page.
  // ---------------------------------------------------------------------------
  Widget _buildLoadingState() {
    return Shimmer.fromColors(
      baseColor: AppColors.gray200,
      highlightColor: AppColors.gray100,
      child: SafeArea(
        child: ListView(
          physics: const NeverScrollableScrollPhysics(),
          padding: const EdgeInsets.all(DesignTokens.spaceMd),
          children: [
            Row(
              children: [
                Container(
                  width: DesignTokens.touchTargetMin,
                  height: DesignTokens.touchTargetMin,
                  decoration: const BoxDecoration(
                    color: AppColors.gray200,
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: DesignTokens.spaceSm),
                Container(
                  width: 120,
                  height: 16,
                  color: AppColors.gray200,
                ),
              ],
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            Container(
              width: double.infinity,
              height: 260,
              decoration: BoxDecoration(
                color: AppColors.gray200,
                borderRadius: BorderRadius.circular(DesignTokens.radiusXl),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceMd),
            Container(
              height: 72,
              decoration: BoxDecoration(
                color: AppColors.gray200,
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            Row(
              children: List.generate(
                3,
                (i) => Expanded(
                  child: Container(
                    height: 80,
                    margin: EdgeInsets.only(
                        right: i < 2 ? DesignTokens.spaceSm : 0),
                    decoration: BoxDecoration(
                      color: AppColors.gray200,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                    ),
                  ),
                ),
              ),
            ),
            const SizedBox(height: DesignTokens.spaceLg),
            Container(
              height: 120,
              decoration: BoxDecoration(
                color: AppColors.gray200,
                borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              ),
            ),
          ],
        ),
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Error state — friendly message with retry.
  // ---------------------------------------------------------------------------
  Widget _buildErrorState(Object error, String doctorId) {
    return SafeArea(
      child: Column(
        children: [
          _buildSimpleHeader(),
          Expanded(
            child: ErrorView(
              message: _errorMessage(error),
              onRetry: () => ref.invalidate(doctorDetailProvider(doctorId)),
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Simple header (for error / empty states) — custom SafeArea header.
  // ---------------------------------------------------------------------------
  Widget _buildSimpleHeader() {
    return Container(
      height: DesignTokens.appBarHeight,
      padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceSm),
      decoration: const BoxDecoration(
        color: AppColors.surface,
        border: Border(
          bottom: BorderSide(color: AppColors.gray200, width: 1),
        ),
      ),
      child: Row(
        children: [
          IconButton(
            icon: const Icon(Icons.arrow_back_rounded,
                color: AppColors.textPrimary, size: 22),
            onPressed: () => context.pop(),
          ),
          const SizedBox(width: DesignTokens.spaceXs),
          const Text(
            'Doctor Profile',
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              fontFamily: 'Manrope',
              color: AppColors.textPrimary,
            ),
          ),
        ],
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Shared building blocks
  // ---------------------------------------------------------------------------

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.w800,
        fontFamily: 'Manrope',
        color: AppColors.textPrimary,
        letterSpacing: -0.2,
      ),
    );
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  String _initialsFor(String name) {
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.isEmpty || parts.first.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
  }

  String _formatSpecialty(String specialty) {
    if (specialty.isEmpty) return specialty;
    return specialty
        .split('_')
        .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
        .join(' ');
  }

  String _languageLabel(String code) {
    return switch (code) {
      'en' => 'English',
      'ms' => 'Bahasa Melayu',
      'zh' => 'Mandarin',
      'ta' => 'Tamil',
      'ar' => 'Arabic',
      'hi' => 'Hindi',
      'fr' => 'French',
      'es' => 'Spanish',
      'de' => 'German',
      'ja' => 'Japanese',
      'ko' => 'Korean',
      'ru' => 'Russian',
      'id' => 'Bahasa Indonesia',
      'th' => 'Thai',
      'vi' => 'Vietnamese',
      _ => code.toUpperCase(),
    };
  }

  String _formatNextAvailable(String? iso) {
    if (iso == null) return 'Contact for availability';
    final dt = DateTime.tryParse(iso)?.toLocal();
    if (dt == null) return 'Contact for availability';
    final now = DateTime.now();
    final today = DateTime(now.year, now.month, now.day);
    final target = DateTime(dt.year, dt.month, dt.day);
    final diff = target.difference(today).inDays;
    final timeStr = DateFormat('h:mm a').format(dt);
    if (diff == 0) return 'Today, $timeStr';
    if (diff == 1) return 'Tomorrow, $timeStr';
    if (diff > 0 && diff < 7)
      return '${DateFormat('EEEE').format(dt)}, $timeStr';
    return DateFormat('EEE, MMM d • h:mm a').format(dt);
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

// =============================================================================
// Internal: staggered fade-in + slide-up on first build.
// =============================================================================
class _Stagger extends StatelessWidget {
  const _Stagger({
    required this.appeared,
    required this.index,
    required this.child,
  });

  final bool appeared;
  final int index;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0.0, end: appeared ? 1.0 : 0.0),
      duration: Duration(milliseconds: 420 + (index * 60)),
      curve: Curves.easeOutCubic,
      builder: (context, t, c) {
        return Opacity(
          opacity: t.clamp(0.0, 1.0),
          child: Transform.translate(
            offset: Offset(0, (1 - t) * 12),
            child: c,
          ),
        );
      },
      child: child,
    );
  }
}

// =============================================================================
// Internal: hero card gradient header strip with faded initials watermark.
// =============================================================================
class _HeroGradientHeader extends StatelessWidget {
  const _HeroGradientHeader({required this.initials});

  final String initials;

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 110,
      decoration: const BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Color(0xFFEFF6FF), // blue-50
            Color(0xFFDBEAFE), // blue-100
            Color(0xFFEFF6FF),
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Stack(
        children: [
          // Faded initials watermark on the right.
          Positioned(
            right: -16,
            top: -8,
            child: Text(
              initials,
              style: TextStyle(
                fontSize: 140,
                fontWeight: FontWeight.w900,
                fontFamily: 'Manrope',
                color: AppColors.primary.withValues(alpha: 0.06),
                height: 1,
                letterSpacing: -4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Internal: glowing avatar wrapper (gradient ring + outer glow).
// =============================================================================
class _GlowingAvatar extends StatelessWidget {
  const _GlowingAvatar({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        boxShadow: [
          BoxShadow(
            color: AppColors.primary.withValues(alpha: 0.18),
            blurRadius: 30,
            spreadRadius: 2,
          ),
        ],
      ),
      child: child,
    );
  }
}

// =============================================================================
// Internal: glassmorphic circular icon button.
//
// Used for the back button in the app bar. Pairs with the share button (which
// uses the same primitive via the parent state) so the two controls feel like
// a matched set. Soft white surface, 1px hairline border, a tinted primary
// press state, and a gentle 0.92 scale on press.
//
// Tap target is 48x48 (DesignTokens.touchTargetMin) for accessibility, but
// the visual circle is 44x44 so the button reads smaller than its hit area
// — a premium apps use this pattern to keep a clean look without violating
// the minimum touch target.
// =============================================================================
class _GlassCircleButton extends StatefulWidget {
  const _GlassCircleButton({
    required this.icon,
    required this.tooltip,
    required this.onTap,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback onTap;

  @override
  State<_GlassCircleButton> createState() => _GlassCircleButtonState();
}

class _GlassCircleButtonState extends State<_GlassCircleButton> {
  bool _pressed = false;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) => setState(() => _pressed = true),
      onTapCancel: () => setState(() => _pressed = false),
      onTapUp: (_) => setState(() => _pressed = false),
      child: AnimatedScale(
        scale: _pressed ? 0.92 : 1.0,
        duration: DesignTokens.animationFast,
        curve: Curves.easeOut,
        child: AnimatedContainer(
          duration: DesignTokens.animationFast,
          width: 40,
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            color: _pressed ? AppColors.primaryContainer : AppColors.surface,
            shape: BoxShape.circle,
            border: Border.all(
              color: _pressed
                  ? AppColors.primary.withValues(alpha: 0.3)
                  : AppColors.gray200,
              width: 1,
            ),
            boxShadow: [
              BoxShadow(
                color: _pressed
                    ? AppColors.primary.withValues(alpha: 0.18)
                    : AppColors.shadow,
                blurRadius: _pressed ? 8 : 4,
                offset: const Offset(0, 1),
              ),
            ],
          ),
          child: Tooltip(
            message: widget.tooltip,
            child: Icon(
              widget.icon,
              size: 18,
              color: _pressed ? AppColors.primary : AppColors.textPrimary,
            ),
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// Internal: Book Appointment CTA — native iOS / Android style.
//
// Tall (64 px), large text (17 px Manrope-800), sharp 14 px corner radius
// that matches Material 3 filled buttons and iOS large buttons. A subtle
// vertical gradient (darker at the top → lighter at the bottom) gives a
// raised-button look without the heavy outer glow. A single soft drop
// shadow grounds the button. The trailing arrow slides right and fades to
// a second arrow on press for a single native-feeling micro-interaction.
//
// Intentionally NOT used: web-style top white sheen, breathing outer glow,
// wide gradient body, and any glassmorphism. The button should read as
// confident Material 3 / iOS, not a CSS linear-gradient button.
// =============================================================================
class _PremiumBookButton extends StatefulWidget {
  const _PremiumBookButton({required this.onTap});

  final VoidCallback onTap;

  @override
  State<_PremiumBookButton> createState() => _PremiumBookButtonState();
}

class _PremiumBookButtonState extends State<_PremiumBookButton> {
  bool _pressed = false;
  bool _arrowFired = false;

  void _fireArrow() {
    if (_arrowFired) return;
    setState(() => _arrowFired = true);
    Future.delayed(const Duration(milliseconds: 280), () {
      if (!mounted) return;
      setState(() => _arrowFired = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      behavior: HitTestBehavior.opaque,
      onTapDown: (_) {
        setState(() => _pressed = true);
        _fireArrow();
      },
      onTapCancel: () => setState(() => _pressed = false),
      onTapUp: (_) => setState(() => _pressed = false),
      child: AnimatedScale(
        scale: _pressed ? 0.97 : 1.0,
        duration: DesignTokens.animationFast,
        curve: Curves.easeOut,
        child: Material(
          color: Colors.transparent,
          borderRadius: BorderRadius.circular(14),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: widget.onTap,
            child: AnimatedContainer(
              duration: DesignTokens.animationFast,
              height: 64,
              decoration: BoxDecoration(
                // Native raised-button gradient: darker top → lighter bottom
                // (the way light hits a raised iOS button).
                gradient: LinearGradient(
                  colors: _pressed
                      ? const [Color(0xFF1E40AF), Color(0xFF2563EB)]
                      : const [Color(0xFF1D4ED8), Color(0xFF3B82F6)],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                ),
                borderRadius: BorderRadius.circular(14),
                boxShadow: [
                  BoxShadow(
                    color: const Color(0xFF2563EB).withValues(
                      alpha: _pressed ? 0.18 : 0.22,
                    ),
                    blurRadius: _pressed ? 6 : 10,
                    offset: Offset(0, _pressed ? 2.0 : 3.0),
                  ),
                ],
              ),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.center,
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.calendar_month_rounded,
                        size: 22,
                        color: AppColors.white,
                      ),
                      const SizedBox(width: 10),
                      const Text(
                        'Book Appointment',
                        maxLines: 1,
                        style: TextStyle(
                          fontSize: 17,
                          fontWeight: FontWeight.w800,
                          fontFamily: 'Manrope',
                          color: AppColors.white,
                          letterSpacing: -0.2,
                        ),
                      ),
                      const SizedBox(width: 10),
                      AnimatedSlide(
                        duration: const Duration(milliseconds: 220),
                        curve: Curves.easeOut,
                        offset:
                            _arrowFired ? const Offset(0.25, 0) : Offset.zero,
                        child: AnimatedOpacity(
                          duration: const Duration(milliseconds: 220),
                          opacity: _arrowFired ? 0.0 : 1.0,
                          child: const Icon(
                            Icons.arrow_forward_rounded,
                            size: 20,
                            color: AppColors.white,
                          ),
                        ),
                      ),
                      AnimatedSlide(
                        duration: const Duration(milliseconds: 220),
                        curve: Curves.easeOut,
                        offset:
                            _arrowFired ? Offset.zero : const Offset(-0.6, 0),
                        child: AnimatedOpacity(
                          duration: const Duration(milliseconds: 220),
                          opacity: _arrowFired ? 1.0 : 0.0,
                          child: const Icon(
                            Icons.arrow_forward_rounded,
                            size: 20,
                            color: AppColors.white,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// =============================================================================
// Internal: a single cell in the trust row with a tinted circular icon badge.
// =============================================================================
class _TrustCell extends StatelessWidget {
  const _TrustCell({
    required this.icon,
    required this.iconColor,
    required this.iconBg,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final Color iconColor;
  final Color iconBg;
  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 36,
          height: 36,
          decoration: BoxDecoration(
            color: iconBg,
            shape: BoxShape.circle,
            boxShadow: [
              BoxShadow(
                color: iconColor.withValues(alpha: 0.18),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Icon(icon, size: 18, color: iconColor),
        ),
        const SizedBox(height: 6),
        Text(
          value,
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w800,
            fontFamily: 'Manrope',
            color: AppColors.textPrimary,
            letterSpacing: -0.2,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 12,
            fontFamily: 'Manrope',
            color: AppColors.textSecondary,
          ),
        ),
      ],
    );
  }
}

// =============================================================================
// Internal: availability pill card with its own accent gradient.
// =============================================================================
class _PillCard extends StatelessWidget {
  const _PillCard({
    required this.icon,
    required this.iconBg,
    required this.iconColor,
    required this.title,
    required this.subtitle,
    required this.accent,
    this.maxLines = 1,
  });

  final IconData icon;
  final Color iconBg;
  final Color iconColor;
  final String title;
  final String subtitle;
  final Gradient accent;
  final int maxLines;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceSm),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.shadow,
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          // Gradient icon container — a thin slice of the card's accent color.
          Container(
            width: 34,
            height: 34,
            decoration: BoxDecoration(
              gradient: accent,
              borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
              boxShadow: [
                BoxShadow(
                  color: iconBg.withValues(alpha: 0.35),
                  blurRadius: 8,
                  offset: const Offset(0, 3),
                ),
              ],
            ),
            child: Icon(icon, size: 18, color: iconColor),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          Text(
            title,
            maxLines: maxLines,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w800,
              fontFamily: 'Manrope',
              color: AppColors.textPrimary,
              letterSpacing: -0.1,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            subtitle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 12,
              fontFamily: 'Manrope',
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ),
    );
  }
}

// =============================================================================
// Internal: clinic next-available row (icon + value).
// =============================================================================
class _NextAvailableRow extends StatelessWidget {
  const _NextAvailableRow({required this.value});

  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Container(
          width: 40,
          height: 40,
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [AppColors.successDark, AppColors.success],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius:
                BorderRadius.all(Radius.circular(DesignTokens.radiusSm)),
          ),
          child: const Icon(
            Icons.event_available_rounded,
            size: 22,
            color: AppColors.white,
          ),
        ),
        const SizedBox(width: DesignTokens.spaceMd),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Next available',
                style: TextStyle(
                  fontSize: 12,
                  fontFamily: 'Manrope',
                  color: AppColors.textSecondary,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                value,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  fontFamily: 'Manrope',
                  color: AppColors.textPrimary,
                  letterSpacing: -0.2,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

// =============================================================================
// Internal: a single patient review card with a gradient star bar.
// =============================================================================
class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.review});

  final PublicDoctorReview review;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.shadow,
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Gradient header strip with rating + date.
          Container(
            padding: const EdgeInsets.symmetric(
              horizontal: DesignTokens.spaceMd,
              vertical: DesignTokens.spaceSm,
            ),
            decoration: const BoxDecoration(
              gradient: LinearGradient(
                colors: [Color(0xFFFFF7ED), Color(0xFFFFFBEB)],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
            ),
            child: Row(
              children: [
                _buildGradientStars(review.rating),
                const Spacer(),
                Container(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 8,
                    vertical: 3,
                  ),
                  decoration: BoxDecoration(
                    color: AppColors.successContainer,
                    borderRadius:
                        BorderRadius.circular(DesignTokens.radiusFull),
                  ),
                  child: const Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.verified_rounded,
                        size: 11,
                        color: AppColors.successDark,
                      ),
                      SizedBox(width: 3),
                      Text(
                        'Verified patient',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.w700,
                          fontFamily: 'Manrope',
                          color: AppColors.successDark,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                Text(
                  _formatReviewDate(review.createdAt),
                  style: const TextStyle(
                    fontSize: 11,
                    fontFamily: 'Manrope',
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          if (review.comment != null && review.comment!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.all(DesignTokens.spaceMd),
              child: Text(
                review.comment!,
                style: const TextStyle(
                  fontSize: 13,
                  height: DesignTokens.lineHeightRelaxed,
                  fontFamily: 'Manrope',
                  color: AppColors.textPrimary,
                ),
              ),
            )
          else
            const Padding(
              padding: EdgeInsets.all(DesignTokens.spaceMd),
              child: Text(
                'No written feedback provided.',
                style: TextStyle(
                  fontSize: 12,
                  fontStyle: FontStyle.italic,
                  fontFamily: 'Manrope',
                  color: AppColors.textSecondary,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildGradientStars(int rating) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: List.generate(5, (i) {
        final filled = i < rating;
        return Padding(
          padding: const EdgeInsets.only(right: 2),
          child: ShaderMask(
            shaderCallback: (rect) {
              return const LinearGradient(
                colors: [AppColors.warning, AppColors.warningLight],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ).createShader(rect);
            },
            child: Icon(
              filled ? Icons.star_rounded : Icons.star_outline_rounded,
              size: 18,
              color: filled ? AppColors.white : AppColors.gray300,
            ),
          ),
        );
      }),
    );
  }

  String _formatReviewDate(String iso) {
    final dt = DateTime.tryParse(iso)?.toLocal();
    if (dt == null) return '';
    return DateFormat('MMM d, yyyy').format(dt);
  }
}
