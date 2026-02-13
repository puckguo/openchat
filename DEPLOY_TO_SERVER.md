# OpenCode Multiplayer 服务器部署指南

## 🎯 部署概述

将 OpenCode Multiplayer 部署到云服务器，与朋友共同使用。

**部署架构:**
```
[朋友A] ←──→ [云服务器:3002] ←──→ [朋友B]
                ↓
        [RDS PostgreSQL] ←── 消息持久化
                ↓
        [阿里云 OSS] ←── 文件存储
```

## 📋 准备工作

### 1. 你需要准备的资源

| 资源 | 用途 | 推荐配置 |
|------|------|----------|
| 云服务器 | 运行 WebSocket 服务 | 2核4G, Windows/Linux |
| RDS PostgreSQL | 存储聊天记录 | 1核1G 即可 |
| 阿里云 OSS | 存储文件 | 按量付费 |
| DeepSeek API Key | AI 助手功能 | 免费额度可用 |

### 2. 需要配置的私密信息

所有私密配置都集中在 `.env` 文件中：

```env
# =============================================================================
# RDS PostgreSQL Database (消息持久化存储)
# =============================================================================
VITE_RDS_HOST=your-rds-host.pg.rds.aliyuncs.com
VITE_RDS_PORT=5432
VITE_RDS_DATABASE=opencode-chat
VITE_RDS_USER=your-db-user
VITE_RDS_PASSWORD=your-db-password
ENABLE_DATABASE=true

# =============================================================================
# Alibaba Cloud OSS (文件存储)
# =============================================================================
VITE_OSS_ACCESS_KEY_ID=your-access-key-id
VITE_OSS_ACCESS_KEY_SECRET=your-access-key-secret
VITE_OSS_BUCKET=your-bucket-name
VITE_OSS_REGION=oss-cn-beijing
ENABLE_OSS=true

# =============================================================================
# DeepSeek AI (AI 助手功能)
# =============================================================================
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_MAX_TOKENS=8192
ENABLE_AI=true

# =============================================================================
# Supabase Auth (可选)
# =============================================================================
# SUPABASE_URL=https://your-project.supabase.co
# SUPABASE_PUBLISHABLE_KEY=your-publishable-key
# SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# ENABLE_SUPABASE_AUTH=false
# ALLOW_ANONYMOUS=true
```

---

## 🚀 一键部署方式（推荐）

### Linux 服务器一键部署

#### 方式1：直接在服务器上运行部署脚本

```bash
# 1. 上传项目文件到服务器
scp -r opencode-server root@your-server-ip:/opt/

# 2. SSH 登录服务器
ssh root@your-server-ip

# 3. 进入项目目录并运行部署脚本
cd /opt/opencode-server
chmod +x deploy-linux.sh
./deploy-linux.sh
```

#### 方式2：手动分步部署

```bash
# 1. 安装 Bun
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# 2. 创建项目目录
mkdir -p /opt/opencode-server
cd /opt/opencode-server

# 3. 复制项目文件（通过 git clone 或手动上传）
# git clone your-repo-url .

# 4. 安装依赖
bun install

# 5. 配置环境变量
cp .env.example .env
nano .env  # 编辑配置

# 6. 启动服务
bun run multiplayer/websocket-server.ts
```

---

### Windows Server 一键部署

#### 方式1：使用 PowerShell 部署脚本

```powershell
# 1. 以管理员身份打开 PowerShell
# 2. 进入项目目录
cd C:\opencode-server

# 3. 执行部署脚本（如果执行策略受限，先运行以下命令）
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 4. 运行部署脚本
.\deploy-windows.ps1

# 可选参数:
.\deploy-windows.ps1 -InstallDir "D:\Services\OpenCode" -Port 3002
```

#### 方式2：手动分步部署

```powershell
# 1. 安装 Bun
powershell -c "irm bun.sh/install.ps1 | iex"
$env:Path = "$env:Path;$env:USERPROFILE\.bun\bin"

# 2. 进入项目目录
cd C:\opencode-server

# 3. 安装依赖
bun install

# 4. 配置环境变量
copy .env.example .env
notepad .env  # 编辑配置

# 5. 配置防火墙
New-NetFirewallRule -DisplayName "OpenCode WebSocket" -Direction Inbound -LocalPort 3002 -Protocol TCP -Action Allow

# 6. 启动服务
bun run multiplayer/websocket-server.ts
```

---

## ⚙️ 环境变量配置详解

### 创建 .env 文件

```bash
# 从模板复制
cp .env.example .env

# Linux 编辑
nano .env

# Windows 编辑
notepad .env
```

### 配置项说明

| 类别 | 配置项 | 必填 | 说明 |
|------|--------|------|------|
| **WebSocket** | WS_PORT | 否 | 服务器端口，默认 3002 |
| | WS_HOST | 否 | 监听地址，默认 0.0.0.0 |
| | NODE_ENV | 否 | 环境模式，默认 production |
| **数据库** | VITE_RDS_HOST | 是 | RDS PostgreSQL 主机地址 |
| | VITE_RDS_PORT | 否 | 数据库端口，默认 5432 |
| | VITE_RDS_DATABASE | 是 | 数据库名称 |
| | VITE_RDS_USER | 是 | 数据库用户名 |
| | VITE_RDS_PASSWORD | 是 | 数据库密码 |
| | ENABLE_DATABASE | 否 | 是否启用数据库，默认 true |
| **OSS** | VITE_OSS_ACCESS_KEY_ID | 是 | 阿里云 Access Key ID |
| | VITE_OSS_ACCESS_KEY_SECRET | 是 | 阿里云 Access Key Secret |
| | VITE_OSS_BUCKET | 是 | OSS Bucket 名称 |
| | VITE_OSS_REGION | 是 | OSS 区域，如 oss-cn-beijing |
| | ENABLE_OSS | 否 | 是否启用 OSS，默认 true |
| **AI** | DEEPSEEK_API_KEY | 是 | DeepSeek API 密钥 |
| | DEEPSEEK_BASE_URL | 否 | API 基础 URL |
| | DEEPSEEK_MODEL | 否 | 模型名称，默认 deepseek-chat |
| | DEEPSEEK_MAX_TOKENS | 否 | 最大 Token 数，默认 8192 |
| | ENABLE_AI | 否 | 是否启用 AI，默认 true |
| **Supabase** | SUPABASE_URL | 否 | Supabase 项目 URL |
| | SUPABASE_PUBLISHABLE_KEY | 否 | 客户端 Key |
| | SUPABASE_SERVICE_ROLE_KEY | 否 | 服务端 Key |
| | ENABLE_SUPABASE_AUTH | 否 | 是否启用认证，默认 false |

---

## 🔄 服务管理方式

### Linux - Systemd

部署脚本会自动创建 Systemd 服务，使用以下命令管理：

```bash
# 查看状态
systemctl status opencode-ws

# 启动服务
systemctl start opencode-ws

# 停止服务
systemctl stop opencode-ws

# 重启服务
systemctl restart opencode-ws

# 查看日志
journalctl -u opencode-ws -f

# 开机自启
systemctl enable opencode-ws
```

### Windows - 多种方式

#### 方式1：直接运行（测试用）
```powershell
# 使用提供的启动脚本
.\start.bat

# 或开发模式（带热重载）
.\start-dev.bat
```

#### 方式2：PM2 进程管理
```powershell
# 安装 PM2
npm install -g pm2

# 启动服务
cd C:\opencode-server
pm2 start ecosystem.config.js

# 常用命令
pm2 status          # 查看状态
pm2 logs opencode-ws # 查看日志
pm2 stop opencode-ws # 停止服务
pm2 restart opencode-ws # 重启服务
pm2 save            # 保存配置
pm2 startup         # 开机自启
```

#### 方式3：Windows 服务（生产推荐）
```powershell
# 1. 下载 NSSM (https://nssm.cc/download)
# 2. 解压到 C:\nssm\
# 3. 运行安装脚本
.\install-service.ps1

# 管理命令
net start OpenCodeWebSocket    # 启动服务
net stop OpenCodeWebSocket     # 停止服务
sc delete OpenCodeWebSocket    # 删除服务
```

---

## 🧪 测试部署

### 服务器本地测试

```bash
# 测试健康检查端点
curl http://localhost:3002/health

# 应返回类似: {"status":"ok","timestamp":"..."}
```

### 外部连接测试

```bash
# 从本地机器测试服务器
curl http://your-server-ip:3002/health
```

### WebSocket 连接测试

访问前端页面测试连接：
```
http://your-server-ip:8080/index.html
```

---

## 👥 朋友如何连接

部署完成后，发送给朋友的信息模板：

```
🎉 OpenCode 聊天室已部署！

🔗 连接地址: ws://your-server-ip:3002
📝 会话名称: team-chat（自定义）

使用方式:
1. 访问 http://your-server-ip:8080/index.html
2. 输入会话名称和用户名
3. 点击连接开始聊天

功能:
- @ai 问 AI 助手问题
- 上传文件分享
- 点击"总结聊天"生成对话总结
```

---

## 🔧 高级配置

### 使用域名 + HTTPS

#### 1. Nginx 反向代理配置

```nginx
server {
    listen 80;
    server_name chat.yourdomain.com;

    location / {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

#### 2. 申请 SSL 证书

```bash
# 安装 Certbot
sudo apt install certbot python3-certbot-nginx

# 申请证书
sudo certbot --nginx -d chat.yourdomain.com
```

#### 3. 客户端使用
```
wss://chat.yourdomain.com
```

### 配置多个实例（负载均衡）

```bash
# 启动多个端口实例
WS_PORT=3002 bun run multiplayer/websocket-server.ts &
WS_PORT=3003 bun run multiplayer/websocket-server.ts &

# Nginx 负载均衡
upstream opencode_backend {
    server localhost:3002;
    server localhost:3003;
}
```

---

## 📊 监控和维护

### 查看日志

**Linux:**
```bash
# Systemd 日志
journalctl -u opencode-ws -f

# 应用日志
tail -f /opt/opencode-server/server.log
```

**Windows:**
```powershell
# PM2 日志
pm2 logs opencode-ws

# 直接查看日志文件
Get-Content C:\opencode-server\server.log -Tail 50 -Wait
```

### 数据库备份

```bash
# 备份 RDS 数据库
pg_dump -h your-rds-host -U your-user -d opencode-chat > backup_$(date +%Y%m%d).sql

# 自动备份脚本 (添加到 crontab)
0 2 * * * pg_dump -h your-rds-host -U your-user -d opencode-chat > /backup/opencode_$(date +\%Y\%m\%d).sql
```

### 更新服务器

```bash
# 1. 停止服务
systemctl stop opencode-ws

# 2. 备份配置
cp .env .env.backup

# 3. 更新代码
git pull
# 或重新上传新代码

# 4. 安装新依赖
bun install

# 5. 恢复配置
cp .env.backup .env

# 6. 启动服务
systemctl start opencode-ws
```

---

## 🆘 常见问题

### 连接失败

**问题:** 客户端无法连接到服务器

**解决方案:**
1. 检查防火墙是否放行端口
   ```bash
   # Linux
   ufw allow 3002/tcp

   # Windows
   New-NetFirewallRule -DisplayName "OpenCode" -Direction Inbound -LocalPort 3002 -Protocol TCP -Action Allow
   ```
2. 检查云服务商安全组设置
3. 确认服务器 IP 地址正确
4. 检查服务是否运行：`systemctl status opencode-ws`

### AI 无响应

**问题:** @ai 没有响应

**解决方案:**
1. 检查 `DEEPSEEK_API_KEY` 是否正确
2. 确认 API 密钥有剩余额度
3. 查看服务器日志中的 AI 相关错误
4. 检查 `ENABLE_AI=true` 是否设置

### 文件上传失败

**问题:** 无法上传文件

**解决方案:**
1. 检查 OSS 配置（Access Key, Bucket, Region）
2. 确认 OSS Bucket 权限设置正确（需要公共读或授权访问）
3. 检查 Bucket CORS 配置
4. 查看服务器日志中的 OSS 错误

### 消息不保存

**问题:** 聊天消息没有持久化

**解决方案:**
1. 检查 RDS 连接配置
2. 确认 `ENABLE_DATABASE=true`
3. 检查数据库用户权限
4. 查看服务器日志中的数据库连接错误

---

## 📞 技术支持

部署过程中遇到问题：

1. 查看服务器日志 `server.log`
2. 检查各项服务的健康状态
3. 确认所有环境变量已正确设置
4. 检查防火墙和安全组配置

祝你部署顺利！🚀
