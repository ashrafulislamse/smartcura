import 'dart:convert';

import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../models/contract_decoders.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';
import 'provider_helpers.dart';

/// The current driver's profile (`GET /profiles/me`). Refreshed on sign-in and
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

/// Upload a new profile photo (`POST /profiles/me/avatar`). Picks an image from
/// the gallery, base64-encodes it, computes its SHA-256, and sends it to the
/// backend. On success the returned profile is stored in the mutation state so
/// the caller can refresh [profileProvider].
class UploadAvatarNotifier extends StateNotifier<ProfileMutationState> {
  UploadAvatarNotifier(this._api) : super(const ProfileMutationState());
  final ApiClient _api;

  Future<bool> pickAndUpload() async {
    state = const ProfileMutationState(loading: true);
    try {
      final picker = ImagePicker();
      final XFile? picked = await picker.pickImage(
        source: ImageSource.gallery,
        maxWidth: 1200,
        maxHeight: 1200,
        imageQuality: 85,
      );
      if (picked == null) {
        state = const ProfileMutationState();
        return false;
      }

      final bytes = await picked.readAsBytes();
      final mediaType = _mediaTypeFromPath(picked.path);
      final encoded = base64Encode(bytes);
      final digest = sha256.convert(bytes).toString();

      final body = await _api.post(
        ApiEndpoints.profilesMeAvatar,
        body: <String, dynamic>{
          'bytes_base64': encoded,
          'media_type': mediaType,
          'declared_sha256': digest,
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

/// Remove the current profile photo (`DELETE /profiles/me/avatar`).
class RemoveAvatarNotifier extends StateNotifier<ProfileMutationState> {
  RemoveAvatarNotifier(this._api) : super(const ProfileMutationState());
  final ApiClient _api;

  Future<bool> call() async {
    state = const ProfileMutationState(loading: true);
    try {
      await _api.delete(ApiEndpoints.profilesMeAvatar);
      state = const ProfileMutationState();
      return true;
    } catch (e) {
      state = ProfileMutationState(error: toApiError(e));
      return false;
    }
  }

  void reset() => state = const ProfileMutationState();
}

final uploadAvatarProvider = StateNotifierProvider.autoDispose<
        UploadAvatarNotifier, ProfileMutationState>(
    (ref) => UploadAvatarNotifier(ref.watch(apiClientProvider)));

final removeAvatarProvider = StateNotifierProvider.autoDispose<
        RemoveAvatarNotifier, ProfileMutationState>(
    (ref) => RemoveAvatarNotifier(ref.watch(apiClientProvider)));

String _mediaTypeFromPath(String path) {
  final ext = path.toLowerCase().split('.').last;
  if (ext == 'jpg' || ext == 'jpeg') return 'image/jpeg';
  if (ext == 'png') return 'image/png';
  if (ext == 'webp') return 'image/webp';
  if (ext == 'gif') return 'image/gif';
  return 'image/jpeg';
}
