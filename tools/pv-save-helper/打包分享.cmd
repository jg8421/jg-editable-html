@echo off
chcp 65001 >nul
title 打包分享（HTML + 保存助手 + 说明）
echo.
echo  ================================================================
echo   把当前 HTML 打包成"同事打开就能用"的分享包
echo  ----------------------------------------------------------------
echo   包里会有：
echo     · 面板 HTML 本身
echo     · pv-save-helper 保存助手（同事双击一次 = 和你一样零弹窗）
echo     · 收件人一页说明
echo   生成的 zip 放在同一个文件夹里。
echo  ================================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\打包分享.ps1"
echo.
pause >nul
