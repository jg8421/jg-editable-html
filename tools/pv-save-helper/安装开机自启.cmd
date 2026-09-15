@echo off
chcp 65001 >nul
echo.
echo  正在注册「保存助手」为开机自启（可随时卸载）...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
echo.
pause >nul
