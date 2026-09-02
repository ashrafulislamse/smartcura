import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/providers/pharmacy_provider.dart';
import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/widgets/state_view.dart';
import '../../../../core/widgets/status_badge.dart';

/// Pharmacy orders list, wired to [pharmacyOrdersProvider].
///
/// The data layer was already built but had no UI. This screen surfaces the patient's
/// own pharmacy orders with status badges and navigation to a detail screen.
class PharmacyOrdersListScreen extends ConsumerStatefulWidget {
  const PharmacyOrdersListScreen({super.key});

  @override
  ConsumerState<PharmacyOrdersListScreen> createState() =>
      _PharmacyOrdersListScreenState();
}

class _PharmacyOrdersListScreenState
    extends ConsumerState<PharmacyOrdersListScreen> {
  Future<void> _onRefresh() async {
    ref.invalidate(pharmacyOrdersProvider);
    await ref.read(pharmacyOrdersProvider.future);
  }

  @override
  Widget build(BuildContext context) {
    final ordersAsync = ref.watch(pharmacyOrdersProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Pharmacy Orders'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back),
          onPressed: () => context.pop(),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _onRefresh,
          ),
        ],
      ),
      body: ordersAsync.when(
        loading: () => StateView<List<PharmacyOrder>>(
          isLoading: true,
          builder: _buildList,
        ),
        error: (error, _) => StateView<List<PharmacyOrder>>(
          error: error,
          onRetry: _onRefresh,
          builder: _buildList,
        ),
        data: (orders) => StateView<List<PharmacyOrder>>(
          isEmpty: orders.isEmpty,
          emptyTitle: 'No pharmacy orders',
          emptyBody:
              'Your medication orders will appear here once you place one.',
          emptyIcon: Icons.local_pharmacy_outlined,
          builder: _buildList,
          data: orders,
        ),
      ),
    );
  }

  Widget _buildList(List<PharmacyOrder> orders) {
    return RefreshIndicator(
      color: AppColors.primary,
      onRefresh: _onRefresh,
      child: ListView.builder(
        physics: const AlwaysScrollableScrollPhysics(
          parent: BouncingScrollPhysics(),
        ),
        padding: const EdgeInsets.fromLTRB(
          DesignTokens.spaceMd,
          DesignTokens.spaceMd,
          DesignTokens.spaceMd,
          120,
        ),
        itemCount: orders.length,
        itemBuilder: (context, index) {
          final order = orders[index];
          return _PharmacyOrderCard(order: order);
        },
      ),
    );
  }
}

/// A single pharmacy order card with status badge and item count.
class _PharmacyOrderCard extends StatelessWidget {
  final PharmacyOrder order;
  const _PharmacyOrderCard({required this.order});

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

  String _shortId(String id) {
    return id.length > 8 ? id.substring(0, 8) : id;
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: const [
          BoxShadow(
              color: AppColors.shadow, blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
          onTap: () {
            HapticFeedback.lightImpact();
            context.push('/pharmacy-orders/${order.pharmacyOrderId}');
          },
          child: Padding(
            padding: const EdgeInsets.all(DesignTokens.spaceMd),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      'Order #${_shortId(order.pharmacyOrderId)}',
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: AppColors.textPrimary,
                          ),
                    ),
                    StatusBadge(
                      text: _label(order.status),
                      tone: _tone(order.status),
                      small: true,
                    ),
                  ],
                ),
                const SizedBox(height: DesignTokens.spaceSm),
                Row(
                  children: [
                    Icon(
                      Icons.medication_outlined,
                      size: DesignTokens.iconSm,
                      color: AppColors.textSecondary,
                    ),
                    const SizedBox(width: 4),
                    Text(
                      '${order.items.length} item${order.items.length == 1 ? '' : 's'}',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppColors.textSecondary,
                          ),
                    ),
                    const Spacer(),
                    Text(
                      _formatDate(order.createdAt),
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: AppColors.textSecondary,
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

  String _formatDate(String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${dt.day}/${dt.month}/${dt.year}';
    } catch (_) {
      return '—';
    }
  }
}
