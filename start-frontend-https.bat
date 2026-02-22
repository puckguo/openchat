@echo off
chcp 65001 >nul
echo Starting OpenCode Frontend Server with HTTPS...
set NODE_ENV=production
start "Frontend Server" bun run frontend-server-https-local.ts
echo Frontend server started on https://localhost:8888
echo.
