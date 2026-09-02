import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// Ratings received by the acting driver (`GET /drivers/me/ratings`).
/// Carries average stars, total count, and a paginated list of individual
/// [DeliveryRating] entries.
final driverRatingsProvider = FutureProvider<DriverRatingList>((ref) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.driversMeRatings);
    return decodeDriverRatingList(body);
  });
});

/// Outcome of a create-rating mutation.
class CreateDeliveryRatingState {
  const CreateDeliveryRatingState({this.value, this.error, this.loading = false});
  final DeliveryRating? value;
  final ApiError? error;
  final bool loading;
}

/// Rate a completed delivery (`POST /deliveries/{delivery_id}/rating`).
/// A delivery can be rated once; the body carries only `stars` (1-5).
class CreateDeliveryRatingNotifier
    extends StateNotifier<CreateDeliveryRatingState> {
  CreateDeliveryRatingNotifier(this._api)
      : super(const CreateDeliveryRatingState());
  final ApiClient _api;

  Future<bool> call({
    required String deliveryId,
    required int stars,
  }) async {
    state = const CreateDeliveryRatingState(loading: true);
    try {
      final body = await _api.post(
        ApiEndpoints.deliveryRating(deliveryId),
        body: <String, dynamic>{
          'stars': stars,
        },
      );
      state = CreateDeliveryRatingState(value: decodeDeliveryRating(body));
      return true;
    } catch (e) {
      state = CreateDeliveryRatingState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const CreateDeliveryRatingState();
}

final createDeliveryRatingNotifier = StateNotifierProvider.autoDispose<
    CreateDeliveryRatingNotifier, CreateDeliveryRatingState>(
    (ref) => CreateDeliveryRatingNotifier(ref.watch(apiClientProvider)));
