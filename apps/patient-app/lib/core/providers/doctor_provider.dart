import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/search_params.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';

// Replaces: lib/core/providers/mock_data_provider.dart (mockDoctorsProvider)
//
// Screens that previously imported mock data and must be updated in Phase 2:
//   - lib/features/consultations/presentation/screens/find_doctor_screen.dart
//     (used ref.watch(mockDoctorsProvider))
//   - lib/features/consultations/presentation/screens/doctor_profile_screen.dart
//     (uses ref.watch(selectedDoctorProvider) — now typed as DoctorDirectoryItem?)

/// Fetches the doctor directory with optional search/filter params.
/// Backend: GET /doctors with query parameters.
final doctorsProvider =
    FutureProvider.family<List<DoctorDirectoryItem>, DoctorSearchParams>(
        (ref, params) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(
    ApiEndpoints.doctors,
    queryParameters: params.toQueryParams(),
  );
  final page = DoctorDirectoryPageMapper.fromJson(
    response.data as Map<String, dynamic>,
  );
  return page.data;
});

/// Fetches a single doctor's directory entry by membership id.
/// Backend: GET /doctors/{id}
final doctorDetailProvider =
    FutureProvider.family<DoctorDirectoryItem, String>((ref, id) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.doctor(id));
  return DoctorDirectoryItemMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Fetches public reviews for a doctor.
/// Backend: GET /doctors/{id}/reviews
final doctorReviewsProvider =
    FutureProvider.family<List<PublicDoctorReview>, String>((ref, id) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.doctorReviews(id));
  final page = DoctorReviewPageMapper.fromJson(
    response.data as Map<String, dynamic>,
  );
  return page.data;
});

/// Selected doctor for the booking flow (kept as StateProvider so
/// find_doctor_screen can set it and doctor_profile_screen / book_appointment
/// can read it). Typed to the real contract type.
final selectedDoctorProvider =
    StateProvider<DoctorDirectoryItem?>((ref) => null);

/// Submit a doctor review after a completed appointment.
/// Backend: PUT /appointments/{appointmentId}/doctor-review
final submitDoctorReviewProvider =
    StateNotifierProvider<SubmitDoctorReviewNotifier, AsyncValue<void>>(
        (ref) => SubmitDoctorReviewNotifier(ref));

class SubmitDoctorReviewNotifier extends StateNotifier<AsyncValue<void>> {
  final Ref _ref;
  SubmitDoctorReviewNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<void> submit({
    required String appointmentId,
    required int expectedVersion,
    required int rating,
    String? comment,
    List<DoctorReviewTag>? tags,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.put(
        ApiEndpoints.doctorReview(appointmentId),
        data: {
          'expected_version': expectedVersion,
          'rating': rating,
          if (comment != null) 'comment': comment,
          if (tags != null)
            'tags': tags.map((t) => t.wireValue).toList(),
        },
      );
      state = const AsyncValue.data(null);
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(apiError ?? ApiError.network(e.message ?? "Request failed"), StackTrace.current);
    }
  }
}
