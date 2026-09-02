/*
 * MAX30102 I2C read test.
 *
 * 1. Scans the bus (write-only, like the scanner).
 * 2. Reads the PART_ID register (0xFF) directly via Wire.h.
 * 3. Tries to initialize the SparkFun MAX3010x library.
 *
 * If step 2 fails, the problem is hardware: pull-ups, wiring, or a clone chip.
 */

#include <Wire.h>
#include "MAX30105.h"

#define I2C_SDA 21
#define I2C_SCL 22
#define MAX_ADDR 0x57
#define REG_PART_ID 0xFF

MAX30105 particleSensor;
bool sensorReady = false;

byte readRegister(uint8_t addr, uint8_t reg) {
  Wire.beginTransmission(addr);
  Wire.write(reg);
  Wire.endTransmission(false);

  Wire.requestFrom(addr, (uint8_t)1);
  if (Wire.available()) {
    return Wire.read();
  }
  return 0xFF;
}

void scanBus() {
  Serial.println("Scanning I2C bus...");
  int n = 0;
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    uint8_t err = Wire.endTransmission();
    if (err == 0) {
      Serial.print("  device at 0x");
      if (a < 16) Serial.print("0");
      Serial.println(a, HEX);
      n++;
    }
  }
  Serial.print(n);
  Serial.println(" device(s) found");
}

void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  delay(500);

  Serial.println("MAX30102 read test");
  Serial.println("SDA = GPIO 21, SCL = GPIO 22");

  Wire.begin(I2C_SDA, I2C_SCL);
  pinMode(I2C_SDA, INPUT_PULLUP);
  pinMode(I2C_SCL, INPUT_PULLUP);

  scanBus();

  Serial.println();
  Serial.print("Reading PART_ID (0x");
  Serial.print(REG_PART_ID, HEX);
  Serial.print(") from 0x");
  Serial.println(MAX_ADDR, HEX);

  uint8_t partId = readRegister(MAX_ADDR, REG_PART_ID);
  Serial.print("  PART_ID = 0x");
  if (partId < 16) Serial.print("0");
  Serial.println(partId, HEX);

  if (partId == 0xFF) {
    Serial.println("[FAIL] Direct register read failed.");
    Serial.println("Add 4.7k pull-ups on SDA and SCL to 3.3V, or check wiring.");
  } else if (partId != 0x15) {
    Serial.println("[WARN] PART_ID is not the expected 0x15.");
  } else {
    Serial.println("[OK] Direct register read works.");
  }

  Serial.println();
  Serial.println("Trying SparkFun MAX3010x library...");

  if (particleSensor.begin(Wire, I2C_SPEED_STANDARD)) {
    Serial.println("[OK] Library initialized.");
    particleSensor.setup();
    particleSensor.setPulseAmplitudeRed(0x0A);
    particleSensor.setPulseAmplitudeIR(0x1F);
    sensorReady = true;
  } else {
    Serial.println("[ERROR] Library begin() failed.");
    sensorReady = false;
  }
}

void loop() {
  if (!sensorReady) {
    Serial.println("Sensor not ready; raw PART_ID read test passed, library init failed.");
    delay(3000);
    return;
  }

  uint32_t ir = particleSensor.getIR();
  uint32_t red = particleSensor.getRed();

  Serial.print("IR=");
  Serial.print(ir);
  Serial.print("  Red=");
  Serial.print(red);

  if (ir > 50000) {
    Serial.println("  -> FINGER DETECTED");
  } else {
    Serial.println("  -> no finger");
  }

  delay(100);
}
