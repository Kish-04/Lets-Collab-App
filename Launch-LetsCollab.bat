@echo off
echo Starting Let's Collab Installation/App...
echo.
cd /d "%~dp0"
echo Launching the Windows Installer...
if exist "dist\Let's Collab Setup 0.1.14.exe" (
    start "" "dist\Let's Collab Setup 0.1.14.exe"
) else if exist "dist\Let's Collab Cloud Setup.exe" (
    start "" "dist\Let's Collab Cloud Setup.exe"
) else (
    echo Built app not found! Please check the dist folder.
    pause
)
