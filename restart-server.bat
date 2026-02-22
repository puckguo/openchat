@echo off
chcp 65001 >nul
echo 正在停止现有服务器...
taskkill /F /IM bun.exe 2>nul
timeout /t 2 /nobreak >nul

echo 清除缓存...
if exist node_modules\.cache rd /s /q node_modules\.cache 2>nul
if exist .bun-cache rd /s /q .bun-cache 2>nul

echo 启动服务器...
cd /d "C:\guo\opencode-multi\opencode-server"
start /B bun run index.ts > server.log 2>&1

timeout /t 3 /nobreak >nul
echo 服务器已启动，日志：
type server.log | findstr /C:"[DEBUG]" /C:"WebSocket" /C:"error"
pause
