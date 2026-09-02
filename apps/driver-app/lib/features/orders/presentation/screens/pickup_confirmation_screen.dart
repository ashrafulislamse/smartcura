import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/widgets.dart';

/// Pickup confirmation screen.
///
/// The dispatch API carries no medication/items list on assignments, so this
/// screen shows a simple confirmation prompt instead of a hardcoded checklist.
/// The "Confirm Pickup" button advances the assignment to `picked_up` and
/// navigates to the navigation-to-hospital (dropoff) screen.
class PickupConfirmationScreen extends ConsumerStatefulWidget {
  final String orderId;

  const PickupConfirmationScreen({super.key, required this.orderId});

  @override
  ConsumerState<PickupConfirmationScreen> createState() =>
      _PickupConfirmationScreenState();
}

class _PickupConfirmationScreenState
    extends ConsumerState<PickupConfirmationScreen> {
  String get _assignmentId => widget.orderId;
  bool _confirmed = false;

  @override
  Widget build(BuildContext context) {
    final assignment = ref.watch(dispatchAssignmentProvider(_assignmentId));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Pickup Confirmation'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: () => context.pop(),
        ),
      ),
      body: StateView<DispatchAssignmentSummary>(
        isLoading: assignment.isLoading,
        error: assignment.error,
        data: assignment.value,
        onRetry: () => ref.invalidate(dispatchAssignmentProvider(_assignmentId)),
        builder: (data) => _body(context, data),
      ),
    );
  }

  Widget _body(BuildContext context, DispatchAssignmentSummary assignment) {
    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header banner
          PremiumCard(
            accentColor: AppColors.success,
            child: Row(
              children: [
                Container(
                  width: 48,
                  height: 48,
                  decoration: BoxDecoration(
                    color: AppColors.success.withValues(alpha: 0.12),
                    borderRadius:
                        BorderRadius.circular(DesignTokens.radiusMd),
                  ),
                  child: const Icon(Icons.store_rounded,
                      color: AppColors.success, size: 26),
                ),
                const SizedBox(width: DesignTokens.spaceSm + 2),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text(
                        'At Pickup Location',
                        style: TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w800,
                          color: AppColors.textPrimary,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        'Job ${_shortId(assignment.dispatchJobId)}',
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
          // Confirmation section
          PremiumCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Confirm Pickup',
                  style: TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                const Text(
                  'Confirm you have picked up the delivery from the pharmacy '
                  'before continuing to the dropoff location.',
                  style: TextStyle(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                    height: 1.5,
                  ),
                ),
                const SizedBox(height: DesignTokens.spaceLg),
                // Confirmation toggle
                GestureDetector(
                  onTap: () =>
                      setState(() => _confirmed = !_confirmed),
                  child: AnimatedContainer(
                    duration: DesignTokens.animDurationFast,
                    padding: const EdgeInsets.all(14),
                    decoration: BoxDecoration(
                      color: _confirmed
                          ? AppColors.success.withValues(alpha: 0.06)
                          : AppColors.gray50,
                      borderRadius:
                          BorderRadius.circular(DesignTokens.radiusMd),
                      border: Border.all(
                        color: _confirmed
                            ? AppColors.success.withValues(alpha: 0.4)
                            : AppColors.gray200,
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(
                          _confirmed
                              ? Icons.check_circle_rounded
                              : Icons.radio_button_unchecked_rounded,
                          color: _confirmed
                              ? AppColors.success
                              : AppColors.gray400,
                          size: 28,
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Text(
                            'I have picked up the delivery',
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w700,
                              color: _confirmed
                                  ? AppColors.success
                                  : AppColors.textPrimary,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: DesignTokens.spaceLg),
          // Action button
          Padding(
            padding: const EdgeInsets.symmetric(
                horizontal: DesignTokens.screenPaddingHorizontal),
            child: PrimaryButton(
              text: 'Confirm & Navigate to Dropoff',
              icon: Icons.navigation_rounded,
              isLoading: ref.watch(advanceAssignmentNotifier).loading,
              onPressed: _confirmed
                  ? () => _confirmPickup(assignment.version)
                  : null,
            ),
          ),
          const SizedBox(height: DesignTokens.spaceXxl),
        ],
      ),
    );
  }

  // ---- State transitions ---------------------------------------------------

  Future<void> _confirmPickup(int expectedVersion) async {
    final notifier = ref.read(advanceAssignmentNotifier.notifier);
    final ok = await notifier.call(
      assignmentId: _assignmentId,
      status: 'picked_up',
      expectedVersion: expectedVersion,
    );
    if (!mounted) return;
    if (ok) {
      ref.invalidate(dispatchAssignmentProvider(_assignmentId));
      context.pushReplacement('/navigation-hospital?id=$_assignmentId');
    } else {
      final err = ref.read(advanceAssignmentNotifier).error;
      _handleError(err);
    }
  }

  void _handleError(ApiError? error) {
    if (error == null) {
      AppSnackbar.error(context, 'Something went wrong');
      return;
    }
    if (error.isConflict) {
      AppSnackbar.warning(context, 'Assignment was updated. Refreshing...');
      ref.invalidate(dispatchAssignmentProvider(_assignmentId));
    } else {
      AppSnackbar.error(context, error.displayMessage);
    }
  }

  // ---- Helpers -------------------------------------------------------------

  String _shortId(String id) =>
      id.length <= 12 ? id : '${id.substring(0, 8)}\u2026';
}
