import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../../../../core/network/api_client.dart';
import '../../../../core/network/api_endpoints.dart';
import '../../../../core/network/api_error.dart';
import '../../../../core/providers/iot_provider.dart';

/// Device management mutations for the patient app's IoT feature.
///
/// The device *list* and *detail/readings* providers live in
/// `core/providers/iot_provider.dart` (modified by the BLE agent and shared
/// across screens). This file holds only the per-patient *release assignment*
/// mutation used by the device detail screen, so it does not collide with the
/// BLE agent's work in that shared file.
///
/// Backend: POST /profiles/me/devices/{deviceId}/assignments/release
///
/// The release is a sub-resource action, not a DELETE — the open assignment row
/// is closed with a timestamp and a structured, PHI-free reason code and the
/// history stays intact, because a reading recorded last month must remain
/// attributable to the patient the device was assigned to then. The call
/// requires `device:release:own` (granted to the patient role in 0061), so the
/// patient can remove a device from their own profile without a care-provider
/// approval step.

/// The outcome of a release-assignment mutation.
sealed class ReleaseAssignmentResult {
  const ReleaseAssignmentResult();
}

/// The device was released; carries the updated [Device] (now with no open
/// assignment) so the screen can reflect the new state immediately.
class ReleaseAssignmentSuccess extends ReleaseAssignmentResult {
  final Device device;
  const ReleaseAssignmentSuccess(this.device);
}

/// The server required a recent MFA step-up. The UI should prompt the patient
/// to re-authenticate before retrying the release.
class ReleaseAssignmentStepUp extends ReleaseAssignmentResult {
  final String message;
  const ReleaseAssignmentStepUp(this.message);
}

/// A recoverable optimistic-concurrency conflict. The caller holds a stale
/// `version`; it must RE-READ the device before retrying, not increment what
/// it holds (see AGENTS.md: "A mutation acknowledgement is not the new state").
class ReleaseAssignmentConflict extends ReleaseAssignmentResult {
  final String message;
  const ReleaseAssignmentConflict(this.message);
}

/// Any other failure (network, forbidden, not found, validation).
class ReleaseAssignmentFailure extends ReleaseAssignmentResult {
  final String message;
  final ApiError error;
  const ReleaseAssignmentFailure(this.message, this.error);
}

/// State of the release-assignment mutation.
class ReleaseAssignmentNotifierState {
  /// Whether a release request is in flight.
  final bool isLoading;

  /// The most recent result, if any. `null` until the first mutation completes
  /// (or is reset). Kept separate from [isLoading] so the UI can show the prior
  /// result while a retry is loading.
  final ReleaseAssignmentResult? result;

  const ReleaseAssignmentNotifierState({
    this.isLoading = false,
    this.result,
  });

  ReleaseAssignmentNotifierState copyWith({
    bool? isLoading,
    ReleaseAssignmentResult? result,
    bool clearResult = false,
  }) =>
      ReleaseAssignmentNotifierState(
        isLoading: isLoading ?? this.isLoading,
        result: clearResult ? null : (result ?? this.result),
      );
}

/// Releases a device from the current patient's assignment.
///
/// On success this invalidates the shared `devicesProvider`, `myDevicesProvider`,
/// `deviceDetailProvider` and `deviceReadingsProvider` from
/// `core/providers/iot_provider.dart` so the management hub list, the detail
/// screen and the readings list all drop the released device on the next read.
final releaseAssignmentProvider = StateNotifierProvider<
    ReleaseAssignmentNotifier,
    ReleaseAssignmentNotifierState>((ref) => ReleaseAssignmentNotifier(ref));

class ReleaseAssignmentNotifier
    extends StateNotifier<ReleaseAssignmentNotifierState> {
  final Ref _ref;
  ReleaseAssignmentNotifier(this._ref)
      : super(const ReleaseAssignmentNotifierState());

  /// Release the device identified by [deviceId] from the current patient's
  /// assignment, using the optimistic-concurrency [expectedVersion] from the
  /// last read and the structured [reasonCode] (never free text — see the
  /// OpenAPI description).
  ///
  /// Returns the [ReleaseAssignmentResult] so the caller can react inline (for
  /// example, navigate back on success) in addition to the state emission.
  Future<ReleaseAssignmentResult> release({
    required String deviceId,
    required int expectedVersion,
    required DeviceReleaseReasonCode reasonCode,
  }) async {
    state = state.copyWith(isLoading: true, clearResult: true);
    try {
      final dio = _ref.read(apiClientProvider);
      // The Dio client's CSRF + idempotency interceptors add the headers.
      final response = await dio.post(
        ApiEndpoints.profilesMeDeviceAssignmentRelease(deviceId),
        data: {
          'expected_version': expectedVersion,
          'reason_code': reasonCode.wireValue,
        },
      );
      final updated = Device.fromJson(response.data as Map<String, dynamic>);
      state = ReleaseAssignmentNotifierState(
        isLoading: false,
        result: ReleaseAssignmentSuccess(updated),
      );
      // Refresh the shared device lists + detail so the released device
      // disappears immediately. The providers live in iot_provider.dart.
      // Invalidate both the org-scoped providers (used by the old management
      // hub) and the patient-self providers (used by DeviceVitalsScreen).
      _ref.invalidate(devicesProvider);
      _ref.invalidate(myDevicesProvider);
      _ref.invalidate(deviceDetailProvider);
      _ref.invalidate(deviceReadingsProvider);
      _ref.invalidate(patientDeviceDetailProvider);
      _ref.invalidate(patientDeviceReadingsProvider);
      return state.result!;
    } on DioException catch (e) {
      final apiError = e.error as ApiError? ??
          ApiError.network(e.message ?? 'Request failed');
      final ReleaseAssignmentResult result;
      if (apiError.needsStepUp) {
        result = ReleaseAssignmentStepUp(
          'Re-authentication is required before releasing a device. '
          'Please verify your identity and try again.',
        );
      } else if (apiError.isVersionConflict) {
        result = ReleaseAssignmentConflict(
          'This device was updated by another action. Refresh the device '
          'and try again.',
        );
      } else {
        result = ReleaseAssignmentFailure(apiError.userMessage, apiError);
      }
      state = ReleaseAssignmentNotifierState(isLoading: false, result: result);
      return result;
    } catch (e) {
      final apiError = ApiError.network(e.toString());
      final result = ReleaseAssignmentFailure(apiError.userMessage, apiError);
      state = ReleaseAssignmentNotifierState(isLoading: false, result: result);
      return result;
    }
  }

  /// Clear any prior result so the UI does not show a stale success/error.
  void reset() {
    state = const ReleaseAssignmentNotifierState();
  }
}

// ---------------------------------------------------------------------------
// Self-assign an unassigned device after BLE provisioning
// ---------------------------------------------------------------------------

/// The outcome of a patient self-assign mutation.
sealed class AssignOwnDeviceResult {
  const AssignOwnDeviceResult();
}

/// The device was assigned to the patient; carries the updated [Device].
class AssignOwnDeviceSuccess extends AssignOwnDeviceResult {
  final Device device;
  const AssignOwnDeviceSuccess(this.device);
}

/// Any failure (network, forbidden, not found, validation).
class AssignOwnDeviceFailure extends AssignOwnDeviceResult {
  final String message;
  final ApiError? error;
  const AssignOwnDeviceFailure(this.message, this.error);
}

/// State of the self-assign mutation.
class AssignOwnDeviceNotifierState {
  final bool isLoading;
  final AssignOwnDeviceResult? result;

  const AssignOwnDeviceNotifierState({
    this.isLoading = false,
    this.result,
  });

  AssignOwnDeviceNotifierState copyWith({
    bool? isLoading,
    AssignOwnDeviceResult? result,
    bool clearResult = false,
  }) =>
      AssignOwnDeviceNotifierState(
        isLoading: isLoading ?? this.isLoading,
        result: clearResult ? null : (result ?? this.result),
      );
}

/// Assigns an unassigned device in the patient's organization to the patient.
///
/// On success this invalidates `myDevicesProvider` and the patient-self detail /
/// readings providers so the device appears immediately in the list.
final assignOwnDeviceProvider = StateNotifierProvider<AssignOwnDeviceNotifier,
    AssignOwnDeviceNotifierState>(
  (ref) => AssignOwnDeviceNotifier(ref),
);

class AssignOwnDeviceNotifier
    extends StateNotifier<AssignOwnDeviceNotifierState> {
  final Ref _ref;
  AssignOwnDeviceNotifier(this._ref)
      : super(const AssignOwnDeviceNotifierState());

  /// Assign the device identified by [deviceId] to the current patient.
  /// The backend makes `expected_version` optional, so the call can be made
  /// immediately after BLE provisioning without reading the device first.
  Future<AssignOwnDeviceResult> assign(String deviceId) async {
    state = state.copyWith(isLoading: true, clearResult: true);
    try {
      final dio = _ref.read(apiClientProvider);
      final response = await dio.post(
        ApiEndpoints.profilesMeDeviceAssignments(deviceId),
        data: const <String, dynamic>{},
      ).timeout(const Duration(seconds: 15));
      final device = Device.fromJson(response.data as Map<String, dynamic>);
      state = AssignOwnDeviceNotifierState(
        isLoading: false,
        result: AssignOwnDeviceSuccess(device),
      );
      _ref.invalidate(myDevicesProvider);
      _ref.invalidate(patientDeviceDetailProvider);
      _ref.invalidate(patientDeviceReadingsProvider);
      return state.result!;
    } on DioException catch (e) {
      final apiError = e.error as ApiError? ??
          ApiError.network(e.message ?? 'Request failed');
      final result = AssignOwnDeviceFailure(apiError.userMessage, apiError);
      state = AssignOwnDeviceNotifierState(isLoading: false, result: result);
      return result;
    } catch (e) {
      final message = e.toString().contains('TimeoutException')
          ? 'The request timed out. Please check your internet connection and try again.'
          : e.toString();
      final apiError = ApiError.network(message);
      final result = AssignOwnDeviceFailure(apiError.userMessage, apiError);
      state = AssignOwnDeviceNotifierState(isLoading: false, result: result);
      return result;
    }
  }

  void reset() => state = const AssignOwnDeviceNotifierState();
}
