# Open CoChat - 手动启用 HTTPS/WSS

如果 PowerShell 脚本出现编码问题，请使用以下手动步骤启用 HTTPS。

## 🚀 方法：直接修改 .env 文件

### 步骤 1: 编辑 .env 文件

在服务器上打开 PowerShell，运行：

```powershell
notepad C:\opencode-server\.env
```

### 步骤 2: 添加 HTTPS 配置

在文件末尾添加以下内容：

```env
# HTTPS/WSS Configuration
USE_HTTPS=true
SSL_CERT_PATH=C:\opencode-server\ssl\www.puckg.xyz.pem
SSL_KEY_PATH=C:\opencode-server\ssl\www.puckg.xyz.key
SSL_DOMAIN=puckg.xyz
```

### 步骤 3: 保存并关闭

按 `Ctrl+S` 保存，然后关闭记事本。

### 步骤 4: 配置防火墙

在 PowerShell 中运行（管理员权限）：

```powershell
New-NetFirewallRule -DisplayName "OpenCode HTTPS WSS" -Direction Inbound -LocalPort 3002 -Protocol TCP -Action Allow
```

### 步骤 5: 启动 HTTPS 服务

#### 方式 A: 前台运行（查看日志）

创建 `start-https.bat` 文件：

```batch
@echo off
chcp 65001 >nul
cd /d "C:\opencode-server"
set NODE_ENV=production
set WS_PORT=3002
set WS_HOST=0.0.0.0
set USE_HTTPS=true
set SSL_CERT_PATH=C:\opencode-server\ssl\www.puckg.xyz.pem
set SSL_KEY_PATH=C:\opencode-server\ssl\www.puckg.xyz.key
bun run multiplayer/websocket-server.ts
pause
```

双击运行 `start-https.bat`

#### 方式 B: 后台运行

在 PowerShell 中运行：

```powershell
cd C:\opencode-server
$env:NODE_ENV="production"
$env:WS_PORT="3002"
$env:WS_HOST="0.0.0.0"
$env:USE_HTTPS="true"
$env:SSL_CERT_PATH="C:\opencode-server\ssl\www.puckg.xyz.pem"
$env:SSL_KEY_PATH="C:\opencode-server\ssl\www.puckg.xyz.key"
Start-Process -FilePath "bun" -ArgumentList "run", "multiplayer/websocket-server.ts" -WindowStyle Hidden
```

#### 方式 C: Windows 服务（推荐生产环境）

1. 下载 NSSM: https://nssm.cc/download
2. 解压 `nssm.exe` 到 `C:\nssm\`
3. 在 PowerShell 中运行：

```powershell
$nssm = "C:\nssm\nssm.exe"
$bun = "$env:USERPROFILE\.bun\bin\bun.exe"
$dir = "C:\opencode-server"

# Install service
& $nssm install OpenCodeWSS `"$bun`"
& $nssm set OpenCodeWSS AppDirectory `"$dir`"
& $nssm set OpenCodeWSS AppParameters "run multiplayer/websocket-server.ts"
& $nssm set OpenCodeWSS DisplayName "OpenCode WSS Server"

# Set environment variables
$envVars = "NODE_ENV=production;WS_PORT=3002;WS_HOST=0.0.0.0;USE_HTTPS=true;SSL_CERT_PATH=C:\opencode-server\ssl\www.puckg.xyz.pem;SSL_KEY_PATH=C:\opencode-server\ssl\www.puckg.xyz.key"
& $nssm set OpenCodeWSS AppEnvironmentExtra $envVars

# Start service
net start OpenCodeWSS
```

## 🌐 验证 HTTPS

启动后，可以通过以下地址访问：

- **WSS**: `wss://puckg.xyz:3002`
- **HTTPS**: `https://puckg.xyz:3002`

## 📝 测试连接

使用浏览器访问：

```
https://puckg.xyz:3002/health
```

或在 PowerShell 中测试：

```powershell
Invoke-WebRequest -Uri "https://puckg.xyz:3002/health" -UseBasicParsing
```

## 🔧 常见问题

### 证书错误

如果浏览器提示证书不受信任：
1. 证书可能已过期
2. 域名不匹配（确保证书包含 `puckg.xyz`）
3. 需要手动信任证书

### 端口被占用

```powershell
# 查找占用 3002 端口的进程
Get-NetTCPConnection -LocalPort 3002

# 结束进程
Stop-Process -Id <PID> -Force
```

### 查看日志

```powershell
# 如果在前台运行，日志直接显示在窗口中
# 如果在后台运行，检查日志文件
Get-Content C:\opencode-server\logs\*.log -Tail 50
```

## ✅ 完成

启用 HTTPS 后，前端可以使用 `wss://puckg.xyz:3002` 安全连接 WebSocket 服务器。
