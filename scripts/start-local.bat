@echo off
chcp 65001 >nul
echo ==========================================
echo  OpenCode Chat - Local Deployment
echo ==========================================
echo.

:: 检查 SSL 证书
if not exist "..\ssl\local-cert.pem" (
    echo ⚠️  SSL certificate not found!
    echo Generating self-signed certificate...
    echo.
    powershell -ExecutionPolicy Bypass -File "%~dp0generate-ssl-cert.ps1"
    echo.
)

echo Starting services...
echo.

:: 启动 WebSocket Server
echo [1/2] Starting WebSocket Server on port 3002...
start "WebSocket Server" cmd /k "cd /d %~dp0.. && bun run multiplayer/websocket-server.ts"

:: 等待 WebSocket 启动
timeout /t 2 /nobreak >nul

:: 启动 Frontend Server
echo [2/2] Starting Frontend Server on port 8888...
start "Frontend Server" cmd /k "cd /d %~dp0.. && bun run frontend-server-https-local.ts"

timeout /t 2 /nobreak >nul

echo.
echo ==========================================
echo  ✅ Services Started!
echo ==========================================
echo.
echo 📱 Access URLs:
echo    Local:    https://localhost:8888
echo    LAN:      https://192.168.1.253:8888
echo.
echo ℹ️  First-time access:
echo    - Browser will show certificate warning
echo    - Click "Advanced" -> "Proceed" to continue
echo.
echo ⏹️  To stop: Close the server windows or press Ctrl+C
echo.
pause
