# =============================================================================
# OpenCode Chat - Windows 云服务器部署脚本
# 目标服务器: 47.97.86.239
# 域名: www.puckg.xyz
# =============================================================================
# 使用方法:
#   1. 以管理员身份打开 PowerShell
#   2. Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
#   3. .\deploy-to-server.ps1
# =============================================================================

param(
    [string]$ServerIP = "47.97.86.239",
    [string]$Domain = "www.puckg.xyz",
    [string]$InstallDir = "C:\opencode-server",
    [int]$WSPort = 3002,
    [int]$HTTPPort = 8080,
    [switch]$SkipBunInstall,
    [switch]$SkipFirewall,
    [switch]$UseIIS
)

# 颜色配置
$Colors = @{
    Info = "Cyan"
    Success = "Green"
    Warning = "Yellow"
    Error = "Red"
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor $Colors.Info
}

function Write-Success {
    param([string]$Message)
    Write-Host "[SUCCESS] $Message" -ForegroundColor $Colors.Success
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARNING] $Message" -ForegroundColor $Colors.Warning
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor $Colors.Error
}

# 检查管理员权限
function Test-Administrator {
    $currentPrincipal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

# 检查 Bun 是否安装
function Test-BunInstalled {
    try {
        $bunVersion = & bun --version 2>$null
        if ($bunVersion) {
            return $true
        }
    } catch {
        return $false
    }
    return $false
}

# 安装 Bun
function Install-Bun {
    Write-Info "安装 Bun..."

    try {
        powershell -c "irm bun.sh/install.ps1 | iex"
        $env:Path = "$env:Path;$env:USERPROFILE\.bun\bin"
        [Environment]::SetEnvironmentVariable(
            "Path",
            [Environment]::GetEnvironmentVariable("Path", "Machine") + ";$env:USERPROFILE\.bun\bin",
            "Machine"
        )
        Write-Success "Bun 安装完成"
        return $true
    } catch {
        Write-Error "Bun 安装失败: $_"
        return $false
    }
}

# 准备安装目录
function Initialize-InstallDirectory {
    Write-Info "准备安装目录: $InstallDir"

    if (Test-Path $InstallDir) {
        Write-Warning "目录已存在，备份旧版本..."
        $backupDir = "$InstallDir.backup.$(Get-Date -Format 'yyyyMMdd_HHmmss')"
        Copy-Item -Path $InstallDir -Destination $backupDir -Recurse -Force
        Write-Info "已备份到: $backupDir"
    } else {
        New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }

    # 创建子目录
    $subDirs = @("logs", "data", "ssl")
    foreach ($dir in $subDirs) {
        $fullPath = Join-Path $InstallDir $dir
        if (-not (Test-Path $fullPath)) {
            New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
        }
    }

    Write-Success "安装目录准备完成"
}

# 复制项目文件
function Copy-ProjectFiles {
    Write-Info "复制项目文件..."

    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    if (-not $scriptDir) { $scriptDir = Get-Location }

    # 检查是否是正确的项目目录
    if (-not (Test-Path "$scriptDir\package.json")) {
        Write-Error "未找到 package.json，请确保在正确的项目目录中运行此脚本"
        exit 1
    }

    # 需要复制的目录
    $dirsToCopy = @("multiplayer", "public")
    foreach ($dir in $dirsToCopy) {
        $source = Join-Path $scriptDir $dir
        $dest = Join-Path $InstallDir $dir
        if (Test-Path $source) {
            Copy-Item -Path $source -Destination $dest -Recurse -Force
            Write-Info "复制目录: $dir"
        }
    }

    # 需要复制的文件
    $filesToCopy = @(
        "package.json",
        "tsconfig.json",
        "bunfig.toml",
        ".env.example"
    )
    foreach ($file in $filesToCopy) {
        $source = Join-Path $scriptDir $file
        if (Test-Path $source) {
            Copy-Item -Path $source -Destination $InstallDir -Force
            Write-Info "复制文件: $file"
        }
    }

    # 复制 SSL 证书
    $sslSource = Join-Path $scriptDir "SSL"
    $sslDest = Join-Path $InstallDir "ssl"
    if (Test-Path $sslSource) {
        Get-ChildItem -Path $sslSource -Filter "*.pem", "*.key" | ForEach-Object {
            Copy-Item -Path $_.FullName -Destination $sslDest -Force
            Write-Info "复制 SSL 证书: $($_.Name)"
        }
    }

    # 复制 .env 文件（如果存在）
    $envSource = Join-Path $scriptDir ".env"
    if (Test-Path $envSource) {
        Copy-Item -Path $envSource -Destination $InstallDir -Force
        Write-Info "复制 .env 配置文件"
    }

    Write-Success "项目文件复制完成"
}

# 安装项目依赖
function Install-ProjectDependencies {
    Write-Info "安装项目依赖..."

    Push-Location $InstallDir

    try {
        & bun install
        if ($LASTEXITCODE -ne 0) {
            throw "bun install 失败"
        }
        Write-Success "项目依赖安装完成"
    } catch {
        Write-Error "依赖安装失败: $_"
        exit 1
    } finally {
        Pop-Location
    }
}

# 配置环境变量
function Set-EnvironmentConfiguration {
    Write-Info "配置环境变量..."

    $envFile = "$InstallDir\.env"
    $envExampleFile = "$InstallDir\.env.example"

    if (-not (Test-Path $envFile)) {
        if (Test-Path $envExampleFile) {
            $envContent = Get-Content $envExampleFile -Raw

            # 替换默认配置
            $envContent = $envContent -replace "WS_PORT=3002", "WS_PORT=$WSPort"
            $envContent = $envContent -replace "WS_HOST=0.0.0.0", "WS_HOST=0.0.0.0"

            # 添加 SSL 配置
            $sslConfig = @"

# =============================================================================
# SSL Configuration
# =============================================================================
SSL_CERT_PATH=$InstallDir\ssl\www.puckg.xyz.pem
SSL_KEY_PATH=$InstallDir\ssl\www.puckg.xyz.key
SSL_DOMAIN=$Domain
"@
            $envContent += $sslConfig

            $envContent | Out-File -FilePath $envFile -Encoding UTF8
            Write-Warning "已创建 .env 文件，请编辑填入你的实际配置"
            Write-Info "配置文件路径: $envFile"
        } else {
            Write-Error "未找到 .env.example 文件"
            exit 1
        }
    } else {
        Write-Warning ".env 文件已存在，保留现有配置"
    }
}

# 配置防火墙
function Set-FirewallRule {
    if ($SkipFirewall) {
        Write-Info "跳过防火墙配置"
        return
    }

    Write-Info "配置防火墙规则..."

    $ports = @($WSPort, $HTTPPort, 80, 443)
    foreach ($port in $ports) {
        $ruleName = "OpenCode Port $port"
        $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

        if ($existingRule) {
            Remove-NetFirewallRule -DisplayName $ruleName
        }

        try {
            New-NetFirewallRule `
                -DisplayName $ruleName `
                -Direction Inbound `
                -LocalPort $port `
                -Protocol TCP `
                -Action Allow `
                -Profile Any

            Write-Success "防火墙规则添加完成 (端口: $port)"
        } catch {
            Write-Warning "防火墙规则添加失败: $_"
        }
    }
}

# 创建后端启动脚本
function New-BackendStartScript {
    Write-Info "创建后端启动脚本..."

    $startScript = @"
@echo off
chcp 65001 >nul
echo Starting OpenCode WebSocket Server...
cd /d "$InstallDir"
set NODE_ENV=production
set WS_PORT=$WSPort
set WS_HOST=0.0.0.0
bun run multiplayer/websocket-server.ts
pause
"@

    $startScript | Out-File -FilePath "$InstallDir\start-backend.bat" -Encoding UTF8

    # 创建后台运行脚本（使用 VBScript 隐藏窗口）
    $vbsScript = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d "$InstallDir" && set NODE_ENV=production && set WS_PORT=$WSPort && set WS_HOST=0.0.0.0 && bun run multiplayer/websocket-server.ts > logs\server.log 2>&1", 0, False
"@

    $vbsScript | Out-File -FilePath "$InstallDir\start-backend-background.vbs" -Encoding UTF8

    Write-Success "后端启动脚本创建完成"
}

# 创建前端服务器脚本
function New-FrontendServerScript {
    Write-Info "创建前端服务器脚本..."

    # 创建简单的 Bun HTTP 服务器脚本
    $frontendServer = @"
import { serve } from "bun";

const PORT = $HTTPPort;
const PUBLIC_DIR = "$($InstallDir.Replace('\', '\\'))\\public";

console.log(\`[Frontend Server] Starting on port \${PORT}\`);
console.log(\`[Frontend Server] Serving static files from: \${PUBLIC_DIR}\`);

serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);
    let path = url.pathname;

    // 默认首页
    if (path === "/") {
      path = "/index.html";
    }

    // 构建文件路径
    const filePath = \`\${PUBLIC_DIR}\${path}\`;
    const file = Bun.file(filePath);

    return new Response(file);
  },
});

console.log(\`[Frontend Server] Running at http://0.0.0.0:\${PORT}\`);
"@

    $frontendServer | Out-File -FilePath "$InstallDir\frontend-server.ts" -Encoding UTF8

    $startFrontend = @"
@echo off
chcp 65001 >nul
echo Starting OpenCode Frontend Server...
cd /d "$InstallDir"
bun run frontend-server.ts
pause
"@

    $startFrontend | Out-File -FilePath "$InstallDir\start-frontend.bat" -Encoding UTF8

    # 后台运行脚本
    $vbsFrontend = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c cd /d "$InstallDir" && bun run frontend-server.ts > logs\frontend.log 2>&1", 0, False
"@

    $vbsFrontend | Out-File -FilePath "$InstallDir\start-frontend-background.vbs" -Encoding UTF8

    Write-Success "前端服务器脚本创建完成"
}

# 创建 NSSM 服务安装脚本
function New-NssmServiceScript {
    Write-Info "创建 Windows 服务安装脚本..."

    $nssmBackend = @"
# OpenCode Backend Service Install Script
`$nssmPath = "C:\\nssm\\nssm.exe"
`$serviceName = "OpenCodeBackend"
`$bunPath = "`$env:USERPROFILE\\.bun\\bin\\bun.exe"
`$installDir = "$($InstallDir.Replace('\', '\\'))"

if (-not (Test-Path `$nssmPath)) {
    Write-Host "NSSM not found at `$nssmPath" -ForegroundColor Red
    Write-Host "Please download NSSM from https://nssm.cc/download and extract to C:\nssm\" -ForegroundColor Yellow
    exit 1
}

# 停止并删除现有服务
`$existingService = Get-Service -Name `$serviceName -ErrorAction SilentlyContinue
if (`$existingService) {
    net stop `$serviceName
    & `$nssmPath remove `$serviceName confirm
}

# 安装服务
& `$nssmPath install `$serviceName `"`$bunPath`"
& `$nssmPath set `$serviceName AppDirectory `"`$installDir`"
& `$nssmPath set `$serviceName AppParameters "run multiplayer/websocket-server.ts"
& `$nssmPath set `$serviceName DisplayName "OpenCode WebSocket Backend"
& `$nssmPath set `$serviceName Description "OpenCode Chat WebSocket Server"
& `$nssmPath set `$serviceName Start SERVICE_AUTO_START

# 设置环境变量
`$envVars = "NODE_ENV=production;WS_PORT=$WSPort;WS_HOST=0.0.0.0"
`$envFile = "`$installDir\\.env"
if (Test-Path `$envFile) {
    Get-Content `$envFile | ForEach-Object {
        if (`$_ -match '^([^#][^=]+)=(.*)$') {
            `$key = `$matches[1].Trim()
            `$val = `$matches[2].Trim()
            `$envVars += ";`$key=`$val"
        }
    }
}
& `$nssmPath set `$serviceName AppEnvironmentExtra `$envVars

# 设置日志
& `$nssmPath set `$serviceName AppStdout "`$installDir\\logs\\backend-service.log"
& `$nssmPath set `$serviceName AppStderr "`$installDir\\logs\\backend-service-error.log"

Write-Host "Backend service installed successfully!" -ForegroundColor Green
Write-Host "Start: net start `$serviceName"
Write-Host "Stop: net stop `$serviceName"
Write-Host "Remove: `$nssmPath remove `$serviceName confirm"
"@

    $nssmBackend | Out-File -FilePath "$InstallDir\install-backend-service.ps1" -Encoding UTF8

    $nssmFrontend = @"
# OpenCode Frontend Service Install Script
`$nssmPath = "C:\\nssm\\nssm.exe"
`$serviceName = "OpenCodeFrontend"
`$bunPath = "`$env:USERPROFILE\\.bun\\bin\\bun.exe"
`$installDir = "$($InstallDir.Replace('\', '\\'))"

if (-not (Test-Path `$nssmPath)) {
    Write-Host "NSSM not found at `$nssmPath" -ForegroundColor Red
    exit 1
}

# 停止并删除现有服务
`$existingService = Get-Service -Name `$serviceName -ErrorAction SilentlyContinue
if (`$existingService) {
    net stop `$serviceName
    & `$nssmPath remove `$serviceName confirm
}

# 安装服务
& `$nssmPath install `$serviceName `"`$bunPath`"
& `$nssmPath set `$serviceName AppDirectory `"`$installDir`"
& `$nssmPath set `$serviceName AppParameters "run frontend-server.ts"
& `$nssmPath set `$serviceName DisplayName "OpenCode Frontend Server"
& `$nssmPath set `$serviceName Description "OpenCode Chat Frontend HTTP Server"
& `$nssmPath set `$serviceName Start SERVICE_AUTO_START

# 设置日志
& `$nssmPath set `$serviceName AppStdout "`$installDir\\logs\\frontend-service.log"
& `$nssmPath set `$serviceName AppStderr "`$installDir\\logs\\frontend-service-error.log"

Write-Host "Frontend service installed successfully!" -ForegroundColor Green
Write-Host "Start: net start `$serviceName"
Write-Host "Stop: net stop `$serviceName"
"@

    $nssmFrontend | Out-File -FilePath "$InstallDir\install-frontend-service.ps1" -Encoding UTF8

    Write-Success "Windows 服务安装脚本创建完成"
}

# 创建 IIS 配置脚本
function New-IISConfigScript {
    Write-Info "创建 IIS 配置脚本..."

    $iisScript = @"
# OpenCode Chat IIS Configuration Script
# Run as Administrator

Import-Module WebAdministration

`$SiteName = "OpenCodeChat"
`$PhysicalPath = "$($InstallDir.Replace('\', '\\'))\\public"
`$Domain = "$Domain"
`$BackendPort = $WSPort
`$FrontendPort = $HTTPPort

Write-Host "Configuring IIS for OpenCode Chat..." -ForegroundColor Cyan

# Check if IIS is installed
if (-not (Get-Command Get-Website -ErrorAction SilentlyContinue)) {
    Write-Host "IIS is not installed. Installing IIS..." -ForegroundColor Yellow
    Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServerRole -All
    Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebServer -All
    Enable-WindowsOptionalFeature -Online -FeatureName IIS-CommonHttpFeatures -All
    Enable-WindowsOptionalFeature -Online -FeatureName IIS-ApplicationDevelopment -All
    Enable-WindowsOptionalFeature -Online -FeatureName IIS-ASPNET45 -All
    Enable-WindowsOptionalFeature -Online -FeatureName IIS-WebSockets -All
    Write-Host "IIS installed. Please restart and run this script again." -ForegroundColor Green
    exit
}

# Create website directory
if (-not (Test-Path `$PhysicalPath)) {
    New-Item -ItemType Directory -Path `$PhysicalPath -Force
}

# Remove existing site if exists
`$existingSite = Get-Website -Name `$SiteName -ErrorAction SilentlyContinue
if (`$existingSite) {
    Remove-Website -Name `$SiteName
    Write-Host "Removed existing site: `$SiteName"
}

# Create new website
New-Website -Name `$SiteName -PhysicalPath `$PhysicalPath -Port 80 -HostHeader `$Domain
Set-ItemProperty "IIS:\Sites\`$SiteName" -Name applicationDefaults.preloadEnabled -Value True

# Configure SSL binding if certificates exist
`$certPath = "$($InstallDir.Replace('\', '\\'))\\ssl\\www.puckg.xyz.pem"
`$keyPath = "$($InstallDir.Replace('\', '\\'))\\ssl\\www.puckg.xyz.key"

if ((Test-Path `$certPath) -and (Test-Path `$keyPath)) {
    # Import certificate to certificate store
    `$pfxPath = "$($InstallDir.Replace('\', '\\'))\\ssl\\certificate.pfx"
    `$certPassword = ConvertTo-SecureString -String "tempPassword123" -Force -AsPlainText

    # Note: For PEM certificates, you may need to convert to PFX or use certutil
    Write-Host "SSL certificates found at: `$certPath"
    Write-Host "Please manually import the certificate to IIS and bind to the site"
}

# Configure URL Rewrite for WebSocket reverse proxy (requires ARR)
Write-Host "IIS site created: `$SiteName"
Write-Host "Site URL: http://`$Domain"
Write-Host ""
Write-Host "Note: For WebSocket support, please install:"
Write-Host "  1. Application Request Routing (ARR)"
Write-Host "  2. URL Rewrite Module"
Write-Host "  3. Configure reverse proxy to localhost:`$BackendPort"
"@

    $iisScript | Out-File -FilePath "$InstallDir\configure-iis.ps1" -Encoding UTF8
    Write-Success "IIS 配置脚本创建完成"
}

# 创建 nginx 配置
function New-NginxConfig {
    Write-Info "创建 Nginx 配置文件..."

    $nginxConfig = @"
# OpenCode Chat Nginx Configuration
# Place this file in nginx/conf.d/ directory

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name $Domain;
    return 301 https://`$server_name`$request_uri;
}

# HTTPS server
server {
    listen 443 ssl;
    server_name $Domain;

    # SSL certificates
    ssl_certificate $InstallDir\ssl\www.puckg.xyz.pem;
    ssl_certificate_key $InstallDir\ssl\www.puckg.xyz.key;

    # SSL settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Static files (frontend)
    location / {
        root $InstallDir\public;
        index index.html;
        try_files `$uri `$uri/ /index.html;
    }

    # WebSocket proxy (backend)
    location /ws {
        proxy_pass http://localhost:$WSPort;
        proxy_http_version 1.1;
        proxy_set_header Upgrade `$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # API proxy (if needed)
    location /api {
        proxy_pass http://localhost:$WSPort;
        proxy_http_version 1.1;
        proxy_set_header Host `$host;
        proxy_set_header X-Real-IP `$remote_addr;
        proxy_set_header X-Forwarded-For `$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto `$scheme;
    }
}
"@

    $nginxConfig | Out-File -FilePath "$InstallDir\nginx-opencode.conf" -Encoding UTF8
    Write-Success "Nginx 配置文件创建完成"
}

# 打印部署信息
function Show-DeploymentInfo {
    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host "          OpenCode Chat 部署完成!" -ForegroundColor Green
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  服务器信息:" -ForegroundColor Cyan
    Write-Host "    IP 地址: $ServerIP"
    Write-Host "    域名: $Domain"
    Write-Host ""
    Write-Host "  安装目录: $InstallDir" -ForegroundColor Cyan
    Write-Host "  配置文件: $InstallDir\.env" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  端口配置:" -ForegroundColor Cyan
    Write-Host "    WebSocket 后端: $WSPPort"
    Write-Host "    HTTP 前端: $HTTPPort"
    Write-Host ""
    Write-Host "  启动方式:" -ForegroundColor Cyan
    Write-Host "    1. 开发模式:"
    Write-Host "       - 后端: $InstallDir\start-backend.bat"
    Write-Host "       - 前端: $InstallDir\start-frontend.bat"
    Write-Host ""
    Write-Host "    2. 后台运行 (无窗口):"
    Write-Host "       - 后端: $InstallDir\start-backend-background.vbs"
    Write-Host "       - 前端: $InstallDir\start-frontend-background.vbs"
    Write-Host ""
    Write-Host "    3. Windows 服务 (推荐生产环境):"
    Write-Host "       先安装 NSSM: https://nssm.cc/download"
    Write-Host "       解压到 C:\nssm\"
    Write-Host "       后端服务: $InstallDir\install-backend-service.ps1"
    Write-Host "       前端服务: $InstallDir\install-frontend-service.ps1"
    Write-Host ""
    Write-Host "  Web 服务器选项:" -ForegroundColor Cyan
    Write-Host "    1. Nginx (推荐):"
    Write-Host "       配置文件: $InstallDir\nginx-opencode.conf"
    Write-Host "       下载 Nginx for Windows, 将配置文件复制到 conf.d 目录"
    Write-Host ""
    Write-Host "    2. IIS:"
    Write-Host "       配置脚本: $InstallDir\configure-iis.ps1"
    Write-Host ""
    Write-Host "  访问地址:" -ForegroundColor Cyan
    Write-Host "    HTTP:  http://$ServerIP`:$HTTPPort"
    Write-Host "    HTTPS: https://$Domain (配置 SSL 后)"
    Write-Host "    WS:    ws://$ServerIP`:$WSPort"
    Write-Host "    WSS:   wss://$Domain/ws (配置反向代理后)"
    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host "  重要提示:" -ForegroundColor Yellow
    Write-Host "  1. 请编辑 $InstallDir\.env 文件，配置数据库和 API 密钥"
    Write-Host "  2. 确保云服务器安全组已开放端口: 80, 443, $WSPort, $HTTPPort"
    Write-Host "  3. 如需使用域名访问，请将 $Domain 解析到 $ServerIP"
    Write-Host "=============================================================================" -ForegroundColor Green
}

# 主函数
function Main {
    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Cyan
    Write-Host "          OpenCode Chat - Windows 云服务器部署脚本" -ForegroundColor Cyan
    Write-Host "=============================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  目标服务器: $ServerIP"
    Write-Host "  域名: $Domain"
    Write-Host "  安装目录: $InstallDir"
    Write-Host ""

    # 检查管理员权限
    if (-not (Test-Administrator)) {
        Write-Error "请使用管理员权限运行此脚本"
        Write-Info "右键点击 PowerShell -> 以管理员身份运行"
        exit 1
    }

    # 检查/安装 Bun
    if (-not $SkipBunInstall) {
        if (Test-BunInstalled) {
            $bunVersion = & bun --version
            Write-Success "Bun 已安装 (版本: $bunVersion)"
        } else {
            if (-not (Install-Bun)) {
                exit 1
            }
        }
    }

    # 执行部署步骤
    Initialize-InstallDirectory
    Copy-ProjectFiles
    Install-ProjectDependencies
    Set-EnvironmentConfiguration
    Set-FirewallRule
    New-BackendStartScript
    New-FrontendServerScript
    New-NssmServiceScript
    New-NginxConfig

    if ($UseIIS) {
        New-IISConfigScript
    }

    Show-DeploymentInfo
}

# 执行主函数
Main
