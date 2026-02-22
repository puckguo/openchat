@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ========================================
echo   Open CoChat - PM2 HTTPS 服务启动
echo ========================================
echo.

REM 检查 logs 目录
if not exist "logs" mkdir logs

echo [1/3] 检查 PM2 状态...
call pm2 list

echo.
echo [2/3] 启动服务 (HTTPS 模式)...
call pm2 start ecosystem.config.cjs

echo.
echo [3/3] 显示服务状态...
call pm2 list

echo.
echo ========================================
echo   服务已启动
echo ========================================
echo.
echo   前端 (原版):    https://www.puckg.xyz:8888/
echo   前端 (微信风格): https://www.puckg.xyz:8888/wechat/
echo   WebSocket (WSS): wss://www.puckg.xyz:3002/
echo.
echo   常用命令:
echo   - 查看状态: pm2 list
echo   - 查看日志: pm2 logs
echo   - 重启服务: pm2 restart all
echo   - 停止服务: pm2 stop all
echo   - 删除服务: pm2 delete all
echo.
pause
