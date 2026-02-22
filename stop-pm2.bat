@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   Open CoChat - PM2 服务停止
echo ========================================
echo.

call pm2 stop all
call pm2 list

echo.
echo 服务已停止
pause
