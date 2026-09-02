import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import 'provider_helpers.dart';

/// Doctor earnings: current balance (integer sen), total earned, and a paginated
/// list of payout items. Money is never converted to a double here.
final earningsProvider = FutureProvider<DoctorEarnings>((ref) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.doctorEarnings);
    return decodeDoctorEarnings(body);
  });
});
