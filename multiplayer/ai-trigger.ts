/**
 * AI Trigger Controller
 * AI 触发控制器
 *
 * 管理 AI 的触发逻辑，支持多种触发模式
 */

import type { ChatMessage } from "./types"
import { hasAIMention } from "./mention"

// =============================================================================
// 触发模式
// =============================================================================

export type AITriggerMode = "mention" | "auto" | "manual"

export interface AITriggerConfig {
  /** 触发模式 */
  mode: AITriggerMode
  /** 是否启用 */
  enabled: boolean
  /** 触发冷却时间（毫秒） */
  cooldown: number
  /** 自动触发关键词 */
  autoTriggerKeywords: string[]
  /** 自动触发间隔（消息数） */
  autoTriggerInterval: number
  /** 最大上下文长度 */
  maxContextLength: number
  /** 入侵检测阈值（每分钟最大触发次数） */
  rateLimitPerMinute: number
}

export const DEFAULT_TRIGGER_CONFIG: AITriggerConfig = {
  mode: "mention",
  enabled: true,
  cooldown: 5000, // 5秒
  autoTriggerKeywords: ["帮忙", "帮助", "help", "?", "？"],
  autoTriggerInterval: 10, // 每10条消息
  maxContextLength: 50, // 50条消息
  rateLimitPerMinute: 10, // 每分钟最多10次
}

// =============================================================================
// 触发结果
// =============================================================================

export interface AITriggerResult {
  /** 是否应该触发 */
  shouldTrigger: boolean
  /** 触发原因 */
  reason?: string
  /** 触发上下文 */
  context?: ChatMessage[]
  /** 触发类型 */
  triggerType?: "mention" | "auto_keyword" | "auto_interval" | "manual"
  /** 错误信息 */
  error?: string
}

// =============================================================================
// 触发控制器
// =============================================================================

export class AITriggerController {
  private config: AITriggerConfig
  private lastTriggerTime: number = 0
  private triggerCount: number = 0
  private messageCount: number = 0
  private rateLimitWindow: number = 60 * 1000 // 1分钟
  private triggerHistory: number[] = [] // 记录触发时间戳

  constructor(config: Partial<AITriggerConfig> = {}) {
    this.config = { ...DEFAULT_TRIGGER_CONFIG, ...config }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<AITriggerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取当前配置
   */
  getConfig(): AITriggerConfig {
    return { ...this.config }
  }

  /**
   * 检查是否应该触发 AI
   */
  shouldTrigger(
    message: ChatMessage,
    context: ChatMessage[] = []
  ): AITriggerResult {
    // 检查是否启用
    if (!this.config.enabled) {
      return { shouldTrigger: false, error: "AI is disabled" }
    }

    // 检查是否来自 AI 的消息（避免循环）
    if (message.senderRole === "ai") {
      return { shouldTrigger: false, error: "Message is from AI" }
    }

    // 清理旧的触发记录
    this.cleanTriggerHistory()

    // 检查速率限制
    if (this.isRateLimited()) {
      return {
        shouldTrigger: false,
        error: `Rate limit exceeded: ${this.config.rateLimitPerMinute} triggers per minute`,
      }
    }

    // 检查冷却时间
    if (this.isInCooldown()) {
      return {
        shouldTrigger: false,
        error: "AI is in cooldown",
      }
    }

    // 根据模式检查触发条件
    switch (this.config.mode) {
      case "mention":
        return this.checkMentionTrigger(message, context)
      case "auto":
        return this.checkAutoTrigger(message, context)
      case "manual":
        return { shouldTrigger: false, error: "Manual mode requires explicit trigger" }
      default:
        return { shouldTrigger: false, error: "Unknown trigger mode" }
    }
  }

  /**
   * 手动触发 AI
   */
  manualTrigger(context: ChatMessage[]): AITriggerResult {
    if (!this.config.enabled) {
      return { shouldTrigger: false, error: "AI is disabled" }
    }

    if (this.isRateLimited()) {
      return {
        shouldTrigger: false,
        error: `Rate limit exceeded: ${this.config.rateLimitPerMinute} triggers per minute`,
      }
    }

    return {
      shouldTrigger: true,
      triggerType: "manual",
      reason: "Manual trigger",
      context: this.prepareContext(context),
    }
  }

  /**
   * 记录一次触发
   */
  recordTrigger(): void {
    this.lastTriggerTime = Date.now()
    this.triggerCount++
    this.triggerHistory.push(Date.now())
  }

  /**
   * 重置计数器
   */
  reset(): void {
    this.lastTriggerTime = 0
    this.triggerCount = 0
    this.messageCount = 0
    this.triggerHistory = []
  }

  /**
   * 获取触发统计
   */
  getStats(): {
    totalTriggers: number
    triggersInLastMinute: number
    isInCooldown: boolean
    isRateLimited: boolean
  } {
    this.cleanTriggerHistory()
    return {
      totalTriggers: this.triggerCount,
      triggersInLastMinute: this.triggerHistory.length,
      isInCooldown: this.isInCooldown(),
      isRateLimited: this.isRateLimited(),
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  private checkMentionTrigger(
    message: ChatMessage,
    context: ChatMessage[]
  ): AITriggerResult {
    if (message.mentionsAI || hasAIMention(message.content)) {
      return {
        shouldTrigger: true,
        triggerType: "mention",
        reason: "AI was mentioned",
        context: this.prepareContext([...context, message]),
      }
    }

    return { shouldTrigger: false, error: "AI not mentioned" }
  }

  private checkAutoTrigger(
    message: ChatMessage,
    context: ChatMessage[]
  ): AITriggerResult {
    // 检查 @提及
    if (message.mentionsAI || hasAIMention(message.content)) {
      return {
        shouldTrigger: true,
        triggerType: "mention",
        reason: "AI was mentioned",
        context: this.prepareContext([...context, message]),
      }
    }

    // 检查关键词
    const content = message.content.toLowerCase()
    for (const keyword of this.config.autoTriggerKeywords) {
      if (content.includes(keyword.toLowerCase())) {
        return {
          shouldTrigger: true,
          triggerType: "auto_keyword",
          reason: `Keyword "${keyword}" matched`,
          context: this.prepareContext([...context, message]),
        }
      }
    }

    // 检查间隔
    this.messageCount++
    if (this.messageCount >= this.config.autoTriggerInterval) {
      this.messageCount = 0
      return {
        shouldTrigger: true,
        triggerType: "auto_interval",
        reason: `Auto-triggered after ${this.config.autoTriggerInterval} messages`,
        context: this.prepareContext([...context, message]),
      }
    }

    return { shouldTrigger: false, error: "No auto-trigger condition met" }
  }

  private isInCooldown(): boolean {
    if (this.lastTriggerTime === 0) return false
    const elapsed = Date.now() - this.lastTriggerTime
    return elapsed < this.config.cooldown
  }

  private isRateLimited(): boolean {
    this.cleanTriggerHistory()
    return this.triggerHistory.length >= this.config.rateLimitPerMinute
  }

  private cleanTriggerHistory(): void {
    const cutoff = Date.now() - this.rateLimitWindow
    this.triggerHistory = this.triggerHistory.filter((t) => t > cutoff)
  }

  private prepareContext(context: ChatMessage[]): ChatMessage[] {
    // 限制上下文长度
    if (context.length > this.config.maxContextLength) {
      return context.slice(-this.config.maxContextLength)
    }
    return context
  }
}

// =============================================================================
// 触发管理器（管理多个会话）
// =============================================================================

export class AITriggerManager {
  private controllers: Map<string, AITriggerController> = new Map()
  private defaultConfig: Partial<AITriggerConfig> = {}

  /**
   * 设置默认配置
   */
  setDefaultConfig(config: Partial<AITriggerConfig>): void {
    this.defaultConfig = config
  }

  /**
   * 获取或创建控制器
   */
  getController(sessionId: string): AITriggerController {
    if (!this.controllers.has(sessionId)) {
      this.controllers.set(
        sessionId,
        new AITriggerController(this.defaultConfig)
      )
    }
    return this.controllers.get(sessionId)!
  }

  /**
   * 配置指定会话的控制器
   */
  configureSession(
    sessionId: string,
    config: Partial<AITriggerConfig>
  ): AITriggerController {
    const controller = this.getController(sessionId)
    controller.updateConfig(config)
    return controller
  }

  /**
   * 移除会话控制器
   */
  removeSession(sessionId: string): void {
    this.controllers.delete(sessionId)
  }

  /**
   * 检查是否应该触发
   */
  shouldTrigger(
    sessionId: string,
    message: ChatMessage,
    context: ChatMessage[] = []
  ): AITriggerResult {
    const controller = this.getController(sessionId)
    return controller.shouldTrigger(message, context)
  }

  /**
   * 记录触发
   */
  recordTrigger(sessionId: string): void {
    const controller = this.getController(sessionId)
    controller.recordTrigger()
  }

  /**
   * 获取所有会话的统计
   */
  getAllStats(): Map<string, ReturnType<AITriggerController["getStats"]>> {
    const stats = new Map<string, ReturnType<AITriggerController["getStats"]>>()
    for (const [sessionId, controller] of this.controllers) {
      stats.set(sessionId, controller.getStats())
    }
    return stats
  }
}

// =============================================================================
// 工具函数
// =============================================================================

/**
 * 创建触发控制器
 */
export function createAITriggerController(
  config?: Partial<AITriggerConfig>
): AITriggerController {
  return new AITriggerController(config)
}

/**
 * 创建触发管理器
 */
export function createAITriggerManager(
  defaultConfig?: Partial<AITriggerConfig>
): AITriggerManager {
  const manager = new AITriggerManager()
  if (defaultConfig) {
    manager.setDefaultConfig(defaultConfig)
  }
  return manager
}

/**
 * 检查消息是否应触发 AI（简单版本）
 */
export function shouldTriggerAI(
  message: ChatMessage,
  mode: AITriggerMode = "mention"
): boolean {
  if (mode === "mention") {
    return message.mentionsAI || hasAIMention(message.content)
  }
  return false
}
