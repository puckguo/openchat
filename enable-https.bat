@echo off
chcp 65001 >nul
echo.
echo =============================================================================
echo           Open CoChat - Enable HTTPS/WSS
echo =============================================================================
echo.

REM Run PowerShell script
powershell -ExecutionPolicy Bypass -File "%~dp0enable-https.ps1"

pause
