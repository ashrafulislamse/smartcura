class IoTDevice {
  final String id;
  final String name;
  final String type;
  final String signal;
  final int battery;
  final bool isConnected;
  final String lastSync;
  final String imageUrl;
  final String manufacturer;
  final String model;
  final String firmwareVersion;

  IoTDevice({
    required this.id,
    required this.name,
    required this.type,
    required this.signal,
    required this.battery,
    required this.isConnected,
    required this.lastSync,
    required this.imageUrl,
    required this.manufacturer,
    required this.model,
    required this.firmwareVersion,
  });
}

class AvailableDevice {
  final String name;
  final String type;
  final String signal;
  final int signalBars;
  final String icon;
  final String color;
  final String bgColor;

  AvailableDevice({
    required this.name,
    required this.type,
    required this.signal,
    required this.signalBars,
    required this.icon,
    required this.color,
    required this.bgColor,
  });
}

class DeviceReading {
  final String deviceId;
  final String type;
  final double value;
  final String unit;
  final DateTime timestamp;
  final String status;

  DeviceReading({
    required this.deviceId,
    required this.type,
    required this.value,
    required this.unit,
    required this.timestamp,
    required this.status,
  });
}
