import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';

// No direct mock replacement — pharmacy was previously UI-only.
//
// Screens that must be updated in Phase 2:
//   - (Future pharmacy screens — none currently import mock data for pharmacy)

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

class MedicationMapper {
  static Medication fromJson(Map<String, dynamic> j) => Medication(
        medicationId: j['medication_id'] as String,
        genericName: j['generic_name'] as String,
        atcCode: j['atc_code'] as String?,
        controlledSchedule:
            controlledSubstanceScheduleFromWire(j['controlled_schedule'] as String),
        controlledSubstance: j['controlled_substance'] as bool? ?? false,
        requiresPrescription: j['requires_prescription'] as bool? ?? false,
        retired: j['retired'] as bool? ?? false,
        version: (j['version'] as num).toInt(),
        createdAt: j['created_at'] as String,
        updatedAt: j['updated_at'] as String,
      );
}

class PharmacyOrderItemMapper {
  static PharmacyOrderItem fromJson(Map<String, dynamic> j) => PharmacyOrderItem(
        orderItemId: j['order_item_id'] as String,
        variantId: j['variant_id'] as String,
        position: (j['position'] as num).toInt(),
        quantity: (j['quantity'] as num).toInt(),
        unitPriceSen: (j['unit_price_sen'] as num).toInt(),
        currency: j['currency'] as String,
      );
}

class PharmacyOrderMapper {
  static PharmacyOrder fromJson(Map<String, dynamic> j) => PharmacyOrder(
        pharmacyOrderId: j['pharmacy_order_id'] as String,
        siteId: j['site_id'] as String,
        patientProfileId: j['patient_profile_id'] as String,
        prescriptionId: j['prescription_id'] as String?,
        status: pharmacyOrderStatusFromWire(j['status'] as String),
        version: (j['version'] as num).toInt(),
        createdAt: j['created_at'] as String,
        updatedAt: j['updated_at'] as String,
        items: (j['items'] as List<dynamic>)
            .whereType<Map<String, dynamic>>()
            .map(PharmacyOrderItemMapper.fromJson)
            .toList(),
      );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// Search medications (public catalog).
/// Backend: GET /medications
final medicationsProvider =
    FutureProvider<List<Medication>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.medications);
  final data = response.data;
  if (data is List) {
    return data
        .whereType<Map<String, dynamic>>()
        .map(MedicationMapper.fromJson)
        .toList();
  }
  final list = (data as Map<String, dynamic>)['data'] as List<dynamic>;
  return list
      .whereType<Map<String, dynamic>>()
      .map(MedicationMapper.fromJson)
      .toList();
});

/// Pharmacy orders for the current patient.
/// Backend: GET /pharmacy-orders
final pharmacyOrdersProvider =
    FutureProvider<List<PharmacyOrder>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.pharmacyOrders);
  final data = response.data;
  if (data is List) {
    return data
        .whereType<Map<String, dynamic>>()
        .map(PharmacyOrderMapper.fromJson)
        .toList();
  }
  final list = (data as Map<String, dynamic>)['data'] as List<dynamic>;
  return list
      .whereType<Map<String, dynamic>>()
      .map(PharmacyOrderMapper.fromJson)
      .toList();
});

/// A single pharmacy order by id.
/// Backend: GET /pharmacy-orders/{id}
final pharmacyOrderDetailProvider =
    FutureProvider.family<PharmacyOrder, String>((ref, id) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.pharmacyOrder(id));
  return PharmacyOrderMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Create a pharmacy order from a prescription.
/// Backend: POST /pharmacy-orders
final createPharmacyOrderProvider =
    StateNotifierProvider<CreatePharmacyOrderNotifier, AsyncValue<PharmacyOrder?>>(
        (ref) => CreatePharmacyOrderNotifier(ref));

class CreatePharmacyOrderNotifier
    extends StateNotifier<AsyncValue<PharmacyOrder?>> {
  final Ref _ref;
  CreatePharmacyOrderNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<PharmacyOrder?> create({
    required String siteId,
    required String prescriptionId,
    required List<({String variantId, int quantity})> items,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      final response = await dio.post(
        ApiEndpoints.pharmacyOrders,
        data: {
          'site_id': siteId,
          'prescription_id': prescriptionId,
          'items': items
              .map((i) => {'variant_id': i.variantId, 'quantity': i.quantity})
              .toList(),
        },
      );
      final order =
          PharmacyOrderMapper.fromJson(response.data as Map<String, dynamic>);
      state = AsyncValue.data(order);
      _ref.invalidate(pharmacyOrdersProvider);
      return order;
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"), StackTrace.current);
      return null;
    }
  }
}

/// Rate a delivery.
/// Backend: POST /deliveries/{id}/rating
final rateDeliveryProvider =
    StateNotifierProvider<RateDeliveryNotifier, AsyncValue<void>>(
        (ref) => RateDeliveryNotifier(ref));

class RateDeliveryNotifier extends StateNotifier<AsyncValue<void>> {
  final Ref _ref;
  RateDeliveryNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<void> rate({
    required String deliveryId,
    required int rating,
    String? comment,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.post(
        ApiEndpoints.deliveryRating(deliveryId),
        data: {
          'rating': rating,
          if (comment != null) 'comment': comment,
        },
      );
      state = const AsyncValue.data(null);
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"), StackTrace.current);
    }
  }
}
