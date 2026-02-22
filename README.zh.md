<p align="center">
  <a href="https://github.com/puckguo/opencochat">
    <img src="https://img.shields.io/badge/Open-CoChat-blue?style=for-the-badge" alt="Open CoChat logo" width="200">
  </a>
</p>

<h1 align="center">Open CoChat</h1>
<p align="center">
  <strong>AI 驱动的多人实时语音聊天平台</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a>
</p>

---

## 概述

**Open CoChat** 是一个开源的多人实时语音聊天平台，集成了强大的 AI 助手功能。基于 TypeScript、Bun 和 WebSocket 构建，支持：

- 多人实时语音对话
- AI 实时语音交互（端到端语音对话）
- 实时语音识别（ASR）
- AI 文件访问和命令执行
- 实时团队协作

适用于：
- 需要 AI 辅助协作的开发团队
- 在线教育课堂
- 开源社区交流
- 企业会议

## 核心特性

### 实时语音协作

- 基于 WebSocket 的实时语音传输
- 多人语音聊天室
- 低延迟语音通信
- 语音消息录制和回放
- @提及用户和 AI 助手

### AI 语音助手

- **DeepSeek AI** 集成，提供智能响应
- **火山引擎豆包实时语音模型**支持，实现端到端语音对话
- **阿里云 ASR** 集成，实时语音识别
- **文件系统访问**：AI 可以读取和分析项目文件
- **命令执行**：AI 可以运行终端命令并显示结果

### 语音技术集成

| 功能 | 说明 | 接入文档 |
|------|------|----------|
| 阿里云 ASR | 实时语音识别 | [skill/aliyun-asr.md](#阿里云-asr-接入) |
| 火山引擎实时语音 | 端到端语音对话 | [skill/volcano-voice.md](#火山引擎实时语音接入) |
| DeepSeek AI | 文本AI对话 | 内置支持 |

### 安全与权限

- 5 级角色系统（所有者、管理员、成员、访客、AI）
- 30+ 细粒度权限
- 可选密码保护房间
- 速率限制和滥用防护

## 快速开始

### 环境要求

- CPU：2 核
- RAM：4GB
- 磁盘：10GB
- 操作系统：Linux/macOS/Windows
- Node.js 18+ 或 Bun 1.1+

### 安装步骤

```bash
# 克隆仓库
git clone https://github.com/puckguo/opencochat.git
cd opencochat

# 安装依赖（使用 Bun）
bun install

# 或使用 npm
npm install

# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件，填入必要的配置
nano .env
```

### 必需的环境变量

```env
# WebSocket 服务器配置
WS_PORT=3002
WS_HOST=0.0.0.0
HTTP_PORT=8080

# AI 服务（必需）
DEEPSEEK_API_KEY=your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
ENABLE_AI=true

# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/opencochat
ENABLE_DATABASE=true
```

### 启动服务

```bash
# 开发模式
bun run dev

# 生产模式
bun start
```

访问 `http://localhost:8080`

## 部署指南

### Docker 部署（推荐）

```bash
# 使用 Docker Compose
docker-compose up -d

# 或直接使用 Docker
docker run -d \
  --name opencochat \
  -p 3002:3002 \
  -p 8080:8080 \
  -e DEEPSEEK_API_KEY=your-key \
  ghcr.io/puckguo/opencochat:latest
```

### 生产环境部署

详细部署说明请参考 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 语音功能接入指南

### 阿里云 ASR 接入

阿里云 ASR（自动语音识别）提供实时语音转文字能力。

#### 1. 配置环境变量

```env
# 阿里云 ASR 配置
DASHSCOPE_API_KEY=sk-your-dashscope-api-key
ENABLE_TRANSCRIPTION=true
```

#### 2. 获取 API Key

1. 登录 [阿里云 DashScope 控制台](https://dashscope.console.aliyun.com/)
2. 创建 API Key
3. 开通实时语音识别服务

#### 3. 使用方式

启用后，用户在语音聊天中的语音将自动转录为文字，AI 可以基于转录内容进行回复。

#### 详细文档

查看 [skill/aliyun/README.md](skill/aliyun/README.md) 获取完整的阿里云集成指南。

---

### 火山引擎实时语音接入

火山引擎豆包端到端实时语音大模型提供低延迟的语音到语音对话能力。

#### 1. 配置环境变量

```env
# 火山引擎配置
VOLCANO_APP_ID=your-app-id
VOLCANO_ACCESS_KEY=your-access-key
VOLCANO_SECRET_KEY=your-secret-key
VOLCANO_ENDPOINT=wss://openspeech.bytedance.com/api/v3/realtime/dialogue
VOLCANO_API_APP_KEY=PlgvMymc7f3tQnJ6
VOLCANO_API_RESOURCE_ID=volc.speech.dialog
ENABLE_VOICE_AI=true
```

#### 2. 获取认证信息

1. 登录 [火山引擎控制台](https://console.volcengine.com/)
2. 开通"端到端实时语音大模型"服务
3. 在「访问控制」创建 Access Key

#### 3. 功能特性

- **端到端语音对话**：语音输入 → AI 处理 → 语音输出
- **实时 ASR**：语音识别结果实时返回
- **流式 TTS**：AI 语音合成实时播放
- **低延迟**：端到端延迟 < 1 秒

#### 详细文档

查看 [skill/volcano-voice-ai-integration.md](skill/volcano-voice-ai-integration.md) 获取完整的集成指南。

## 使用示例

### 创建语音聊天室

1. 访问 `http://your-server:8080`
2. 点击"新建会话"
3. 输入会话名称并启用"AI 语音助手"
4. 分享链接给团队成员

### 使用 AI 语音助手

启用火山引擎实时语音后，用户可以直接与 AI 语音对话：

1. 点击麦克风按钮开始语音输入
2. 说话时，AI 会实时聆听
3. AI 将以语音形式回复

### 使用 AI 文本助手

使用 `@ai` 提及调用 AI：

```
@ai 如何优化这个项目的性能？

@ai 读取 README.md 并总结内容

@ai 运行 npm test 并分析结果
```

## 项目结构

```
opencochat/
├── multiplayer/           # 核心服务端代码
│   ├── websocket-server.ts    # WebSocket 服务器
│   ├── voice-ai-service.ts    # 火山引擎语音 AI 服务
│   ├── transcription.ts       # 阿里云 ASR 服务
│   ├── ai-service.ts          # DeepSeek AI 服务
│   └── database.ts            # 数据库层
├── public/               # 前端资源
├── skill/                # 第三方技能集成
│   ├── aliyun/               # 阿里云 RDS/OSS
│   └── volcano-voice-ai-integration.md  # 火山引擎集成文档
├── docs/                 # 文档
└── docker-compose.yml    # Docker 部署配置
```

## 技术栈

- **运行时**: Bun / Node.js
- **实时通信**: WebSocket
- **数据库**: PostgreSQL
- **AI 服务**: DeepSeek API
- **语音识别**: 阿里云 DashScope ASR
- **语音对话**: 火山引擎豆包实时语音模型
- **文件存储**: 阿里云 OSS（可选）

## 贡献

欢迎提交 Issue 和 Pull Request！

```bash
# Fork 并克隆仓库
git clone https://github.com/YOUR_USERNAME/opencochat.git
cd opencochat

# 安装依赖
bun install

# 运行开发服务器
bun run dev
```

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 致谢

- [DeepSeek](https://www.deepseek.com/) - AI 能力
- [Bun](https://bun.sh/) - JavaScript 运行时
- [阿里云 DashScope](https://dashscope.aliyun.com/) - 语音识别
- [火山引擎](https://www.volcengine.com/) - 实时语音对话

---

由 Open CoChat 社区维护
