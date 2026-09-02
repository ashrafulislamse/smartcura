import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import 'provider_helpers.dart';

/// The acting driver's vehicles (`GET /drivers/me/vehicles`).
final vehiclesProvider = FutureProvider<VehicleList>((ref) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.driversMeVehicles);
    return decodeVehicleList(body);
  });
});
