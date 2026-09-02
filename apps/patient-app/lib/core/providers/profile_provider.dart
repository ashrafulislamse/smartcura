import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../auth/auth_provider.dart';
import '../models/session_bootstrap.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';

// No direct mock replacement — profile data was previously mock in mock_data_provider.
//
// Screens that must be updated in Phase 2:
//   - lib/features/profile/presentation/screens/profile_screen.dart
//   - lib/features/profile/presentation/screens/edit_profile_screen.dart
//   - lib/features/emergency/presentation/screens/emergency_contacts_setup_screen.dart
//   - lib/features/profile/presentation/screens/medical_id_intro_screen.dart

// ---------------------------------------------------------------------------
// Mappers for profile detail types
// ---------------------------------------------------------------------------

class PatientAddressMapper {
  static PatientAddress fromJson(Map<String, dynamic> j) => PatientAddress(
        id: j['id'] as String,
        label: j['label'] as String?,
        line1: j['line1'] as String,
        line2: j['line2'] as String?,
        city: j['city'] as String,
        state: j['state'] as String,
        postcode: j['postcode'] as String,
        countryCode: j['country_code'] as String,
        isPrimary: j['is_primary'] as bool? ?? false,
        latitude: j['latitude'] as String?,
        longitude: j['longitude'] as String?,
        version: (j['version'] as num).toInt(),
      );
}

class EmergencyContactMapper {
  static EmergencyContact fromJson(Map<String, dynamic> j) => EmergencyContact(
        id: j['id'] as String,
        name: j['name'] as String,
        relationship: j['relationship'] as String,
        phoneE164: j['phone_e164'] as String,
        isPrimary: j['is_primary'] as bool? ?? false,
        version: (j['version'] as num).toInt(),
      );
}

class PatientAllergyMapper {
  static PatientAllergy fromJson(Map<String, dynamic> j) => PatientAllergy(
        id: j['id'] as String,
        substance: j['substance'] as String,
        reaction: j['reaction'] as String?,
        severity: j['severity'] as String,
        recordedAt: j['recorded_at'] as String,
        version: (j['version'] as num).toInt(),
      );
}

class PatientConditionMapper {
  static PatientCondition fromJson(Map<String, dynamic> j) => PatientCondition(
        id: j['id'] as String,
        conditionName: j['condition_name'] as String,
        status: j['status'] as String,
        onsetDate: j['onset_date'] as String?,
        resolvedDate: j['resolved_date'] as String?,
        notes: j['notes'] as String?,
        version: (j['version'] as num).toInt(),
      );
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// The current patient's profile. Reads from the auth provider first (which
/// already holds it from the session bootstrap) and falls back to GET /profiles/me.
/// Backend: GET /profiles/me
final profileProvider = FutureProvider<Profile>((ref) async {
  // If the auth state already has the profile, return it immediately.
  final authProfile = ref.watch(currentProfileProvider);
  if (authProfile != null) return authProfile;

  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.profilesMe);
  return ProfileMapper.fromJson(response.data as Map<String, dynamic>);
});

/// Patient addresses (self-scoped).
/// Backend: GET /profiles/me/addresses
final addressesProvider = FutureProvider<List<PatientAddress>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.profilesMeAddresses);
  final data = response.data;
  if (data is List) {
    return data
        .whereType<Map<String, dynamic>>()
        .map(PatientAddressMapper.fromJson)
        .toList();
  }
  final list = (data as Map<String, dynamic>)['data'] as List<dynamic>;
  return list
      .whereType<Map<String, dynamic>>()
      .map(PatientAddressMapper.fromJson)
      .toList();
});

/// Emergency contacts (self-scoped).
/// Backend: GET /profiles/me/emergency-contacts
final emergencyContactsProvider =
    FutureProvider<List<EmergencyContact>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.profilesMeEmergencyContacts);
  final data = response.data;
  if (data is List) {
    return data
        .whereType<Map<String, dynamic>>()
        .map(EmergencyContactMapper.fromJson)
        .toList();
  }
  final list = (data as Map<String, dynamic>)['data'] as List<dynamic>;
  return list
      .whereType<Map<String, dynamic>>()
      .map(EmergencyContactMapper.fromJson)
      .toList();
});

/// Allergies (self-scoped).
/// Backend: GET /profiles/me/allergies
final allergiesProvider = FutureProvider<List<PatientAllergy>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.profilesMeAllergies);
  final data = response.data;
  if (data is List) {
    return data
        .whereType<Map<String, dynamic>>()
        .map(PatientAllergyMapper.fromJson)
        .toList();
  }
  final list = (data as Map<String, dynamic>)['data'] as List<dynamic>;
  return list
      .whereType<Map<String, dynamic>>()
      .map(PatientAllergyMapper.fromJson)
      .toList();
});

/// Conditions (self-scoped).
/// Backend: GET /profiles/me/conditions
final conditionsProvider = FutureProvider<List<PatientCondition>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.profilesMeConditions);
  final data = response.data;
  if (data is List) {
    return data
        .whereType<Map<String, dynamic>>()
        .map(PatientConditionMapper.fromJson)
        .toList();
  }
  final list = (data as Map<String, dynamic>)['data'] as List<dynamic>;
  return list
      .whereType<Map<String, dynamic>>()
      .map(PatientConditionMapper.fromJson)
      .toList();
});

/// Update the current patient's profile.
/// Backend: PATCH /profiles/me
final updateProfileProvider =
    StateNotifierProvider<UpdateProfileNotifier, AsyncValue<Profile?>>(
        (ref) => UpdateProfileNotifier(ref));

class UpdateProfileNotifier extends StateNotifier<AsyncValue<Profile?>> {
  final Ref _ref;
  UpdateProfileNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<Profile?> update({
    String? displayName,
    String? phoneE164,
    String? preferredLocale,
    String? timezone,
    bool? completeOnboarding,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      final response = await dio.patch(
        ApiEndpoints.profilesMe,
        data: {
          if (displayName != null) 'display_name': displayName,
          if (phoneE164 != null) 'phone_e164': phoneE164,
          if (preferredLocale != null) 'preferred_locale': preferredLocale,
          if (timezone != null) 'timezone': timezone,
          if (completeOnboarding != null)
            'complete_onboarding': completeOnboarding,
        },
      );
      final profile =
          ProfileMapper.fromJson(response.data as Map<String, dynamic>);
      state = AsyncValue.data(profile);
      _ref.invalidate(profileProvider);
      return profile;
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
      return null;
    }
  }
}

/// Create / update / delete emergency contacts.
/// Backend: POST /profiles/me/emergency-contacts, PATCH /profiles/me/emergency-contacts/{id}
final emergencyContactMutationProvider =
    StateNotifierProvider<EmergencyContactMutationNotifier, AsyncValue<void>>(
        (ref) => EmergencyContactMutationNotifier(ref));

class EmergencyContactMutationNotifier extends StateNotifier<AsyncValue<void>> {
  final Ref _ref;
  EmergencyContactMutationNotifier(this._ref)
      : super(const AsyncValue.data(null));

  Future<void> create({
    required String name,
    required String relationship,
    required String phoneE164,
    bool? isPrimary,
    required String reasonCode,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.post(
        ApiEndpoints.profilesMeEmergencyContacts,
        data: {
          'name': name,
          'relationship': relationship,
          'phone_e164': phoneE164,
          if (isPrimary != null) 'is_primary': isPrimary,
          'reason_code': reasonCode,
        },
      );
      state = const AsyncValue.data(null);
      _ref.invalidate(emergencyContactsProvider);
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
    }
  }

  Future<void> update({
    required String contactId,
    required String name,
    required String relationship,
    required String phoneE164,
    bool? isPrimary,
    required String reasonCode,
    required int expectedVersion,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.patch(
        '${ApiEndpoints.profilesMeEmergencyContacts}/$contactId',
        data: {
          'name': name,
          'relationship': relationship,
          'phone_e164': phoneE164,
          if (isPrimary != null) 'is_primary': isPrimary,
          'reason_code': reasonCode,
          'expected_version': expectedVersion,
        },
      );
      state = const AsyncValue.data(null);
      _ref.invalidate(emergencyContactsProvider);
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
    }
  }

  /// Delete an emergency contact.
  /// Backend: DELETE /profiles/me/emergency-contacts/{id}
  Future<void> delete({
    required String contactId,
    required String reasonCode,
    required int expectedVersion,
  }) async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.delete(
        '${ApiEndpoints.profilesMeEmergencyContacts}/$contactId',
        data: {
          'reason_code': reasonCode,
          'expected_version': expectedVersion,
        },
      );
      state = const AsyncValue.data(null);
      _ref.invalidate(emergencyContactsProvider);
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Request failed"),
          StackTrace.current);
    }
  }
}

// ---------------------------------------------------------------------------
// Avatar upload / removal
// ---------------------------------------------------------------------------

/// Upload a new profile avatar (base64 image, ≤ 2 MB).
/// Backend: POST /profiles/me/avatar
final uploadAvatarProvider =
    StateNotifierProvider<UploadAvatarNotifier, AsyncValue<Profile?>>(
        (ref) => UploadAvatarNotifier(ref));

class UploadAvatarNotifier extends StateNotifier<AsyncValue<Profile?>> {
  final Ref _ref;
  final ImagePicker _picker = ImagePicker();

  UploadAvatarNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<void> pickAndUpload(ImageSource source) async {
    state = const AsyncValue.loading();
    try {
      final xFile = await _picker.pickImage(
        source: source,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 85,
      );
      if (xFile == null) {
        state = const AsyncValue.data(null);
        return;
      }
      await _uploadFile(xFile);
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Upload failed"),
          StackTrace.current);
    } on ApiError catch (e) {
      state = AsyncValue.error(e, StackTrace.current);
    } catch (e, st) {
      state = AsyncValue.error(ApiError.network(e.toString()), st);
    }
  }

  Future<void> _uploadFile(XFile xFile) async {
    final bytes = await xFile.readAsBytes();
    const maxBytes = 2 * 1024 * 1024;
    if (bytes.length > maxBytes) {
      throw ApiError(
        status: 0,
        code: 'VALIDATION_FAILED',
        title: 'Image too large',
        detail:
            'Selected image must be 2 MB or smaller. Please choose a smaller image.',
      );
    }
    final dio = _ref.read(apiClientProvider);
    final response = await dio.post(
      ApiEndpoints.profilesMeAvatar,
      data: {
        'bytes_base64': base64Encode(bytes),
        'media_type': _mediaType(xFile),
      },
    );
    Profile? profile;
    try {
      profile = ProfileMapper.fromJson(response.data as Map<String, dynamic>);
    } catch (_) {
      // The backend may return a lightweight shape; refresh from the session
      // bootstrap to get the authoritative profile with the new avatar.
    }
    state = AsyncValue.data(profile);
    _ref.invalidate(profileProvider);
    await _ref.read(authProvider.notifier).refreshProfile();
  }

  String _mediaType(XFile xFile) {
    if (xFile.mimeType != null && xFile.mimeType!.isNotEmpty) {
      return xFile.mimeType!;
    }
    final ext = xFile.path.split('.').last.toLowerCase();
    return switch (ext) {
      'jpg' || 'jpeg' => 'image/jpeg',
      'png' => 'image/png',
      'webp' => 'image/webp',
      'gif' => 'image/gif',
      'heic' => 'image/heic',
      'heif' => 'image/heif',
      _ => 'image/jpeg',
    };
  }
}

/// Remove the current profile avatar.
/// Backend: DELETE /profiles/me/avatar
final removeAvatarProvider =
    StateNotifierProvider<RemoveAvatarNotifier, AsyncValue<void>>(
        (ref) => RemoveAvatarNotifier(ref));

class RemoveAvatarNotifier extends StateNotifier<AsyncValue<void>> {
  final Ref _ref;
  RemoveAvatarNotifier(this._ref) : super(const AsyncValue.data(null));

  Future<void> remove() async {
    state = const AsyncValue.loading();
    try {
      final dio = _ref.read(apiClientProvider);
      await dio.delete(ApiEndpoints.profilesMeAvatar);
      state = const AsyncValue.data(null);
      _ref.invalidate(profileProvider);
      await _ref.read(authProvider.notifier).refreshProfile();
    } on DioException catch (e) {
      final apiError = e.error as ApiError?;
      state = AsyncValue.error(
          apiError ?? ApiError.network(e.message ?? "Remove failed"),
          StackTrace.current);
    }
  }
}
