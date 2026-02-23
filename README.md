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
  <strong>AI-Powered Multiplayer Collaboration Space</strong>
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

## Overview

**Open CoChat** is an open-source multiplayer chat platform with integrated AI assistant capabilities. Built with TypeScript, Bun, and WebSocket, it enables real-time team collaboration where AI can read files, execute commands, and participate alongside team members.

Unlike traditional chat platforms, Open CoChat brings AI as a first-class citizen with powerful tool-calling capabilities - allowing it to browse your project files, run terminal commands, and provide contextually aware assistance directly in the conversation.

Perfect for:
- Development teams wanting AI-assisted code review and collaboration
- Educational groups learning with AI-powered explanations
- Open-source communities building with AI contributors
- Anyone wanting a self-hosted AI chat solution with full control

## Key Features

### Real-time Collaboration

- WebSocket-powered real-time messaging
- Multi-user chat rooms with live sync
- @mentions for users and AI assistant
- Message threading and reactions
- Typing indicators and presence detection
- Message editing and deletion history

### AI Assistant Capabilities

- **DeepSeek AI** integration for intelligent responses
- **File System Access**: AI can read and analyze project files
- **Command Execution**: AI can run terminal commands and show results
- **Context-Aware Conversations**: Remembers chat history and project context
- **Auto-Summarization**: Automatically creates conversation summaries
- **Tool Calling**: Secure file operations and code execution

### Rich Media Support

- Image sharing with inline preview
- Voice messages with transcription (OpenAI Whisper)
- File uploads with cloud storage (Alibaba Cloud OSS)
- Code snippet sharing with syntax highlighting
- Markdown rendering for AI responses

### Security & Permissions

- 5-tier role system (Owner, Admin, Member, Guest, AI)
- 30+ granular permissions
- Optional password-protected rooms
- Supabase authentication support
- Rate limiting and abuse prevention

### Data & Storage

- PostgreSQL database for message persistence
- Cloud file storage (OSS) with automatic backups
- Conversation history with full export
- AI memory management with auto-cleanup

## Quick Start

### One-Command Docker Deployment

The fastest way to get started:

```bash
docker run -d \
  --name opencode-chat \
  -p 3002:3002 \
  -e DEEPSEEK_API_KEY=your-key \
  ghcr.io/opencode-chat/opencode-chat:latest
```

### Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/opencode-chat/opencode-chat.git
cd opencode-chat

# Copy environment file
cp .env.example .env

# Edit .env with your DeepSeek API key
nano .env

# Start all services (includes PostgreSQL)
docker-compose up -d
```

Access the chat at `http://localhost:3000`

### Manual Installation

```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Clone repository
git clone https://github.com/opencode-chat/opencode-chat.git
cd opencode-chat

# Run setup script
./scripts/setup.sh

# Start the server
./scripts/start.sh
```

## Self-Hosting Guide

### Minimum Requirements

- CPU: 2 cores
- RAM: 4GB
- Disk: 10GB
- OS: Linux/macOS/Windows

### Required Environment Variables

Create a `.env` file:

```env
# Server
WS_PORT=3002
WS_HOST=0.0.0.0

# AI Service (Required)
DEEPSEEK_API_KEY=your-deepseek-api-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_MODEL=deepseek-chat
ENABLE_AI=true

# Database (Required for persistence)
DATABASE_URL=postgresql://user:password@localhost:5432/opencode_chat
ENABLE_DATABASE=true
```

### Optional Configuration

```env
# File Storage (Alibaba Cloud OSS)
VITE_OSS_ACCESS_KEY_ID=your-access-key
VITE_OSS_ACCESS_KEY_SECRET=your-secret-key
VITE_OSS_BUCKET=your-bucket
VITE_OSS_REGION=oss-cn-beijing
ENABLE_OSS=true

# Authentication (Supabase)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your-key
SUPABASE_SERVICE_ROLE_KEY=your-service-key
ENABLE_SUPABASE_AUTH=false
ALLOW_ANONYMOUS=true
```

For detailed deployment instructions, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Usage Examples

### Creating a Chat Room

1. Navigate to `http://your-server:3000`
2. Click "New Session"
3. Enter session name and configure settings
4. Share the link with team members

### Using the AI Assistant

The AI can be invoked with `@ai` mention:

```
@ai How do I implement JWT authentication in Node.js?

@ai Read the package.json file and suggest dependencies

@ai Run npm test and show me the results
```

### AI File Operations

The AI assistant can interact with your project files:

```
@ai List all TypeScript files in the src directory

@ai Read the utils/api.ts file and explain what it does

@ai Create a new component based on the existing Button component
```

### Conversation Summarization

Click "Summarize Chat" to:
- Get an AI-generated summary of the conversation
- Include key topics, decisions, and action items
- Save the summary for future reference

## Screenshots

### Main Chat Interface
![Chat Interface](https://opencode.ai/screenshots/chat-main.png)

### AI Conversation with File Access
![AI Chat](https://opencode.ai/screenshots/ai-conversation.png)

### File Sharing & Collaboration
![File Sharing](https://opencode.ai/screenshots/file-sharing.png)

## Architecture

Open CoChat is built with modern technologies:

- **Runtime**: Bun for fast TypeScript execution
- **Real-time**: WebSocket for instant message delivery
- **Database**: PostgreSQL for reliable data persistence
- **AI**: DeepSeek for intelligent responses
- **Storage**: Alibaba Cloud OSS for file hosting
- **Auth**: Supabase for user authentication

### Project Structure

```
opencode-chat/
├── multiplayer/           # Core chat functionality
│   ├── websocket-server.ts    # WebSocket server
│   ├── websocket-client.ts    # WebSocket client
│   ├── ai-service.ts          # AI integration
│   ├── tools/                 # AI tool implementations
│   │   ├── file-tools.ts      # File operations
│   │   └── terminal-tools.ts  # Command execution
│   ├── database.ts            # Database layer
│   └── types.ts               # TypeScript types
├── public/               # Frontend assets
├── docs/                 # Documentation
├── scripts/              # Setup and build scripts
└── marketing/            # Marketing resources
```

For detailed architecture documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Use Cases

### Development Teams
- Code review with AI assistance
- Pair programming with AI suggestions
- Automated testing with AI result analysis
- Documentation generation from discussions

### Education
- Study groups with AI tutors
- Code explanations and learning
- Collaborative problem solving
- Knowledge base creation

### Open Source Communities
- Contributor onboarding with AI
- Issue triage and categorization
- Automated PR reviews
- Community moderation

### Business
- Team collaboration and decision tracking
- Customer support with AI escalation
- Knowledge management
- Meeting summaries and action items

## Documentation

- [Deployment Guide](docs/DEPLOYMENT.md) - Complete deployment instructions
- [Contributing Guide](docs/CONTRIBUTING.md) - How to contribute
- [Architecture](docs/ARCHITECTURE.md) - System architecture overview
- [API Documentation](docs/API.md) - WebSocket API reference
- [FAQ](docs/FAQ.md) - Frequently asked questions
- [Changelog](CHANGELOG.md) - Version history and changes

## Comparison

| Feature | Open CoChat | Slack | Discord | Claude |
|---------|---------------|-------|---------|--------|
| Open Source | ✅ | ❌ | ❌ | ✅ |
| Self-Hostable | ✅ | ❌ | ❌ | ❌ |
| AI with File Access | ✅ | ❌ | ❌ | ❌ |
| AI Command Execution | ✅ | ❌ | ❌ | ❌ |
| Multiplayer Chat | ✅ | ✅ | ✅ | ❌ |
| File Sharing | ✅ | ✅ | ✅ | ❌ |
| Voice Messages | ✅ | ✅ | ✅ | ❌ |
| Custom Roles | ✅ | ✅ | ✅ | ❌ |
| Free & Self-Hosted | ✅ | ❌ | ✅ | ❌ |

## Contributing

We welcome contributions from everyone!

```bash
# Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/opencode-chat.git
cd opencode-chat

# Install dependencies
bun install

# Run development server
bun run dev

# Run tests
bun test
```

Please read [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for details on our code of conduct and development workflow.

## Roadmap

- [ ] Mobile apps (iOS, Android)
- [ ] End-to-end encryption
- [ ] Video/audio calling
- [ ] Plugin system for custom AI tools
- [ ] Advanced AI agents with specialized roles
- [ ] Multi-language UI support
- [ ] Theme customization
- [ ] Public API for third-party integration

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [DeepSeek](https://www.deepseek.com/) for providing powerful AI capabilities
- [Bun](https://bun.sh/) for the incredibly fast JavaScript runtime
- [Supabase](https://supabase.com/) for authentication infrastructure
- [Alibaba Cloud](https://www.alibabacloud.com/) for OSS storage services

## Support

- Documentation: [docs.opencode.chat](https://docs.opencode.chat)
- Discord: [discord.gg/opencode](https://discord.gg/opencode)
- Email: support@opencode.chat
- Issues: [GitHub Issues](https://github.com/opencode-chat/opencode-chat/issues)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=opencode-chat/opencode-chat&type=Date)](https://star-history.com/#opencode-chat/opencode-chat&Date)

---

Made with ❤️ by the Open CoChat community
