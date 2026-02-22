# Open CoChat Architecture

This document provides an overview of the Open CoChat system architecture, its components, and how they interact.

## Table of Contents

- [System Overview](#system-overview)
- [Technology Stack](#technology-stack)
- [Component Architecture](#component-architecture)
- [Data Flow](#data-flow)
- [AI Integration](#ai-integration)
- [Security Model](#security-model)
- [Scalability Considerations](#scalability-considerations)

## System Overview

Open CoChat is a real-time multiplayer chat platform with integrated AI capabilities. The system follows a client-server architecture with WebSocket connections for real-time communication.

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Clients                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Browser  │  │ Browser  │  │ Browser  │  │  Mobile  │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
└───────┼────────────┼────────────┼──────────────┼──────────┘
        │            │            │              │
        └────────────┴────────────┴──────────────┘
                            │
                    ┌───────▼────────┐
                    │  WebSocket     │
                    │    Server      │
                    │  (Bun/TS)      │
                    └───────┬────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌───────▼────────┐  ┌───────▼────────┐
│   PostgreSQL   │  │  DeepSeek AI   │  │  Alibaba OSS   │
│    Database    │  │     API        │  │    Storage     │
└────────────────┘  └────────────────┘  └────────────────┘
```

## Technology Stack

### Core Technologies

- **Runtime**: Bun 1.1+ (TypeScript execution)
- **Real-time**: WebSocket (ws library)
- **Database**: PostgreSQL 14+ with pg library
- **AI Provider**: DeepSeek API
- **File Storage**: Alibaba Cloud OSS
- **Authentication**: Supabase Auth (optional)

### Key Libraries

| Purpose | Library |
|---------|---------|
| WebSocket | ws (native Bun) |
| Database | pg |
| Validation | zod |
| Cloud Storage | ali-oss |
| Authentication | @supabase/supabase-js |

## Component Architecture

### Server Components

```
multiplayer/
├── websocket-server.ts      # Main WebSocket server
├── websocket-client.ts      # Client connection handler
├── ai-service.ts            # AI integration layer
├── ai-agent.ts              # AI agent orchestration
├── ai-trigger.ts            # AI trigger detection
├── database.ts              # Database operations
├── storage.ts               # In-memory state management
├── context.ts               # Conversation context management
├── conversation-summary.ts  # Summarization service
├── role.ts                  # Role and permission management
├── mention.ts               # @mention handling
├── file-sync.ts             # File synchronization
├── transcription.ts         # Audio transcription
├── oss.ts                   # Cloud storage integration
├── supabase-auth.ts         # Authentication service
├── supabase-client.ts       # Supabase client
├── sync.ts                  # Data synchronization
├── types.ts                 # TypeScript type definitions
└── tools/
    ├── index.ts             # Tool registry
    ├── file-tools.ts        # File operations
    ├── terminal-tools.ts    # Command execution
    └── security.ts          # Security validation
```

### Component Responsibilities

#### WebSocket Server (`websocket-server.ts`)

- Manages WebSocket connections
- Handles client authentication
- Routes messages to appropriate handlers
- Broadcasts messages to connected clients
- Manages connection lifecycle

```typescript
interface WebSocketServer {
  // Connection management
  handleConnection(client: WebSocket): void
  handleDisconnect(clientId: string): void

  // Message routing
  handleMessage(message: Message): Promise<void>
  broadcastMessage(sessionId: string, message: Message): void

  // Session management
  createSession(options: SessionOptions): Session
  joinSession(sessionId: string, userId: string): void
  leaveSession(sessionId: string, userId: string): void
}
```

#### AI Service (`ai-service.ts`)

- Integrates with DeepSeek API
- Manages conversation context
- Handles AI tool calling
- Implements rate limiting
- Manages AI memory

```typescript
interface AIService {
  // Core AI operations
  generateResponse(context: ConversationContext): Promise<AIResponse>
  generateSummary(messages: Message[]): Promise<string>

  // Context management
  updateContext(context: ConversationContext): void
  clearContext(sessionId: string): void

  // Tool calling
  executeTool(tool: Tool, params: ToolParams): Promise<ToolResult>
  registerTool(tool: Tool): void
}
```

#### Database Layer (`database.ts`)

- Manages PostgreSQL connections
- Implements query builders
- Handles transactions
- Provides data access methods

```typescript
interface Database {
  // Session operations
  createSession(session: Session): Promise<void>
  getSession(sessionId: string): Promise<Session>
  updateSession(sessionId: string, updates: Partial<Session>): Promise<void>

  // Message operations
  saveMessage(message: Message): Promise<void>
  getMessages(sessionId: string, limit?: number): Promise<Message[]>
  deleteMessage(messageId: string): Promise<void>

  // User operations
  createParticipant(participant: Participant): Promise<void>
  updateParticipant(sessionId: string, userId: string, updates: Partial<Participant>): Promise<void>
}
```

#### Role System (`role.ts`)

- Defines user roles (Owner, Admin, Member, Guest, AI)
- Manages permission checks
- Handles role-based access control

```typescript
type Role = 'owner' | 'admin' | 'member' | 'guest' | 'ai'

interface RoleManager {
  can(role: Role, action: Permission, resource: Resource): boolean
  assignRole(sessionId: string, userId: string, role: Role): void
  revokeRole(sessionId: string, userId: string): void
  getRole(sessionId: string, userId: string): Role
}
```

#### AI Tools (`tools/`)

- Implements AI callable functions
- Validates tool parameters
- Executes operations safely
- Returns formatted results

```typescript
interface Tool {
  name: string
  description: string
  parameters: z.ZodType
  execute(params: unknown): Promise<ToolResult>
}

// Available tools
interface ToolRegistry {
  'read_file': FileReadTool
  'list_files': FileListTool
  'execute_command': CommandExecutionTool
  'write_file': FileWriteTool
}
```

## Data Flow

### Message Flow

```
Client A              WebSocket Server           Database
    │                         │                      │
    ├───── SEND MESSAGE ─────>│                      │
    │                         ├───── SAVE ──────────>│
    │                         │                      │
    │                         ├───── PROCESS AI ─────┤
    │                         │                      │
    │                         │<───── AI RESPONSE ───┤
    │                         │                      │
    │<──── BROADCAST ─────────┤                      │
    │                         │                      │
Client B ─────────────────────┤                      │
```

### AI Tool Execution Flow

```
Client Message
      │
      ▼
┌─────────────┐
│   AI Agent  │
└──────┬──────┘
       │
       ▼
┌──────────────┐     ┌──────────────┐
│  Parse Tool  │────>│  Validate    │
│    Call      │     │  Parameters  │
└──────┬───────┘     └──────┬───────┘
       │                     │
       ▼                     ▼
┌──────────────┐     ┌──────────────┐
│  Execute     │     │  Return      │
│   Tool       │     │  Error       │
└──────┬───────┘     └──────┬───────┘
       │                     │
       ▼                     │
┌──────────────┐             │
│ Format Result│             │
└──────┬───────┘             │
       │                     │
       └──────────┬──────────┘
                  │
                  ▼
          ┌──────────────┐
          │ Return to    │
          │    Client    │
          └──────────────┘
```

## AI Integration

### Conversation Context Management

The AI service maintains conversation context to provide coherent responses:

```typescript
interface ConversationContext {
  sessionId: string
  messages: Message[]
  files: FileReference[]
  participants: Participant[]
  summary?: string
  metadata: ContextMetadata
}
```

### Tool Calling Architecture

AI can invoke tools to perform operations:

```typescript
interface ToolCall {
  id: string
  name: string
  parameters: Record<string, unknown>
}

interface ToolResult {
  success: boolean
  data: unknown
  error?: string
}
```

### Memory Management

- Auto-summarization when context exceeds token limits
- Selective retention of important messages
- Periodic cleanup of old contexts

## Security Model

### Authentication Flow

```
Client                Supabase              WebSocket Server
  │                       │                        │
  ├───── LOGIN ─────────>│                        │
  │<──── TOKEN ──────────┤                        │
  │                       │                        │
  ├──── CONNECT WITH TOKEN ──────────────────────>│
  │                       │                        │
  │                       ├───── VERIFY TOKEN ────>│
  │                       │<──── VALID ────────────┤
  │                       │                        │
  │<──── AUTHENTICATED ───────────────────────────┤
```

### Permission Model

```typescript
interface Permission {
  resource: 'message' | 'file' | 'session' | 'user'
  action: 'create' | 'read' | 'update' | 'delete'
  condition?: (context: PermissionContext) => boolean
}

const rolePermissions: Record<Role, Permission[]> = {
  owner: [/* all permissions */],
  admin: [/* most permissions */],
  member: [/* basic permissions */],
  guest: [/* read-only */],
  ai: [/* ai-specific */]
}
```

### Security Measures

- Input validation using Zod schemas
- SQL injection prevention via parameterized queries
- File system access sandboxing
- Rate limiting on AI API calls
- Command execution restrictions

## Scalability Considerations

### Current Architecture (Single Server)

- Handles up to 1000 concurrent connections
- In-memory session storage
- Direct PostgreSQL connection

### Scaling Strategies

#### Horizontal Scaling

```
                ┌─────────────┐
                │   Load      │
                │  Balancer   │
                └──────┬──────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
┌───────▼──────┐ ┌─────▼─────┐ ┌─────▼─────┐
│   Server 1   │ │  Server 2 │ │  Server 3 │
└──────────────┘ └───────────┘ └───────────┘
        │              │              │
        └──────────────┼──────────────┘
                       │
                ┌──────▼────────┐
                │  Redis (Pub)  │
                │   PostgreSQL  │
                └───────────────┘
```

#### Caching Layer

- Redis for session state
- Message queue for inter-server communication
- CDN for static assets

#### Database Optimization

- Connection pooling
- Read replicas for queries
- Partitioning by session ID
- Index optimization

### Performance Targets

| Metric | Target |
|--------|--------|
| Message latency | < 100ms |
| AI response time | < 5s |
| Concurrent connections | 10,000+ |
| Uptime | 99.9% |

## Deployment Architecture

### Docker Container

```dockerfile
# Multi-stage build for production
Stage 1: Dependencies
Stage 2: Build
Stage 3: Production (minimal)
```

### Environment Configuration

```env
# Server
WS_PORT=3002
WS_HOST=0.0.0.0

# Database (Connection Pool)
DATABASE_URL=postgresql://user:pass@host:5432/db?pool_max=20

# AI (Rate Limiting)
DEEPSEEK_MAX_REQUESTS_PER_MINUTE=60

# Storage (CDN)
OSS_CDN_DOMAIN=cdn.example.com
```

## Monitoring & Observability

### Health Checks

```typescript
interface HealthStatus {
  status: 'ok' | 'degraded' | 'down'
  uptime: number
  connections: number
  sessions: number
  services: {
    database: ServiceStatus
    ai: ServiceStatus
    storage: ServiceStatus
  }
}
```

### Metrics

- Connection count
- Message throughput
- AI response times
- Error rates
- Resource utilization

## Future Architecture Improvements

### Planned Enhancements

1. **Microservices Architecture**
   - Separate AI service
   - File service abstraction
   - Notification service

2. **Event-Driven Architecture**
   - Message queue for async operations
   - Event sourcing for audit trail
   - CQRS pattern for queries

3. **Advanced AI Features**
   - Multi-model support
   - Custom agent framework
   - Plugin system

4. **Edge Deployment**
   - Edge functions for static assets
   - Regional servers for low latency
   - CDN integration

---

For API details, see [docs/API.md](API.md)
For deployment guide, see [docs/DEPLOYMENT.md](DEPLOYMENT.md)
