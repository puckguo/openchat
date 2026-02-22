<p align="center">
  <a href="https://github.com/puckguo/opencochat">
    <img src="https://img.shields.io/badge/Open-CoChat-blue?style=for-the-badge" alt="Open CoChat logo" width="200">
  </a>
</p>

<h1 align="center">Open CoChat</h1>
<p align="center">
  <strong>AI-Powered Multiplayer Voice Chat Platform</strong>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a>
</p>

---

## Overview

**Open CoChat** is an open-source multiplayer real-time voice chat platform with powerful AI assistant capabilities. Built with TypeScript, Bun, and WebSocket, it supports:

- Multiplayer real-time voice conversations
- AI real-time voice interaction (end-to-end voice dialogue)
- Real-time speech recognition (ASR)
- AI file access and command execution
- Real-time team collaboration

Perfect for:
- Development teams needing AI-assisted collaboration
- Online education classrooms
- Open-source community discussions
- Enterprise meetings

## Core Features

### Real-time Voice Collaboration

- WebSocket-based real-time voice transmission
- Multi-user voice chat rooms
- Low-latency voice communication
- Voice message recording and playback
- @mention users and AI assistants

### AI Voice Assistant

- **DeepSeek AI** integration for intelligent responses
- **Volcano Engine Doubao Real-time Voice Model** support for end-to-end voice dialogue
- **Alibaba Cloud ASR** integration for real-time speech recognition
- **File System Access**: AI can read and analyze project files
- **Command Execution**: AI can run terminal commands and display results

### Voice Technology Integration

| Feature | Description | Integration Guide |
|---------|-------------|-------------------|
| Alibaba Cloud ASR | Real-time speech recognition | [skill/aliyun/README.md](skill/aliyun/README.md) |
| Volcano Engine Voice | End-to-end voice dialogue | [skill/volcano-voice-ai-integration.md](skill/volcano-voice-ai-integration.md) |
| DeepSeek AI | Text-based AI conversation | Built-in support |

### Security & Permissions

- 5-tier role system (Owner, Admin, Member, Guest, AI)
- 30+ granular permissions
- Optional password-protected rooms
- Rate limiting and abuse protection

## Quick Start

### Requirements

- CPU: 2 cores
- RAM: 4GB
- Disk: 10GB
- OS: Linux/macOS/Windows
- Node.js 18+ or Bun 1.1+

### Installation

```bash
# Clone the repository
git clone https://github.com/puckguo/opencochat.git
cd opencochat

# Install dependencies (using Bun)
bun install

# Or using npm
npm install

# Copy environment template
cp .env.example .env

# Edit .env file with your configurations
nano .env
```

### Required Environment Variables

```env
# WebSocket Server Configuration
WS_PORT=3002
WS_HOST=0.0.0.0
HTTP_PORT=8080

# AI Service (Required)
DEEPSEEK_API_KEY=your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
ENABLE_AI=true

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/opencochat
ENABLE_DATABASE=true
```

### Start the Service

```bash
# Development mode
bun run dev

# Production mode
bun start
```

Visit `http://localhost:8080`

## Deployment

### Docker Deployment (Recommended)

```bash
# Using Docker Compose
docker-compose up -d

# Or using Docker directly
docker run -d \
  --name opencochat \
  -p 3002:3002 \
  -p 8080:8080 \
  -e DEEPSEEK_API_KEY=your-key \
  ghcr.io/puckguo/opencochat:latest
```

### Production Deployment

For detailed deployment instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Voice Integration Guides

### Alibaba Cloud ASR Integration

Alibaba Cloud ASR provides real-time speech-to-text capabilities.

#### 1. Configure Environment Variables

```env
# Alibaba Cloud ASR Configuration
DASHSCOPE_API_KEY=sk-your-dashscope-api-key
ENABLE_TRANSCRIPTION=true
```

#### 2. Get API Key

1. Log in to [Alibaba Cloud DashScope Console](https://dashscope.console.aliyun.com/)
2. Create an API Key
3. Enable real-time speech recognition service

#### 3. Usage

Once enabled, user voice in chat rooms will be automatically transcribed to text, allowing AI to respond based on the transcription.

See [skill/aliyun/README.md](skill/aliyun/README.md) for complete integration guide.

---

### Volcano Engine Real-time Voice Integration

Volcano Engine Doubao end-to-end real-time voice model provides low-latency voice-to-voice dialogue capabilities.

#### 1. Configure Environment Variables

```env
# Volcano Engine Configuration
VOLCANO_APP_ID=your-app-id
VOLCANO_ACCESS_KEY=your-access-key
VOLCANO_SECRET_KEY=your-secret-key
VOLCANO_ENDPOINT=wss://openspeech.bytedance.com/api/v3/realtime/dialogue
VOLCANO_API_APP_KEY=PlgvMymc7f3tQnJ6
VOLCANO_API_RESOURCE_ID=volc.speech.dialog
ENABLE_VOICE_AI=true
```

#### 2. Get Authentication

1. Log in to [Volcano Engine Console](https://console.volcengine.com/)
2. Enable "End-to-End Real-time Voice Model" service
3. Create Access Key in "Access Control"

#### 3. Features

- **End-to-end voice dialogue**: Voice input → AI processing → Voice output
- **Real-time ASR**: Speech recognition results returned in real-time
- **Streaming TTS**: AI voice synthesis plays in real-time
- **Low latency**: End-to-end latency < 1 second

See [skill/volcano-voice-ai-integration.md](skill/volcano-voice-ai-integration.md) for complete integration guide.

## Usage Examples

### Create a Voice Chat Room

1. Visit `http://your-server:8080`
2. Click "New Session"
3. Enter session name and enable "AI Voice Assistant"
4. Share the link with team members

### Use AI Voice Assistant

With Volcano Engine real-time voice enabled, users can talk directly to AI:

1. Click the microphone button to start voice input
2. AI listens in real-time as you speak
3. AI responds with voice

### Use AI Text Assistant

Use `@ai` mention to invoke AI:

```
@ai How can I optimize this project's performance?

@ai Read README.md and summarize the content

@ai Run npm test and analyze the results
```

## Project Structure

```
opencochat/
├── multiplayer/           # Core server code
│   ├── websocket-server.ts    # WebSocket server
│   ├── voice-ai-service.ts    # Volcano Engine voice AI service
│   ├── transcription.ts       # Alibaba Cloud ASR service
│   ├── ai-service.ts          # DeepSeek AI service
│   └── database.ts            # Database layer
├── public/               # Frontend assets
├── skill/                # Third-party skill integrations
│   ├── aliyun/               # Alibaba Cloud RDS/OSS
│   └── volcano-voice-ai-integration.md  # Volcano Engine integration docs
├── docs/                 # Documentation
└── docker-compose.yml    # Docker deployment config
```

## Tech Stack

- **Runtime**: Bun / Node.js
- **Real-time Communication**: WebSocket
- **Database**: PostgreSQL
- **AI Service**: DeepSeek API
- **Speech Recognition**: Alibaba Cloud DashScope ASR
- **Voice Dialogue**: Volcano Engine Doubao Real-time Voice Model
- **File Storage**: Alibaba Cloud OSS (optional)

## Contributing

Contributions are welcome! Please submit Issues and Pull Requests.

```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/opencochat.git
cd opencochat

# Install dependencies
bun install

# Run development server
bun run dev
```

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file.

## Acknowledgments

- [DeepSeek](https://www.deepseek.com/) - AI capabilities
- [Bun](https://bun.sh/) - JavaScript runtime
- [Alibaba Cloud DashScope](https://dashscope.aliyun.com/) - Speech recognition
- [Volcano Engine](https://www.volcengine.com/) - Real-time voice dialogue

---

Maintained by the Open CoChat Community
