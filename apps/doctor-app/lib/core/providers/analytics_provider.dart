import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import 'provider_helpers.dart';

/// Optional date-range filter for [analyticsProvider]. Null fields are dropped
/// from the query, so the server returns its default window.
class AnalyticsRange {
  const AnalyticsRange({this.from, this.to});
  final String? from; // ISO date `YYYY-MM-DD`
  final String? to;
}

/// Doctor analytics: appointment-status breakdown, patient-count trend, rating
/// summary, and a monthly earnings projection. Parameterised by an optional
/// date range so the analytics screen can render a custom window.
final analyticsProvider =
    FutureProvider.family<DoctorAnalyticsResponse, AnalyticsRange?>(
        (ref, range) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(
      ApiEndpoints.doctorAnalytics,
      queryParameters: cleanQuery({
        'from': range?.from,
        'to': range?.to,
      }),
    );
    return decodeDoctorAnalyticsResponse(body);
  });
});
