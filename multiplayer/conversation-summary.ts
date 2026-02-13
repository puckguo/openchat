/**
 * Conversation Summary Manager
 * 对话总结管理器
 *
 * 管理聊天记录的总结，优化AI上下文
 */

import type { ChatMessage } from "./types"
import type { DatabaseManager } from "./database"
import type { AIService } from "./ai-service"

// =============================================================================
// Summary Types
// =============================================================================

export interface ConversationSummary {
  id: string
  sessionId: string
  summary: string
  messageCount: number
  lastMessageId: string
  lastMessageTimestamp: string
  createdAt: string
  updatedAt: string
}

export interface SummaryContext {
  summary: string
  messagesAfterSummary: ChatMessage[]
  totalTokens: number
}

// =============================================================================
// Summary Manager
// =============================================================================

export class ConversationSummaryManager {
  private db: DatabaseManager | null
  private aiService: AIService | null
  private summaries: Map<string, ConversationSummary> = new Map()

  constructor(db?: DatabaseManager, aiService?: AIService) {
    this.db = db || null
    this.aiService = aiService || null
  }

  /**
   * 初始化总结表
   */
  async initializeTable(): Promise<void> {
    if (!this.db) return

    const client = (this.db as any).client
    if (!client) return

    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_summaries (
        id VARCHAR(255) PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        summary TEXT NOT NULL,
        message_count INTEGER DEFAULT 0,
        last_message_id VARCHAR(255),
        last_message_timestamp TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // 创建索引
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_summaries_session_id ON conversation_summaries(session_id)
    `)

    console.log("[Summary] Table initialized")
  }

  /**
   * 生成对话总结
   */
  async generateSummary(
    sessionId: string,
    messages: ChatMessage[],
    previousSummary?: string
  ): Promise<ConversationSummary | null> {
    if (!this.aiService) {
      console.error("[Summary] AI service not available")
      return null
    }

    if (messages.length === 0) {
      console.log("[Summary] No messages to summarize")
      return null
    }

    try {
      console.log(`[Summary] Generating summary for ${messages.length} messages`)

      // 构建总结提示
      const prompt = this.buildSummaryPrompt(messages, previousSummary)

      // 调用AI生成总结
      const summaryText = await this.aiService.generateResponse(
        [{
          id: 'system',
          sessionId,
          senderId: 'system',
          senderName: 'System',
          senderRole: 'system',
          type: 'text',
          content: prompt,
          mentions: [],
          mentionsAI: false,
          timestamp: new Date().toISOString()
        }],
        "你是一个专业的对话总结助手。请用简洁的语言总结对话内容，保留关键信息和决策。"
      )

      const lastMessage = messages[messages.length - 1]
      const summary: ConversationSummary = {
        id: `summary-${Date.now()}`,
        sessionId,
        summary: summaryText,
        messageCount: messages.length,
        lastMessageId: lastMessage.id,
        lastMessageTimestamp: lastMessage.timestamp,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      // 保存到数据库
      await this.saveSummary(summary)

      // 保存到内存
      this.summaries.set(sessionId, summary)

      console.log(`[Summary] Generated summary for session ${sessionId}`)
      return summary

    } catch (error) {
      console.error("[Summary] Error generating summary:", error)
      return null
    }
  }

  /**
   * 构建总结提示
   */
  private buildSummaryPrompt(messages: ChatMessage[], previousSummary?: string): string {
    let prompt = ""

    if (previousSummary) {
      prompt += `之前的对话总结：\n${previousSummary}\n\n`
      prompt += `新增的聊天记录：\n`
    } else {
      prompt += `请总结以下对话内容：\n`
    }

    // 添加消息
    messages.forEach(msg => {
      const sender = msg.senderName || msg.senderId
      prompt += `${sender}: ${msg.content}\n`
    })

    prompt += `\n请生成一个简洁的总结，包含：\n`
    prompt += `1. 主要讨论的话题\n`
    prompt += `2. 重要决策或结论\n`
    prompt += `3. 待办事项（如果有）\n`
    prompt += `4. 关键文件或资源\n`

    return prompt
  }

  /**
   * 保存总结到数据库
   */
  async saveSummary(summary: ConversationSummary): Promise<void> {
    if (!this.db) return

    const client = (this.db as any).client
    if (!client) return

    await client.query(
      `INSERT INTO conversation_summaries (
        id, session_id, summary, message_count, last_message_id,
        last_message_timestamp, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (session_id) DO UPDATE SET
        summary = EXCLUDED.summary,
        message_count = EXCLUDED.message_count,
        last_message_id = EXCLUDED.last_message_id,
        last_message_timestamp = EXCLUDED.last_message_timestamp,
        updated_at = CURRENT_TIMESTAMP`,
      [
        summary.id,
        summary.sessionId,
        summary.summary,
        summary.messageCount,
        summary.lastMessageId,
        summary.lastMessageTimestamp,
        summary.createdAt,
        summary.updatedAt,
      ]
    )
  }

  /**
   * 获取会话的总结
   */
  async getSummary(sessionId: string): Promise<ConversationSummary | null> {
    // 先检查内存
    if (this.summaries.has(sessionId)) {
      return this.summaries.get(sessionId)!
    }

    // 从数据库查询
    if (!this.db) return null

    const client = (this.db as any).client
    if (!client) return null

    const result = await client.query(
      `SELECT * FROM conversation_summaries WHERE session_id = $1`,
      [sessionId]
    )

    if (result.rows.length > 0) {
      const summary = this.rowToSummary(result.rows[0])
      this.summaries.set(sessionId, summary)
      return summary
    }

    return null
  }

  /**
   * 获取AI上下文（总结 + 最新消息）
   */
  async getAIContext(
    sessionId: string,
    allMessages: ChatMessage[],
    maxRecentMessages: number = 10
  ): Promise<SummaryContext> {
    const summary = await this.getSummary(sessionId)

    if (!summary) {
      // 没有总结，返回所有消息
      return {
        summary: "",
        messagesAfterSummary: allMessages.slice(-maxRecentMessages),
        totalTokens: this.estimateTokens(allMessages),
      }
    }

    // 找到总结之后的消息
    const lastSummaryIndex = allMessages.findIndex(
      m => m.id === summary.lastMessageId
    )

    let messagesAfterSummary: ChatMessage[]
    if (lastSummaryIndex >= 0) {
      messagesAfterSummary = allMessages.slice(lastSummaryIndex + 1)
    } else {
      // 找不到总结位置，使用最近的消息
      messagesAfterSummary = allMessages.slice(-maxRecentMessages)
    }

    // 限制最新消息数量
    if (messagesAfterSummary.length > maxRecentMessages) {
      messagesAfterSummary = messagesAfterSummary.slice(-maxRecentMessages)
    }

    return {
      summary: summary.summary,
      messagesAfterSummary,
      totalTokens: this.estimateTokens(allMessages),
    }
  }

  /**
   * 清空总结（重置AI记忆）
   */
  async clearSummary(sessionId: string): Promise<void> {
    // 从内存移除
    this.summaries.delete(sessionId)

    // 从数据库删除
    if (!this.db) return

    const client = (this.db as any).client
    if (!client) return

    await client.query(
      `DELETE FROM conversation_summaries WHERE session_id = $1`,
      [sessionId]
    )

    console.log(`[Summary] Cleared summary for session ${sessionId}`)
  }

  /**
   * 检查是否需要生成新总结
   */
  async shouldGenerateSummary(
    sessionId: string,
    currentMessageCount: number
  ): Promise<boolean> {
    const summary = await this.getSummary(sessionId)

    if (!summary) {
      // 没有总结，超过20条消息就生成
      return currentMessageCount >= 20
    }

    // 距离上次总结超过20条新消息
    const newMessages = currentMessageCount - summary.messageCount
    return newMessages >= 20
  }

  /**
   * 估算Token数量（简单估算）
   */
  private estimateTokens(messages: ChatMessage[]): number {
    let totalChars = 0
    messages.forEach(m => {
      totalChars += m.content.length
      totalChars += m.senderName?.length || 0
    })
    // 粗略估算：1 token ≈ 4 字符
    return Math.ceil(totalChars / 4)
  }

  /**
   * 数据库行转对象
   */
  private rowToSummary(row: any): ConversationSummary {
    return {
      id: row.id,
      sessionId: row.session_id,
      summary: row.summary,
      messageCount: row.message_count,
      lastMessageId: row.last_message_id,
      lastMessageTimestamp: row.last_message_timestamp,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

// =============================================================================
// 工具函数
// =============================================================================

export function createSummaryManager(
  db?: DatabaseManager,
  aiService?: AIService
): ConversationSummaryManager {
  return new ConversationSummaryManager(db, aiService)
}
