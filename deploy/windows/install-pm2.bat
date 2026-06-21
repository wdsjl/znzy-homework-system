@echo off
chcp 65001 >nul
cd /d %~dp0..\..
echo.
echo === znzy-homework Windows PM2 install ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-pm2.ps1"
if errorlevel 1 (
  echo.
  echo FAILED. See messages above.
  pause
  exit /b 1
)
echo.
pause
