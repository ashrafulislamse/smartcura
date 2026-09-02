/*
 * Simple I2C scanner for the SmartCura ESP32 prototype.
 *
 * Scans the bus on GPIO 21 (SDA) / GPIO 22 (SCL) and prints any
 * responding device addresses. Use this to verify wiring and to find
 * the correct address for an OLED or MAX30102 module.
 */

#include <Wire.h>

#define I2C_SDA 21
#define I2C_SCL 22

void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  delay(500);
  Serial.println("\nI2C Scanner");
  Serial.println("SDA = GPIO 21, SCL = GPIO 22");
  Wire.begin(I2C_SDA, I2C_SCL);
  // Enable internal pull-ups in case the module has none of its own.
  pinMode(I2C_SDA, INPUT_PULLUP);
  pinMode(I2C_SCL, INPUT_PULLUP);
}

void loop() {
  byte error, address;
  int nDevices = 0;

  Serial.println("Scanning...");
  for (address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("I2C device found at address 0x");
      if (address < 16) Serial.print("0");
      Serial.print(address, HEX);
      Serial.println("  (" + String(address) + ")");
      nDevices++;
    } else if (error == 4) {
      Serial.print("Unknown error at address 0x");
      if (address < 16) Serial.print("0");
      Serial.println(address, HEX);
    }
  }

  if (nDevices == 0) {
    Serial.println("No I2C devices found");
  } else {
    Serial.print("done — ");
    Serial.print(nDevices);
    Serial.println(" device(s) found");
  }
  Serial.println();
  delay(5000);
}
