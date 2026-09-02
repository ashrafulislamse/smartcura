@echo off
rem SmartCura Vitals Monitor — flash script for Windows CMD.
rem
rem Uses the arduino-cli binary bundled with the locally installed Arduino IDE.
rem Compile and upload at 115200 baud because the DOIT DevKit V1 on this
rem workstation does not reliably enter download mode at 921600.
rem
rem Usage:
rem   cd iot-firmware\smartcura_vitals_monitor
rem   flash.bat

set "ARDUINO_CLI=C:\Users\ashra\AppData\Local\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"
set "BOARD_FQBN=esp32:esp32:esp32doit-devkit-v1:UploadSpeed=115200"
set "PORT=COM7"
set "SKETCH_DIR=%~dp0"

echo SmartCura Vitals Monitor flasher
echo ==================================
echo arduino-cli: %ARDUINO_CLI%
echo FQBN:        %BOARD_FQBN%
echo Port:        %PORT%
echo Sketch:      %SKETCH_DIR%
echo.
echo Put the ESP32 in download mode before or during upload:
echo   1. Hold the BOOT button (GPIO0).
echo   2. Press and release the EN button (reset).
echo   3. Keep holding BOOT until you see 'Chip is ESP32'.
echo   4. Release BOOT.
echo.

if not exist "%ARDUINO_CLI%" (
  echo ERROR: arduino-cli not found at %ARDUINO_CLI%
  echo Please update ARDUINO_CLI in this script to the correct path.
  exit /b 1
)

echo [1/2] Compiling...
"%ARDUINO_CLI%" compile --fqbn %BOARD_FQBN% "%SKETCH_DIR%"
if errorlevel 1 exit /b 1

echo.
echo [2/2] Uploading...
echo Hold BOOT + press EN now if the device is not already in download mode.
"%ARDUINO_CLI%" upload --fqbn %BOARD_FQBN% --port %PORT% "%SKETCH_DIR%"
if errorlevel 1 exit /b 1

echo.
echo Flash complete. The ESP32 will reboot automatically.
