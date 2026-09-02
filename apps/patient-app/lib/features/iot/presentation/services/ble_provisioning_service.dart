import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:permission_handler/permission_handler.dart';

/// SmartCura BLE provisioning service constants.
///
/// These match the values programmed into the ESP32 firmware in
/// `iot-firmware/smartcura_vitals_monitor/ble_provisioning.h`.
class SmartCuraBleUuids {
  SmartCuraBleUuids._();

  static const String provisioningService =
      '5c40a76e-8749-4df4-909b-b0e812ea8554';
  static const String deviceId = 'ab8ea1c7-88be-4413-91c8-e6553b5ab52e';
  static const String pinVerify = 'f973817e-61dc-4c80-a927-0448bf543acd';
  static const String wifiSsid = '3190b9cd-77de-4707-be59-689c5e82639a';
  static const String wifiPassword = '6f7d24de-a412-4daa-8afd-fb38d6ffb045';
  static const String status = '657bd447-0431-4946-a11b-09e66f8a9a30';
  static const String command = 'e36d4e43-3b24-4083-9837-17b0dae3ceb0';
}

/// A discovered SmartCura BLE peripheral during provisioning scan.
class ProvisioningBleDevice {
  const ProvisioningBleDevice({
    required this.remoteId,
    required this.name,
    required this.rssi,
    required this.device,
  });

  final String remoteId;
  final String name;
  final int rssi;
  final BluetoothDevice device;
}

/// Low-level BLE operations for SmartCura ESP32 provisioning.
///
/// This class is intentionally stateless except for the currently connected
/// device and the active status-notification subscription. All methods are
/// async and should be driven by a Riverpod notifier that keeps the UI in sync.
class BleProvisioningService {
  BluetoothDevice? _connectedDevice;
  StreamSubscription<String>? _statusSubscription;
  BluetoothCharacteristic? _statusCharacteristic;
  StreamController<String>? _statusController;

  /// Request all permissions required for BLE scanning and connection.
  static Future<bool> requestPermissions() async {
    final statuses = await [
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
      Permission.location,
    ].request();
    return statuses.values.every((s) => s.isGranted);
  }

  /// Start a BLE scan for SmartCura peripherals.
  ///
  /// Returns a stream of [ProvisioningBleDevice] candidates. The caller can
  /// listen for a fixed duration or until a specific device appears.
  static Stream<ProvisioningBleDevice> scan({Duration? timeout}) {
    FlutterBluePlus.startScan(
      withServices: [],
      timeout: timeout ?? const Duration(seconds: 10),
    );
    return FlutterBluePlus.scanResults.expand((results) => results).map(
          (r) => ProvisioningBleDevice(
            remoteId: r.device.remoteId.str,
            name: r.advertisementData.advName.isNotEmpty
                ? r.advertisementData.advName
                : r.device.platformName,
            rssi: r.rssi,
            device: r.device,
          ),
        );
  }

  static Future<void> stopScan() => FlutterBluePlus.stopScan();

  /// Connect to a selected device and discover the SmartCura service.
  Future<BluetoothService> connect(ProvisioningBleDevice candidate) async {
    await stopScan();
    final device = candidate.device;
    await device.connect(license: License.nonprofit);
    _connectedDevice = device;

    final services = await device.discoverServices();
    final service = services.firstWhere(
      (s) =>
          s.uuid.str128.toLowerCase() ==
          SmartCuraBleUuids.provisioningService.toLowerCase(),
      orElse: () => throw const SmartCuraBleException(
        'SmartCura provisioning service not found',
      ),
    );
    return service;
  }

  /// Read the device-id characteristic and return the UUID string.
  Future<String> readDeviceId(BluetoothService service) async {
    final char = _findCharacteristic(service, SmartCuraBleUuids.deviceId);
    final bytes = await char.read();
    return _utf8(bytes).trim();
  }

  /// Returns a broadcast stream of status notifications from the device.
  ///
  /// The stream is created once per connection and remains active until
  /// [disconnect] is called. Callers must subscribe before issuing any write
  /// that produces a status notification (e.g. PIN verification), otherwise a
  /// fast response such as `pin_verified` can be missed.
  Future<Stream<String>> statusStream(BluetoothService service) async {
    if (_statusController != null) return _statusController!.stream;

    _statusCharacteristic ??= _findCharacteristic(
      service,
      SmartCuraBleUuids.status,
    );

    await _statusCharacteristic!.setNotifyValue(true);

    _statusController = StreamController<String>.broadcast();
    _statusSubscription = _statusCharacteristic!.onValueReceived
        .map(_utf8)
        .where((s) => s.isNotEmpty)
        .listen(
      (status) {
        if (kDebugMode) {
          // ignore: avoid_print
          print('[BLE-STATUS] $status');
        }
        _statusController!.add(status);
      },
      onError: (Object e) => _statusController!.addError(e),
      onDone: () => _statusController!.close(),
    );

    return _statusController!.stream;
  }

  /// Verify the provisioning PIN.
  ///
  /// The caller must already be listening to [statusStream]; this method only
  /// performs the write.
  Future<void> verifyPin(BluetoothService service, String pin) async {
    final char = _findCharacteristic(service, SmartCuraBleUuids.pinVerify);
    await char.write(utf8.encode(pin.trim()));
  }

  /// Send the Wi-Fi SSID and password.
  ///
  /// The caller must already be listening to [statusStream]; this method only
  /// performs the writes.
  Future<void> sendWifiCredentials(
    BluetoothService service, {
    required String ssid,
    required String password,
  }) async {
    final ssidChar = _findCharacteristic(service, SmartCuraBleUuids.wifiSsid);
    final passwordChar =
        _findCharacteristic(service, SmartCuraBleUuids.wifiPassword);

    await ssidChar.write(utf8.encode(ssid.trim()));
    await passwordChar.write(utf8.encode(password));
  }

  BluetoothCharacteristic _findCharacteristic(
    BluetoothService service,
    String uuid,
  ) =>
      service.characteristics.firstWhere(
        (c) => c.uuid.str128.toLowerCase() == uuid.toLowerCase(),
        orElse: () => throw SmartCuraBleException(
          'Characteristic ${uuid.toLowerCase()} not found',
        ),
      );

  /// Disconnect and clean up subscriptions.
  Future<void> disconnect() async {
    await _statusSubscription?.cancel();
    _statusSubscription = null;
    await _statusController?.close();
    _statusController = null;
    _statusCharacteristic = null;
    if (_connectedDevice != null) {
      await _connectedDevice!.disconnect();
      _connectedDevice = null;
    }
  }

  static String _utf8(List<int> bytes) {
    try {
      return utf8
          .decode(bytes, allowMalformed: true)
          .replaceAll('\x00', '')
          .trim();
    } on Exception catch (_) {
      return '';
    }
  }
}

class SmartCuraBleException implements Exception {
  const SmartCuraBleException(this.message);

  final String message;

  @override
  String toString() => message;
}
