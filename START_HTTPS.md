# OpenCode Chat - HTTPS/WSS 快速启动指南

## ✅ 证书信息

- **域名**: `puckg.xyz` 和 `www.puckg.xyz`
- **证书路径**: `C:\opencode-server\ssl\www.puckg.xyz.pem`
- **私钥路径**: `C:\opencode-server\ssl\www.puckg.xyz.key`

## 🚀 快速启动（3种方式）

### 方式一：一键启用 HTTPS（推荐）

在服务器上以**管理员身份**运行 PowerShell：

```powershell
cd C:\opencode-server
.\enable-https.ps1
```

然后启动服务：

```powershell
# 前台运行（查看日志）
.\start-https.bat

# 或后台运行
.\start-https-background.vbs
```

### 方式二：手动配置

1. **编辑 .env 文件**：

```powershell
notepad C:\opencode-server\.env
```

2. **添加以下配置**：

```env
# HTTPS/WSS 配置
USE_HTTPS=true
SSL_CERT_PATH=C:\opencode-server\ssl\www.puckg.xyz.pem
SSL_KEY_PATH=C:\opencode-server\ssl\www.puckg.xyz.key
```

3. **启动服务**：

```powershell
cd C:\opencode-server
$env:USE_HTTPS="true"
$env:SSL_CERT_PATH="C:\opencode-server\ssl\www.puckg.xyz.pem"
$env:SSL_KEY_PATH="C:\opencode-server\ssl\www.puckg.xyz.key"
bun run multiplayer/websocket-server.ts
```

### 方式三：Windows 服务（生产环境）

```powershell
# 1. 先运行 enable-https.ps1 生成服务脚本
.\enable-https.ps1

# 2. 安装 NSSM (https://nssm.cc/download) 到 C:\nssm\

# 3. 安装并启动 Windows 服务
.\install-wss-service.ps1
net start OpenCodeWSS
```

## 🌐 访问地址

启用 HTTPS 后，可以使用以下地址访问：

| 协议 | 地址 | 说明 |
|------|------|------|
| WSS | `wss://puckg.xyz:3002` | WebSocket Secure |
| HTTPS | `https://puckg.xyz:3002` | HTTP Secure |
| WSS | `wss://www.puckg.xyz:3002` | 带 www 域名 |

## 📱 客户端连接示例

前端代码中使用 WSS 连接：

```javascript
// 使用 WSS 协议
const ws = new WebSocket('wss://puckg.xyz:3002?session=myroom&name=username&role=member');

ws.onopen = () => {
    console.log('WSS 连接已建立');
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('收到消息:', data);
};
```

## 🔒 防火墙配置

确保 Windows 防火墙允许 3002 端口：

```powershell
New-NetFirewallRule -DisplayName "OpenCode WSS" -Direction Inbound -LocalPort 3002 -Protocol TCP -Action Allow
```

## 📝 常见问题

### 证书错误

如果浏览器提示证书不受信任，可能是因为：
1. 证书已过期（检查有效期）
2. 域名不匹配（确保证书包含 `puckg.xyz`）
3. 系统时间不正确

### 端口被占用

```powershell
# 查找占用 3002 端口的进程
Get-Process -Id (Get-NetTCPConnection -LocalPort 3002).OwningProcess

# 结束进程
Stop-Process -Id <PID> -Force
```

### 查看日志

```powershell
# 实时查看日志
Get-Content C:\opencode-server\logs\https-server.log -Tail 50 -Wait

# 或查看服务日志
Get-Content C:\opencode-server\logs\wss-service.log -Tail 50 -Wait
```

## 🔄 停止服务

```powershell
# 停止前台/后台进程
Stop-Process -Name bun -Force

# 或停止 Windows 服务
net stop OpenCodeWSS
```

## 📋 完整部署流程

1. **上传项目到服务器**
2. **运行部署脚本**: `.\deploy-to-server.ps1`
3. **配置环境变量**: 编辑 `.env` 文件
4. **启用 HTTPS**: `.\enable-https.ps1`
5. **启动服务**: `.\start-https.bat`

完成后即可通过 `wss://puckg.xyz:3002` 安全连接！
