#!/usr/bin/env bash
#
# SmartCura Vitals Monitor — flash script for the FYP demo workstation.
#
# This script uses the arduino-cli binary bundled with the locally installed
# Arduino IDE, so you do not need a separate arduino-cli installation.
# It compiles at 115200 upload speed because the DOIT DevKit V1 on this
# workstation does not reliably enter download mode at 921600.
#
# Usage:
#   cd iot-firmware/smartcura_vitals_monitor
#   ./flash.sh
#
# The script will tell you when to press the BOOT/EN buttons. If the upload
# fails with "Wrong boot mode detected", retry the script and hold BOOT while
# pressing EN during the "Connecting...." phase.

set -euo pipefail

# Path to the arduino-cli binary bundled with the Arduino IDE installed on
# this workstation. Adjust only if the IDE is moved.
ARDUINO_CLI="/c/Users/ashra/AppData/Local/Programs/Arduino IDE/resources/app/lib/backend/resources/arduino-cli.exe"

BOARD_FQBN="esp32:esp32:esp32doit-devkit-v1:UploadSpeed=115200"
PORT="COM7"
SKETCH_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "SmartCura Vitals Monitor flasher"
echo "================================"
echo "arduino-cli: $ARDUINO_CLI"
echo "FQBN:        $BOARD_FQBN"
echo "Port:        $PORT"
echo "Sketch:      $SKETCH_DIR"
echo ""
echo "If this is the first flash after power-on, put the ESP32 in download mode:"
echo "  1. Hold the BOOT button (GPIO0)."
echo "  2. Press and release the EN button (reset)."
echo "  3. Keep holding BOOT until you see 'Chip is ESP32' below."
echo "  4. Release BOOT."
echo ""

if [[ ! -x "$ARDUINO_CLI" ]]; then
  echo "ERROR: arduino-cli not found at $ARDUINO_CLI"
  echo "Please update ARDUINO_CLI in this script to the correct path."
  exit 1
fi

echo "[1/2] Compiling..."
"$ARDUINO_CLI" compile --fqbn "$BOARD_FQBN" "$SKETCH_DIR"

echo ""
echo "[2/2] Uploading..."
echo "Hold BOOT + press EN now if the device is not already in download mode."
"$ARDUINO_CLI" upload --fqbn "$BOARD_FQBN" --port "$PORT" "$SKETCH_DIR"

echo ""
echo "Flash complete. The ESP32 will reboot automatically."
