import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/theme/app_colors.dart';
import '../../../../core/theme/design_tokens.dart';
import '../../../../core/utils/money.dart';
import '../../../../core/widgets/widgets.dart';
import '../../../../core/providers/providers.dart';
import '../../../../core/network/api_error.dart';

/// Available dispatch offers — the second tab (premium redesign v2).
///
/// Section order:
///  1. Header — title + live count
///  2. Filter chips — All / Nearest / Highest Fee / Expiring Soon
///  3. Offer cards — clean white cards, no accent stripe
///
/// Data comes from [dispatchOffersProvider] (`GET /dispatch/offers`). The offer
/// summary is minimum-necessary by construction: it carries fee, approximate
/// distance, currency and expiry only. Recipient name, phone, address and
/// medication contents are deliberately absent (see the OpenAPI description on
/// `DispatchOfferSummary`), so this screen renders none of them — and never
/// fabricates them.
///
/// Filter chips are cosmetic, client-side sorts over the already-fetched list
/// (distance, fee, expiry). There is no priority field on the offer, so the
/// accent stripe uses a neutral brand colour rather than an invented
/// emergency/high/normal tint.
class AvailableOrdersScreen extends ConsumerStatefulWidget {
  const AvailableOrdersScreen({super.key});

  @override
  ConsumerState<AvailableOrdersScreen> createState() =>
      _AvailableOrdersScreenState();
}

class _AvailableOrdersScreenState extends ConsumerState<AvailableOrdersScreen> {
  // Cosmetic client-side sort options. Each maps to a comparator below.
  static const _filterOptions = <String>[
    'All',
    'Nearest',
    'Highest Fee',
    'Expiring Soon'
  ];
  String _filter = 'All';
  String? _acceptingId;

  Future<void> _refresh() async {
    ref.invalidate(dispatchOffersProvider);
    // Allow the refresh indicator to stay visible until the new fetch resolves.
    await ref.read(dispatchOffersProvider.future);
  }

  List<DispatchOfferSummary> _applyFilter(List<DispatchOfferSummary> items) {
    final sorted = [...items];
    switch (_filter) {
      case 'Nearest':
        sorted.sort((a, b) {
          // Null distances sort last.
          final da = a.approxDistanceMetres;
          final db = b.approxDistanceMetres;
          if (da == null && db == null) return 0;
          if (da == null) return 1;
          if (db == null) return -1;
          return da.compareTo(db);
        });
        break;
      case 'Highest Fee':
        sorted.sort((a, b) => b.feeSen.compareTo(a.feeSen));
        break;
      case 'Expiring Soon':
        sorted.sort((a, b) => a.expiresAt.compareTo(b.expiresAt));
        break;
      case 'All':
      default:
        // Preserve server ordering (relevance, not recency — see conventions).
        break;
    }
    return sorted;
  }

  Future<void> _accept(DispatchOfferSummary offer) async {
    setState(() => _acceptingId = offer.offerId);
    final notifier = ref.read(acceptOfferNotifier.notifier);
    final ok = await notifier.call(
      offerId: offer.offerId,
      vehicleId: null,
      expectedVersion: offer.version,
    );
    if (!mounted) return;
    setState(() => _acceptingId = null);
    final state = ref.read(acceptOfferNotifier);
    if (ok && state.value != null) {
      AppSnackbar.success(context, 'Offer accepted');
      ref.invalidate(dispatchOffersProvider);
      context.push('/order-details?id=${state.value!.assignmentId}');
    } else {
      AppSnackbar.error(context, _acceptErrorMessage(state.error));
    }
  }

  String _acceptErrorMessage(ApiError? e) {
    if (e == null) return 'Could not accept this offer. Please try again.';
    // Map HTTP semantics to friendly text. Offer-specific codes
    // (offer_expired / offer_taken / driver_busy) are not yet modelled in
    // ProblemCode, so the backend's own message is the fallback.
    if (e.isNotFound) return 'This offer is no longer available.';
    if (e.isConflict) return 'This offer was just taken or has expired.';
    if (e.isForbidden) return 'You cannot accept offers right now.';
    return e.displayMessage;
  }

  @override
  Widget build(BuildContext context) {
    final offers = ref.watch(dispatchOffersProvider);
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: const SystemUiOverlayStyle(
        statusBarColor: Colors.transparent,
        statusBarIconBrightness: Brightness.dark,
        statusBarBrightness: Brightness.light,
        systemNavigationBarColor: Colors.transparent,
        systemNavigationBarIconBrightness: Brightness.dark,
      ),
      child: Scaffold(
        backgroundColor: AppColors.background,
        body: SafeArea(
          bottom: false,
          child: RefreshIndicator(
            onRefresh: _refresh,
            color: AppColors.primary,
            child: offers.when(
              loading: () => _scrollableFill(const _LoadingState()),
              error: (e, _) => _scrollableFill(ErrorView(
                message: _message(e),
                onRetry: _retryable(e) ? _refresh : null,
              )),
              data: (list) {
                final items = _applyFilter(list.data);
                if (items.isEmpty) {
                  return _scrollableFill(const EmptyView(
                    title: 'No offers available',
                    body:
                        'New dispatch offers will appear here when one is open to you.',
                    icon: Icons.inbox_outlined,
                    illustrationAsset: 'assets/illustrations/empty_offers.svg',
                  ));
                }
                return CustomScrollView(
                  physics: const AlwaysScrollableScrollPhysics(
                    parent: BouncingScrollPhysics(),
                  ),
                  slivers: [
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(
                          DesignTokens.spaceMd,
                          DesignTokens.spaceSm,
                          DesignTokens.spaceMd,
                          DesignTokens.spaceSm,
                        ),
                        child: _header(list.data.length, items.length),
                      ),
                    ),
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.symmetric(
                          horizontal: DesignTokens.spaceMd,
                        ),
                        child: _FilterChipsRow(
                          options: _filterOptions,
                          selected: _filter,
                          onSelected: (v) =>
                              setState(() => _filter = v ?? 'All'),
                        ),
                      ),
                    ),
                    const SliverToBoxAdapter(
                      child: SizedBox(height: DesignTokens.spaceSm),
                    ),
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(
                        DesignTokens.spaceMd,
                        0,
                        DesignTokens.spaceMd,
                        0,
                      ),
                      sliver: SliverList(
                        delegate: SliverChildBuilderDelegate(
                          (ctx, i) => Padding(
                            padding: EdgeInsets.only(
                              bottom: i < items.length - 1
                                  ? DesignTokens.spaceSm
                                  : 0,
                            ),
                            child: _OfferCard(
                              offer: items[i],
                              accepting: _acceptingId == items[i].offerId,
                              onAccept: () => _accept(items[i]),
                            ),
                          ),
                          childCount: items.length,
                        ),
                      ),
                    ),
                    const SliverToBoxAdapter(
                      child: SizedBox(height: 120),
                    ),
                  ],
                );
              },
            ),
          ),
        ),
      ),
    );
  }

  Widget _header(int total, int filtered) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const Expanded(
              child: Text(
                'Available Orders',
                style: TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                  color: AppColors.textPrimary,
                  letterSpacing: -0.5,
                  height: 1.1,
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.primaryContainer,
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
              ),
              child: Text(
                '$total open',
                style: const TextStyle(
                  fontSize: 11,
                  fontWeight: FontWeight.w800,
                  color: AppColors.primary,
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 4),
        Text(
          _filter == 'All'
              ? 'Showing every offer addressed to you.'
              : 'Filtered by $_filter.',
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w500,
            color: AppColors.textSecondary,
          ),
        ),
      ],
    );
  }

  // RefreshIndicator needs an always-scrollable child even for non-list states.
  Widget _scrollableFill(Widget child) => SingleChildScrollView(
        physics: const AlwaysScrollableScrollPhysics(),
        child: SizedBox(
          height: MediaQuery.of(context).size.height * 0.75,
          child: child,
        ),
      );
}

class _LoadingState extends StatelessWidget {
  const _LoadingState();
  @override
  Widget build(BuildContext context) => const Center(
        child: Padding(
          padding: EdgeInsets.all(DesignTokens.spaceXl),
          child: CircularProgressIndicator(color: AppColors.primary),
        ),
      );
}

class _FilterChipsRow extends StatelessWidget {
  final List<String> options;
  final String selected;
  final ValueChanged<String?> onSelected;

  const _FilterChipsRow({
    required this.options,
    required this.selected,
    required this.onSelected,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 36,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        physics: const BouncingScrollPhysics(),
        itemBuilder: (ctx, i) {
          final opt = options[i];
          final isSelected = opt == selected;
          return GestureDetector(
            onTap: () {
              HapticFeedback.selectionClick();
              onSelected(opt);
            },
            child: AnimatedContainer(
              duration: const Duration(milliseconds: 180),
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
              decoration: BoxDecoration(
                color: isSelected ? AppColors.primary : AppColors.white,
                borderRadius: BorderRadius.circular(DesignTokens.radiusFull),
                border: Border.all(
                  color: isSelected ? AppColors.primary : AppColors.gray200,
                ),
                boxShadow: isSelected
                    ? [
                        BoxShadow(
                          color: AppColors.primary.withValues(alpha: 0.20),
                          blurRadius: 8,
                          offset: const Offset(0, 3),
                        ),
                      ]
                    : null,
              ),
              alignment: Alignment.center,
              child: Text(
                opt,
                style: TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                  color: isSelected ? AppColors.white : AppColors.textSecondary,
                ),
              ),
            ),
          );
        },
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemCount: options.length,
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Offer card
// ---------------------------------------------------------------------------

class _OfferCard extends StatefulWidget {
  final DispatchOfferSummary offer;
  final bool accepting;
  final VoidCallback onAccept;

  const _OfferCard({
    required this.offer,
    required this.accepting,
    required this.onAccept,
  });

  @override
  State<_OfferCard> createState() => _OfferCardState();
}

class _OfferCardState extends State<_OfferCard> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    // Tick once per second so the expiry countdown stays live.
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final offer = widget.offer;
    final remaining = _remaining(offer.expiresAt);
    final expired = remaining != null && remaining <= Duration.zero;
    final expiringSoon =
        remaining != null && remaining.inMinutes < 1 && !expired;

    return Container(
      padding: const EdgeInsets.all(DesignTokens.spaceMd),
      decoration: BoxDecoration(
        color: AppColors.white,
        borderRadius: BorderRadius.circular(DesignTokens.radiusLg),
        border: Border.all(color: AppColors.gray200),
        boxShadow: [
          BoxShadow(
            color: AppColors.black.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header row
          Row(
            children: [
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: AppColors.primaryContainer,
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
                child: const Icon(
                  Icons.local_shipping_rounded,
                  color: AppColors.primary,
                  size: 22,
                ),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text(
                      'Pharmacy Delivery',
                      style: TextStyle(
                        fontSize: 11,
                        color: AppColors.textSecondary,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 0.2,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'Job ${_shortId(offer.dispatchJobId)}',
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w800,
                        color: AppColors.textPrimary,
                      ),
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    formatSen(offer.feeSen),
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      color: AppColors.textPrimary,
                      letterSpacing: -0.3,
                      height: 1.0,
                    ),
                  ),
                  const SizedBox(height: 2),
                  const Text(
                    'Earnings',
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w600,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          // Distance + expiry chips
          Row(
            children: [
              _MetaItem(
                icon: Icons.straighten_rounded,
                label: _distanceLabel(offer.approxDistanceMetres),
              ),
              const SizedBox(width: DesignTokens.spaceMd),
              _MetaItem(
                icon: Icons.access_time_rounded,
                label: _expiryLabel(remaining, expired),
                tone: expired
                    ? AppColors.error
                    : (expiringSoon
                        ? AppColors.warning
                        : AppColors.textPrimary),
              ),
            ],
          ),
          const SizedBox(height: DesignTokens.spaceMd),
          // Accept button
          SizedBox(
            width: double.infinity,
            height: 48,
            child: ElevatedButton(
              onPressed: widget.accepting || expired ? null : widget.onAccept,
              style: ElevatedButton.styleFrom(
                backgroundColor: AppColors.primary,
                disabledBackgroundColor: AppColors.gray200,
                foregroundColor: AppColors.white,
                elevation: 0,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(DesignTokens.radiusMd),
                ),
              ),
              child: widget.accepting
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(
                          color: AppColors.white, strokeWidth: 2),
                    )
                  : Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.center,
                      children: [
                        Text(
                          expired ? 'Expired' : 'Accept Offer',
                          style: const TextStyle(
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            height: 1.2,
                          ),
                        ),
                        if (!expired) ...[
                          const SizedBox(width: 6),
                          const Icon(Icons.arrow_forward_rounded, size: 16),
                        ],
                      ],
                    ),
            ),
          ),
        ],
      ),
    );
  }

  Duration? _remaining(String expiresAt) {
    try {
      final exp = DateTime.parse(expiresAt);
      return exp.difference(DateTime.now());
    } catch (_) {
      return null;
    }
  }

  String _expiryLabel(Duration? remaining, bool expired) {
    if (remaining == null) return 'Expiry n/a';
    if (expired) return 'Expired';
    final m = remaining.inMinutes;
    final s = remaining.inSeconds % 60;
    if (m <= 0) return '${s}s left';
    return '${m}m ${s}s left';
  }

  String _distanceLabel(int? metres) {
    if (metres == null) return '—';
    if (metres < 1000) return '$metres m';
    return '${(metres / 1000).toStringAsFixed(1)} km';
  }
}

class _MetaItem extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color tone;

  const _MetaItem({
    required this.icon,
    required this.label,
    this.tone = AppColors.textPrimary,
  });

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 16, color: AppColors.textSecondary),
        const SizedBox(width: 4),
        Text(
          label,
          style: TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w700,
            color: tone,
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

String _shortId(String id) => id.length <= 8 ? id : id.substring(0, 8);

String _message(Object? error) {
  if (error == null) return 'Something went wrong';
  try {
    final m = (error as dynamic).displayMessage;
    if (m is String && m.isNotEmpty) return m;
  } catch (_) {}
  return error.toString();
}

bool _retryable(Object? error) {
  if (error == null) return false;
  try {
    final f = (error as dynamic).isForbidden;
    if (f is bool && f) return false;
  } catch (_) {}
  return true;
}
