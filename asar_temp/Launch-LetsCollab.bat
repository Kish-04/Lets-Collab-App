@echo off
echo Starting Let's Collab Installation/App...
echo.
echo Launching the Windows Installer...
if exist "dist\Let's Collab Setup 0.1.0.exe" (
    start "" "dist\Let's Collab Setup 0.1.0.exe"
) else if exist "dist\win-unpacked\Let's Collab.exe" (
    start "" "dist\win-unpacked\Let's Collab.exe"
) else (
    echo Built app not found! Please check the dist folder.
    pause
)
