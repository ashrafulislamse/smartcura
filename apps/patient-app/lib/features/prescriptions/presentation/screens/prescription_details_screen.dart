import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/prescription_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../../core/widgets/status_badge.dart';

/// Prescription Details Screen
///
/// Displays a single prescription from [prescriptionDetailProvider]
/// (GET /prescriptions/{id}). Shows the prescribing doctor (by membership id),
/// date, status badge, and medication items list.
class PrescriptionDetailsScreen extends ConsumerStatefulWidget {
  final String prescriptionId;

  const PrescriptionDetailsScreen({
    super.key,
    required this.prescriptionId,
  });

  @override
  ConsumerState<PrescriptionDetailsScreen> createState() =>
      _PrescriptionDetailsScreenState();
}

class _PrescriptionDetailsScreenState
    extends ConsumerState<PrescriptionDetailsScreen>
    with SingleTickerProviderStateMixin {
  late AnimationController _animationController;
  late Animation<double> _fadeAnimation;
  late Animation<Offset> _slideAnimation;
  bool _isDownloadingPdf = false;

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
    _slideAnimation = Tween<Offset>(
      begin: const Offset(0, 0.1),
      end: Offset.zero,
    ).animate(CurvedAnimation(
      parent: _animationController,
      curve: Curves.easeOut,
    ));
    _animationController.forward();
  }

  @override
  void dispose() {
    _animationController.dispose();
    super.dispose();
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
    final prescriptionAsync =
        ref.watch(prescriptionDetailProvider(widget.prescriptionId));

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
                child: prescriptionAsync.when(
                  loading: () => const Center(
                    child: CircularProgressIndicator(color: AppColors.primary),
                  ),
                  error: (error, _) => ErrorView(
                    message: _errorMessage(error),
                    onRetry: () => ref.invalidate(
                        prescriptionDetailProvider(widget.prescriptionId)),
                  ),
                  data: (prescription) {
                    return FadeTransition(
                      opacity: _fadeAnimation,
                      child: SlideTransition(
                        position: _slideAnimation,
                        child: _buildContent(prescription),
                      ),
                    );
                  },
                ),
              ),
            ],
          ),
        ),
        bottomNavigationBar: _buildBottomActions(),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      decoration: const BoxDecoration(
        color: Color(0xFFF6F6F8),
      ),
      child: Row(
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
                width: 48,
                height: 40,
                alignment: Alignment.center,
                child: const Icon(
                  Icons.arrow_back_ios_new_rounded,
                  size: 20,
                  color: AppColors.textPrimary,
                ),
              ),
            ),
          ),
          const Expanded(
            child: Text(
              'Prescription Details',
              textAlign: TextAlign.center,
              style: TextStyle(
                fontSize: 17,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
          ),
          const SizedBox(width: 48),
        ],
      ),
    );
  }

  Widget _buildContent(Prescription prescription) {
    return ListView(
      padding: const EdgeInsets.all(16),
      physics: const BouncingScrollPhysics(),
      children: [
        _buildTitleSection(prescription),
        const SizedBox(height: 20),
        _buildDoctorCard(prescription),
        const SizedBox(height: 24),
        _buildMedicationsSection(prescription),
        if (prescription.cancellationReasonCode != null) ...[
          const SizedBox(height: 24),
          _buildCancellationNotice(prescription),
        ],
        const SizedBox(height: 100),
      ],
    );
  }

  Widget _buildTitleSection(Prescription prescription) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Text(
                'Prescription ${_shortId(prescription.prescriptionId)}',
                style: const TextStyle(
                  fontSize: 24,
                  fontWeight: FontWeight.w900,
                  color: AppColors.textPrimary,
                  letterSpacing: -0.5,
                ),
              ),
            ),
            StatusBadge(
              text: prescription.status.wireValue,
              tone: _statusTone(prescription.status),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          'Signed on ${_formatDate(prescription.signedAt)}',
          style: TextStyle(
            fontSize: 14,
            color: AppColors.textSecondary,
          ),
        ),
        if (prescription.expiresAt != null) ...[
          const SizedBox(height: 2),
          Text(
            'Expires on ${_formatDate(prescription.expiresAt)}',
            style: TextStyle(
              fontSize: 14,
              color: AppColors.textSecondary,
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildDoctorCard(Prescription prescription) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.shade200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 64,
            height: 64,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              gradient: AppColors.primaryGradient,
              border: Border.all(color: Colors.white, width: 2),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.1),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
              ],
            ),
            child: const Icon(
              Icons.person,
              color: Colors.white,
              size: 28,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Prescribing Doctor',
                  style: TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Membership ID: ${_shortId(prescription.doctorMembershipId)}',
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w700,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Consultation ${_shortId(prescription.consultationId)}',
                  style: TextStyle(
                    fontSize: 14,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildMedicationsSection(Prescription prescription) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Padding(
          padding: EdgeInsets.only(left: 4, bottom: 12),
          child: Text(
            'Prescribed Medications',
            style: TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
        ),
        if (prescription.items.isEmpty)
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: Colors.grey.shade200),
            ),
            child: Text(
              'No medication details available for this prescription.',
              style: TextStyle(
                fontSize: 14,
                color: Colors.grey.shade500,
              ),
            ),
          )
        else
          ...prescription.items.asMap().entries.map((entry) {
            final index = entry.key;
            final item = entry.value;
            return Padding(
              padding: EdgeInsets.only(
                  bottom: index == prescription.items.length - 1 ? 0 : 12),
              child: _buildMedicationCard(item),
            );
          }),
      ],
    );
  }

  Widget _buildMedicationCard(String item) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey.shade200),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.1),
              borderRadius: BorderRadius.circular(12),
            ),
            child: const Icon(
              Icons.medication_rounded,
              color: AppColors.primary,
              size: 24,
            ),
          ),
          const SizedBox(width: 16),
          Expanded(
            child: Text(
              item,
              style: const TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildCancellationNotice(Prescription prescription) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.errorContainer,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: AppColors.errorLight),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            Icons.cancel_outlined,
            color: AppColors.errorDark,
            size: 24,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Cancelled',
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.errorDark,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Reason: ${prescription.cancellationReasonCode}',
                  style: TextStyle(
                    fontSize: 13,
                    color: AppColors.errorDark,
                    height: 1.4,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _downloadPdf() async {
    if (_isDownloadingPdf) return;
    setState(() => _isDownloadingPdf = true);
    try {
      final data = await ref
          .read(prescriptionPdfUrlProvider(widget.prescriptionId).future);
      final url = data['download_url'] as String?;
      if (url == null || url.isEmpty) {
        throw Exception('PDF download URL not available');
      }
      final uri = Uri.parse(url);
      if (!await canLaunchUrl(uri)) {
        throw Exception('No app can open this PDF');
      }
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } on DioException catch (e) {
      final apiError = e.error is ApiError
          ? e.error as ApiError
          : ApiError.network(e.message ?? 'Download failed');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(apiError.userMessage),
            backgroundColor: AppColors.error,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString()),
            backgroundColor: AppColors.error,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isDownloadingPdf = false);
    }
  }

  Widget _buildBottomActions() {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border(
          top: BorderSide(color: Colors.grey.shade200),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.05),
            blurRadius: 10,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Row(
          children: [
            Expanded(
              child: GestureDetector(
                onTap: _isDownloadingPdf ? null : _downloadPdf,
                child: Container(
                  height: 48,
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: AppColors.primary),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _isDownloadingPdf
                          ? SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: AppColors.primary,
                              ),
                            )
                          : const Icon(
                              Icons.download_rounded,
                              color: AppColors.primary,
                              size: 18,
                            ),
                      const SizedBox(width: 6),
                      Flexible(
                        child: Text(
                          _isDownloadingPdf ? 'Opening PDF…' : 'Download PDF',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w700,
                            color: AppColors.primary,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: GestureDetector(
                onTap: () {
                  HapticFeedback.mediumImpact();
                  // No pharmacy ordering endpoint exists yet (see AGENTS.md).
                  // Inform the user instead of navigating to a non-existent route.
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Pharmacy ordering will be available soon. '
                          'Please contact your doctor to request a refill.'),
                    ),
                  );
                },
                child: Container(
                  height: 48,
                  decoration: BoxDecoration(
                    color: AppColors.primary,
                    borderRadius: BorderRadius.circular(12),
                    boxShadow: [
                      BoxShadow(
                        color: AppColors.primary.withOpacity(0.3),
                        blurRadius: 8,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  child: const Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.local_pharmacy_rounded,
                        color: Colors.white,
                        size: 20,
                      ),
                      SizedBox(width: 8),
                      Text(
                        'Request Refill',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: Colors.white,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ],
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
