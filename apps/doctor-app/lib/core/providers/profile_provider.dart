import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../auth/auth_provider.dart';
import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// The current doctor's profile (`GET /profiles/me`). Refreshed on sign-in and
/// after a profile edit.
final profileProvider = FutureProvider<Profile>((ref) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.profilesMe);
    return decodeProfile(body);
  });
});

/// Outcome of a profile mutation.
class ProfileMutationState {
  const ProfileMutationState({this.value, this.error, this.loading = false});
  final Profile? value;
  final ApiError? error;
  final bool loading;
}

/// Update the current profile (`PATCH /profiles/me`). Any null field is omitted,
/// so the server leaves it untouched (partial update semantics).
class UpdateProfileNotifier extends StateNotifier<ProfileMutationState> {
  UpdateProfileNotifier(this._api) : super(const ProfileMutationState());
  final ApiClient _api;

  Future<bool> call(UpdateMyProfileRequest req) async {
    state = const ProfileMutationState(loading: true);
    try {
      final body = await _api.patch(
        ApiEndpoints.profilesMe,
        body: <String, dynamic>{
          if (req.displayName != null) 'display_name': req.displayName,
          if (req.phoneE164 != null) 'phone_e164': req.phoneE164,
          if (req.preferredLocale != null)
            'preferred_locale': req.preferredLocale,
          if (req.timezone != null) 'timezone': req.timezone,
          if (req.completeOnboarding != null)
            'complete_onboarding': req.completeOnboarding,
        },
      );
      state = ProfileMutationState(value: decodeProfile(body));
      return true;
    } catch (e) {
      state = ProfileMutationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const ProfileMutationState();
}

final updateProfileProvider = StateNotifierProvider.autoDispose<
        UpdateProfileNotifier, ProfileMutationState>(
    (ref) => UpdateProfileNotifier(ref.watch(apiClientProvider)));

/// Avatar mutation state. Shared by upload and remove notifiers because only one
/// avatar operation can be in progress at a time.
class AvatarMutationState {
  const AvatarMutationState({this.value, this.error, this.loading = false});
  final Profile? value;
  final ApiError? error;
  final bool loading;
}

/// Upload a new profile photo (`POST /profiles/me/avatar`).
class AvatarUploadNotifier extends StateNotifier<AvatarMutationState> {
  AvatarUploadNotifier(this._ref) : super(const AvatarMutationState());
  final Ref _ref;

  Future<Profile?> pickAndUpload() async {
    state = const AvatarMutationState(loading: true);
    try {
      final picker = ImagePicker();
      final picked = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 85,
      );
      if (picked == null) {
        state = const AvatarMutationState();
        return null;
      }
      final bytes = await picked.readAsBytes();
      final body = await _ref.read(apiClientProvider).post(
        ApiEndpoints.profilesMeAvatar,
        body: <String, dynamic>{
          'bytes_base64': base64Encode(bytes),
          'media_type': _mediaTypeForFile(picked.name),
        },
      );
      final profile = decodeProfile(body);
      _ref.read(authProvider.notifier).refreshProfile(profile);
      _ref.invalidate(profileProvider);
      state = AvatarMutationState(value: profile);
      return profile;
    } catch (e) {
      state = AvatarMutationState(error: toApiError(e));
      return null;
    }
  }

  void reset() => state = const AvatarMutationState();

  static String _mediaTypeForFile(String name) {
    final ext = name.toLowerCase().split('.').lastOrNull;
    return switch (ext) {
      'png' => 'image/png',
      'gif' => 'image/gif',
      'webp' => 'image/webp',
      'jpg' || 'jpeg' => 'image/jpeg',
      _ => 'image/jpeg',
    };
  }
}

/// Remove the current profile photo (`DELETE /profiles/me/avatar`).
class AvatarRemoveNotifier extends StateNotifier<AvatarMutationState> {
  AvatarRemoveNotifier(this._ref) : super(const AvatarMutationState());
  final Ref _ref;

  Future<Profile?> remove() async {
    state = const AvatarMutationState(loading: true);
    try {
      await _ref.read(apiClientProvider).delete(ApiEndpoints.profilesMeAvatar);
      final body =
          await _ref.read(apiClientProvider).get(ApiEndpoints.profilesMe);
      final profile = decodeProfile(body);
      _ref.read(authProvider.notifier).refreshProfile(profile);
      _ref.invalidate(profileProvider);
      state = AvatarMutationState(value: profile);
      return profile;
    } catch (e) {
      state = AvatarMutationState(error: toApiError(e));
      return null;
    }
  }

  void reset() => state = const AvatarMutationState();
}

final avatarUploadProvider = StateNotifierProvider.autoDispose<
    AvatarUploadNotifier,
    AvatarMutationState>((ref) => AvatarUploadNotifier(ref));

final avatarRemoveProvider = StateNotifierProvider.autoDispose<
    AvatarRemoveNotifier,
    AvatarMutationState>((ref) => AvatarRemoveNotifier(ref));

/// Doctor professional details for a membership (`GET /memberships/{id}/doctor-details`).
/// Carries biography, years of experience, consultation fee (integer sen),
/// specialties, and languages.
final doctorDetailsProvider =
    FutureProvider.family<DoctorProfessionalDetail, String>(
        (ref, membershipId) async {
  final api = ref.watch(apiClientProvider);
  return guardApi(() async {
    final body = await api.get(ApiEndpoints.doctorDetails(membershipId));
    return decodeDoctorProfessionalDetail(body);
  });
});

/// Outcome of a doctor-details mutation.
class DoctorDetailsMutationState {
  const DoctorDetailsMutationState(
      {this.value, this.error, this.loading = false});
  final DoctorProfessionalDetail? value;
  final ApiError? error;
  final bool loading;
}

/// Replace the doctor professional details (`PUT /memberships/{id}/doctor-details`).
class UpdateDoctorDetailsNotifier
    extends StateNotifier<DoctorDetailsMutationState> {
  UpdateDoctorDetailsNotifier(this._api)
      : super(const DoctorDetailsMutationState());
  final ApiClient _api;

  Future<bool> call({
    required String membershipId,
    String? biography,
    int? yearsExperience,
    int? consultationFeeSen,
    bool? acceptsNewPatients,
    List<String>? specialties,
    List<String>? languages,
    required int expectedVersion,
  }) async {
    state = const DoctorDetailsMutationState(loading: true);
    try {
      final body = await _api.put(
        ApiEndpoints.doctorDetails(membershipId),
        body: <String, dynamic>{
          if (biography != null) 'biography': biography,
          if (yearsExperience != null) 'years_experience': yearsExperience,
          if (consultationFeeSen != null)
            'consultation_fee_sen': consultationFeeSen,
          if (acceptsNewPatients != null)
            'accepts_new_patients': acceptsNewPatients,
          if (specialties != null) 'specialties': specialties,
          if (languages != null) 'languages': languages,
          'expected_version': expectedVersion,
        },
      );
      state = DoctorDetailsMutationState(
          value: decodeDoctorProfessionalDetail(body));
      return true;
    } catch (e) {
      state = DoctorDetailsMutationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const DoctorDetailsMutationState();
}

final updateDoctorDetailsProvider = StateNotifierProvider.autoDispose<
        UpdateDoctorDetailsNotifier, DoctorDetailsMutationState>(
    (ref) => UpdateDoctorDetailsNotifier(ref.watch(apiClientProvider)));
