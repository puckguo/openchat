@echo off
chcp 65001 >nul
cd /d "%~dp0"

set USE_HTTPS=true
set SSL_CERT_PATH=./ssl/local-cert.pem
set SSL_KEY_PATH=./ssl/local-key.pem
set WS_PORT=3002

rem 所有配置从 .env 文件读取，无需在此设置
rem 如需修改配置，请编辑 .env 文件

echo [WebSocket] Starting with SSL...
echo [WebSocket] Certificate: %SSL_CERT_PATH%
echo [WebSocket] Key: %SSL_KEY_PATH%

bun run multiplayer/websocket-server.ts
