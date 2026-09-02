@echo off
echo ========================================
echo SmartCura Doctor App - GitHub Push
echo ========================================
echo.

REM Initialize git if not already initialized
if not exist .git (
    echo Initializing Git repository...
    git init
    echo.
)

REM Add remote if not exists
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo Adding remote origin...
    git remote add origin https://github.com/ashrafulislamse/smartcura-doctor-app.git
    echo.
)

REM Configure git user (update with your details)
echo Configuring Git user...
git config user.name "Ashraful Islam"
git config user.email "ashrafulislamse@gmail.com"
echo.

REM Add all files
echo Adding files to Git...
git add .
echo.

REM Commit with message
echo Committing changes...
git commit -m "feat: complete MVP with 22 screens - v1.0.0

- Add authentication flow (6 screens)
- Add dashboard and notifications (2 screens)
- Add appointment management (3 screens)
- Add consultation features (4 screens)
- Add messaging system (1 screen)
- Add patient management (2 screens)
- Add profile and settings (4 screens)
- Implement 5-tab bottom navigation
- Add professional README and documentation
- Set up project structure with Clean Architecture
- Configure theme with teal color (#0F766E)
- Add LICENSE, VERSION, and CHANGELOG"
echo.

REM Create and push tag
echo Creating version tag v1.0.0...
git tag -a v1.0.0 -m "Release v1.0.0 - MVP Complete

SmartCura Doctor App MVP with 22 screens:
- Complete authentication flow
- Dashboard with stats and quick actions
- Appointment and schedule management
- Video and chat consultations
- Patient management with detailed profiles
- Profile, settings, and help screens
- Professional UI with teal theme
- Clean Architecture structure
- Ready for backend integration"
echo.

REM Set upstream and push
echo Pushing to GitHub...
git branch -M main
git push -u origin main
echo.

REM Push tags
echo Pushing tags...
git push origin --tags
echo.

echo ========================================
echo Push Complete!
echo ========================================
echo.
echo Repository: https://github.com/ashrafulislamse/smartcura-doctor-app
echo Version: 1.0.0
echo Status: MVP Complete
echo.
pause
