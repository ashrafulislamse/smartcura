/*
 * OLED display test for SmartCura ESP32 prototype.
 *
 * Tries the SH1106 driver first, then falls back to SSD1306.
 * Each driver draws for 5 seconds so you can see which one works.
 */

#include <Wire.h>
#include <U8g2lib.h>

U8G2_SH1106_128X64_NONAME_F_HW_I2C sh1106(U8G2_R0, U8X8_PIN_NONE);
U8G2_SSD1306_128X64_NONAME_F_HW_I2C ssd1306(U8G2_R0, U8X8_PIN_NONE);

void drawTest(U8G2& display, const char* driverName) {
  display.setPowerSave(0);
  display.setContrast(255);
  display.clearBuffer();
  display.setFont(u8g2_font_6x10_tf);
  display.drawStr(0, 12, "SmartCura");
  display.drawStr(0, 26, driverName);
  display.drawStr(0, 40, "128x64 OLED");
  display.drawStr(0, 54, "OK");
  display.sendBuffer();
}

void tryDriver(U8G2& display, const char* driverName) {
  Serial.print("--- Testing ");
  Serial.print(driverName);
  Serial.println(" ---");

  display.begin();
  drawTest(display, driverName);

  Serial.println("Look at the screen for 5 seconds...");
  delay(5000);
}

void setup() {
  Serial.begin(115200);
  while (!Serial) { ; }
  delay(500);

  Serial.println("OLED display test");
  Serial.println("SDA = GPIO 21, SCL = GPIO 22");

  tryDriver(sh1106, "SH1106");
  tryDriver(ssd1306, "SSD1306");

  Serial.println();
  Serial.println("Test complete.");
  Serial.println("Which driver showed text on the screen?");
}

void loop() {
  delay(1000);
}
