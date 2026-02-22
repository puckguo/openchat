/**
 * RDS Database Integration
 * PostgreSQL database for persistent storage of chat messages and sessions
 */

import { Client } from "pg"
import type { ChatMessage, Participant } from "./types"

// =============================================================================
// Database Configuration
// =============================================================================

export interface DatabaseConfig {
  host: string
  port: number
  database: string
  user: string
  password: string
}

export function getDatabaseConfig(): DatabaseConfig {
  return {
    host: process.env.VITE_RDS_HOST || "localhost",
    port: parseInt(process.env.VITE_RDS_PORT || "5432"),
    database: process.env.VITE_RDS_DATABASE || "opencode-chat",
    user: process.env.VITE_RDS_USER || "postgres",
    password: process.env.VITE_RDS_PASSWORD || "",
  }
}

// =============================================================================
// Database Manager
// =============================================================================

export class DatabaseManager {
  private client: Client | null = null
  private config: DatabaseConfig

  constructor(config?: DatabaseConfig) {
    this.config = config || getDatabaseConfig()
  }

  async connect(): Promise<void> {
    try {
      // First connect to default 'postgres' database to create our database if not exists
      const adminClient = new Client({
        host: this.config.host,
        port: this.config.port,
        database: 'postgres',
        user: this.config.user,
        password: this.config.password,
        ssl: false,
      })

      await adminClient.connect()
      console.log('[Database] Connected to postgres database')

      // Create database if not exists
      const dbName = this.config.database
      const dbCheckResult = await adminClient.query(
        `SELECT 1 FROM pg_database WHERE datname = $1`,
        [dbName]
      )

      if (dbCheckResult.rowCount === 0) {
        console.log(`[Database] Creating database: ${dbName}`)
        await adminClient.query(`CREATE DATABASE "${dbName}"`)
        console.log(`[Database] Database ${dbName} created successfully`)
      }

      await adminClient.end()

      // Now connect to the actual database
      this.client = new Client({
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        ssl: false,
      })

      await this.client.connect()
      console.log('[Database] Connected to RDS PostgreSQL')

      // Initialize tables
      await this.initializeTables()
    } catch (error) {
      console.error('[Database] Connection failed:', error)
      throw error
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end()
      this.client = null
      console.log("[Database] Disconnected from RDS")
    }
  }

  private async initializeTables(): Promise<void> {
    if (!this.client) return

    // Sessions table
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255),
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        settings JSONB DEFAULT '{}',
        password_question VARCHAR(500),
        password_answer VARCHAR(500)
      )
    `)

    // 添加密码问题字段（如果不存在）
    try {
      await this.client.query(`
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS password_question VARCHAR(500)
      `)
      await this.client.query(`
        ALTER TABLE sessions ADD COLUMN IF NOT EXISTS password_answer VARCHAR(500)
      `)
      console.log("[Database] Added password columns to sessions")
    } catch (e) {
      // 字段可能已存在
    }

    // Messages table
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(255) PRIMARY KEY,
        session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
        sender_id VARCHAR(255),
        sender_name VARCHAR(255),
        sender_role VARCHAR(50),
        type VARCHAR(50) DEFAULT 'text',
        content TEXT,
        mentions JSONB DEFAULT '[]',
        mentions_ai BOOLEAN DEFAULT FALSE,
        reply_to VARCHAR(255),
        file_data JSONB,
        image_data JSONB,
        voice_data JSONB,
        code_data JSONB,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        vector_clock JSONB
      )
    `)

    // Participants table
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS participants (
        id VARCHAR(255),
        session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
        user_name VARCHAR(255),
        user_role VARCHAR(50),
        status VARCHAR(50) DEFAULT 'offline',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id, session_id)
      )
    `)

    // Files table (metadata for OSS files)
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS files (
        id VARCHAR(255) PRIMARY KEY,
        session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
        message_id VARCHAR(255),
        file_name VARCHAR(500),
        file_size BIGINT,
        mime_type VARCHAR(100),
        oss_url VARCHAR(1000),
        oss_key VARCHAR(500),
        uploaded_by VARCHAR(255),
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create indexes
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_participants_session_id ON participants(session_id);
      CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(session_id);
    `)

    // Fix: Add missing columns to existing tables
    try {
      await this.client.query(`
        ALTER TABLE messages ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      `)
      console.log("[Database] Added updated_at column to messages")
    } catch (e) {
      // Column might already exist
    }

    console.log("[Database] Tables initialized")
  }

  // ===========================================================================
  // Session Operations
  // ===========================================================================

  async createSession(
    sessionId: string,
    name?: string,
    createdBy?: string,
    passwordQuestion?: string,
    passwordAnswer?: string
  ): Promise<void> {
    if (!this.client) throw new Error("Database not connected")

    // 如果提供了密码，使用 ON CONFLICT DO UPDATE 更新密码
    if (passwordQuestion && passwordAnswer) {
      await this.client.query(
        `INSERT INTO sessions (id, name, created_by, password_question, password_answer)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET
           password_question = EXCLUDED.password_question,
           password_answer = EXCLUDED.password_answer,
           updated_at = CURRENT_TIMESTAMP`,
        [sessionId, name || sessionId, createdBy, passwordQuestion, passwordAnswer]
      )
    } else {
      await this.client.query(
        `INSERT INTO sessions (id, name, created_by, password_question, password_answer)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [sessionId, name || sessionId, createdBy, passwordQuestion || null, passwordAnswer || null]
      )
    }
  }

  async verifySessionPassword(sessionId: string, answer: string): Promise<boolean> {
    if (!this.client) throw new Error("Database not connected")

    const result = await this.client.query(
      `SELECT password_answer FROM sessions WHERE id = $1`,
      [sessionId]
    )

    if (result.rowCount === 0) return true // 会话不存在，视为验证通过（让后续处理）

    const session = result.rows[0]
    // 如果没有设置密码，直接通过
    if (!session.password_answer) return true

    // 比较答案（不区分大小写）
    return session.password_answer.toLowerCase() === answer.toLowerCase()
  }

  async getSessionPasswordQuestion(sessionId: string): Promise<string | null> {
    if (!this.client) throw new Error("Database not connected")

    const result = await this.client.query(
      `SELECT password_question FROM sessions WHERE id = $1`,
      [sessionId]
    )

    if (result.rowCount === 0) return null
    return result.rows[0].password_question
  }

  async setSessionPassword(sessionId: string, question: string, answer: string): Promise<void> {
    if (!this.client) throw new Error("Database not connected")

    await this.client.query(
      `UPDATE sessions SET password_question = $1, password_answer = $2 WHERE id = $3`,
      [question, answer, sessionId]
    )
  }

  async getSession(sessionId: string): Promise<any | null> {
    if (!this.client) throw new Error("Database not connected")

    const result = await this.client.query(
      `SELECT * FROM sessions WHERE id = $1`,
      [sessionId]
    )

    return result.rows[0] || null
  }

  // ===========================================================================
  // Message Operations
  // ===========================================================================

  async saveMessage(sessionId: string, message: ChatMessage): Promise<void> {
    if (!this.client) throw new Error("Database not connected")

    // Ensure session exists
    await this.createSession(sessionId)

    await this.client.query(
      `INSERT INTO messages (
        id, session_id, sender_id, sender_name, sender_role,
        type, content, mentions, mentions_ai, reply_to,
        file_data, image_data, voice_data, code_data, vector_clock, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET
        content = EXCLUDED.content,
        updated_at = CURRENT_TIMESTAMP`,
      [
        message.id,
        sessionId,
        message.senderId,
        message.senderName,
        message.senderRole,
        message.type,
        message.content,
        JSON.stringify(message.mentions || []),
        message.mentionsAI || false,
        message.replyTo || null,
        message.fileData ? JSON.stringify(message.fileData) : null,
        message.imageData ? JSON.stringify(message.imageData) : null,
        message.voiceData ? JSON.stringify(message.voiceData) : null,
        message.codeData ? JSON.stringify(message.codeData) : null,
        message.vectorClock ? JSON.stringify(message.vectorClock) : null,
        message.timestamp || new Date().toISOString(),
      ]
    )
  }

  async getMessages(sessionId: string, limit: number = 100, before?: string): Promise<ChatMessage[]> {
    if (!this.client) throw new Error("Database not connected")

    let query = `
      SELECT * FROM messages
      WHERE session_id = $1
      ${before ? "AND timestamp < $3" : ""}
      ORDER BY timestamp DESC
      LIMIT $2
    `

    const params = before ? [sessionId, limit, before] : [sessionId, limit]
    const result = await this.client.query(query, params)

    return result.rows.map(row => this.rowToMessage(row))
  }

  private rowToMessage(row: any): ChatMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      senderRole: row.sender_role,
      type: row.type,
      content: row.content,
      mentions: row.mentions || [],
      mentionsAI: row.mentions_ai,
      replyTo: row.reply_to,
      fileData: row.file_data,
      imageData: row.image_data,
      voiceData: row.voice_data,
      codeData: row.code_data,
      timestamp: row.timestamp,
      vectorClock: row.vector_clock,
    } as ChatMessage
  }

  // ===========================================================================
  // Message Operations - Clear
  // ===========================================================================

  async clearSessionMessages(sessionId: string): Promise<number> {
    if (!this.client) throw new Error("Database not connected")

    const result = await this.client.query(
      `DELETE FROM messages WHERE session_id = $1`,
      [sessionId]
    )

    console.log(`[Database] Cleared ${result.rowCount} messages for session ${sessionId}`)
    return result.rowCount || 0
  }

  // ===========================================================================
  // Participant Operations
  // ===========================================================================

  async saveParticipant(sessionId: string, participant: Participant): Promise<void> {
    if (!this.client) throw new Error("Database not connected")

    await this.client.query(
      `INSERT INTO participants (id, session_id, user_name, user_role, status, joined_at, last_seen)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id, session_id) DO UPDATE SET
         user_name = EXCLUDED.user_name,
         user_role = EXCLUDED.user_role,
         status = EXCLUDED.status,
         last_seen = EXCLUDED.last_seen`,
      [
        participant.id,
        sessionId,
        participant.name,
        participant.role,
        participant.status,
        participant.joinedAt,
        participant.lastSeen,
      ]
    )
  }

  async updateParticipantStatus(
    sessionId: string,
    userId: string,
    status: string,
    lastSeen?: string
  ): Promise<void> {
    if (!this.client) throw new Error("Database not connected")

    await this.client.query(
      `UPDATE participants
       SET status = $3, last_seen = COALESCE($4, CURRENT_TIMESTAMP)
       WHERE id = $1 AND session_id = $2`,
      [userId, sessionId, status, lastSeen]
    )
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  async saveFileMetadata(fileData: {
    id: string
    sessionId: string
    messageId: string
    fileName: string
    fileSize: number
    mimeType: string
    ossUrl: string
    ossKey: string
    uploadedBy: string
  }): Promise<void> {
    if (!this.client) throw new Error("Database not connected")

    await this.client.query(
      `INSERT INTO files (id, session_id, message_id, file_name, file_size, mime_type, oss_url, oss_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        fileData.id,
        fileData.sessionId,
        fileData.messageId,
        fileData.fileName,
        fileData.fileSize,
        fileData.mimeType,
        fileData.ossUrl,
        fileData.ossKey,
        fileData.uploadedBy,
      ]
    )
  }

  async getFileByMessageId(messageId: string): Promise<any | null> {
    if (!this.client) throw new Error("Database not connected")

    const result = await this.client.query(
      `SELECT * FROM files WHERE message_id = $1`,
      [messageId]
    )

    return result.rows[0] || null
  }

  async getFileById(fileId: string): Promise<any | null> {
    if (!this.client) throw new Error("Database not connected")

    const result = await this.client.query(
      `SELECT * FROM files WHERE id = $1`,
      [fileId]
    )

    return result.rows[0] || null
  }

  async deleteFile(fileId: string): Promise<void> {
    if (!this.client) throw new Error("Database not connected")

    await this.client.query(
      `DELETE FROM files WHERE id = $1`,
      [fileId]
    )
  }

  async renameFile(fileId: string, newFileName: string, newOssUrl: string, newOssKey: string): Promise<void> {
    if (!this.client) throw new Error("Database not connected")

    await this.client.query(
      `UPDATE files SET file_name = $1, oss_url = $2, oss_key = $3 WHERE id = $4`,
      [newFileName, newOssUrl, newOssKey, fileId]
    )
  }

  async getSessionFiles(sessionId: string): Promise<any[]> {
    if (!this.client) throw new Error("Database not connected")

    const result = await this.client.query(
      `SELECT * FROM files WHERE session_id = $1 ORDER BY uploaded_at DESC`,
      [sessionId]
    )

    return result.rows
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let globalDbManager: DatabaseManager | null = null

export function getDatabaseManager(): DatabaseManager {
  if (!globalDbManager) {
    globalDbManager = new DatabaseManager()
  }
  return globalDbManager
}

export async function initializeDatabase(): Promise<DatabaseManager> {
  const db = getDatabaseManager()
  await db.connect()
  return db
}
