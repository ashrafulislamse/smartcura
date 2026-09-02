import 'dart:async';

import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/ble_provisioning_service.dart';

/// Overall phases of the patient-side BLE provisioning flow.
enum ProvisioningPhase {
  initial,
  enteringDeviceId,
  scanning,
  connecting,
  verifyingDeviceId,
  enteringPin,
  verifyingPin,
  enteringWifi,
  sendingCredentials,
  provisioning,
  success,
  error,
}

/// Immutable state of the BLE provisioning wizard.
class BleProvisioningState {
  const BleProvisioningState({
    this.phase = ProvisioningPhase.initial,
    this.targetDeviceId,
    this.selectedDevice,
    this.discoveredService,
    this.deviceIdReadFromBle,
    this.pin,
    this.ssid,
    this.password,
    this.lastStatus,
    this.errorMessage,
    this.pinVerified = false,
    this.pinAttemptCount = 0,
    this.pinLocked = false,
  });
  final ProvisioningPhase phase;
  final String? targetDeviceId;
  final ProvisioningBleDevice? selectedDevice;
  final BluetoothService? discoveredService;
  final String? deviceIdReadFromBle;
  final String? pin;
  final String? ssid;
  final String? password;
  final String? lastStatus;
  final String? errorMessage;
  final bool pinVerified;
  final int pinAttemptCount;
  final bool pinLocked;

  BleProvisioningState copyWith({
    ProvisioningPhase? phase,
    String? targetDeviceId,
    ProvisioningBleDevice? selectedDevice,
    BluetoothService? discoveredService,
    String? deviceIdReadFromBle,
    String? pin,
    String? ssid,
    String? password,
    String? lastStatus,
    String? errorMessage,
    bool? pinVerified,
    int? pinAttemptCount,
    bool? pinLocked,
    bool clearTargetDeviceId = false,
    bool clearSelectedDevice = false,
    bool clearDiscoveredService = false,
    bool clearDeviceIdReadFromBle = false,
    bool clearPin = false,
    bool clearSsid = false,
    bool clearPassword = false,
    bool clearLastStatus = false,
    bool clearErrorMessage = false,
  }) =>
      BleProvisioningState(
        phase: phase ?? this.phase,
        targetDeviceId:
            clearTargetDeviceId ? null : targetDeviceId ?? this.targetDeviceId,
        selectedDevice:
            clearSelectedDevice ? null : selectedDevice ?? this.selectedDevice,
        discoveredService: clearDiscoveredService
            ? null
            : discoveredService ?? this.discoveredService,
        deviceIdReadFromBle: clearDeviceIdReadFromBle
            ? null
            : deviceIdReadFromBle ?? this.deviceIdReadFromBle,
        pin: clearPin ? null : pin ?? this.pin,
        ssid: clearSsid ? null : ssid ?? this.ssid,
        password: clearPassword ? null : password ?? this.password,
        lastStatus: clearLastStatus ? null : lastStatus ?? this.lastStatus,
        errorMessage:
            clearErrorMessage ? null : errorMessage ?? this.errorMessage,
        pinVerified: pinVerified ?? this.pinVerified,
        pinAttemptCount: pinAttemptCount ?? this.pinAttemptCount,
        pinLocked: pinLocked ?? this.pinLocked,
      );
}

/// Orchestrates the SmartCura ESP32 BLE provisioning flow.
class BleProvisioningNotifier extends StateNotifier<BleProvisioningState> {
  BleProvisioningNotifier() : super(const BleProvisioningState()) {
    _service = BleProvisioningService();
  }

  late final BleProvisioningService _service;
  StreamSubscription<ProvisioningBleDevice>? _scanSubscription;
  StreamSubscription<String>? _statusSubscription;

  /// Begin the wizard from the device-id entry step.
  void startProvisioning() {
    state =
        const BleProvisioningState(phase: ProvisioningPhase.enteringDeviceId);
  }

  /// Set the target device id from QR scan or manual entry.
  Future<void> setTargetDeviceId(String deviceId) async {
    state = state.copyWith(
      phase: ProvisioningPhase.scanning,
      targetDeviceId: deviceId.trim(),
      clearErrorMessage: true,
    );
    await _startScanning();
  }

  Future<void> _startScanning() async {
    await _scanSubscription?.cancel();
    final granted = await BleProvisioningService.requestPermissions();
    if (!granted) {
      state = state.copyWith(
        phase: ProvisioningPhase.error,
        errorMessage:
            'Bluetooth and Location permissions are required to find a '
            'SmartCura device. Please allow them in Settings and try again.',
      );
      return;
    }
    _scanSubscription =
        BleProvisioningService.scan(timeout: const Duration(seconds: 15))
            .listen(
      (candidate) {
        if (candidate.name.startsWith('SmartCura')) {
          _scanSubscription?.cancel();
          _selectDevice(candidate);
        }
      },
      onError: (Object e) {
        state = state.copyWith(
          phase: ProvisioningPhase.error,
          errorMessage: 'BLE scan failed: $e',
        );
      },
      onDone: () {
        if (state.phase == ProvisioningPhase.scanning) {
          state = state.copyWith(
            phase: ProvisioningPhase.error,
            errorMessage: 'No SmartCura device found nearby. '
                'Make sure the device is in provisioning mode '
                '(hold GPIO4 for 3 seconds).',
          );
        }
      },
    );
  }

  /// Manually select a discovered device from the scan list.
  Future<void> _selectDevice(ProvisioningBleDevice candidate) async {
    state = state.copyWith(
      phase: ProvisioningPhase.connecting,
      selectedDevice: candidate,
      clearErrorMessage: true,
    );

    try {
      final service = await _service.connect(candidate);
      state = state.copyWith(
        phase: ProvisioningPhase.verifyingDeviceId,
        discoveredService: service,
      );
      await _verifyDeviceId(service);
    } on SmartCuraBleException catch (e) {
      state = state.copyWith(
        phase: ProvisioningPhase.error,
        errorMessage: e.message,
      );
      await _service.disconnect();
    } on Exception catch (e) {
      state = state.copyWith(
        phase: ProvisioningPhase.error,
        errorMessage: 'Failed to connect: $e',
      );
      await _service.disconnect();
    }
  }

  Future<void> _verifyDeviceId(BluetoothService service) async {
    try {
      final readId = await _service.readDeviceId(service);
      state = state.copyWith(deviceIdReadFromBle: readId);

      if (readId.toLowerCase() != state.targetDeviceId?.toLowerCase()) {
        state = state.copyWith(
          phase: ProvisioningPhase.error,
          errorMessage: 'Device ID mismatch. Expected ${state.targetDeviceId}, '
              'found $readId.',
        );
        await _service.disconnect();
        return;
      }

      state = state.copyWith(
        phase: ProvisioningPhase.enteringPin,
        clearErrorMessage: true,
      );
    } on Exception catch (e) {
      state = state.copyWith(
        phase: ProvisioningPhase.error,
        errorMessage: 'Failed to read device ID: $e',
      );
      await _service.disconnect();
    }
  }

  /// Verify the PIN entered by the patient.
  Future<void> verifyPin(String pin) async {
    final service = state.discoveredService;
    if (service == null) {
      return;
    }

    state = state.copyWith(
      phase: ProvisioningPhase.verifyingPin,
      pin: pin.trim(),
      clearErrorMessage: true,
    );

    final completer = Completer<void>();
    await _statusSubscription?.cancel();

    try {
      final statusStream = await _service.statusStream(service);
      _statusSubscription = statusStream.listen(
        (status) {
          state = state.copyWith(lastStatus: status);
          if (status == 'pin_verified') {
            state = state.copyWith(
              phase: ProvisioningPhase.enteringWifi,
              pinVerified: true,
              pinAttemptCount: 0,
              pinLocked: false,
            );
            completer.complete();
          } else if (status == 'pin_invalid') {
            final attempts = state.pinAttemptCount + 1;
            state = state.copyWith(
              phase: ProvisioningPhase.enteringPin,
              pinVerified: false,
              pinAttemptCount: attempts,
              errorMessage: attempts >= 3
                  ? 'Too many incorrect attempts. '
                      'Press and hold GPIO4 for 3 seconds to reset.'
                  : 'Incorrect PIN. Attempt $attempts of 3.',
            );
            completer.complete();
          } else if (status == 'pin_locked') {
            state = state.copyWith(
              phase: ProvisioningPhase.error,
              pinLocked: true,
              errorMessage: 'PIN entry locked for 30 seconds. Try again later.',
            );
            completer.complete();
          }
        },
        onError: (Object e) {
          state = state.copyWith(
            phase: ProvisioningPhase.error,
            errorMessage: 'PIN verification failed: $e',
          );
          if (!completer.isCompleted) {
            completer.complete();
          }
        },
        onDone: () {
          if (!completer.isCompleted) {
            completer.complete();
          }
        },
      );
      await _service.verifyPin(service, pin);
      await completer.future;
    } on Exception catch (e) {
      state = state.copyWith(
        phase: ProvisioningPhase.error,
        errorMessage: 'PIN verification failed: $e',
      );
    }
  }

  /// Send Wi-Fi credentials to the ESP32.
  ///
  /// The caller must already be listening to [statusStream]; this method only
  /// performs the writes.
  ///
  /// **Reboot race.** After the ESP32 receives the password it calls
  /// `saveAndReboot()`, which notifies `credentials_saved` → `rebooting` and
  /// then calls `ESP.restart()`. The reboot tears down the GATT server before
  /// the BLE stack can deliver the write-response, so Android surfaces
  /// `GATT_ERROR` (code 133) on the password write. The credentials are
  /// already on the device at that point — the write did not fail, the
  /// acknowledgment did. This method treats a GATT_ERROR after a
  /// `credentials_saved` notification as a successful provisioning and moves
  /// the wizard into the success phase instead of the error phase.
  Future<void> sendWifiCredentials(String ssid, String password) async {
    final service = state.discoveredService;
    if (service == null) {
      return;
    }

    state = state.copyWith(
      phase: ProvisioningPhase.sendingCredentials,
      ssid: ssid.trim(),
      password: password,
      clearErrorMessage: true,
    );

    final completer = Completer<void>();
    await _statusSubscription?.cancel();

    // Track whether the ESP32 acknowledged the credentials before any GATT
    // error. If it did, the reboot race is in our favour and the wizard
    // should land on success, not error.
    bool deviceAcknowledged = false;

    try {
      final statusStream = await _service.statusStream(service);
      _statusSubscription = statusStream.listen(
        (status) {
          state = state.copyWith(lastStatus: status);
          if (status == 'credentials_saved') {
            deviceAcknowledged = true;
            state = state.copyWith(phase: ProvisioningPhase.provisioning);
          } else if (status == 'rebooting') {
            deviceAcknowledged = true;
            state = state.copyWith(
              phase: ProvisioningPhase.success,
            );
            if (!completer.isCompleted) completer.complete();
          } else if (status == 'ssid_missing') {
            state = state.copyWith(
              phase: ProvisioningPhase.error,
              errorMessage: 'SSID was not received by the device.',
            );
            if (!completer.isCompleted) completer.complete();
          }
        },
        onError: (Object e) {
          // The status stream errors when the GATT connection drops because
          // the ESP32 rebooted. If we already saw `credentials_saved`, the
          // credentials are on the device and the reboot is the expected
          // outcome — treat the stream error as success.
          if (deviceAcknowledged) {
            state = state.copyWith(phase: ProvisioningPhase.success);
            if (!completer.isCompleted) completer.complete();
            return;
          }
          state = state.copyWith(
            phase: ProvisioningPhase.error,
            errorMessage: 'Wi-Fi provisioning failed: $e',
          );
          if (!completer.isCompleted) completer.complete();
        },
        onDone: () {
          // Stream closed because the device rebooted. Same reasoning as
          // `onError`: a prior `credentials_saved` means the credentials
          // landed and the reboot is the success signal.
          if (deviceAcknowledged && !completer.isCompleted) {
            state = state.copyWith(phase: ProvisioningPhase.success);
            completer.complete();
            return;
          }
          if (!completer.isCompleted) completer.complete();
        },
      );
      try {
        await _service.sendWifiCredentials(
          service,
          ssid: ssid.trim(),
          password: password,
        );
        // Write returned without throwing. The completer will be resolved by
        // the status listener when `rebooting` arrives.
        if (!completer.isCompleted) await completer.future;
      } on FlutterBluePlusException catch (e) {
        // The password write frequently raises GATT_ERROR (code 133) because
        // the ESP32 reboots mid-ack. If we already saw the device acknowledge
        // the credentials, this is the expected race, not a failure.
        if (deviceAcknowledged) {
          state = state.copyWith(phase: ProvisioningPhase.success);
          if (!completer.isCompleted) completer.complete();
          return;
        }
        state = state.copyWith(
          phase: ProvisioningPhase.error,
          errorMessage: 'Wi-Fi provisioning failed: $e',
        );
        if (!completer.isCompleted) completer.complete();
      }
    } on Exception catch (e) {
      if (deviceAcknowledged) {
        state = state.copyWith(phase: ProvisioningPhase.success);
        return;
      }
      state = state.copyWith(
        phase: ProvisioningPhase.error,
        errorMessage: 'Wi-Fi provisioning failed: $e',
      );
    }
  }

  /// Reset to the initial step so the patient can retry.
  void reset() {
    _scanSubscription?.cancel();
    _statusSubscription?.cancel();
    _service.disconnect();
    state = const BleProvisioningState();
  }

  /// Move back to the previous step from error/pin states.
  void goBackToEnteringPin() {
    state = state.copyWith(
      phase: ProvisioningPhase.enteringPin,
      clearErrorMessage: true,
    );
  }

  @override
  void dispose() {
    _scanSubscription?.cancel();
    _statusSubscription?.cancel();
    _service.disconnect();
    super.dispose();
  }
}

final bleProvisioningProvider =
    StateNotifierProvider<BleProvisioningNotifier, BleProvisioningState>(
  (ref) => BleProvisioningNotifier(),
);
