# OpenCode Server 快速启动指南

## 📦 文件说明

```
opencode-server/
├── multiplayer/          # 服务器源代码
│   ├── websocket-server.ts      # WebSocket 主服务
│   ├── conversation-summary.ts  # 对话总结管理
│   ├── database.ts              # RDS PostgreSQL
│   ├── oss.ts                   # 阿里云 OSS
│   ├── ai-service.ts            # DeepSeek AI
│   ├── supabase-auth.ts         # 认证（可选）
│   └── ...                      # 其他模块
├── package.json          # 依赖配置（已精简）
├── .env                  # 配置文件（需要修改）
├── tsconfig.json         # TypeScript 配置
├── bunfig.toml          # Bun 配置
├── START.md             # 本文件
├── DEPLOY_TO_SERVER.md  # 详细部署教程
└── README.md            # 使用说明
```

## 🚀 快速启动（3步）

### 第1步：安装 Bun

```bash
# Windows PowerShell
powershell -c "irm bun.sh/install.ps1 | iex"

# Linux/Mac
curl -fsSL https://bun.sh/install | bash
```

### 第2步：安装依赖

```bash
cd opencode-server
bun install
```

### 第3步：配置并启动

1. 编辑 `.env` 文件，填入你的实际配置：
   - RDS 数据库信息
   - 阿里云 OSS 信息
   - DeepSeek API Key

2. 启动服务器：

```bash
# Windows PowerShell
$env:ENABLE_DATABASE="true"; $env:ENABLE_OSS="true"; $env:ENABLE_AI="true"; bun run multiplayer/websocket-server.ts

# Linux/Mac
ENABLE_DATABASE=true ENABLE_OSS=true ENABLE_AI=true bun run multiplayer/websocket-server.ts
```

## ✅ 验证部署

```bash
# 测试健康检查
curl http://localhost:3002/health

# 应返回: {"status":"ok",...}
```

## 👥 朋友连接

告诉你的朋友：
- WebSocket 地址: `ws://your-server-ip:3002`
- 会话名称: 你们约定的房间名

或使用网页版（需要部署前端文件）：
- 访问: `http://your-server-ip:8081/test-frontend.html`

## 📚 详细文档

- `DEPLOY_TO_SERVER.md` - 完整的服务器部署教程
- `DEPLOY_PACKAGE.md` - 部署包使用说明
- `README.md` - 功能介绍和使用指南

## 🔧 常用命令

```bash
# 开发模式（自动重启）
bun run dev

# 生产模式
bun run start

# 后台运行（Linux）
nohup bun run multiplayer/websocket-server.ts > server.log 2>&1 &
```

## ⚠️ 注意事项

1. 必须修改 `.env` 文件中的配置才能正常使用
2. 确保服务器防火墙放行 3002 端口
3. 确保云服务商安全组允许 3002 端口入站
4. 不要将包含真实密钥的 `.env` 文件提交到 Git

祝你部署顺利！🎉
