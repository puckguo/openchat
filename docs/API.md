# Open CoChat API Documentation

This document describes the WebSocket API for Open CoChat, including message formats, events, and integration examples.

## Table of Contents

- [Connection](#connection)
- [Message Format](#message-format)
- [Client Events](#client-events)
- [Server Events](#server-events)
- [AI Integration](#ai-integration)
- [Error Handling](#error-handling)
- [Code Examples](#code-examples)

## Connection

### WebSocket Endpoint

```
ws://your-server:3002
wss://your-server:3002 (SSL/TLS)
```

### Connection Handshake

```javascript
const ws = new WebSocket('ws://localhost:3002');

ws.onopen = () => {
  console.log('Connected to Open CoChat');
};
```

### Authentication

If Supabase authentication is enabled:

```javascript
const ws = new WebSocket('ws://localhost:3002');

ws.onopen = () => {
  // Send authentication token
  ws.send(JSON.stringify({
    type: 'auth',
    token: 'your-supabase-jwt-token'
  }));
};
```

### Health Check

```bash
curl http://localhost:3002/health
```

Response:
```json
{
  "status": "ok",
  "uptime": 123456,
  "timestamp": "2024-01-01T00:00:00.000Z",
  "connections": 10,
  "sessions": 3
}
```

## Message Format

All WebSocket messages follow this structure:

```typescript
interface Message {
  id: string              // Unique message ID
  type: MessageType       // Message type
  sessionId: string       // Session identifier
  senderId: string        // Sender user ID
  senderName: string      // Sender display name
  senderRole: Role        // Sender's role
  content: string         // Message content
  mentions?: string[]     // Array of mentioned user IDs
  mentionsAi?: boolean    // Whether AI is mentioned
  replyTo?: string        // ID of message being replied to
  createdAt: Date         // Timestamp
  metadata?: MessageMetadata
}

type MessageType =
  | 'text'                // Plain text message
  | 'system'              // System notification
  | 'ai'                  // AI response
  | 'file'                // File upload
  | 'voice'               // Voice message
  | 'command'             // Command execution

type Role =
  | 'owner'               // Session owner
  | 'admin'               // Session administrator
  | 'member'              // Regular member
  | 'guest'               // Guest user
  | 'ai'                  // AI assistant

interface MessageMetadata {
  edited?: boolean
  deleted?: boolean
  pinned?: boolean
  reactions?: Reaction[]
  file?: FileMetadata
}

interface Reaction {
  emoji: string
  userId: string
  count: number
}

interface FileMetadata {
  name: string
  size: number
  type: string
  url: string
}
```

## Client Events

### Join Session

Join an existing chat session:

```javascript
ws.send(JSON.stringify({
  type: 'join_session',
  sessionId: 'session-123',
  password: 'optional-password'
}));
```

Response:
```json
{
  "type": "session_joined",
  "sessionId": "session-123",
  "participants": [...],
  "recentMessages": [...]
}
```

### Create Session

Create a new chat session:

```javascript
ws.send(JSON.stringify({
  type: 'create_session',
  name: 'My Chat Room',
  isPrivate: false,
  password: null
})));
```

Response:
```json
{
  "type": "session_created",
  "sessionId": "new-session-id",
  "name": "My Chat Room",
  "joinUrl": "https://chat.example.com/session/new-session-id"
}
```

### Send Message

Send a text message:

```javascript
ws.send(JSON.stringify({
  type: 'send_message',
  sessionId: 'session-123',
  content: 'Hello everyone!',
  mentions: [],
  mentionsAi: false
})));
```

### Reply to Message

```javascript
ws.send(JSON.stringify({
  type: 'send_message',
  sessionId: 'session-123',
  content: 'I agree!',
  replyTo: 'message-456'
})));
```

### Mention AI

Trigger AI response:

```javascript
ws.send(JSON.stringify({
  type: 'send_message',
  sessionId: 'session-123',
  content: '@ai How do I implement JWT?',
  mentions: [],
  mentionsAi: true
})));
```

### Upload File

Initiate file upload:

```javascript
ws.send(JSON.stringify({
  type: 'upload_file',
  sessionId: 'session-123',
  fileName: 'document.pdf',
  fileSize: 1024000,
  fileType: 'application/pdf'
})));
```

Response with upload URL:
```json
{
  "type": "file_upload_ready",
  "uploadUrl": "https://oss.example.com/upload/...",
  "fileId": "file-789",
  "uploadMethod": "PUT"
}
```

After upload, confirm:
```javascript
ws.send(JSON.stringify({
  type: 'file_upload_complete',
  sessionId: 'session-123',
  fileId: 'file-789'
})));
```

### Typing Indicator

Send typing status:

```javascript
ws.send(JSON.stringify({
  type: 'typing',
  sessionId: 'session-123',
  isTyping: true
})));
```

### Request Summary

Request AI-generated conversation summary:

```javascript
ws.send(JSON.stringify({
  type: 'request_summary',
  sessionId: 'session-123'
})));
```

### Edit Message

```javascript
ws.send(JSON.stringify({
  type: 'edit_message',
  messageId: 'message-456',
  content: 'Updated message content'
})));
```

### Delete Message

```javascript
ws.send(JSON.stringify({
  type: 'delete_message',
  messageId: 'message-456'
})));
```

## Server Events

### Message Broadcast

New message from any participant:

```json
{
  "type": "new_message",
  "message": {
    "id": "msg-123",
    "type": "text",
    "sessionId": "session-123",
    "senderId": "user-456",
    "senderName": "John Doe",
    "senderRole": "member",
    "content": "Hello!",
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### AI Response

```json
{
  "type": "ai_response",
  "message": {
    "id": "msg-124",
    "type": "ai",
    "sessionId": "session-123",
    "senderId": "ai",
    "senderName": "AI Assistant",
    "senderRole": "ai",
    "content": "Here's how to implement JWT...",
    "createdAt": "2024-01-01T00:00:01.000Z",
    "metadata": {
      "model": "deepseek-chat",
      "tokensUsed": 150
    }
  }
}
```

### AI Tool Call

When AI executes a tool:

```json
{
  "type": "ai_tool_call",
  "tool": "read_file",
  "parameters": {
    "path": "/src/utils/api.ts"
  },
  "result": {
    "success": true,
    "data": "file contents..."
  }
}
```

### Participant Joined

```json
{
  "type": "participant_joined",
  "sessionId": "session-123",
  "participant": {
    "userId": "user-789",
    "name": "Jane Smith",
    "role": "member",
    "joinedAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### Participant Left

```json
{
  "type": "participant_left",
  "sessionId": "session-123",
  "userId": "user-789"
}
```

### Typing Indicator

```json
{
  "type": "typing",
  "sessionId": "session-123",
  "userId": "user-456",
  "isTyping": true
}
```

### Message Updated

```json
{
  "type": "message_updated",
  "messageId": "msg-123",
  "content": "Updated content",
  "editedAt": "2024-01-01T00:01:00.000Z"
}
```

### Message Deleted

```json
{
  "type": "message_deleted",
  "messageId": "msg-123"
}
```

### Session Summary

```json
{
  "type": "session_summary",
  "sessionId": "session-123",
  "summary": "The team discussed JWT implementation...",
  "keyPoints": [
    "Use jsonwebtoken library",
    "Implement refresh token rotation",
    "Store tokens securely"
  ],
  "actionItems": [
    "Create auth middleware",
    "Add token validation"
  ]
}
```

### Error Response

```json
{
  "type": "error",
  "code": "AUTH_FAILED",
  "message": "Invalid authentication token",
  "details": {}
}
```

## AI Integration

### AI Message Format

Messages sent to AI:

```json
{
  "type": "ai_request",
  "sessionId": "session-123",
  "context": {
    "messages": [
      {
        "role": "user",
        "content": "Previous message"
      }
    ],
    "tools": ["read_file", "execute_command"],
    "workspace": "/path/to/workspace"
  },
  "query": "@ai How do I...?"
}
```

### Available AI Tools

#### File Operations

```typescript
// Read file
{
  "tool": "read_file",
  "parameters": {
    "path": "/src/index.ts"
  }
}

// List files
{
  "tool": "list_files",
  "parameters": {
    "directory": "/src",
    "pattern": "*.ts"
  }
}

// Write file
{
  "tool": "write_file",
  "parameters": {
    "path": "/src/newfile.ts",
    "content": "file content"
  }
}
```

#### Terminal Commands

```typescript
{
  "tool": "execute_command",
  "parameters": {
    "command": "npm test",
    "cwd": "/project"
  }
}
```

### AI Response with Tool Calls

```json
{
  "type": "ai_response",
  "content": "Let me check that file for you...",
  "toolCalls": [
    {
      "id": "call_123",
      "tool": "read_file",
      "parameters": {
        "path": "/src/utils.ts"
      }
    }
  ]
}
```

### AI Tool Results

```json
{
  "type": "ai_tool_result",
  "callId": "call_123",
  "tool": "read_file",
  "result": {
    "success": true,
    "data": "// file contents..."
  }
}
```

## Error Handling

### Error Codes

| Code | Description |
|------|-------------|
| `AUTH_FAILED` | Authentication failed |
| `SESSION_NOT_FOUND` | Session does not exist |
| `PERMISSION_DENIED` | Insufficient permissions |
| `INVALID_MESSAGE` | Malformed message |
| `RATE_LIMITED` | Too many requests |
| `AI_ERROR` | AI service error |
| `FILE_TOO_LARGE` | File exceeds size limit |
| `UNSUPPORTED_FILE_TYPE` | File type not allowed |

### Error Response Format

```json
{
  "type": "error",
  "code": "PERMISSION_DENIED",
  "message": "You don't have permission to delete messages",
  "details": {
    "requiredRole": "admin",
    "yourRole": "member"
  }
}
```

## Code Examples

### JavaScript/Browser Client

```javascript
class OpenCodeChat {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.sessionId = null;
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    this.ws.onopen = () => {
      console.log('Connected to Open CoChat');
    };

    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('Disconnected from Open CoChat');
    };
  }

  handleMessage(message) {
    switch (message.type) {
      case 'new_message':
        this.displayMessage(message.message);
        break;
      case 'ai_response':
        this.displayAIMessage(message.message);
        break;
      case 'participant_joined':
        this.notifyUser(`${message.participant.name} joined`);
        break;
      case 'error':
        this.showError(message.message);
        break;
    }
  }

  joinSession(sessionId, password = null) {
    this.sessionId = sessionId;
    this.ws.send(JSON.stringify({
      type: 'join_session',
      sessionId,
      password
    }));
  }

  sendMessage(content, mentionsAi = false) {
    this.ws.send(JSON.stringify({
      type: 'send_message',
      sessionId: this.sessionId,
      content,
      mentions: [],
      mentionsAi
    }));
  }

  askAI(question) {
    this.sendMessage(`@ai ${question}`, true);
  }

  displayMessage(message) {
    // Render message in UI
  }

  displayAIMessage(message) {
    // Render AI message in UI
  }
}

// Usage
const chat = new OpenCodeChat('ws://localhost:3002');
chat.joinSession('session-123');
chat.sendMessage('Hello everyone!');
chat.askAI('How do I implement JWT authentication?');
```

### Node.js Client

```javascript
const WebSocket = require('ws');

class OpenCodeChatClient {
  constructor(url, token) {
    this.ws = new WebSocket(url, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
  }

  async createSession(name, isPrivate = false) {
    return new Promise((resolve, reject) => {
      const handler = (message) => {
        const data = JSON.parse(message);
        if (data.type === 'session_created') {
          this.ws.off('message', handler);
          resolve(data);
        } else if (data.type === 'error') {
          this.ws.off('message', handler);
          reject(new Error(data.message));
        }
      };
      this.ws.on('message', handler);
      this.ws.send(JSON.stringify({
        type: 'create_session',
        name,
        isPrivate
      }));
    });
  }

  async uploadFile(sessionId, filePath) {
    const fs = require('fs');
    const stats = fs.statSync(filePath);

    // Request upload URL
    const uploadReady = await this.requestFileUpload(sessionId, {
      fileName: path.basename(filePath),
      fileSize: stats.size,
      fileType: 'application/octet-stream'
    });

    // Upload to OSS
    await this.uploadToOSS(uploadReady.uploadUrl, filePath);

    // Confirm upload
    this.ws.send(JSON.stringify({
      type: 'file_upload_complete',
      sessionId,
      fileId: uploadReady.fileId
    }));
  }
}
```

### React Hook

```typescript
import { useEffect, useState, useCallback } from 'react';

interface UseOpenCodeChatOptions {
  url: string;
  token?: string;
}

export function useOpenCodeChat({ url, token }: UseOpenCodeChatOptions) {
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const websocket = new WebSocket(url);

    websocket.onopen = () => {
      setConnected(true);
      if (token) {
        websocket.send(JSON.stringify({
          type: 'auth',
          token
        }));
      }
    };

    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'new_message') {
        setMessages(prev => [...prev, data.message]);
      }
    };

    websocket.onclose = () => {
      setConnected(false);
    };

    setWs(websocket);

    return () => {
      websocket.close();
    };
  }, [url, token]);

  const sendMessage = useCallback((content: string, mentionsAi = false) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'send_message',
        content,
        mentionsAi
      }));
    }
  }, [ws]);

  const askAI = useCallback((question: string) => {
    sendMessage(`@ai ${question}`, true);
  }, [sendMessage]);

  return {
    connected,
    messages,
    sendMessage,
    askAI
  };
}
```

## REST API (Optional)

Some operations may be available via REST API:

### GET /api/sessions

List all public sessions:

```bash
curl http://localhost:3002/api/sessions
```

### GET /api/sessions/:id

Get session details:

```bash
curl http://localhost:3002/api/sessions/session-123
```

### POST /api/sessions

Create a new session:

```bash
curl -X POST http://localhost:3002/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Chat Room",
    "isPrivate": false
  }'
```

---

For deployment information, see [docs/DEPLOYMENT.md](DEPLOYMENT.md)
For architecture details, see [docs/ARCHITECTURE.md](ARCHITECTURE.md)
