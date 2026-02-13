# =============================================================================
# OpenCode Chat - 快速启动脚本
# =============================================================================
# 此脚本用于在 Windows 服务器上快速启动前后端服务
# =============================================================================

param(
    [int]$WSPort = 3002,
    [int]$HTTPPort = 8080,
    [switch]$Background
)

$InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not $InstallDir) { $InstallDir = Get-Location }

Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "          OpenCode Chat - 快速启动" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""

# 设置环境变量
$env:NODE_ENV = "production"
$env:WS_PORT = $WSPort
$env:WS_HOST = "0.0.0.0"

Write-Host "配置信息:" -ForegroundColor Yellow
Write-Host "  安装目录: $InstallDir"
Write-Host "  WebSocket 端口: $WSPort"
Write-Host "  HTTP 端口: $HTTPPort"
Write-Host ""

# 检查 bun 是否安装
try {
    $bunVersion = bun --version 2>$null
    Write-Host "Bun 版本: $bunVersion" -ForegroundColor Green
} catch {
    Write-Host "错误: 未找到 Bun，请先安装 Bun" -ForegroundColor Red
    Write-Host "安装命令: powershell -c \"irm bun.sh/install.ps1 | iex\"" -ForegroundColor Yellow
    exit 1
}

# 确保日志目录存在
$logsDir = Join-Path $InstallDir "logs"
if (-not (Test-Path $logsDir)) {
    New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
}

# 创建前端服务器脚本（如果不存在）
$frontendScript = Join-Path $InstallDir "frontend-server.ts"
if (-not (Test-Path $frontendScript)) {
    $frontendCode = @"
import { serve } from "bun";

const PORT = $HTTPPort;
const PUBLIC_DIR = "$($InstallDir.Replace('\', '\\'))\\public";

console.log(\`[Frontend] Starting HTTP server on port \${PORT}\`);
console.log(\`[Frontend] Serving: \${PUBLIC_DIR}\`);

serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;
    if (path === "/") path = "/index.html";

    const filePath = \`\${PUBLIC_DIR}\${path}\`;
    const file = Bun.file(filePath);

    // 设置 CORS 头，允许跨域访问
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    return new Response(file, { headers });
  },
});

console.log(\`[Frontend] Server running at http://0.0.0.0:\${PORT}\`);
"@
    $frontendCode | Out-File -FilePath $frontendScript -Encoding UTF8
    Write-Host "已创建前端服务器脚本" -ForegroundColor Green
}

if ($Background) {
    Write-Host "启动模式: 后台运行" -ForegroundColor Yellow
    Write-Host ""

    # 启动后端（后台）
    $backendCmd = "cd /d `"$InstallDir`" && set NODE_ENV=production && set WS_PORT=$WSPort && set WS_HOST=0.0.0.0 && bun run multiplayer/websocket-server.ts > logs\server.log 2>&1"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c $backendCmd" -WindowStyle Hidden
    Write-Host "[后端] WebSocket 服务器已启动 (PID: 后台进程)" -ForegroundColor Green
    Write-Host "       日志: $InstallDir\logs\server.log"

    # 启动前端（后台）
    $frontendCmd = "cd /d `"$InstallDir`" && bun run frontend-server.ts > logs\frontend.log 2>&1"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/c $frontendCmd" -WindowStyle Hidden
    Write-Host "[前端] HTTP 服务器已启动 (PID: 后台进程)" -ForegroundColor Green
    Write-Host "       日志: $InstallDir\logs\frontend.log"

    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host "  服务已启动!" -ForegroundColor Green
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  访问地址:"
    Write-Host "    前端: http://47.97.86.239:$HTTPPort"
    Write-Host "    WebSocket: ws://47.97.86.239:$WSPort"
    Write-Host ""
    Write-Host "  查看日志:"
    Write-Host "    Get-Content $InstallDir\logs\server.log -Tail 20 -Wait"
    Write-Host "    Get-Content $InstallDir\logs\frontend.log -Tail 20 -Wait"
    Write-Host ""
    Write-Host "  停止服务:"
    Write-Host "    Stop-Process -Name bun -Force"
    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Green

} else {
    Write-Host "启动模式: 前台运行 (按 Ctrl+C 停止)" -ForegroundColor Yellow
    Write-Host ""

    # 启动后端（新窗口）
    $backendTitle = "OpenCode WebSocket Server"
    $backendCmd = "cd /d `"$InstallDir`" && set NODE_ENV=production && set WS_PORT=$WSPort && set WS_HOST=0.0.0.0 && title $backendTitle && bun run multiplayer/websocket-server.ts"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k $backendCmd"
    Write-Host "[后端] WebSocket 服务器已启动" -ForegroundColor Green
    Start-Sleep -Seconds 2

    # 启动前端（新窗口）
    $frontendTitle = "OpenCode Frontend Server"
    $frontendCmd = "cd /d `"$InstallDir`" && title $frontendTitle && bun run frontend-server.ts"
    Start-Process -FilePath "cmd.exe" -ArgumentList "/k $frontendCmd"
    Write-Host "[前端] HTTP 服务器已启动" -ForegroundColor Green

    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host "  服务已启动!" -ForegroundColor Green
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  访问地址:"
    Write-Host "    前端: http://47.97.86.239:$HTTPPort"
    Write-Host "    WebSocket: ws://47.97.86.239:$WSPort"
    Write-Host ""
    Write-Host "  注意: 关闭命令行窗口即可停止服务"
    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Green
}
