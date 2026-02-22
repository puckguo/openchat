<p align="center">
  <img src="public/icon.png" alt="Open CoChat" width="120">
</p>

# Open CoChat - 多人语音 AI 聊天室

<p align="center">
  <strong>🎙️ 多人实时语音聊天 + AI 智能助手</strong><br>
  支持语音/文字双模式交互，AI 可生成和编辑文件<br><br>
  <a href="README.md">English</a> | 简体中文
</p>

---

## 📋 关于

**Open CoChat** 是一个开源的多人实时语音聊天平台，集成 AI 智能助手，支持语音/文字双模式交互，AI 可实时介入群聊、生成和编辑文件。

## ✨ 核心亮点

### 🎙️ 多人实时语音聊天
- 支持多人同时在线语音聊天
- 低延迟 WebSocket 实时传输
- 语音质量清晰稳定

### 🤖 AI 实时介入群聊
AI 助手可以**实时监听**群聊语音内容，并通过两种方式参与对话：

| 方式 | 说明 |
|------|------|
| **🗣️ 语音回复** | 使用火山引擎端到端语音大模型，AI 直接用语音回复 |
| **💬 文字回复** | 使用 DeepSeek AI，AI 以文字形式参与讨论 |

### 📁 AI 文件操作
AI 可以在聊天过程中：
- **生成文件**（代码、文档、报告等）
- **编辑现有文件**
- **提供文件下载链接**
- 自动上传到阿里云 OSS，生成可下载链接

---

## 🏗️ 技术架构

```
┌─────────────────────────────────────────────────────────────┐
│                         用户端                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  语音输入    │  │  文字输入    │  │  文件下载    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────┬────────────────────────────────────┘
                         │
                    WebSocket
                         │
┌────────────────────────▼────────────────────────────────────┐
│                      Open CoChat 服务器                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              阿里云 ASR 语音识别                      │   │
│  │         实时语音 → 文字转录                           │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │              AI 意图识别与处理                        │   │
│  │    判断：语音回复 / 文字回复 / 文件操作                │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│         ┌───────────────┼───────────────┐                  │
│         ▼               ▼               ▼                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │ 火山引擎    │ │ DeepSeek    │ │ 文件生成    │          │
│  │ 语音大模型  │ │ 文本 AI     │ │ & 编辑      │          │
│  │ (语音回复)  │ │ (文字回复)  │ │ (OSS上传)   │          │
│  └─────────────┘ └─────────────┘ └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 快速开始

### Docker 一键部署

```bash
# 1. 克隆仓库
git clone https://github.com/puckguo/opencochat.git
cd opencochat

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，填入 API 密钥

# 3. 启动
docker-compose up -d

# 4. 访问 http://localhost:8080
```

### 本地开发

```bash
# 安装依赖
bun install

# 配置环境变量
cp .env.example .env

# 启动开发服务器
bun run dev
```

---

## 🔧 环境变量配置

### 必需配置

```env
# 基础服务
WS_PORT=3002
HTTP_PORT=8080

# DeepSeek AI（文字回复）
DEEPSEEK_API_KEY=sk-your-key
ENABLE_AI=true

# 数据库
DATABASE_URL=postgresql://user:password@localhost:5432/opencochat
```

### 语音功能配置

```env
# 1. 阿里云 ASR - 实时语音识别（语音→文字）
DASHSCOPE_API_KEY=sk-your-dashscope-key
ENABLE_TRANSCRIPTION=true

# 2. 火山引擎端到端语音大模型（AI语音回复）
VOLCANO_APP_ID=your-app-id
VOLCANO_ACCESS_KEY=your-access-key
VOLCANO_SECRET_KEY=your-secret-key
VOLCANO_ENDPOINT=wss://openspeech.bytedance.com/api/v3/realtime/dialogue
ENABLE_VOICE_AI=true
```

### 文件存储配置

```env
# 阿里云 OSS - AI 生成文件的上传存储
VITE_OSS_ACCESS_KEY_ID=your-access-key
VITE_OSS_ACCESS_KEY_SECRET=your-secret-key
VITE_OSS_BUCKET=your-bucket
VITE_OSS_REGION=oss-cn-beijing
ENABLE_OSS=true
```

---

## 📖 使用指南

### 创建语音聊天室

1. 打开 `http://your-server:8080`
2. 点击「新建会话」
3. 设置房间名称和密码（可选）
4. 邀请成员加入

### AI 自动介入

当用户在语音聊天中讨论时，AI 会：
1. **实时监听**：通过阿里云 ASR 将语音转为文字
2. **智能判断**：分析内容决定是否需要介入
3. **选择回复方式**：
   - 适合讨论/解释 → **语音回复**（火山引擎）
   - 需要代码/文件 → **文字回复 + 文件生成**（DeepSeek）

### 触发 AI 文件操作

在聊天中可以直接对 AI 说：

```
"@ai 帮我写一个 Python 爬虫脚本，抓取天气数据"
"@ai 把这个代码改成 JavaScript 版本"
"@ai 生成一份项目周报，总结今天的讨论"
```

AI 会：
1. 生成文件内容
2. 自动上传到 OSS
3. 在聊天中发送下载链接

---

## 🎯 功能详解

### 1. 阿里云 ASR 实时语音识别

- **实时转录**：用户说话的同时转为文字
- **流式识别**：边说边识别，低延迟
- **支持中文**：针对中文优化

文档：[skill/aliyun/README.md](skill/aliyun/README.md)

### 2. 火山引擎端到端语音大模型

- **端到端语音对话**：无需文字中转，直接语音交互
- **音色自然**：豆包大模型，语音自然流畅
- **低延迟**：响应时间 < 1 秒

文档：[skill/volcano-voice-ai-integration.md](skill/volcano-voice-ai-integration.md)

### 3. AI 文件生成与下载

支持生成的文件类型：
- 代码文件（.js, .py, .ts, .java 等）
- 文档（.md, .txt, .doc）
- 数据文件（.json, .csv, .xml）
- 配置文件（.yml, .env, .conf）

文件自动上传到阿里云 OSS，生成临时下载链接，支持：
- 链接有效期设置（默认 1 小时）
- 文件大小限制（默认 10MB）
- 历史文件管理

---

## 🛡️ 权限管理

5 级角色系统，精细控制 AI 和用户的权限：

| 角色 | 权限 |
|------|------|
| **Owner** | 全部权限，包括删除房间 |
| **Admin** | 管理成员、配置 AI 行为 |
| **Member** | 正常发言、使用 AI 功能 |
| **Guest** | 仅可发言，不可使用 AI |
| **AI** | 系统角色，自动回复 |

可配置权限：
- 是否允许 AI 介入
- AI 介入方式（语音/文字/混合）
- 是否允许 AI 生成文件
- 文件下载权限

---

## 📁 项目结构

```
opencochat/
├── multiplayer/
│   ├── websocket-server.ts      # WebSocket 服务核心
│   ├── voice-chat-service.ts    # 多人语音聊天管理
│   ├── transcription.ts         # 阿里云 ASR 接入
│   ├── voice-ai-service.ts      # 火山引擎语音模型接入
│   ├── ai-service.ts            # DeepSeek AI 接入
│   ├── file-sync.ts             # 文件生成与 OSS 上传
│   └── tools/
│       ├── file-tools.ts        # AI 文件操作工具
│       └── terminal-tools.ts    # AI 命令执行工具
├── public/
│   └── index.html               # 前端界面
├── skill/
│   ├── aliyun/                  # 阿里云 RDS/OSS 集成
│   └── volcano-voice-ai-integration.md  # 火山引擎集成文档
└── docker-compose.yml
```

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

```bash
git clone https://github.com/puckguo/opencochat.git
cd opencochat
bun install
bun run dev
```

---

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

---

## 🙏 致谢

- [DeepSeek](https://www.deepseek.com/) - 文本 AI 能力
- [阿里云 DashScope](https://dashscope.aliyun.com/) - 实时语音识别
- [火山引擎](https://www.volcengine.com/) - 端到端语音大模型
- [阿里云 OSS](https://www.aliyun.com/product/oss) - 文件存储
