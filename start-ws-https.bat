@echo off
chcp 65001 >nul
echo Starting OpenCode WebSocket Server with HTTPS...
set USE_HTTPS=true
set SSL_CERT_PATH=./SSL/local-cert.pem
set SSL_KEY_PATH=./SSL/local-key.pem
set WS_PORT=3002
set ENABLE_DATABASE=true
set ENABLE_OSS=true
set ENABLE_AI=true
set ENABLE_VOICE_CHAT=true
set ENABLE_VOICE_AI=true
set ENABLE_DAILY_REPORT=true
set NODE_ENV=production
start "WebSocket Server" bun run multiplayer/websocket-server.ts
echo WebSocket server started on wss://localhost:3002
echo.
