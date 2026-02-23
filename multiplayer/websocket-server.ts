/**
 * WebSocket Server
 * WebSocket 服务器实现
 *
 * 处理多人实时通信：房间管理、消息广播、状态同步
 * 集成 RDS 和 OSS 存储
 */

import type { ServerWebSocket } from "bun"
import { z } from "zod"
import * as fs from "fs/promises"
import * as path from "path"
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
import { VoiceAIService, getVoiceAIService } from "./voice-ai-service"
import { UserService, initializeUserService, getUserService } from "./user-service"
import { handleAuthAPI } from "./auth-api"

// 版本标记 - 用于验证代码是否更新

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
  compression: false, // 禁用压缩，避免大数据包 inflation error
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
  deviceId?: string // 设备ID，用于关联匿名会话
  isRegisteredUser?: boolean // 是否是已注册用户
  userAvatar?: string | null // 用户头像URL
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

  // 语音AI - 开始会话
  z.object({
    type: z.literal("voice_ai_start"),
    chatHistory: z.array(z.object({
      role: z.enum(["user", "ai"]),
      text: z.string(),
      timestamp: z.string().optional(),
    })).optional(),
    files: z.array(z.object({
      name: z.string(),
      content: z.string(), // base64编码或文本内容
      type: z.enum(["text", "base64"]),
    })).optional(),
    voiceType: z.string().optional(), // 音色类型
  }),

  // 语音AI - 停止会话
  z.object({
    type: z.literal("voice_ai_stop"),
  }),

  // 语音AI - 音频数据
  z.object({
    type: z.literal("voice_ai_audio"),
    audioData: z.string(), // Base64 编码的 PCM 音频数据
  }),

  // 语音AI - 文本消息
  z.object({
    type: z.literal("voice_ai_text"),
    text: z.string(),
  }),

  // 语音AI - 添加动态上下文（在下一次语音时发送）
  z.object({
    type: z.literal("voice_ai_add_context"),
    context: z.string(),
    contextType: z.enum(["text", "file"]).optional(), // 可选：标识是文本还是文件
  }),

  // 语音AI - 获取状态
  z.object({
    type: z.literal("voice_ai_status"),
  }),

  // 语音AI - 添加服务器端文件
  z.object({
    type: z.literal("voice_ai_server_file"),
    filePath: z.string(), // 服务器上的文件路径（相对于工作目录）
  }),

  // 共享语音AI - 加入共享会话
  z.object({
    type: z.literal("shared_ai_join"),
    voiceType: z.string().optional(), // 音色类型
    files: z.array(z.object({
      name: z.string(),
      content: z.string(),
      type: z.enum(['text', 'base64']),
    })).optional(), // 上下文文件
  }),

  // 共享语音AI - 离开共享会话
  z.object({
    type: z.literal("shared_ai_leave"),
  }),

  // 共享语音AI - 音频数据
  z.object({
    type: z.literal("shared_ai_audio"),
    audioData: z.string(), // Base64 编码的 PCM 音频数据
    isSpeaking: z.boolean().optional().default(false), // 是否正在说话
  }),

  // 共享语音AI - 文本消息
  z.object({
    type: z.literal("shared_ai_text"),
    text: z.string(),
  }),

  // 共享语音AI - 添加上下文文件/文本
  z.object({
    type: z.literal("shared_ai_add_context"),
    context: z.string(),
    contextType: z.enum(['text', 'base64']).optional().default('text'),
    fileName: z.string(),
  }),

  // 刷新文件下载URL（用于OSS文件URL过期后重新获取）
  z.object({
    type: z.literal("refresh_download_url"),
    ossKey: z.string(),
    requestId: z.string(),
  }),

  // 翻译消息
  z.object({
    type: z.literal("translate_message"),
    messageId: z.string(),
    text: z.string(),
    targetLanguage: z.string(),
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

  // @AI 按钮 ASR - 开始
  z.object({
    type: z.literal("ai_button_asr_start"),
  }),

  // @AI 按钮 ASR - 音频数据
  z.object({
    type: z.literal("ai_button_asr_audio"),
    audioData: z.string(), // Base64 编码的 PCM 音频数据
  }),

  // @AI 按钮 ASR - 停止
  z.object({
    type: z.literal("ai_button_asr_stop"),
  }),

  // 聊天室语音AI - 加入
  z.object({
    type: z.literal("chat_voice_ai_join"),
    voiceType: z.string().optional(),
  }),

  // 聊天室语音AI - 音频数据
  z.object({
    type: z.literal("chat_voice_ai_audio"),
    audioData: z.string(),
    isSpeaking: z.boolean().optional(),
  }),

  // 聊天室语音AI - 离开
  z.object({
    type: z.literal("chat_voice_ai_leave"),
  }),

  // 聊天室语音AI - 设置模式
  z.object({
    type: z.literal("chat_voice_ai_set_mode"),
    mode: z.enum(["realtime", "wakeword"]),
  }),

  // 聊天室语音AI - 设置唤醒词
  z.object({
    type: z.literal("chat_voice_ai_set_wakewords"),
    wakeWords: z.array(z.string()),
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

  // 语音AI服务
  private enableVoiceAI: boolean = false
  private voiceAIService: VoiceAIService | null = null

  // 日报系统
  private enableDailyReport: boolean = false
  private dailyReportAPIHandler: DailyReportAPIHandler | null = null

  // @AI 按钮 ASR 会话管理（添加时间戳用于超时清理）
  private aiButtonASRSessions: Map<string, {
    ws: ServerWebSocket<WebSocketData>
    asrConnection: WebSocket | null
    asrReady: boolean
    audioBuffer: ArrayBuffer[]
    timestamp: number  // 创建时间戳
  }> = new Map()

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
    this.enableVoiceAI = process.env.ENABLE_VOICE_AI === "true" || !!process.env.VOLCANO_APP_ID
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

        // Initialize user service
        initializeUserService(this.db)
        console.log("[WebSocket] User service initialized")
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

          // Initialize AI Agent with tools
          this.aiAgent = initializeAIAgent({
            basePath: process.cwd(),
            maxToolIterations: 15,
            language: 'zh',  // 使用中文系统提示词
            enableAutoSave: true,        // 启用自动保存聊天记录
            autoSaveThreshold: 40,       // 当消息达到40条时触发保存
            autoSaveKeepCount: 10,       // 保存后保留最近10条消息
            securityConfig: {
              allowWrite: true,
              allowDelete: false,
              maxFileSize: 10 * 1024 * 1024, // 10MB
              commandTimeout: 30000,
            },
            // 任务规划回调 - 广播任务计划到前端
            onTaskPlan: (plan) => {
              const sessionId = this.aiAgent?.getSessionId()
              if (sessionId) {
                const room = this.rooms.get(sessionId)
                if (room) {
                  this.broadcastToRoom(room, {
                    type: "ai.task_plan",
                    timestamp: new Date().toISOString(),
                    senderId: "ai-assistant",
                    senderName: "AI 助手",
                    payload: plan,
                  })
                }
              }
            },
            // 任务更新回调 - 广播任务状态更新到前端
            onTaskUpdate: (update) => {
              const sessionId = this.aiAgent?.getSessionId()
              if (sessionId) {
                const room = this.rooms.get(sessionId)
                if (room) {
                  this.broadcastToRoom(room, {
                    type: "ai.task_update",
                    timestamp: new Date().toISOString(),
                    senderId: "ai-assistant",
                    senderName: "AI 助手",
                    payload: update,
                  })
                }
              }
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
                  return messages
                } catch (error) {
                  console.error('[AI Agent] Failed to load messages from database:', error)
                }
              }

              // 备用：从房间内存缓存获取
              const room = this.rooms.get(sessionId)
              if (room) {
                return room.messages
              }

              return []
            }
          })

          // Add current workspace to allowed paths
          this.aiAgent.getSecurityPolicy().addAllowedBasePath(process.cwd())


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
      } catch (error) {
        console.error("[WebSocket] Summary Manager initialization failed:", error)
      }
    }

    // Initialize Voice Chat Service
    if (this.enableVoiceChat) {
      try {
        this.voiceChatService = getVoiceChatService()
        if (this.voiceChatService.isEnabled()) {
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

    // Initialize Voice AI Service
    if (this.enableVoiceAI) {
      try {
        this.voiceAIService = getVoiceAIService()
        if (this.voiceAIService.isEnabled()) {
          this.setupVoiceAIHandler()
        } else {
          console.warn("[WebSocket] Voice AI Service not available - VOLCANO_APP_ID not configured")
          this.enableVoiceAI = false
        }
      } catch (error) {
        console.error("[WebSocket] Voice AI Service initialization failed:", error)
        this.enableVoiceAI = false
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


        // 启动定时调度器（如果启用）
        if (process.env.DAILY_REPORT_SCHEDULE_ENABLED !== "false") {
          const { getScheduler } = await import("./daily-report")
          const scheduler = getScheduler()
          scheduler.start()
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
          }
        }

        let response: string
        let toolCalls: any[] = []

        // 使用 AI Agent 处理（支持工具调用）
        if (this.aiAgent) {

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
              toolCalls.push(toolResult)
            },
          })

          response = result.response

          // 如果有工具调用，添加工具执行摘要
          if (result.toolCalls.length > 0) {
            const toolSummary = result.toolCalls
              .map(tc => `- ${tc.tool}: ${tc.result.success ? '✓' : '✗'} ${tc.result.output?.substring(0, 50) || ''}`)
              .join('\n')
          }
        } else {
          // 降级到普通 AI 服务

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
    }

    // CORS 响应头
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }

    this.server = Bun.serve({
      port: this.config.port,
      hostname: this.config.hostname || "0.0.0.0",
      tls: tlsConfig,
      fetch: async (req, server) => {
        const url = new URL(req.url)

        // 处理 CORS 预检请求
        if (req.method === "OPTIONS") {
          return new Response(null, {
            status: 204,
            headers: corsHeaders,
          })
        }

        // 文件列表 API 端点
        if (url.pathname === "/api/files") {
          try {
            const fs = await import("fs")
            const path = await import("path")

            // 扫描可下载文件（AI 生成的文件）
            const searchDirs = [
              process.cwd(),
              path.join(process.cwd(), "downloads"),
              path.join(process.cwd(), "output"),
              path.join(process.cwd(), "data"),
            ]

            const files: Array<{
              name: string
              path: string
              size: number
              modified: string
              type: string
            }> = []

            const seenFiles = new Set<string>()

            for (const dir of searchDirs) {
              try {
                if (!fs.existsSync(dir)) continue

                const entries = fs.readdirSync(dir, { withFileTypes: true })

                for (const entry of entries) {
                  if (entry.isFile()) {
                    const ext = entry.name.split('.').pop()?.toLowerCase() || ''
                    // 只包含特定类型的文件
                    const allowedExts = ['txt', 'md', 'json', 'csv', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'rar', '7z', 'png', 'jpg', 'jpeg', 'gif', 'mp3', 'mp4', 'wav', 'webm']

                    if (allowedExts.includes(ext)) {
                      const filePath = path.join(dir, entry.name)
                      const stats = fs.statSync(filePath)

                      if (!seenFiles.has(entry.name)) {
                        seenFiles.add(entry.name)
                        files.push({
                          name: entry.name,
                          path: filePath,
                          size: stats.size,
                          modified: stats.mtime.toISOString(),
                          type: ext,
                        })
                      }
                    }
                  }
                }
              } catch (err) {
                console.error(`[API/files] Error scanning directory ${dir}:`, err)
              }
            }

            // 按修改时间排序（最新的在前）
            files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())

            return new Response(
              JSON.stringify({
                success: true,
                files: files,
                total: files.length,
              }),
              {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            )
          } catch (error) {
            console.error("[API/files] Error:", error)
            return new Response(
              JSON.stringify({ success: false, error: "Failed to list files" }),
              {
                status: 500,
                headers: {
                  "Content-Type": "application/json",
                  ...corsHeaders,
                },
              }
            )
          }
        }

        // AI 生成文件下载端点（优先处理，避免WebSocket升级干扰）
        if (url.pathname.startsWith("/downloads/")) {
          const encodedFilename = url.pathname.replace("/downloads/", "")

          // 解码URL编码的文件名
          const filename = decodeURIComponent(encodedFilename)

          // 防止路径遍历攻击 - 使用简单方法提取文件名
          const sanitizedFilename = filename.split(/[\\/]/).pop() || "file"

          const path = await import("path")
          const fs = await import("fs")

          // 尝试多个可能的路径查找文件
          const possiblePaths = [
            path.join(process.cwd(), sanitizedFilename),           // 工作目录
            path.join(process.cwd(), "downloads", sanitizedFilename), // downloads子目录
            path.join(process.cwd(), filename),                     // 保留原始路径（如果安全）
          ]

          let filePath: string | null = null
          for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
              filePath = p
              break
            }
          }

          // 如果都找不到，打印调试信息
          if (!filePath) {
            console.error(`[Download] File not found: ${sanitizedFilename}`)
            console.error(`[Download] Searched paths:`, possiblePaths)
            console.error(`[Download] CWD:`, process.cwd())
            // 列出工作目录下的文件帮助调试
            try {
              const files = fs.readdirSync(process.cwd()).filter(f => f.endsWith('.txt') || f.endsWith('.md'))
              console.error(`[Download] Text files in CWD:`, files.slice(0, 10))
            } catch {}
            return new Response("File not found", { status: 404 })
          }

          // 检查文件是否存在
          try {
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
          const memUsage = process.memoryUsage?.() || null
          return new Response(
            JSON.stringify({
              version: "1.0.0",
              connections: this.getTotalConnections(),
              rooms: Array.from(this.rooms.entries()).map(([id, room]) => ({
                sessionId: id,
                participants: room.participants.size,
                messages: room.messages.length,
              })),
              memory: memUsage ? {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                rss: Math.round(memUsage.rss / 1024 / 1024),
                external: Math.round(memUsage.external / 1024 / 1024),
              } : null,
              caches: {
                pendingPasswords: this.pendingPasswordVerification.size,
                asrSessions: this.aiButtonASRSessions.size,
                summaries: this.summaryManager?.getCacheSize?.() || 0,
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        // 详细内存状态端点
        if (url.pathname === "/memory") {
          const memUsage = process.memoryUsage?.()
          if (!memUsage) {
            return new Response(
              JSON.stringify({ error: "Memory usage not available" }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            )
          }

          // 内存告警阈值（默认警告 400MB，严重 500MB）
          const WARNING_THRESHOLD = parseInt(process.env.MEMORY_WARNING_MB || "400") * 1024 * 1024
          const CRITICAL_THRESHOLD = parseInt(process.env.MEMORY_CRITICAL_MB || "500") * 1024 * 1024

          const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024)
          const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024)
          const rssMB = Math.round(memUsage.rss / 1024 / 1024)

          let status = "ok"
          let message = ""
          if (memUsage.heapUsed > CRITICAL_THRESHOLD) {
            status = "critical"
            message = `Memory usage critical: ${heapUsedMB}MB used`
            console.error(`[Memory] ${message}`)
          } else if (memUsage.heapUsed > WARNING_THRESHOLD) {
            status = "warning"
            message = `Memory usage high: ${heapUsedMB}MB used`
            console.warn(`[Memory] ${message}`)
          }

          return new Response(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              status,
              message,
              memory: {
                heapUsedMB,
                heapTotalMB,
                rssMB,
                externalMB: Math.round(memUsage.external / 1024 / 1024),
                arrayBuffersMB: Math.round((memUsage as any).arrayBuffers / 1024 / 1024 || 0),
                usagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100),
              },
              thresholds: {
                warningMB: Math.round(WARNING_THRESHOLD / 1024 / 1024),
                criticalMB: Math.round(CRITICAL_THRESHOLD / 1024 / 1024),
              },
              caches: {
                rooms: this.rooms.size,
                totalParticipants: this.getTotalConnections(),
                pendingPasswords: this.pendingPasswordVerification.size,
                asrSessions: this.aiButtonASRSessions.size,
                summaries: this.summaryManager?.getCacheSize?.() || 0,
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          )
        }

        // 日报系统API路由
        if (url.pathname.startsWith("/api/daily-report")) {
          if (this.dailyReportAPIHandler) {
            const response = await this.dailyReportAPIHandler.handleRequest(req, url)
            return response
          } else {
            return new Response(
              JSON.stringify({ error: "Daily Report System not initialized" }),
              { status: 503, headers: { "Content-Type": "application/json" } }
            )
          }
        }

        // 用户认证API路由
        if (url.pathname.startsWith("/api/auth/") || url.pathname.startsWith("/api/user/")) {
          const userService = getUserService()
          if (userService) {
            const response = await handleAuthAPI(req, url, userService)
            if (response) return response
          }
          return new Response(
            JSON.stringify({ error: "User service not initialized" }),
            { status: 503, headers: corsHeaders }
          )
        }

        // 获取 token 从 URL 参数
        const token = url.searchParams.get("token")
        const sessionId = url.searchParams.get("session") || "default"
        const userName = url.searchParams.get("name") || "Anonymous"
        const userRole = (url.searchParams.get("role") as UserRole) || "guest"
        const passwordQuestion = url.searchParams.get("pwd_question") || undefined
        const passwordAnswer = url.searchParams.get("pwd_answer") || undefined
        const rolePassword = url.searchParams.get("role_password") || undefined
        const deviceId = url.searchParams.get("device_id") || undefined // 设备ID

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
            deviceId,
            isRegisteredUser: false,
          } as WebSocketData,
        })

        // 如果升级成功，Bun会自动处理，不需要返回Response
        if (success) {
          return new Response("WebSocket upgraded", { status: 101 })
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

  }

  // ============================================================================
  // 事件处理器
  // ============================================================================

  private async handleOpen(ws: ServerWebSocket<WebSocketData>): Promise<void> {

    // 如果有 token，尝试认证
    if (ws.data.token) {
      // 首先尝试用户系统的 JWT 认证
      const userService = getUserService()
      if (userService) {
        try {
          const authResult = await userService.verifyToken(ws.data.token)
          if (authResult.valid && authResult.user && authResult.payload) {
            ws.data.userId = authResult.user.id
            ws.data.userName = authResult.user.username
            ws.data.userRole = ws.data.userRole || "member" // Keep URL role or default to member
            ws.data.isAuthenticated = true
            ws.data.isRegisteredUser = true
            ws.data.deviceId = authResult.payload.deviceId
            ws.data.userAvatar = authResult.user.avatar || null  // 设置用户头像
            console.log(`[WebSocket] User authenticated: ${authResult.user.username} (${authResult.user.id})`)
          } else {
            // Try Supabase auth as fallback
            const auth = await authenticateWebSocket({
              token: ws.data.token,
              sessionId: ws.data.sessionId,
            })
            if (auth.success && auth.user) {
              ws.data.userId = auth.user.id
              ws.data.userName = auth.user.name
              ws.data.userRole = auth.user.role as UserRole
              ws.data.isAuthenticated = true
            } else if (process.env.ALLOW_ANONYMOUS !== "true") {
              this.sendError(ws, "Authentication failed")
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
      } else {
        // Fallback to Supabase auth
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
          } else {
            ws.data.isAuthenticated = false
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
      }
    } else if (process.env.ENABLE_SUPABASE_AUTH === "true" && process.env.ALLOW_ANONYMOUS !== "true") {
      this.sendError(ws, "Authentication required")
      ws.close(1008, "Authentication required")
      return
    }

    // 自动加入房间（使用 URL 参数中的信息）
    await this.autoJoinRoom(ws)
  }

  // 等待密码验证的连接（包含时间戳用于超时清理）
  private pendingPasswordVerification = new Map<string, {
    ws: ServerWebSocket<WebSocketData>
    timestamp: number  // 添加时间戳
  }>()
  private readonly PENDING_PASSWORD_TIMEOUT = 5 * 60 * 1000  // 5分钟超时

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
      } catch (error) {
        console.error("[WebSocket] Error getting password from DB:", error)
      }
    }

    // 如果没有数据库密码，检查内存中的密码
    if (!existingQuestion && room) {
      existingQuestion = room.passwordQuestion || null
      existingAnswer = room.passwordAnswer || null
    }

    // 如果是 Owner 且正在设置新密码，使用新密码（覆盖旧密码）
    if (userRole === "owner" && wsPwdQuestion && wsPwdAnswer) {
      existingQuestion = wsPwdQuestion
      existingAnswer = wsPwdAnswer
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
        // 标记为等待密码验证（记录时间戳）
        this.pendingPasswordVerification.set(userId, { ws, timestamp: Date.now() })
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
    } else {
      // 不需要密码验证，确保清理可能存在的旧记录
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
        } else {
          await this.db.createSession(sessionId, `Session ${sessionId}`, userId)
        }
        await this.db.saveParticipant(sessionId, {
          id: userId,
          name: userName,
          role: userRole,
          status: "online",
          joinedAt: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        })

        // Record device session for anonymous users or user session for registered users
        const userService = getUserService()
        if (userService && ws.data.deviceId) {
          if (ws.data.isRegisteredUser && ws.data.userId) {
            // Registered user - record user session
            await userService.recordUserSession(ws.data.userId, sessionId, ws.data.deviceId)
          } else {
            // Anonymous user - record device session
            await userService.recordDeviceSession(ws.data.deviceId, sessionId)
          }
        }
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
          avatar: ws.data.userAvatar || null,  // 包含用户头像
        },
      },
      [userId]
    )

  }

  private handleMessage(ws: ServerWebSocket<WebSocketData>, message: string | Buffer): void {
    try {
      const data = JSON.parse(message.toString())
      const result = ClientMessageSchema.safeParse(data)

      if (!result.success) {
        console.error(`[WebSocket] Message validation failed:`, result.error.errors)
        console.error(`[WebSocket] Received data:`, JSON.stringify(data))
        console.error(`[WebSocket] Message type received:`, data?.type)
        this.sendError(ws, "Invalid message format", result.error.errors)
        return
      }

      this.processClientMessage(ws, result.data)
    } catch (error) {
      console.error(`[WebSocket] Failed to parse message:`, error)
      console.error(`[WebSocket] Raw message:`, message.toString().substring(0, 200))
      this.sendError(ws, "Failed to parse message", error)
    }
  }

  private async handleClose(ws: ServerWebSocket<WebSocketData>, code: number, reason: string): Promise<void> {
    // 清理可能存在的密码验证等待记录
    for (const [userId, entry] of this.pendingPasswordVerification.entries()) {
      if (entry.ws === ws) {
        this.pendingPasswordVerification.delete(userId)
        break
      }
    }
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
      case "translate_message":
        await this.handleTranslateMessage(ws, message.messageId, message.text, message.targetLanguage)
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
      // 语音AI消息处理
      case "voice_ai_start":
        await this.handleVoiceAIStart(ws, message.chatHistory, message.files, message.voiceType)
        break
      case "voice_ai_stop":
        await this.handleVoiceAIStop(ws)
        break
      case "voice_ai_audio":
        await this.handleVoiceAIAudio(ws, message.audioData)
        break
      case "voice_ai_text":
        await this.handleVoiceAIText(ws, message.text)
        break
      case "voice_ai_add_context":
        await this.handleVoiceAIAddContext(ws, message.context, message.contextType)
        break
      case "voice_ai_status":
        await this.handleVoiceAIStatus(ws)
        break
      case "voice_ai_server_file":
        await this.handleVoiceAIServerFile(ws, message.filePath)
        break
      // 共享语音AI消息处理
      case "shared_ai_join":
        await this.handleSharedAIJoin(ws, message.voiceType, message.files)
        break
      case "shared_ai_leave":
        await this.handleSharedAILeave(ws)
        break
      case "shared_ai_audio":
        await this.handleSharedAIAudio(ws, message.audioData, message.isSpeaking)
        break
      case "shared_ai_text":
        await this.handleSharedAIText(ws, message.text)
        break
      case "shared_ai_add_context":
        await this.handleSharedAIAddContext(ws, message.context, message.contextType, message.fileName)
        break
      // @AI 按钮 ASR 消息处理
      case "ai_button_asr_start":
        await this.handleAIButtonASRStart(ws)
        break
      case "ai_button_asr_audio":
        await this.handleAIButtonASRAudio(ws, message.audioData)
        break
      case "ai_button_asr_stop":
        await this.handleAIButtonASRStop(ws)
        break
      // 聊天室语音AI消息处理
      case "chat_voice_ai_join":
        await this.handleChatVoiceAIJoin(ws, message.voiceType)
        break
      case "chat_voice_ai_audio":
        await this.handleChatVoiceAIAudio(ws, message.audioData, message.isSpeaking)
        break
      case "chat_voice_ai_leave":
        await this.handleChatVoiceAILeave(ws)
        break
      case "chat_voice_ai_set_mode":
        await this.handleChatVoiceAISetMode(ws, message.mode)
        break
      case "chat_voice_ai_set_wakewords":
        await this.handleChatVoiceAISetWakeWords(ws, message.wakeWords)
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

  }

  private async handleUserLeave(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return

    // 清理语音聊天状态
    if (this.enableVoiceChat && this.voiceChatService) {
      this.voiceChatService.leaveVoiceChat(sessionId, userId)
    }

    // 清理语音AI状态
    if (this.enableVoiceAI && this.voiceAIService) {
      await this.voiceAIService.stopSession(sessionId, userId)
      // 清理共享语音AI状态
      await this.voiceAIService.leaveSharedSession(sessionId, userId)
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

        const mimeType = fileData.mimeType || detectMimeType(fileData.fileName || "")

        const ossKey = this.oss.generateFileKey(sessionId, fileData.fileName || "file", userId)

        // Generate upload URL for client-side upload
        const { url } = await this.oss.generateUploadUrl(ossKey, mimeType, 3600)

        // Update file data with OSS info
        message.fileData = {
          ...fileData,
          ossUrl: url,
          ossKey: ossKey,
        }

        // Save file metadata to database
        if (this.enableDatabase && this.db) {
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
        }
      } catch (error) {
        console.error("[WebSocket] OSS upload error:", error)
      }
    } else {
      if (messageData.fileData) {
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

    let messages: ChatMessage[] = []

    // 优先从数据库获取历史记录
    if (this.enableDatabase && this.db) {
      try {
        messages = await this.db.getMessages(sessionId, limit, before)
        // 数据库返回的是倒序，需要反转
        messages = messages.reverse()
      } catch (error) {
        console.error("[WebSocket] Database getMessages error:", error)
      }
    } else {
    }

    // 如果数据库没有数据，尝试从内存存储获取
    if (messages.length === 0 && this.storage) {
      messages = await this.storage.getMessages(sessionId, {
        before,
        limit,
      })
    }

    // 如果还是没有，从房间内存获取
    if (messages.length === 0) {
      const room = this.rooms.get(sessionId)
      if (room) {
        messages = room.messages.slice(-limit)
      } else {
      }
    }

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

  private lastCleanupTime: number = 0
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000 // 5分钟清理一次

  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval ?? 30000
    const timeout = this.config.heartbeatTimeout ?? 60000

    this.heartbeatTimer = setInterval(() => {
      const now = Date.now()

      for (const room of this.rooms.values()) {
        for (const [userId, ws] of room.participants.entries()) {
          // 检查超时
          if (now - ws.data.lastPing > timeout) {
            ws.close(1001, "Heartbeat timeout")
            room.participants.delete(userId)
            continue
          }

          // 发送 ping
          ws.ping()
        }
      }

      // 定期清理内存（每5分钟）
      if (now - this.lastCleanupTime > this.CLEANUP_INTERVAL) {
        this.cleanupMemory()
        this.lastCleanupTime = now
      }
    }, interval)
  }

  /**
   * 清理内存，防止内存泄漏
   */
  private cleanupMemory(): void {
    const startTime = Date.now()
    const now = startTime
    let cleanedRooms = 0
    let cleanedMessages = 0
    let cleanedTranscripts = 0
    let cleanedPendingPasswords = 0
    let cleanedASRSessions = 0

    // 1. 清理空房间
    for (const [sessionId, room] of this.rooms.entries()) {
      if (room.participants.size === 0) {
        this.rooms.delete(sessionId)
        cleanedRooms++
        continue
      }

      // 2. 限制房间消息历史（保留最近1000条）
      if (room.messages.length > 1000) {
        const before = room.messages.length
        room.messages = room.messages.slice(-1000)
        cleanedMessages += before - room.messages.length
      }
    }

    // 2.5 清理超时的密码验证等待记录
    for (const [userId, entry] of this.pendingPasswordVerification.entries()) {
      if (now - entry.timestamp > this.PENDING_PASSWORD_TIMEOUT) {
        // 尝试关闭连接
        try {
          if (entry.ws.readyState === 1) {
            entry.ws.close(1008, "Password verification timeout")
          }
        } catch (e) {
          // 忽略关闭错误
        }
        this.pendingPasswordVerification.delete(userId)
        cleanedPendingPasswords++
      }
    }

    // 3. 清理语音AI不活跃会话
    if (this.voiceAIService) {
      this.voiceAIService.cleanupInactiveSessions(10 * 60 * 1000)
    }

    // 4. 清理语音聊天服务中的空房间
    if (this.voiceChatService) {
      // voiceChatService 的 rooms 是私有的，通过 getRoomInfo 检查
      // leaveVoiceChat 会自动清理空房间
    }

    // 4.5 清理总结管理器的内存缓存
    if (this.summaryManager) {
      const cleanedSummaries = this.summaryManager.cleanupMemoryCache()
      // cleanedSummaries counted but not logged separately
    }

    // 5. 清理 @AI 按钮 ASR 会话（添加时间戳检查）
    for (const [key, session] of this.aiButtonASRSessions.entries()) {
      // 清理超过30分钟的会话
      const sessionAge = session.timestamp ? now - session.timestamp : 0
      if (sessionAge > 30 * 60 * 1000 || session.audioBuffer.length > 100) {
        // 关闭 ASR 连接
        if (session.asrConnection) {
          try {
            session.asrConnection.close()
          } catch (e) {
            // 忽略关闭错误
          }
        }
        this.aiButtonASRSessions.delete(key)
        cleanedASRSessions++
      } else if (session.audioBuffer.length > 100) {
        session.audioBuffer = session.audioBuffer.slice(-50)
      }
    }

    // 6. 触发垃圾回收（如果可用）
    const memBefore = process.memoryUsage?.()
    if (global.gc) {
      global.gc()
    }
    const memAfter = process.memoryUsage?.()

    // 7. 内存使用告警和自动清理
    if (memAfter) {
      const heapUsedMB = Math.round(memAfter.heapUsed / 1024 / 1024)
      const WARNING_THRESHOLD = parseInt(process.env.MEMORY_WARNING_MB || "400")
      const CRITICAL_THRESHOLD = parseInt(process.env.MEMORY_CRITICAL_MB || "500")

      if (heapUsedMB > CRITICAL_THRESHOLD) {
        console.error(`[Memory] CRITICAL: Heap usage ${heapUsedMB}MB exceeds ${CRITICAL_THRESHOLD}MB threshold!`)

        // 严重阈值：执行激进清理
        console.log(`[Memory] Performing aggressive cleanup...`)

        // 清理所有待验证的密码记录
        for (const [userId, entry] of this.pendingPasswordVerification.entries()) {
          try {
            if (entry.ws.readyState === 1) {
              entry.ws.close(1008, "Server memory pressure")
            }
          } catch (e) {}
          this.pendingPasswordVerification.delete(userId)
        }

        // 清理所有 ASR 会话
        for (const [key, session] of this.aiButtonASRSessions.entries()) {
          try {
            if (session.asrConnection) session.asrConnection.close()
          } catch (e) {}
          this.aiButtonASRSessions.delete(key)
        }

        // 清理 summaries 缓存（保留最近10个）
        if (this.summaryManager) {
          this.summaryManager.cleanupMemoryCache(0, 10)
        }

        // 强制 GC
        if (global.gc) {
          global.gc()
        }

        const memAfterCleanup = process.memoryUsage?.()
        const freedMB = memAfterCleanup ? heapUsedMB - Math.round(memAfterCleanup.heapUsed / 1024 / 1024) : 0
        console.log(`[Memory] Aggressive cleanup freed ~${freedMB}MB`)

      } else if (heapUsedMB > WARNING_THRESHOLD) {
        console.warn(`[Memory] WARNING: Heap usage ${heapUsedMB}MB exceeds ${WARNING_THRESHOLD}MB threshold`)

        // 警告阈值：执行标准清理
        console.log(`[Memory] Performing extra cleanup due to high memory usage...`)
        if (this.summaryManager) {
          this.summaryManager.cleanupMemoryCache(10 * 60 * 1000, 50)  // 清理10分钟前的，保留50个
        }
        if (global.gc) {
          global.gc()
        }
      }
    }

    const duration = Date.now() - startTime
    if (cleanedRooms > 0 || cleanedMessages > 0 || cleanedPendingPasswords > 0 || cleanedASRSessions > 0) {
      console.log(`[Memory] Cleanup completed in ${duration}ms: ` +
        `rooms=${cleanedRooms}, messages=${cleanedMessages}, pendingPasswords=${cleanedPendingPasswords}, asrSessions=${cleanedASRSessions}` +
        (memBefore && memAfter ? `, heap: ${Math.round((memBefore.heapUsed - memAfter.heapUsed) / 1024 / 1024)}MB freed` : ''))
    }
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
        } catch (error) {
          console.error("[VoiceChat] Failed to save transcript to database:", error)
        }
      } else {
      }
    }

    // 处理 AI 分析请求（多人共享AI对话）
    this.voiceChatService.onAIAnalyze = async (sessionId, context) => {
      const room = this.rooms.get(sessionId)
      if (!room) return

      try {
        // 发送正在分析状态
        this.broadcastToRoom(room, {
          type: "voice.ai_analyze",
          status: "analyzing",
        })

        let response: string
        let contextWithSummary = context

        // 检查上下文是否超过限制，如果超过则自动生成总结
        if (this.summaryManager && this.summaryManager.isContextOverLimit(
          room.transcripts.map(t => ({
            id: t.id,
            sessionId: t.sessionId,
            senderId: t.userId,
            senderName: t.userName,
            senderRole: 'user' as const,
            type: 'text' as const,
            content: t.text,
            mentions: [],
            mentionsAI: false,
            timestamp: new Date(t.timestamp).toISOString()
          }))
        )) {
          console.log(`[VoiceChat] Context over limit, generating summary...`)

          // 获取之前的总结
          const previousSummaries = this.summaryManager.getAllSummaries(sessionId)

          // 生成新总结
          const messagesForSummary = room.transcripts.map(t => ({
            id: t.id,
            sessionId: t.sessionId,
            senderId: t.userId,
            senderName: t.userName,
            senderRole: 'user' as const,
            type: 'text' as const,
            content: t.text,
            mentions: [],
            mentionsAI: false,
            timestamp: new Date(t.timestamp).toISOString()
          }))

          const summary = await this.summaryManager.generateSummary(
            sessionId,
            messagesForSummary,
            previousSummaries
          )

          if (summary) {
            this.broadcastToRoom(room, {
              type: "shared_ai.summary",
              summary: summary.summary,
              filePath: summary.filePath,
            })
          }
        }

        // 获取所有历史总结并加入上下文
        if (this.summaryManager) {
          const allSummaries = this.summaryManager.getAllSummaries(sessionId)
          if (allSummaries) {
            contextWithSummary = `【历史对话总结】\n${allSummaries}\n\n【最新对话内容】\n${context}`
          }
        }

        // 优先使用 VoiceAI (火山引擎豆包) 进行端到端语音对话
        if (this.enableVoiceAI && this.voiceAIService) {
          response = await this.handleSharedVoiceAIResponse(sessionId, room, contextWithSummary)
        } else if (this.aiService && this.enableAI) {
          // 降级使用 DeepSeek 文字AI
          const systemPrompt = `你是一个语音聊天分析助手。请分析以下语音聊天的内容，并给出简洁的总结或回答。
语音聊天内容：
${contextWithSummary}

请给出简短的分析或回答（不超过500字）。`
          response = await this.aiService.generateResponse([], systemPrompt)
        } else {
          throw new Error("AI 服务未启用")
        }

        // 发送分析结果（文字）
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
   * 处理多人共享AI语音响应
   * 创建一个共享的AI会话来响应多人对话
   */
  private async handleSharedVoiceAIResponse(
    sessionId: string,
    room: Room,
    context: string
  ): Promise<string> {
    if (!this.voiceAIService) {
      throw new Error("Voice AI service not available")
    }

    // 使用特殊的共享AI用户ID
    const sharedAIUserId = `${sessionId}:shared_ai`
    const sharedAIUserName = "AI助手"

    // 检查是否已存在共享AI会话
    let aiSession = this.voiceAIService.getSession(sessionId, sharedAIUserId)

    // 如果不存在，创建新的共享AI会话
    if (!aiSession) {

      // 创建一个模拟的WebSocket用于接收AI响应
      const mockWs = {
        data: { sessionId, userId: sharedAIUserId, userName: sharedAIUserName },
        send: (data: string) => {
          // 解析消息并广播给所有参与者
          try {
            const message = JSON.parse(data)
            this.broadcastVoiceAIResponse(sessionId, message)
          } catch (e) {
            console.error('[SharedVoiceAI] Failed to parse message:', e)
          }
        },
        readyState: 1, // WebSocket.OPEN
      } as ServerWebSocket<WebSocketData>

      const success = await this.voiceAIService.startSession(
        sessionId,
        sharedAIUserId,
        sharedAIUserName,
        mockWs
      )

      if (!success) {
        throw new Error("Failed to start shared AI session")
      }

      // 等待会话就绪
      await new Promise(resolve => setTimeout(resolve, 1000))
    }

    // 构建多人对话提示
    const prompt = `这是一个多人语音聊天室。以下是参与者们的对话内容，请自然地回应大家：

${context}

请给出简短友好的回应（不超过100字）：`


    // 发送文本给共享AI会话
    await this.voiceAIService.sendText(sessionId, sharedAIUserId, prompt)

    // 等待AI响应（简单实现：等待3秒）
    await new Promise(resolve => setTimeout(resolve, 3000))

    return "AI正在语音回复..."
  }

  /**
   * 广播VoiceAI响应给房间内所有参与者
   */
  private broadcastVoiceAIResponse(sessionId: string, message: any): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    // 将共享AI的响应广播给所有人
    for (const [userId, participantWs] of room.participants) {
      if (participantWs.readyState === WebSocket.OPEN) {
        participantWs.send(JSON.stringify({
          ...message,
          isSharedAI: true, // 标记为共享AI响应
        }))
      }
    }

  }

  /**
   * 设置语音AI处理器
   */
  private setupVoiceAIHandler(): void {
    if (!this.voiceAIService) return

    // 处理AI文本响应
    this.voiceAIService.onAIResponse = (sessionId, userId, text) => {

      // 发送文本响应给客户端
      const room = this.rooms.get(sessionId)
      if (room) {
        const participantWs = room.participants.get(userId)
        if (participantWs) {
          participantWs.send(JSON.stringify({
            type: 'voice_ai.response',
            sessionId,
            userId,
            text,
            timestamp: new Date().toISOString(),
          }))
        }
      }
    }

    // 处理AI音频响应 - 支持个人AI和共享AI广播
    this.voiceAIService.onAIAudio = (sessionId, userId, audioData) => {
      const isSharedAI = userId.includes('shared_ai')

      // 调试：检查音频数据格式
      const buffer = Buffer.from(audioData)
      const firstBytes = Array.from(buffer.slice(0, 16)).map(b => b.toString(16).padStart(2, '0')).join(' ')

      // 检查是否是OGG格式
      if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
      } else {
      }

      // 构建音频消息
      const audioMessage = {
        type: 'voice_ai.audio',
        sessionId,
        userId,
        audioData: buffer.toString('base64'),
        timestamp: new Date().toISOString(),
      }

      const room = this.rooms.get(sessionId)
      if (!room) return

      if (isSharedAI) {
        // 共享AI：广播给房间内所有参与者
        for (const [participantId, participantWs] of room.participants) {
          if (participantWs.readyState === WebSocket.OPEN) {
            participantWs.send(JSON.stringify(audioMessage))
          }
        }
      } else {
        // 个人AI：只发送给特定用户
        const participantWs = room.participants.get(userId)
        if (participantWs) {
          participantWs.send(JSON.stringify(audioMessage))
        }
      }
    }

    // 处理状态变化 - 发送给客户端
    this.voiceAIService.onAIStateChange = (sessionId, userId, state) => {

      // 发送状态变化给客户端
      const room = this.rooms.get(sessionId)
      if (room) {
        const participantWs = room.participants.get(userId)
        if (participantWs) {
          participantWs.send(JSON.stringify({
            type: 'voice_ai.state',
            sessionId,
            userId,
            state,
            timestamp: new Date().toISOString(),
          }))
        }
      }
    }

    // 处理ASR结果
    // 注意：第4个参数是 isInterim（是否为中间结果），不是 isFinal
    this.voiceAIService.onASRResult = (sessionId, userId, text, isInterim) => {
      const isFinal = !isInterim

      // 发送ASR结果给客户端
      const room = this.rooms.get(sessionId)
      if (room) {
        const participantWs = room.participants.get(userId)
        if (participantWs) {
          participantWs.send(JSON.stringify({
            type: 'voice_ai.asr',
            sessionId,
            userId,
            text,
            isFinal,
            timestamp: new Date().toISOString(),
          }))
        }
      }
    }

    // 处理错误
    this.voiceAIService.onError = (sessionId, userId, error) => {
      console.error(`[VoiceAI] Error for ${userId}: ${error}`)

      // 发送错误给客户端
      const room = this.rooms.get(sessionId)
      if (room) {
        const participantWs = room.participants.get(userId)
        if (participantWs) {
          participantWs.send(JSON.stringify({
            type: 'voice_ai.error',
            message: error,
            timestamp: new Date().toISOString(),
          }))
        }
      }
    }

    // =========================================================================
    // 共享语音AI回调设置
    // =========================================================================

    // 处理共享AI文本响应 - 广播给所有参与者
    this.voiceAIService.onSharedAIResponse = (sessionId, text, speakerName) => {

      const room = this.rooms.get(sessionId)
      if (!room) return

      const message = {
        type: 'shared_ai.response',
        sessionId,
        text,
        speakerName,
        timestamp: new Date().toISOString(),
      }

      // 广播给房间内所有参与者
      this.broadcastToRoom(room, message)
    }

    // 处理共享AI音频响应 - 广播给所有参与者
    this.voiceAIService.onSharedAIAudio = (sessionId, audioData) => {

      const room = this.rooms.get(sessionId)
      if (!room) return

      const buffer = Buffer.from(audioData)
      const message = {
        type: 'shared_ai.audio',
        sessionId,
        audioData: buffer.toString('base64'),
        timestamp: new Date().toISOString(),
      }

      // 广播给房间内所有参与者
      this.broadcastToRoom(room, message)
    }

    // 处理共享AI状态变化 - 广播给所有参与者
    this.voiceAIService.onSharedAIStateChange = (sessionId, state, speaker) => {

      const room = this.rooms.get(sessionId)
      if (!room) return

      const message = {
        type: 'shared_ai.state',
        sessionId,
        state,
        speaker,
        timestamp: new Date().toISOString(),
      }

      // 广播给房间内所有参与者
      this.broadcastToRoom(room, message)
    }

    // 处理共享ASR结果 - 广播给所有参与者（包含说话者信息）
    this.voiceAIService.onSharedASRResult = (sessionId, userId, userName, text, isInterim) => {

      const room = this.rooms.get(sessionId)
      if (!room) return

      const message = {
        type: 'shared_ai.asr',
        sessionId,
        userId,
        userName,
        text,
        isInterim,
        isFinal: !isInterim,
        timestamp: new Date().toISOString(),
      }

      // 广播给房间内所有参与者
      this.broadcastToRoom(room, message)
    }

    // 处理共享AI错误 - 广播给所有参与者
    this.voiceAIService.onSharedError = (sessionId, error) => {
      console.error(`[SharedVoiceAI] Error for room ${sessionId}: ${error}`)

      const room = this.rooms.get(sessionId)
      if (!room) return

      const message = {
        type: 'shared_ai.error',
        sessionId,
        message: error,
        timestamp: new Date().toISOString(),
      }

      // 广播给房间内所有参与者
      this.broadcastToRoom(room, message)
    }

    // 处理唤醒词触发 - 获取聊天记录
    this.voiceAIService.onWakeWordTriggered = async (sessionId: string) => {
      try {
        // 先从数据库获取聊天记录
        let messages: Array<{role: 'user' | 'ai', text: string, userName?: string, timestamp?: string}> = []

        if (this.enableDatabase && this.db) {
          try {
            const dbMessages = await this.db.getMessages(sessionId, 50)
            messages = dbMessages.map((msg: any) => ({
              role: msg.role === 'assistant' ? 'ai' : 'user',
              text: msg.content,
              userName: msg.sender_name,
              timestamp: msg.created_at,
            }))
          } catch (dbError) {
            console.error('[WebSocket] Error fetching chat history from DB:', dbError)
          }
        }

        // 如果数据库没有数据，从内存缓存获取
        if (messages.length === 0) {
          const room = this.rooms.get(sessionId)
          if (room) {
            messages = room.messages.slice(-50).map((msg: any) => ({
              role: msg.role === 'assistant' ? 'ai' : 'user',
              text: msg.content,
              userName: msg.senderName,
              timestamp: msg.timestamp,
            }))
          }
        }

        console.log(`[WebSocket] Fetched ${messages.length} messages for wake word context in session ${sessionId}`)
        return messages
      } catch (error) {
        console.error('[WebSocket] Error in onWakeWordTriggered:', error)
        return []
      }
    }
  }

  /**
   * 处理语音AI开始会话
   */
  private async handleVoiceAIStart(
    ws: ServerWebSocket<WebSocketData>,
    chatHistory?: Array<{role: 'user' | 'ai', text: string, timestamp?: string}>,
    files?: Array<{name: string, content: string, type: 'text' | 'base64'}>,
    voiceType?: string
  ): Promise<void> {
    if (!this.enableVoiceAI || !this.voiceAIService) {
      ws.send(JSON.stringify({
        type: "voice_ai.error",
        message: "Voice AI service not enabled",
        timestamp: new Date().toISOString(),
      }))
      return
    }

    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return


    const success = await this.voiceAIService.startSession(
      sessionId,
      userId,
      userName,
      ws,
      chatHistory,
      files,
      voiceType
    )

    if (!success) {
      ws.send(JSON.stringify({
        type: "voice_ai.error",
        message: "Failed to start voice AI session",
        timestamp: new Date().toISOString(),
      }))
    }
  }

  /**
   * 处理语音AI停止会话
   */
  private async handleVoiceAIStop(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    if (!this.voiceAIService) return

    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return

    await this.voiceAIService.stopSession(sessionId, userId)

    ws.send(JSON.stringify({
      type: "voice_ai.stopped",
      sessionId,
      userId,
      timestamp: new Date().toISOString(),
    }))
  }

  /**
   * 处理语音AI音频数据
   */
  private async handleVoiceAIAudio(ws: ServerWebSocket<WebSocketData>, audioDataBase64: string): Promise<void> {
    if (!this.voiceAIService) return

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    try {
      // 将 Base64 转换为 ArrayBuffer
      const audioData = Buffer.from(audioDataBase64, 'base64')
      await this.voiceAIService.sendAudio(sessionId, userId, audioData.buffer)
    } catch (error) {
      console.error('[VoiceAI] Error processing audio:', error)
    }
  }

  /**
   * 处理语音AI文本消息
   */
  private async handleVoiceAIText(ws: ServerWebSocket<WebSocketData>, text: string): Promise<void> {
    if (!this.voiceAIService) return

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    await this.voiceAIService.sendText(sessionId, userId, text)
  }

  /**
   * 处理添加动态上下文到AI
   * 上下文会在下一次发送语音时一起发送给AI
   */
  private async handleVoiceAIAddContext(
    ws: ServerWebSocket<WebSocketData>,
    context: string,
    contextType?: string
  ): Promise<void> {
    if (!this.voiceAIService) {
      ws.send(JSON.stringify({
        type: "voice_ai.error",
        message: "Voice AI service not enabled",
        timestamp: new Date().toISOString(),
      }))
      return
    }

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    // 格式化上下文
    const formattedContext = contextType === 'file'
      ? `## 参考文件\n\n### 动态添加的文件\n${context}`
      : `## 动态添加的上下文\n\n${context}`

    const success = await this.voiceAIService.addPendingContext(sessionId, userId, formattedContext)

    if (success) {
      ws.send(JSON.stringify({
        type: "voice_ai.context_added",
        message: "上下文已添加，将在下一次语音时发送给AI",
        length: context.length,
        timestamp: new Date().toISOString(),
      }))
    } else {
      ws.send(JSON.stringify({
        type: "voice_ai.error",
        message: "添加上下文失败，请确保语音AI会话已启动",
        timestamp: new Date().toISOString(),
      }))
    }
  }

  /**
   * 处理语音AI状态查询
   */
  private async handleVoiceAIStatus(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    if (!this.voiceAIService) {
      ws.send(JSON.stringify({
        type: "voice_ai.state",
        state: null,
        timestamp: new Date().toISOString(),
      }))
      return
    }

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    const state = this.voiceAIService.getSessionState(sessionId, userId)
    ws.send(JSON.stringify({
      type: "voice_ai.state",
      state,
      timestamp: new Date().toISOString(),
    }))
  }

  /**
   * 处理添加服务器端文件到AI上下文
   */
  private async handleVoiceAIServerFile(ws: ServerWebSocket<WebSocketData>, filePath: string): Promise<void> {
    if (!this.voiceAIService) {
      ws.send(JSON.stringify({
        type: "voice_ai.error",
        message: "Voice AI service not enabled",
        timestamp: new Date().toISOString(),
      }))
      return
    }

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    try {
      // 安全检查：只允许读取指定目录下的文件
      const allowedDirs = ['data/', 'docs/', 'skills/', './data/', './docs/', './skills/']
      const isAllowed = allowedDirs.some(dir => filePath.startsWith(dir) || filePath.startsWith('./' + dir))

      if (!isAllowed && filePath.includes('..')) {
        ws.send(JSON.stringify({
          type: "voice_ai.error",
          message: "Invalid file path. Path traversal not allowed.",
          timestamp: new Date().toISOString(),
        }))
        return
      }

      // 读取文件内容
      const fullPath = path.resolve(filePath)
      const content = await fs.readFile(fullPath, 'utf-8')
      const fileName = path.basename(filePath)


      // 添加文件到当前AI会话
      const added = await this.voiceAIService.addFileToSession(sessionId, userId, fileName, content, 'text')

      // 发送成功响应
      ws.send(JSON.stringify({
        type: "voice_ai.file_added",
        fileName,
        size: content.length,
        added,
        timestamp: new Date().toISOString(),
      }))

    } catch (error) {
      console.error(`[VoiceAI] Failed to read server file:`, error)
      ws.send(JSON.stringify({
        type: "voice_ai.error",
        message: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: new Date().toISOString(),
      }))
    }
  }

  // ============================================================================
  // 共享语音AI处理
  // ============================================================================

  /**
   * 处理加入共享语音AI会话
   */
  private async handleSharedAIJoin(
    ws: ServerWebSocket<WebSocketData>,
    voiceType?: string,
    files?: Array<{name: string, content: string, type: 'text' | 'base64'}>
  ): Promise<void> {
    if (!this.enableVoiceAI || !this.voiceAIService) {
      ws.send(JSON.stringify({
        type: "shared_ai.error",
        message: "Voice AI service not enabled",
        timestamp: new Date().toISOString(),
      }))
      return
    }

    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return


    // 检查是否已有共享会话
    if (this.voiceAIService.hasSharedSession(sessionId)) {
      // 加入现有会话
      const joined = this.voiceAIService.joinSharedSession(sessionId, userId, userName)

      if (joined) {
        // 获取当前会话状态
        const state = this.voiceAIService.getSharedSessionState(sessionId)

        // 发送加入成功消息
        ws.send(JSON.stringify({
          type: "shared_ai.joined",
          sessionId,
          userId,
          state,
          timestamp: new Date().toISOString(),
        }))

        // 广播用户加入通知给房间内其他人
        const room = this.rooms.get(sessionId)
        if (room) {
          this.broadcastToRoom(room, {
            type: "shared_ai.user_joined",
            timestamp: new Date().toISOString(),
            payload: {
              userId,
              userName,
              participantCount: state?.participantCount || 0,
            },
          }, [userId])
        }

      } else {
        ws.send(JSON.stringify({
          type: "shared_ai.error",
          message: "Failed to join shared session",
          timestamp: new Date().toISOString(),
        }))
      }
    } else {
      // 创建新的共享会话（传入音色和上下文文件）
      const started = await this.voiceAIService.startSharedSession(sessionId, userId, userName, voiceType, files)

      if (started) {
        // 发送会话创建成功消息
        ws.send(JSON.stringify({
          type: "shared_ai.started",
          sessionId,
          userId,
          timestamp: new Date().toISOString(),
        }))

      } else {
        ws.send(JSON.stringify({
          type: "shared_ai.error",
          message: "Failed to start shared session",
          timestamp: new Date().toISOString(),
        }))
      }
    }
  }

  /**
   * 处理离开共享语音AI会话
   */
  private async handleSharedAILeave(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    if (!this.voiceAIService) return

    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return


    const sessionExists = await this.voiceAIService.leaveSharedSession(sessionId, userId)

    // 发送离开成功消息
    ws.send(JSON.stringify({
      type: "shared_ai.left",
      sessionId,
      userId,
      timestamp: new Date().toISOString(),
    }))

    // 如果会话还存在，广播用户离开通知
    if (sessionExists) {
      const room = this.rooms.get(sessionId)
      if (room) {
        const state = this.voiceAIService.getSharedSessionState(sessionId)
        this.broadcastToRoom(room, {
          type: "shared_ai.user_left",
          timestamp: new Date().toISOString(),
          payload: {
            userId,
            userName,
            participantCount: state?.participantCount || 0,
          },
        })
      }
    }
  }

  /**
   * 处理共享语音AI音频数据
   */
  private async handleSharedAIAudio(ws: ServerWebSocket<WebSocketData>, audioDataBase64: string, isSpeaking?: boolean): Promise<void> {
    if (!this.voiceAIService) return

    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return

    try {
      const audioData = Buffer.from(audioDataBase64, 'base64')

      // 1. 发送音频给AI服务（带isSpeaking标志）
      await this.voiceAIService.sendSharedAudio(sessionId, userId, userName, audioData.buffer, isSpeaking)

      // 2. 广播用户音频给房间内其他参与者（让用户之间可以互相听到）
      const room = this.rooms.get(sessionId)

      if (room) {
        // 每100帧打印一次日志
        if (!room.sharedAIAudioFrameCount) room.sharedAIAudioFrameCount = 0
        room.sharedAIAudioFrameCount++
        const shouldLog = room.sharedAIAudioFrameCount % 100 === 1

        if (shouldLog) {
        }

        const userAudioMessage = {
          type: 'shared_ai.user_audio',
          userId: userId,
          userName: userName,
          audioData: audioDataBase64,
          timestamp: Date.now(),
        }
        const messageStr = JSON.stringify(userAudioMessage)

        let broadcastCount = 0
        for (const [participantId, participantWs] of room.participants) {
          const isSender = participantId === userId
          const wsReady = participantWs.readyState === 1

          if (shouldLog) {
          }

          if (!isSender && wsReady) {
            try {
              participantWs.send(messageStr)
              broadcastCount++
            } catch (e) {
              console.error('[SharedVoiceAI] Failed to broadcast user audio to', participantId, e)
            }
          }
        }

        if (shouldLog) {
        }
      } else {
      }
    } catch (error) {
      console.error('[SharedVoiceAI] Error processing audio:', error)
    }
  }

  /**
   * 处理共享语音AI文本消息
   */
  private async handleSharedAIText(ws: ServerWebSocket<WebSocketData>, text: string): Promise<void> {
    if (!this.voiceAIService) return

    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return

    await this.voiceAIService.sendSharedText(sessionId, userId, userName, text)
  }

  /**
   * 处理共享语音AI添加上下文
   */
  private async handleSharedAIAddContext(
    ws: ServerWebSocket<WebSocketData>,
    context: string,
    contextType: 'text' | 'base64',
    fileName: string
  ): Promise<void> {
    if (!this.voiceAIService) return

    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return

    const success = await this.voiceAIService.addFileToSharedSession(
      sessionId,
      userId,
      userName,
      fileName,
      context,
      contextType
    )

    if (success) {
      ws.send(JSON.stringify({
        type: "shared_ai.context_added",
        fileName,
        timestamp: new Date().toISOString(),
      }))
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
        // 可以在这里处理语音结束逻辑
        return
      }
      const buffer = Buffer.from(audioData, "base64")
      // 调试日志：显示音频数据信息
      const preview = buffer.slice(0, 8).toString('hex')
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

  // ============================================================================
  // @AI 按钮 ASR 处理
  // ============================================================================

  /**
   * 处理 @AI 按钮 ASR 开始
   */
  private async handleAIButtonASRStart(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    if (!this.voiceChatService || !this.voiceChatService.isEnabled()) {
      ws.send(JSON.stringify({
        type: "ai_button_asr.result",
        text: "",
        isFinal: true,
        error: "ASR 服务未启用"
      }))
      return
    }

    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    // 如果已有会话，先关闭
    const existingSession = this.aiButtonASRSessions.get(userId)
    if (existingSession && existingSession.asrConnection) {
      existingSession.asrConnection.close()
    }

    // 创建新会话
    const session = {
      ws,
      asrConnection: null as WebSocket | null,
      asrReady: false,
      audioBuffer: [] as ArrayBuffer[],
      timestamp: Date.now(),  // 记录创建时间
      // 去重相关
      lastSentText: '',
      lastSentTime: 0
    }
    this.aiButtonASRSessions.set(userId, session)

    // 获取 ASR 配置
    const config = this.voiceChatService.getConfig()
    const wsUrl = config.endpoint

    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
    }

    if (config.useOpenAIStyle) {
      headers["OpenAI-Beta"] = "realtime=v1"
    } else {
      headers["X-DashScope-DataInspection"] = "enable"
    }

    try {
      const asrWs = new WebSocket(wsUrl, { headers })
      session.asrConnection = asrWs

      asrWs.onopen = () => {
        if (config.useOpenAIStyle) {
          // Qwen3-ASR-Flash: 发送 session.update 配置
          const sessionUpdate = {
            event_id: `event_${Date.now()}`,
            type: "session.update",
            session: {
              modalities: ["text"],
              input_audio_format: "pcm",
              sample_rate: 16000,
              input_audio_transcription: {
                language: "zh"
              },
              turn_detection: null // 禁用服务端 VAD，手动控制
            }
          }
          asrWs.send(JSON.stringify(sessionUpdate))
        } else {
          // 旧版 paraformer: 发送 run-task 消息
          const runTaskMessage = {
            header: {
              action: "run-task",
              task_id: `ai_btn_${userId}_${Date.now()}`,
              streaming: "duplex"
            },
            payload: {
              task_group: "audio",
              task: "asr",
              function: "recognition",
              model: config.model,
              parameters: {
                format: "pcm",
                sample_rate: 16000,
                disfluency_removal_enabled: false
              },
              input: {}
            }
          }
          asrWs.send(JSON.stringify(runTaskMessage))
        }
      }

      asrWs.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string)
          this.handleAIButtonASRMessage(userId, data, config.useOpenAIStyle)
        } catch (error) {
          console.error("[AI Button ASR] Failed to parse message:", error)
        }
      }

      asrWs.onerror = (error) => {
        console.error(`[AI Button ASR] WebSocket error for ${userId}:`, error)
      }

      asrWs.onclose = () => {
        const s = this.aiButtonASRSessions.get(userId)
        if (s) {
          s.asrReady = false
          s.asrConnection = null
        }
      }
    } catch (error) {
      console.error("[AI Button ASR] Failed to connect:", error)
      ws.send(JSON.stringify({
        type: "ai_button_asr.result",
        text: "",
        isFinal: true,
        error: "ASR 连接失败"
      }))
    }
  }

  /**
   * 处理 @AI 按钮 ASR 音频数据
   */
  private async handleAIButtonASRAudio(ws: ServerWebSocket<WebSocketData>, audioData: string): Promise<void> {
    const { userId } = ws.data
    if (!userId) return

    const session = this.aiButtonASRSessions.get(userId)
    if (!session || !session.asrConnection) return

    if (!session.asrReady) {
      // 缓冲音频数据
      try {
        const buffer = Buffer.from(audioData, "base64")
        session.audioBuffer.push(buffer)
        if (session.audioBuffer.length > 100) {
          session.audioBuffer.shift()
        }
      } catch (error) {
        console.error("[AI Button ASR] Failed to buffer audio:", error)
      }
      return
    }

    if (session.asrConnection.readyState !== WebSocket.OPEN) return

    try {
      const config = this.voiceChatService!.getConfig()
      if (config.useOpenAIStyle) {
        // Qwen3-ASR-Flash OpenAI 风格
        session.asrConnection.send(JSON.stringify({
          event_id: `event_${Date.now()}`,
          type: "input_audio_buffer.append",
          audio: audioData
        }))
      } else {
        // 旧版 paraformer
        const buffer = Buffer.from(audioData, "base64")
        session.asrConnection.send(buffer)
      }
    } catch (error) {
      console.error("[AI Button ASR] Failed to send audio:", error)
    }
  }

  /**
   * 处理 @AI 按钮 ASR 停止
   */
  private async handleAIButtonASRStop(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    const { userId } = ws.data
    if (!userId) return

    const session = this.aiButtonASRSessions.get(userId)
    if (!session) return

    // 发送结束信号
    if (session.asrConnection && session.asrConnection.readyState === WebSocket.OPEN) {
      const config = this.voiceChatService!.getConfig()
      if (config.useOpenAIStyle) {
        // Qwen3-ASR-Flash: 发送 finish
        session.asrConnection.send(JSON.stringify({
          event_id: `event_${Date.now()}`,
          type: "session.finish"
        }))
      }

      // 延迟关闭连接，等待最后的结果
      setTimeout(() => {
        if (session.asrConnection) {
          session.asrConnection.close()
          session.asrConnection = null
        }
        this.aiButtonASRSessions.delete(userId)
      }, 500)
    } else {
      this.aiButtonASRSessions.delete(userId)
    }
  }

  /**
   * 处理 @AI 按钮 ASR 消息
   */
  private handleAIButtonASRMessage(userId: string, data: any, useOpenAIStyle: boolean): void {
    const session = this.aiButtonASRSessions.get(userId)
    if (!session) return

    // 去重辅助函数
    const sendResultWithDeduplication = (text: string, isFinal: boolean) => {
      const now = Date.now()
      // 检查是否是重复结果（相同文本且在500ms内）
      if (text === session.lastSentText && (now - session.lastSentTime) < 500) {
        console.log(`[AI Button ASR] Duplicate result ignored for ${userId}: ${text}`)
        return
      }
      // 更新最后发送记录
      session.lastSentText = text
      session.lastSentTime = now
      // 发送结果
      session.ws.send(JSON.stringify({
        type: "ai_button_asr.result",
        text: text,
        isFinal: isFinal
      }))
    }

    if (useOpenAIStyle) {
      // Qwen3-ASR-Flash OpenAI 风格响应
      switch (data.type) {
        case "session.created":
          session.asrReady = true
          // 发送缓冲的音频数据
          for (const audioBuffer of session.audioBuffer) {
            const base64 = audioBuffer.toString("base64")
            session.asrConnection?.send(JSON.stringify({
              event_id: `event_${Date.now()}`,
              type: "input_audio_buffer.append",
              audio: base64
            }))
          }
          session.audioBuffer = []
          break

        case "input_audio_buffer.transcript":
          // 最终结果
          if (data.transcript) {
            sendResultWithDeduplication(data.transcript, true)
          }
          break

        case "conversation.item.input_audio_transcription.completed":
          // 另一种最终结果格式
          if (data.transcript) {
            sendResultWithDeduplication(data.transcript, true)
          }
          break

        case "input_audio_buffer.speech_stopped":
          // 语音停止，可以触发提交
          session.asrConnection?.send(JSON.stringify({
            event_id: `event_${Date.now()}`,
            type: "input_audio_buffer.commit"
          }))
          session.asrConnection?.send(JSON.stringify({
            event_id: `event_${Date.now()}`,
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: []
            }
          }))
          break

        case "error":
          console.error("[AI Button ASR] Error:", data.error)
          break
      }
    } else {
      // 旧版 paraformer 响应
      if (data.header?.event === "task-started") {
        session.asrReady = true
        // 发送缓冲的音频数据
        for (const audioBuffer of session.audioBuffer) {
          session.asrConnection?.send(audioBuffer)
        }
        session.audioBuffer = []
      } else if (data.header?.event === "result-generated") {
        const text = data.payload?.output?.sentence?.text || data.payload?.output?.subtitle?.text
        if (text) {
          const isFinal = !!data.payload?.output?.sentence?.text
          sendResultWithDeduplication(text, isFinal)
        }
      } else if (data.header?.event === "error") {
        console.error("[AI Button ASR] Error:", data)
      }
    }
  }

  // ============================================================================
  // 聊天室语音AI处理（复用共享语音AI，带唤醒词模式）
  // ============================================================================

  // 聊天室语音AI会话管理
  private chatVoiceAISessions: Map<string, {
    sessionId: string
    userId: string
    userName: string
    mode: 'realtime' | 'wakeword'
    wakeWords: string[]
  }> = new Map()

  /**
   * 处理聊天室语音AI加入
   */
  private async handleChatVoiceAIJoin(
    ws: ServerWebSocket<WebSocketData>,
    voiceType?: string
  ): Promise<void> {
    if (!this.voiceAIService) {
      ws.send(JSON.stringify({
        type: "chat_voice_ai.error",
        error: "语音AI服务未启用"
      }))
      return
    }

    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return

    // 保存会话信息
    this.chatVoiceAISessions.set(userId, {
      sessionId,
      userId,
      userName: userName || userId,
      mode: 'wakeword', // 默认使用唤醒词模式
      wakeWords: ['AI', 'ai', 'Ai', '小爱', '小艾', '哎', '诶'] // 默认唤醒词
    })

    // 检查是否已有共享会话
    if (this.voiceAIService.hasSharedSession(sessionId)) {
      // 加入现有会话（不发送聊天记录，只有第一个用户才发送）
      this.voiceAIService.joinSharedSession(sessionId, userId, userName || userId)
    } else {
      // 第一个用户创建新的共享会话：获取聊天历史，在会话开始时发送给AI
      let chatHistory: Array<{role: 'user' | 'ai', text: string, userName?: string, timestamp?: string}> = []

      if (this.enableDatabase && this.db) {
        try {
          const dbMessages = await this.db.getMessages(sessionId, 30)
          chatHistory = dbMessages.map((msg: any) => ({
            role: msg.role === 'assistant' ? 'ai' : 'user',
            text: msg.content,
            userName: msg.sender_name,
            timestamp: msg.created_at,
          }))
          console.log(`[WebSocket] Fetched ${chatHistory.length} messages for voice AI context in session ${sessionId}`)
        } catch (dbError) {
          console.error('[ChatVoiceAI] Error fetching chat history from DB:', dbError)
        }
      }

      // 创建新的共享会话，传入聊天历史
      const started = await this.voiceAIService.startSharedSession(
        sessionId,
        userId,
        userName || userId,
        voiceType || 'zh_female_tianmeixiaoyuan_moon_bigtts',
        [],
        chatHistory
      )

      if (!started) {
        ws.send(JSON.stringify({
          type: "chat_voice_ai.error",
          error: "无法启动语音AI服务"
        }))
        this.chatVoiceAISessions.delete(userId)
        return
      }
    }

    // 设置回调
    this.setupChatVoiceAICallbacks(sessionId)

    ws.send(JSON.stringify({
      type: "chat_voice_ai.started"
    }))

    console.log(`[ChatVoiceAI] User ${userName} joined chat voice AI in session ${sessionId}`)
  }

  /**
   * 设置聊天室语音AI回调
   */
  private setupChatVoiceAICallbacks(sessionId: string): void {
    if (!this.voiceAIService) return

    // 状态变化回调
    this.voiceAIService.onSharedAIStateChange = (sid, state, data) => {
      if (sid !== sessionId) return

      const room = this.rooms.get(sid)
      if (!room) return

      // 广播状态变化给所有聊天室语音AI用户
      const message = {
        type: "chat_voice_ai.state",
        state: state,
        userId: data?.userId,
        userName: data?.userName
      }

      for (const [participantId, participant] of room.participants) {
        if (this.chatVoiceAISessions.has(participantId)) {
          participant.send(JSON.stringify(message))
        }
      }
    }

    // ASR 结果回调
    this.voiceAIService.onSharedASRResult = async (sid, userId, userName, text, isInterim) => {
      if (sid !== sessionId) return

      const room = this.rooms.get(sid)
      if (!room) return

      const message = {
        type: "chat_voice_ai.asr",
        userId,
        userName,
        text,
        isFinal: !isInterim
      }

      // 广播给所有聊天室语音AI用户
      for (const [participantId, participant] of room.participants) {
        if (this.chatVoiceAISessions.has(participantId)) {
          participant.send(JSON.stringify(message))
        }
      }

      // 最终结果时保存到数据库
      if (!isInterim && text) {
        const chatMessage: ChatMessage = {
          id: `voice_ai_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sessionId: sid,
          senderId: userId,
          senderName: userName,
          senderRole: "member",
          type: "text",
          content: `[语音] ${text}`,
          mentions: [],
          mentionsAI: false,
          timestamp: new Date().toISOString(),
        }

        // 添加到房间消息列表
        room.messages.push(chatMessage)
        if (room.messages.length > 1000) {
          room.messages = room.messages.slice(-1000)
        }

        // 保存到数据库
        if (this.enableDatabase && this.db) {
          try {
            await this.db.saveMessage(sid, chatMessage)
          } catch (error) {
            console.error("[ChatVoiceAI] Failed to save ASR message to database:", error)
          }
        }
      }
    }

    // AI 响应回调
    this.voiceAIService.onSharedAIResponse = async (sid, text) => {
      if (sid !== sessionId) return

      const room = this.rooms.get(sid)
      if (!room) return

      const message = {
        type: "chat_voice_ai.response",
        text
      }

      // 广播给所有聊天室语音AI用户
      for (const [participantId, participant] of room.participants) {
        if (this.chatVoiceAISessions.has(participantId)) {
          participant.send(JSON.stringify(message))
        }
      }

      // 保存 AI 响应到数据库
      if (text) {
        const aiMessage: ChatMessage = {
          id: `voice_ai_response_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sessionId: sid,
          senderId: 'ai_assistant',
          senderName: '智能助手',
          senderRole: "assistant",
          type: "text",
          content: text,
          mentions: [],
          mentionsAI: false,
          timestamp: new Date().toISOString(),
        }

        // 添加到房间消息列表
        room.messages.push(aiMessage)
        if (room.messages.length > 1000) {
          room.messages = room.messages.slice(-1000)
        }

        // 保存到数据库
        if (this.enableDatabase && this.db) {
          try {
            await this.db.saveMessage(sid, aiMessage)
          } catch (error) {
            console.error("[ChatVoiceAI] Failed to save AI response to database:", error)
          }
        }
      }
    }

    // AI 音频回调
    this.voiceAIService.onSharedAIAudio = (sid, audioData) => {
      if (sid !== sessionId) return

      const room = this.rooms.get(sid)
      if (!room) return

      // 将 ArrayBuffer 转换为 base64 字符串
      const audioBuffer = Buffer.from(audioData)
      const base64Audio = audioBuffer.toString('base64')

      const message = {
        type: "chat_voice_ai.audio",
        audioData: base64Audio
      }

      // 广播给所有聊天室语音AI用户
      for (const [participantId, participant] of room.participants) {
        if (this.chatVoiceAISessions.has(participantId)) {
          participant.send(JSON.stringify(message))
        }
      }
    }
  }

  /**
   * 处理聊天室语音AI音频数据
   */
  private async handleChatVoiceAIAudio(
    ws: ServerWebSocket<WebSocketData>,
    audioData: string,
    isSpeaking?: boolean
  ): Promise<void> {
    const { sessionId, userId, userName } = ws.data
    if (!sessionId || !userId) return

    const session = this.chatVoiceAISessions.get(userId)
    if (!session) return

    if (!this.voiceAIService) return

    // 将 base64 字符串转换为 Buffer
    const audioBuffer = Buffer.from(audioData, 'base64')

    // 发送音频到共享语音AI服务
    await this.voiceAIService.sendSharedAudio(
      sessionId,
      userId,
      userName || userId,
      audioBuffer,
      isSpeaking ?? true
    )

    // 广播音频给其他参与者（实现实时语音对讲功能）
    // 获取同一房间的所有参与者
    const room = this.rooms.get(sessionId)
    if (room) {
      const audioMessage = {
        type: "voice.audio",
        userId: userId,
        userName: userName || userId,
        audioData: audioData,
        isSpeech: isSpeaking ?? true,
        timestamp: Date.now(),
      }

      const messageStr = JSON.stringify(audioMessage)

      // 广播给房间内的其他参与者
      for (const [participantId, participantWs] of room.participants) {
        if (participantId === userId) continue // 跳过自己
        if (participantWs.readyState !== WebSocket.OPEN) continue

        try {
          participantWs.send(messageStr)
        } catch (error) {
          console.error(`[ChatVoiceAI] Failed to broadcast audio to ${participantId}:`, error)
        }
      }
    }
  }

  /**
   * 处理聊天室语音AI离开
   */
  private async handleChatVoiceAILeave(ws: ServerWebSocket<WebSocketData>): Promise<void> {
    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    const session = this.chatVoiceAISessions.get(userId)
    if (!session) return

    // 从共享语音AI服务离开
    if (this.voiceAIService) {
      this.voiceAIService.leaveSharedSession(sessionId, userId)
    }

    this.chatVoiceAISessions.delete(userId)

    ws.send(JSON.stringify({
      type: "chat_voice_ai.stopped"
    }))

    console.log(`[ChatVoiceAI] User ${userId} left chat voice AI`)
  }

  /**
   * 处理聊天室语音AI模式设置
   */
  private async handleChatVoiceAISetMode(
    ws: ServerWebSocket<WebSocketData>,
    mode: 'realtime' | 'wakeword'
  ): Promise<void> {
    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    const session = this.chatVoiceAISessions.get(userId)
    if (!session) return

    // 更新模式
    session.mode = mode

    // 更新共享语音AI的唤醒词模式
    if (this.voiceAIService) {
      this.voiceAIService.setSharedWakeWordMode(sessionId, mode === 'wakeword')
    }

    ws.send(JSON.stringify({
      type: "chat_voice_ai.mode_changed",
      mode: mode
    }))

    console.log(`[ChatVoiceAI] User ${userId} changed mode to ${mode}`)
  }

  /**
   * 处理聊天室语音AI设置唤醒词
   */
  private async handleChatVoiceAISetWakeWords(
    ws: ServerWebSocket<WebSocketData>,
    wakeWords: string[]
  ): Promise<void> {
    const { sessionId, userId } = ws.data
    if (!sessionId || !userId) return

    const session = this.chatVoiceAISessions.get(userId)
    if (!session) return

    // 更新会话的唤醒词
    session.wakeWords = wakeWords

    // 更新共享语音AI的自定义唤醒词
    if (this.voiceAIService) {
      this.voiceAIService.setSharedCustomWakeWords(sessionId, wakeWords)
    }

    ws.send(JSON.stringify({
      type: "chat_voice_ai.wakewords_changed",
      wakeWords: wakeWords
    }))

    console.log(`[ChatVoiceAI] User ${userId} changed wake words to: ${wakeWords.join(', ')}`)
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

  /**
   * 处理消息翻译请求
   */
  private async handleTranslateMessage(
    ws: ServerWebSocket<WebSocketData>,
    messageId: string,
    text: string,
    targetLanguage: string
  ): Promise<void> {
    const { sessionId, userId } = ws.data

    try {
      // 检查AI服务是否可用
      if (!this.aiService || !this.aiService.isAvailable()) {
        ws.send(JSON.stringify({
          type: "translation_error",
          messageId,
          error: "Translation service not available",
        }))
        return
      }

      console.log(`[WebSocket] Translating message ${messageId} to ${targetLanguage} for user ${userId}`)

      // 调用翻译服务
      const translatedText = await this.aiService.translateText(text, targetLanguage)

      // 发送翻译结果给请求者
      ws.send(JSON.stringify({
        type: "translation_result",
        messageId,
        originalText: text,
        translatedText,
        targetLanguage,
      }))

      console.log(`[WebSocket] Translation completed for message ${messageId}`)

    } catch (error) {
      console.error("[WebSocket] Translation error:", error)
      ws.send(JSON.stringify({
        type: "translation_error",
        messageId,
        error: error instanceof Error ? error.message : "Translation failed",
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
        } catch (ossError) {
          console.error("[WebSocket] Failed to delete from OSS:", ossError)
          // 继续删除数据库记录
        }
      }

      // 从数据库删除记录
      if (this.enableDatabase && this.db) {
        await this.db.deleteFile(fileId)
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
        } catch (ossError) {
          console.error("[WebSocket] Failed to rename in OSS:", ossError)
          // 继续更新数据库记录
        }
      }

      // 更新数据库记录
      if (this.enableDatabase && this.db) {
        await this.db.renameFile(fileId, newFileName, newOssUrl, newOssKey)
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


  const server = new MultiplayerWebSocketServer({
    port,
    heartbeatInterval: 30000,
    heartbeatTimeout: 60000,
  })

  // Initialize database and OSS
  await server.initialize()

  server.start()


  // 优雅关闭
  process.on("SIGINT", async () => {
    const db = getDatabaseManager()
    await db.disconnect()
    server.stop()
    process.exit(0)
  })
}
