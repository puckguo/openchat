# =============================================================================
# OpenCode Multiplayer Server - Windows 一键部署脚本
# =============================================================================
# 使用方法:
#   1. 以管理员身份打开 PowerShell
#   2. Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
#   3. .\deploy-windows.ps1
# =============================================================================

param(
    [string]$InstallDir = "C:\opencode-server",
    [int]$Port = 3002,
    [switch]$SkipBunInstall,
    [switch]$SkipFirewall
)

# 颜色配置
$Colors = @{
    Info = "Cyan"
    Success = "Green"
    Warning = "Yellow"
    Error = "Red"
}

# 辅助函数
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
        # 使用官方安装脚本
        powershell -c "irm bun.sh/install.ps1 | iex"

        # 添加到当前会话的 PATH
        $env:Path = "$env:Path;$env:USERPROFILE\.bun\bin"

        # 添加到系统 PATH
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
        Move-Item -Path $InstallDir -Destination $backupDir -Force
        Write-Info "已备份到: $backupDir"
    }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Write-Success "安装目录准备完成"
}

# 复制项目文件
function Copy-ProjectFiles {
    Write-Info "复制项目文件..."

    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
    $scriptName = Split-Path -Leaf $scriptDir

    # 检查脚本是否在 deploy 目录中
    if ($scriptName -eq "deploy") {
        # 脚本在 deploy 子目录中，项目根目录是父目录
        $projectRoot = Split-Path -Parent $scriptDir
        Write-Info "检测到脚本位于 deploy 目录，使用项目根目录: $projectRoot"
    } else {
        # 脚本在项目根目录中
        $projectRoot = $scriptDir
    }

    # 检查是否是正确的项目目录
    if (-not (Test-Path "$projectRoot\package.json")) {
        Write-Error "未找到 package.json，请确保项目文件完整"
        exit 1
    }

    # 复制所有文件（排除 deploy 目录和日志等）
    Get-ChildItem -Path $projectRoot -Exclude @("deploy", "deploy-*.ps1", "deploy-*.sh", "*.log", ".git", "node_modules", "data") | ForEach-Object {
        if ($_.PSIsContainer) {
            Copy-Item -Path $_.FullName -Destination "$InstallDir\$($_.Name)" -Recurse -Force
        } else {
            Copy-Item -Path $_.FullName -Destination $InstallDir -Force
        }
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
            Copy-Item -Path $envExampleFile -Destination $envFile
            Write-Warning "请编辑 .env 文件，填入你的实际配置"
            Write-Info "配置文件路径: $envFile"
        } else {
            # 尝试从 deploy 目录复制
            $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
            $scriptName = Split-Path -Leaf $scriptDir
            if ($scriptName -eq "deploy" -and (Test-Path "$scriptDir\.env.example")) {
                Copy-Item -Path "$scriptDir\.env.example" -Destination $envFile
                Write-Warning "请编辑 .env 文件，填入你的实际配置"
                Write-Info "配置文件路径: $envFile"
            } else {
                Write-Error "未找到 .env.example 文件"
                exit 1
            }
        }
    } else {
        Write-Warning ".env 文件已存在，跳过创建"
    }
}

# 配置防火墙
function Set-FirewallRule {
    if ($SkipFirewall) {
        Write-Info "跳过防火墙配置"
        return
    }

    Write-Info "配置防火墙规则..."

    $ruleName = "OpenCode WebSocket"
    $existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

    if ($existingRule) {
        Write-Warning "防火墙规则已存在，更新规则..."
        Remove-NetFirewallRule -DisplayName $ruleName
    }

    try {
        New-NetFirewallRule `
            -DisplayName $ruleName `
            -Direction Inbound `
            -LocalPort $Port `
            -Protocol TCP `
            -Action Allow `
            -Profile Any

        Write-Success "防火墙规则添加完成 (端口: $Port)"
    } catch {
        Write-Warning "防火墙规则添加失败: $_"
        Write-Info "请手动开放端口 $Port"
    }
}

# 创建 PM2 配置文件
function New-Pm2Config {
    Write-Info "创建 PM2 配置文件..."

    $pm2Config = @"
module.exports = {
  apps: [{
    name: 'opencode-ws',
    script: 'multiplayer/websocket-server.ts',
    interpreter: 'bun',
    cwd: '$($InstallDir.Replace('\', '\\'))',
    env: {
      NODE_ENV: 'production',
      WS_PORT: $Port
    },
    env_file: '$($InstallDir.Replace('\', '\\'))\\.env',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    log_file: '$($InstallDir.Replace('\', '\\'))\\logs\\combined.log',
    out_file: '$($InstallDir.Replace('\', '\\'))\\logs\\out.log',
    error_file: '$($InstallDir.Replace('\', '\\'))\\logs\\error.log',
    time: true
  }]
};
"@

    # 创建日志目录
    $logsDir = "$InstallDir\logs"
    if (-not (Test-Path $logsDir)) {
        New-Item -ItemType Directory -Path $logsDir -Force | Out-Null
    }

    $pm2Config | Out-File -FilePath "$InstallDir\ecosystem.config.js" -Encoding UTF8
    Write-Success "PM2 配置文件创建完成"
}

# 创建 NSSM 服务配置脚本
function New-NssmServiceScript {
    Write-Info "创建 Windows 服务安装脚本..."

    $nssmScript = @"
# OpenCode Multiplayer Server - Windows Service Install Script
# 需要 NSSM (https://nssm.cc/download)

`$nssmPath = "C:\\nssm\\nssm.exe"
`$serviceName = "OpenCodeWebSocket"
`$bunPath = "`$env:USERPROFILE\\.bun\\bin\\bun.exe"
`$installDir = "$($InstallDir.Replace('\', '\\'))"

if (-not (Test-Path `$nssmPath)) {
    Write-Error "NSSM 未找到，请下载并解压到 C:\nssm\\"
    Write-Info "下载地址: https://nssm.cc/download"
    exit 1
}

# 安装服务
& `$nssmPath install `$serviceName `"`$bunPath`"
& `$nssmPath set `$serviceName AppDirectory `"`$installDir`"
& `$nssmPath set `$serviceName AppParameters "run multiplayer/websocket-server.ts"
& `$nssmPath set `$serviceName DisplayName "OpenCode Multiplayer WebSocket Server"
& `$nssmPath set `$serviceName Description "Real-time collaborative WebSocket server for OpenCode"
& `$nssmPath set `$serviceName Start SERVICE_AUTO_START

# 设置环境变量
`$envVars = "NODE_ENV=production;WS_PORT=$Port"
`$envFile = "`$installDir\\.env"
if (Test-Path `$envFile) {
    Get-Content `$envFile | ForEach-Object {
        if (`$_ -match '^([^#][^=]+)=(.*)$') {
            `$envVars += ";`$(`$matches[1])=`$(`$matches[2])"
        }
    }
}
& `$nssmPath set `$serviceName AppEnvironmentExtra `$envVars

Write-Success "Windows 服务安装完成"
Write-Info "启动服务: net start `$serviceName"
Write-Info "停止服务: net stop `$serviceName"
Write-Info "删除服务: `$nssmPath remove `$serviceName confirm"
"@

    $nssmScript | Out-File -FilePath "$InstallDir\install-service.ps1" -Encoding UTF8
    Write-Success "Windows 服务安装脚本创建完成"
}

# 创建启动脚本
function New-StartScript {
    Write-Info "创建启动脚本..."

    $startScript = @"
@echo off
chcp 65001 >nul
echo Starting OpenCode Multiplayer Server...
cd /d "$InstallDir"
set NODE_ENV=production
set WS_PORT=$Port
bun run multiplayer/websocket-server.ts
pause
"@

    $startScript | Out-File -FilePath "$InstallDir\start.bat" -Encoding UTF8

    $devScript = @"
@echo off
chcp 65001 >nul
echo Starting OpenCode Multiplayer Server (Dev Mode)...
cd /d "$InstallDir"
set NODE_ENV=development
set WS_PORT=$Port
bun run --watch multiplayer/websocket-server.ts
pause
"@

    $devScript | Out-File -FilePath "$InstallDir\start-dev.bat" -Encoding UTF8

    Write-Success "启动脚本创建完成"
}

# 健康检查
function Test-ServerHealth {
    param([int]$Port)

    Write-Info "进行健康检查..."
    Start-Sleep -Seconds 3

    try {
        $response = Invoke-RestMethod -Uri "http://localhost:$Port/health" -Method GET -TimeoutSeconds 5
        Write-Success "健康检查通过!"
        Write-Info "服务器响应: $($response | ConvertTo-Json -Compress)"
        return $true
    } catch {
        Write-Warning "健康检查未通过: $_"
        return $false
    }
}

# 打印部署信息
function Show-DeploymentInfo {
    $ipAddress = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*"
    } | Select-Object -First 1).IPAddress

    if (-not $ipAddress) {
        $ipAddress = "your-server-ip"
    }

    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host "          OpenCode Multiplayer Server 部署完成!" -ForegroundColor Green
    Write-Host "=============================================================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "  安装目录: $InstallDir"
    Write-Host "  配置文件: $InstallDir\.env"
    Write-Host "  服务端口: $Port"
    Write-Host ""
    Write-Host "  启动方式:"
    Write-Host "    1. 直接启动: $InstallDir\start.bat"
    Write-Host "    2. 开发模式: $InstallDir\start-dev.bat"
    Write-Host "    3. PM2 管理: cd $InstallDir; pm2 start ecosystem.config.js"
    Write-Host "    4. Windows 服务: .\install-service.ps1 (需要 NSSM)"
    Write-Host ""
    Write-Host "  常用命令:"
    Write-Host "    查看日志: Get-Content $InstallDir\server.log -Tail 50 -Wait"
    Write-Host "    PM2 状态: pm2 status"
    Write-Host "    PM2 日志: pm2 logs opencode-ws"
    Write-Host ""
    Write-Host "  如果这是首次部署，请务必编辑配置文件:"
    Write-Host "    notepad $InstallDir\.env"
    Write-Host ""
    Write-Host "  WebSocket 连接地址:"
    Write-Host "    ws://$ipAddress`:$Port"
    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Green
}

# 主函数
function Main {
    Write-Host ""
    Write-Host "=============================================================================" -ForegroundColor Cyan
    Write-Host "          OpenCode Multiplayer Server - Windows 一键部署脚本" -ForegroundColor Cyan
    Write-Host "=============================================================================" -ForegroundColor Cyan
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
    } else {
        Write-Info "跳过 Bun 安装检查"
    }

    # 执行部署步骤
    Initialize-InstallDirectory
    Copy-ProjectFiles
    Install-ProjectDependencies
    Set-EnvironmentConfiguration
    Set-FirewallRule
    New-Pm2Config
    New-NssmServiceScript
    New-StartScript

    # 检查 .env 配置
    $envFile = "$InstallDir\.env"
    if (Test-Path $envFile) {
        $envContent = Get-Content $envFile -Raw
        if ($envContent -match "your-") {
            Write-Warning "检测到 .env 文件中仍有默认配置值"
            Write-Info "请先编辑 $envFile 文件，填入实际配置后再启动服务"
        } else {
            $startNow = Read-Host "配置似乎已完成，是否立即启动服务? [Y/n]"
            if ($startNow -ne "n" -and $startNow -ne "N") {
                Push-Location $InstallDir
                & bun run multiplayer/websocket-server.ts
                Pop-Location
            }
        }
    }

    Show-DeploymentInfo
}

# 执行主函数
Main
