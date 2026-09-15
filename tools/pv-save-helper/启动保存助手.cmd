@echo off
chcp 65001 >nul
title 保存助手（可最小化；关掉即停止）
echo.
echo  ================================================================
echo   本地保存助手
echo  ----------------------------------------------------------------
echo   启动后：面板里 Ctrl+S 会直接覆盖保存，不弹任何窗口。
echo   本窗口可以最小化；关掉它就停止服务（面板会自动退回浏览器弹窗方式）。
echo  ================================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pv-save-helper.ps1" -Roots "%~dp0.." %*
echo.
echo  服务已停止。按任意键关闭窗口。
pause >nul
