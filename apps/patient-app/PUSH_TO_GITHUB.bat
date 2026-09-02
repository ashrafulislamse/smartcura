@echo off
echo.
echo ========================================
echo   PUSHING TO GITHUB
echo ========================================
echo.
echo Repository: https://github.com/ashrafulislamse/smartcura-patient-app
echo Branch: main
echo.

cd /d "%~dp0"

echo Checking git status...
git status
echo.

echo Pushing to GitHub...
git push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo   SUCCESS! PUSHED TO GITHUB
    echo ========================================
    echo.
    echo Visit: https://github.com/ashrafulislamse/smartcura-patient-app
    echo.
) else (
    echo.
    echo ========================================
    echo   PUSH FAILED
    echo ========================================
    echo.
    echo If authentication is required:
    echo 1. Username: ashrafulislamse
    echo 2. Password: Use Personal Access Token
    echo.
    echo Create token at: https://github.com/settings/tokens
    echo.
)

pause
