# =============================================================================
# OpenCode Chat - 一键上传并部署到 Windows 云服务器
# =============================================================================
# 此脚本用于从本地一键上传项目到云服务器并部署
# 需要: PowerShell, 服务器管理员权限
# =============================================================================

param(
    [string]$ServerIP = "47.97.86.239",
    [string]$Username = "Administrator",
    [string]$RemotePath = "C:\opencode-server",
    [string]$Domain = "www.puckg.xyz"
)

Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "          OpenCode Chat - 一键部署到云服务器" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  目标服务器: $ServerIP" -ForegroundColor Yellow
Write-Host "  远程路径: $RemotePath" -ForegroundColor Yellow
Write-Host "  域名: $Domain" -ForegroundColor Yellow
Write-Host ""

# 检查本地项目
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
if (-not (Test-Path "$ProjectDir\package.json")) {
    Write-Error "错误: 未找到 package.json，请在项目根目录运行此脚本"
    exit 1
}

# 创建临时部署包
Write-Host "[1/5] 创建部署包..." -ForegroundColor Cyan
$TempDir = "$env:TEMP\opencode-deploy-$(Get-Random)"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

# 复制必要文件
$itemsToCopy = @(
    "multiplayer",
    "public",
    "SSL",
    "package.json",
    "tsconfig.json",
    "bunfig.toml",
    ".env.example",
    "deploy-to-server.ps1",
    "start-server.ps1"
)

foreach ($item in $itemsToCopy) {
    $source = Join-Path $ProjectDir $item
    if (Test-Path $source) {
        Copy-Item -Path $source -Destination $TempDir -Recurse -Force
        Write-Host "  复制: $item" -ForegroundColor Gray
    }
}

# 压缩
$ZipFile = "$env:TEMP\opencode-deploy.zip"
if (Test-Path $ZipFile) { Remove-Item $ZipFile }
Compress-Archive -Path "$TempDir\*" -DestinationPath $ZipFile -Force
Remove-Item -Path $TempDir -Recurse -Force
Write-Host "  部署包已创建: $ZipFile" -ForegroundColor Green

# 上传到服务器
Write-Host ""
Write-Host "[2/5] 上传部署包到服务器..." -ForegroundColor Cyan
Write-Host "  请确保可以通过 PowerShell 远程连接到服务器" -ForegroundColor Yellow

# 方法1: 使用 PowerShell 远程会话
Write-Host ""
Write-Host "请选择上传方式:" -ForegroundColor Yellow
Write-Host "  1. PowerShell 远程会话 (需要启用 WinRM)"
Write-Host "  2. 手动上传 (通过 RDP 或 SCP)"
Write-Host "  3. 仅生成本地部署包"
$choice = Read-Host "请选择 (1-3)"

switch ($choice) {
    "1" {
        try {
            # 启用 WinRM 并上传
            Write-Host "  尝试连接服务器..." -ForegroundColor Gray
            $cred = Get-Credential -Username $Username -Message "请输入服务器密码"

            $session = New-PSSession -ComputerName $ServerIP -Credential $cred -ErrorAction Stop

            # 复制文件
            Copy-Item -Path $ZipFile -Destination "C:\opencode-deploy.zip" -ToSession $session -Force
            Write-Host "  文件上传成功!" -ForegroundColor Green

            # 解压
            Write-Host ""
            Write-Host "[3/5] 在服务器上解压文件..." -ForegroundColor Cyan
            Invoke-Command -Session $session -ScriptBlock {
                if (Test-Path $using:RemotePath) {
                    Remove-Item -Path $using:RemotePath -Recurse -Force
                }
                Expand-Archive -Path "C:\opencode-deploy.zip" -DestinationPath $using:RemotePath -Force
                Remove-Item -Path "C:\opencode-deploy.zip" -Force
            }
            Write-Host "  解压完成!" -ForegroundColor Green

            # 运行部署脚本
            Write-Host ""
            Write-Host "[4/5] 运行部署脚本..." -ForegroundColor Cyan
            Invoke-Command -Session $session -ScriptBlock {
                cd $using:RemotePath
                Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process -Force
                .\deploy-to-server.ps1 -ServerIP $using:ServerIP -Domain $using:Domain
            }

            Remove-PSSession $session
            Write-Host "  部署脚本执行完成!" -ForegroundColor Green
        }
        catch {
            Write-Error "远程部署失败: $_"
            Write-Host "请尝试手动方式上传" -ForegroundColor Yellow
        }
    }
    "2" {
        Write-Host ""
        Write-Host "请手动完成以下步骤:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  1. 通过 RDP 连接到: $ServerIP"
        Write-Host "  2. 复制部署包到服务器: $ZipFile"
        Write-Host "  3. 在服务器上解压到: $RemotePath"
        Write-Host "  4. 运行: $RemotePath\deploy-to-server.ps1"
        Write-Host ""
        Write-Host "或者在本地 PowerShell 中使用 scp:" -ForegroundColor Gray
        Write-Host "  scp `"$ZipFile`" $Username@${ServerIP}:C:\\" -ForegroundColor Cyan
        Write-Host ""
    }
    "3" {
        Write-Host ""
        Write-Host "部署包已生成: $ZipFile" -ForegroundColor Green
        Write-Host "请手动上传到服务器" -ForegroundColor Yellow
    }
    default {
        Write-Host "无效的选择" -ForegroundColor Red
    }
}

# 清理
if (Test-Path $ZipFile) {
    Remove-Item $ZipFile -Force
}

Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Green
Write-Host "  部署准备完成!" -ForegroundColor Green
Write-Host "=============================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  部署后访问地址:" -ForegroundColor Cyan
Write-Host "    http://$ServerIP`:8080"
Write-Host "    ws://$ServerIP`:3002"
Write-Host ""
Write-Host "  配置 HTTPS (www.puckg.xyz):" -ForegroundColor Cyan
Write-Host "    1. 确保域名解析到: $ServerIP"
Write-Host "    2. 配置 Nginx 或 IIS 反向代理"
Write-Host "    3. 使用 SSL 目录中的证书"
Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Green
