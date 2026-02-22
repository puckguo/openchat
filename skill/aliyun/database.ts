/**
 * Alibaba Cloud RDS PostgreSQL Integration Module
 * Reusable database integration for persistent storage
 *
 * @example
 * ```typescript
 * import { DatabaseManager, initializeDatabase } from './database'
 *
 * // Initialize
 * const db = await initializeDatabase()
 *
 * // Save message
 * await db.saveMessage('session-123', {
 *   id: 'msg-001',
 *   senderId: 'user-456',
 *   content: 'Hello!',
 *   timestamp: new Date().toISOString()
 * })
 * ```
 */

import { Client, QueryResult } from "pg"

// =============================================================================
// Types & Interfaces
// =============================================================================

export interface DatabaseConfig {
  /** Database host */
  host: string
  /** Database port */
  port: number
  /** Database name */
  database: string
  /** Database user */
  user: string
  /** Database password */
  password: string
  /** Use SSL connection */
  ssl?: boolean
}

export interface SessionData {
  id: string
  name?: string
  createdBy?: string
  createdAt?: Date
  updatedAt?: Date
  settings?: Record<string, any>
}

export interface MessageData {
  id: string
  sessionId: string
  senderId: string
  senderName?: string
  senderRole?: string
  type?: string
  content?: string
  mentions?: string[]
  mentionsAI?: boolean
  replyTo?: string
  fileData?: Record<string, any>
  imageData?: Record<string, any>
  voiceData?: Record<string, any>
  codeData?: Record<string, any>
  timestamp?: string | Date
  vectorClock?: Record<string, any>
}

export interface ParticipantData {
  id: string
  sessionId: string
  name: string
  role?: string
  status?: string
  joinedAt?: string | Date
  lastSeen?: string | Date
}

export interface FileMetadata {
  id: string
  sessionId: string
  messageId?: string
  fileName: string
  fileSize: number
  mimeType: string
  ossUrl: string
  ossKey: string
  uploadedBy: string
}

// =============================================================================
// Configuration
// =============================================================================

/**
 * Get database configuration from environment variables
 * Override this function to provide custom configuration
 */
export function getDatabaseConfig(): DatabaseConfig {
  return {
    host: process.env.VITE_RDS_HOST || process.env.RDS_HOST || "localhost",
    port: parseInt(process.env.VITE_RDS_PORT || process.env.RDS_PORT || "5432"),
    database: process.env.VITE_RDS_DATABASE || process.env.RDS_DATABASE || "app_db",
    user: process.env.VITE_RDS_USER || process.env.RDS_USER || "postgres",
    password: process.env.VITE_RDS_PASSWORD || process.env.RDS_PASSWORD || "",
    ssl: process.env.VDS_RDS_SSL === "true" || process.env.RDS_SSL === "true",
  }
}

// =============================================================================
// Database Manager Class
// =============================================================================

/**
 * Database Manager - Handles all database operations
 *
 * @example
 * ```typescript
 * const db = new DatabaseManager()
 * await db.connect()
 *
 * // Create session
 * await db.createSession('session-123', 'My Session', 'user-456')
 *
 * // Save message
 * await db.saveMessage('session-123', messageData)
 * ```
 */
export class DatabaseManager {
  private client: Client | null = null
  private config: DatabaseConfig

  constructor(config?: DatabaseConfig) {
    this.config = config || getDatabaseConfig()
  }

  /**
   * Connect to database
   * Automatically creates database if not exists
   */
  async connect(): Promise<void> {
    try {
      // First connect to default 'postgres' database to create our database if not exists
      const adminClient = new Client({
        host: this.config.host,
        port: this.config.port,
        database: "postgres",
        user: this.config.user,
        password: this.config.password,
        ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      })

      await adminClient.connect()
      console.log("[Database] Connected to postgres database")

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
        ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
      })

      await this.client.connect()
      console.log("[Database] Connected to PostgreSQL")

      // Initialize tables
      await this.initializeTables()
    } catch (error) {
      console.error("[Database] Connection failed:", error)
      throw error
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end()
      this.client = null
      console.log("[Database] Disconnected")
    }
  }

  /**
   * Check if client is connected
   */
  private ensureConnected(): void {
    if (!this.client) {
      throw new Error("Database not connected. Call connect() first.")
    }
  }

  /**
   * Initialize database tables
   * Override this method to customize table structure
   */
  protected async initializeTables(): Promise<void> {
    this.ensureConnected()

    // Sessions table
    await this.client!.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255),
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        settings JSONB DEFAULT '{}'
      )
    `)

    // Messages table
    await this.client!.query(`
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
    await this.client!.query(`
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

    // Files table (metadata for cloud storage files)
    await this.client!.query(`
      CREATE TABLE IF NOT EXISTS files (
        id VARCHAR(255) PRIMARY KEY,
        session_id VARCHAR(255) REFERENCES sessions(id) ON DELETE CASCADE,
        message_id VARCHAR(255),
        file_name VARCHAR(500),
        file_size BIGINT,
        mime_type VARCHAR(100),
        storage_url VARCHAR(1000),
        storage_key VARCHAR(500),
        uploaded_by VARCHAR(255),
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create indexes
    await this.client!.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_participants_session_id ON participants(session_id);
      CREATE INDEX IF NOT EXISTS idx_files_session_id ON files(session_id);
    `)

    console.log("[Database] Tables initialized")
  }

  // ===========================================================================
  // Session Operations
  // ===========================================================================

  /**
   * Create a new session
   */
  async createSession(
    sessionId: string,
    name?: string,
    createdBy?: string,
    settings?: Record<string, any>
  ): Promise<void> {
    this.ensureConnected()

    await this.client!.query(
      `INSERT INTO sessions (id, name, created_by, settings)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO NOTHING`,
      [sessionId, name || sessionId, createdBy || null, settings || {}]
    )
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<SessionData | null> {
    this.ensureConnected()

    const result = await this.client!.query(
      `SELECT * FROM sessions WHERE id = $1`,
      [sessionId]
    )

    return result.rows[0] || null
  }

  /**
   * Update session settings
   */
  async updateSessionSettings(
    sessionId: string,
    settings: Record<string, any>
  ): Promise<void> {
    this.ensureConnected()

    await this.client!.query(
      `UPDATE sessions SET settings = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [JSON.stringify(settings), sessionId]
    )
  }

  /**
   * Delete session and all related data
   */
  async deleteSession(sessionId: string): Promise<void> {
    this.ensureConnected()

    await this.client!.query(`DELETE FROM sessions WHERE id = $1`, [sessionId])
  }

  // ===========================================================================
  // Message Operations
  // ===========================================================================

  /**
   * Save a message
   */
  async saveMessage(sessionId: string, message: MessageData): Promise<void> {
    this.ensureConnected()

    // Ensure session exists
    await this.createSession(sessionId)

    await this.client!.query(
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
        message.senderName || null,
        message.senderRole || "user",
        message.type || "text",
        message.content || null,
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

  /**
   * Get messages for a session
   */
  async getMessages(
    sessionId: string,
    limit: number = 100,
    before?: string
  ): Promise<MessageData[]> {
    this.ensureConnected()

    let query = `
      SELECT * FROM messages
      WHERE session_id = $1
      ${before ? "AND timestamp < $3" : ""}
      ORDER BY timestamp DESC
      LIMIT $2
    `

    const params = before ? [sessionId, limit, before] : [sessionId, limit]
    const result = await this.client!.query(query, params)

    return result.rows.map((row) => this.rowToMessage(row))
  }

  /**
   * Get a single message by ID
   */
  async getMessage(messageId: string): Promise<MessageData | null> {
    this.ensureConnected()

    const result = await this.client!.query(
      `SELECT * FROM messages WHERE id = $1`,
      [messageId]
    )

    return result.rows[0] ? this.rowToMessage(result.rows[0]) : null
  }

  /**
   * Delete a message
   */
  async deleteMessage(messageId: string): Promise<void> {
    this.ensureConnected()

    await this.client!.query(`DELETE FROM messages WHERE id = $1`, [messageId])
  }

  /**
   * Clear all messages in a session
   */
  async clearSessionMessages(sessionId: string): Promise<number> {
    this.ensureConnected()

    const result = await this.client!.query(
      `DELETE FROM messages WHERE session_id = $1`,
      [sessionId]
    )

    console.log(`[Database] Cleared ${result.rowCount} messages for session ${sessionId}`)
    return result.rowCount || 0
  }

  /**
   * Convert database row to MessageData
   */
  private rowToMessage(row: any): MessageData {
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
    }
  }

  // ===========================================================================
  // Participant Operations
  // ===========================================================================

  /**
   * Save or update a participant
   */
  async saveParticipant(sessionId: string, participant: ParticipantData): Promise<void> {
    this.ensureConnected()

    await this.client!.query(
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
        participant.role || "user",
        participant.status || "online",
        participant.joinedAt || new Date().toISOString(),
        participant.lastSeen || new Date().toISOString(),
      ]
    )
  }

  /**
   * Update participant status
   */
  async updateParticipantStatus(
    sessionId: string,
    userId: string,
    status: string,
    lastSeen?: string
  ): Promise<void> {
    this.ensureConnected()

    await this.client!.query(
      `UPDATE participants
       SET status = $3, last_seen = COALESCE($4, CURRENT_TIMESTAMP)
       WHERE id = $1 AND session_id = $2`,
      [userId, sessionId, status, lastSeen || null]
    )
  }

  /**
   * Get all participants in a session
   */
  async getSessionParticipants(sessionId: string): Promise<ParticipantData[]> {
    this.ensureConnected()

    const result = await this.client!.query(
      `SELECT * FROM participants WHERE session_id = $1`,
      [sessionId]
    )

    return result.rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      name: row.user_name,
      role: row.user_role,
      status: row.status,
      joinedAt: row.joined_at,
      lastSeen: row.last_seen,
    }))
  }

  // ===========================================================================
  // File Operations
  // ===========================================================================

  /**
   * Save file metadata
   */
  async saveFileMetadata(fileData: FileMetadata): Promise<void> {
    this.ensureConnected()

    await this.client!.query(
      `INSERT INTO files (id, session_id, message_id, file_name, file_size, mime_type, storage_url, storage_key, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        fileData.id,
        fileData.sessionId,
        fileData.messageId || null,
        fileData.fileName,
        fileData.fileSize,
        fileData.mimeType,
        fileData.ossUrl,
        fileData.ossKey,
        fileData.uploadedBy,
      ]
    )
  }

  /**
   * Get file by ID
   */
  async getFileById(fileId: string): Promise<any | null> {
    this.ensureConnected()

    const result = await this.client!.query(
      `SELECT * FROM files WHERE id = $1`,
      [fileId]
    )

    return result.rows[0] || null
  }

  /**
   * Get file by message ID
   */
  async getFileByMessageId(messageId: string): Promise<any | null> {
    this.ensureConnected()

    const result = await this.client!.query(
      `SELECT * FROM files WHERE message_id = $1`,
      [messageId]
    )

    return result.rows[0] || null
  }

  /**
   * Get all files in a session
   */
  async getSessionFiles(sessionId: string): Promise<any[]> {
    this.ensureConnected()

    const result = await this.client!.query(
      `SELECT * FROM files WHERE session_id = $1 ORDER BY uploaded_at DESC`,
      [sessionId]
    )

    return result.rows
  }

  /**
   * Update file metadata
   */
  async updateFileMetadata(
    fileId: string,
    updates: { fileName?: string; storageUrl?: string; storageKey?: string }
  ): Promise<void> {
    this.ensureConnected()

    const setClauses: string[] = []
    const values: any[] = [fileId]
    let paramIndex = 2

    if (updates.fileName) {
      setClauses.push(`file_name = $${paramIndex++}`)
      values.push(updates.fileName)
    }
    if (updates.storageUrl) {
      setClauses.push(`storage_url = $${paramIndex++}`)
      values.push(updates.storageUrl)
    }
    if (updates.storageKey) {
      setClauses.push(`storage_key = $${paramIndex++}`)
      values.push(updates.storageKey)
    }

    if (setClauses.length > 0) {
      await this.client!.query(
        `UPDATE files SET ${setClauses.join(", ")} WHERE id = $1`,
        values
      )
    }
  }

  /**
   * Delete file metadata
   */
  async deleteFile(fileId: string): Promise<void> {
    this.ensureConnected()

    await this.client!.query(`DELETE FROM files WHERE id = $1`, [fileId])
  }

  // ===========================================================================
  // Raw Query Operations
  // ===========================================================================

  /**
   * Execute a raw query
   */
  async query(text: string, params?: any[]): Promise<QueryResult> {
    this.ensureConnected()
    return this.client!.query(text, params)
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let globalDbManager: DatabaseManager | null = null

/**
 * Get global database manager instance (singleton)
 */
export function getDatabaseManager(): DatabaseManager {
  if (!globalDbManager) {
    globalDbManager = new DatabaseManager()
  }
  return globalDbManager
}

/**
 * Initialize global database manager
 */
export async function initializeDatabase(): Promise<DatabaseManager> {
  const db = getDatabaseManager()
  await db.connect()
  return db
}

/**
 * Reset global database manager (useful for testing)
 */
export function resetDatabaseManager(): void {
  globalDbManager = null
}
