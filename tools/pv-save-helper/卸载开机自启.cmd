@echo off
chcp 65001 >nul
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1" -Remove
echo.
pause >nul
