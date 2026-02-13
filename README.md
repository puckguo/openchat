<h1 align="center">OpenChat</h1>
<p align="center">
  <strong>AI-Powered Multiplayer Collaboration Space</strong>
</p>

<p align="center">
  <a href="https://github.com/puckguo/openchat/stargazers">
    <img alt="GitHub Stars" src="https://img.shields.io/github/stars/puckguo/openchat?style=flat-square&logo=github">
  </a>
  <a href="https://github.com/puckguo/openchat/blob/main/LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/puckguo/openchat?style=flat-square">
  </a>
</p>

<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">简体中文</a>
</p>

---

## Overview

**OpenChat** is an open-source multiplayer chat platform with integrated AI assistant capabilities. Built with TypeScript, Bun, and WebSocket, it enables real-time team collaboration where AI can read files, execute commands, and participate alongside team members.

Unlike traditional chat platforms, OpenChat brings AI as a first-class citizen with powerful tool-calling capabilities - allowing it to browse your project files, run terminal commands, and provide contextually aware assistance directly in the conversation.

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
  ghcr.io/puckguo/openchat:latest
```

### Using Docker Compose (Recommended)

```bash
# Clone the repository
git clone https://github.com/puckguo/openchat.git
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
git clone https://github.com/puckguo/openchat.git
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

## External API Compatibility & Alternatives

OpenChat is designed with API flexibility in mind. All external services use standard interfaces that can be easily replaced or simplified.

### AI Service (DeepSeek)

**Current Implementation**: Uses DeepSeek's OpenAI-compatible API (`multiplayer/ai-service.ts`)

**Generic Design**: The AI service follows OpenAI's standard chat completion format, making it compatible with any OpenAI-compatible provider.

**Replacement Options**:
```env
# Option 1: Use OpenAI directly
OPENAI_API_KEY=your-openai-key
DEEPSEEK_BASE_URL=https://api.openai.com/v1
DEEPSEEK_MODEL=gpt-4

# Option 2: Use local AI with Ollama
DEEPSEEK_BASE_URL=http://localhost:11434/v1
DEEPSEEK_MODEL=llama3

# Option 3: Use other compatible providers (Anthropic, Cohere, etc.)
DEEPSEEK_BASE_URL=https://api.anthropic.com/v1
DEEPSEEK_MODEL=claude-3-opus

# Option 4: Simplify - Disable AI entirely
ENABLE_AI=false
```

### ASR/TTS (Audio Transcription)

**Current Implementation**: Uses OpenAI Whisper API (`multiplayer/transcription.ts`)

**Supported Formats**: FLAC, M4A, MP3, MP4, MPEG, MPGA, OGA, OGG, WAV, WEBM

**Replacement Options**:
```typescript
// Option 1: Use Whisper X (free, open-source)
// Install: pip install whisperx
// Replace transcription service with local model

// Option 2: Use other cloud providers
// Google Cloud Speech-to-Text
// Azure Speech Services
// Amazon Transcribe

// Option 3: Simplify - Disable voice features
// Remove transcription service calls from voice-chat-service.ts
```

### OSS (Object Storage Service)

**Current Implementation**: Alibaba Cloud OSS (`multiplayer/oss.ts`)

**Generic Design**: The storage manager follows a standard cloud storage pattern with upload, download, delete, and signed URL operations.

**Replacement Options**:
```env
# Option 1: AWS S3 (most popular alternative)
# Install: bun add @aws-sdk/client-s3
# Replace OSS manager with S3 client
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=us-east-1
S3_BUCKET=your-bucket

# Option 2: Cloudflare R2 (free egress)
# Install: bun add @cloudflare/workers-types
CLOUDFLARE_ACCOUNT_ID=your-id
CLOUDFLARE_R2_ACCESS_KEY=your-key
CLOUDFLARE_R2_SECRET=your-secret
R2_BUCKET=your-bucket

# Option 3: MinIO (self-hosted S3-compatible)
# Deploy MinIO via Docker or use local filesystem
MINIO_ENDPOINT=http://localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin

# Option 4: Simplify - Use local filesystem
# Replace OSS manager with fs operations
# Files stored in ./uploads directory
```

### RDS (Database)

**Current Implementation**: PostgreSQL via `pg` library (`multiplayer/database.ts`)

**Generic Design**: Uses standard SQL queries, making it database-agnostic.

**Replacement Options**:
```env
# Option 1: SQLite (simpler, no separate server)
# Install: bun add better-sqlite3
DATABASE_URL=sqlite://./data/chat.db

# Option 2: MySQL/MariaDB
DATABASE_URL=mysql://user:password@localhost:3306/openchat

# Option 3: MongoDB (NoSQL alternative)
# Install: bun add mongodb
MONGODB_URL=mongodb://localhost:27017/openchat

# Option 4: Simplify - In-memory storage
# Remove database dependency, use only session storage
# Data lost on restart (acceptable for testing)
```

### Authentication (Supabase)

**Current Implementation**: Supabase Auth (`multiplayer/supabase-auth.ts`)

**Generic Design**: Standard JWT-based authentication with OAuth providers.

**Replacement Options**:
```env
# Option 1: Auth0 (popular alternative)
AUTH0_DOMAIN=your-domain.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-secret

# Option 2: Clerk (modern, developer-friendly)
CLERK_PUBLISHABLE_KEY=your-key
CLERK_SECRET_KEY=your-secret

# Option 3: NextAuth.js (if using Next.js frontend)
# Built-in Next.js authentication

# Option 4: Simplify - Anonymous-only access
ALLOW_ANONYMOUS=true
ENABLE_SUPABASE_AUTH=false
# No authentication required
```

### Simplified Deployment Scenarios

**Minimum Setup (AI + Database only)**:
```env
# Just these two services to get started
DEEPSEEK_API_KEY=your-key
DATABASE_URL=postgresql://user:pass@localhost:5432/openchat
ENABLE_AI=true
ENABLE_DATABASE=true
```

**Local Development (no external APIs)**:
```env
# Use Ollama for local AI
DEEPSEEK_BASE_URL=http://localhost:11434/v1
DEEPSEEK_MODEL=llama3

# Use SQLite for local database
DATABASE_URL=sqlite://./data/chat.db

# Use filesystem for storage
ENABLE_OSS=false

# Anonymous access
ALLOW_ANONYMOUS=true
```

**Enterprise Setup (all services)**:
```env
# Use your existing infrastructure
OPENAI_API_KEY=your-openai-key
AWS_REGION=us-east-1
S3_BUCKET=company-bucket
RDS_ENDPOINT=postgres.company.com:5432
AUTH0_DOMAIN=company.auth0.com
```

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

OpenChat is built with modern technologies:

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

| Feature | OpenChat | Slack | Discord | Claude |
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
- Issues: [GitHub Issues](https://github.com/puckguo/openchat/issues)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=puckguo/openchat&type=Date)](https://star-history.com/#puckguo/openchat&Date)

---

Made with ❤️ by the OpenChat community
