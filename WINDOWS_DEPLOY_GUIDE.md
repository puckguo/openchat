# OpenCode Chat - Windows 云服务器部署完整指南

## 📋 部署概览

- **服务器 IP**: `47.97.86.239`
- **域名**: `www.puckg.xyz`
- **SSL 证书**: 位于 `SSL/` 目录
  - `www.puckg.xyz.pem` - 证书文件
  - `www.puckg.xyz.key` - 私钥文件

## 🎯 部署架构

```
┌─────────────────────────────────────────────────────────────┐
│                    用户访问层                                │
│  http://47.97.86.239:8080  or  https://www.puckg.xyz       │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                   Windows 云服务器                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Nginx / IIS (可选)                                  │   │
│  │  - 反向代理 WebSocket                                │   │
│  │  - HTTPS 终端                                        │   │
│  └──────────────┬──────────────────┬────────────────────┘   │
│                 │                  │                        │
│  ┌──────────────▼──────┐  ┌───────▼────────────────┐       │
│  │  前端 HTTP 服务器    │  │  WebSocket 后端服务器   │       │
│  │  Port: 8080         │  │  Port: 3002            │       │
│  │  - 静态文件服务      │  │  - 实时通信             │       │
│  │  - index.html       │  │  - 消息处理             │       │
│  └─────────────────────┘  └────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

## 🚀 快速部署步骤

### 方法一：使用部署脚本（推荐）

#### 1. 上传项目到服务器

**方式 A - 使用 PowerShell 远程:**
```powershell
# 在本地运行
.\upload-and-deploy.ps1
```

**方式 B - 手动上传:**
1. 压缩项目文件夹
2. 通过 RDP 远程桌面连接到 `47.97.86.239`
3. 将压缩包复制到服务器 `C:\`
4. 解压到 `C:\opencode-server\`

#### 2. 在服务器上运行部署脚本

通过 RDP 连接到服务器，然后:

```powershell
# 以管理员身份运行 PowerShell
# 进入项目目录
cd C:\opencode-server

# 方式 1: 使用 PowerShell 脚本
.\deploy-to-server.ps1

# 方式 2: 使用批处理文件(双击运行)
setup-server.bat
```

#### 3. 配置环境变量

编辑 `.env` 文件，配置必要的服务:

```powershell
notepad C:\opencode-server\.env
```

最小配置示例:
```env
# 服务器配置
WS_PORT=3002
WS_HOST=0.0.0.0
NODE_ENV=production

# 数据库配置 (PostgreSQL - 可选但推荐)
VITE_RDS_HOST=your-postgres-host
VITE_RDS_PORT=5432
VITE_RDS_DATABASE=opencode_chat
VITE_RDS_USER=your-db-user
VITE_RDS_PASSWORD=your-db-password
ENABLE_DATABASE=true

# DeepSeek AI 配置 (可选)
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
ENABLE_AI=true

# 阿里云 OSS 配置 (文件上传 - 可选)
VITE_OSS_ACCESS_KEY_ID=your-access-key
VITE_OSS_ACCESS_KEY_SECRET=your-secret
VITE_OSS_BUCKET=your-bucket
VITE_OSS_REGION=oss-cn-beijing
ENABLE_OSS=true

# 阿里云 DashScope (语音聊天 - 可选)
DASHSCOPE_API_KEY=sk-your-dashscope-key
ENABLE_VOICE_CHAT=true
```

#### 4. 启动服务

**方式 A - 前台运行 (测试用):**
```powershell
.\start-server.ps1
```

**方式 B - 后台运行:**
```powershell
.\start-server.ps1 -Background
```

**方式 C - Windows 服务 (生产环境推荐):**
```powershell
# 1. 下载 NSSM: https://nssm.cc/download
# 2. 解压 nssm.exe 到 C:\nssm\

# 安装后端服务
.\install-backend-service.ps1

# 安装前端服务
.\install-frontend-service.ps1

# 启动服务
net start OpenCodeBackend
net start OpenCodeFrontend

# 设置开机自启
sc config OpenCodeBackend start= auto
sc config OpenCodeFrontend start= auto
```

### 方法二：手动分步部署

如果脚本运行失败，可以手动部署:

#### 1. 安装 Bun

```powershell
# 在服务器上以管理员身份运行 PowerShell
powershell -c "irm bun.sh/install.ps1 | iex"

# 添加到 PATH
$env:Path = "$env:Path;$env:USERPROFILE\.bun\bin"
[Environment]::SetEnvironmentVariable(
    "Path",
    [Environment]::GetEnvironmentVariable("Path", "Machine") + ";$env:USERPROFILE\.bun\bin",
    "Machine"
)

# 验证安装
bun --version
```

#### 2. 准备项目

```powershell
# 创建目录
mkdir C:\opencode-server
cd C:\opencode-server

# 复制项目文件 (通过 RDP 或 scp)
# 需要复制的文件:
# - multiplayer/
# - public/
# - SSL/
# - package.json
# - tsconfig.json
# - .env (从 .env.example 复制并编辑)
```

#### 3. 安装依赖

```powershell
cd C:\opencode-server
bun install
```

#### 4. 启动后端

```powershell
$env:NODE_ENV = "production"
$env:WS_PORT = 3002
$env:WS_HOST = "0.0.0.0"
bun run multiplayer/websocket-server.ts
```

#### 5. 启动前端

```powershell
# 创建前端服务器脚本 frontend-server.ts
# (参考 deploy-to-server.ps1 中生成的脚本)

bun run frontend-server.ts
```

## 🔒 配置 HTTPS (使用 Nginx)

### 1. 下载并安装 Nginx

```powershell
# 下载 Nginx for Windows
# https://nginx.org/en/download.html

# 解压到 C:\nginx\
Expand-Archive -Path nginx-1.24.0.zip -DestinationPath C:\
Rename-Item -Path C:\nginx-1.24.0 -NewName C:\nginx
```

### 2. 配置 Nginx

复制配置文件:
```powershell
copy C:\opencode-server\nginx-opencode.conf C:\nginx\conf\nginx.conf
```

或使用以下配置:

```nginx
worker_processes 1;

events {
    worker_connections 1024;
}

http {
    include mime.types;
    default_type application/octet-stream;
    sendfile on;
    keepalive_timeout 65;

    # HTTP to HTTPS redirect
    server {
        listen 80;
        server_name www.puckg.xyz;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS server
    server {
        listen 443 ssl;
        server_name www.puckg.xyz;

        # SSL certificates
        ssl_certificate C:/opencode-server/ssl/www.puckg.xyz.pem;
        ssl_certificate_key C:/opencode-server/ssl/www.puckg.xyz.key;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        # Static files (frontend)
        location / {
            root C:/opencode-server/public;
            index index.html;
            try_files $uri $uri/ /index.html;

            # CORS headers
            add_header 'Access-Control-Allow-Origin' '*' always;
            add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
        }

        # WebSocket proxy
        location /ws {
            proxy_pass http://localhost:3002;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400;
            proxy_send_timeout 86400;
        }
    }
}
```

### 3. 启动 Nginx

```powershell
cd C:\nginx
start nginx

# 验证配置
nginx -t

# 重新加载配置
nginx -s reload
```

## 🌐 访问地址

| 服务 | 地址 | 说明 |
|------|------|------|
| HTTP 前端 | http://47.97.86.239:8080 | 直接访问 |
| WebSocket | ws://47.97.86.239:3002 | WebSocket 连接 |
| HTTPS | https://www.puckg.xyz | 配置 Nginx 后 |
| WebSocket SSL | wss://www.puckg.xyz/ws | 配置 Nginx 后 |

## 🛡️ 防火墙配置

确保 Windows 防火墙和云服务器安全组已开放以下端口:

```powershell
# Windows 防火墙规则
New-NetFirewallRule -DisplayName "OpenCode HTTP" -Direction Inbound -LocalPort 8080 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "OpenCode WebSocket" -Direction Inbound -LocalPort 3002 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "OpenCode HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "OpenCode HTTP 80" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
```

## 🔧 常用管理命令

### 查看服务状态

```powershell
# 查看 Bun 进程
Get-Process | Where-Object { $_.ProcessName -match "bun" }

# 查看端口占用
Get-NetTCPConnection -LocalPort 3002
Get-NetTCPConnection -LocalPort 8080

# 查看服务
Get-Service | Where-Object { $_.Name -like "*OpenCode*" }
```

### 停止服务

```powershell
# 停止 Bun 进程
Stop-Process -Name "bun" -Force

# 停止 Windows 服务
net stop OpenCodeBackend
net stop OpenCodeFrontend
```

### 查看日志

```powershell
# 实时查看后端日志
Get-Content C:\opencode-server\logs\server.log -Tail 50 -Wait

# 实时查看前端日志
Get-Content C:\opencode-server\logs\frontend.log -Tail 50 -Wait

# 查看 Windows 服务日志
Get-Content C:\opencode-server\logs\backend-service.log -Tail 50
```

### 重启服务

```powershell
# 重启 Windows 服务
net stop OpenCodeBackend
net start OpenCodeBackend

net stop OpenCodeFrontend
net start OpenCodeFrontend
```

## 📝 更新部署

```powershell
# 1. 停止现有服务
net stop OpenCodeBackend
net stop OpenCodeFrontend

# 2. 备份配置
copy C:\opencode-server\.env C:\opencode-server\.env.backup.$(Get-Date -Format 'yyyyMMdd')

# 3. 上传新版本并覆盖文件

# 4. 恢复配置
copy C:\opencode-server\.env.backup.xxxxxx C:\opencode-server\.env

# 5. 重新安装依赖
cd C:\opencode-server
bun install

# 6. 启动服务
net start OpenCodeBackend
net start OpenCodeFrontend
```

## 🐛 故障排查

### 问题: 无法连接 WebSocket

1. **检查防火墙:**
   ```powershell
   Get-NetFirewallRule | Where-Object { $_.DisplayName -like "*OpenCode*" }
   ```

2. **检查端口监听:**
   ```powershell
   netstat -ano | findstr :3002
   ```

3. **检查安全组:** 确保云服务商安全组允许入站连接

### 问题: 前端无法访问

1. **检查前端服务:**
   ```powershell
   Get-NetTCPConnection -LocalPort 8080
   ```

2. **检查文件是否存在:**
   ```powershell
   dir C:\opencode-server\public\index.html
   ```

### 问题: SSL/HTTPS 无法工作

1. **检查证书文件:**
   ```powershell
   dir C:\opencode-server\ssl\
   ```

2. **检查 Nginx 配置:**
   ```powershell
   cd C:\nginx
   nginx -t
   ```

3. **检查证书是否匹配域名:**
   确保证书是用于 `www.puckg.xyz`

### 问题: AI 功能无响应

1. **检查 API Key:**
   ```powershell
   Get-Content C:\opencode-server\.env | findstr DEEPSEEK
   ```

2. **查看服务器日志中的 AI 相关错误**

### 问题: 文件上传失败

1. **检查 OSS 配置:**
   ```powershell
   Get-Content C:\opencode-server\.env | findstr OSS
   ```

2. **确认 OSS Bucket 权限和 CORS 设置**

## 📞 联系方式

如有问题，请检查:
1. 服务器日志文件
2. Windows 事件查看器 (`eventvwr.msc`)
3. 防火墙和安全组设置
4. 依赖服务状态 (PostgreSQL, OSS 等)
