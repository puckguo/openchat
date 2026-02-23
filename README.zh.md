<p align="center">
  <a href="https://github.com/opencode-chat/opencode-chat">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://opencode.ai/logo-dark.svg">
      <source media="(prefers-color-scheme: light)" srcset="https://opencode.ai/logo-light.svg">
      <img src="https://opencode.ai/logo-light.svg" alt="Open CoChat logo" width="200">
    </picture>
  </a>
</p>

<h1 align="center">Open CoChat</h1>
<p align="center">
  <strong>AI 驱动的多人协作空间</strong>
</p>

<p align="center">
  <a href="https://github.com/opencode-chat/opencode-chat/stargazers">
    <img alt="GitHub Stars" src="https://img.shields.io/github/stars/opencode-chat/opencode-chat?style=flat-square&logo=github">
  </a>
  <a href="https://github.com/opencode-chat/opencode-chat/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/opencode-chat/opencode-chat?style=flat-square">
  </a>
  <a href="https://github.com/opencode-chat/opencode-chat/actions/workflows/ci.yml">
    <img alt="Build Status" src="https://img.shields.io/github/actions/workflow/status/opencode-chat/opencode-chat/ci.yml?branch=main&style=flat-square">
  </a>
  <a href="https://discord.gg/opencode">
    <img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord&logo=discord">
  </a>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a>
</p>

---

## 概述

**Open CoChat** 是一个开源的多人聊天平台，集成了强大的 AI 助手功能。基于 TypeScript、Bun 和 WebSocket 构建，它支持实时团队协作，AI 可以读取文件、执行命令，并与团队成员一起参与对话。

与传统聊天平台不同，Open CoChat 将 AI 作为一等公民，拥有强大的工具调用能力 - 可以浏览项目文件、运行终端命令，并在对话中直接提供上下文感知的协助。

适用于：
- 需要 AI 辅助代码审查和协作的开发团队
- 使用 AI 驱动解释的学习小组
- 与 AI 贡献者一起构建的开源社区
- 任何希望完全控制自托管 AI 聊天解决方案的人

## 核心特性

### 实时协作

- 基于 WebSocket 的实时消息传递
- 多用户聊天室与实时同步
- @提及用户和 AI 助手
- 消息主题和反应
- 输入指示器和在线状态
- 消息编辑和删除历史

### AI 助手能力

- **DeepSeek AI** 集成，提供智能响应
- **文件系统访问**：AI 可以读取和分析项目文件
- **命令执行**：AI 可以运行终端命令并显示结果
- **上下文感知对话**：记住聊天历史和项目上下文
- **自动总结**：自动创建对话摘要
- **工具调用**：安全的文件操作和代码执行

### 富媒体支持

- 图片分享及内联预览
- 语音消息及转录（OpenAI Whisper）
- 文件上传及云存储（阿里云 OSS）
- 代码片段分享及语法高亮
- AI 响应的 Markdown 渲染

### 安全与权限

- 5 级角色系统（所有者、管理员、成员、访客、AI）
- 30+ 细粒度权限
- 可选密码保护房间
- Supabase 认证支持
- 速率限制和滥用防护

### 数据与存储

- PostgreSQL 数据库用于消息持久化
- 云文件存储（OSS）及自动备份
- 对话历史及完整导出
- AI 记忆管理及自动清理

## 快速开始

### 一键 Docker 部署

最快的方式：

```bash
docker run -d \
  --name opencode-chat \
  -p 3002:3002 \
  -e DEEPSEEK_API_KEY=your-key \
  ghcr.io/opencode-chat/opencode-chat:latest
```

### 使用 Docker Compose（推荐）

```bash
# 克隆仓库
git clone https://github.com/opencode-chat/opencode-chat.git
cd opencode-chat

# 复制环境文件
cp .env.example .env

# 编辑 .env 文件，填入您的 DeepSeek API 密钥
nano .env

# 启动所有服务（包含 PostgreSQL）
docker-compose up -d
```

访问 `http://localhost:3000`

### 手动安装

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 克隆仓库
git clone https://github.com/opencode-chat/opencode-chat.git
cd opencode-chat

# 运行安装脚本
./scripts/setup.sh

# 启动服务器
./scripts/start.sh
```

## 自部署指南

### 最低要求

- CPU：2 核
- RAM：4GB
- 磁盘：10GB
- 操作系统：Linux/macOS/Windows

### 必需的环境变量

创建 `.env` 文件：

```env
# 服务器
WS_PORT=3002
WS_HOST=0.0.0.0

# AI 服务（必需）
DEEPSEEK_API_KEY=your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
ENABLE_AI=true

# 数据库（持久化必需）
DATABASE_URL=postgresql://user:password@localhost:5432/opencode_chat
ENABLE_DATABASE=true
```

### 可选配置

```env
# 文件存储（阿里云 OSS）
VITE_OSS_ACCESS_KEY_ID=your-access-key
VITE_OSS_ACCESS_KEY_SECRET=your-secret-key
VITE_OSS_BUCKET=your-bucket
VITE_OSS_REGION=oss-cn-beijing
ENABLE_OSS=true

# 认证（Supabase）
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-key
SUPABASE_SERVICE_ROLE_KEY=your-service-key
ENABLE_SUPABASE_AUTH=false
ALLOW_ANONYMOUS=true
```

详细部署说明请参阅 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)。

## 使用示例

### 创建聊天室

1. 访问 `http://your-server:3000`
2. 点击"新建会话"
3. 输入会话名称并配置设置
4. 与团队成员分享链接

### 使用 AI 助手

使用 `@ai` 提及调用 AI：

```
@ai 如何在 Node.js 中实现 JWT 认证？

@ai 读取 package.json 文件并推荐依赖项

@ai 运行 npm test 并显示结果
```

### AI 文件操作

AI 助手可以与项目文件交互：

```
@ai 列出 src 目录中的所有 TypeScript 文件

@ai 读取 utils/api.ts 文件并解释其功能

@ai 基于现有的 Button 组件创建新组件
```

### 对话总结

点击"总结聊天"可以：
- 获取 AI 生成的对话摘要
- 包含关键主题、决策和行动项
- 保存摘要以备将来参考

## 截图

### 主聊天界面
![聊天界面](https://opencode.ai/screenshots/chat-main.png)

### AI 对话与文件访问
![AI 聊天](https://opencode.ai/screenshots/ai-conversation.png)

### 文件分享与协作
![文件分享](https://opencode.ai/screenshots/file-sharing.png)

## 架构

Open CoChat 采用现代技术构建：

- **运行时**：Bun 实现快速 TypeScript 执行
- **实时通信**：WebSocket 实现即时消息传递
- **数据库**：PostgreSQL 实现可靠的数据持久化
- **AI**：DeepSeek 提供智能响应
- **存储**：阿里云 OSS 实现文件托管
- **认证**：Supabase 实现用户认证

### 项目结构

```
opencode-chat/
├── multiplayer/           # 核心聊天功能
│   ├── websocket-server.ts    # WebSocket 服务器
│   ├── websocket-client.ts    # WebSocket 客户端
│   ├── ai-service.ts          # AI 集成
│   ├── tools/                 # AI 工具实现
│   │   ├── file-tools.ts      # 文件操作
│   │   └── terminal-tools.ts  # 命令执行
│   ├── database.ts            # 数据库层
│   └── types.ts               # TypeScript 类型
├── public/               # 前端资源
├── docs/                 # 文档
├── scripts/              # 安装和构建脚本
└── marketing/            # 推广资源
```

详细架构文档请参阅 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 使用场景

### 开发团队
- AI 辅助代码审查
- AI 建议的结对编程
- AI 结果分析的自动化测试
- 从讨论中生成文档

### 教育
- AI 辅导的学习小组
- 代码解释和学习
- 协作问题解决
- 知识库创建

### 开源社区
- AI 帮助的贡献者入门
- 问题分类和标记
- 自动化 PR 审查
- 社区管理

### 企业
- 团队协作和决策跟踪
- AI 升级的客户支持
- 知识管理
- 会议摘要和行动项

## 文档

- [部署指南](docs/DEPLOYMENT.md) - 完整的部署说明
- [贡献指南](docs/CONTRIBUTING.md) - 如何贡献
- [架构](docs/ARCHITECTURE.md) - 系统架构概述
- [API 文档](docs/API.md) - WebSocket API 参考
- [常见问题](docs/FAQ.md) - 常见问题解答
- [更新日志](CHANGELOG.md) - 版本历史和变更

## 对比

| 功能 | Open CoChat | Slack | Discord | Claude |
|---------|---------------|-------|---------|--------|
| 开源 | ✅ | ❌ | ❌ | ✅ |
| 可自托管 | ✅ | ❌ | ❌ | ❌ |
| AI 文件访问 | ✅ | ❌ | ❌ | ❌ |
| AI 命令执行 | ✅ | ❌ | ❌ | ❌ |
| 多人聊天 | ✅ | ✅ | ✅ | ❌ |
| 文件分享 | ✅ | ✅ | ✅ | ❌ |
| 语音消息 | ✅ | ✅ | ✅ | ❌ |
| 自定义角色 | ✅ | ✅ | ✅ | ❌ |
| 免费自托管 | ✅ | ❌ | ✅ | ❌ |

## 贡献

我们欢迎所有人的贡献！

```bash
# Fork 并克隆仓库
git clone https://github.com/YOUR_USERNAME/opencode-chat.git
cd opencode-chat

# 安装依赖
bun install

# 运行开发服务器
bun run dev

# 运行测试
bun test
```

请阅读 [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) 了解我们的行为准则和开发工作流程的详细信息。

## 路线图

- [ ] 移动应用（iOS、Android）
- [ ] 端到端加密
- [ ] 视频/语音通话
- [ ] 自定义 AI 工具的插件系统
- [ ] 具有专门角色的高级 AI 代理
- [ ] 多语言 UI 支持
- [ ] 主题定制
- [ ] 第三方集成的公共 API

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 致谢

- [DeepSeek](https://www.deepseek.com/) 提供强大的 AI 能力
- [Bun](https://bun.sh/) 提供超快的 JavaScript 运行时
- [Supabase](https://supabase.com/) 提供认证基础设施
- [阿里云](https://www.alibabacloud.com/) 提供 OSS 存储服务

## 支持

- 文档：[docs.opencode.chat](https://docs.opencode.chat)
- Discord：[discord.gg/opencode](https://discord.gg/opencode)
- 邮箱：support@opencode.chat
- 问题反馈：[GitHub Issues](https://github.com/opencode-chat/opencode-chat/issues)

## Star 历史

[![Star History Chart](https://api.star-history.com/svg?repos=opencode-chat/opencode-chat&type=Date)](https://star-history.com/#opencode-chat/opencode-chat&Date)

---

由 Open CoChat 社区用 ❤️ 制作
