@echo off
setlocal EnableDelayedExpansion

echo SmartCura Health Connect permission helper
echo ==========================================
echo.

set PACKAGE=com.smartcura.smartcuraPatientApp

echo [1] Checking if device is connected...
adb devices | findstr /R /C:"^[0-9A-Za-z].*device$" >nul
if errorlevel 1 (
    echo No ADB device found. Connect your Vivo via USB and enable USB debugging.
    pause
    exit /b 1
)
echo Device connected.
echo.

echo [2] Checking if SmartCura is installed...
adb shell pm path %PACKAGE% >nul 2>&1
if errorlevel 1 (
    echo SmartCura patient app is NOT installed. Install it first:
    echo adb install -r apps\patient-app\build\app\outputs\flutter-apk\app-debug.apk
    pause
    exit /b 1
)
echo SmartCura installed.
echo.

echo [3] Checking Health Connect permissions declared in manifest...
adb shell pm dump %PACKAGE% | findstr /I "android.permission.health.READ_" > %TEMP%\smartcura-health-perms.txt
if errorlevel 1 (
    echo No Health Connect READ permissions found in manifest. APK may be stale.
    pause
    exit /b 1
)
type %TEMP%\smartcura-health-perms.txt
echo.

echo [4] Checking if Google Health Connect is installed (Android 13 and below)...
adb shell pm list packages | findstr /I "healthconnect" >nul
echo If nothing is printed above, install Google Health Connect from Play Store.
echo.

echo [5] Granting Health Connect permissions...
adb shell pm grant %PACKAGE% android.permission.health.READ_HEART_RATE
adb shell pm grant %PACKAGE% android.permission.health.READ_OXYGEN_SATURATION
adb shell pm grant %PACKAGE% android.permission.health.READ_BODY_TEMPERATURE
adb shell pm grant %PACKAGE% android.permission.health.READ_BLOOD_PRESSURE
adb shell pm grant %PACKAGE% android.permission.health.READ_RESPIRATORY_RATE
adb shell pm grant %PACKAGE% android.permission.health.READ_BLOOD_GLUCOSE
adb shell pm grant %PACKAGE% android.permission.health.READ_RESPIRATORY_RATE
adb shell pm grant %PACKAGE% android.permission.health.READ_STEPS
adb shell pm grant %PACKAGE% android.permission.health.READ_DISTANCE
adb shell pm grant %PACKAGE% android.permission.health.READ_ACTIVE_CALORIES_BURNED
adb shell pm grant %PACKAGE% android.permission.health.READ_BASAL_METABOLIC_RATE
adb shell pm grant %PACKAGE% android.permission.health.READ_SLEEP

echo.
echo [6] Verifying permissions...
adb shell dumpsys package %PACKAGE% | findstr /R /C:"android.permission.health.READ_.*granted=true" > %TEMP%\smartcura-granted.txt
if errorlevel 1 (
    echo WARNING: permissions may not be granted. Check Vivo settings: Privacy ^> Permission manager ^> Health Connect.
) else (
    echo Permissions granted. Open SmartCura ^> Health ^> Sync from Watch and try again.
)

type %TEMP%\smartcura-granted.txt
pause
