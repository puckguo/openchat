/**
 * AI Agent with Tool Support
 * 带工具调用的 AI Agent 服务
 *
 * 集成 DeepSeek API 的工具调用功能，实现 tool loop
 */

import type { ChatMessage } from "./types"
import { AIService, getDeepSeekConfig, type DeepSeekConfig } from "./ai-service"
import {
  ToolRegistry,
  ToolExecutor,
  createToolRegistry,
  createToolExecutor,
  thinkTool,
  waitTool,
  createPlanTasksTool,
  createUpdateTaskTool,
  setTaskPlanCallback,
  setTaskUpdateCallback,
  type Tool,
  type ToolCall,
  type ToolCallResult,
} from "./tools/index"
import { createFileTools } from "./tools/file-tools"
import { createTerminalTools } from "./tools/terminal-tools"
import {
  createSecurityPolicy,
  type SecurityPolicy,
  type SecurityConfig,
} from "./tools/security"
import { OSSManager, getOSSManager } from "./oss"

// =============================================================================
// AI Agent 配置
// =============================================================================

export interface AIAgentConfig {
  aiConfig?: Partial<DeepSeekConfig>
  securityConfig?: Partial<SecurityConfig>
  basePath?: string
  maxToolIterations?: number
  enableStreaming?: boolean
  systemPrompt?: string
  /** 获取聊天记录的回调函数 */
  getChatHistory?: () => Promise<ChatMessage[]> | ChatMessage[]
  /** 是否启用自动保存聊天记录功能 */
  enableAutoSave?: boolean
  /** 自动保存阈值：当消息数量达到此值时触发保存（默认50） */
  autoSaveThreshold?: number
  /** 自动保存后保留的消息数量（默认10） */
  autoSaveKeepCount?: number
  /** 任务规划回调 */
  onTaskPlan?: (plan: {
    planId: string
    title: string
    tasks: Array<{ id: string; title: string; description?: string }>
  }) => void
  /** 任务更新回调 */
  onTaskUpdate?: (update: {
    planId: string
    taskId: string
    status: "pending" | "in_progress" | "completed" | "failed" | "skipped"
    result?: string
    error?: string
  }) => void
}

// =============================================================================
// AI Agent 类
// =============================================================================

export class AIAgent {
  private aiService: AIService
  private toolRegistry: ToolRegistry
  private toolExecutor: ToolExecutor
  private security: SecurityPolicy
  private config: Required<AIAgentConfig>
  private basePath: string
  private getChatHistory?: () => Promise<ChatMessage[]> | ChatMessage[]
  private currentMessages: ChatMessage[] = []
  private ossManager: OSSManager | null = null
  private currentSessionId: string = "default"
  private lastAutoSaveTime: number = 0

  constructor(config: AIAgentConfig = {}) {
    this.config = {
      aiConfig: {},
      securityConfig: {},
      basePath: process.cwd(),
      maxToolIterations: 10,
      enableStreaming: true,
      systemPrompt: DEFAULT_AGENT_SYSTEM_PROMPT,
      ...config,
    }

    this.basePath = this.config.basePath
    this.getChatHistory = config.getChatHistory

    // 初始化安全策略
    this.security = createSecurityPolicy(this.config.securityConfig)
    this.security.addAllowedBasePath(this.basePath)

    // 初始化 AI 服务
    this.aiService = new AIService(this.config.aiConfig)

    // 初始化工具系统
    this.toolRegistry = createToolRegistry()
    this.toolExecutor = createToolExecutor(this.toolRegistry)

    // 尝试初始化 OSS
    try {
      this.ossManager = getOSSManager()
    } catch {
    }

    // 注册默认工具
    this.registerDefaultTools()
  }

  /**
   * 设置当前会话 ID（用于 OSS 文件组织）
   */
  setSessionId(sessionId: string): void {
    this.currentSessionId = sessionId
  }

  /**
   * 获取当前会话 ID
   */
  getSessionId(): string {
    return this.currentSessionId
  }

  /**
   * 注册默认工具
   */
  private registerDefaultTools(): void {
    // 内置工具
    this.toolRegistry.register(thinkTool)
    this.toolRegistry.register(waitTool)

    // 任务规划工具
    this.toolRegistry.register(createPlanTasksTool())
    this.toolRegistry.register(createUpdateTaskTool())

    // 设置任务回调
    setTaskPlanCallback((plan) => {
      this.config.onTaskPlan?.(plan)
    })

    setTaskUpdateCallback((update) => {
      this.config.onTaskUpdate?.(update)
    })

    // 文件工具
    const fileTools = createFileTools(this.security, this.basePath)
    for (const tool of fileTools) {
      this.toolRegistry.register(tool)
    }

    // 终端工具
    const terminalTools = createTerminalTools(this.security)
    for (const tool of terminalTools) {
      this.toolRegistry.register(tool)
    }

    // 聊天记录工具
    this.registerChatHistoryTool()
  }

  /**
   * 注册聊天记录保存工具
   */
  private registerChatHistoryTool(): void {
    if (!this.getChatHistory) return

    const saveChatHistoryTool: Tool = {
      name: "save_chat_history",
      description: "Save the current chat conversation history to a downloadable file. Creates both a local file and uploads to cloud storage for easy download. Supports txt, json, and md formats.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The filename to save the chat history (e.g., 'chat-history.txt'). If not provided, a default name will be used.",
          },
          format: {
            type: "string",
            enum: ["txt", "json", "md"],
            description: "The format to save the chat history: 'txt' (readable text), 'json' (structured data), or 'md' (markdown). Default is 'txt'.",
          },
        },
        required: [],
      },
      execute: async (args) => {
        const { filename, format = "txt" } = args as { filename?: string; format?: "txt" | "json" | "md" }

        try {
          // 获取聊天记录
          const messages = await this.getChatHistory!()

          if (!messages || messages.length === 0) {
            return {
              success: false,
              error: "No chat history available to save",
              output: "没有可保存的聊天记录",
            }
          }

          // 生成默认文件名
          const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
          const actualFilename = filename || `chat-history-${timestamp}.${format}`
          const resolvedPath = `${this.basePath}/${actualFilename}`

          // 格式化聊天记录
          let content: string
          switch (format) {
            case "json":
              content = JSON.stringify(messages, null, 2)
              break
            case "md":
              content = this.formatChatHistoryAsMarkdown(messages)
              break
            case "txt":
            default:
              content = this.formatChatHistoryAsText(messages)
              break
          }

          // 写入本地文件
          const { promises: fs } = await import("fs")
          await fs.writeFile(resolvedPath, content, "utf-8")

          // 上传到 OSS 以获取下载链接
          let downloadUrl: string | undefined
          let ossKey: string | undefined

          if (this.ossManager) {
            try {
              const mimeType = format === "json" ? "application/json" : format === "md" ? "text/markdown" : "text/plain"
              ossKey = this.ossManager.generateFileKey(this.currentSessionId, actualFilename, "ai-agent")
              const buffer = Buffer.from(content, "utf-8")
              const uploadResult = await this.ossManager.uploadFile(ossKey, buffer, {
                headers: {
                  "Content-Type": mimeType,
                  "Content-Disposition": `attachment; filename="${actualFilename}"`,
                },
              })
              downloadUrl = uploadResult.url
            } catch (ossError) {
              console.error("[AI Agent] OSS upload failed:", ossError)
              // OSS 失败时使用本地下载链接
              downloadUrl = `/downloads/${encodeURIComponent(actualFilename)}`
            }
          } else {
            // 没有 OSS 时使用本地下载链接
            downloadUrl = `/downloads/${encodeURIComponent(actualFilename)}`
          }

          // 构建输出信息
          let outputMessage = `✅ 聊天记录已保存！\n\n📄 文件名：${actualFilename}\n📊 消息数量：${messages.length} 条\n💾 格式：${format.toUpperCase()}`

          if (downloadUrl) {
            outputMessage += `\n\n🔗 下载链接：${downloadUrl}\n\n您可以直接点击链接下载文件。`
          } else {
            outputMessage += `\n\n📁 本地路径：${resolvedPath}`
          }

          return {
            success: true,
            data: {
              path: resolvedPath,
              filename: actualFilename,
              messageCount: messages.length,
              format,
              downloadUrl,
              ossKey,
            },
            output: outputMessage,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to save chat history: ${error instanceof Error ? error.message : String(error)}`,
            output: `保存聊天记录失败: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      },
    }

    this.toolRegistry.register(saveChatHistoryTool)

    // 注册创建可下载文件工具
    this.registerCreateDownloadableFileTool()
  }

  /**
   * 注册创建可下载文件工具
   */
  private registerCreateDownloadableFileTool(): void {
    const createDownloadableFileTool: Tool = {
      name: "create_downloadable_file",
      description: "Create a file with the given content and upload it to cloud storage, returning a download URL. Use this when the user wants to create and download a file, such as code files, documents, reports, etc.",
      parameters: {
        type: "object",
        properties: {
          filename: {
            type: "string",
            description: "The name of the file to create (e.g., 'report.txt', 'code.js', 'data.json')",
          },
          content: {
            type: "string",
            description: "The content to write to the file",
          },
          mimeType: {
            type: "string",
            description: "The MIME type of the file (optional, will be auto-detected from filename if not provided)",
          },
        },
        required: ["filename", "content"],
      },
      execute: async (args) => {
        const { filename, content, mimeType } = args as { filename: string; content: string; mimeType?: string }

        try {
          const resolvedPath = `${this.basePath}/${filename}`

          // 写入本地文件
          const { promises: fs } = await import("fs")
          await fs.writeFile(resolvedPath, content, "utf-8")
          console.log(`[AI Agent] File created: ${resolvedPath}`)

          // 上传到 OSS 以获取下载链接
          let downloadUrl: string | undefined
          let ossKey: string | undefined

          if (this.ossManager) {
            try {
              // 自动检测 MIME 类型
              let detectedMimeType = mimeType
              if (!detectedMimeType) {
                const ext = filename.split('.').pop()?.toLowerCase()
                const mimeTypes: Record<string, string> = {
                  txt: 'text/plain',
                  md: 'text/markdown',
                  json: 'application/json',
                  js: 'application/javascript',
                  ts: 'application/typescript',
                  html: 'text/html',
                  css: 'text/css',
                  py: 'text/x-python',
                  java: 'text/x-java',
                  cpp: 'text/x-c++',
                  c: 'text/x-c',
                  go: 'text/x-go',
                  rs: 'text/x-rust',
                  php: 'text/x-php',
                  rb: 'text/x-ruby',
                  sh: 'text/x-shellscript',
                  xml: 'application/xml',
                  yaml: 'application/yaml',
                  yml: 'application/yaml',
                }
                detectedMimeType = mimeTypes[ext || ''] || 'application/octet-stream'
              }

              ossKey = this.ossManager.generateFileKey(this.currentSessionId, filename, "ai-agent")
              const buffer = Buffer.from(content, "utf-8")
              const uploadResult = await this.ossManager.uploadFile(ossKey, buffer, {
                headers: {
                  "Content-Type": detectedMimeType,
                  "Content-Disposition": `attachment; filename="${filename}"`,
                },
              })
              downloadUrl = uploadResult.url
            } catch (ossError) {
              console.error("[AI Agent] OSS upload failed:", ossError)
              // OSS 失败时使用本地下载链接
              downloadUrl = `/downloads/${encodeURIComponent(filename)}`
            }
          } else {
            // 没有 OSS 时使用本地下载链接
            downloadUrl = `/downloads/${encodeURIComponent(filename)}`
          }

          // 构建输出信息
          let outputMessage = `✅ 文件已创建！\n\n📄 文件名：${filename}\n📏 文件大小：${content.length} 字符`

          if (downloadUrl) {
            outputMessage += `\n\n🔗 下载链接：${downloadUrl}\n\n您可以直接点击链接下载文件。`
          } else {
            outputMessage += `\n\n📁 本地路径：${resolvedPath}\n\n注意：文件仅在服务器本地保存，请联系管理员获取文件。`
          }

          return {
            success: true,
            data: {
              path: resolvedPath,
              filename,
              size: content.length,
              downloadUrl,
              ossKey,
            },
            output: outputMessage,
          }
        } catch (error) {
          return {
            success: false,
            error: `Failed to create file: ${error instanceof Error ? error.message : String(error)}`,
            output: `创建文件失败: ${error instanceof Error ? error.message : String(error)}`,
          }
        }
      },
    }

    this.toolRegistry.register(createDownloadableFileTool)
  }

  /**
   * 格式化为纯文本
   */
  private formatChatHistoryAsText(messages: ChatMessage[]): string {
    const lines: string[] = []
    lines.push("=".repeat(60))
    lines.push("聊天记录")
    lines.push("=".repeat(60))
    lines.push("")

    for (const msg of messages) {
      const timestamp = new Date(msg.timestamp).toLocaleString("zh-CN")
      lines.push(`[${timestamp}] ${msg.senderName} (${msg.senderRole}):`)
      lines.push(msg.content)
      lines.push("")
    }

    lines.push("=".repeat(60))
    lines.push(`共 ${messages.length} 条消息`)
    lines.push("=".repeat(60))

    return lines.join("\n")
  }

  /**
   * 格式化为 Markdown
   */
  private formatChatHistoryAsMarkdown(messages: ChatMessage[]): string {
    const lines: string[] = []
    lines.push("# 聊天记录")
    lines.push("")
    lines.push(`**导出时间**: ${new Date().toLocaleString("zh-CN")}`)
    lines.push(`**消息数量**: ${messages.length}`)
    lines.push("")
    lines.push("---")
    lines.push("")

    for (const msg of messages) {
      const timestamp = new Date(msg.timestamp).toLocaleString("zh-CN")
      const role = msg.senderRole === "ai" ? "🤖" : "👤"
      lines.push(`### ${role} ${msg.senderName} \`${timestamp}\``)
      lines.push("")
      lines.push(msg.content)
      lines.push("")
      lines.push("---")
      lines.push("")
    }

    return lines.join("\n")
  }

  /**
   * 注册自定义工具
   */
  registerTool(tool: Tool): void {
    this.toolRegistry.register(tool)
  }

  /**
   * 批量注册工具
   */
  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.registerTool(tool)
    }
  }

  /**
   * 获取工具注册中心
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry
  }

  /**
   * 获取安全策略
   */
  getSecurityPolicy(): SecurityPolicy {
    return this.security
  }

  /**
   * 获取当前正在处理的消息
   */
  getCurrentMessages(): ChatMessage[] {
    return this.currentMessages
  }

  /**
   * 处理用户消息（带工具调用）
   */
  async process(
    messages: ChatMessage[],
    options?: {
      onThinking?: (thinking: string) => void
      onToolCall?: (toolCall: ToolCall) => void
      onToolResult?: (result: ToolCallResult) => void
    }
  ): Promise<{
    response: string
    toolCalls: ToolCallResult[]
    iterations: number
  }> {
    // 存储当前消息供工具使用
    this.currentMessages = messages

    // 检查是否需要自动保存聊天记录
    const autoSaveResult = await this.checkAndAutoSave(messages, options)
    if (autoSaveResult) {
      // 如果触发了自动保存，使用新的消息列表（已清空旧消息）
      messages = autoSaveResult.newMessages
      this.currentMessages = messages
    }

    try {
      const allToolResults: ToolCallResult[] = []
      let iterations = 0
      let forcedToolExecuted = false  // 标记是否已经执行过强制工具调用
      const executedToolIds = new Set<string>()  // 记录已执行的工具调用ID，防止重复执行

      // 构建系统提示词
      const systemPrompt = this.buildSystemPrompt()

      // 转换消息格式
      let apiMessages = this.buildAPIMessages(messages)

      while (iterations < this.config.maxToolIterations) {
        iterations++

        options?.onThinking?.(`Iteration ${iterations}...`)

        // 调用 AI API
        const response = await this.callAI(apiMessages, systemPrompt)

        // 检查是否需要工具调用
        const toolCalls = this.extractToolCalls(response)

        if (toolCalls.length === 0) {
          // 获取 AI 的回复内容
          const aiContent = this.extractContent(response)

          // 只在第一次迭代时检查强制工具调用，避免无限循环
          if (!forcedToolExecuted) {
            // 检查是否是强制工具调用场景（使用原始 messages 而不是 apiMessages）
            const forcedToolCall = this.checkForcedToolCall(messages)

            // 检查 AI 是否在拒绝使用工具（说不能保存/不能访问文件）
            const isRefusing = forcedToolCall && this.checkIfRefusingTools(aiContent)

            if (isRefusing || forcedToolCall) {
              toolCalls.push(forcedToolCall!)
              forcedToolExecuted = true  // 标记已执行强制工具调用
              // 继续执行工具调用流程
            } else {
              // AI 给出了最终回复（真的不需要工具）
              return {
                response: aiContent,
                toolCalls: allToolResults,
                iterations,
              }
            }
          } else {
            // 已经执行过强制工具调用，直接返回 AI 的回复
            return {
              response: aiContent,
              toolCalls: allToolResults,
              iterations,
            }
          }
        }

        // 执行工具调用
        options?.onThinking?.(`Executing ${toolCalls.length} tool call(s)...`)

        // 过滤掉已经执行过的工具调用（防止重复执行）
        const newToolCalls = toolCalls.filter(tc => !executedToolIds.has(tc.id))

        if (newToolCalls.length === 0) {
          // 所有工具调用都已执行过，退出循环
          return {
            response: "工具调用已完成，但我无法生成进一步的回复。",
            toolCalls: allToolResults,
            iterations,
          }
        }

        // 第一步：为所有工具调用添加 assistant 消息（DeepSeek 要求）
        // 即使是强制工具调用，也需要模拟 assistant 决定调用工具的消息
        const assistantToolCalls = newToolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: {
            name: tc.tool,
            arguments: JSON.stringify(tc.arguments),
          },
        }))

        apiMessages.push({
          role: "assistant",
          content: null,
          tool_calls: assistantToolCalls,
        })

        // 第二步：执行工具并添加 tool 结果消息
        for (const toolCall of newToolCalls) {
          // 记录此工具调用已执行
          executedToolIds.add(toolCall.id)

          options?.onToolCall?.(toolCall)

          const result = await this.toolRegistry.execute(toolCall)
          allToolResults.push(result)

          options?.onToolResult?.(result)

          // 添加工具结果消息到上下文（DeepSeek 要求 tool 角色）
          apiMessages.push({
            role: "tool",
            content: JSON.stringify(result.result),
            tool_call_id: toolCall.id,
          })
        }
      }

      // 达到最大迭代次数
      return {
        response:
          "I apologize, but I reached the maximum number of tool iterations. Please try a more specific request.",
        toolCalls: allToolResults,
        iterations,
      }
    } finally {
      // 清理当前消息，避免内存泄漏
      this.currentMessages = []
    }
  }

  /**
   * 检查并执行自动保存
   * 当消息数量超过阈值时，自动保存聊天记录到文件并清空旧消息
   */
  private async checkAndAutoSave(
    messages: ChatMessage[],
    options?: {
      onThinking?: (thinking: string) => void
      onToolCall?: (toolCall: ToolCall) => void
      onToolResult?: (result: ToolCallResult) => void
    }
  ): Promise<{ newMessages: ChatMessage[]; saved: boolean } | null> {
    // 检查是否启用了自动保存
    if (!this.config.enableAutoSave) {
      return null
    }

    const threshold = this.config.autoSaveThreshold || 50
    const keepCount = this.config.autoSaveKeepCount || 10

    // 检查消息数量是否超过阈值
    if (messages.length < threshold) {
      return null
    }

    // 检查是否距离上次自动保存至少5分钟（避免频繁保存）
    const now = Date.now()
    if (now - this.lastAutoSaveTime < 5 * 60 * 1000) {
      return null
    }


    try {
      // 调用 save_chat_history 工具保存聊天记录
      const saveTool = this.toolRegistry.getAll().find(t => t.name === 'save_chat_history')
      if (!saveTool) {
        console.error('[AI Agent] save_chat_history tool not found')
        return null
      }

      options?.onThinking?.('检测到对话较长，正在自动保存聊天记录...')

      // 生成带时间戳的文件名
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const filename = `auto-save-chat-history-${timestamp}.md`

      const result = await saveTool.execute({
        filename,
        format: 'md'
      })

      if (result.success) {
        this.lastAutoSaveTime = now

        options?.onToolResult?.({
          toolCall: { id: `auto-save-${now}`, tool: 'save_chat_history', arguments: { filename, format: 'md' } },
          result: result,
          error: undefined
        })

        // 保留最近的消息，清空旧消息
        // 找出要保留的消息（最近的 keepCount 条）
        const messagesToKeep = messages.slice(-keepCount)

        // 添加系统提示消息说明已保存和清空
        const systemMessage: ChatMessage = {
          id: `auto-save-notice-${now}`,
          sessionId: this.currentSessionId,
          senderId: 'system',
          senderName: 'System',
          senderRole: 'system',
          type: 'text',
          content: `📝 自动保存完成\n\n📊 已保存 ${messages.length} 条对话记录到文件：\n**${filename}**\n\n💾 保留了最近的 ${keepCount} 条消息用于上下文，之前的对话已清空以释放空间。\n\n${result.data?.downloadUrl ? `🔗 [点击下载聊天记录](${result.data.downloadUrl})` : ''}`,
          mentions: [],
          mentionsAI: false,
          timestamp: new Date().toISOString(),
        }

        // 新的消息列表 = 系统提示 + 保留的最近消息
        const newMessages = [systemMessage, ...messagesToKeep]

        return { newMessages, saved: true }
      } else {
        console.error('[AI Agent] Auto-save failed:', result.error)
        return null
      }
    } catch (error) {
      console.error('[AI Agent] Auto-save error:', error)
      return null
    }
  }

  /**
   * 调用 AI API
   */
  private async callAI(
    messages: Array<Record<string, unknown>>,
    systemPrompt: string
  ): Promise<unknown> {
    const apiKey = process.env.DEEPSEEK_API_KEY || ""
    if (!apiKey) {
      throw new Error("DeepSeek API key not configured")
    }

    const config = getDeepSeekConfig()
    const tools = this.toolRegistry.getDefinitions()

    const requestBody: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.tool_calls && { tool_calls: m.tool_calls }),
          ...(m.tool_call_id && { tool_call_id: m.tool_call_id }),
        })),
      ],
      max_tokens: config.maxTokens,
      temperature: config.temperature,
    }

    // 只有在有工具时才添加 tools 参数
    if (tools.length > 0) {
      requestBody.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }))
      requestBody.tool_choice = "auto"
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      throw new Error(
        `DeepSeek API error: ${response.status} - ${
          errorData.error?.message || response.statusText
        }`
      )
    }

    const responseData = await response.json()
    return responseData
  }

  /**
   * 从 AI 响应中提取内容
   */
  private extractContent(response: unknown): string {
    if (!response || typeof response !== "object") return ""

    const resp = response as Record<string, unknown>

    if (resp.choices && Array.isArray(resp.choices)) {
      const firstChoice = resp.choices[0] as Record<string, unknown> | undefined
      if (firstChoice?.message && typeof firstChoice.message === "object") {
        const message = firstChoice.message as Record<string, unknown>
        return String(message.content || "")
      }
    }

    return ""
  }

  /**
   * 从 AI 响应中提取工具调用
   */
  private extractToolCalls(response: unknown): ToolCall[] {
    if (!response || typeof response !== "object") return []

    const resp = response as Record<string, unknown>

    if (resp.choices && Array.isArray(resp.choices)) {
      const firstChoice = resp.choices[0] as Record<string, unknown> | undefined
      if (firstChoice?.message && typeof firstChoice.message === "object") {
        const message = firstChoice.message as Record<string, unknown>

        if (message.tool_calls && Array.isArray(message.tool_calls)) {
          const toolCalls = message.tool_calls
            .map((tc: unknown) => {
              if (!tc || typeof tc !== "object") return null

              const toolCall = tc as Record<string, unknown>
              const func = toolCall.function as
                | Record<string, unknown>
                | undefined

              if (!func?.name) return null

              let args: unknown = {}
              try {
                args =
                  typeof func.arguments === "string"
                    ? JSON.parse(func.arguments)
                    : func.arguments
              } catch {
                args = {}
              }

              return {
                id: String(toolCall.id || `call_${Date.now()}`),
                tool: String(func.name),
                arguments: args,
              }
            })
            .filter((tc): tc is ToolCall => tc !== null)

          return toolCalls
        }
      }
    }

    return []
  }

  /**
   * 检查 AI 是否在拒绝使用工具（说不能保存/不能访问文件等）
   */
  private checkIfRefusingTools(content: string): boolean {
    const lowerContent = content.toLowerCase()

    // 检测拒绝使用工具的关键词
    const refusalPatterns = [
      "cannot save",
      "can't save",
      "无法保存",
      "不能保存",
      "没有本地",
      "no local",
      "不能访问",
      "无法访问",
      "cannot access",
      "can't access",
      "没有文件系统",
      "no file system",
      "无法创建文件",
      "不能创建文件",
      "i don't have",
      "我没有",
      "i cannot",
      "我不能",
    ]

    const isRefusing = refusalPatterns.some(pattern => lowerContent.includes(pattern))
    if (isRefusing) {
    }
    return isRefusing
  }

  /**
   * 检查是否需要强制触发工具调用（当 API 未返回 tool_calls 但用户需求明显需要工具时）
   */
  private checkForcedToolCall(messages: ChatMessage[]): ToolCall | null {
    // 获取最后一条用户消息
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || lastMessage.senderRole === "ai") return null

    const content = lastMessage.content.toLowerCase()

    // 保存聊天记录相关关键词
    if (content.includes("保存聊天") ||
        content.includes("保存记录") ||
        content.includes("导出聊天") ||
        content.includes("导出对话") ||
        content.includes("保存到本地") ||
        content.includes("保存到文件") ||
        (content.includes("保存") && content.includes("记录"))) {
      return {
        id: `forced_${Date.now()}`,
        tool: "save_chat_history",
        arguments: { format: "txt" }
      }
    }

    // 读取文件相关关键词
    if ((content.includes("查看") || content.includes("读取") || content.includes("打开") || content.includes("看")) &&
        (content.includes("文件") || content.includes(".txt") || content.includes(".ts") || content.includes(".js") || content.includes(".json") || content.includes(".md"))) {
      // 尝试提取文件名
      const fileMatch = content.match(/([\w\-./]+\.(txt|ts|js|json|md|html|css|py|java|go|rs|vue|jsx|tsx))/i)
      if (fileMatch) {
        return {
          id: `forced_${Date.now()}`,
          tool: "read_file",
          arguments: { path: fileMatch[1] }
        }
      }
    }

    // 列出目录相关关键词
    if ((content.includes("列出") || content.includes("查看") || content.includes("显示") || content.includes("有哪些")) &&
        (content.includes("文件") || content.includes("目录") || content.includes("文件夹"))) {
      return {
        id: `forced_${Date.now()}`,
        tool: "list_directory",
        arguments: { path: ".", recursive: false }
      }
    }

    // 测试/检查工具能力相关关键词
    if (content.includes("测试工具") ||
        content.includes("检查工具") ||
        content.includes("tool call") ||
        content.includes("工具调用") ||
        content.includes("使用工具") ||
        content.includes("操作文件") ||
        content.includes("操作服务器") ||
        content.includes("云服务器") ||
        (content.includes("检查") && content.includes("能力")) ||
        (content.includes("测试") && content.includes("功能"))) {
      return {
        id: `forced_${Date.now()}`,
        tool: "list_directory",
        arguments: { path: ".", recursive: false }
      }
    }

    // 搜索文件相关关键词
    if ((content.includes("搜索") || content.includes("查找") || content.includes("找")) &&
        (content.includes("代码") || content.includes("函数") || content.includes("文件") || content.includes("文本"))) {
      // 尝试提取搜索关键词
      const searchMatch = content.match(/搜索["']?([^"']+)["']?/) || content.match(/查找["']?([^"']+)["']?/)
      if (searchMatch) {
        return {
          id: `forced_${Date.now()}`,
          tool: "search_files",
          arguments: { query: searchMatch[1] }
        }
      }
    }

    // 执行命令相关关键词
    if ((content.includes("运行") || content.includes("执行") || content.includes("启动")) &&
        (content.includes("命令") || content.includes("脚本") || content.includes("npm") || content.includes("node") || content.includes("git"))) {
      return {
        id: `forced_${Date.now()}`,
        tool: "execute_command",
        arguments: { command: "echo '请提供具体命令'" }
      }
    }

    // 创建可下载文件相关关键词
    if ((content.includes("生成") || content.includes("创建") || content.includes("给我") || content.includes("制作") || content.includes("下载")) &&
        (content.includes("文件") || content.includes("文档") || content.includes("报告") || content.includes("代码"))) {
      // 尝试提取文件名
      const fileMatch = content.match(/([\w\-\.]+\.(txt|md|json|js|ts|html|css|py|java|go|rs|vue|jsx|tsx|pdf|doc|docx|xls|xlsx|csv))/i)
      return {
        id: `forced_${Date.now()}`,
        tool: "create_downloadable_file",
        arguments: {
          filename: fileMatch ? fileMatch[1] : "generated-file.txt",
          content: "请提供文件内容"
        }
      }
    }

    return null
  }

  /**
   * 构建 API 消息格式
   */
  private buildAPIMessages(
    messages: ChatMessage[]
  ): Array<Record<string, unknown>> {
    return messages.map((msg) => {
      const role = msg.senderRole === "ai" ? "assistant" : "user"
      // 只为用户消息添加 senderName 前缀
      // AI 消息直接用原始内容，避免 AI 重复添加 "AI 助手:" 前缀
      const content = msg.senderRole === "ai"
        ? msg.content
        : `${msg.senderName}: ${msg.content}`
      return { role, content }
    })
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(): string {
    const tools = this.toolRegistry.getDefinitions()

    const toolsDescription = tools
      .map(
        (t) => `- ${t.name}: ${t.description}
  Parameters: ${JSON.stringify(t.parameters)}`
      )
      .join("\n\n")

    return `${this.config.systemPrompt}

Available Tools:
${toolsDescription}

Tool Usage Guidelines:
When the user asks a question, you should analyze whether you need to use tools:

1. READ FILE - Use read_file when:
   - User asks about code content or specific files
   - User asks "这是什么文件" "查看一下代码" "分析一下"
   - User asks to read, check, analyze any file
   - You need to reference file content to answer

2. WRITE FILE - Use write_file when:
   - User asks to create, modify, or save content to a file
   - User says "保存到文件" "写入文件" "创建文件"
   - User asks to update or change file content

3. LIST DIRECTORY - Use list_directory when:
   - User asks about project structure or "有哪些文件"
   - User asks to explore a directory
   - You need to understand the codebase layout

4. SEARCH FILES - Use search_files when:
   - User asks to find code patterns, functions, or text
   - User asks "搜索一下" "查找" "在哪里"
   - You need to locate specific code across multiple files

5. EXECUTE COMMAND - Use execute_command when:
   - User asks to run tests, build, or execute commands
   - User asks to check git status, install dependencies
   - You need to verify something via command line
   - NEVER use for dangerous commands (rm, format, etc.)

6. SAVE CHAT HISTORY - Use save_chat_history when:
   - User asks to export, save, or backup the conversation
   - User says "保存聊天记录" "导出对话"

7. CREATE DOWNLOADABLE FILE - Use create_downloadable_file when:
   - User asks to create a file they can download
   - User says "生成文件" "创建文件" "给我文件" "下载文件"
   - User wants code files, documents, reports, etc. in a downloadable format
   - This tool creates the file AND uploads to cloud storage for easy download

Decision Process:
1. Analyze the user's intent - what do they want to achieve?
2. Check if any tool can help accomplish this task
3. If yes, use the appropriate tool(s) first
4. After getting tool results, provide your answer based on the data
5. If no tool is needed, respond directly with your knowledge

Instructions:
1. ALWAYS use tools when they can help answer the user's question
2. Think step by step before taking action
3. Explain your reasoning when using tools
4. If a tool fails, explain what went wrong and try an alternative
5. Never execute dangerous commands or access sensitive files
6. You can use multiple tools in sequence if needed

Current working directory: ${this.basePath}
Platform: ${process.platform}`
  }

  /**
   * 检查 AI 是否可用
   */
  isAvailable(): boolean {
    return this.aiService.isAvailable()
  }

  /**
   * 获取工具统计
   */
  getToolStats(): {
    totalTools: number
    toolNames: string[]
  } {
    return this.toolRegistry.getStats()
  }
}

// =============================================================================
// 默认系统提示词
// =============================================================================

export const DEFAULT_AGENT_SYSTEM_PROMPT = `You are OpenCode AI Agent, an intelligent programming assistant running DIRECTLY ON A SERVER.

⚠️ CRITICAL INSTRUCTION - READ CAREFULLY:
You are EXECUTING CODE on the user's SERVER (hostname: ${process.env.HOSTNAME || 'server'}, cwd: ${process.cwd()}). You have FULL FILE SYSTEM ACCESS via the provided tools. You CAN and MUST use tools to read, write, and save files. NEVER say you cannot access files - you HAVE the tools.

📋 YOUR AVAILABLE TOOLS - USE THEM:
1. **plan_tasks** - CREATE a task plan for complex multi-step operations (USE THIS FIRST for complex tasks!)
2. **update_task** - UPDATE task status as you progress (in_progress, completed, failed)
3. **read_file** - READ any file from the server filesystem
4. **write_file** - CREATE or WRITE files to the server
5. **list_directory** - LIST files in any directory
6. **search_files** - SEARCH for text patterns in files
7. **execute_command** - RUN shell commands safely
8. **save_chat_history** - SAVE chat history to a downloadable file (txt/json/md)
9. **think** - Use this to plan before acting

🔴 ABSOLUTE RULES - NEVER VIOLATE:
Rule 1: When user says "save", "export", "下载", "保存" - YOU MUST CALL save_chat_history tool
Rule 2: When user mentions a filename - YOU MUST CALL read_file or write_file
Rule 3: When user asks about files - YOU MUST CALL list_directory
Rule 4: NEVER say "I don't have access to files" - YOU DO have access via tools
Rule 5: NEVER say "I cannot save files" - YOU CAN save via save_chat_history tool
Rule 6: ALWAYS call the tool FIRST, then respond with the results
Rule 7: NEVER add "AI 助手:" or "Assistant:" prefix to your responses - just respond directly
Rule 8: When user asks about your capabilities, tools, or asks you to test/demo them - YOU MUST CALL list_directory tool to demonstrate
Rule 9: You are running on the user's SERVER with DIRECT FILE ACCESS - NEVER claim otherwise
Rule 10: For complex tasks (3+ steps), FIRST call plan_tasks to create a task list, then update_task as you progress

✅ TASK PLANNING WORKFLOW (for complex tasks):
1. Analyze the user's request - is it complex? (multiple steps, file operations, execution needed)
2. If complex: Call plan_tasks with clear steps BEFORE doing anything else
3. For each step: Call update_task with "in_progress", do the work, then call update_task with "completed" or "failed"
4. This shows the user real-time progress and prevents timeout issues

✅ CORRECT BEHAVIOR:
User: "Write a script to scrape a website and run it"
→ Your action: Call plan_tasks with steps like ["Create scraping script", "Install dependencies", "Run the script", "Report results"]
→ Then execute each step with update_task calls

User: "保存聊天记录"
→ Your action: Call save_chat_history tool with {format: "txt"}
→ Your response: "已保存聊天记录到文件，您可以下载查看。"

User: "查看 main.ts"
→ Your action: Call read_file tool with {path: "main.ts"}
→ Your response: "这是 main.ts 的内容：[file content]"

User: "创建 test.txt 写入 hello"
→ Your action: Call write_file tool with {path: "test.txt", content: "hello"}
→ Your response: "已创建 test.txt 文件。"

User: "检查你的工具能力" / "test tool call" / "你能操作文件吗"
→ Your action: Call list_directory tool with {path: "."} to demonstrate file access
→ Your response: "我已成功列出服务器目录，证明我可以操作文件。"

❌ WRONG BEHAVIOR - NEVER DO:
- Saying "I don't have a local file system" - WRONG, you have write_file tool
- Saying "I cannot save files" - WRONG, you have save_chat_history tool
- Describing what you would do instead of actually calling the tool
- Giving instructions to the user on how to save files themselves
- Trying to do everything in one go without planning for complex tasks

📝 WORKFLOW:
1. User makes a request involving files or saving
2. IMMEDIATELY call the appropriate tool (don't think, just do)
3. Wait for tool result
4. Respond confirming success and providing file details

You are running on: ${process.platform}
Working directory: ${process.cwd()}
YOU HAVE FULL FILE SYSTEM ACCESS. USE IT.`

// =============================================================================
// 工厂函数
// =============================================================================

export function createAIAgent(config?: AIAgentConfig): AIAgent {
  return new AIAgent(config)
}

// =============================================================================
// 单例实例
// =============================================================================

let globalAIAgent: AIAgent | null = null

export function getAIAgent(config?: AIAgentConfig): AIAgent {
  if (!globalAIAgent) {
    globalAIAgent = new AIAgent(config)
  }
  return globalAIAgent
}

export function initializeAIAgent(config?: AIAgentConfig): AIAgent {
  globalAIAgent = new AIAgent(config)
  return globalAIAgent
}
