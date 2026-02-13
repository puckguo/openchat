# OpenCode Chat - Windows 云服务器部署指南

## 📋 部署信息

- **服务器 IP**: 47.97.86.239
- **域名**: www.puckg.xyz
- **SSL 证书**: 已包含在项目 SSL 目录中

## 🚀 快速部署步骤

### 1. 上传项目到服务器

在本地执行以下命令将项目上传到 Windows 服务器：

```powershell
# 使用 PowerShell 压缩项目
Compress-Archive -Path "C:\opencode-chat-deploy\*" -DestinationPath "opencode-deploy.zip" -Force

# 使用 scp 上传到服务器（需要知道服务器密码）
scp opencode-deploy.zip administrator@47.97.86.239:C:\

# 或者使用 RDP 远程桌面连接后手动复制文件
```

### 2. 在服务器上解压并部署

通过 RDP 远程桌面连接到服务器，然后执行：

```powershell
# 以管理员身份打开 PowerShell
# 1. 解压文件
Expand-Archive -Path "C:\opencode-deploy.zip" -DestinationPath "C:\opencode-server" -Force

# 2. 进入项目目录
cd C:\opencode-server

# 3. 设置执行策略（如果提示无法运行脚本）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force

# 4. 运行部署脚本
.\deploy-to-server.ps1
```

### 3. 配置环境变量

编辑 `.env` 文件，填入必要的配置：

```powershell
notepad C:\opencode-server\.env
```

至少需要配置：

```env
# WebSocket 端口（默认 3002）
WS_PORT=3002

# 数据库配置（如需消息持久化）
VITE_RDS_HOST=your-db-host
VITE_RDS_PORT=5432
VITE_RDS_DATABASE=opencode_chat
VITE_RDS_USER=your-db-user
VITE_RDS_PASSWORD=your-db-password
ENABLE_DATABASE=true

# DeepSeek AI 配置（如需 AI 功能）
DEEPSEEK_API_KEY=sk-your-api-key
ENABLE_AI=true

# 阿里云 OSS 配置（如需文件上传）
VITE_OSS_ACCESS_KEY_ID=your-access-key
VITE_OSS_ACCESS_KEY_SECRET=your-secret
VITE_OSS_BUCKET=your-bucket
VITE_OSS_REGION=oss-cn-beijing
ENABLE_OSS=true
```

### 4. 启动服务

#### 方式一：直接运行（测试用）

```powershell
# 启动后端（WebSocket 服务器）
.\start-backend.bat

# 另开一个 PowerShell 窗口启动前端
.\start-frontend.bat
```

#### 方式二：后台运行（推荐）

```powershell
# 双击运行或在 PowerShell 中执行
.\start-backend-background.vbs
.\start-frontend-background.vbs
```

#### 方式三：Windows 服务（生产环境推荐）

```powershell
# 1. 下载 NSSM (https://nssm.cc/download)
# 2. 解压 nssm.exe 到 C:\nssm\
# 3. 安装服务
.\install-backend-service.ps1
.\install-frontend-service.ps1

# 启动服务
net start OpenCodeBackend
net start OpenCodeFrontend
```

### 5. 配置 Web 服务器（Nginx 推荐）

#### 使用 Nginx

1. 下载 Nginx for Windows: https://nginx.org/en/download.html
2. 解压到 `C:\nginx\`
3. 复制配置文件：

```powershell
copy C:\opencode-server\nginx-opencode.conf C:\nginx\conf\sites-enabled\
```

4. 编辑主配置 `C:\nginx\conf\nginx.conf`，在 http 块中添加：

```nginx
include sites-enabled/*.conf;
```

5. 启动 Nginx：

```powershell
cd C:\nginx
start nginx
```

#### 使用 IIS（可选）

```powershell
# 运行 IIS 配置脚本
.\configure-iis.ps1
```

## 🌐 访问地址

部署完成后，可以通过以下地址访问：

| 服务 | 地址 |
|------|------|
| HTTP 前端 | http://47.97.86.239:8080 |
| HTTPS 前端 | https://www.puckg.xyz (配置 Nginx/IIS 后) |
| WebSocket | ws://47.97.86.239:3002 |
| WebSocket SSL | wss://www.puckg.xyz/ws (配置反向代理后) |

## 🔒 安全组配置

确保云服务器安全组已开放以下端口：

- **80** - HTTP
- **443** - HTTPS
- **3002** - WebSocket 后端
- **8080** - HTTP 前端（开发用）

## 📝 常用命令

```powershell
# 查看运行中的 Node/Bun 进程
Get-Process | Where-Object { $_.ProcessName -match "bun" }

# 停止 Bun 进程
Stop-Process -Name "bun" -Force

# 查看日志
type C:\opencode-server\logs\server.log
type C:\opencode-server\logs\frontend.log

# 使用 PM2 管理（可选）
pm install -g pm2
pm2 start ecosystem.config.js
pm2 logs
pm2 restart opencode-ws
```

## 🔧 故障排查

### 无法连接 WebSocket

1. 检查防火墙规则：
```powershell
Get-NetFirewallRule | Where-Object { $_.DisplayName -like "*OpenCode*" }
```

2. 检查服务是否运行：
```powershell
Get-NetTCPConnection -LocalPort 3002
```

3. 查看服务器日志：
```powershell
type C:\opencode-server\logs\server.log
```

### 端口被占用

```powershell
# 查找占用 3002 端口的进程
Get-Process -Id (Get-NetTCPConnection -LocalPort 3002).OwningProcess

# 结束进程
Stop-Process -Id <PID> -Force
```

### SSL 证书问题

确保证书文件存在且路径正确：
```powershell
dir C:\opencode-server\ssl\
```

证书文件：
- `www.puckg.xyz.pem` - 证书文件
- `www.puckg.xyz.key` - 私钥文件

## 🔄 更新部署

```powershell
# 1. 停止服务
net stop OpenCodeBackend
net stop OpenCodeFrontend

# 2. 备份配置
copy C:\opencode-server\.env C:\opencode-server\.env.backup

# 3. 上传新版本并覆盖

# 4. 恢复配置
copy C:\opencode-server\.env.backup C:\opencode-server\.env

# 5. 重新安装依赖
cd C:\opencode-server
bun install

# 6. 启动服务
net start OpenCodeBackend
net start OpenCodeFrontend
```

## 📞 联系方式

如有问题，请检查：
1. 服务器日志文件
2. Windows 事件查看器
3. 防火墙和安全组设置
