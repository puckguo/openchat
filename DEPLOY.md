# Open CoChat 部署指南

## 快速部署（推荐）

### 使用 Docker Compose（最简单）

```bash
# 1. 克隆仓库
git clone https://github.com/puckguo/opencochat.git
cd opencochat

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的 DeepSeek API Key

# 3. 启动服务
docker-compose up -d

# 4. 访问
# http://localhost:8080
```

### 使用 Docker

```bash
docker run -d \
  --name opencochat \
  -p 3002:3002 \
  -p 8080:8080 \
  -e DEEPSEEK_API_KEY=your-deepseek-api-key \
  -e DATABASE_URL=postgresql://user:pass@host:5432/opencochat \
  ghcr.io/puckguo/opencochat:latest
```

## 手动部署

### 环境要求

- Node.js 18+ 或 Bun 1.1+
- PostgreSQL 14+

### 步骤

```bash
# 1. 克隆仓库
git clone https://github.com/puckguo/opencochat.git
cd opencochat

# 2. 安装依赖
bun install

# 3. 配置环境变量
cp .env.example .env
nano .env

# 4. 启动服务
bun start
```

## 环境变量配置

### 必需配置

```env
# WebSocket 服务器
WS_PORT=3002
WS_HOST=0.0.0.0
HTTP_PORT=8080

# AI 服务
DEEPSEEK_API_KEY=sk-your-key
ENABLE_AI=true

# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/opencochat
ENABLE_DATABASE=true
```

### 可选配置（语音功能）

```env
# 阿里云 ASR - 实时语音识别
DASHSCOPE_API_KEY=sk-your-key
ENABLE_TRANSCRIPTION=true

# 火山引擎实时语音 - 端到端语音对话
VOLCANO_APP_ID=your-app-id
VOLCANO_ACCESS_KEY=your-access-key
VOLCANO_SECRET_KEY=your-secret-key
ENABLE_VOICE_AI=true
```

## 端口说明

| 端口 | 用途 |
|------|------|
| 3002 | WebSocket 服务（实时通信） |
| 8080 | HTTP 前端服务 |

## 生产环境建议

1. **使用反向代理**（Nginx/Caddy）处理 HTTPS
2. **配置防火墙**只开放必要端口
3. **定期备份数据库**
4. **使用 PM2 或 Systemd** 管理进程

## 常见问题

**Q: 无法连接 WebSocket？**
A: 检查防火墙是否开放 3002 端口，确保 WS_HOST 设置为 0.0.0.0

**Q: AI 没有响应？**
A: 检查 DEEPSEEK_API_KEY 是否正确，查看日志确认 ENABLE_AI=true

**Q: 语音识别不工作？**
A: 确认 DASHSCOPE_API_KEY 有效，并已在阿里云开通语音识别服务

## 详细文档

- [完整部署文档](docs/DEPLOYMENT.md)
- [阿里云 ASR 集成](skill/aliyun/README.md)
- [火山引擎语音集成](skill/volcano-voice-ai-integration.md)
