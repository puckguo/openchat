/**
 * JSON Storage Layer
 * 本地 JSON 存储层
 *
 * 用于持久化多人协作会话数据、用户记忆和文件索引
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from "fs"
import { dirname, join } from "path"
import { z } from "zod"
import type {
  ChatMessage,
  GlobalMemory,
  Participant,
  SessionConfig,
  SessionMemory,
  UserPreferences,
} from "./types"

// =============================================================================
// 存储配置
// =============================================================================

export interface StorageConfig {
  /** 基础存储目录 */
  basePath: string
  /** 会话数据目录 */
  sessionsPath: string
  /** 全局记忆文件路径 */
  globalMemoryPath: string
  /** 自动保存间隔（毫秒） */
  autoSaveInterval?: number
  /** 是否启用备份 */
  enableBackup?: boolean
  /** 备份保留数量 */
  backupCount?: number
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  basePath: ".opencode/multiplayer",
  sessionsPath: ".opencode/multiplayer/sessions",
  globalMemoryPath: ".opencode/multiplayer/memory.json",
  autoSaveInterval: 30000, // 30秒
  enableBackup: true,
  backupCount: 5,
}

// =============================================================================
// 存储管理器
// =============================================================================

export class JSONStorageManager {
  private config: StorageConfig
  private memoryCache: GlobalMemory | null = null
  private sessionCaches: Map<string, SessionDataCache> = new Map()
  private saveTimers: Map<string, NodeJS.Timeout> = new Map()
  private fileLocks: Map<string, boolean> = new Map()

  constructor(config: Partial<StorageConfig> = {}) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config }
    this.ensureDirectories()
  }

  // ============================================================================
  // 目录初始化
  // ============================================================================

  private ensureDirectories(): void {
    const dirs = [
      this.config.basePath,
      this.config.sessionsPath,
      join(this.config.basePath, "backups"),
    ]

    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  private getSessionPath(sessionId: string): string {
    return join(this.config.sessionsPath, `${sessionId}.json`)
  }

  private getSessionBackupPath(sessionId: string, index: number): string {
    return join(this.config.basePath, "backups", `${sessionId}.${index}.bak`)
  }

  // ============================================================================
  // 文件锁机制
  // ============================================================================

  private async acquireLock(filePath: string): Promise<() => void> {
    const maxAttempts = 50
    const delay = 20 // ms

    for (let i = 0; i < maxAttempts; i++) {
      if (!this.fileLocks.get(filePath)) {
        this.fileLocks.set(filePath, true)
        return () => this.fileLocks.delete(filePath)
      }
      await new Promise((resolve) => setTimeout(resolve, delay))
    }

    throw new Error(`无法获取文件锁: ${filePath}`)
  }

  // ============================================================================
  // 备份机制
  // ============================================================================

  private createBackup(sessionId: string): void {
    if (!this.config.enableBackup) return

    const filePath = this.getSessionPath(sessionId)
    if (!existsSync(filePath)) return

    const backupCount = this.config.backupCount ?? 5

    // 轮转备份文件
    for (let i = backupCount - 1; i > 0; i--) {
      const oldPath = this.getSessionBackupPath(sessionId, i - 1)
      const newPath = this.getSessionBackupPath(sessionId, i)
      if (existsSync(oldPath)) {
        try {
          const content = readFileSync(oldPath)
          writeFileSync(newPath, content)
        } catch {
          // 忽略备份错误
        }
      }
    }

    // 创建最新备份
    try {
      const content = readFileSync(filePath)
      writeFileSync(this.getSessionBackupPath(sessionId, 0), content)
    } catch {
      // 忽略备份错误
    }
  }

  // ============================================================================
  // 全局记忆操作
  // ============================================================================

  async loadGlobalMemory(): Promise<GlobalMemory> {
    if (this.memoryCache) {
      return this.memoryCache
    }

    const release = await this.acquireLock(this.config.globalMemoryPath)
    try {
      if (existsSync(this.config.globalMemoryPath)) {
        const content = readFileSync(this.config.globalMemoryPath, "utf-8")
        this.memoryCache = JSON.parse(content) as GlobalMemory
      } else {
        this.memoryCache = this.createEmptyGlobalMemory()
        await this.saveGlobalMemoryInternal()
      }
      return this.memoryCache
    } finally {
      release()
    }
  }

  private createEmptyGlobalMemory(): GlobalMemory {
    return {
      version: "1.0",
      sessions: {},
      global: {
        userProfiles: {},
        aiAgents: {
          default: {
            model: "claude",
            temperature: 0.7,
          },
        },
      },
    }
  }

  async saveGlobalMemory(): Promise<void> {
    const release = await this.acquireLock(this.config.globalMemoryPath)
    try {
      await this.saveGlobalMemoryInternal()
    } finally {
      release()
    }
  }

  private async saveGlobalMemoryInternal(): Promise<void> {
    if (!this.memoryCache) return

    const dir = dirname(this.config.globalMemoryPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const tempPath = `${this.config.globalMemoryPath}.tmp`
    writeFileSync(tempPath, JSON.stringify(this.memoryCache, null, 2))

    // 原子写入
    const { renameSync } = await import("fs")
    renameSync(tempPath, this.config.globalMemoryPath)
  }

  // ============================================================================
  // 会话记忆操作
  // ============================================================================

  async getSessionMemory(sessionId: string): Promise<SessionMemory> {
    const memory = await this.loadGlobalMemory()
    if (!memory.sessions[sessionId]) {
      memory.sessions[sessionId] = this.createEmptySessionMemory()
      await this.saveGlobalMemory()
    }
    return memory.sessions[sessionId]
  }

  async updateSessionMemory(
    sessionId: string,
    updater: (memory: SessionMemory) => SessionMemory
  ): Promise<void> {
    const memory = await this.loadGlobalMemory()
    const current = memory.sessions[sessionId] ?? this.createEmptySessionMemory()
    memory.sessions[sessionId] = updater(current)
    await this.saveGlobalMemory()
  }

  private createEmptySessionMemory(): SessionMemory {
    return {
      userPreferences: {},
      aiContext: {
        recentTopics: [],
        decisions: [],
        actionItems: [],
        codeSnippets: [],
      },
      fileIndex: {
        recentFiles: [],
        frequentPatterns: [],
      },
      metadata: {
        messageCount: 0,
      },
    }
  }

  // ============================================================================
  // 会话数据操作
  // ============================================================================

  async loadSession(sessionId: string): Promise<SessionData | null> {
    // 检查缓存
    const cached = this.sessionCaches.get(sessionId)
    if (cached && Date.now() - cached.loadedAt < 5000) {
      return cached.data
    }

    const filePath = this.getSessionPath(sessionId)
    const release = await this.acquireLock(filePath)

    try {
      if (!existsSync(filePath)) {
        return null
      }

      const content = readFileSync(filePath, "utf-8")
      const data = JSON.parse(content) as SessionData

      this.sessionCaches.set(sessionId, {
        data,
        loadedAt: Date.now(),
        modified: false,
      })

      return data
    } finally {
      release()
    }
  }

  async saveSession(sessionId: string, data: SessionData, immediate = false): Promise<void> {
    this.createBackup(sessionId)

    const filePath = this.getSessionPath(sessionId)

    // 更新缓存
    this.sessionCaches.set(sessionId, {
      data,
      loadedAt: Date.now(),
      modified: true,
    })

    if (immediate) {
      await this.flushSession(sessionId)
    } else {
      // 延迟保存
      this.scheduleSave(sessionId)
    }
  }

  private scheduleSave(sessionId: string): void {
    const existingTimer = this.saveTimers.get(sessionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      this.flushSession(sessionId).catch(console.error)
      this.saveTimers.delete(sessionId)
    }, this.config.autoSaveInterval ?? 30000)

    this.saveTimers.set(sessionId, timer)
  }

  async flushSession(sessionId: string): Promise<void> {
    const cache = this.sessionCaches.get(sessionId)
    if (!cache || !cache.modified) return

    const filePath = this.getSessionPath(sessionId)
    const release = await this.acquireLock(filePath)

    try {
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      const tempPath = `${filePath}.tmp`
      writeFileSync(tempPath, JSON.stringify(cache.data, null, 2))

      const { renameSync } = await import("fs")
      renameSync(tempPath, filePath)

      cache.modified = false
      this.sessionCaches.set(sessionId, cache)
    } finally {
      release()
    }
  }

  async flushAll(): Promise<void> {
    const promises = Array.from(this.sessionCaches.keys()).map((id) =>
      this.flushSession(id)
    )
    await Promise.all(promises)
    await this.saveGlobalMemory()
  }

  // ============================================================================
  // 消息操作
  // ============================================================================

  async getMessages(sessionId: string, options?: MessageQueryOptions): Promise<ChatMessage[]> {
    const session = await this.loadSession(sessionId)
    if (!session) return []

    let messages = [...session.messages]

    // 排序（按时间升序）
    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    // 应用查询选项
    if (options?.limit) {
      const start = options.offset ?? 0
      messages = messages.slice(start, start + options.limit)
    }

    if (options?.before) {
      const beforeTime = new Date(options.before).getTime()
      messages = messages.filter((m) => new Date(m.timestamp).getTime() < beforeTime)
    }

    if (options?.after) {
      const afterTime = new Date(options.after).getTime()
      messages = messages.filter((m) => new Date(m.timestamp).getTime() > afterTime)
    }

    if (options?.senderId) {
      messages = messages.filter((m) => m.senderId === options.senderId)
    }

    return messages
  }

  async addMessage(sessionId: string, message: ChatMessage): Promise<void> {
    let session = await this.loadSession(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    session.messages.push(message)

    // 更新元数据
    session.metadata.lastMessageAt = message.timestamp
    session.metadata.messageCount = session.messages.length

    await this.saveSession(sessionId, session)

    // 更新全局记忆
    await this.updateSessionMemory(sessionId, (memory) => ({
      ...memory,
      metadata: {
        ...memory.metadata,
        messageCount: session.messages.length,
      },
    }))
  }

  async updateMessage(
    sessionId: string,
    messageId: string,
    updates: Partial<Omit<ChatMessage, "id" | "timestamp">>
  ): Promise<void> {
    const session = await this.loadSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const index = session.messages.findIndex((m) => m.id === messageId)
    if (index === -1) throw new Error(`Message not found: ${messageId}`)

    session.messages[index] = {
      ...session.messages[index],
      ...updates,
      editedAt: new Date().toISOString(),
    }

    await this.saveSession(sessionId, session)
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const session = await this.loadSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    session.messages = session.messages.filter((m) => m.id !== messageId)
    session.metadata.messageCount = session.messages.length

    await this.saveSession(sessionId, session)
  }

  // ============================================================================
  // 会话配置操作
  // ============================================================================

  async createSession(config: Omit<SessionConfig, "createdAt" | "updatedAt">): Promise<SessionConfig> {
    const now = new Date().toISOString()
    const sessionConfig: SessionConfig = {
      ...config,
      createdAt: now,
      updatedAt: now,
    }

    const sessionData: SessionData = {
      config: sessionConfig,
      messages: [],
      metadata: {
        messageCount: 0,
        participantCount: config.participants.length,
      },
    }

    await this.saveSession(config.id, sessionData, true)

    // 初始化会话记忆
    const memory = await this.loadGlobalMemory()
    memory.sessions[config.id] = this.createEmptySessionMemory()
    await this.saveGlobalMemory()

    return sessionConfig
  }

  async updateSessionConfig(
    sessionId: string,
    updates: Partial<SessionConfig>
  ): Promise<SessionConfig> {
    const session = await this.loadSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    session.config = {
      ...session.config,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    await this.saveSession(sessionId, session)
    return session.config
  }

  async deleteSession(sessionId: string): Promise<void> {
    const { unlinkSync } = await import("fs")

    const filePath = this.getSessionPath(sessionId)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }

    this.sessionCaches.delete(sessionId)

    // 清理全局记忆
    const memory = await this.loadGlobalMemory()
    delete memory.sessions[sessionId]
    await this.saveGlobalMemory()
  }

  async listSessions(): Promise<SessionConfig[]> {
    const { readdirSync } = await import("fs")

    if (!existsSync(this.config.sessionsPath)) {
      return []
    }

    const files = readdirSync(this.config.sessionsPath)
    const sessions: SessionConfig[] = []

    for (const file of files) {
      if (file.endsWith(".json")) {
        const sessionId = file.replace(".json", "")
        const session = await this.loadSession(sessionId)
        if (session) {
          sessions.push(session.config)
        }
      }
    }

    return sessions
  }

  // ============================================================================
  // 参与者操作
  // ============================================================================

  async addParticipant(sessionId: string, participant: Participant): Promise<void> {
    const session = await this.loadSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const existingIndex = session.config.participants.findIndex((p) => p.id === participant.id)
    if (existingIndex >= 0) {
      session.config.participants[existingIndex] = participant
    } else {
      session.config.participants.push(participant)
    }

    session.metadata.participantCount = session.config.participants.length

    await this.saveSession(sessionId, session)
  }

  async removeParticipant(sessionId: string, participantId: string): Promise<void> {
    const session = await this.loadSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    session.config.participants = session.config.participants.filter((p) => p.id !== participantId)
    session.metadata.participantCount = session.config.participants.length

    await this.saveSession(sessionId, session)
  }

  async updateParticipant(
    sessionId: string,
    participantId: string,
    updates: Partial<Participant>
  ): Promise<void> {
    const session = await this.loadSession(sessionId)
    if (!session) throw new Error(`Session not found: ${sessionId}`)

    const index = session.config.participants.findIndex((p) => p.id === participantId)
    if (index === -1) throw new Error(`Participant not found: ${participantId}`)

    session.config.participants[index] = {
      ...session.config.participants[index],
      ...updates,
      lastSeen: new Date().toISOString(),
    }

    await this.saveSession(sessionId, session)
  }

  // ============================================================================
  // 清理
  // ============================================================================

  dispose(): void {
    // 取消所有定时保存
    for (const timer of this.saveTimers.values()) {
      clearTimeout(timer)
    }
    this.saveTimers.clear()

    // 刷新所有缓存
    this.flushAll().catch(console.error)
  }
}

// =============================================================================
// 类型定义
// =============================================================================

interface SessionDataCache {
  data: SessionData
  loadedAt: number
  modified: boolean
}

export interface SessionData {
  config: SessionConfig
  messages: ChatMessage[]
  metadata: {
    messageCount: number
    participantCount: number
    lastMessageAt?: string
  }
}

export interface MessageQueryOptions {
  limit?: number
  offset?: number
  before?: string
  after?: string
  senderId?: string
}

// =============================================================================
// 单例导出
// =============================================================================

let defaultStorage: JSONStorageManager | null = null

export function getDefaultStorage(config?: Partial<StorageConfig>): JSONStorageManager {
  if (!defaultStorage) {
    defaultStorage = new JSONStorageManager(config)
  }
  return defaultStorage
}

export function resetDefaultStorage(): void {
  defaultStorage?.dispose()
  defaultStorage = null
}
