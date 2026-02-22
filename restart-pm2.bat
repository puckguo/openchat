@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   Open CoChat - PM2 服务重启
echo ========================================
echo.

call pm2 restart all
call pm2 list

echo.
echo 服务已重启
pause
