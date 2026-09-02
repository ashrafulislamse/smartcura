import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import 'provider_helpers.dart';

/// Driver earnings balance (`GET /drivers/me/earnings`). Projected over the
/// append-only earnings ledger. Money is integer sen — never parsed as a double.
final driverEarningsProvider = FutureProvider<DriverEarnings>((ref) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.driversMeEarnings);
    return decodeDriverEarnings(body);
  });
});
