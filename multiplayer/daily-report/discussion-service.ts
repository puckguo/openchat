/**
 * Discussion Service
 * 讨论服务
 *
 * 管理用户与AI的讨论会话，支持观点记录
 */

import type { DiscussionMessage, DiscussionSession, UserOpinion } from "./types"
import { DISCUSSION_SYSTEM_PROMPT } from "./config"
import { OpinionStorage } from "./opinion-storage"
import { ReportGenerator } from "./report-generator"
import { AIService } from "../ai-service"

export interface DiscussionServiceOptions {
  aiService: AIService
  opinionStorage: OpinionStorage
  reportGenerator: ReportGenerator
  userId: string
}

export class DiscussionService {
  private aiService: AIService
  private opinionStorage: OpinionStorage
  private reportGenerator: ReportGenerator
  private userId: string
  private sessions: Map<string, DiscussionSession> = new Map()

  constructor(options: DiscussionServiceOptions) {
    this.aiService = options.aiService
    this.opinionStorage = options.opinionStorage
    this.reportGenerator = options.reportGenerator
    this.userId = options.userId
  }

  /**
   * 创建新的讨论会话
   */
  async createSession(date: string): Promise<DiscussionSession> {
    console.log(`[DiscussionService] Creating session for ${date}`)

    // 读取当天的日报
    const report = this.reportGenerator.readReport(date)
    if (!report) {
      throw new Error(`Report not found for date: ${date}`)
    }

    // 创建会话
    const session: DiscussionSession = {
      id: this.generateSessionId(),
      date,
      messages: [],
      topics: [],
      startedAt: new Date().toISOString(),
      lastMessageAt: new Date().toISOString(),
    }

    // 生成开场白
    const openingMessage = await this.generateOpeningMessage(report, date)

    session.messages.push({
      id: this.generateMessageId(),
      role: "assistant",
      content: openingMessage,
      timestamp: new Date().toISOString(),
    })

    this.sessions.set(session.id, session)

    console.log(`[DiscussionService] Session created: ${session.id}`)

    return session
  }

  /**
   * 获取或创建会话
   */
  async getOrCreateSession(date: string, sessionId?: string): Promise<DiscussionSession> {
    if (sessionId && this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!
    }
    return this.createSession(date)
  }

  /**
   * 发送消息并获取回复
   */
  async sendMessage(
    sessionId: string,
    content: string
  ): Promise<{ message: DiscussionMessage; session: DiscussionSession }> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // 添加用户消息
    const userMessage: DiscussionMessage = {
      id: this.generateMessageId(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    }

    session.messages.push(userMessage)
    session.lastMessageAt = new Date().toISOString()

    // 生成AI回复
    const aiResponse = await this.generateResponse(session)

    const assistantMessage: DiscussionMessage = {
      id: this.generateMessageId(),
      role: "assistant",
      content: aiResponse,
      timestamp: new Date().toISOString(),
    }

    session.messages.push(assistantMessage)
    session.lastMessageAt = new Date().toISOString()

    // 尝试提取观点
    await this.extractAndSaveOpinions(session)

    return { message: assistantMessage, session }
  }

  /**
   * 生成流式回复
   */
  async *generateStreamResponse(
    sessionId: string,
    content: string
  ): AsyncGenerator<string, DiscussionSession, unknown> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // 添加用户消息
    const userMessage: DiscussionMessage = {
      id: this.generateMessageId(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    }

    session.messages.push(userMessage)
    session.lastMessageAt = new Date().toISOString()

    // 构建AI消息
    const messages = await this.buildAIMessages(session)
    const systemPrompt = await this.buildSystemPrompt(session)

    // 流式生成
    let fullResponse = ""

    try {
      const stream = this.aiService.generateStreamResponse(
        messages.map(m => ({
          id: m.id,
          content: m.content,
          senderId: m.role,
          senderName: m.role === "assistant" ? "AI" : "User",
          senderRole: m.role,
          timestamp: new Date(m.timestamp).getTime(),
          type: "text" as const,
        })),
        systemPrompt
      )

      for await (const chunk of stream) {
        fullResponse += chunk
        yield chunk
      }
    } catch (error) {
      console.error(`[DiscussionService] Stream error:`, error)
      throw error
    }

    // 添加AI消息
    const assistantMessage: DiscussionMessage = {
      id: this.generateMessageId(),
      role: "assistant",
      content: fullResponse,
      timestamp: new Date().toISOString(),
    }

    session.messages.push(assistantMessage)
    session.lastMessageAt = new Date().toISOString()

    // 提取观点
    await this.extractAndSaveOpinions(session)

    return session
  }

  /**
   * 获取会话历史
   */
  getSession(sessionId: string): DiscussionSession | null {
    return this.sessions.get(sessionId) || null
  }

  /**
   * 结束会话并总结
   */
  async endSession(sessionId: string): Promise<{ session: DiscussionSession; summary: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // 生成会话总结
    const summary = await this.generateSessionSummary(session)

    // 清理会话
    this.sessions.delete(sessionId)

    return { session, summary }
  }

  /**
   * 生成开场白
   */
  private async generateOpeningMessage(report: import("./types").DailyReport, date: string): Promise<string> {
    const opinionContext = this.opinionStorage.getOpinionContext()
    const reportSummary = this.reportGenerator.generateBriefSummary(report)

    // 构建具体的新闻详情，让AI能引用具体内容
    let newsDetails = ""
    for (const section of report.sections) {
      newsDetails += `\n【${section.categoryName}】\n`
      section.news.slice(0, 3).forEach((item, idx) => {
        newsDetails += `${idx + 1}. ${item.title}（${item.source}）\n`
        if (item.summary) {
          newsDetails += `   摘要：${item.summary.substring(0, 100)}...\n`
        }
      })
    }

    const prompt = `今天是 ${date}。我已为你生成了今日新闻日报。

${opinionContext}

今日日报概要：
${reportSummary}

具体新闻内容：
${newsDetails}

请用友好的语气向用户问候，并引导讨论。

要求：
1. **具体性**：挑选1-2条具体的新闻（引用具体标题或事件），不要泛泛而谈"科技新闻"
2. **针对性**：基于用户历史观点，找出可能感兴趣的具体话题
3. **明确问题**：提出一个具体的问题，例如"你对XX公司推出的XX功能怎么看？"而不是"你对科技新闻有什么看法？"
4. **引用细节**：提及新闻中的具体细节（公司名、产品名、数据等）
5. **控制字数**：150字以内，简洁有力

示例（好）："今天看到XX公司发布了新款AI芯片，性能提升了40%。你之前关注过AI硬件的发展，你觉得这次升级会对行业带来什么影响？"
示例（差）："今天有很多科技新闻，你对哪个感兴趣？"`

    const messages = [{
      id: "1",
      content: prompt,
      senderId: "system",
      senderName: "System",
      senderRole: "user" as const,
      timestamp: Date.now(),
      type: "text" as const,
    }]

    try {
      const response = await this.aiService.generateResponse(messages)
      return response
    } catch (error) {
      console.error(`[DiscussionService] Failed to generate opening:`, error)
      return `你好！今日日报已生成，涵盖了${report.sections.length}个领域的最新资讯。有什么话题想聊聊吗？`
    }
  }

  /**
   * 构建系统提示词
   */
  private async buildSystemPrompt(session: DiscussionSession): Promise<string> {
    const report = this.reportGenerator.readReport(session.date)
    const opinionContext = this.opinionStorage.getOpinionContext()
    const reportSummary = report ? this.reportGenerator.generateBriefSummary(report) : "日报暂无"

    return DISCUSSION_SYSTEM_PROMPT
      .replace("{date}", session.date)
      .replace("{opinionContext}", opinionContext)
      .replace("{reportSummary}", reportSummary)
  }

  /**
   * 构建AI消息历史
   */
  private async buildAIMessages(
    session: DiscussionSession
  ): Promise<Array<{ id: string; content: string; role: string; timestamp: string }>> {
    // 取最近的消息（保留上下文）
    const recentMessages = session.messages.slice(-20)

    return recentMessages.map(m => ({
      id: m.id,
      content: m.content,
      role: m.role,
      timestamp: m.timestamp,
    }))
  }

  /**
   * 生成AI回复
   */
  private async generateResponse(session: DiscussionSession): Promise<string> {
    const messages = await this.buildAIMessages(session)
    const systemPrompt = await this.buildSystemPrompt(session)

    try {
      const response = await this.aiService.generateResponse(
        messages.map(m => ({
          id: m.id,
          content: m.content,
          senderId: m.role,
          senderName: m.role === "assistant" ? "AI" : "User",
          senderRole: m.role as any,
          timestamp: new Date(m.timestamp).getTime(),
          type: "text" as const,
        })),
        systemPrompt
      )

      return response
    } catch (error) {
      console.error(`[DiscussionService] Failed to generate response:`, error)
      return "抱歉，我遇到了一些问题。我们可以换个话题继续聊吗？"
    }
  }

  /**
   * 提取并保存观点
   */
  private async extractAndSaveOpinions(session: DiscussionSession): Promise<void> {
    // 只处理有内容的对话
    if (session.messages.length < 4) return

    try {
      const recentMessages = session.messages.slice(-6)
      const conversationText = recentMessages
        .map(m => `${m.role === "user" ? "用户" : "AI"}: ${m.content}`)
        .join("\n")

      const prompt = `请从以下对话中提取用户的观点。如果用户明确表达了对某个话题的看法、立场或态度，请提取出来。

对话：
${conversationText}

请以JSON格式返回（如果没有观点则返回空数组）：
[
  {
    "topic": "话题名称",
    "view": "用户的观点摘要（50字以内）",
    "context": "相关对话上下文"
  }
]`

      const messages = [{
        id: "1",
        content: prompt,
        senderId: "system",
        senderName: "System",
        senderRole: "user" as const,
        timestamp: Date.now(),
        type: "text" as const,
      }]

      const response = await this.aiService.generateResponse(messages)

      // 尝试解析JSON
      try {
        const jsonMatch = response.match(/\[[\s\S]*\]/)
        if (jsonMatch) {
          const opinions = JSON.parse(jsonMatch[0]) as Array<{
            topic: string
            view: string
            context?: string
          }>

          for (const op of opinions) {
            if (op.topic && op.view) {
              this.opinionStorage.addOpinion({
                date: session.date,
                topic: op.topic,
                view: op.view,
                context: op.context,
                source: "discussion",
              })

              // 添加到会话话题
              if (!session.topics.includes(op.topic)) {
                session.topics.push(op.topic)
              }
            }
          }
        }
      } catch (parseError) {
        // 解析失败，忽略
        console.log(`[DiscussionService] No opinions extracted`)
      }
    } catch (error) {
      console.error(`[DiscussionService] Failed to extract opinions:`, error)
    }
  }

  /**
   * 生成会话总结
   */
  private async generateSessionSummary(session: DiscussionSession): Promise<string> {
    const conversationText = session.messages
      .slice(1) // 跳过开场白
      .map(m => `${m.role === "user" ? "用户" : "AI"}: ${m.content.substring(0, 100)}`)
      .join("\n")

    const prompt = `请总结以下讨论的要点：

${conversationText}

请用3-5句话概括讨论的主要话题和用户的观点。`

    try {
      const messages = [{
        id: "1",
        content: prompt,
        senderId: "system",
        senderName: "System",
        senderRole: "user" as const,
        timestamp: Date.now(),
        type: "text" as const,
      }]

      const response = await this.aiService.generateResponse(messages)
      return response
    } catch (error) {
      return `讨论了${session.topics.join(", ")}等话题。`
    }
  }

  /**
   * 生成会话ID
   */
  private generateSessionId(): string {
    return `ds_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * 生成消息ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }
}
