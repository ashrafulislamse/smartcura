import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import 'provider_helpers.dart';

/// Doctor dashboard summary (today's appointments, upcoming list, assigned
/// patient count, pending notes, unread notifications, active IoT alerts).
/// Refreshed by re-watching the provider.
final dashboardProvider =
    FutureProvider<DoctorDashboardResponse>((ref) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.doctorDashboard);
    return decodeDoctorDashboardResponse(body);
  });
});
