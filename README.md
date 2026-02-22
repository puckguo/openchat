<p align="center">
  <img src="public/icon.png" alt="Open CoChat" width="120">
</p>

# Open CoChat - Multiplayer Voice AI Chat Room

<p align="center">
  <strong>🎙️ Real-time multiplayer voice chat + AI assistant</strong><br>
  Supporting voice/text dual-mode interaction, AI can generate and edit files<br><br>
  English | <a href="README.zh.md">简体中文</a>
</p>

---

## 📋 About

**Open CoChat** is an open-source multiplayer real-time voice chat platform with integrated AI assistant, supporting voice/text dual-mode interaction where AI can intervene in group chats in real-time, generate and edit files.

## ✨ Core Highlights

### 🎙️ Multiplayer Real-time Voice Chat
- Support multiple users online voice chat simultaneously
- Low-latency WebSocket real-time transmission
- Clear and stable voice quality

### 🤖 AI Real-time Group Chat Intervention
AI assistants can **listen in real-time** to group voice conversations and participate through two modes:

| Mode | Description |
|------|-------------|
| **🗣️ Voice Response** | Using Volcano Engine end-to-end voice model, AI replies directly with voice |
| **💬 Text Response** | Using DeepSeek AI, AI participates in discussions via text |

### 📁 AI File Operations
AI can during chat:
- **Generate files** (code, documents, reports, etc.)
- **Edit existing files**
- **Provide file download links**
- Automatically upload to Alibaba Cloud OSS and generate downloadable links

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Client                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │  Voice Input │  │  Text Input  │  │ File Download│      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└────────────────────────┬────────────────────────────────────┘
                         │
                    WebSocket
                         │
┌────────────────────────▼────────────────────────────────────┐
│                      Open CoChat Server                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           Alibaba Cloud ASR Speech Recognition       │   │
│  │         Real-time Voice → Text Transcription       │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│  ┌──────────────────────▼──────────────────────────────┐   │
│  │              AI Intent Recognition & Processing     │   │
│  │    Decision: Voice Reply / Text Reply / File Op    │   │
│  └──────────────────────┬──────────────────────────────┘   │
│                         │                                  │
│         ┌───────────────┼───────────────┐                  │
│         ▼               ▼               ▼                  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐          │
│  │ Volcano     │ │ DeepSeek    │ │ File Gen    │          │
│  │ Voice Model │ │ Text AI     │ │ & Edit      │          │
│  │ (Voice)     │ │ (Text)      │ │ (OSS Upload)│          │
│  └─────────────┘ └─────────────┘ └─────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Docker One-Click Deployment

```bash
# 1. Clone repository
git clone https://github.com/puckguo/opencochat.git
cd opencochat

# 2. Configure environment variables
cp .env.example .env
# Edit .env, fill in API keys

# 3. Start
docker-compose up -d

# 4. Visit http://localhost:8080
```

### Local Development

```bash
# Install dependencies
bun install

# Configure environment variables
cp .env.example .env

# Start development server
bun run dev
```

---

## 🔧 Environment Variables

### Required Configuration

```env
# Basic Services
WS_PORT=3002
HTTP_PORT=8080

# DeepSeek AI (Text Response)
DEEPSEEK_API_KEY=sk-your-key
ENABLE_AI=true

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/opencochat
```

### Voice Features Configuration

```env
# 1. Alibaba Cloud ASR - Real-time Speech Recognition (Voice → Text)
DASHSCOPE_API_KEY=sk-your-dashscope-key
ENABLE_TRANSCRIPTION=true

# 2. Volcano Engine End-to-End Voice Model (AI Voice Response)
VOLCANO_APP_ID=your-app-id
VOLCANO_ACCESS_KEY=your-access-key
VOLCANO_SECRET_KEY=your-secret-key
VOLCANO_ENDPOINT=wss://openspeech.bytedance.com/api/v3/realtime/dialogue
ENABLE_VOICE_AI=true
```

### File Storage Configuration

```env
# Alibaba Cloud OSS - AI Generated Files Storage
VITE_OSS_ACCESS_KEY_ID=your-access-key
VITE_OSS_ACCESS_KEY_SECRET=your-secret-key
VITE_OSS_BUCKET=your-bucket
VITE_OSS_REGION=oss-cn-beijing
ENABLE_OSS=true
```

---

## 📖 Usage Guide

### Create Voice Chat Room

1. Open `http://your-server:8080`
2. Click "New Session"
3. Set room name and password (optional)
4. Invite members to join

### AI Auto-Intervention

When users discuss in voice chat, AI will:
1. **Listen in real-time**: Convert voice to text via Alibaba Cloud ASR
2. **Smart judgment**: Analyze content to decide whether to intervene
3. **Choose response mode**:
   - Suitable for discussion/explanation → **Voice Response** (Volcano Engine)
   - Requires code/files → **Text Response + File Generation** (DeepSeek)

### Trigger AI File Operations

In chat, you can directly say to AI:

```
"@ai help me write a Python crawler script to scrape weather data"
"@ai convert this code to JavaScript version"
"@ai generate a project weekly report summarizing today's discussion"
```

AI will:
1. Generate file content
2. Automatically upload to OSS
3. Send download link in chat

---

## 🎯 Feature Details

### 1. Alibaba Cloud ASR Real-time Speech Recognition

- **Real-time transcription**: Convert voice to text while user speaks
- **Streaming recognition**: Recognize as you speak, low latency
- **Chinese optimized**: Optimized for Chinese speech

Documentation: [skill/aliyun/README.md](skill/aliyun/README.md)

### 2. Volcano Engine End-to-End Voice Model

- **End-to-end voice dialogue**: Direct voice interaction without text relay
- **Natural voice**: Doubao model with natural and fluent voice
- **Low latency**: Response time < 1 second

Documentation: [skill/volcano-voice-ai-integration.md](skill/volcano-voice-ai-integration.md)

### 3. AI File Generation & Download

Supported file types:
- Code files (.js, .py, .ts, .java, etc.)
- Documents (.md, .txt, .doc)
- Data files (.json, .csv, .xml)
- Config files (.yml, .env, .conf)

Files are automatically uploaded to Alibaba Cloud OSS with temporary download links, supporting:
- Link expiration settings (default 1 hour)
- File size limits (default 10MB)
- Historical file management

---

## 🛡️ Permission Management

5-tier role system for fine-grained control of AI and user permissions:

| Role | Permissions |
|------|-------------|
| **Owner** | Full permissions, including delete room |
| **Admin** | Manage members, configure AI behavior |
| **Member** | Normal chat, use AI features |
| **Guest** | Chat only, no AI access |
| **AI** | System role, auto-reply |

Configurable permissions:
- Whether to allow AI intervention
- AI intervention mode (voice/text/mixed)
- Whether to allow AI file generation
- File download permissions

---

## 📁 Project Structure

```
opencochat/
├── multiplayer/
│   ├── websocket-server.ts      # WebSocket service core
│   ├── voice-chat-service.ts    # Multiplayer voice chat management
│   ├── transcription.ts         # Alibaba Cloud ASR integration
│   ├── voice-ai-service.ts      # Volcano Engine voice model integration
│   ├── ai-service.ts            # DeepSeek AI integration
│   ├── file-sync.ts             # File generation & OSS upload
│   └── tools/
│       ├── file-tools.ts        # AI file operation tools
│       └── terminal-tools.ts    # AI command execution tools
├── public/
│   └── index.html               # Frontend interface
├── skill/
│   ├── aliyun/                  # Alibaba Cloud RDS/OSS integration
│   └── volcano-voice-ai-integration.md  # Volcano Engine integration docs
└── docker-compose.yml
```

---

## 🤝 Contributing

Issues and Pull Requests are welcome!

```bash
git clone https://github.com/puckguo/opencochat.git
cd opencochat
bun install
bun run dev
```

---

## 📄 License

MIT License - See [LICENSE](LICENSE)

---

## 🙏 Acknowledgments

- [DeepSeek](https://www.deepseek.com/) - Text AI capabilities
- [Alibaba Cloud DashScope](https://dashscope.aliyun.com/) - Real-time speech recognition
- [Volcano Engine](https://www.volcengine.com/) - End-to-end voice model
- [Alibaba Cloud OSS](https://www.aliyun.com/product/oss) - File storage
