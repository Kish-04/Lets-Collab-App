@echo off
echo Starting Let's Collab local backend and Electron app...
echo Please wait a moment.
cd /d "%~dp0"
start "Let's Collab Backend" cmd /k "npm run server"
timeout /t 3 /nobreak >nul
call npm run electron:dev
pause
