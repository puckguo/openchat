/**
 * Context Builder
 * 上下文组装器
 *
 * 组装聊天记录和记忆，构建 AI 上下文
 */

import type { ChatMessage, Participant, SessionMemory, UserPreferences } from "./types"

// =============================================================================
// 上下文配置
// =============================================================================

export interface ContextBuilderConfig {
  /** 最大上下文消息数量 */
  maxMessages: number
  /** 最大上下文字符数 */
  maxChars: number
  /** 是否包含系统提示 */
  includeSystemPrompt: boolean
  /** 是否包含用户偏好 */
  includeUserPreferences: boolean
  /** 是否包含会话记忆 */
  includeSessionMemory: boolean
  /** 是否包含文件索引 */
  includeFileIndex: boolean
  /** 消息摘要阈值（超过此数量时生成摘要） */
  summaryThreshold: number
}

export const DEFAULT_CONTEXT_CONFIG: ContextBuilderConfig = {
  maxMessages: 50,
  maxChars: 10000,
  includeSystemPrompt: true,
  includeUserPreferences: true,
  includeSessionMemory: true,
  includeFileIndex: true,
  summaryThreshold: 30,
}

// =============================================================================
// 上下文结构
// =============================================================================

export interface AIContext {
  /** 系统提示词 */
  systemPrompt: string
  /** 消息历史 */
  messages: Array<{
    role: "user" | "assistant" | "system"
    content: string
    name?: string
  }>
  /** 元数据 */
  metadata: {
    messageCount: number
    totalChars: number
    participants: string[]
  }
}

export interface ContextMessage {
  id: string
  role: "user" | "assistant" | "system"
  content: string
  senderName: string
  timestamp: string
}

// =============================================================================
// 系统提示词模板
// =============================================================================

const SYSTEM_PROMPT_TEMPLATE = `你是一个专业的 AI 编程助手，正在参与一个多人协作的聊天会话。

你的角色：
- 协助团队成员解决问题
- 提供代码建议和最佳实践
- 帮助审查和改进代码
- 回答技术和编程相关的问题

会话信息：
- 会话名称: {{sessionName}}
- 参与者: {{participants}}
- 当前时间: {{currentTime}}

{{userPreferences}}

{{sessionMemory}}

指南：
1. 保持友好、专业的语气
2. 提供具体、可操作的代码示例
3. 解释你的推理过程
4. 如果不确定，诚实地说明
5. 尊重团队决策和代码风格
`

// =============================================================================
// 上下文构建器
// =============================================================================

export class ContextBuilder {
  private config: ContextBuilderConfig

  constructor(config: Partial<ContextBuilderConfig> = {}) {
    this.config = { ...DEFAULT_CONTEXT_CONFIG, ...config }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<ContextBuilderConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 构建 AI 上下文
   */
  buildContext(
    messages: ChatMessage[],
    options: {
      sessionName: string
      participants: Participant[]
      memory?: SessionMemory
      currentUserId: string
      userPreferences?: UserPreferences
    }
  ): AIContext {
    const { sessionName, participants, memory, currentUserId, userPreferences } = options

    // 准备系统提示
    const systemPrompt = this.buildSystemPrompt(
      sessionName,
      participants,
      memory,
      userPreferences
    )

    // 转换消息
    const contextMessages = this.convertMessages(messages, currentUserId)

    // 截断上下文
    const truncatedMessages = this.truncateMessages(contextMessages)

    // 组装最终上下文
    const aiMessages: AIContext["messages"] = []

    for (const msg of truncatedMessages) {
      aiMessages.push({
        role: msg.role,
        content: msg.content,
        name: msg.senderName,
      })
    }

    const totalChars = aiMessages.reduce((sum, m) => sum + m.content.length, 0)

    return {
      systemPrompt,
      messages: aiMessages,
      metadata: {
        messageCount: aiMessages.length,
        totalChars,
        participants: participants.map((p) => p.name),
      },
    }
  }

  /**
   * 为特定提示构建上下文
   */
  buildContextForPrompt(
    prompt: string,
    messages: ChatMessage[],
    options: {
      sessionName: string
      participants: Participant[]
      memory?: SessionMemory
      currentUserId: string
      userPreferences?: UserPreferences
    }
  ): AIContext {
    const baseContext = this.buildContext(messages, options)

    // 添加当前提示作为最后一条消息
    baseContext.messages.push({
      role: "user",
      content: prompt,
      name: options.participants.find((p) => p.id === options.currentUserId)?.name || "User",
    })

    return baseContext
  }

  /**
   * 构建精简上下文（用于快速响应）
   */
  buildCompactContext(
    messages: ChatMessage[],
    options: {
      participants: Participant[]
      currentUserId: string
    }
  ): AIContext {
    const { participants, currentUserId } = options

    // 只保留最近的消息
    const recentMessages = messages.slice(-10)
    const contextMessages = this.convertMessages(recentMessages, currentUserId)

    const systemPrompt = `你是 OpenCode AI 助手，正在协助一个开发团队。请简洁地回答。`

    return {
      systemPrompt,
      messages: contextMessages.map((m) => ({
        role: m.role,
        content: m.content,
        name: m.senderName,
      })),
      metadata: {
        messageCount: contextMessages.length,
        totalChars: contextMessages.reduce((sum, m) => sum + m.content.length, 0),
        participants: participants.map((p) => p.name),
      },
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  private buildSystemPrompt(
    sessionName: string,
    participants: Participant[],
    memory?: SessionMemory,
    userPreferences?: UserPreferences
  ): string {
    let prompt = SYSTEM_PROMPT_TEMPLATE

    // 填充基本信息
    prompt = prompt.replace("{{sessionName}}", sessionName)
    prompt = prompt.replace(
      "{{participants}}",
      participants.filter((p) => p.role !== "ai").map((p) => p.name).join(", ")
    )
    prompt = prompt.replace("{{currentTime}}", new Date().toISOString())

    // 填充用户偏好
    if (this.config.includeUserPreferences && userPreferences) {
      const prefsText = this.formatUserPreferences(userPreferences)
      prompt = prompt.replace("{{userPreferences}}", prefsText)
    } else {
      prompt = prompt.replace("{{userPreferences}}", "")
    }

    // 填充会话记忆
    if (this.config.includeSessionMemory && memory) {
      const memoryText = this.formatSessionMemory(memory)
      prompt = prompt.replace("{{sessionMemory}}", memoryText)
    } else {
      prompt = prompt.replace("{{sessionMemory}}", "")
    }

    return prompt.trim()
  }

  private formatUserPreferences(prefs: UserPreferences): string {
    const lines = ["用户偏好:"]

    if (prefs.language) {
      lines.push(`- 语言: ${prefs.language}`)
    }
    if (prefs.codingStyle) {
      lines.push(`- 代码风格: ${prefs.codingStyle}`)
    }
    if (prefs.preferredLanguages?.length) {
      lines.push(`- 常用语言: ${prefs.preferredLanguages.join(", ")}`)
    }

    return lines.length > 1 ? lines.join("\n") : ""
  }

  private formatSessionMemory(memory: SessionMemory): string {
    const sections: string[] = []

    // 最近主题
    if (memory.aiContext.recentTopics.length > 0) {
      sections.push(`最近讨论的主题: ${memory.aiContext.recentTopics.join(", ")}`)
    }

    // 决策
    if (memory.aiContext.decisions.length > 0) {
      sections.push(`已做出的决策:\n${memory.aiContext.decisions.map((d) => `- ${d}`).join("\n")}`)
    }

    // 待办事项
    if (memory.aiContext.actionItems.length > 0) {
      sections.push(`待办事项:\n${memory.aiContext.actionItems.map((i) => `- ${i}`).join("\n")}`)
    }

    // 代码片段
    if (memory.aiContext.codeSnippets.length > 0) {
      const recentSnippets = memory.aiContext.codeSnippets.slice(-3)
      sections.push(
        `相关代码片段:\n${recentSnippets
          .map((s) => `### ${s.description}\n\`\`\`${s.language}\n${s.code}\n\`\`\``)
          .join("\n\n")}`
      )
    }

    return sections.length > 0 ? `会话记忆:\n${sections.join("\n\n")}` : ""
  }

  private convertMessages(
    messages: ChatMessage[],
    currentUserId: string
  ): ContextMessage[] {
    return messages.map((msg) => this.convertMessage(msg, currentUserId))
  }

  private convertMessage(message: ChatMessage, currentUserId: string): ContextMessage {
    let role: ContextMessage["role"]
    let content = message.content

    // 确定角色
    if (message.senderRole === "ai") {
      role = "assistant"
    } else if (message.type === "system") {
      role = "system"
    } else {
      role = "user"
    }

    // 处理特殊消息类型
    switch (message.type) {
      case "voice":
        if (message.voiceData?.transcript) {
          content = `[语音] ${message.voiceData.transcript}`
        } else {
          content = "[语音消息]"
        }
        break

      case "image":
        content = `[图片] ${content || "图片分享"}`
        break

      case "file":
        content = `[文件: ${message.fileData?.filename || "附件"}] ${content}`
        break

      case "code":
        if (message.codeData) {
          content = `\`\`\`${message.codeData.language}\n${message.codeData.code}\n\`\`\`\n${content}`
        }
        break
    }

    return {
      id: message.id,
      role,
      content,
      senderName: message.senderName,
      timestamp: message.timestamp,
    }
  }

  private truncateMessages(messages: ContextMessage[]): ContextMessage[] {
    // 首先按数量截断
    let result = messages
    if (result.length > this.config.maxMessages) {
      result = result.slice(-this.config.maxMessages)
    }

    // 然后按字符数截断
    let totalChars = result.reduce((sum, m) => sum + m.content.length, 0)
    while (totalChars > this.config.maxChars && result.length > 1) {
      const removed = result.shift()
      if (removed) {
        totalChars -= removed.content.length
      }
    }

    return result
  }
}

// =============================================================================
// 上下文管理器
// =============================================================================

export class ContextManager {
  private builder: ContextBuilder
  private contextCache: Map<
    string,
    { context: AIContext; timestamp: number }
  > = new Map()
  private cacheTTL: number = 5 * 60 * 1000 // 5分钟

  constructor(builder?: ContextBuilder) {
    this.builder = builder ?? new ContextBuilder()
  }

  /**
   * 获取缓存的上下文或构建新的
   */
  getOrBuildContext(
    cacheKey: string,
    messages: ChatMessage[],
    options: Parameters<ContextBuilder["buildContext"]>[1]
  ): AIContext {
    const cached = this.contextCache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.context
    }

    const context = this.builder.buildContext(messages, options)
    this.contextCache.set(cacheKey, { context, timestamp: Date.now() })
    return context
  }

  /**
   * 使缓存失效
   */
  invalidateCache(cacheKey?: string): void {
    if (cacheKey) {
      this.contextCache.delete(cacheKey)
    } else {
      this.contextCache.clear()
    }
  }

  /**
   * 清理过期缓存
   */
  cleanCache(): void {
    const cutoff = Date.now() - this.cacheTTL
    for (const [key, value] of this.contextCache) {
      if (value.timestamp < cutoff) {
        this.contextCache.delete(key)
      }
    }
  }
}

// =============================================================================
// 工具函数
// =============================================================================

/**
 * 创建上下文构建器
 */
export function createContextBuilder(
  config?: Partial<ContextBuilderConfig>
): ContextBuilder {
  return new ContextBuilder(config)
}

/**
 * 创建上下文管理器
 */
export function createContextManager(builder?: ContextBuilder): ContextManager {
  return new ContextManager(builder)
}

/**
 * 格式化消息历史为字符串
 */
export function formatMessageHistory(messages: ChatMessage[]): string {
  return messages
    .map(
      (m) =>
        `[${new Date(m.timestamp).toLocaleTimeString()}] ${m.senderName}: ${m.content}`
    )
    .join("\n")
}

/**
 * 生成消息摘要
 */
export function generateSummary(messages: ChatMessage[], maxLength: number = 200): string {
  const recentMessages = messages.slice(-5)
  const combined = recentMessages.map((m) => m.content).join(" ")

  if (combined.length <= maxLength) {
    return combined
  }

  return combined.slice(0, maxLength) + "..."
}

/**
 * 估算 token 数量（简单启发式）
 */
export function estimateTokenCount(text: string): number {
  // 粗略估算：英文 1 token ≈ 4 字符，中文 1 token ≈ 1 字符
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const otherChars = text.length - chineseChars

  return Math.ceil(chineseChars + otherChars / 4)
}

/**
 * 检查上下文是否超出限制
 */
export function isContextOverLimit(
  messages: ChatMessage[],
  maxTokens: number = 4000
): boolean {
  const totalText = messages.map((m) => m.content).join("\n")
  const estimatedTokens = estimateTokenCount(totalText)
  return estimatedTokens > maxTokens
}
