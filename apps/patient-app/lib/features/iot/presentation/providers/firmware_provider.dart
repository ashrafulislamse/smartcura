import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';
import '../../../../core/network/api_error.dart';

/// Firmware OTA API client and providers for the patient app.
///
/// Lives here rather than in `core/providers/iot_provider.dart` (which the BLE
/// agent is modifying) so the two workstreams do not collide. The version-check
/// and download endpoints are reachable by any authenticated caller: a patient
/// checks on behalf of a device, and the device itself polls the same endpoint.
///
/// Backend:
///   GET /firmware/versions/{hardwareProfile}          -> FirmwareVersionCheck
///   GET /firmware/versions/{firmwareVersionId}/download -> FirmwareDownload

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

class FirmwareVersionCheckMapper {
  static FirmwareVersionCheck fromJson(Map<String, dynamic> j) =>
      FirmwareVersionCheck.fromJson(j);
}

class FirmwareDownloadMapper {
  static FirmwareDownload fromJson(Map<String, dynamic> j) =>
      FirmwareDownload.fromJson(j);
}

// ---------------------------------------------------------------------------
// API client methods
// ---------------------------------------------------------------------------

/// Checks the backend for a firmware update for a [hardwareProfile].
///
/// [currentVersion] is the X.Y.Z version the device reports it is running;
/// when null the backend always offers the latest. Returns a
/// [FirmwareVersionCheck] describing the latest version and whether an update
/// is available.
Future<FirmwareVersionCheck> checkFirmwareVersion(
  Dio dio,
  String hardwareProfile, [
  String? currentVersion,
]) async {
  final response = await dio.get<Map<String, dynamic>>(
    ApiEndpoints.firmwareVersionCheck(hardwareProfile, currentVersion),
  );
  return FirmwareVersionCheckMapper.fromJson(response.data!);
}

/// Resolves a short-lived presigned download URL for a firmware binary.
///
/// The device fetches the artifact directly from object storage and verifies
/// the sha256 against the registry before flashing. The patient app calls this
/// only to surface the download URL / size to the user; it does not flash.
Future<FirmwareDownload> getFirmwareDownloadUrl(
  Dio dio,
  String firmwareVersionId,
) async {
  final response = await dio.get<Map<String, dynamic>>(
    ApiEndpoints.firmwareDownload(firmwareVersionId),
  );
  return FirmwareDownloadMapper.fromJson(response.data!);
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// Per-device firmware version-check result, keyed by hardware profile and the
/// device's currently-reported firmware version. A patient app calls this for
/// each device to surface an "update available" badge.
final firmwareVersionCheckProvider = FutureProvider.family<FirmwareVersionCheck,
    ({String hardwareProfile, String? currentVersion})>((ref, params) async {
  final dio = ref.watch(apiClientProvider);
  return checkFirmwareVersion(dio, params.hardwareProfile, params.currentVersion);
});

/// The outcome of a "check for updates" action triggered from the UI.
sealed class CheckUpdatesResult {
  const CheckUpdatesResult();
}

class CheckUpdatesSuccess extends CheckUpdatesResult {
  final FirmwareVersionCheck check;
  const CheckUpdatesSuccess(this.check);
}

class CheckUpdatesFailure extends CheckUpdatesResult {
  final String message;
  final ApiError error;
  const CheckUpdatesFailure(this.message, this.error);
}

/// Notifier that runs an explicit "check for updates" action for one device,
/// returning a typed result so the screen can branch on success/failure
/// without parsing DioException at the call site.
class CheckUpdatesNotifier extends StateNotifier<CheckUpdatesResult?> {
  final Ref _ref;
  CheckUpdatesNotifier(this._ref) : super(null);

  Future<void> check(String hardwareProfile, String? currentVersion) async {
    final dio = _ref.read(apiClientProvider);
    try {
      final check =
          await checkFirmwareVersion(dio, hardwareProfile, currentVersion);
      state = CheckUpdatesSuccess(check);
    } on DioException catch (e) {
      final apiError = e.error;
      if (apiError is ApiError) {
        state = CheckUpdatesFailure(apiError.userMessage, apiError);
      } else {
        state =
            CheckUpdatesFailure('Could not check for updates.', ApiError.unexpected(0, null));
      }
    }
  }

  void reset() {
    state = null;
  }
}

final checkUpdatesProvider =
    StateNotifierProvider<CheckUpdatesNotifier, CheckUpdatesResult?>((ref) {
  return CheckUpdatesNotifier(ref);
});
