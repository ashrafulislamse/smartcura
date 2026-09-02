import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_error.dart';
import '../../../../core/providers/providers.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/money.dart';
import '../../../../core/widgets/widgets.dart';

/// Order / dispatch-assignment details screen.
///
/// Watches [dispatchAssignmentProvider] for the assignment state and
/// [dispatchAssignmentRecipientProvider] for the recipient disclosure. The
/// recipient data is only available after the driver has accepted the offer;
/// until then it is gracefully hidden.
///
/// Action buttons advance the assignment through its status progression using
/// [AdvanceAssignmentNotifier]. A cancel dialog lets the driver cancel with a
/// reason code.
class OrderDetailsScreen extends ConsumerStatefulWidget {
  final String orderId;

  const OrderDetailsScreen({super.key, required this.orderId});

  @override
  ConsumerState<OrderDetailsScreen> createState() => _OrderDetailsScreenState();
}

class _OrderDetailsScreenState extends ConsumerState<OrderDetailsScreen> {
  String get _assignmentId => widget.orderId;

  // Wire values for cancellation reason codes sent to the API.
  static const _cancelReasons = <_CancelReason>[
    _CancelReason('driver_unavailable', 'Driver unavailable'),
    _CancelReason('vehicle_breakdown', 'Vehicle breakdown'),
    _CancelReason('emergency', 'Emergency'),
    _CancelReason('other', 'Other'),
  ];

  @override
  Widget build(BuildContext context) {
    final assignment = ref.watch(dispatchAssignmentProvider(_assignmentId));
    final recipient =
        ref.watch(dispatchAssignmentRecipientProvider(_assignmentId));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Assignment Details'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_ios_new_rounded, size: 20),
          onPressed: () => context.pop(),
        ),
      ),
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
    final status = assignment.status;
    final canCancel = _isCancellable(status);

    return SingleChildScrollView(
      padding: const EdgeInsets.symmetric(vertical: DesignTokens.spaceSm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _statusCard(context, assignment),
          _recipientSection(context, recipient),
          _jobInfoCard(context, assignment),
          if (_isTerminal(status)) ...[
            const SizedBox(height: DesignTokens.spaceXxl),
          ] else ...[
            const SizedBox(height: DesignTokens.spaceLg),
            _actionButton(context, assignment),
          ],
          if (canCancel) ...[
            const SizedBox(height: DesignTokens.spaceSm + 4),
            _cancelButton(context, assignment),
          ],
          const SizedBox(height: DesignTokens.spaceXxl),
        ],
      ),
    );
  }

  // ---- Status banner -------------------------------------------------------

  Widget _statusCard(BuildContext context, DispatchAssignmentSummary a) {
    return PremiumCard(
      accentColor: _statusColor(a.status),
      child: Row(
        children: [
          Container(
            width: 48,
            height: 48,
            decoration: BoxDecoration(
              color: AppColors.primary.withValues(alpha: 0.1),
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
            child: const Icon(Icons.local_shipping_rounded,
                color: AppColors.primary, size: 26),
          ),
          const SizedBox(width: DesignTokens.spaceSm + 2),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _statusLabel(a.status),
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.textPrimary,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  'Job ${_shortId(a.dispatchJobId)}',
                  style: const TextStyle(
                    fontSize: 13,
                    color: AppColors.textSecondary,
                  ),
                ),
              ],
            ),
          ),
          StatusBadge(
            text: _statusLabel(a.status),
            tone: _statusToneFor(a.status),
            small: true,
          ),
        ],
      ),
    );
  }

  // ---- Recipient disclosure (privacy-gated) --------------------------------

  Widget _recipientSection(
      BuildContext context, AsyncValue<RecipientDisclosure> recipient) {
    return PremiumCard(
      child: StateView<RecipientDisclosure>(
        isLoading: recipient.isLoading,
        error: recipient.error,
        isEmpty: !recipient.hasValue,
        data: recipient.value,
        emptyTitle: 'Recipient details locked',
        emptyBody:
            'Recipient information will be available once the assignment is '
            'active.',
        emptyIcon: Icons.lock_outline,
        onRetry: () =>
            ref.invalidate(dispatchAssignmentRecipientProvider(_assignmentId)),
        builder: (r) => _recipientContent(r),
      ),
    );
  }

  Widget _recipientContent(RecipientDisclosure r) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Icon(Icons.person_rounded,
                size: 18, color: AppColors.primary),
            const SizedBox(width: DesignTokens.spaceSm),
            const Text(
              'Recipient Details',
              style: TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w700,
                color: AppColors.textPrimary,
              ),
            ),
          ],
        ),
        const SizedBox(height: DesignTokens.spaceSm + 4),
        _InfoRow(label: 'Name', value: r.recipientName),
        _InfoRow(label: 'Phone', value: r.recipientPhoneE164),
        _InfoRow(
          label: 'Address',
          value: _formatAddress(r),
        ),
      ],
    );
  }

  // ---- Dispatch job info ---------------------------------------------------

  Widget _jobInfoCard(BuildContext context, DispatchAssignmentSummary a) {
    return PremiumCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.receipt_rounded,
                  size: 18, color: AppColors.primary),
              const SizedBox(width: DesignTokens.spaceSm),
              const Text(
                'Assignment Info',
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceSm + 4),
          _InfoRow(label: 'Assignment ID', value: _shortId(a.assignmentId)),
          _InfoRow(label: 'Dispatch Job', value: _shortId(a.dispatchJobId)),
          _InfoRow(label: 'Version', value: a.version.toString()),
          _InfoRow(label: 'Fee', value: formatSen(a.feeSen)),
        ],
      ),
    );
  }

  // ---- Cancel button -------------------------------------------------------

  Widget _cancelButton(BuildContext context, DispatchAssignmentSummary a) {
    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.screenPaddingHorizontal),
      child: SizedBox(
        width: double.infinity,
        height: DesignTokens.buttonHeightMd,
        child: OutlinedButton.icon(
          onPressed: () => _showCancelDialog(context, a),
          icon: const Icon(Icons.cancel_rounded, size: 18),
          label: const Text(
            'Cancel Assignment',
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
          ),
          style: OutlinedButton.styleFrom(
            foregroundColor: AppColors.emergency,
            side: const BorderSide(color: AppColors.emergency),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
            ),
          ),
        ),
      ),
    );
  }

  // ---- Primary action button -----------------------------------------------

  Widget _actionButton(BuildContext context, DispatchAssignmentSummary a) {
    final action = _nextAction(a.status);
    if (action == null) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.symmetric(
          horizontal: DesignTokens.screenPaddingHorizontal),
      child: PrimaryButton(
        text: action.label,
        icon: action.icon,
        isLoading: ref.watch(advanceAssignmentNotifier).loading,
        onPressed: () => _advanceAndNavigate(a, action),
      ),
    );
  }

  Future<void> _advanceAndNavigate(
      DispatchAssignmentSummary a, _StatusAction action) async {
    // When the user is already at the drop-off location, the proof-of-delivery
    // screen handles the final status transition. Just navigate there without
    // advancing the assignment first, otherwise the delivery-confirm screen would
    // try to complete an already-completed assignment.
    if (action.navigateOnly) {
      context.push('${action.route}?id=$_assignmentId');
      return;
    }
    final notifier = ref.read(advanceAssignmentNotifier.notifier);
    final ok = await notifier.call(
      assignmentId: _assignmentId,
      status: action.nextStatus,
      expectedVersion: a.version,
    );
    if (!mounted) return;
    if (ok) {
      ref.invalidate(dispatchAssignmentProvider(_assignmentId));
      context.pushReplacement('${action.route}?id=$_assignmentId');
    } else {
      final err = ref.read(advanceAssignmentNotifier).error;
      _handleError(err);
    }
  }

  _StatusAction? _nextAction(DispatchAssignmentStatus status) {
    return switch (status) {
      DispatchAssignmentStatus.assigned => const _StatusAction(
          'Start Navigation to Pickup',
          'en_route_pickup',
          '/navigation-pickup',
          Icons.navigation_rounded),
      DispatchAssignmentStatus.enRoutePickup => const _StatusAction(
          'I Have Arrived at Pickup',
          'arrived_pickup',
          '/pickup-confirm',
          Icons.store_rounded),
      DispatchAssignmentStatus.arrivedPickup => const _StatusAction(
          'Confirm Pickup',
          'picked_up',
          '/navigation-hospital',
          Icons.check_circle_rounded),
      DispatchAssignmentStatus.pickedUp => const _StatusAction(
          'Start Navigation to Dropoff',
          'en_route_dropoff',
          '/navigation-hospital',
          Icons.navigation_rounded),
      DispatchAssignmentStatus.enRouteDropoff => const _StatusAction(
          'I Have Arrived at Dropoff',
          'arrived_dropoff',
          '/delivery-confirm',
          Icons.home_rounded),
      DispatchAssignmentStatus.arrivedDropoff => const _StatusAction(
          'Confirm Delivery',
          'completed',
          '/delivery-confirm',
          Icons.check_circle_rounded,
          navigateOnly: true),
      _ => null,
    };
  }

  void _showCancelDialog(BuildContext context, DispatchAssignmentSummary a) {
    String? selectedReason;

    showDialog<void>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (ctx, setDialogState) => AlertDialog(
          title: const Text('Cancel Assignment?',
              style: TextStyle(fontWeight: FontWeight.w800)),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Select a reason for cancellation:',
                style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
              ),
              const SizedBox(height: DesignTokens.spaceSm + 4),
              ..._cancelReasons.map((r) => RadioListTile<String>(
                    value: r.code,
                    groupValue: selectedReason,
                    title: Text(r.label),
                    dense: true,
                    contentPadding: EdgeInsets.zero,
                    onChanged: (v) => setDialogState(() => selectedReason = v),
                  )),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(dialogContext),
              child: const Text('Keep Assignment'),
            ),
            FilledButton(
              onPressed: selectedReason == null
                  ? null
                  : () {
                      Navigator.pop(dialogContext);
                      _doCancel(a, selectedReason!);
                    },
              style:
                  FilledButton.styleFrom(backgroundColor: AppColors.emergency),
              child: const Text('Cancel Assignment',
                  style: TextStyle(color: Colors.white)),
            ),
          ],
        ),
      ),
    );
  }

  // ---- State transitions ---------------------------------------------------

  Future<void> _doCancel(DispatchAssignmentSummary a, String reasonCode) async {
    final notifier = ref.read(advanceAssignmentNotifier.notifier);
    final ok = await notifier.call(
      assignmentId: _assignmentId,
      status: 'cancelled',
      reasonCode: reasonCode,
      expectedVersion: a.version,
    );
    if (!mounted) return;
    if (ok) {
      ref.invalidate(dispatchAssignmentProvider(_assignmentId));
      AppSnackbar.success(context, 'Assignment cancelled');
      context.go('/orders');
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
      AppSnackbar.warning(
          context, 'This assignment was updated. Refreshing...');
      ref.invalidate(dispatchAssignmentProvider(_assignmentId));
    } else {
      AppSnackbar.error(context, error.displayMessage);
    }
  }

  // ---- Helpers -------------------------------------------------------------

  bool _isCancellable(DispatchAssignmentStatus status) =>
      status != DispatchAssignmentStatus.completed &&
      status != DispatchAssignmentStatus.cancelled &&
      status != DispatchAssignmentStatus.failed &&
      status != DispatchAssignmentStatus.arrivedDropoff;

  bool _isTerminal(DispatchAssignmentStatus status) =>
      status == DispatchAssignmentStatus.completed ||
      status == DispatchAssignmentStatus.cancelled ||
      status == DispatchAssignmentStatus.failed;

  String _statusLabel(DispatchAssignmentStatus s) => switch (s) {
        DispatchAssignmentStatus.assigned => 'Assigned',
        DispatchAssignmentStatus.enRoutePickup => 'En Route to Pickup',
        DispatchAssignmentStatus.arrivedPickup => 'Arrived at Pickup',
        DispatchAssignmentStatus.pickedUp => 'Picked Up',
        DispatchAssignmentStatus.enRouteDropoff => 'En Route to Dropoff',
        DispatchAssignmentStatus.arrivedDropoff => 'Arrived at Dropoff',
        DispatchAssignmentStatus.completed => 'Completed',
        DispatchAssignmentStatus.cancelled => 'Cancelled',
        DispatchAssignmentStatus.failed => 'Failed',
        _ => 'Unknown',
      };

  String _shortId(String id) =>
      id.length <= 12 ? id : '${id.substring(0, 8)}\u2026';

  String _formatAddress(RecipientDisclosure r) {
    final parts = <String>[
      r.addressLine1,
      if (r.addressLine2 != null && r.addressLine2!.isNotEmpty) r.addressLine2!,
      '${r.postcode} ${r.city}',
      r.stateCode,
    ].where((s) => s.isNotEmpty).join(', ');
    return parts;
  }

  StatusTone _statusToneFor(DispatchAssignmentStatus s) => switch (s) {
        DispatchAssignmentStatus.completed => StatusTone.success,
        DispatchAssignmentStatus.cancelled ||
        DispatchAssignmentStatus.failed =>
          StatusTone.error,
        DispatchAssignmentStatus.arrivedPickup ||
        DispatchAssignmentStatus.pickedUp =>
          StatusTone.warning,
        _ => StatusTone.info,
      };

  Color _statusColor(DispatchAssignmentStatus s) => switch (_statusToneFor(s)) {
        StatusTone.success => AppColors.success,
        StatusTone.warning => AppColors.warning,
        StatusTone.error => AppColors.error,
        StatusTone.info => AppColors.info,
        StatusTone.neutral => AppColors.gray400,
      };
}

// ---- Private widgets ------------------------------------------------------

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;

  const _InfoRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style:
                  const TextStyle(fontSize: 13, color: AppColors.textSecondary),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _CancelReason {
  final String code;
  final String label;
  const _CancelReason(this.code, this.label);
}

class _StatusAction {
  final String label;
  final String nextStatus;
  final String route;
  final IconData icon;
  final bool navigateOnly;
  const _StatusAction(
    this.label,
    this.nextStatus,
    this.route,
    this.icon, {
    this.navigateOnly = false,
  });
}
