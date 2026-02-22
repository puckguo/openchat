# OpenCode Multiplayer 部署包

## 📦 文件说明

`opencode-multiplayer-server.tar.gz` 是完整的部署包，包含运行 WebSocket 服务器所需的所有文件。

## 📂 包内容

```
opencode-multiplayer-server/
├── src/multiplayer/              # 服务器源代码
│   ├── websocket-server.ts       # WebSocket 服务器主文件
│   ├── websocket-client.ts       # WebSocket 客户端
│   ├── conversation-summary.ts   # 对话总结管理器
│   ├── database.ts               # RDS PostgreSQL 数据库
│   ├── oss.ts                    # 阿里云 OSS 存储
│   ├── ai-service.ts             # DeepSeek AI 服务
│   ├── supabase-auth.ts          # Supabase 认证集成
│   ├── supabase-client.ts        # Supabase 客户端
│   ├── types.ts                  # 类型定义
│   ├── role.ts                   # 角色权限系统
│   ├── mention.ts                # @提及功能
│   ├── sync.ts                   # 版本向量同步
│   ├── storage.ts                # 存储层
│   └── ...                       # 其他模块
├── package.json                  # 依赖配置
├── .env.example                  # 环境变量示例
└── README.md                     # 使用文档
```

## 🚀 快速部署

### 上传到 Windows Server

1. **解压包**

```powershell
# 使用 PowerShell 解压
tar -xzf opencode-multiplayer-server.tar.gz -C C:\

# 或者使用 7-Zip
# 7z x opencode-multiplayer-server.tar.gz
```

2. **安装 Bun**

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
$env:Path = "$env:Path;$env:USERPROFILE\.bun\bin"
```

3. **安装依赖**

```powershell
cd C:\opencode-multiplayer-server
bun install
```

4. **配置环境变量**

```powershell
copy .env.example .env
notepad .env
```

填入你的配置：
```env
# WebSocket 服务器
WS_PORT=3002
WS_HOST=localhost

# RDS PostgreSQL 数据库（消息持久化）
VITE_RDS_HOST=your-rds-host.pg.rds.aliyuncs.com
VITE_RDS_PORT=5432
VITE_RDS_DATABASE=opencode-chat
VITE_RDS_USER=your-db-user
VITE_RDS_PASSWORD=your-db-password
ENABLE_DATABASE=true

# 阿里云 OSS（文件存储）
VITE_OSS_ACCESS_KEY_ID=your-access-key
VITE_OSS_ACCESS_KEY_SECRET=your-secret-key
VITE_OSS_BUCKET=your-bucket
VITE_OSS_REGION=oss-cn-beijing
ENABLE_OSS=true

# DeepSeek AI
DEEPSEEK_API_KEY=sk-your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_MAX_TOKENS=2000
ENABLE_AI=true

# Supabase 认证（可选）
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
ENABLE_SUPABASE_AUTH=false
ALLOW_ANONYMOUS=true
```

5. **启动服务器**

```powershell
bun run start
```

### 上传到 Linux 服务器

```bash
# 1. 上传到服务器
scp opencode-multiplayer-server.tar.gz root@your-server:/opt/

# 2. 解压
ssh root@your-server "cd /opt && tar -xzf opencode-multiplayer-server.tar.gz"

# 3. 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 4. 安装依赖
ssh root@your-server "cd /opt/opencode-multiplayer-server && bun install"

# 5. 配置环境变量
ssh root@your-server "cd /opt/opencode-multiplayer-server && cp .env.example .env"
# 编辑 .env 文件

# 6. 启动
ssh root@your-server "cd /opt/opencode-multiplayer-server && bun run start"
```

## 🔧 生产环境部署

### 使用 Systemd (Linux)

```bash
sudo tee /etc/systemd/system/opencode-ws.service > /dev/null << 'EOF'
[Unit]
Description=OpenCode Multiplayer Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/opencode-multiplayer-server
Environment=NODE_ENV=production
Environment=WS_PORT=3001
ExecStart=/root/.bun/bin/bun run src/multiplayer/websocket-server.ts
Environment=ENABLE_DATABASE=true
Environment=ENABLE_OSS=true
Environment=ENABLE_AI=true
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable opencode-ws
sudo systemctl start opencode-ws
```

### 使用 Windows 服务

使用 NSSM 将服务器安装为 Windows 服务。

## ✨ 功能特性

### 核心功能
- **多人实时聊天** - 支持多用户同时在线协作
- **角色权限系统** - Owner/Admin/Member/Guest/AI 五种角色
- **消息持久化** - RDS PostgreSQL 存储所有聊天记录
- **文件存储** - 阿里云 OSS 存储上传的文件
- **AI 智能助手** - @ai 触发 DeepSeek AI 响应

### 📝 智能总结功能
- **总结聊天** - 一键生成对话总结，包含主要话题、决策、待办事项
- **清空AI记忆** - 重置 AI 上下文，开始新话题
- **上下文优化** - AI 自动使用"总结 + 最近消息"，提升响应质量

## 📖 使用说明

### 启动服务器

**基础模式（仅 WebSocket）：**
```bash
bun run src/multiplayer/websocket-server.ts
```

**完整模式（推荐）：**
```bash
# Linux/Mac
ENABLE_DATABASE=true ENABLE_OSS=true ENABLE_AI=true WS_PORT=3002 bun run src/multiplayer/websocket-server.ts

# Windows PowerShell
$env:ENABLE_DATABASE="true"; $env:ENABLE_OSS="true"; $env:ENABLE_AI="true"; $env:WS_PORT="3002"; bun run src/multiplayer/websocket-server.ts
```

### 前端测试

```bash
# 启动 HTTP 服务器
python -m http.server 8081

# 访问测试页面
# http://localhost:8081/test-frontend.html
```

**测试页面功能：**
- WebSocket 连接
- 实时消息收发
- @ai / @all 提及
- 文件上传（自动上传到 OSS）
- 📝 **总结聊天** - 生成对话总结
- 🧹 **清空AI记忆** - 重置上下文

### 消息类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `message` | 普通消息 | `{"type":"message","message":{"content":"你好"}}` |
| `summarize` | 总结聊天 | `{"type":"summarize"}` |
| `clear_ai_memory` | 清空AI记忆 | `{"type":"clear_ai_memory"}` |
| `get_history` | 获取历史 | `{"type":"get_history","limit":50}` |

## 🔌 客户端连接

部署完成后，客户端使用以下方式连接：

```javascript
const client = new SupabaseWebSocketClient(
  { url: "ws://your-server:3001" },
  {
    onMessage: (msg) => console.log(`${msg.senderName}: ${msg.content}`),
  }
)

await client.signInWithPassword("user@example.com", "password")
await client.connect("my-session")
```

## 🛡️ 防火墙配置

**Windows:**
```powershell
New-NetFirewallRule -DisplayName "OpenCode WebSocket" -Direction Inbound -LocalPort 3002 -Protocol TCP -Action Allow
```

**Linux:**
```bash
ufw allow 3002/tcp
```

**云服务商:**
- 阿里云/腾讯云/AWS: 添加 TCP 3002 端口入站规则

**端口说明:**
- `3002` - WebSocket 服务器（默认）
- `8081` - HTTP 测试服务器（本地开发）

## 👥 邀请朋友使用

部署完成后，发送给朋友的信息模板：

```
🎉 OpenCode 聊天室已部署！

🔗 连接地址: ws://your-server-ip:3002
📝 会话名称: team-chat（自定义）

使用方式:
1. 访问 http://your-server-ip:8081/test-frontend.html
2. 输入会话名称和用户名
3. 点击连接开始聊天

功能:
- @ai 问 AI 助手问题
- 上传文件分享
- 点击"总结聊天"生成对话总结
```

## 📚 更多信息

查看完整文档:
- `README.md` - 使用文档
- `DEPLOY_TO_SERVER.md` - **完整服务器部署教程**
- `docs/Online-Deployment.md` - 在线部署指南
- `docs/Windows-Server-Deployment.md` - Windows Server 部署指南
- `docs/Supabase-Integration.md` - Supabase 集成说明
