import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/money.dart';
import '../../../../core/widgets/widgets.dart';

/// Trip-complete screen.
///
/// Shows a trip summary (status badge, fee, dispatch job id) and a rating
/// section. The star rating is submitted via [CreateDeliveryRatingNotifier]
/// using the `delivery_id` from [RecipientDisclosure] (which may differ from
/// the assignment id). The "Done" button navigates to the dashboard.
class TripCompleteScreen extends ConsumerStatefulWidget {
  final String orderId;

  const TripCompleteScreen({super.key, required this.orderId});

  @override
  ConsumerState<TripCompleteScreen> createState() => _TripCompleteScreenState();
}

class _TripCompleteScreenState extends ConsumerState<TripCompleteScreen>
    with SingleTickerProviderStateMixin {
  String get _assignmentId => widget.orderId;

  late final AnimationController _controller;
  late final Animation<double> _scaleAnim;
  late final Animation<double> _fadeAnim;

  int _rating = 0;
  final _commentController = TextEditingController();
  bool _ratingSubmitted = false;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
        vsync: this, duration: const Duration(milliseconds: 800));
    _scaleAnim = CurvedAnimation(parent: _controller, curve: Curves.elasticOut);
    _fadeAnim = CurvedAnimation(
        parent: _controller,
        curve: const Interval(0.3, 1.0, curve: Curves.easeOut));
    _controller.forward();
  }

  @override
  void dispose() {
    _controller.dispose();
    _commentController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final assignment = ref.watch(dispatchAssignmentProvider(_assignmentId));
    final recipient =
        ref.watch(dispatchAssignmentRecipientProvider(_assignmentId));

    return Scaffold(
      backgroundColor: AppColors.background,
      body: StateView<DispatchAssignmentSummary>(
        isLoading: assignment.isLoading,
        error: assignment.error,
        data: assignment.value,
        onRetry: () =>
            ref.invalidate(dispatchAssignmentProvider(_assignmentId)),
        builder: (data) => _body(context, data, recipient),
      ),
    );
  }

  Widget _body(
    BuildContext context,
    DispatchAssignmentSummary assignment,
    AsyncValue<RecipientDisclosure> recipient,
  ) {
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: DesignTokens.spaceLg),
        child: Column(
          children: [
            Expanded(
              child: SingleChildScrollView(
                child: Column(
                  children: [
                    const SizedBox(height: DesignTokens.spaceXl),
                    // Success animation
                    ScaleTransition(
                      scale: _scaleAnim,
                      child: Container(
                        width: 120,
                        height: 120,
                        decoration: BoxDecoration(
                          color: AppColors.success.withValues(alpha: 0.12),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.check_circle_rounded,
                            color: AppColors.success, size: 72),
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceLg),
                    FadeTransition(
                      opacity: _fadeAnim,
                      child: Column(
                        children: [
                          const Text(
                            'Delivery Complete!',
                            style: TextStyle(
                              fontSize: 28,
                              fontWeight: FontWeight.w800,
                              color: AppColors.textPrimary,
                            ),
                            textAlign: TextAlign.center,
                          ),
                          const SizedBox(height: DesignTokens.spaceSm),
                          Text(
                            'Job ${_shortId(assignment.dispatchJobId)}',
                            style: const TextStyle(
                              fontSize: 15,
                              color: AppColors.textSecondary,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceXl),
                    // Summary card
                    FadeTransition(
                      opacity: _fadeAnim,
                      child: PremiumCard(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Row(
                              children: [
                                const Text(
                                  'Trip Summary',
                                  style: TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.textPrimary,
                                  ),
                                ),
                                const Spacer(),
                                StatusBadge(
                                  text: 'Completed',
                                  tone: StatusTone.success,
                                  small: true,
                                ),
                              ],
                            ),
                            const SizedBox(height: DesignTokens.spaceMd),
                            Row(
                              children: [
                                Expanded(
                                  child: StatCard(
                                    icon: Icons.account_balance_wallet_rounded,
                                    iconColor: AppColors.primary,
                                    iconBackgroundColor: AppColors.primary
                                        .withValues(alpha: 0.1),
                                    label: 'Earnings',
                                    value: formatSen(_feeFor(assignment)),
                                    subtitle:
                                        'Job ${_shortId(assignment.dispatchJobId)}',
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(height: DesignTokens.spaceMd),
                    // Rating section
                    FadeTransition(
                      opacity: _fadeAnim,
                      child: PremiumCard(
                        child: _ratingSection(recipient),
                      ),
                    ),
                  ],
                ),
              ),
            ),
            // Buttons
            FadeTransition(
              opacity: _fadeAnim,
              child: Column(
                children: [
                  PrimaryButton(
                    text: 'Done',
                    icon: Icons.check_rounded,
                    width: double.infinity,
                    onPressed: () => context.go('/dashboard'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: DesignTokens.spaceXxl),
          ],
        ),
      ),
    );
  }

  // ---- Rating section ------------------------------------------------------

  Widget _ratingSection(AsyncValue<RecipientDisclosure> recipient) {
    if (_ratingSubmitted) {
      return Column(
        children: [
          Icon(Icons.star_rounded, color: AppColors.warning, size: 32),
          const SizedBox(height: DesignTokens.spaceSm),
          const Text(
            'Thank you for your rating!',
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
            ),
          ),
        ],
      );
    }

    final deliveryId = recipient.maybeWhen(
      data: (r) => r.deliveryId,
      orElse: () => null,
    );

    return Column(
      children: [
        const Text(
          'Rate your experience',
          style: TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w700,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: DesignTokens.spaceSm + 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: List.generate(
            5,
            (i) => GestureDetector(
              onTap: () => setState(() => _rating = i + 1),
              child: AnimatedContainer(
                duration: DesignTokens.animDurationFast,
                margin: const EdgeInsets.symmetric(horizontal: 4),
                child: Icon(
                  i < _rating ? Icons.star_rounded : Icons.star_border_rounded,
                  color: AppColors.warning,
                  size: 36,
                ),
              ),
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        // Optional comment (UI only — the current API accepts stars only)
        TextField(
          controller: _commentController,
          maxLines: 2,
          decoration: InputDecoration(
            hintText: 'Optional comment\u2026',
            filled: true,
            fillColor: AppColors.gray50,
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              borderSide: const BorderSide(color: AppColors.gray200),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              borderSide: const BorderSide(color: AppColors.gray200),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              borderSide: BorderSide(color: AppColors.primary, width: 1.5),
            ),
          ),
        ),
        const SizedBox(height: DesignTokens.spaceMd),
        // Submit rating button
        SizedBox(
          width: double.infinity,
          height: DesignTokens.buttonHeightMd,
          child: ElevatedButton(
            onPressed: (_rating > 0 && deliveryId != null)
                ? () => _submitRating(deliveryId)
                : null,
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.primary,
              disabledBackgroundColor: AppColors.primary.withValues(alpha: 0.5),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
              ),
            ),
            child: ref.watch(createDeliveryRatingNotifier).loading
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white),
                  )
                : Text(
                    deliveryId == null
                        ? 'Loading delivery info\u2026'
                        : 'Submit Rating',
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: Colors.white,
                    ),
                  ),
          ),
        ),
      ],
    );
  }

  // ---- Rating submission ---------------------------------------------------

  Future<void> _submitRating(String deliveryId) async {
    final notifier = ref.read(createDeliveryRatingNotifier.notifier);
    final ok = await notifier.call(
      deliveryId: deliveryId,
      stars: _rating,
    );
    if (!mounted) return;
    if (ok) {
      setState(() => _ratingSubmitted = true);
      AppSnackbar.success(context, 'Rating submitted');
    } else {
      final err = ref.read(createDeliveryRatingNotifier).error;
      if (err != null) {
        AppSnackbar.error(context, err.displayMessage);
      } else {
        AppSnackbar.error(context, 'Could not submit rating');
      }
    }
  }

  // ---- Helpers -------------------------------------------------------------

  int _feeFor(DispatchAssignmentSummary a) => a.feeSen;

  String _shortId(String id) =>
      id.length <= 12 ? id : '${id.substring(0, 8)}\u2026';
}
