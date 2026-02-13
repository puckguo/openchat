/**
 * WebSocket Server
 * WebSocket 服务器实现
 *
 * 处理多人实时通信：房间管理、消息广播、状态同步
 * 集成 RDS 和 OSS 存储
 */

import type { ServerWebSocket } from "bun"
import { z } from "zod"
import type { ChatMessage, Participant, WebSocketEvent, WebSocketEventType } from "./types"
import type { JSONStorageManager } from "./storage"
import { hasPermission, updateParticipantStatus, type UserRole, roleRequiresPassword, verifyRolePassword } from "./role"
import { authenticateWebSocket, getSupabaseConfig } from "./supabase-auth"
import { DatabaseManager, getDatabaseManager } from "./database"
import { OSSManager, getOSSManager, detectMimeType } from "./oss"
import { AIService, getAIService, DEFAULT_AI_SYSTEM_PROMPT } from "./ai-service"
import { AIAgent, getAIAgent, initializeAIAgent, DEFAULT_AGENT_SYSTEM_PROMPT } from "./ai-agent"
import { ConversationSummaryManager, createSummaryManager } from "./conversation-summary"
import { VoiceChatService, getVoiceChatService, type VoiceTranscript } from "./voice-chat-service"
import { DailyReportAPIHandler, initializeDailyReportAPIHandler } from "./daily-report"

// 版本标记 - 用于验证代码是否更新
console.log("[WebSocket Server] Version: 2026-02-11-v2 - with voice_transcript support")

// =============================================================================
// WebSocket 配置
// =============================================================================

export interface WebSocketServerConfig {
  /** 服务器端口 */
  port: number
  /** 服务器主机 (0.0.0.0 允许所有连接) */
  hostname?: string
  /** 心跳间隔（毫秒） */
  heartbeatInterval?: number
  /** 心跳超时（毫秒） */
  heartbeatTimeout?: number
  /** 是否启用压缩 */
  compression?: boolean
  /** 存储管理器 */
  storage?: JSONStorageManager
}

export const DEFAULT_WS_CONFIG: WebSocketServerConfig = {
  port: 8080,
  hostname: "0.0.0.0", // 默认监听所有网络接口
  heartbeatInterval: 30000, // 30秒
  heartbeatTimeout: 60000, // 60秒
  compression: true,
}

// =============================================================================
// WebSocket 数据结构
// =============================================================================

interface WebSocketData {
  sessionId: string
  userId: string
  userName: string
  userRole: UserRole
  joinedAt: number
  lastPing: number
  token?: string
  isAuthenticated: boolean
  passwordQuestion?: string
  passwordAnswer?: string
  rolePassword?: string // 角色密码（用于验证owner/admin身份）
}

interface Room {
  sessionId: string
  participants: Map<string, ServerWebSocket<WebSocketData>>
  messages: ChatMessage[]
  createdAt: number
  passwordQuestion?: string
  passwordAnswer?: string
}

// =============================================================================
// 消息协议
// =============================================================================

const ClientMessageSchema = z.discriminatedUnion("type", [
  // 连接消息
  z.object({
    type: z.literal("connect"),
    sessionId: z.string(),
    userId: z.string(),
    userName: z.string(),
    userRole: z.enum(["owner", "admin", "member", "guest", "ai"]),
  }),

  // 心跳消息
  z.object({
    type: z.literal("ping"),
    timestamp: z.number(),
  }),

  // 聊天消息
  z.object({
    type: z.literal("message"),
    message: z.object({
      id: z.string(),
      type: z.enum(["text", "image", "voice", "file", "code", "system", "ai_thinking"]),
      content: z.string(),
      voiceData: z.any().optional(),
      imageData: z.any().optional(),
      fileData: z.any().optional(),
      codeData: z.any().optional(),
      mentions: z.array(z.string()),
      mentionsAI: z.boolean(),
      replyTo: z.string().optional(),
    }),
  }),

  // 正在输入
  z.object({
    type: z.literal("typing"),
    isTyping: z.boolean(),
  }),

  // 状态更新
  z.object({
    type: z.literal("status"),
    status: z.enum(["online", "away", "offline"]),
  }),

  // 消息编辑
  z.object({
    type: z.literal("edit_message"),
    messageId: z.string(),
    content: z.string(),
  }),

  // 消息删除
  z.object({
    type: z.literal("delete_message"),
    messageId: z.string(),
  }),

  // 消息反应
  z.object({
    type: z.literal("reaction"),
    messageId: z.string(),
    emoji: z.string(),
    action: z.enum(["add", "remove"]),
  }),

  // 邀请用户
  z.object({
    type: z.literal("invite"),
    userId: z.string(),
    userName: z.string(),
    role: z.enum(["admin", "member", "guest"]),
  }),

  // 踢出用户
  z.object({
    type: z.literal("kick"),
    userId: z.string(),
    reason: z.string().optional(),
  }),

  // 更改角色
  z.object({
    type: z.literal("change_role"),
    userId: z.string(),
    newRole: z.enum(["admin", "member", "guest"]),
  }),

  // 文件分享
  z.object({
    type: z.literal("share_file"),
    fileName: z.string(),
    fileSize: z.number(),
    mimeType: z.string(),
    content: z.string(), // base64 编码
  }),

  // 语音转录请求
  z.object({
    type: z.literal("transcribe_voice"),
    messageId: z.string(),
    voiceUrl: z.string(),
  }),

  // 获取历史消息
  z.object({
    type: z.literal("get_history"),
    before: z.string().optional(), // 时间戳
    limit: z.number().default(50),
  }),

  // 总结聊天
  z.object({
    type: z.literal("summarize"),
  }),

  // 清空AI记忆
  z.object({
    type: z.literal("clear_ai_memory"),
  }),

  // 验证密码
  z.object({
    type: z.literal("verify_password"),
    answer: z.string(),
  }),

  // 设置密码（仅 Owner 可用）
  z.object({
    type: z.literal("set_password"),
    question: z.string(),
    answer: z.string(),
  }),

  // 语音聊天 - 加入
  z.object({
    type: z.literal("voice_join"),
  }),

  // 语音聊天 - 离开
  z.object({
    type: z.literal("voice_leave"),
  }),

  // 语音聊天 - 开始发言
  z.object({
    type: z.literal("voice_start_speaking"),
  }),

  // 语音聊天 - 停止发言
  z.object({
    type: z.literal("voice_stop_speaking"),
  }),

  // 语音聊天 - 音频数据（Base64编码，旧版按住说话）
  z.object({
    type: z.literal("voice_audio_data"),
    audioData: z.string(), // Base64 编码的 PCM 音频数据
  }),

  // 语音聊天 - 连续音频流（带VAD检测）
  z.object({
    type: z.literal("voice_continuous_audio"),
    audioData: z.string(), // Base64 编码的 PCM 音频数据
    isSpeech: z.boolean(), // VAD检测结果：是否检测到语音
  }),

  // 语音聊天 - 触发AI分析
  z.object({
    type: z.literal("voice_ai_analyze"),
  }),

  // 语音聊天 - 获取状态
  z.object({
    type: z.literal("voice_get_status"),
  }),

  // 语音聊天 - 转录结果（来自Web Speech API）
  z.object({
    type: z.literal("voice_transcript"),
    transcript: z.object({
      text: z.string(),
      isFinal: z.boolean(),
    }),
  }),

  // 刷新文件下载URL（用于OSS文件URL过期后重新获取）
  z.object({
    type: z.literal("refresh_download_url"),
    ossKey: z.string(),
    requestId: z.string(),
  }),

  // 删除文件（仅 Admin 和 Owner 可用）
  z.object({
    type: z.literal("delete_file"),
    fileId: z.string(),
  }),

  // 重命名文件（仅 Admin 和 Owner 可用）
  z.object({
    type: z.literal("rename_file"),
    fileId: z.string(),
    newFileName: z.string(),
  }),

  // 获取会话文件列表
  z.object({
    type: z.literal("list_session_files"),
  }),
])

type ClientMessage = z.infer<typeof ClientMessageSchema>

// =============================================================================
// WebSocket 服务器
// =============================================================================

export class MultiplayerWebSocketServer {
  private config: WebSocketServerConfig
  private rooms: Map<string, Room> = new Map()
  private server: ReturnType<typeof Bun.serve> | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private storage: JSONStorageManager | null = null
  private db: DatabaseManager | null = null
  private oss: OSSManager | null = null
  private enableDatabase: boolean = false
  private enableOSS: boolean = false
  private enableAI: boolean = false
  private aiService: AIService | null = null
  private aiAgent: AIAgent | null = null
  private summaryManager: ConversationSummaryManager | null = null

  // 语音聊天服务
  private enableVoiceChat: boolean = false
  private voiceChatService: VoiceChatService | null = null

  // 日报系统
  private enableDailyReport: boolean = false
  private dailyReportAPIHandler: DailyReportAPIHandler | null = null

  // 事件处理器
  public onMessage: ((sessionId: string, message: ChatMessage, sender: Participant) => void) | null = null
  public onUserJoined: ((sessionId: string, participant: Participant) => void) | null = null
  public onUserLeft: ((sessionId: string, userId: string) => void) | null = null
  public onAITrigger: ((sessionId: string, context: ChatMessage[]) => void) | null = null

  constructor(config: Partial<WebSocketServerConfig> = {}) {
    this.config = { ...DEFAULT_WS_CONFIG, ...config }
    this.storage = config.storage ?? null
    this.enableDatabase = process.env.ENABLE_DATABASE === "true"
    this.enableOSS = process.env.ENABLE_OSS === "true"
    this.enableAI = process.env.ENABLE_AI === "true" || !!process.env.DEEPSEEK_API_KEY
    this.enableVoiceChat = process.env.ENABLE_VOICE_CHAT === "true" || !!process.env.DASHSCOPE_API_KEY
    this.enableDailyReport = process.env.ENABLE_DAILY_REPORT !== "false" // 默认启用
  }

  // ============================================================================
  // 服务器生命周期
  // ============================================================================

  async initialize(): Promise<void> {
    // Initialize database
    if (this.enableDatabase) {
      try {
        this.db = getDatabaseManager()
        await this.db.connect()
        console.log("[WebSocket] Database initialized")
      } catch (error) {
        console.error("[WebSocket] Database initialization failed:", error)
        this.enableDatabase = false
      }
    }

    // Initialize OSS
    if (this.enableOSS) {
      try {
        this.oss = getOSSManager()
        await this.oss.initialize()
        console.log("[WebSocket] OSS initialized")
      } catch (error) {
        console.error("[WebSocket] OSS initialization failed:", error)
        this.enableOSS = false
      }
    }

    // Initialize AI Service
    if (this.enableAI) {
      try {
        this.aiService = getAIService()
        if (this.aiService.isAvailable()) {
          console.log("[WebSocket] AI Service initialized (DeepSeek)")

          // Initialize AI Agent with tools
          this.aiAgent = initializeAIAgent({
            basePath: process.cwd(),
            maxToolIterations: 10,
            enableAutoSave: true,        // 启用自动保存聊天记录
            autoSaveThreshold: 40,       // 当消息达到40条时触发保存
            autoSaveKeepCount: 10,       // 保存后保留最近10条消息
            securityConfig: {
              allowWrite: true,
              allowDelete: false,
              maxFileSize: 10 * 1024 * 1024, // 10MB
              commandTimeout: 30000,
            },
            // 提供获取聊天记录的回调函数
            getChatHistory: async () => {
              // 从当前 AI Agent 获取会话 ID
              const sessionId = this.aiAgent?.getSessionId()
              if (!sessionId) return []

              // 优先从数据库获取完整聊天记录
              if (this.enableDatabase && this.db) {
                try {
                  const messages = await this.db.getMessages(sessionId, 1000) // 获取最近1000条
                  console.log(`[AI Agent] Loaded ${messages.length} messages from database for session ${sessionId}`)
                  return messages
                } catch (error) {
                  console.error('[AI Agent] Failed to load messages from database:', error)
                }
              }

              // 备用：从房间内存缓存获取
              const room = this.rooms.get(sessionId)
              if (room) {
                console.log(`[AI Agent] Loaded ${room.messages.length} messages from room cache for session ${sessionId}`)
                return room.messages
              }

              return []
            }
          })

          // Add current workspace to allowed paths
          this.aiAgent.getSecurityPolicy().addAllowedBasePath(process.cwd())

          console.log("[WebSocket] AI Agent initialized with tool capabilities")
          console.log(`[WebSocket] Available tools: ${this.aiAgent.getToolStats().toolNames.join(", ")}`)

          this.setupAIHandler()
        } else {
          console.warn("[WebSocket] AI Service not available - API key not configured")
          this.enableAI = false
        }
      } catch (error) {
        console.error("[WebSocket] AI Service initialization failed:", error)
        this.enableAI = false
      }
    }

    // Initialize Summary Manager
    if (this.enableDatabase && this.db && this.aiService) {
      try {
        this.summaryManager = createSummaryManager(this.db, this.aiService)
        await this.summaryManager.initializeTable()
        console.log("[WebSocket] Summary Manager initialized")
      } catch (error) {
        console.error("[WebSocket] Summary Manager initialization failed:", error)
      }
    }

    // Initialize Voice Chat Service
    if (this.enableVoiceChat) {
      try {
        this.voiceChatService = getVoiceChatService()
        if (this.voiceChatService.isEnabled()) {
          console.log("[WebSocket] Voice Chat Service initialized")
          this.setupVoiceChatHandler()
        } else {
          console.warn("[WebSocket] Voice Chat Service not available - DASHSCOPE_API_KEY not configured")
          this.enableVoiceChat = false
        }
      } catch (error) {
        console.error("[WebSocket] Voice Chat Service initialization failed:", error)
        this.enableVoiceChat = false
      }
    }

    // Initialize Daily Report System
    if (this.enableDailyReport && this.aiService) {
      try {
        const { ReportGenerator } = await import("./daily-report")
        const reportGenerator = new ReportGenerator({
          aiService: this.aiService,
          ossManager: this.oss || undefined,
          summaryLength: 1000,
          maxNewsPerCategory: 8,
        })

        this.dailyReportAPIHandler = initializeDailyReportAPIHandler({
          reportGenerator,
          aiService: this.aiService,
          ossManager: this.oss || undefined,
        })

        console.log("[WebSocket] Daily Report System initialized")

        // 启动定时调度器（如果启用）
        if (process.env.DAILY_REPORT_SCHEDULE_ENABLED !== "false") {
          const { getScheduler } = await import("./daily-report")
          const scheduler = getScheduler()
          scheduler.start()
          console.log("[WebSocket] Daily Report Scheduler started")
        }
      } catch (error) {
        console.error("[WebSocket] Daily Report System initialization failed:", error)
        this.enableDailyReport = false
      }
    }
  }

  /**
   * 设置 AI 处理程序
   */
  private setupAIHandler(): void {
    this.onAITrigger = async (sessionId, context) => {
      if ((!this.aiService && !this.aiAgent) || !this.enableAI) return

      try {
        console.log(`[AI] Processing request for session ${sessionId} with ${context.length} context messages`)

        // 发送 AI 正在思考的状态
        this.sendAIThinking(sessionId, "正在思考...")

        // 获取最后一条消息（用户提问）
        const lastMessage = context[context.length - 1]
        const question = lastMessage?.content || ""

        // 使用总结管理器获取AI上下文（总结 + 最新消息）
        let aiContext: ChatMessage[] = context

        if (this.summaryManager) {
          const summaryContext = await this.summaryManager.getAIContext(
            sessionId,
            context,
            10 // 最多10条最新消息
          )

          if (summaryContext.summary) {
            // 创建系统消息包含总结
            const summaryMessage: ChatMessage = {
              id: 'summary-context',
              sessionId,
              senderId: 'system',
              senderName: 'System',
              senderRole: 'system',
              type: 'text',
              content: `[历史对话总结]\n${summaryContext.summary}\n\n[后续对话]`,
              mentions: [],
              mentionsAI: false,
              timestamp: new Date().toISOString(),
            }

            // 使用总结 + 最新消息作为上下文
            aiContext = [summaryMessage, ...summaryContext.messagesAfterSummary]
            console.log(`[AI] Using summary + ${summaryContext.messagesAfterSummary.length} recent messages`)
          }
        }

        let response: string
        let toolCalls: any[] = []

        // 使用 AI Agent 处理（支持工具调用）
        if (this.aiAgent) {
          console.log(`[AI] Using AI Agent with tool capabilities`)

          const room = this.rooms.get(sessionId)
          if (!room) return

          // 设置当前会话 ID（用于文件上传）
          this.aiAgent.setSessionId(sessionId)

          // 发送思考状态消息（动态更新）
          let thinkingContent = "🤔 正在思考..."
          this.broadcastToRoom(room, {
            type: "ai.thinking",
            timestamp: new Date().toISOString(),
            senderId: "ai-assistant",
            senderName: "AI 助手",
            payload: { message: thinkingContent },
          })

          // 处理带工具调用的请求
          const result = await this.aiAgent.process(aiContext, {
            onThinking: (thinking) => {
              console.log(`[AI Agent] ${thinking}`)
              // 更新思考状态（如果正在使用工具）
              if (thinking.includes("tool") || thinking.includes("Tool")) {
                thinkingContent = "🔧 正在使用工具..."
                this.broadcastToRoom(room, {
                  type: "ai.thinking",
                  timestamp: new Date().toISOString(),
                  senderId: "ai-assistant",
                  senderName: "AI 助手",
                  payload: { message: thinkingContent },
                })
              }
            },
            onToolCall: (toolCall) => {
              console.log(`[AI Agent] Tool call: ${toolCall.tool}`, toolCall.arguments)
              // 广播工具调用
              this.broadcastToRoom(room, {
                type: "ai.tool_call",
                timestamp: new Date().toISOString(),
                senderId: "ai-assistant",
                payload: {
                  tool: toolCall.tool,
                  arguments: toolCall.arguments,
                },
              })
            },
            onToolResult: (toolResult) => {
              console.log(`[AI Agent] Tool result:`, toolResult.result.success ? "success" : "failed")
              toolCalls.push(toolResult)
            },
          })

          response = result.response

          // 如果有工具调用，添加工具执行摘要
          if (result.toolCalls.length > 0) {
            const toolSummary = result.toolCalls
              .map(tc => `- ${tc.tool}: ${tc.result.success ? '✓' : '✗'} ${tc.result.output?.substring(0, 50) || ''}`)
              .join('\n')
            console.log(`[AI] Tools executed:\n${toolSummary}`)
          }
        } else {
          // 降级到普通 AI 服务
          console.log(`[AI] Using standard AI Service (no tools)`)

          let systemPrompt = DEFAULT_AI_SYSTEM_PROMPT
          const summaryContext = await this.summaryManager?.getAIContext(sessionId, context, 10)
          if (summaryContext?.summary) {
            systemPrompt += `\n\n**对话上下文**：${summaryContext.summary}`
          }

          response = await this.aiService!.generateResponse(
            aiContext,
            systemPrompt
          )
        }

        // 创建 AI 消息
        const aiMessage: ChatMessage = {
          id: `ai-${Date.now()}`,
          sessionId,
          senderId: "ai-assistant",
          senderName: "AI 助手",
          senderRole: "ai",
          type: "text",
          content: response,
          mentions: [],
          mentionsAI: false,
          timestamp: new Date().toISOString(),
        }

        // 获取房间
        const room = this.rooms.get(sessionId)
        if (!room) return

        // 保存到数据库
        if (this.enableDatabase && this.db) {
          try {
            await this.db.saveMessage(sessionId, aiMessage)
          } catch (error) {
            console.error("[AI] Database save error:", error)
          }
        }

        // 添加到房间消息缓存
        room.messages.push(aiMessage)

        // 广播 AI 响应
        this.broadcastToRoom(room, {
          type: "ai.response",
          timestamp: aiMessage.timestamp,
          senderId: "ai-assistant",
          senderName: "AI 助手",
          payload: aiMessage,
        })

        console.log(`[AI] Response sent for session ${sessionId}`)

      } catch (error) {
        console.error("[AI] Error processing request:", error)

        // 发送错误消息
        const errorMessage: ChatMessage = {
          id: `ai-error-${Date.now()}`,
          sessionId,
          senderId: "ai-assistant",
          senderName: "AI 助手",
          senderRole: "ai",
          type: "text",
          content: `❌ 抱歉，我遇到了一些问题：${error instanceof Error ? error.message : "未知错误"}`,
          mentions: [],
          mentionsAI: false,
          timestamp: new Date().toISOString(),
        }

        const room = this.rooms.get(sessionId)
        if (room) {
          this.broadcastToRoom(room, {
            type: "ai.response",
            timestamp: errorMessage.timestamp,
            senderId: "ai-assistant",
            senderName: "AI 助手",
            payload: errorMessage,
          })
        }
      }
    }
  }

  start(): void {
    if (this.server) {
      console.warn("[WebSocket] Server already running")
      return
    }

    // 检查是否需要启用 HTTPS
    const useHTTPS = process.env.USE_HTTPS === "true"
    const tlsConfig = useHTTPS
      ? {
          cert: process.env.SSL_CERT_PATH
            ? require("fs").readFileSync(process.env.SSL_CERT_PATH)
            : require("fs").readFileSync("./cert.pem"),
          key: process.env.SSL_KEY_PATH
            ? require("fs").readFileSync(process.env.SSL_KEY_PATH)
            : require("fs").readFileSync("./key.pem"),
        }
      : undefined

    if (useHTTPS) {
      console.log("[WebSocket] HTTPS enabled")
    }

    this.server = Bun.serve({
      port: this.config.port,
      hostname: this.config.hostname || "0.0.0.0",
      tls: tlsConfig,
      fetch: async (req, server) => {
        const url = new URL(req.url)

        // AI 生成文件下载端点（优先处理，避免WebSocket升级干扰）
        if (url.pathname.startsWith("/downloads/")) {
          const encodedFilename = url.pathname.replace("/downloads/", "")
          console.log(`[Download] Requested file: ${encodedFilename}`)

          // 解码URL编码的文件名
          const filename = decodeURIComponent(encodedFilename)
          console.log(`[Download] Decoded filename: ${filename}`)

          // 防止路径遍历攻击 - 使用简单方法提取文件名
          const sanitizedFilename = filename.split(/[\\/]/).pop() || "file"
          console.log(`[Download] Sanitized filename: ${sanitizedFilename}`)

          const path = await import("path")
          const filePath = path.join(process.cwd(), sanitizedFilename)
          console.log(`[Download] Full path: ${filePath}`)
          console.log(`[Download] CWD: ${process.cwd()}`)

          // 检查文件是否存在
          try {
            const fs = await import("fs")
            const exists = fs.existsSync(filePath)
            console.log(`[Download] File exists: ${exists}`)

            if (!exists) {
              console.error(`[Download] File not found: ${filePath}`)
              return new Response("File not found", { status: 404 })
            }

            const file = Bun.file(filePath)
            const size = file.size

            const ext = sanitizedFilename.split('.').pop()?.toLowerCase()
            const mimeTypes: Record<string, string> = {
              txt: 'text/plain',
              md: 'text/markdown',
              json: 'application/json',
              js: 'application/javascript',
              ts: 'application/typescript',
              html: 'text/html',
              css: 'text/css',
              py: 'text/x-python',
            }
            const contentType = mimeTypes[ext || ''] || 'application/octet-stream'

            console.log(`[Download] Serving file: ${sanitizedFilename}, size: ${size}`)
            // 对中文文件名进行编码，以支持Content-Disposition头
            const encodedFileName = encodeURIComponent(sanitizedFilename)
            return new Response(file, {
              headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename*=UTF-8''${encodedFileName}`,
              }
            })
          } catch (error) {
            console.error(`[Download] Error serving file: ${filePath}`, error)
            return new Response("File not found", { status: 404 })
          }
        }

        // 健康检查端点
        if (url.pathname === "/health") {
          return new Response(
            JSON.stringify({
              status: "ok",
              uptime: process.uptime(),
              timestamp: new Date().toISOString(),
              connections: this.getTotalConnections(),
              rooms: this.rooms.size,
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        // 服务器状态端点
        if (url.pathname === "/status") {
          return new Response(
            JSON.stringify({
              version: "1.0.0",
              connections: this.getTotalConnections(),
              rooms: Array.from(this.rooms.entries()).map(([id, room]) => ({
                sessionId: id,
                participants: room.participants.size,
                messages: room.messages.length,
              })),
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        // 日报系统API路由
        if (url.pathname.startsWith("/api/daily-report")) {
          console.log(`[DailyReportAPI] Request: ${url.pathname}`)
          if (this.dailyReportAPIHandler) {
            console.log(`[DailyReportAPI] Handler initialized, processing...`)
            const response = await this.dailyReportAPIHandler.handleRequest(req, url)
            console.log(`[DailyReportAPI] Response: ${response.status}`)
            return response
          } else {
            console.log(`[DailyReportAPI] Handler not initialized`)
            return new Response(
              JSON.stringify({ error: "Daily Report System not initialized" }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            )
          }
        }

        // 获取 token 从 URL 参数
        const token = url.searchParams.get("token")
        const sessionId = url.searchParams.get("session") || "default"
        const userName = url.searchParams.get("name") || "Anonymous"
        const userRole = (url.searchParams.get("role") as UserRole) || "guest"
        const passwordQuestion = url.searchParams.get("pwd_question") || undefined
        const passwordAnswer = url.searchParams.get("pwd_answer") || undefined
        const rolePassword = url.searchParams.get("role_password") || undefined

        // 强制输出日志
        console.error(`[DEBUG] Connection attempt: session=${sessionId}, role=${userRole}, pwdQ=${passwordQuestion}, pwdA=${passwordAnswer}`)
        console.error(`[DEBUG] Full URL: ${req.url}`)

        // 如果需要认证
        const enableAuth = process.env.ENABLE_SUPABASE_AUTH === "true"
        const allowAnonymous = process.env.ALLOW_ANONYMOUS === "true"

        if (enableAuth && !token && !allowAnonymous) {
          return new Response(
            JSON.stringify({ error: "Authentication required" }),
            { status: 401, headers: { "Content-Type": "application/json" } }
          )
        }

        // 尝试WebSocket升级
        const success = server.upgrade(req, {
          data: {
            sessionId,
            userId: "",
            userName,
            userRole,
            joinedAt: Date.now(),
            lastPing: Date.now(),
            token,
            isAuthenticated: false,
            passwordQuestion,
            passwordAnswer,
            rolePassword,
          } as WebSocketData,
        })

        // 如果升级成功，返回undefined
        if (success) {
          return undefined
        }

        // 如果不是WebSocket请求，提供静态文件服务
        if (url.pathname === "/" || url.pathname === "/index.html") {
          try {
            const file = Bun.file("./public/index.html")
            return new Response(file, {
              headers: { "Content-Type": "text/html; charset=utf-8" }
            })
          } catch (error) {
            return new Response("index.html not found", { status: 404 })
          }
        }

        // 日报系统前端页面
        if (url.pathname === "/daily-report" || url.pathname === "/daily-report.html") {
          try {
            const file = Bun.file("./public/daily-report.html")
            return new Response(file, {
              headers: { "Content-Type": "text/html; charset=utf-8" }
            })
          } catch (error) {
            return new Response("daily-report.html not found", { status: 404 })
          }
        }

        // WebSocket升级失败且不是静态文件请求
        return new Response("WebSocket upgrade failed", { status: 400 })
      },
      websocket: {
        open: (ws) => this.handleOpen(ws),
        message: (ws, message) => this.handleMessage(ws, message),
        close: (ws, code, reason) => this.handleClose(ws, code, reason),
        ping: (ws) => this.handlePing(ws),
        pong: (ws) => this.handlePong(ws),
        perMessageDeflate: this.config.compression,
      },
    })

    // 启动心跳检测
    this.startHeartbeat()

    const protocol = useHTTPS ? "wss" : "ws"
    const host = this.config.hostname || "0.0.0.0"
    console.log(`[WebSocket] Server started on ${protocol}://${host}:${this.config.port}`)
    console.log(`[WebSocket] Health check: http${useHTTPS ? "s" : ""}://${host}:${this.config.port}/health`)
  }

  stop(): void {
    // 停止心跳
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }

    // 关闭所有连接
    for (const room of this.rooms.values()) {
      for (const ws of room.participants.values()) {
        ws.close(1000, "Server shutting down")
      }
    }
    this.rooms.clear()

    // 停止服务器
    this.server?.stop()
    this.server = null

    console.log("[WebSocket] Server stopped")
  }

  // ============================================================================
  // 事件处理器
  // ============================================================================

  private async handleOpen(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    console.log(`[WebSocket] Connection opened from ${ws.remoteAddress}`)

    // 如果有 token，进行 Supabase 认证
    if (ws.data.token) {
      try {
        const auth = await authenticateWebSocket({
          token: ws.data.token,
          sessionId: ws.data.sessionId,
        })

        if (auth.success && auth.user) {
          ws.data.userId = auth.user.id
          ws.data.userName = auth.user.name
          ws.data.userRole = auth.user.role as UserRole
          ws.data.isAuthenticated = true
          console.log(`[WebSocket] User authenticated: ${auth.user.email} (${auth.user.role})`)
        } else {
          ws.data.isAuthenticated = false
          console.log(`[WebSocket] Authentication failed: ${auth.error}`)
          // 如果不允许匿名，关闭连接
          if (process.env.ALLOW_ANONYMOUS !== "true") {
            this.sendError(ws, "Authentication failed: " + auth.error)
            ws.close(1008, "Authentication failed")
            return
          }
        }
      } catch (error) {
        console.error("[WebSocket] Auth error:", error)
        if (process.env.ALLOW_ANONYMOUS !== "true") {
          this.sendError(ws, "Authentication error")
          ws.close(1008, "Authentication error")
          return
        }
      }
    } else if (process.env.ENABLE_SUPABASE_AUTH === "true" && process.env.ALLOW_ANONYMOUS !== "true") {
      this.sendError(ws, "Authentication required")
      ws.close(1008, "Authentication required")
      return
    }

    // 自动加入房间（使用 URL 参数中的信息）
    await this.autoJoinRoom(ws)
  }

  // 等待密码验证的连接
  private pendingPasswordVerification = new Map<string, ServerWebSocket<WebSocketData>>()

  private async autoJoinRoom(ws: ServerWebSocket<WebSocketData>, passwordAnswer?: string): Promise<void> {
    const { sessionId, userId: wsUserId, userName, userRole, passwordQuestion: wsPwdQuestion, passwordAnswer: wsPwdAnswer, rolePassword } = ws.data

    // 如果没有 userId，生成一个
    const userId = wsUserId || `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    ws.data.userId = userId

    // 优先使用传入的密码答案，否则使用 ws.data 中的
    const providedAnswer = passwordAnswer || wsPwdAnswer

    // 检查角色密码验证（Owner和Admin角色都需要验证）
    // 只要选择Owner或Admin角色，就必须提供正确的角色密码
    if (roleRequiresPassword(userRole)) {
      if (!rolePassword || !verifyRolePassword(userRole, rolePassword)) {
        console.error(`[WebSocket] Role password verification failed for ${userRole}`)
        this.send(ws, {
          type: "error",
          timestamp: new Date().toISOString(),
          payload: {
            message: `${userRole === "owner" ? "Owner" : "Admin"}角色需要输入正确的角色密码`,
            code: "ROLE_PASSWORD_REQUIRED",
          },
        })
        ws.close(1008, "Role password required")
        return
      }
      console.log(`[WebSocket] Role password verified for ${userRole}`)
    }

    // 检查是否需要密码验证
    console.error(`[DEBUG] autoJoinRoom: session=${sessionId}, role=${userRole}, wsPwdQ=${wsPwdQuestion}, wsPwdA=${wsPwdAnswer}, provided=${providedAnswer}`)

    // 获取房间（如果不存在会创建）
    let room = this.rooms.get(sessionId)
    let existingQuestion: string | null = null
    let existingAnswer: string | null = null

    // 优先从数据库获取密码
    if (this.enableDatabase && this.db) {
      try {
        existingQuestion = await this.db.getSessionPasswordQuestion(sessionId)
        console.log(`[WebSocket] DB Password question for ${sessionId}:`, existingQuestion)
      } catch (error) {
        console.error("[WebSocket] Error getting password from DB:", error)
      }
    }

    // 如果没有数据库密码，检查内存中的密码
    if (!existingQuestion && room) {
      existingQuestion = room.passwordQuestion || null
      existingAnswer = room.passwordAnswer || null
      console.log(`[WebSocket] Memory Password for ${sessionId}:`, existingQuestion)
    }

    // 如果是 Owner 且正在设置新密码，使用新密码（覆盖旧密码）
    if (userRole === "owner" && wsPwdQuestion && wsPwdAnswer) {
      existingQuestion = wsPwdQuestion
      existingAnswer = wsPwdAnswer
      console.log(`[WebSocket] Owner setting new password for ${sessionId}:`, existingQuestion)
    }

    // 执行密码验证
    // 如果房间不存在且 Owner/Admin 正在设置密码，允许直接创建（在前面已经验证过角色密码）
    const isCreatingWithPassword = (userRole === "owner" || userRole === "admin") && wsPwdQuestion && wsPwdAnswer

    if (existingQuestion && !isCreatingWithPassword) {
      if (!providedAnswer) {
        // 需要密码但没有提供，发送密码问题
        this.send(ws, {
          type: "password.required",
          timestamp: new Date().toISOString(),
          payload: {
            question: existingQuestion,
            sessionId,
          },
        })
        // 标记为等待密码验证
        this.pendingPasswordVerification.set(userId, ws)
        return
      }

      // 验证密码答案（Owner/Admin 创建新带密码房间时跳过验证，因为前面已验证角色密码）
      let isValid = isCreatingWithPassword
      if (!isCreatingWithPassword) {
        if (this.enableDatabase && this.db) {
          isValid = await this.db.verifySessionPassword(sessionId, providedAnswer)
        } else if (room && room.passwordAnswer) {
          isValid = room.passwordAnswer.toLowerCase() === providedAnswer.toLowerCase()
        }
      }

      if (!isValid) {
        this.send(ws, {
          type: "password.incorrect",
          timestamp: new Date().toISOString(),
          payload: {
            message: "密码答案不正确",
          },
        })
        // 重新发送问题
        this.send(ws, {
          type: "password.required",
          timestamp: new Date().toISOString(),
          payload: {
            question: existingQuestion,
            sessionId,
          },
        })
        return
      }
      // 密码正确，继续加入流程
      this.pendingPasswordVerification.delete(userId)
    }

    // 获取或创建房间（注意：room已在第977行声明）
    if (!room) {
      room = {
        sessionId,
        participants: new Map(),
        messages: [],
        createdAt: Date.now(),
      }
      this.rooms.set(sessionId, room)
    }

    // 如果是 Owner 或 Admin 且提供了密码，保存到内存
    if ((userRole === "owner" || userRole === "admin") && wsPwdQuestion && wsPwdAnswer) {
      room.passwordQuestion = wsPwdQuestion
      room.passwordAnswer = wsPwdAnswer
      console.log(`[WebSocket] Saved password to memory for ${sessionId}`)
    }

    // 检查是否已存在（重复连接）
    const existingWs = room.participants.get(userId)
    if (existingWs) {
      existingWs.close(1000, "New connection established")
      room.participants.delete(userId)
    }

    // 添加到房间
    room.participants.set(userId, ws)

    // 保存到数据库
    if (this.enableDatabase && this.db) {
      try {
        // 如果是 Owner 或 Admin 且提供了密码问题和答案，在创建 session 时设置密码
        if ((userRole === "owner" || userRole === "admin") && wsPwdQuestion && wsPwdAnswer) {
          await this.db.createSession(sessionId, `Session ${sessionId}`, userId, wsPwdQuestion, wsPwdAnswer)
          console.log(`[WebSocket] Created/Updated session ${sessionId} with password question: ${wsPwdQuestion}`)
        } else {
          await this.db.createSession(sessionId, `Session ${sessionId}`, userId)
          console.log(`[WebSocket] Created session ${sessionId} without password`)
        }
        await this.db.saveParticipant(sessionId, {
          id: userId,
          name: userName,
          role: userRole,
          status: "online",
          joinedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        })
      } catch (error) {
        console.error("[WebSocket] Database save participant error:", error)
      }
    }

    // 发送连接成功消息
    this.send(ws, {
      type: "connection.established",
      timestamp: new Date().toISOString(),
      payload: {
        sessionId,
        userId,
        participants: this.getParticipantsInRoom(room),
      },
    })

    // 广播用户加入
    this.broadcastToRoom(
      room,
      {
        type: "user.joined",
        timestamp: new Date().toISOString(),
        senderId: userId,
        payload: {
          userId,
          userName,
          userRole,
          joinedAt: new Date().toISOString(),
        },
      },
      [userId]
    )

    console.log(`[WebSocket] User ${userName} (${userId}) joined session ${sessionId}`)
  }

  private handleMessage(ws: ServerWebSocket<WebSocketData>, message: string | Buffer): void {
    try {
      const data = JSON.parse(message.toString())
      const result = ClientMessageSchema.safeParse(data)

      if (!result.success) {
        console.error(`[WebSocket] Message validation failed:`, result.error.errors)
        console.error(`[WebSocket] Received data:`, JSON.stringify(data))
        this.sendError(ws, "Invalid message format", result.error.errors)
        return
      }

      this.processClientMessage(ws, result.data)
    } catch (error) {
      this.sendError(ws, "Failed to parse message", error)
    }
  }

  private async handleClose(ws: ServerWebSocket<WebSocketData>, code: number, reason: string): Promise<void> {
    console.log(`[WebSocket] Connection closed: ${code} - ${reason}`)
    await this.handleUserLeave(ws)
  }

  private handlePing(ws: ServerWebSocket<WebSocketData>): void {
    ws.data.lastPing = Date.now()
  }

  private handlePong(ws: ServerWebSocket<WebSocketData>): void {
    ws.data.lastPing = Date.now()
  }

  // ============================================================================
  // 消息处理
  // ============================================================================

  private async processClientMessage(ws: ServerWebSocket<WebSocketData>, message: ClientMessage): Promise<void> {
    console.log(`[WebSocket] processClientMessage: type=${message.type}`)
    switch (message.type) {
      case "connect":
        await this.handleConnect(ws, message)
        break
      case "ping":
        this.handleClientPing(ws, message.timestamp)
        break
      case "message":
        await this.handleChatMessage(ws, message.message)
        break
      case "typing":
        this.handleTyping(ws, message.isTyping)
        break
      case "status":
        await this.handleStatusChange(ws, message.status)
        break
      case "edit_message":
        await this.handleEditMessage(ws, message.messageId, message.content)
        break
      case "delete_message":
        await this.handleDeleteMessage(ws, message.messageId)
        break
      case "reaction":
        this.handleReaction(ws, message.messageId, message.emoji, message.action)
        break
      case "invite":
        await this.handleInvite(ws, message)
        break
      case "kick":
        await this.handleKick(ws, message.userId, message.reason)
        break
      case "change_role":
        await this.handleChangeRole(ws, message.userId, message.newRole)
        break
      case "share_file":
        await this.handleShareFile(ws, message)
        break
      case "transcribe_voice":
        await this.handleTranscribeRequest(ws, message.messageId, message.voiceUrl)
        break
      case "get_history":
        await this.handleGetHistory(ws, message.before, message.limit)
        break
      case "verify_password":
        await this.handlePasswordVerification(ws, message.answer)
        break
      case "summarize":
        await this.handleSummarize(ws)
        break
      case "clear_ai_memory":
        await this.handleClearAIMemory(ws)
        break
      case "set_password":
        await this.handleSetPassword(ws, message.question, message.answer)
        break
      // 语音聊天消息处理
      case "voice_join":
        await this.handleVoiceJoin(ws)
        break
      case "voice_leave":
        await this.handleVoiceLeave(ws)
        break
      case "voice_start_speaking":
        await this.handleVoiceStartSpeaking(ws)
        break
      case "voice_stop_speaking":
        await this.handleVoiceStopSpeaking(ws)
        break
      case "voice_audio_data":
        await this.handleVoiceAudioData(ws, message.audioData)
        break
      case "voice_continuous_audio":
        await this.handleVoiceContinuousAudio(ws, message.audioData, message.isSpeech)
        break
      case "voice_ai_analyze":
        await this.handleVoiceAIAnalyze(ws)
        break
      case "voice_get_status":
        await this.handleVoiceGetStatus(ws)
        break
      case "voice_transcript":
        await this.handleVoiceTranscript(ws, message.transcript)
        break
      case "refresh_download_url":
        await this.handleRefreshDownloadUrl(ws, message.ossKey, message.requestId)
        break
      case "delete_file":
        await this.handleDeleteFile(ws, message.fileId)
        break
      case "rename_file":
        await this.handleRenameFile(ws, message.fileId, message.newFileName)
        break
      case "list_session_files":
        await this.handleListSessionFiles(ws)
        break
    }
  }

  // ============================================================================
  // 连接处理
  // ============================================================================

  private async handleConnect(
    ws: ServerWebSocket<WebSocketData>,
    data: Extract<ClientMessage, { type: "connect" }>
  ): Promise<void> {
    const { sessionId, userId, userName, userRole } = data

    // 验证会话是否存在
    if (this.storage) {
      const session = await this.storage.loadSession(sessionId)
      if (!session) {
        this.sendError(ws, "Session not found")
        ws.close(1008, "Session not found")
        return
      }

      // 验证用户是否在参与者列表中（如果不是所有者创建会话）
      const existingParticipant = session.config.participants.find((p) => p.id === userId)
      if (!existingParticipant && userRole !== "owner") {
        // 检查是否允许访客
        if (!session.config.settings.allowGuests) {
          this.sendError(ws, "Not authorized to join this session")
          ws.close(1008, "Not authorized")
          return
        }
      }
    }

    // 更新 WebSocket 数据
    ws.data.sessionId = sessionId
    ws.data.userId = userId
    ws.data.userName = userName
    ws.data.userRole = userRole
    ws.data.joinedAt = Date.now()
    ws.data.lastPing = Date.now()

    // 获取或创建房间
    let room = this.rooms.get(sessionId)
    if (!room) {
      room = {
        sessionId,
        participants: new Map(),
        messages: [],
        createdAt: Date.now(),
      }
      this.rooms.set(sessionId, room)
    }

    // 检查是否已存在（重复连接）
    const existingWs = room.participants.get(userId)
    if (existingWs) {
      // 关闭旧连接
      existingWs.close(1000, "New connection established")
      room.participants.delete(userId)
    }

    // 添加到房间
    room.participants.set(userId, ws)

    // 保存到数据库
    if (this.enableDatabase && this.db) {
      try {
        await this.db.createSession(sessionId, `Session ${sessionId}`, userId)
        await this.db.saveParticipant(sessionId, {
          id: userId,
          name: userName,
          role: userRole,
          status: "online",
          joinedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        })
      } catch (error) {
        console.error("[WebSocket] Database save participant error:", error)
      }
    }

    // 更新存储中的参与者状态
    if (this.storage) {
      await this.storage.updateParticipant(sessionId, userId, {
        status: "online",
        lastSeen: new Date().toISOString(),
      })
    }

    // 发送连接成功消息
    this.send(ws, {
      type: "connection.established",
      timestamp: new Date().toISOString(),
      payload: {
        sessionId,
        userId,
        participants: this.getParticipantsInRoom(room),
      },
    })

    // 广播用户加入
    this.broadcastToRoom(
      room,
      {
        type: "user.joined",
        timestamp: new Date().toISOString(),
        senderId: userId,
        payload: {
          userId,
          userName,
          userRole,
          joinedAt: new Date().toISOString(),
        },
      },
      [userId] // 排除自己
    )

    // 触发回调
    const participant: Participant = {
      id: userId,
      name: userName,
      role: userRole,
      status: "online",
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    }
    this.onUserJoined?.(sessionId, participant)

    console.log(`[WebSocket] User ${userName} (${userId}) joined session ${sessionId}`)
  }

  private async handleUserLeave(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return

    // 清理语音聊天状态
    if (this.enableVoiceChat && this.voiceChatService) {
      this.voiceChatService.leaveVoiceChat(sessionId, userId)
    }

    const room = this.rooms.get(sessionId)
    if (!room) return

    // 从房间移除
    room.participants.delete(userId)

    // 更新数据库中的状态
    if (this.enableDatabase && this.db) {
      try {
        await this.db.updateParticipantStatus(sessionId, userId, "offline", new Date().toISOString())
      } catch (error) {
        console.error("[WebSocket] Database update participant error:", error)
      }
    }

    // 更新存储中的状态
    if (this.storage) {
      this.storage.updateParticipant(sessionId, userId, {
        status: "offline",
        lastSeen: new Date().toISOString(),
      })
    }

    // 广播用户离开
    this.broadcastToRoom(room, {
      type: "user.left",
      timestamp: new Date().toISOString(),
      senderId: userId,
      payload: {
        userId,
        userName,
        leftAt: new Date().toISOString(),
      },
    })

    // 触发回调
    this.onUserLeft?.(sessionId, userId)

    // 如果房间空了，清理房间
    if (room.participants.size === 0) {
      this.rooms.delete(sessionId)
    }

    console.log(`[WebSocket] User ${userName} (${userId}) left session ${sessionId}`)
  }

  // ============================================================================
  // 聊天消息处理
  // ============================================================================

  private async handleChatMessage(
    ws: ServerWebSocket<WebSocketData>,
    messageData: Extract<ClientMessage, { type: "message" }>["message"]
  ): Promise<void> {
    const { sessionId, userId, userName, userRole } = ws.data
    const room = this.rooms.get(sessionId)
    if (!room) return

    // 检查权限
    if (!hasPermission(userRole, "message:send")) {
      this.sendError(ws, "Permission denied: cannot send messages")
      return
    }

    // 创建消息对象
    const message: ChatMessage = {
      id: messageData.id,
      sessionId,
      senderId: userId,
      senderName: userName,
      senderRole: userRole,
      type: messageData.type,
      content: messageData.content,
      mentions: messageData.mentions,
      mentionsAI: messageData.mentionsAI,
      replyTo: messageData.replyTo,
      timestamp: new Date().toISOString(),
    }

    // 添加特定类型数据
    if (messageData.voiceData) message.voiceData = messageData.voiceData
    if (messageData.imageData) message.imageData = messageData.imageData
    if (messageData.fileData) message.fileData = messageData.fileData
    if (messageData.codeData) message.codeData = messageData.codeData

    // 处理文件上传到OSS
    if (this.enableOSS && this.oss && messageData.fileData) {
      try {
        const fileData = messageData.fileData
        console.log(`[WebSocket] Processing file for OSS upload: ${fileData.fileName}, size: ${fileData.fileSize}`)

        const mimeType = fileData.mimeType || detectMimeType(fileData.fileName || "")
        console.log(`[WebSocket] Detected MIME type: ${mimeType}`)

        const ossKey = this.oss.generateFileKey(sessionId, fileData.fileName || "file", userId)
        console.log(`[WebSocket] Generated OSS key: ${ossKey}`)

        // Generate upload URL for client-side upload
        console.log(`[WebSocket] Generating upload URL...`)
        const { url } = await this.oss.generateUploadUrl(ossKey, mimeType, 3600)
        console.log(`[WebSocket] Generated upload URL: ${url.substring(0, 100)}...`)

        // Update file data with OSS info
        message.fileData = {
          ...fileData,
          ossUrl: url,
          ossKey: ossKey,
        }
        console.log(`[WebSocket] Updated message with OSS URL`)

        // Save file metadata to database
        if (this.enableDatabase && this.db) {
          console.log(`[WebSocket] Saving file metadata to database...`)
          await this.db.saveFileMetadata({
            id: `file-${Date.now()}`,
            sessionId,
            messageId: message.id,
            fileName: fileData.fileName || "unnamed",
            fileSize: fileData.fileSize || 0,
            mimeType: mimeType,
            ossUrl: url,
            ossKey: ossKey,
            uploadedBy: userId,
          })
          console.log(`[WebSocket] File metadata saved to database`)
        }
      } catch (error) {
        console.error("[WebSocket] OSS upload error:", error)
      }
    } else {
      if (messageData.fileData) {
        console.log(`[WebSocket] File data present but OSS not enabled: enableOSS=${this.enableOSS}, oss=${!!this.oss}`)
      }
    }

    // 保存到数据库
    if (this.enableDatabase && this.db) {
      try {
        await this.db.saveMessage(sessionId, message)
      } catch (error) {
        console.error("[WebSocket] Database save error:", error)
      }
    }

    // 保存到本地存储（如果配置了）
    if (this.storage) {
      await this.storage.addMessage(sessionId, message)
    }

    // 添加到房间消息缓存
    room.messages.push(message)

    // 限制消息缓存数量
    if (room.messages.length > 1000) {
      room.messages = room.messages.slice(-1000)
    }

    // 广播消息
    this.broadcastToRoom(room, {
      type: "message.new",
      timestamp: message.timestamp,
      senderId: userId,
      payload: message,
    })

    // 触发消息回调
    const sender: Participant = {
      id: userId,
      name: userName,
      role: userRole,
      status: "online",
      joinedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
    }
    this.onMessage?.(sessionId, message, sender)

    // 检查是否触发了 AI
    if (message.mentionsAI) {
      const context = await this.getMessageContext(sessionId, 10)
      this.onAITrigger?.(sessionId, [...context, message])
    }
  }

  // ============================================================================
  // 其他消息处理
  // ============================================================================

  private handleTyping(ws: ServerWebSocket<WebSocketData>, isTyping: boolean): void {
    const { sessionId, userId, userName } = ws.data
    const room = this.rooms.get(sessionId)
    if (!room) return

    this.broadcastToRoom(
      room,
      {
        type: isTyping ? "typing.start" : "typing.stop",
        timestamp: new Date().toISOString(),
        senderId: userId,
        payload: { userId, userName },
      },
      [userId]
    )
  }

  private async handleStatusChange(
    ws: ServerWebSocket<WebSocketData>,
    status: "online" | "away" | "offline"
  ): Promise<void> {
    const { sessionId, userId } = ws.data
    const room = this.rooms.get(sessionId)
    if (!room) return

    // 更新存储
    if (this.storage) {
      await this.storage.updateParticipant(sessionId, userId, { status })
    }

    // 广播状态变更
    this.broadcastToRoom(room, {
      type: "user.status_changed",
      timestamp: new Date().toISOString(),
      senderId: userId,
      payload: { userId, status },
    })
  }

  private async handleEditMessage(
    ws: ServerWebSocket<WebSocketData>,
    messageId: string,
    content: string
  ): Promise<void> {
    const { sessionId, userId, userRole } = ws.data
    const room = this.rooms.get(sessionId)
    if (!room) return

    // 查找消息
    const message = room.messages.find((m) => m.id === messageId)
    if (!message) {
      this.sendError(ws, "Message not found")
      return
    }

    // 检查权限
    const isOwner = message.senderId === userId
    const canEditAny = hasPermission(userRole, "message:edit_any")
    if (!isOwner && !canEditAny) {
      this.sendError(ws, "Permission denied: cannot edit this message")
      return
    }

    // 更新消息
    const updates: Partial<ChatMessage> = { content }

    if (this.storage) {
      await this.storage.updateMessage(sessionId, messageId, updates)
    }

    // 更新缓存
    Object.assign(message, updates)

    // 广播更新
    this.broadcastToRoom(room, {
      type: "message.updated",
      timestamp: new Date().toISOString(),
      senderId: userId,
      payload: { messageId, content, editedAt: new Date().toISOString() },
    })
  }

  private async handleDeleteMessage(ws: ServerWebSocket<WebSocketData>, messageId: string): Promise<void> {
    const { sessionId, userId, userRole } = ws.data
    const room = this.rooms.get(sessionId)
    if (!room) return

    // 查找消息
    const message = room.messages.find((m) => m.id === messageId)
    if (!message) {
      this.sendError(ws, "Message not found")
      return
    }

    // 检查权限
    const isOwner = message.senderId === userId
    const canDeleteAny = hasPermission(userRole, "message:delete_any")
    if (!isOwner && !canDeleteAny) {
      this.sendError(ws, "Permission denied: cannot delete this message")
      return
    }

    // 删除消息
    if (this.storage) {
      await this.storage.deleteMessage(sessionId, messageId)
    }

    // 更新缓存
    room.messages = room.messages.filter((m) => m.id !== messageId)

    // 广播删除
    this.broadcastToRoom(room, {
      type: "message.deleted",
      timestamp: new Date().toISOString(),
      senderId: userId,
      payload: { messageId },
    })
  }

  private handleReaction(
    ws: ServerWebSocket<WebSocketData>,
    messageId: string,
    emoji: string,
    action: "add" | "remove"
  ): void {
    const { sessionId, userId, userName } = ws.data
    const room = this.rooms.get(sessionId)
    if (!room) return

    this.broadcastToRoom(room, {
      type: "message.reaction",
      timestamp: new Date().toISOString(),
      senderId: userId,
      payload: {
        messageId,
        emoji,
        action,
        userId,
        userName,
      },
    })
  }

  private async handleInvite(
    ws: ServerWebSocket<WebSocketData>,
    data: Extract<ClientMessage, { type: "invite" }>
  ): Promise<void> {
    const { sessionId, userId, userRole } = ws.data

    // 检查权限
    if (!hasPermission(userRole, "user:invite")) {
      this.sendError(ws, "Permission denied: cannot invite users")
      return
    }

    const room = this.rooms.get(sessionId)
    if (!room) return

    // 添加参与者到存储
    if (this.storage) {
      await this.storage.addParticipant(sessionId, {
        id: data.userId,
        name: data.userName,
        role: data.role,
        status: "offline",
        joinedAt: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
      })
    }

    // 广播邀请
    this.broadcastToRoom(room, {
      type: "user.invited",
      timestamp: new Date().toISOString(),
      senderId: userId,
      payload: {
        userId: data.userId,
        userName: data.userName,
        role: data.role,
        invitedBy: userId,
      },
    })
  }

  private async handleKick(
    ws: ServerWebSocket<WebSocketData>,
    targetUserId: string,
    reason?: string
  ): Promise<void> {
    const { sessionId, userId, userRole } = ws.data

    // 检查权限
    if (!hasPermission(userRole, "user:kick")) {
      this.sendError(ws, "Permission denied: cannot kick users")
      return
    }

    const room = this.rooms.get(sessionId)
    if (!room) return

    // 获取目标用户的连接
    const targetWs = room.participants.get(targetUserId)
    if (targetWs) {
      // 断开连接
      targetWs.close(1008, reason || "Kicked by moderator")
    }

    // 从存储中移除
    if (this.storage) {
      await this.storage.removeParticipant(sessionId, targetUserId)
    }

    // 广播踢出
    this.broadcastToRoom(room, {
      type: "user.kicked",
      timestamp: new Date().toISOString(),
      senderId: userId,
      payload: {
        userId: targetUserId,
        kickedBy: userId,
        reason,
      },
    })
  }

  private async handleChangeRole(
    ws: ServerWebSocket<WebSocketData>,
    targetUserId: string,
    newRole: UserRole
  ): Promise<void> {
    const { sessionId, userId, userRole } = ws.data

    // 检查权限
    if (!hasPermission(userRole, "user:change_role")) {
      this.sendError(ws, "Permission denied: cannot change roles")
      return
    }

    const room = this.rooms.get(sessionId)
    if (!room) return

    // 更新存储
    if (this.storage) {
      await this.storage.updateParticipant(sessionId, targetUserId, { role: newRole })
    }

    // 广播角色变更
    this.broadcastToRoom(room, {
      type: "user.role_changed",
      timestamp: new Date().toISOString(),
      senderId: userId,
      payload: {
        userId: targetUserId,
        newRole,
        changedBy: userId,
      },
    })
  }

  private async handleShareFile(
    ws: ServerWebSocket<WebSocketData>,
    data: Extract<ClientMessage, { type: "share_file" }>
  ): Promise<void> {
    const { sessionId, userId, userName } = ws.data
    const room = this.rooms.get(sessionId)
    if (!room) return

    // 广播文件分享
    this.broadcastToRoom(room, {
      type: "file.shared",
      timestamp: new Date().toISOString(),
      senderId: userId,
      payload: {
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        content: data.content,
        sharedBy: userId,
        sharedByName: userName,
      },
    })
  }

  private async handleTranscribeRequest(
    ws: ServerWebSocket<WebSocketData>,
    messageId: string,
    voiceUrl: string
  ): Promise<void> {
    const { sessionId, userId } = ws.data

    // 发送转录请求到 AI 服务（由上层处理）
    this.send(ws, {
      type: "voice.transcribing",
      timestamp: new Date().toISOString(),
      payload: { messageId, voiceUrl },
    })

    // TODO: 调用转录服务
    // 转录完成后广播结果
  }

  private async handleGetHistory(
    ws: ServerWebSocket<WebSocketData>,
    before?: string,
    limit: number = 50
  ): Promise<void> {
    const { sessionId } = ws.data
    console.log(`[WebSocket] handleGetHistory called for session ${sessionId}, before=${before}, limit=${limit}`)

    let messages: ChatMessage[] = []

    // 优先从数据库获取历史记录
    if (this.enableDatabase && this.db) {
      try {
        console.log(`[WebSocket] Fetching from database...`)
        messages = await this.db.getMessages(sessionId, limit, before)
        console.log(`[WebSocket] Database returned ${messages.length} messages`)
        // 数据库返回的是倒序，需要反转
        messages = messages.reverse()
      } catch (error) {
        console.error("[WebSocket] Database getMessages error:", error)
      }
    } else {
      console.log(`[WebSocket] Database not enabled, enableDatabase=${this.enableDatabase}, db=${!!this.db}`)
    }

    // 如果数据库没有数据，尝试从内存存储获取
    if (messages.length === 0 && this.storage) {
      console.log(`[WebSocket] Fetching from storage...`)
      messages = await this.storage.getMessages(sessionId, {
        before,
        limit,
      })
      console.log(`[WebSocket] Storage returned ${messages.length} messages`)
    }

    // 如果还是没有，从房间内存获取
    if (messages.length === 0) {
      const room = this.rooms.get(sessionId)
      if (room) {
        messages = room.messages.slice(-limit)
        console.log(`[WebSocket] Room memory returned ${messages.length} messages`)
      } else {
        console.log(`[WebSocket] No room found for session ${sessionId}`)
      }
    }

    console.log(`[WebSocket] Sending history.loaded with ${messages.length} messages`)
    this.send(ws, {
      type: "history.loaded",
      timestamp: new Date().toISOString(),
      payload: { messages },
    })
  }

  /**
   * 处理总结聊天请求
   */
  private async handleSummarize(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    const { sessionId, userId, userName } = ws.data

    if (!this.summaryManager) {
      this.sendError(ws, "Summary manager not available")
      return
    }

    try {
      // 发送开始总结的通知
      this.send(ws, {
        type: "summary.generating",
        timestamp: new Date().toISOString(),
        payload: { message: "正在生成对话总结..." },
      })

      // 获取所有消息
      let allMessages: ChatMessage[] = []
      if (this.enableDatabase && this.db) {
        allMessages = await this.db.getMessages(sessionId, 1000)
      } else {
        const room = this.rooms.get(sessionId)
        if (room) {
          allMessages = room.messages
        }
      }

      if (allMessages.length === 0) {
        this.send(ws, {
          type: "summary.error",
          timestamp: new Date().toISOString(),
          payload: { error: "没有消息可以总结" },
        })
        return
      }

      // 获取现有总结（如果有）
      const existingSummary = await this.summaryManager.getSummary(sessionId)

      // 确定需要总结的消息
      let messagesToSummarize: ChatMessage[]
      if (existingSummary) {
        // 找到上次总结之后的新消息
        const lastIndex = allMessages.findIndex(m => m.id === existingSummary.lastMessageId)
        if (lastIndex >= 0) {
          messagesToSummarize = allMessages.slice(lastIndex + 1)
        } else {
          messagesToSummarize = allMessages
        }
      } else {
        messagesToSummarize = allMessages
      }

      if (messagesToSummarize.length === 0) {
        this.send(ws, {
          type: "summary.error",
          timestamp: new Date().toISOString(),
          payload: { error: "没有新消息需要总结" },
        })
        return
      }

      // 生成新总结
      const newSummary = await this.summaryManager.generateSummary(
        sessionId,
        messagesToSummarize,
        existingSummary?.summary
      )

      if (newSummary) {
        // 广播总结完成消息
        const room = this.rooms.get(sessionId)
        if (room) {
          this.broadcastToRoom(room, {
            type: "summary.completed",
            timestamp: new Date().toISOString(),
            senderId: userId,
            senderName: userName,
            payload: {
              summary: newSummary.summary,
              messageCount: newSummary.messageCount,
              generatedAt: newSummary.createdAt,
            },
          })
        }

        console.log(`[Summary] Generated for session ${sessionId}: ${newSummary.messageCount} messages`)
      }
    } catch (error) {
      console.error("[Summary] Error:", error)
      this.send(ws, {
        type: "summary.error",
        timestamp: new Date().toISOString(),
        payload: { error: "生成总结失败: " + (error instanceof Error ? error.message : "未知错误") },
      })
    }
  }

  /**
   * 处理清空AI记忆请求
   */
  private async handleClearAIMemory(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    const { sessionId, userId, userName } = ws.data

    if (!this.summaryManager) {
      this.sendError(ws, "Summary manager not available")
      return
    }

    try {
      // 1. 清空对话总结
      await this.summaryManager.clearSummary(sessionId)

      // 2. 清空数据库中的消息记录
      if (this.enableDatabase && this.db) {
        await this.db.clearSessionMessages(sessionId)
        console.log(`[Database] Messages cleared for session ${sessionId}`)
      }

      // 3. 清空房间内存缓存中的消息
      const room = this.rooms.get(sessionId)
      if (room) {
        // 记录清空前消息数量
        const clearedCount = room.messages.length

        // 添加系统消息记录清空操作（作为分界点）
        const clearNoticeMessage: ChatMessage = {
          id: `system-clear-${Date.now()}`,
          sessionId,
          senderId: 'system',
          senderName: 'System',
          senderRole: 'system',
          type: 'text',
          content: `🧹 AI记忆已被 ${userName} 清空。清空前的 ${clearedCount} 条消息将不再用于AI对话和聊天记录保存。`,
          mentions: [],
          mentionsAI: false,
          timestamp: new Date().toISOString(),
        }

        // 清空消息数组，只保留清空通知
        room.messages = [clearNoticeMessage]

        // 保存清空通知到数据库
        if (this.enableDatabase && this.db) {
          await this.db.saveMessage(sessionId, clearNoticeMessage)
        }

        // 广播记忆已清空
        this.broadcastToRoom(room, {
          type: "ai.memory_cleared",
          timestamp: new Date().toISOString(),
          senderId: userId,
          senderName: userName,
          payload: {
            message: `AI记忆已清空，之前的 ${clearedCount} 条对话记录已删除`,
            clearedBy: userName,
            clearedCount,
            clearedAt: new Date().toISOString(),
          },
        })

        console.log(`[Summary] AI memory cleared for session ${sessionId} by ${userName}, ${clearedCount} messages removed`)
      }
    } catch (error) {
      console.error("[Summary] Clear memory error:", error)
      this.sendError(ws, "清空AI记忆失败")
    }
  }

  /**
   * 处理密码验证
   */
  private async handlePasswordVerification(
    ws: ServerWebSocket<WebSocketData>,
    answer?: string
  ): Promise<void> {
    if (!answer) {
      this.sendError(ws, "请提供密码答案")
      return
    }

    // 重新尝试加入房间，传入密码答案
    await this.autoJoinRoom(ws, answer)
  }

  /**
   * 处理设置密码
   */
  private async handleSetPassword(
    ws: ServerWebSocket<WebSocketData>,
    question?: string,
    answer?: string
  ): Promise<void> {
    const { sessionId, userId, userRole } = ws.data

    // 检查权限（只有 Owner 可以设置密码）
    if (userRole !== "owner") {
      this.sendError(ws, "只有聊天室创建者可以设置密码")
      return
    }

    if (!question || !answer) {
      this.sendError(ws, "请提供密码问题和答案")
      return
    }

    if (this.enableDatabase && this.db) {
      try {
        // 更新数据库中的会话密码
        await this.db.setSessionPassword(sessionId, question, answer)

        this.send(ws, {
          type: "password.set",
          timestamp: new Date().toISOString(),
          payload: {
            message: "密码设置成功",
          },
        })

        console.log(`[WebSocket] Password set for session ${sessionId} by ${userId}`)
      } catch (error) {
        console.error("[WebSocket] Set password error:", error)
        this.sendError(ws, "设置密码失败")
      }
    } else {
      this.sendError(ws, "数据库未启用，无法设置密码")
    }
  }

  private handleClientPing(ws: ServerWebSocket<WebSocketData>, timestamp: number): void {
    ws.data.lastPing = Date.now()
    this.send(ws, {
      type: "connection.pong",
      timestamp: new Date().toISOString(),
      payload: { clientTimestamp: timestamp, serverTimestamp: Date.now() },
    })
  }

  // ============================================================================
  // 心跳机制
  // ============================================================================

  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval ?? 30000
    const timeout = this.config.heartbeatTimeout ?? 60000

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()

      for (const room of this.rooms.values()) {
        for (const [userId, ws] of room.participants.entries()) {
          // 检查超时
          if (now - ws.data.lastPing > timeout) {
            console.log(`[WebSocket] User ${userId} timed out`)
            ws.close(1001, "Heartbeat timeout")
            room.participants.delete(userId)
            continue
          }

          // 发送 ping
          ws.ping()
        }
      }
    }, interval)
  }

  // ============================================================================
  // 辅助方法
  // ============================================================================

  private send(ws: ServerWebSocket<WebSocketData>, event: WebSocketEvent): void {
    if (ws.readyState === 1) { // OPEN
      ws.send(JSON.stringify(event))
    }
  }

  private sendError(ws: ServerWebSocket<WebSocketData>, message: string, details?: unknown): void {
    this.send(ws, {
      type: "error",
      timestamp: new Date().toISOString(),
      payload: { message, details },
    })
  }

  private broadcastToRoom(
    room: Room,
    event: WebSocketEvent,
    excludeUserIds: string[] = []
  ): void {
    const message = JSON.stringify(event)

    for (const [userId, ws] of room.participants.entries()) {
      if (excludeUserIds.includes(userId)) continue
      if (ws.readyState === 1) {
        ws.send(message)
      }
    }
  }

  private getParticipantsInRoom(room: Room): Participant[] {
    const participants: Participant[] = []

    for (const [userId, ws] of room.participants.entries()) {
      participants.push({
        id: userId,
        name: ws.data.userName,
        role: ws.data.userRole,
        status: "online",
        joinedAt: new Date(ws.data.joinedAt).toISOString(),
        lastSeen: new Date(ws.data.lastPing).toISOString(),
      })
    }

    return participants
  }

  private async getMessageContext(sessionId: string, limit: number): Promise<ChatMessage[]> {
    // 优先从数据库获取完整历史
    if (this.enableDatabase && this.db) {
      try {
        const messages = await this.db.getMessages(sessionId, limit)
        return messages.reverse() // 数据库返回的是倒序，需要反转
      } catch (error) {
        console.error("[WebSocket] Database get messages error:", error)
      }
    }

    //  fallback 到本地存储
    if (this.storage) {
      return await this.storage.getMessages(sessionId, { limit })
    }

    // 最后从内存缓存获取
    const room = this.rooms.get(sessionId)
    return room ? room.messages.slice(-limit) : []
  }

  /**
   * 获取会话中的所有文件
   */
  async getSessionFiles(sessionId: string): Promise<any[]> {
    if (this.enableDatabase && this.db) {
      // 从数据库查询文件类型的消息
      const messages = await this.db.getMessages(sessionId, 100)
      return messages
        .filter(m => m.type === 'file' && m.fileData)
        .map(m => ({
          messageId: m.id,
          fileName: m.fileData?.fileName,
          fileSize: m.fileData?.fileSize,
          mimeType: m.fileData?.mimeType,
          ossUrl: m.fileData?.ossUrl,
          uploadedAt: m.timestamp,
          uploadedBy: m.senderName
        }))
    }
    return []
  }

  /**
   * 格式化文件大小
   */
  private formatFileSize(bytes: number): string {
    if (!bytes || bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 发送 AI 响应到房间
   */
  sendAIResponse(sessionId: string, message: ChatMessage): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    // 保存消息
    this.storage?.addMessage(sessionId, message)
    room.messages.push(message)

    // 广播
    this.broadcastToRoom(room, {
      type: "ai.response",
      timestamp: message.timestamp,
      senderId: message.senderId,
      payload: message,
    })
  }

  /**
   * 发送 AI 思考过程
   */
  sendAIThinking(sessionId: string, thinking: string): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    this.broadcastToRoom(room, {
      type: "ai.thinking",
      timestamp: new Date().toISOString(),
      payload: { thinking },
    })
  }

  /**
   * 发送语音转录结果
   */
  sendTranscriptionResult(
    sessionId: string,
    messageId: string,
    transcript: string,
    success: boolean
  ): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    this.broadcastToRoom(room, {
      type: "voice.transcribed",
      timestamp: new Date().toISOString(),
      payload: {
        messageId,
        transcript,
        success,
      },
    })
  }

  /**
   * 获取房间信息
   */
  getRoomInfo(sessionId: string): { participants: number; messages: number; createdAt: number } | null {
    const room = this.rooms.get(sessionId)
    if (!room) return null

    return {
      participants: room.participants.size,
      messages: room.messages.length,
      createdAt: room.createdAt,
    }
  }

  /**
   * 获取所有活跃房间
   */
  getActiveRooms(): Array<{ sessionId: string; participants: number; messages: number }> {
    return Array.from(this.rooms.entries()).map(([sessionId, room]) => ({
      sessionId,
      participants: room.participants.size,
      messages: room.messages.length,
    }))
  }

  /**
   * 获取总连接数
   */
  private getTotalConnections(): number {
    let total = 0
    for (const room of this.rooms.values()) {
      total += room.participants.size
    }
    return total
  }

  // ============================================================================
  // 语音聊天处理
  // ============================================================================

  /**
   * 设置语音聊天处理器
   */
  private setupVoiceChatHandler(): void {
    if (!this.voiceChatService) return

    // 处理转录结果 - 保存为聊天消息
    this.voiceChatService.onTranscript = async (sessionId, transcript) => {
      const room = this.rooms.get(sessionId)
      if (!room) return

      // 创建文本消息保存到聊天记录
      const message: ChatMessage = {
        id: transcript.id,
        sessionId,
        senderId: transcript.userId,
        senderName: transcript.userName,
        senderRole: "member",
        type: "text",
        content: `[语音] ${transcript.text}`,
        mentions: [],
        mentionsAI: false,
        timestamp: new Date(transcript.timestamp).toISOString(),
      }

      // 添加到房间消息列表
      room.messages.push(message)

      // 限制消息数量
      if (room.messages.length > 1000) {
        room.messages = room.messages.slice(-1000)
      }

      // 保存到数据库
      if (this.enableDatabase && this.db) {
        try {
          await this.db.saveMessage(sessionId, message)
          console.log(`[VoiceChat] Transcript saved to DB: ${transcript.userName}: ${transcript.text}`)
        } catch (error) {
          console.error("[VoiceChat] Failed to save transcript to database:", error)
        }
      } else {
        console.log(`[VoiceChat] Transcript saved to memory only (DB disabled): ${transcript.userName}: ${transcript.text}`)
      }
    }

    // 处理 AI 分析请求
    this.voiceChatService.onAIAnalyze = async (sessionId, context) => {
      if (!this.aiService || !this.enableAI) {
        const room = this.rooms.get(sessionId)
        if (room) {
          this.broadcastToRoom(room, {
            type: "voice.ai_analyze",
            status: "error",
            error: "AI 服务未启用",
          })
        }
        return
      }

      try {
        const room = this.rooms.get(sessionId)
        if (!room) return

        // 发送正在分析状态
        this.broadcastToRoom(room, {
          type: "voice.ai_analyze",
          status: "analyzing",
        })

        // 构建系统提示
        const systemPrompt = `你是一个语音聊天分析助手。请分析以下语音聊天的内容，并给出简洁的总结或回答。
语音聊天内容：
${context}

请给出简短的分析或回答（不超过500字）。`

        // 调用 AI 分析
        const response = await this.aiService.generateResponse([], systemPrompt)

        // 发送分析结果
        this.broadcastToRoom(room, {
          type: "voice.ai_analyze",
          status: "completed",
          result: response,
        })

        // 将 AI 回复保存为消息
        const aiMessage: ChatMessage = {
          id: `ai_voice_${Date.now()}`,
          sessionId,
          senderId: "ai-assistant",
          senderName: "AI 助手",
          senderRole: "ai",
          type: "text",
          content: `**语音聊天分析**\n\n${response}`,
          mentions: [],
          mentionsAI: false,
          timestamp: new Date().toISOString(),
        }

        room.messages.push(aiMessage)

        // 广播 AI 消息
        this.broadcastToRoom(room, {
          type: "ai.response",
          timestamp: new Date().toISOString(),
          senderId: "ai-assistant",
          senderName: "AI 助手",
          payload: {
            message: aiMessage,
          },
        })

        // 保存到数据库
        if (this.enableDatabase && this.db) {
          await this.db.saveMessage(sessionId, aiMessage)
        }
      } catch (error) {
        console.error("[VoiceChat] AI analysis failed:", error)
        const room = this.rooms.get(sessionId)
        if (room) {
          this.broadcastToRoom(room, {
            type: "voice.ai_analyze",
            status: "error",
            error: error instanceof Error ? error.message : "分析失败",
          })
        }
      }
    }
  }

  /**
   * 处理语音聊天加入
   */
  private async handleVoiceJoin(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    if (!this.enableVoiceChat || !this.voiceChatService) {
      ws.send(JSON.stringify({
        type: "voice.error",
        error: "voice_chat_disabled",
        message: "语音聊天功能未启用",
      }))
      return
    }

    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return

    const success = await this.voiceChatService.joinVoiceChat(sessionId, userId, userName, ws)

    if (success) {
      ws.send(JSON.stringify({
        type: "voice.join",
        success: true,
        sessionId,
        userId,
      }))
    } else {
      ws.send(JSON.stringify({
        type: "voice.error",
        error: "join_failed",
        message: "加入语音聊天失败",
      }))
    }
  }

  /**
   * 处理语音聊天离开
   */
  private async handleVoiceLeave(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    if (!this.voiceChatService) return

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    this.voiceChatService.leaveVoiceChat(sessionId, userId)

    ws.send(JSON.stringify({
      type: "voice.leave",
      success: true,
      sessionId,
      userId,
    }))
  }

  /**
   * 处理开始发言
   */
  private async handleVoiceStartSpeaking(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    if (!this.voiceChatService) return

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    const success = await this.voiceChatService.startSpeaking(sessionId, userId)

    if (!success) {
      ws.send(JSON.stringify({
        type: "voice.error",
        error: "start_speaking_failed",
        message: "开始发言失败，可能当前有其他人在发言",
      }))
    }
  }

  /**
   * 处理停止发言
   */
  private async handleVoiceStopSpeaking(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    if (!this.voiceChatService) return

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    this.voiceChatService.stopSpeaking(sessionId, userId)
  }

  /**
   * 处理音频数据（旧版按住说话）
   */
  private async handleVoiceAudioData(ws: ServerWebSocket<WebSocketData>, audioData: string): Promise<void> {
    if (!this.voiceChatService) return

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    // 解码 Base64 音频数据
    try {
      const buffer = Buffer.from(audioData, "base64")
      await this.voiceChatService.handleAudioData(sessionId, userId, buffer)
    } catch (error) {
      console.error("[VoiceChat] Failed to process audio data:", error)
    }
  }

  /**
   * 处理连续音频数据（带VAD检测）
   */
  private async handleVoiceContinuousAudio(
    ws: ServerWebSocket<WebSocketData>,
    audioData: string,
    isSpeech: boolean
  ): Promise<void> {
    if (!this.voiceChatService) return

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    // 解码 Base64 音频数据
    try {
      // 空音频数据表示结束
      if (!audioData || audioData === "") {
        console.log(`[VoiceChat] Received finish signal from ${userId}`)
        // 可以在这里处理语音结束逻辑
        return
      }
      const buffer = Buffer.from(audioData, "base64")
      // 调试日志：显示音频数据信息
      const preview = buffer.slice(0, 8).toString('hex')
      console.log(`[VoiceChat] Received audio data: size=${buffer.length}, preview=${preview}, isSpeech=${isSpeech}`)
      await this.voiceChatService.handleContinuousAudio(sessionId, userId, buffer, isSpeech)
    } catch (error) {
      console.error("[VoiceChat] Failed to process continuous audio data:", error)
    }
  }

  /**
   * 处理 AI 分析请求
   */
  private async handleVoiceAIAnalyze(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    if (!this.voiceChatService) return

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    this.voiceChatService.triggerAIAnalysis(sessionId, userId)
  }

  /**
   * 处理获取语音聊天状态
   */
  private async handleVoiceGetStatus(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    if (!this.voiceChatService) {
      ws.send(JSON.stringify({
        type: "voice.error",
        error: "voice_chat_disabled",
        message: "语音聊天功能未启用",
      }))
      return
    }

    const { sessionId } = ws.data
    if (!sessionId) return

    const roomInfo = this.voiceChatService.getRoomInfo(sessionId)

    ws.send(JSON.stringify({
      type: "voice.status",
      enabled: this.enableVoiceChat,
      room: roomInfo,
    }))
  }

  /**
   * 处理来自Web Speech API的转录结果
   * 转发给其他参与者
   */
  private async handleVoiceTranscript(
    ws: ServerWebSocket<WebSocketData>,
    transcript: { text: string; isFinal: boolean; source?: string }
  ): Promise<void> {
    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return

    // 获取房间
    const room = this.rooms.get(sessionId)
    if (!room) return

    // 广播转录结果给所有参与者（包括发送者，让说话者自己也能看到转录结果）
    this.broadcastToRoom(room, {
      type: transcript.isFinal ? "voice.transcript.final" : "voice.transcript",
      transcript: {
        id: `webspeech_${Date.now()}_${userId}`,
        sessionId,
        userId,
        userName: userName || userId,
        text: transcript.text,
        timestamp: Date.now(),
        isFinal: transcript.isFinal,
        source: transcript.source,
      },
      userId,
      userName: userName || userId,
    })
  }

  /**
   * 处理刷新下载URL请求
   */
  private async handleRefreshDownloadUrl(
    ws: ServerWebSocket<WebSocketData>,
    ossKey: string,
    requestId: string
  ): Promise<void> {
    try {
      let downloadUrl: string

      if (this.oss && ossKey.includes("aliyuncs.com")) {
        // 如果是完整的OSS URL，提取key
        const urlMatch = ossKey.match(/aliyuncs\.com\/(.*)/)
        if (urlMatch) {
          ossKey = decodeURIComponent(urlMatch[1])
        }
      }

      if (this.oss) {
        // 生成新的签名URL，有效期24小时
        downloadUrl = await this.oss.getFileUrl(ossKey, 86400)
      } else {
        // 没有OSS时使用本地路径
        const filename = ossKey.split("/").pop() || "file"
        downloadUrl = `/downloads/${encodeURIComponent(filename)}`
      }

      ws.send(JSON.stringify({
        type: "download_url_refreshed",
        requestId,
        downloadUrl,
        ossKey,
      }))
    } catch (error) {
      console.error("[WebSocket] Failed to refresh download URL:", error)
      ws.send(JSON.stringify({
        type: "download_url_error",
        requestId,
        error: error instanceof Error ? error.message : "Failed to refresh URL",
      }))
    }
  }

  // ============================================================================
  // 文件管理（仅 Admin 和 Owner 可用）
  // ============================================================================

  private async handleDeleteFile(ws: ServerWebSocket<WebSocketData>, fileId: string): Promise<void> {
    const { sessionId, userRole, userId } = ws.data

    // 检查权限 - 只有 admin 和 owner 可以删除文件
    if (userRole !== "admin" && userRole !== "owner") {
      this.sendError(ws, "Permission denied: only admin and owner can delete files")
      return
    }

    try {
      // 获取文件信息
      let fileInfo = null
      if (this.enableDatabase && this.db) {
        fileInfo = await this.db.getFileById(fileId)
      }

      if (!fileInfo) {
        this.sendError(ws, "File not found")
        return
      }

      // 验证文件是否属于当前会话
      if (fileInfo.session_id !== sessionId) {
        this.sendError(ws, "File does not belong to this session")
        return
      }

      // 从OSS删除文件
      if (this.enableOSS && this.oss && fileInfo.oss_key) {
        try {
          await this.oss.deleteFile(fileInfo.oss_key)
          console.log(`[WebSocket] File deleted from OSS: ${fileInfo.oss_key}`)
        } catch (ossError) {
          console.error("[WebSocket] Failed to delete from OSS:", ossError)
          // 继续删除数据库记录
        }
      }

      // 从数据库删除记录
      if (this.enableDatabase && this.db) {
        await this.db.deleteFile(fileId)
        console.log(`[WebSocket] File record deleted from DB: ${fileId}`)
      }

      // 广播文件删除消息
      this.broadcastToRoom(
        this.rooms.get(sessionId)!,
        {
          type: "file.deleted",
          timestamp: new Date().toISOString(),
          senderId: userId,
          payload: {
            fileId,
            fileName: fileInfo.file_name,
            deletedBy: userId,
            deletedByRole: userRole,
          },
        }
      )

      log(`[系统] 文件 "${fileInfo.file_name}" 已被 ${userRole} 删除`)
    } catch (error) {
      console.error("[WebSocket] Failed to delete file:", error)
      this.sendError(ws, "Failed to delete file: " + (error instanceof Error ? error.message : "Unknown error"))
    }
  }

  private async handleRenameFile(ws: ServerWebSocket<WebSocketData>, fileId: string, newFileName: string): Promise<void> {
    const { sessionId, userRole, userId } = ws.data

    // 检查权限 - 只有 admin 和 owner 可以重命名文件
    if (userRole !== "admin" && userRole !== "owner") {
      this.sendError(ws, "Permission denied: only admin and owner can rename files")
      return
    }

    try {
      // 获取文件信息
      let fileInfo = null
      if (this.enableDatabase && this.db) {
        fileInfo = await this.db.getFileById(fileId)
      }

      if (!fileInfo) {
        this.sendError(ws, "File not found")
        return
      }

      // 验证文件是否属于当前会话
      if (fileInfo.session_id !== sessionId) {
        this.sendError(ws, "File does not belong to this session")
        return
      }

      const oldFileName = fileInfo.file_name

      // 在OSS中重命名文件（复制+删除）
      let newOssUrl = fileInfo.oss_url
      let newOssKey = fileInfo.oss_key

      if (this.enableOSS && this.oss && fileInfo.oss_key) {
        try {
          // 生成新的OSS key（保持路径，只改文件名）
          const keyParts = fileInfo.oss_key.split('/')
          keyParts[keyParts.length - 1] = newFileName.replace(/[^a-zA-Z0-9.-]/g, '_')
          newOssKey = keyParts.join('/')

          const result = await this.oss.renameFile(fileInfo.oss_key, newOssKey)
          newOssUrl = result.newUrl
          console.log(`[WebSocket] File renamed in OSS: ${fileInfo.oss_key} -> ${newOssKey}`)
        } catch (ossError) {
          console.error("[WebSocket] Failed to rename in OSS:", ossError)
          // 继续更新数据库记录
        }
      }

      // 更新数据库记录
      if (this.enableDatabase && this.db) {
        await this.db.renameFile(fileId, newFileName, newOssUrl, newOssKey)
        console.log(`[WebSocket] File record renamed in DB: ${fileId} -> ${newFileName}`)
      }

      // 广播文件重命名消息
      this.broadcastToRoom(
        this.rooms.get(sessionId)!,
        {
          type: "file.renamed",
          timestamp: new Date().toISOString(),
          senderId: userId,
          payload: {
            fileId,
            oldFileName,
            newFileName,
            newOssUrl,
            renamedBy: userId,
            renamedByRole: userRole,
          },
        }
      )

      log(`[系统] 文件 "${oldFileName}" 已被 ${userRole} 重命名为 "${newFileName}"`)
    } catch (error) {
      console.error("[WebSocket] Failed to rename file:", error)
      this.sendError(ws, "Failed to rename file: " + (error instanceof Error ? error.message : "Unknown error"))
    }
  }

  private async handleListSessionFiles(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    const { sessionId, userRole } = ws.data

    // 检查权限 - 只有 admin 和 owner 可以列出所有文件进行管理
    if (userRole !== "admin" && userRole !== "owner") {
      this.sendError(ws, "Permission denied: only admin and owner can list all files")
      return
    }

    try {
      let files = []
      if (this.enableDatabase && this.db) {
        files = await this.db.getSessionFiles(sessionId)
      }

      ws.send(JSON.stringify({
        type: "session_files_list",
        timestamp: new Date().toISOString(),
        payload: {
          files: files.map(f => ({
            id: f.id,
            fileName: f.file_name,
            fileSize: f.file_size,
            mimeType: f.mime_type,
            uploadedBy: f.uploaded_by,
            uploadedAt: f.uploaded_at,
            ossUrl: f.oss_url,
            ossKey: f.oss_key,
          })),
        },
      }))
    } catch (error) {
      console.error("[WebSocket] Failed to list session files:", error)
      this.sendError(ws, "Failed to list files: " + (error instanceof Error ? error.message : "Unknown error"))
    }
  }
}

// =============================================================================
// 服务器启动（直接运行此文件时）
// =============================================================================

if (import.meta.main) {
  const port = process.env.WS_PORT ? parseInt(process.env.WS_PORT) : 3002

  console.log("╔══════════════════════════════════════════════════════════╗")
  console.log("║     OpenCode Multiplayer WebSocket Server                ║")
  console.log("║     多人协作聊天服务器 v1.0.0                           ║")
  console.log("╚══════════════════════════════════════════════════════════╝")
  console.log()

  const server = new MultiplayerWebSocketServer({
    port,
    heartbeatInterval: 30000,
    heartbeatTimeout: 60000,
  })

  // Initialize database and OSS
  await server.initialize()

  server.start()

  console.log(`✅ WebSocket 服务器已启动`)
  console.log(`📡 监听端口: ${port}`)
  console.log(`🔗 连接地址: ws://localhost:${port}`)
  console.log()
  console.log("可用命令:")
  console.log("  按 Ctrl+C 停止服务器")
  console.log()

  // 优雅关闭
  process.on("SIGINT", async () => {
    console.log("\n🛑 正在关闭服务器...")
    const db = getDatabaseManager()
    await db.disconnect()
    server.stop()
    process.exit(0)
  })
}
