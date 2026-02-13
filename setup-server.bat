@echo off
chcp 65001 >nul
echo.
echo =============================================================================
echo           OpenCode Chat - Windows 服务器快速部署
echo =============================================================================
echo.

REM 检查管理员权限
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] 请以管理员身份运行此脚本
    echo 右键点击此文件 -> 以管理员身份运行
    pause
    exit /b 1
)

echo [1/5] 检查环境...

REM 检查 PowerShell
powershell -Command "Get-Host" > nul 2>&1
if %errorLevel% neq 0 (
    echo [错误] PowerShell 不可用
    pause
    exit /b 1
)

echo [2/5] 设置 PowerShell 执行策略...
powershell -Command "Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force" > nul 2>&1

echo [3/5] 运行部署脚本...
powershell -ExecutionPolicy Bypass -File "%~dp0deploy-to-server.ps1" -ServerIP "47.97.86.239" -Domain "www.puckg.xyz"

if %errorLevel% neq 0 (
    echo.
    echo [错误] 部署脚本执行失败
    pause
    exit /b 1
)

echo.
echo [4/5] 配置防火墙...
netsh advfirewall firewall add rule name="OpenCode WebSocket" dir=in action=allow protocol=tcp localport=3002 > nul 2>&1
netsh advfirewall firewall add rule name="OpenCode HTTP" dir=in action=allow protocol=tcp localport=8080 > nul 2>&1
netsh advfirewall firewall add rule name="OpenCode HTTPS" dir=in action=allow protocol=tcp localport=443 > nul 2>&1
echo 防火墙规则已添加

echo.
echo =============================================================================
echo           部署完成!
echo =============================================================================
echo.
echo 请完成以下步骤:
echo.
echo  1. 编辑配置文件:
echo     notepad "C:\opencode-server\.env"
echo.
echo  2. 启动服务(选择一种方式):
echo.
echo     方式 A - 前台运行(测试用):
echo       C:\opencode-server\start-server.ps1
echo.
echo     方式 B - 后台运行:
echo       C:\opencode-server\start-server.ps1 -Background
echo.
echo     方式 C - Windows 服务(推荐生产环境):
echo       1. 下载 NSSM: https://nssm.cc/download
echo       2. 解压到 C:\nssm\
echo       3. 运行: C:\opencode-server\install-backend-service.ps1
echo       4. 运行: C:\opencode-server\install-frontend-service.ps1
echo       5. 启动: net start OpenCodeBackend
echo       6. 启动: net start OpenCodeFrontend
echo.
echo  3. 访问应用:
echo     http://47.97.86.239:8080
echo     ws://47.97.86.239:3002
echo.
echo =============================================================================
pause
