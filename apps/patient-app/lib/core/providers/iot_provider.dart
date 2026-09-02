import 'dart:async';
import 'dart:convert';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:smartcura_contracts/smartcura_contracts.dart';

import '../auth/auth_provider.dart';
import '../network/api_client.dart';
import '../network/api_endpoints.dart';
import '../network/api_error.dart';

// Replaces: lib/core/providers/iot_data_provider.dart (IoTDataProvider, IoTDataState)

// ---------------------------------------------------------------------------
// Firmware advertisement contract
// ---------------------------------------------------------------------------
//
// The ESP32 firmware (iot-firmware/smartcura_vitals_monitor) publishes vitals
// over MQTT-over-WebSocket and does NOT advertise a BLE service or name — it
// disables the BT controller for power. There is therefore no single BLE
// service UUID we can scan for to identify a SmartCura device. Instead we scan
// for *all* connectable BLE peripherals and surface the ones whose advertised
// name looks SmartCura-compatible first, using the keywords below. A real
// SmartCura peripheral is expected to advertise a name starting with
// "SmartCura" (matching the firmware banner). Generic BLE health peripherals
// (pulse oximeters, thermometers, BP cuffs) are still listed so a patient can
// pair them, just below the SmartCura-branded ones.

/// Name substrings that mark a scan result as a SmartCura-compatible device.
/// A name containing any of these (case-insensitive) is sorted to the top and
/// flagged as compatible. The first entry matches the firmware's own banner
/// ("SmartCura Vitals Monitor") and the product naming convention.
const smartcuraNameKeywords = <String>[
  'smartcura',
  'vitals monitor',
  'pulse ox',
  'spo2',
  'thermometer',
  'ecg',
  'heart rate',
];

/// Standard BLE Generic Access Service (0x1800) and Device Name characteristic
/// (0x2A00). Used to read a connected device's stable name / serial.
final Guid _gapServiceUuid = Guid('00001800-0000-1000-8000-00805f9b34fb');
final Guid _deviceNameCharacteristicUuid =
    Guid('00002a00-0000-1000-8000-00805f9b34fb');

/// Device Information Service (0x180A) — manufacturer name (0x2A29), model
/// number (0x2A24), serial number (0x2A25), firmware revision (0x2A26),
/// hardware revision (0x2A27). Used to extract a serial number for backend
/// registration.
final Guid _disServiceUuid = Guid('0000180a-0000-1000-8000-00805f9b34fb');
final Guid _serialNumberCharacteristicUuid =
    Guid('00002a25-0000-1000-8000-00805f9b34fb');
final Guid _modelNumberCharacteristicUuid =
    Guid('00002a24-0000-1000-8000-00805f9b34fb');
final Guid _firmwareRevisionCharacteristicUuid =
    Guid('00002a26-0000-1000-8000-00805f9b34fb');
final Guid _hardwareRevisionCharacteristicUuid =
    Guid('00002a27-0000-1000-8000-00805f9b34fb');
final Guid _manufacturerNameCharacteristicUuid =
    Guid('00002a29-0000-1000-8000-00805f9b34fb');

// ---------------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------------

/// Decode a single device using the generated contract decoder.
///
/// The backend's `serializeDevice` is the source of truth for the wire shape.
/// A hand-written mapper in this file previously drifted from that shape, so
/// we now delegate directly to the generated [Device.fromJson].
Device _deviceFromJson(Map<String, dynamic> j) =>
    Device.fromJson(j as Map<String, Object?>);

/// Decode a paginated device list using the generated contract decoder.
List<Device> _deviceListFromJson(Map<String, dynamic> j) =>
    DeviceListResponse.fromJson(j as Map<String, Object?>).data;

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

/// All IoT devices for the patient's organization.
/// Backend: GET /organizations/{orgId}/devices
/// The org id comes from the current membership (see auth_provider).
final devicesProvider = FutureProvider<List<Device>>((ref) async {
  final orgId = ref.watch(currentOrganizationIdProvider);
  if (orgId == null) return [];
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.orgDevices(orgId));
  return _deviceListFromJson(response.data as Map<String, dynamic>);
});

/// Devices assigned to the current patient (self-scoped).
/// Backend: GET /profiles/me/devices
final myDevicesProvider = FutureProvider<List<Device>>((ref) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio.get(ApiEndpoints.profilesMeDevices);
  return _deviceListFromJson(response.data as Map<String, dynamic>);
});

/// A single device by id.
/// Backend: GET /organizations/{orgId}/devices/{deviceId}
final deviceDetailProvider =
    FutureProvider.family<Device, ({String orgId, String deviceId})>(
        (ref, params) async {
  final dio = ref.watch(apiClientProvider);
  final response =
      await dio.get(ApiEndpoints.device(params.orgId, params.deviceId));
  return _deviceFromJson(response.data as Map<String, dynamic>);
});

/// A single device assigned to the current patient (self-scoped read-one).
/// Backend: GET /profiles/me/devices/{deviceId}
final patientDeviceDetailProvider = FutureProvider.family<Device, String>(
  (ref, deviceId) async {
    final dio = ref.watch(apiClientProvider);
    final response = await dio.get(ApiEndpoints.profilesMeDevice(deviceId));
    return _deviceFromJson(response.data as Map<String, dynamic>);
  },
);

/// Vital readings for one of the patient's own devices (self-scoped).
/// Backend: GET /profiles/me/devices/{deviceId}/vital-readings
final patientDeviceReadingsProvider =
    FutureProvider.family<List<VitalReading>, String>(
  (ref, deviceId) async {
    final dio = ref.watch(apiClientProvider);
    final response =
        await dio.get(ApiEndpoints.profilesMeDeviceVitalReadings(deviceId));
    return VitalReadingListResponse.fromJson(
            response.data as Map<String, Object?>)
        .data;
  },
);

/// Vital readings for a specific device.
/// Backend: GET /organizations/{orgId}/devices/{deviceId}/vital-readings
final deviceReadingsProvider = FutureProvider.family<List<VitalReading>,
    ({String orgId, String deviceId})>((ref, params) async {
  final dio = ref.watch(apiClientProvider);
  final response = await dio
      .get(ApiEndpoints.deviceVitalReadings(params.orgId, params.deviceId));
  return VitalReadingListResponse.fromJson(
          response.data as Map<String, Object?>)
      .data;
});

// ---------------------------------------------------------------------------
// BLE scan model & notifier
// ---------------------------------------------------------------------------

/// A BLE peripheral discovered by [DeviceScanNotifier.startScanning].
///
/// This is the scan-time representation: the device has not yet been connected
/// to or registered with the backend. The [remoteId] is the platform device
/// id (MAC on Android, UUID on Apple). [isSmartCura] is true when the
/// advertised name matches a [smartcuraNameKeywords] entry, which the UI uses
/// to sort compatible devices to the top.
class ScannedDevice {
  final String remoteId;
  final String name;
  final int rssi;
  final bool connectable;
  final bool isSmartCura;

  const ScannedDevice({
    required this.remoteId,
    required this.name,
    required this.rssi,
    required this.connectable,
    required this.isSmartCura,
  });

  /// A short label for the UI: the advertised name if present, otherwise the
  /// platform id so the row is never blank.
  String get displayName => name.isNotEmpty ? name : 'Unknown Device';

  ScannedDevice copyWith({
    String? name,
    int? rssi,
    bool? connectable,
    bool? isSmartCura,
  }) =>
      ScannedDevice(
        remoteId: remoteId,
        name: name ?? this.name,
        rssi: rssi ?? this.rssi,
        connectable: connectable ?? this.connectable,
        isSmartCura: isSmartCura ?? this.isSmartCura,
      );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is ScannedDevice && remoteId == other.remoteId;

  @override
  int get hashCode => remoteId.hashCode;

  @override
  String toString() =>
      'ScannedDevice(remoteId: $remoteId, name: $name, rssi: $rssi, '
      'connectable: $connectable, isSmartCura: $isSmartCura)';
}

/// Information read from a connected device's GATT services (Device
/// Information Service 0x180A + GAP 0x1800). Used to derive a serial number
/// and hardware/firmware revisions for backend registration.
class _DeviceInfo {
  final String? serialNumber;
  final String? modelNumber;
  final String? manufacturerName;
  final String? hardwareRevision;
  final String? firmwareRevision;

  const _DeviceInfo({
    this.serialNumber,
    this.modelNumber,
    this.manufacturerName,
    this.hardwareRevision,
    this.firmwareRevision,
  });
}

/// Whether a BLE adapter problem is fixable by the user (bluetooth off) or a
/// hard failure (unsupported hardware / permission denied). Drives the UI's
/// retry-vs-settings branch.
enum BleAvailability { available, bluetoothOff, unauthorized, unsupported }

/// Lifecycle of a device-pairing attempt. Surfaces progress to the UI so the
/// "Establishing Connection" screen can show real step state instead of a
/// fixed animation.
class PairingProgress {
  final String step;
  final String? detail;

  const PairingProgress(this.step, [this.detail]);

  @override
  String toString() =>
      'PairingProgress($step${detail != null ? ': $detail' : ''})';
}

/// The phase a single pairing operation is in.
enum PairingPhase {
  idle,
  connecting,
  discovering,
  registering,
  assigning,
  done,
  failed
}

/// State of the BLE scan + pairing flow.
class DeviceScanState {
  final bool isScanning;
  final BleAvailability availability;
  final String? error;

  /// Scan results keyed by remote id so streaming updates replace in place
  /// rather than duplicating. Exposed as a sorted list via [sortedResults].
  final Map<String, ScannedDevice> results;

  /// Current pairing operation, if any.
  final PairingPhase pairingPhase;
  final String? pairingRemoteId;
  final PairingProgress? pairingProgress;
  final Device? pairedDevice;
  final String? pairingError;

  const DeviceScanState({
    this.isScanning = false,
    this.availability = BleAvailability.available,
    this.error,
    this.results = const {},
    this.pairingPhase = PairingPhase.idle,
    this.pairingRemoteId,
    this.pairingProgress,
    this.pairedDevice,
    this.pairingError,
  });

  /// Results sorted SmartCura-compatible first, then by signal strength
  /// (strongest RSSI first — closest device is most relevant).
  List<ScannedDevice> get sortedResults {
    final list = results.values.toList();
    list.sort((a, b) {
      // SmartCura-compatible devices always come first.
      if (a.isSmartCura != b.isSmartCura) {
        return a.isSmartCura ? -1 : 1;
      }
      // Within the same compatibility tier, stronger signal (higher RSSI)
      // comes first. RSSI is negative, so higher = closer.
      return b.rssi.compareTo(a.rssi);
    });
    return list;
  }

  bool get hasResults => results.isNotEmpty;

  DeviceScanState copyWith({
    bool? isScanning,
    BleAvailability? availability,
    String? error,
    Map<String, ScannedDevice>? results,
    PairingPhase? pairingPhase,
    String? pairingRemoteId,
    PairingProgress? pairingProgress,
    Device? pairedDevice,
    String? pairingError,
    bool clearError = false,
    bool clearPairingError = false,
    bool clearPairedDevice = false,
    bool clearPairingProgress = false,
  }) =>
      DeviceScanState(
        isScanning: isScanning ?? this.isScanning,
        availability: availability ?? this.availability,
        error: clearError ? null : (error ?? this.error),
        results: results ?? this.results,
        pairingPhase: pairingPhase ?? this.pairingPhase,
        pairingRemoteId: pairingRemoteId ?? this.pairingRemoteId,
        pairingProgress: clearPairingProgress
            ? null
            : (pairingProgress ?? this.pairingProgress),
        pairedDevice:
            clearPairedDevice ? null : (pairedDevice ?? this.pairedDevice),
        pairingError:
            clearPairingError ? null : (pairingError ?? this.pairingError),
      );
}

/// Drives BLE scanning and device pairing.
///
/// Scanning subscribes to `FlutterBluePlus.scanResults`, which re-emits the
/// full accumulated result list on every advertisement, so we rebuild the
/// [DeviceScanState.results] map on each event and the UI streams updates.
/// The subscription is cancelled on [stopScanning] / [dispose].
///
/// Pairing connects to the selected peripheral, discovers its GATT services,
/// reads the Device Information Service for a serial number, then registers
/// the device with the backend (POST /organizations/{org}/devices) and
/// assigns it to the current patient (POST .../assignments). Both calls need
/// a current MFA step-up on the server; a 403 STEP_UP_REQUIRED surfaces as a
/// [pairingError] so the UI can prompt for re-authentication.
final deviceScanStateProvider =
    StateNotifierProvider<DeviceScanNotifier, DeviceScanState>((ref) {
  return DeviceScanNotifier(ref);
});

class DeviceScanNotifier extends StateNotifier<DeviceScanState> {
  final Ref _ref;
  StreamSubscription<List<ScanResult>>? _scanSub;
  StreamSubscription<BluetoothAdapterState>? _adapterSub;
  // Track the BluetoothDevice object for the in-progress pairing so we can
  // disconnect on cancel/failure.
  BluetoothDevice? _pairingDevice;

  DeviceScanNotifier(this._ref) : super(const DeviceScanState());

  /// The device type chosen in the pairing wizard step 1. Defaults to a
  /// vitals monitor (the ESP32 firmware's product) and is set by the UI before
  /// pairing starts.
  DeviceType selectedDeviceType = DeviceType.vitalsMonitor;

  // -------------------------------------------------------------------------
  // Scanning
  // -------------------------------------------------------------------------

  /// Start a real BLE scan.
  ///
  /// Checks adapter availability first (bluetooth off / permission denied /
  /// unsupported hardware each produce a distinct [BleAvailability] so the UI
  /// can show the right message). Then starts an unfiltered scan and streams
  /// results into state. The scan auto-stops after [timeout] (default 10s) so
  /// it cannot run forever if the user navigates away.
  Future<void> startScanning(
      {Duration timeout = const Duration(seconds: 10)}) async {
    // Reset results and any prior error, but keep the scanning flag false
    // until we know the adapter is usable.
    state = const DeviceScanState().copyWith(
      results: const {},
      clearError: true,
    );

    // 1. Is BLE supported on this hardware at all?
    try {
      final supported = await FlutterBluePlus.isSupported;
      if (!supported) {
        state = state.copyWith(
          availability: BleAvailability.unsupported,
          error: 'Bluetooth Low Energy is not supported on this device.',
        );
        return;
      }
    } catch (e) {
      // isSupported can throw on platforms without a native plugin.
      state = state.copyWith(
        availability: BleAvailability.unsupported,
        error: 'Bluetooth is not available: $e',
      );
      return;
    }

    // 2. Is the adapter on? `adapterState` is a stream that yields the current
    //    state immediately, so `.first` gives us the live value.
    BluetoothAdapterState adapterStateNow;
    try {
      adapterStateNow = await FlutterBluePlus.adapterState.first;
    } catch (e) {
      state = state.copyWith(
        availability: BleAvailability.unsupported,
        error: 'Could not read Bluetooth state: $e',
      );
      return;
    }

    final availability = _availabilityFromAdapter(adapterStateNow);
    if (availability != BleAvailability.available) {
      state = state.copyWith(
        availability: availability,
        error: _availabilityMessage(availability),
      );
      // Keep listening so a later "bluetooth on" event can be surfaced, but
      // do not start a scan.
      _listenAdapter();
      return;
    }

    state = state.copyWith(
      isScanning: true,
      availability: BleAvailability.available,
      clearError: true,
    );

    // 3. Subscribe to results BEFORE starting the scan so we never miss the
    //    first advertisement.
    await _scanSub?.cancel();
    _scanSub = FlutterBluePlus.scanResults.listen(
      _onScanResults,
      onError: _onScanError,
    );

    // Also track adapter changes mid-scan (user turns bluetooth off).
    _listenAdapter();

    try {
      await FlutterBluePlus.startScan(
        timeout: timeout,
        androidScanMode: AndroidScanMode.lowLatency,
        // We deliberately do NOT pass withServices/withNames: the firmware
        // advertises no known service UUID, so a filter would hide it. We
        // sort SmartCura-named devices to the top in the UI instead.
      );
    } catch (e) {
      // A startScan failure is usually a permission problem on Android.
      state = state.copyWith(
        isScanning: false,
        availability: BleAvailability.unauthorized,
        error: _friendlyBleError(e, 'start the scan'),
      );
      await _cancelSubs();
    }
  }

  void _onScanResults(List<ScanResult> results) {
    if (!mounted) return;
    final map = Map<String, ScannedDevice>.from(state.results);
    for (final r in results) {
      final remoteId = r.device.remoteId.str;
      final name = r.advertisementData.advName;
      // Skip empty entries that have no name AND a terrible signal — these are
      // usually transient noise. Keep anything with a name regardless of RSSI.
      if (name.isEmpty && r.rssi < -90) continue;
      map[remoteId] = ScannedDevice(
        remoteId: remoteId,
        name: name,
        rssi: r.rssi,
        connectable: r.advertisementData.connectable,
        isSmartCura: _isSmartCuraName(name),
      );
    }
    state = state.copyWith(results: map);
  }

  void _onScanError(Object error, StackTrace stackTrace) {
    if (!mounted) return;
    state = state.copyWith(
      isScanning: false,
      error: _friendlyBleError(error, 'scan for devices'),
    );
  }

  /// Stop an in-progress scan. Safe to call when not scanning.
  Future<void> stopScanning() async {
    try {
      if (FlutterBluePlus.isScanningNow) {
        await FlutterBluePlus.stopScan();
      }
    } catch (_) {
      // Best-effort; never let a stop failure block the UI.
    }
    await _scanSub?.cancel();
    _scanSub = null;
    if (mounted) {
      state = state.copyWith(isScanning: false);
    }
  }

  // -------------------------------------------------------------------------
  // Pairing
  // -------------------------------------------------------------------------

  /// Pair with the scanned device identified by [remoteId].
  ///
  /// Steps (each updates [DeviceScanState.pairingPhase] so the UI can show
  /// real progress):
  ///   1. connect — establish a GATT connection
  ///   2. discover — enumerate services + characteristics
  ///   3. register — POST /organizations/{org}/devices (idempotent)
  ///   4. assign  — POST .../assignments to the current patient
  ///
  /// On failure the device is disconnected and [pairingError] is set; the UI
  /// can offer a retry. On success [pairedDevice] holds the registered Device
  /// and the devices providers are invalidated so the management list refreshes.
  Future<void> pairDevice(String remoteId) async {
    final scanned = state.results[remoteId];
    if (scanned == null) {
      state = state.copyWith(
        pairingPhase: PairingPhase.failed,
        pairingError: 'That device is no longer visible. Please scan again.',
      );
      return;
    }

    final orgId = _ref.read(currentOrganizationIdProvider);
    if (orgId == null) {
      state = state.copyWith(
        pairingPhase: PairingPhase.failed,
        pairingError: 'You are not a member of an organization yet.',
      );
      return;
    }

    final device = BluetoothDevice.fromId(remoteId);
    _pairingDevice = device;

    state = state.copyWith(
      pairingPhase: PairingPhase.connecting,
      pairingRemoteId: remoteId,
      pairingProgress:
          const PairingProgress('Connecting', 'Establishing link…'),
      clearPairingError: true,
      clearPairedDevice: true,
    );

    try {
      // 1. Connect (the License enum is required by the plugin API).
      await device.connect(
        license: License.nonprofit,
        timeout: const Duration(seconds: 20),
      );

      if (!device.isConnected) {
        throw FlutterBluePlusException(ErrorPlatform.fbp, 'connect',
            FbpErrorCode.deviceIsDisconnected.index, 'device did not connect');
      }

      // 2. Discover services and read the Device Information Service for a
      //    serial number + revisions.
      state = state.copyWith(
        pairingPhase: PairingPhase.discovering,
        pairingProgress:
            const PairingProgress('Discovering', 'Reading device info…'),
      );

      final services = await device.discoverServices();
      final info = await _readDeviceInformation(services);

      // Derive a serial number. Prefer the DIS serial-number characteristic;
      // fall back to the platform remote id (MAC/UUID), which is stable per
      // device and unique within the organization.
      final serialNumber =
          info.serialNumber?.isNotEmpty == true ? info.serialNumber! : remoteId;

      // 3. Register with the backend.
      state = state.copyWith(
        pairingPhase: PairingPhase.registering,
        pairingProgress:
            const PairingProgress('Registering', 'Provisioning with backend…'),
      );

      final registered = await _registerDevice(
        orgId: orgId,
        serialNumber: serialNumber,
        hardwareRevision: info.hardwareRevision,
        firmwareRevision: info.firmwareRevision,
      );

      // 4. Assign to the current patient (self-scoped profile id).
      final profileId = _ref.read(currentProfileProvider)?.id;
      if (profileId != null) {
        state = state.copyWith(
          pairingPhase: PairingPhase.assigning,
          pairingProgress:
              const PairingProgress('Assigning', 'Linking to your profile…'),
        );
        await _assignDevice(
          orgId: orgId,
          deviceId: registered.id,
          patientProfileId: profileId,
          expectedVersion: registered.version,
        );
      }

      state = state.copyWith(
        pairingPhase: PairingPhase.done,
        pairingProgress:
            const PairingProgress('Done', 'Device paired successfully.'),
        pairedDevice: registered,
      );

      // Refresh the device lists so the new device appears immediately.
      _ref.invalidate(devicesProvider);
      _ref.invalidate(myDevicesProvider);
    } catch (e) {
      state = state.copyWith(
        pairingPhase: PairingPhase.failed,
        pairingError: _friendlyBleError(e, 'pair the device'),
      );
    } finally {
      // Always disconnect the GATT connection after pairing — the device
      // communicates over MQTT, not BLE, so holding the connection would
      // only drain battery. A failed pairing must also release the link.
      try {
        if (device.isConnected) {
          await device.disconnect();
        }
      } catch (_) {
        // Best-effort cleanup.
      }
      _pairingDevice = null;
    }
  }

  /// Cancel an in-progress pairing: disconnect and reset to idle.
  Future<void> cancelPairing() async {
    try {
      if (_pairingDevice != null && _pairingDevice!.isConnected) {
        await _pairingDevice!.disconnect();
      }
    } catch (_) {
      // Best-effort.
    }
    _pairingDevice = null;
    if (mounted) {
      state = state.copyWith(
        pairingPhase: PairingPhase.idle,
        clearPairingProgress: true,
        clearPairingError: true,
        clearPairedDevice: true,
        pairingRemoteId: null,
      );
    }
  }

  /// Reset pairing state to idle after the UI has shown success/failure.
  void resetPairing() {
    state = state.copyWith(
      pairingPhase: PairingPhase.idle,
      pairingRemoteId: null,
      clearPairingProgress: true,
      clearPairingError: true,
      clearPairedDevice: true,
    );
  }

  // -------------------------------------------------------------------------
  // Backend registration helpers
  // -------------------------------------------------------------------------

  Future<Device> _registerDevice({
    required String orgId,
    required String serialNumber,
    String? hardwareRevision,
    String? firmwareRevision,
  }) async {
    final dio = _ref.read(apiClientProvider);
    // The provisioning secret is a per-device credential the operator sets at
    // provisioning time. For a patient-driven pairing flow we derive a stable
    // secret from the device's remote id so the same hardware re-pairs to the
    // same backend record (the Idempotency-Key + serial-number uniqueness
    // makes the registration idempotent). This mirrors how the firmware's
    // secrets.h carries a DEVICE_ID + MQTT_PASSWORD pair.
    final provisioningSecret =
        'sc-${serialNumber.replaceAll(RegExp(r'[^a-zA-Z0-9]'), '')}';

    final body = <String, dynamic>{
      'device_type': selectedDeviceType.wireValue,
      'serial_number': serialNumber,
      'credential_type': DeviceCredentialType.mqttPassword.wireValue,
      'provisioning_secret': provisioningSecret,
      if (hardwareRevision != null) 'hardware_revision': hardwareRevision,
      if (firmwareRevision != null) 'firmware_version': firmwareRevision,
    };

    final response = await dio.post(ApiEndpoints.orgDevices(orgId), data: body);
    return _deviceFromJson(response.data as Map<String, dynamic>);
  }

  Future<void> _assignDevice({
    required String orgId,
    required String deviceId,
    required String patientProfileId,
    required int expectedVersion,
  }) async {
    final dio = _ref.read(apiClientProvider);
    final body = <String, dynamic>{
      'patient_profile_id': patientProfileId,
      'expected_version': expectedVersion,
    };
    // POST .../assignments returns 200 with the updated Device.
    await dio.post(
      '${ApiEndpoints.device(orgId, deviceId)}/assignments',
      data: body,
    );
  }

  // -------------------------------------------------------------------------
  // Device information extraction
  // -------------------------------------------------------------------------

  /// Walk the discovered services and read the standard Device Information
  /// Service (0x180A) characteristics. Any read failure is swallowed — we
  /// fall back to the remote id as a serial, so a missing DIS is non-fatal.
  Future<_DeviceInfo> _readDeviceInformation(
      List<BluetoothService> services) async {
    String? serial;
    String? model;
    String? manufacturer;
    String? hwRev;
    String? fwRev;

    for (final service in services) {
      if (service.uuid == _disServiceUuid) {
        for (final c in service.characteristics) {
          try {
            if (c.uuid == _serialNumberCharacteristicUuid) {
              serial = await _decodeAsync(c.read());
            } else if (c.uuid == _modelNumberCharacteristicUuid) {
              model = await _decodeAsync(c.read());
            } else if (c.uuid == _manufacturerNameCharacteristicUuid) {
              manufacturer = await _decodeAsync(c.read());
            } else if (c.uuid == _hardwareRevisionCharacteristicUuid) {
              hwRev = await _decodeAsync(c.read());
            } else if (c.uuid == _firmwareRevisionCharacteristicUuid) {
              fwRev = await _decodeAsync(c.read());
            }
          } catch (e) {
            // A characteristic read can fail if it is not readable; skip it.
            if (kDebugMode) {
              debugPrint('[BLE] DIS characteristic read failed: $e');
            }
          }
        }
      } else if (service.uuid == _gapServiceUuid) {
        // Fall back to the GAP Device Name if DIS serial is absent.
        for (final c in service.characteristics) {
          if (c.uuid == _deviceNameCharacteristicUuid) {
            try {
              final name = await _decodeAsync(c.read());
              serial ??= name;
            } catch (_) {
              // non-fatal
            }
          }
        }
      }
    }

    return _DeviceInfo(
      serialNumber: serial,
      modelNumber: model,
      manufacturerName: manufacturer,
      hardwareRevision: hwRev,
      firmwareRevision: fwRev,
    );
  }

  /// Decode a BLE byte list to a trimmed UTF-8 string.
  Future<String> _decodeAsync(Future<List<int>> future) async {
    final bytes = await future;
    return utf8.decode(bytes).trim();
  }

  // -------------------------------------------------------------------------
  // Adapter tracking
  // -------------------------------------------------------------------------

  void _listenAdapter() {
    _adapterSub ??= FlutterBluePlus.adapterState.listen((s) {
      if (!mounted) return;
      final availability = _availabilityFromAdapter(s);
      // If bluetooth turned off mid-scan, stop and surface the state.
      if (availability != BleAvailability.available && state.isScanning) {
        stopScanning();
        state = state.copyWith(
          availability: availability,
          error: _availabilityMessage(availability),
        );
      } else if (availability != state.availability) {
        state = state.copyWith(availability: availability);
      }
    });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  BleAvailability _availabilityFromAdapter(BluetoothAdapterState s) {
    switch (s) {
      case BluetoothAdapterState.on:
        return BleAvailability.available;
      case BluetoothAdapterState.off:
      case BluetoothAdapterState.turningOff:
      case BluetoothAdapterState.turningOn:
        return BleAvailability.bluetoothOff;
      case BluetoothAdapterState.unauthorized:
        return BleAvailability.unauthorized;
      case BluetoothAdapterState.unavailable:
      case BluetoothAdapterState.unknown:
        return BleAvailability.unsupported;
    }
  }

  String _availabilityMessage(BleAvailability a) {
    switch (a) {
      case BleAvailability.available:
        return '';
      case BleAvailability.bluetoothOff:
        return 'Bluetooth is turned off. Turn it on to scan for devices.';
      case BleAvailability.unauthorized:
        return 'Bluetooth permission was denied. Grant it in Settings to scan.';
      case BleAvailability.unsupported:
        return 'Bluetooth Low Energy is not supported on this device.';
    }
  }

  bool _isSmartCuraName(String name) {
    if (name.isEmpty) return false;
    final lower = name.toLowerCase();
    return smartcuraNameKeywords.any((k) => lower.contains(k));
  }

  /// Turn a raw BLE/plugin error into a user-facing message. The plugin throws
  /// `FlutterBluePlusException` for adapter/permission problems; the Dio layer
  /// throws `DioException` wrapping an `ApiError` for backend failures.
  String _friendlyBleError(Object error, String action) {
    if (error is FlutterBluePlusException) {
      // adapterIsOff / userRejected / permission-style codes.
      if (error.code == FbpErrorCode.adapterIsOff.index) {
        return 'Bluetooth is turned off. Turn it on to $action.';
      }
      if (error.code == FbpErrorCode.userRejected.index) {
        return 'The request to $action was rejected.';
      }
      return error.description?.isNotEmpty == true
          ? 'Could not $action: ${error.description}'
          : 'Could not $action. Please try again.';
    }
    if (error is DioException) {
      final apiError = error.error;
      if (apiError is ApiError) {
        if (apiError.needsStepUp) {
          return 'Re-authentication is required before pairing a device. '
              'Please verify your identity and try again.';
        }
        return apiError.userMessage;
      }
      return apiError?.toString() ??
          'The SmartCura server could not be reached.';
    }
    return 'Could not $action: $error';
  }

  Future<void> _cancelSubs() async {
    await _scanSub?.cancel();
    _scanSub = null;
  }

  @override
  void dispose() {
    _cancelSubs();
    _adapterSub?.cancel();
    _adapterSub = null;
    // Best-effort: stop any running scan when the notifier is destroyed.
    FlutterBluePlus.stopScan().catchError((_) {});
    super.dispose();
  }
}
