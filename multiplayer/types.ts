/**
 * Multiplayer Chat Types
 * 多人协作聊天类型定义
 *
 * 扩展 OpenCode 现有消息系统，支持多人实时协作
 */

import type { MessageV2 } from "@/session/message-v2"
import { z } from "zod"
import { parseMentions } from "./mention"

// =============================================================================
// 角色系统 (Role System)
// =============================================================================

export type UserRole = "owner" | "admin" | "member" | "guest" | "ai"

export const UserRoleSchema = z.enum(["owner", "admin", "member", "guest", "ai"])

export interface Participant {
  id: string
  name: string
  avatar?: string
  role: UserRole
  status: "online" | "away" | "offline"
  joinedAt: string
  lastSeen: string
  /** 用户偏好设置 */
  preferences?: UserPreferences
}

export const ParticipantSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatar: z.string().optional(),
  role: UserRoleSchema,
  status: z.enum(["online", "away", "offline"]),
  joinedAt: z.string(),
  lastSeen: z.string(),
  preferences: z.object({
    language: z.string().optional(),
    theme: z.string().optional(),
    notifications: z.boolean().optional(),
  }).optional(),
})

// =============================================================================
// 用户偏好设置
// =============================================================================

export interface UserPreferences {
  /** 界面语言 */
  language?: string
  /** 主题 */
  theme?: "light" | "dark" | "system"
  /** 是否启用通知 */
  notifications?: boolean
  /** 代码风格偏好 */
  codingStyle?: "functional" | "object-oriented" | "mixed"
  /** 常用编程语言 */
  preferredLanguages?: string[]
  /** AI 触发模式 */
  aiTriggerMode?: "mention" | "auto" | "manual"
}

// =============================================================================
// 扩展消息类型 (Extended Message Types)
// =============================================================================

export type ChatMessageType =
  | "text"
  | "image"
  | "voice"
  | "file"
  | "code"
  | "system"
  | "ai_thinking"

export const ChatMessageTypeSchema = z.enum([
  "text",
  "image",
  "voice",
  "file",
  "code",
  "system",
  "ai_thinking",
])

/** 语音数据 */
export interface VoiceData {
  /** 语音文件 URL */
  url: string
  /** 语音时长（秒） */
  duration: number
  /** 转录文本 */
  transcript?: string
  /** 转录状态 */
  transcriptStatus: "pending" | "completed" | "failed"
  /** 转录错误信息 */
  transcriptError?: string
}

export const VoiceDataSchema = z.object({
  url: z.string(),
  duration: z.number(),
  transcript: z.string().optional(),
  transcriptStatus: z.enum(["pending", "completed", "failed"]),
  transcriptError: z.string().optional(),
})

/** 图片数据 */
export interface ImageData {
  url: string
  width: number
  height: number
  /** 缩略图 URL */
  thumbnailUrl?: string
  /** 文件大小（字节） */
  size?: number
  /** MIME 类型 */
  mime?: string
}

export const ImageDataSchema = z.object({
  url: z.string(),
  width: z.number(),
  height: z.number(),
  thumbnailUrl: z.string().optional(),
  size: z.number().optional(),
  mime: z.string().optional(),
})

/** 文件数据 */
export interface FileData {
  url: string
  filename: string
  size: number
  mime: string
}

export const FileDataSchema = z.object({
  url: z.string(),
  filename: z.string(),
  size: z.number(),
  mime: z.string(),
})

/** 代码片段数据 */
export interface CodeData {
  language: string
  code: string
  /** 代码描述/标题 */
  description?: string
}

export const CodeDataSchema = z.object({
  language: z.string(),
  code: z.string(),
  description: z.string().optional(),
})

/** 系统消息子类型 */
export type SystemMessageSubtype =
  | "user_joined"
  | "user_left"
  | "user_role_changed"
  | "session_renamed"
  | "ai_enabled_changed"
  | "file_shared"
  | "ai_triggered"

export const SystemMessageSubtypeSchema = z.enum([
  "user_joined",
  "user_left",
  "user_role_changed",
  "session_renamed",
  "ai_enabled_changed",
  "file_shared",
  "ai_triggered",
])

// =============================================================================
// 聊天消息接口 (Chat Message Interface)
// =============================================================================

export interface ChatMessage {
  id: string
  sessionId: string
  /** 发送者 ID */
  senderId: string
  /** 发送者名称 */
  senderName: string
  /** 发送者角色 */
  senderRole: UserRole
  /** 消息类型 */
  type: ChatMessageType
  /** 消息内容（纯文本或 Markdown） */
  content: string

  // 特定类型数据
  voiceData?: VoiceData
  imageData?: ImageData
  fileData?: FileData
  codeData?: CodeData
  systemSubtype?: SystemMessageSubtype
  systemData?: Record<string, unknown>

  /** 被 @ 提及的用户 ID 列表 */
  mentions: string[]
  /** 是否包含 @ai */
  mentionsAI: boolean

  /** 消息时间戳 */
  timestamp: string
  /** 编辑时间 */
  editedAt?: string
  /** 回复的消息 ID */
  replyTo?: string

  /** AI 思考过程（仅 ai_thinking 类型） */
  thinkingProcess?: string
  /** AI 使用的工具调用 */
  toolCalls?: Array<{
    tool: string
    input: unknown
    output?: unknown
  }>
}

export const ChatMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  senderId: z.string(),
  senderName: z.string(),
  senderRole: UserRoleSchema,
  type: ChatMessageTypeSchema,
  content: z.string(),

  voiceData: VoiceDataSchema.optional(),
  imageData: ImageDataSchema.optional(),
  fileData: FileDataSchema.optional(),
  codeData: CodeDataSchema.optional(),
  systemSubtype: SystemMessageSubtypeSchema.optional(),
  systemData: z.record(z.unknown()).optional(),

  mentions: z.array(z.string()),
  mentionsAI: z.boolean(),

  timestamp: z.string(),
  editedAt: z.string().optional(),
  replyTo: z.string().optional(),

  thinkingProcess: z.string().optional(),
  toolCalls: z.array(z.object({
    tool: z.string(),
    input: z.unknown(),
    output: z.unknown().optional(),
  })).optional(),
})

// =============================================================================
// 会话配置 (Session Configuration)
// =============================================================================

export interface SessionConfig {
  id: string
  name: string
  description?: string

  /** 参与者列表 */
  participants: Participant[]

  /** 是否启用 AI */
  aiEnabled: boolean
  /** AI 触发模式 */
  aiTriggerMode: "mention" | "auto" | "manual"
  /** 默认 AI Agent */
  defaultAgent?: string
  /** 默认模型 */
  defaultModel?: {
    providerID: string
    modelID: string
  }

  /** 本地共享文件工作区路径 */
  fileWorkspacePath: string
  /** JSON 记忆文件路径 */
  memoryFilePath: string

  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string

  /** 会话设置 */
  settings: SessionSettings
}

export interface SessionSettings {
  /** 最大消息历史数量 */
  maxHistoryMessages: number
  /** 是否允许访客加入 */
  allowGuests: boolean
  /** 是否自动保存 */
  autoSave: boolean
  /** 语音自动转录 */
  autoTranscribe: boolean
  /** 代码执行权限 */
  codeExecutionPermission: "all" | "admin" | "none"
}

export const SessionConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  participants: z.array(ParticipantSchema),
  aiEnabled: z.boolean(),
  aiTriggerMode: z.enum(["mention", "auto", "manual"]),
  defaultAgent: z.string().optional(),
  defaultModel: z.object({
    providerID: z.string(),
    modelID: z.string(),
  }).optional(),
  fileWorkspacePath: z.string(),
  memoryFilePath: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: z.object({
    maxHistoryMessages: z.number().default(1000),
    allowGuests: z.boolean().default(true),
    autoSave: z.boolean().default(true),
    autoTranscribe: z.boolean().default(true),
    codeExecutionPermission: z.enum(["all", "admin", "none"]).default("admin"),
  }),
})

// =============================================================================
// JSON 记忆结构 (JSON Memory Structure)
// =============================================================================

export interface SessionMemory {
  /** 用户偏好记忆 */
  userPreferences: Record<string, UserPreferences>
  /** AI 上下文记忆 */
  aiContext: {
    /** 最近讨论的主题 */
    recentTopics: string[]
    /** 已做出的决策 */
    decisions: string[]
    /** 待办事项 */
    actionItems: string[]
    /** 重要代码片段 */
    codeSnippets: Array<{
      description: string
      code: string
      language: string
    }>
  }
  /** 文件索引 */
  fileIndex: {
    /** 最近使用的文件 */
    recentFiles: string[]
    /** 常用代码模式 */
    frequentPatterns: string[]
  }
  /** 会话元数据 */
  metadata: {
    lastSummarizedAt?: string
    messageCount: number
    summary?: string
  }
}

export interface GlobalMemory {
  version: string
  sessions: Record<string, SessionMemory>
  global: {
    userProfiles: Record<string, Participant>
    aiAgents: Record<string, {
      model: string
      temperature?: number
      systemPrompt?: string
    }>
  }
}

// =============================================================================
// WebSocket 事件类型
// =============================================================================

export type WebSocketEventType =
  | "connection.established"
  | "connection.closed"
  | "user.joined"
  | "user.left"
  | "user.status_changed"
  | "message.new"
  | "message.updated"
  | "message.deleted"
  | "message.reaction"
  | "typing.start"
  | "typing.stop"
  | "file.shared"
  | "voice.transcribed"
  | "ai.thinking"
  | "ai.response"
  | "error"
  // 语音聊天事件类型
  | "voice.join"
  | "voice.leave"
  | "voice.start_speaking"
  | "voice.stop_speaking"
  | "voice.transcript"
  | "voice.transcript.final"
  | "voice.ai_analyze"
  | "voice.error"
  // 语音AI事件类型
  | "voice_ai.started"
  | "voice_ai.stopped"
  | "voice_ai.error"
  | "voice_ai.asr"
  | "voice_ai.response"
  | "voice_ai.audio"
  | "voice_ai.state"

export interface WebSocketEvent {
  type: WebSocketEventType
  timestamp: string
  senderId?: string
  payload: unknown
}

// =============================================================================
// 工具函数
// =============================================================================

/**
 * 创建新的聊天消息
 */
export function createChatMessage(
  params: Omit<ChatMessage, "id" | "timestamp" | "mentions" | "mentionsAI">
): ChatMessage {
  const { users, hasAI } = parseMentions(params.content)

  return {
    id: generateMessageId(),
    timestamp: new Date().toISOString(),
    mentions: users,
    mentionsAI: hasAI,
    ...params,
  }
}

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

/**
 * 将现有的 MessageV2 转换为 ChatMessage
 */
export function convertFromMessageV2(
  message: MessageV2.WithParts,
  sender: Participant
): ChatMessage {
  const textParts = message.parts
    .filter((p): p is MessageV2.TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n")

  const { users, hasAI } = parseMentions(textParts)

  return {
    id: message.info.id,
    sessionId: message.info.sessionID,
    senderId: sender.id,
    senderName: sender.name,
    senderRole: sender.role,
    type: "text",
    content: textParts,
    mentions: users,
    mentionsAI: hasAI,
    timestamp: new Date(message.info.time.created).toISOString(),
  }
}

// =============================================================================
// 语音AI状态
// =============================================================================

export interface VoiceAIState {
  isSessionActive: boolean
  isListening: boolean
  isSpeaking: boolean
  currentTranscript: string
  lastResponse: string
}

// =============================================================================
// AI 任务规划系统
// =============================================================================

/** 任务状态 */
export type TaskStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped"

/** 单个任务项 */
export interface TaskItem {
  /** 任务 ID */
  id: string
  /** 任务标题 */
  title: string
  /** 任务描述 */
  description?: string
  /** 任务状态 */
  status: TaskStatus
  /** 执行结果 */
  result?: string
  /** 错误信息 */
  error?: string
  /** 开始时间 */
  startTime?: string
  /** 完成时间 */
  endTime?: string
}

/** 任务计划 */
export interface TaskPlan {
  /** 计划 ID */
  planId: string
  /** 计划标题 */
  title: string
  /** 总体描述 */
  description?: string
  /** 任务列表 */
  tasks: TaskItem[]
  /** 当前执行的任务索引 */
  currentTaskIndex: number
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
  /** 整体状态 */
  status: "planning" | "executing" | "completed" | "failed" | "paused"
}

/** 任务进度信息 */
export interface TaskProgress {
  /** 计划 ID */
  planId: string
  /** 总任务数 */
  totalTasks: number
  /** 已完成任务数 */
  completedTasks: number
  /** 当前任务索引 */
  currentTaskIndex: number
  /** 当前任务标题 */
  currentTaskTitle?: string
  /** 整体状态 */
  status: TaskPlan["status"]
  /** 进度百分比 (0-100) */
  progressPercent: number
}

/** 任务规划工具参数 */
export interface PlanTasksArgs {
  /** 计划标题 */
  title: string
  /** 任务列表 */
  tasks: Array<{
    title: string
    description?: string
  }>
}

/** 任务更新工具参数 */
export interface UpdateTaskArgs {
  /** 任务 ID */
  taskId: string
  /** 新状态 */
  status: TaskStatus
  /** 执行结果 */
  result?: string
  /** 错误信息 */
  error?: string
}
