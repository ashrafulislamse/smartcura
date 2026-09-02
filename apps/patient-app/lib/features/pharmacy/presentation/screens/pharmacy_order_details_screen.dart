import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/pharmacy_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../../core/widgets/status_badge.dart';

/// Pharmacy order detail, wired to [pharmacyOrderDetailProvider].
class PharmacyOrderDetailsScreen extends ConsumerWidget {
  final String pharmacyOrderId;

  const PharmacyOrderDetailsScreen({
    super.key,
    required this.pharmacyOrderId,
  });

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final orderAsync = ref.watch(pharmacyOrderDetailProvider(pharmacyOrderId));

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Order Details'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
      ),
      body: orderAsync.when(
        loading: () => const StateView<PharmacyOrder>(
          isLoading: true,
          builder: _buildContent,
        ),
        error: (error, _) => StateView<PharmacyOrder>(
          error: error,
          onRetry: () => ref.invalidate(pharmacyOrderDetailProvider(pharmacyOrderId)),
          builder: _buildContent,
        ),
        data: (order) => StateView<PharmacyOrder>(
          isEmpty: order.pharmacyOrderId.isEmpty,
          emptyTitle: 'Order not found',
          emptyBody: 'This order may have been cancelled or does not exist.',
          emptyIcon: Icons.receipt_long_outlined,
          data: order,
          builder: _buildContent,
        ),
      ),
    );
  }

  static Widget _buildContent(PharmacyOrder order) {
    return _OrderDetailsBody(order: order);
  }
}

class _OrderDetailsBody extends StatelessWidget {
  final PharmacyOrder order;
  const _OrderDetailsBody({required this.order});

  StatusTone _tone(PharmacyOrderStatus status) {
    return switch (status) {
      PharmacyOrderStatus.dispatched ||
      PharmacyOrderStatus.delivered =>
        StatusTone.success,
      PharmacyOrderStatus.awaitingValidation ||
      PharmacyOrderStatus.fulfilling =>
        StatusTone.warning,
      PharmacyOrderStatus.deliveryException ||
      PharmacyOrderStatus.rejected ||
      PharmacyOrderStatus.cancelled =>
        StatusTone.error,
      PharmacyOrderStatus.received ||
      PharmacyOrderStatus.validated ||
      PharmacyOrderStatus.stockReserved ||
      PharmacyOrderStatus.readyForDispatch =>
        StatusTone.info,
      PharmacyOrderStatus.returned => StatusTone.neutral,
      PharmacyOrderStatus.unknown => StatusTone.neutral,
    };
  }

  String _label(PharmacyOrderStatus status) {
    return switch (status) {
      PharmacyOrderStatus.received => 'Received',
      PharmacyOrderStatus.awaitingValidation => 'Awaiting validation',
      PharmacyOrderStatus.validated => 'Validated',
      PharmacyOrderStatus.stockReserved => 'Stock reserved',
      PharmacyOrderStatus.fulfilling => 'Fulfilling',
      PharmacyOrderStatus.readyForDispatch => 'Ready for dispatch',
      PharmacyOrderStatus.dispatched => 'Dispatched',
      PharmacyOrderStatus.delivered => 'Delivered',
      PharmacyOrderStatus.deliveryException => 'Delivery exception',
      PharmacyOrderStatus.returned => 'Returned',
      PharmacyOrderStatus.rejected => 'Rejected',
      PharmacyOrderStatus.cancelled => 'Cancelled',
      PharmacyOrderStatus.unknown => 'Unknown',
    };
  }

  String _shortId(String id) => id.length > 8 ? id.substring(0, 8) : id;

  String _formatSen(int sen) {
    final ringgit = sen / 100;
    return 'RM ${ringgit.toStringAsFixed(2)}';
  }

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}/${dt.year} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return '—';
    }
  }

  @override
  Widget build(BuildContext context) {
    final totalSen = order.items.fold(0, (sum, item) => sum + item.unitPriceSen * item.quantity);

    return SingleChildScrollView(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header card
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(DesignTokens.spaceLg),
            decoration: BoxDecoration(
              color: AppColors.white,
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
              border: Border.all(color: AppColors.gray200),
              boxShadow: const [
                BoxShadow(color: AppColors.shadow, blurRadius: 8, offset: Offset(0, 2)),
              ],
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Order #${_shortId(order.pharmacyOrderId)}',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                    StatusBadge(
                      text: _label(order.status),
                      tone: _tone(order.status),
                    ),
                  ],
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                _InfoRow(
                  icon: Icons.calendar_today_outlined,
                  label: 'Created',
                  value: _formatDate(order.createdAt),
                ),
                const SizedBox(height: DesignTokens.spaceXs),
                _InfoRow(
                  icon: Icons.update,
                  label: 'Updated',
                  value: _formatDate(order.updatedAt),
                ),
                if (order.prescriptionId != null) ...[
                  const SizedBox(height: DesignTokens.spaceXs),
                  _InfoRow(
                    icon: Icons.receipt_outlined,
                    label: 'Prescription',
                    value: '#${_shortId(order.prescriptionId!)}',
                  ),
                ],
              ],
            ),
          ),

          const SizedBox(height: DesignTokens.spaceMd),

          // Items section
          Text(
            'Items',
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
          ),
          const SizedBox(height: DesignTokens.spaceSm),
          ...order.items.map((item) => _OrderItemCard(item: item)),

          const SizedBox(height: DesignTokens.spaceMd),

          // Total
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(DesignTokens.spaceLg),
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'Total',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
                Text(
                  _formatSen(totalSen),
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        color: AppColors.primary,
                      ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 120),
        ],
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: DesignTokens.iconSm, color: AppColors.textSecondary),
        const SizedBox(width: 4),
        Text(
          '$label: ',
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                color: AppColors.textSecondary,
              ),
        ),
        Text(
          value,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.textPrimary,
              ),
        ),
      ],
    );
  }
}

class _OrderItemCard extends StatelessWidget {
  final PharmacyOrderItem item;
  const _OrderItemCard({required this.item});

  String _shortId(String id) => id.length > 8 ? id.substring(0, 8) : id;

  String _formatSen(int sen) {
    final ringgit = sen / 100;
    return 'RM ${ringgit.toStringAsFixed(2)}';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: DesignTokens.spaceSm),
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
        border: Border.all(color: AppColors.gray200),
      ),
      child: Row(
        children: [
          Container(
            width: 40,
            height: 40,
            decoration: BoxDecoration(
              color: AppColors.primaryContainer,
              borderRadius: BorderRadius.circular(DesignTokens.radiusSm),
            ),
            child: const Icon(
              Icons.medication,
              color: AppColors.primary,
              size: DesignTokens.iconMd,
            ),
          ),
          const SizedBox(width: DesignTokens.spaceMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Variant ${_shortId(item.variantId)}',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
                Text(
                  'Qty: ${item.quantity} · ${_formatSen(item.unitPriceSen)} each',
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppColors.textSecondary,
                      ),
                ),
              ],
            ),
          ),
          Text(
            _formatSen(item.unitPriceSen * item.quantity),
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                  color: AppColors.textPrimary,
                ),
          ),
        ],
      ),
    );
  }
}
