@echo off
echo Starting DRCSLA Desktop App (Electron)...
echo Please wait a moment.
cd /d "%~dp0"
call npm run electron:dev
pause
