# 🔌 SmartCura IoT Device Firmware

**Status:** ✅ Firmware v1.0.1 — ESP32 publishing live vitals, verified end-to-end  
**Platform:** ESP32 / ESP32-S3  
**Language:** C/C++

---

## 📊 Current Status

| Component | Status |
|-----------|--------|
| Hardware Design | ✅ Complete |
| Firmware Design | ✅ Complete |
| Implementation | ✅ Initial version flashed and verified; OLED, MAX30102, DS18B20 publishing to MQTT |
| Estimated Time | 6-8 weeks |

---

## 📋 What This Firmware Does

The IoT firmware enables:
- Real-time health monitoring
- Heart rate tracking (MAX30102)
- SpO2 (blood oxygen) monitoring
- Body temperature measurement
- WiFi connectivity
- MQTT data transmission
- OTA (Over-The-Air) updates

---

## 📌 Verified Pinout

| Function | ESP32 Pin | Notes |
|---|---|---|
| I2C SDA | GPIO21 | Shared by OLED and MAX30102 |
| I2C SCL | GPIO22 | Shared by OLED and MAX30102 |
| 1-Wire DATA | GPIO5 | DS18B20 temperature probe |
| OLED I2C address | 0x3C | SSD1306 128x64 |
| MAX30102 I2C address | 0x57 | 3.3V only |
| DS18B20 pull-up | 4.7kΩ | Between DATA (GPIO5) and 3.3V |

---

## 📚 Documentation

Further reading:
- [System architecture](../docs/ARCHITECTURE.md)
- [Environment variables guide](../ENVIRONMENT.md)
- [Firmware details](smartcura_vitals_monitor/README.md)

---

## 🎯 Implementation Roadmap

### Phase 1: Hardware Setup (Week 1-2)
- [ ] ESP32 board setup
- [ ] Sensor connections (MAX30102, DS18B20)
- [ ] Power management
- [ ] Testing hardware

### Phase 2: Basic Firmware (Week 3-4)
- [ ] Sensor reading code
- [ ] WiFi connectivity
- [ ] MQTT communication
- [ ] Data formatting

### Phase 3: Advanced Features (Week 5-6)
- [ ] Data encryption
- [ ] OTA updates
- [ ] Low power mode
- [ ] Error handling

### Phase 4: Testing & Calibration (Week 7-8)
- [ ] Sensor calibration
- [ ] Accuracy testing
- [ ] Battery optimization
- [ ] Field testing

---

## 🚀 Quick Start

```bash
# Build the firmware
pio run -d iot-firmware

# Upload to the ESP32 currently on COM7
pio run -t upload -d iot-firmware --upload-port COM7
```

For multiple devices, each board must have its own UUIDv7 device id and provisioning secret. Use the helper to swap credentials per flash:

```bash
python iot-firmware/flash-device.py \
  --device-id <uuidv7> \
  --provisioning-secret <secret> \
  --port COM7
```

---

## 🛠️ Tech Stack (Planned)

- **Platform:** ESP32 / ESP32-S3
- **IDE:** Arduino IDE / PlatformIO
- **Language:** C/C++
- **Protocol:** MQTT / HTTP
- **Sensors:** 
  - MAX30102 (Heart rate, SpO2)
  - DS18B20 (Temperature)
  - Optional: Blood pressure sensor

---

## 📞 Contact

**Student:** ISLAM MD ASHRAFUL (202306010022)  
**Email:** [contact@ashrafulislam.dev](mailto:contact@ashrafulislam.dev)

---

**Last Updated:** August 17, 2026
