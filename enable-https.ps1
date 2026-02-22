# Open CoChat - Enable HTTPS/WSS
# Run as Administrator

param(
    [string]$CertPath = "C:\opencode-server\ssl\www.puckg.xyz.pem",
    [string]$KeyPath = "C:\opencode-server\ssl\www.puckg.xyz.key",
    [int]$Port = 3002,
    [string]$Domain = "puckg.xyz"
)

Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host "          Open CoChat - Enable HTTPS/WSS" -ForegroundColor Cyan
Write-Host "=============================================================================" -ForegroundColor Cyan
Write-Host ""

$InstallDir = "C:\opencode-server"

# Check certificate files
Write-Host "[1/4] Checking SSL certificates..." -ForegroundColor Yellow

if (-not (Test-Path $CertPath)) {
    Write-Error "Certificate not found: $CertPath"
    exit 1
}

if (-not (Test-Path $KeyPath)) {
    Write-Error "Key not found: $KeyPath"
    exit 1
}

Write-Host "  Certificate: $CertPath" -ForegroundColor Green
Write-Host "  Key: $KeyPath" -ForegroundColor Green

# Read and update .env file
Write-Host ""
Write-Host "[2/4] Updating environment configuration..." -ForegroundColor Yellow

$envFile = "$InstallDir\.env"
$envContent = ""

if (Test-Path $envFile) {
    $envContent = Get-Content $envFile -Raw
    Write-Host "  Read existing config" -ForegroundColor Gray
} else {
    Write-Host "  Create new config file" -ForegroundColor Gray
}

# Check if HTTPS config exists
if ($envContent -match "USE_HTTPS") {
    Write-Host "  Update existing HTTPS config" -ForegroundColor Gray
    $envContent = $envContent -replace "USE_HTTPS=.*", "USE_HTTPS=true"
    $envContent = $envContent -replace "SSL_CERT_PATH=.*", "SSL_CERT_PATH=$CertPath"
    $envContent = $envContent -replace "SSL_KEY_PATH=.*", "SSL_KEY_PATH=$KeyPath"
} else {
    Write-Host "  Add HTTPS configuration" -ForegroundColor Gray
    $httpsConfig = @"

# HTTPS/WSS Configuration
USE_HTTPS=true
SSL_CERT_PATH=$CertPath
SSL_KEY_PATH=$KeyPath
SSL_DOMAIN=$Domain
"@
    $envContent += $httpsConfig
}

# Save config
$envContent | Out-File -FilePath $envFile -Encoding UTF8
Write-Host "  Config saved to: $envFile" -ForegroundColor Green

# Configure firewall
Write-Host ""
Write-Host "[3/4] Configuring firewall..." -ForegroundColor Yellow

$ruleName = "OpenCode HTTPS WSS"
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue

if ($existingRule) {
    Remove-NetFirewallRule -DisplayName $ruleName
}

try {
    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Direction Inbound `
        -LocalPort $Port `
        -Protocol TCP `
        -Action Allow `
        -Profile Any | Out-Null
    Write-Host "  Firewall rule added (port: $Port)" -ForegroundColor Green
} catch {
    Write-Warning "Failed to add firewall rule: $_"
}

# Generate start scripts
Write-Host ""
Write-Host "[4/4] Generating start scripts..." -ForegroundColor Yellow

# Batch script for foreground
$batchContent = '@echo off' + "`r`n" +
    'chcp 65001 >nul' + "`r`n" +
    'echo.' + "`r`n" +
    'echo =============================================================================' + "`r`n" +
    'echo           Open CoChat - HTTPS/WSS Mode' + "`r`n" +
    'echo =============================================================================' + "`r`n" +
    'echo.' + "`r`n" +
    'echo Access URLs:' + "`r`n" +
    "echo   WebSocket: wss://$Domain`:$Port" + "`r`n" +
    "echo   HTTPS:     https://$Domain`:$Port" + "`r`n" +
    'echo.' + "`r`n" +
    "echo Certificate: $CertPath" + "`r`n" +
    "echo Key: $KeyPath" + "`r`n" +
    'echo.' + "`r`n" +
    'echo =============================================================================' + "`r`n" +
    'echo.' + "`r`n" +
    "cd /d `"$InstallDir`"" + "`r`n" +
    'set NODE_ENV=production' + "`r`n" +
    "set WS_PORT=$Port" + "`r`n" +
    'set WS_HOST=0.0.0.0' + "`r`n" +
    'set USE_HTTPS=true' + "`r`n" +
    "set SSL_CERT_PATH=$CertPath" + "`r`n" +
    "set SSL_KEY_PATH=$KeyPath" + "`r`n" +
    'bun run multiplayer/websocket-server.ts' + "`r`n" +
    'pause' + "`r`n"

$batchContent | Out-File -FilePath "$InstallDir\start-https.bat" -Encoding ASCII

# VBS script for background
$vbsContent = 'Set WshShell = CreateObject("WScript.Shell")' + "`r`n" +
    "WshShell.Run ""cmd /c cd /d `""$InstallDir`"" && set NODE_ENV=production && set WS_PORT=$Port && set WS_HOST=0.0.0.0 && set USE_HTTPS=true && set SSL_CERT_PATH=$CertPath && set SSL_KEY_PATH=$KeyPath && bun run multiplayer/websocket-server.ts > logs\https-server.log 2>&1""", 0, False" + "`r`n"

$vbsContent | Out-File -FilePath "$InstallDir\start-https-background.vbs" -Encoding ASCII

# NSSM service script
$nssmContent = '# Install WSS Service' + "`r`n" +
    '$nssmPath = "C:\nssm\nssm.exe"' + "`r`n" +
    '$serviceName = "OpenCodeWSS"' + "`r`n" +
    '$bunPath = "$env:USERPROFILE\.bun\bin\bun.exe"' + "`r`n" +
    "`$installDir = `"$InstallDir`"" + "`r`n" +
    '`r`n' +
    'if (-not (Test-Path $nssmPath)) {' + "`r`n" +
    '    Write-Host "NSSM not found at $nssmPath" -ForegroundColor Red' + "`r`n" +
    '    exit 1' + "`r`n" +
    '}' + "`r`n" +
    '`r`n' +
    '$existingService = Get-Service -Name $serviceName -ErrorAction SilentlyContinue' + "`r`n" +
    'if ($existingService) {' + "`r`n" +
    '    net stop $serviceName' + "`r`n" +
    '    & $nssmPath remove $serviceName confirm' + "`r`n" +
    '}' + "`r`n" +
    '`r`n' +
    "& `$nssmPath install `$serviceName `"`$bunPath`"" + "`r`n" +
    "& `$nssmPath set `$serviceName AppDirectory `"`$installDir`"" + "`r`n" +
    '& $nssmPath set $serviceName AppParameters "run multiplayer/websocket-server.ts"' + "`r`n" +
    '& $nssmPath set $serviceName DisplayName "OpenCode WSS Server"' + "`r`n" +
    '& $nssmPath set $serviceName Description "OpenCode WebSocket Secure Server"' + "`r`n" +
    '& $nssmPath set $serviceName Start SERVICE_AUTO_START' + "`r`n" +
    '`r`n' +
    "`$envVars = `"NODE_ENV=production;WS_PORT=$Port;WS_HOST=0.0.0.0;USE_HTTPS=true;SSL_CERT_PATH=$CertPath;SSL_KEY_PATH=$KeyPath`"" + "`r`n" +
    '& $nssmPath set $serviceName AppEnvironmentExtra $envVars' + "`r`n" +
    '`r`n' +
    '& $nssmPath set $serviceName AppStdout "$installDir\logs\wss-service.log"' + "`r`n" +
    '& $nssmPath set $serviceName AppStderr "$installDir\logs\wss-service-error.log"' + "`r`n" +
    '`r`n' +
    'Write-Host "WSS Service installed!" -ForegroundColor Green' + "`r`n" +
    'Write-Host "Start: net start $serviceName"' + "`r`n" +
    'Write-Host "Stop: net stop $serviceName"' + "`r`n"

$nssmContent | Out-File -FilePath "$InstallDir\install-wss-service.ps1" -Encoding UTF8

Write-Host "  Start scripts generated:" -ForegroundColor Green
Write-Host "    - start-https.bat (foreground)" -ForegroundColor Gray
Write-Host "    - start-https-background.vbs (background)" -ForegroundColor Gray
Write-Host "    - install-wss-service.ps1 (Windows service)" -ForegroundColor Gray

# Show completion info
Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Green
Write-Host "          HTTPS/WSS Configuration Complete!" -ForegroundColor Green
Write-Host "=============================================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Configuration:" -ForegroundColor Cyan
Write-Host "    Protocol: HTTPS/WSS"
Write-Host "    Port: $Port"
Write-Host "    Domain: $Domain"
Write-Host "    Certificate: $CertPath"
Write-Host "    Key: $KeyPath"
Write-Host ""
Write-Host "  Start Options:" -ForegroundColor Cyan
Write-Host "    1. Foreground: $InstallDir\start-https.bat"
Write-Host "    2. Background: $InstallDir\start-https-background.vbs"
Write-Host "    3. Windows Service:"
Write-Host "       - Install: $InstallDir\install-wss-service.ps1"
Write-Host "       - Start: net start OpenCodeWSS"
Write-Host ""
Write-Host "  Access URLs:" -ForegroundColor Cyan
Write-Host "    WSS: wss://$Domain`:$Port"
Write-Host "    HTTPS: https://$Domain`:$Port"
Write-Host ""
Write-Host "  Client Example:" -ForegroundColor Cyan
Write-Host "    const ws = new WebSocket('wss://$Domain`:$Port?session=test&name=user&role=member');"
Write-Host ""
Write-Host "=============================================================================" -ForegroundColor Green
Write-Host "  Important:" -ForegroundColor Yellow
Write-Host "  1. Ensure certificate domain matches access domain"
Write-Host "  2. Ensure certificate is not expired"
Write-Host "  3. Ensure firewall and security group allow port $Port"
Write-Host "=============================================================================" -ForegroundColor Green
