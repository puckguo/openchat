/**
 * Voice AI Service
 * 火山引擎豆包端到端实时语音大模型服务
 *
 * 文档：https://www.volcengine.com/docs/6561/1594356
 */

import type { ServerWebSocket } from "bun"
import WebSocket from "ws"  // 使用ws库支持自定义headers
import type { WebSocket as WebSocketType } from "ws"  // 导入类型
import { gunzipSync } from "zlib"

// =============================================================================
// 类型定义
// =============================================================================

export interface VoiceAIConfig {
  appId: string
  accessToken: string
  secretKey: string
  endpoint: string
  apiAppKey: string
  apiResourceId: string
}

export interface VoiceAISession {
  sessionId: string
  userId: string
  userName: string
  ws: ServerWebSocket<unknown>
  volcanoWs: WebSocketType | null
  volcanoSessionId: string
  isReady: boolean
  audioBuffer: ArrayBuffer[]
  reconnectAttempts: number
  lastActivityTime: number
  dialogId: string  // 用于接续对话
  chatHistory?: Array<{role: 'user' | 'ai', text: string, timestamp?: string}>
  files?: Array<{name: string, content: string, type: 'text' | 'base64'}>
  pendingContext?: string  // 待发送的动态上下文
  isClosing?: boolean  // 标记是否正在关闭会话
  voiceType?: string  // 音色类型
}

export interface VoiceAIState {
  isSessionActive: boolean
  isListening: boolean
  isSpeaking: boolean
  currentTranscript: string
  lastResponse: string
}

// 共享语音AI会话接口
export interface SharedVoiceAISession {
  sessionId: string
  volcanoWs: WebSocketType | null
  volcanoSessionId: string
  isReady: boolean
  participantUserIds: Set<string>
  participantNames: Map<string, string>  // userId -> userName
  currentSpeakerId: string | null
  currentSpeakerName: string | null
  createdAt: number
  lastActivityTime: number
  dialogId: string
  audioBuffer: ArrayBuffer[]
  reconnectAttempts: number
  isClosing?: boolean
  voiceType?: string  // 音色类型
  files?: Array<{name: string, content: string, type: 'text' | 'base64'}>  // 上下文文件
  // 说话状态追踪
  speakingUserIds: Set<string>  // 当前正在说话的用户ID集合
  lastSpeakingHintTime: number  // 上次发送说话提示的时间
  // AI唤醒模式
  wakeWordMode: boolean  // 是否启用唤醒词模式
  customWakeWords?: string[]  // 自定义唤醒词列表
  recentTranscripts: Array<{userId: string, userName: string, text: string, timestamp: number}>  // 最近的ASR结果作为context
  aiTriggered: boolean  // 当前是否已触发AI
  triggerText: string  // 触发AI的文本
  wakeWordDetected: boolean  // 当前对话是否检测到唤醒词
}

// 共享语音AI会话状态
export interface SharedVoiceAIState {
  isActive: boolean
  isReady: boolean
  participantCount: number
  participants: Array<{ userId: string; userName: string }>
  currentSpeaker: { userId: string; userName: string } | null
}

// =============================================================================
// 二进制协议常量 (根据官方文档)
// =============================================================================

const PROTOCOL_VERSION = 0b0001
const HEADER_SIZE = 0b0001

// Message Types
const MSG_TYPE_FULL_CLIENT = 0b0001      // 客户端发送文本事件
const MSG_TYPE_AUDIO_CLIENT = 0b0010     // 客户端发送音频数据
const MSG_TYPE_FULL_SERVER = 0b1001      // 服务器返回的文本事件
const MSG_TYPE_AUDIO_SERVER = 0b1011     // 服务器返回音频数据
const MSG_TYPE_ERROR = 0b1111            // 服务器返回错误事件

// Serialization Types
const SERIALIZATION_JSON = 0b0001
const SERIALIZATION_RAW = 0b0000

// Compression Types
const COMPRESSION_NONE = 0b0000
const COMPRESSION_GZIP = 0b0001

// Message type specific flags
const FLAGS_WITH_EVENT = 0b0100  // 携带事件ID

// 客户端事件ID
const EVENT_START_CONNECTION = 1
const EVENT_FINISH_CONNECTION = 2
const EVENT_START_SESSION = 100
const EVENT_FINISH_SESSION = 102
const EVENT_TASK_REQUEST = 200      // 上传音频
const EVENT_CHAT_TEXT_QUERY = 501   // 文本query

// 服务端事件ID
const EVENT_CONNECTION_STARTED = 50
const EVENT_CONNECTION_FAILED = 51
const EVENT_CONNECTION_FINISHED = 52
const EVENT_SESSION_STARTED = 150
const EVENT_SESSION_FINISHED = 152
const EVENT_SESSION_FAILED = 153
const EVENT_TTS_SENTENCE_START = 350
const EVENT_TTS_SENTENCE_END = 351
const EVENT_TTS_RESPONSE = 352      // 音频数据
const EVENT_TTS_ENDED = 359
const EVENT_ASR_INFO = 450          // 首字识别，用于打断
const EVENT_ASR_RESPONSE = 451      // ASR识别结果
const EVENT_ASR_ENDED = 459
const EVENT_CHAT_RESPONSE = 550     // 模型回复文本
const EVENT_CHAT_TEXT_QUERY_CONFIRMED = 553
const EVENT_CHAT_ENDED = 559
const EVENT_DIALOG_COMMON_ERROR = 599

// =============================================================================
// BinaryProtocol 类 - 二进制协议编解码
// =============================================================================

class BinaryProtocol {
  /**
   * 编码客户端文本事件消息
   * 用于 StartConnection, StartSession, FinishSession, ChatTextQuery 等
   */
  static encodeClientEvent(eventId: number, sessionId: string | null, payload: object): Buffer {
    const payloadBuffer = Buffer.from(JSON.stringify(payload))
    const sessionIdBuffer = sessionId ? Buffer.from(sessionId, 'utf-8') : Buffer.alloc(0)

    // Optional fields size
    // event (4B) + [session_id_size (4B) + session_id] (如果有)
    let optionalFieldsSize = 4  // event
    if (sessionId) {
      optionalFieldsSize += 4 + sessionIdBuffer.length  // session_id_size + session_id
    }

    // Total size: header (4B) + optional fields + payload_size (4B) + payload
    const totalSize = 4 + optionalFieldsSize + 4 + payloadBuffer.length
    const buffer = Buffer.alloc(totalSize)
    let offset = 0

    // Header (4 bytes)
    // Byte 0: Protocol Version (4bit) | Header Size (4bit)
    buffer.writeUInt8((PROTOCOL_VERSION << 4) | HEADER_SIZE, offset++)

    // Byte 1: Message Type (4bit) | Message type specific flags (4bit)
    buffer.writeUInt8((MSG_TYPE_FULL_CLIENT << 4) | FLAGS_WITH_EVENT, offset++)

    // Byte 2: Serialization (4bit) | Compression (4bit)
    buffer.writeUInt8((SERIALIZATION_JSON << 4) | COMPRESSION_NONE, offset++)

    // Byte 3: Reserved
    buffer.writeUInt8(0x00, offset++)

    // Optional fields
    // Event ID (4 bytes)
    buffer.writeUInt32BE(eventId, offset)
    offset += 4

    // Session ID (如果有)
    if (sessionId) {
      buffer.writeUInt32BE(sessionIdBuffer.length, offset)
      offset += 4
      sessionIdBuffer.copy(buffer, offset)
      offset += sessionIdBuffer.length
    }

    // Payload size (4 bytes)
    buffer.writeUInt32BE(payloadBuffer.length, offset)
    offset += 4

    // Payload
    payloadBuffer.copy(buffer, offset)

    return buffer
  }

  /**
   * 编码客户端音频消息 (TaskRequest)
   */
  static encodeClientAudio(sessionId: string, audioData: Buffer): Buffer {
    const sessionIdBuffer = Buffer.from(sessionId, 'utf-8')

    // Optional fields size: event (4B) + session_id_size (4B) + session_id
    const optionalFieldsSize = 4 + 4 + sessionIdBuffer.length

    // Total size
    const totalSize = 4 + optionalFieldsSize + 4 + audioData.length
    const buffer = Buffer.alloc(totalSize)
    let offset = 0

    // Header
    buffer.writeUInt8((PROTOCOL_VERSION << 4) | HEADER_SIZE, offset++)
    buffer.writeUInt8((MSG_TYPE_AUDIO_CLIENT << 4) | FLAGS_WITH_EVENT, offset++)
    buffer.writeUInt8((SERIALIZATION_RAW << 4) | COMPRESSION_NONE, offset++)
    buffer.writeUInt8(0x00, offset++)

    // Event ID
    buffer.writeUInt32BE(EVENT_TASK_REQUEST, offset)
    offset += 4

    // Session ID
    buffer.writeUInt32BE(sessionIdBuffer.length, offset)
    offset += 4
    sessionIdBuffer.copy(buffer, offset)
    offset += sessionIdBuffer.length

    // Payload size
    buffer.writeUInt32BE(audioData.length, offset)
    offset += 4

    // Payload (音频数据)
    audioData.copy(buffer, offset)

    return buffer
  }

  /**
   * 解码服务器消息
   */
  static decode(data: Buffer): { messageType: number; eventId: number; sessionId: string; payload: any } | null {
    if (data.length < 4) {
      console.error('[BinaryProtocol] Data too short:', data.length)
      return null
    }

    let offset = 0

    // Parse header
    const byte0 = data.readUInt8(offset++)
    const protocolVersion = (byte0 >> 4) & 0x0F
    const headerSize = byte0 & 0x0F

    const byte1 = data.readUInt8(offset++)
    const messageType = (byte1 >> 4) & 0x0F
    const flags = byte1 & 0x0F

    const byte2 = data.readUInt8(offset++)
    const serialization = (byte2 >> 4) & 0x0F
    const compression = byte2 & 0x0F

    // Skip reserved byte
    offset++

    // Parse optional fields based on message type and flags
    let eventId = 0
    let sessionId = ''
    let errorCode = 0

    // 错误帧可能有 error code
    if (messageType === MSG_TYPE_ERROR) {
      if (offset + 4 > data.length) return null
      errorCode = data.readUInt32BE(offset)
      offset += 4
    }

    // 如果有 sequence (flags bit 1 or 2 or 3)
    const hasSequence = (flags & 0b0001) || (flags & 0b0010) || (flags & 0b0011)
    if (hasSequence && messageType !== MSG_TYPE_ERROR) {
      if (offset + 4 > data.length) return null
      offset += 4  // skip sequence
    }

    // Event ID (flags bit 2 = 0b0100)
    if (flags & FLAGS_WITH_EVENT) {
      if (offset + 4 > data.length) return null
      eventId = data.readUInt32BE(offset)
      offset += 4
    }

    // Session ID (Session级别事件)
    // 根据事件ID判断是否需要读取 session_id
    const sessionEvents = [
      EVENT_SESSION_STARTED, EVENT_SESSION_FINISHED, EVENT_SESSION_FAILED,
      EVENT_TTS_SENTENCE_START, EVENT_TTS_SENTENCE_END, EVENT_TTS_RESPONSE, EVENT_TTS_ENDED,
      EVENT_ASR_INFO, EVENT_ASR_RESPONSE, EVENT_ASR_ENDED,
      EVENT_CHAT_RESPONSE, EVENT_CHAT_TEXT_QUERY_CONFIRMED, EVENT_CHAT_ENDED,
      EVENT_FINISH_SESSION, EVENT_TASK_REQUEST
    ]

    if (sessionEvents.includes(eventId) && offset + 4 <= data.length) {
      const sessionIdSize = data.readUInt32BE(offset)
      offset += 4

      if (offset + sessionIdSize <= data.length) {
        sessionId = data.toString('utf-8', offset, offset + sessionIdSize)
        offset += sessionIdSize
      }
    }

    // Payload size (4 bytes) + Payload
    if (offset + 4 > data.length) return null
    const payloadSize = data.readUInt32BE(offset)
    offset += 4

    if (offset + payloadSize > data.length) {
      console.error('[BinaryProtocol] Payload truncated:', offset + payloadSize, '>', data.length)
      return null
    }

    let payload: any
    if (messageType === MSG_TYPE_AUDIO_SERVER) {
      // Audio data - return as buffer
      payload = data.slice(offset, offset + payloadSize)
    } else if (serialization === SERIALIZATION_JSON) {
      // JSON payload - but sometimes server returns raw string with JSON serialization flag
      let payloadData = data.slice(offset, offset + payloadSize)

      // Handle gzip compression
      if (compression === COMPRESSION_GZIP) {
        try {
          payloadData = gunzipSync(payloadData)
        } catch (gzipError) {
          console.error('[BinaryProtocol] Failed to decompress gzip payload:', gzipError)
        }
      }

      const rawStr = payloadData.toString('utf-8')

      // Check if it actually looks like JSON (starts with { or [)
      const trimmed = rawStr.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          payload = JSON.parse(rawStr)
        } catch (e) {
          console.error('[BinaryProtocol] Failed to parse JSON payload for eventId:', eventId)
          payload = rawStr
        }
      } else {
        // Not JSON format, treat as raw string (e.g., UUID session_id)
        payload = rawStr
      }
    } else {
      // Raw payload
      payload = data.slice(offset, offset + payloadSize)
    }

    return { messageType, eventId, sessionId, payload }
  }
}

// =============================================================================
// VoiceAIService 类
// =============================================================================

class VoiceAIService {
  private config: VoiceAIConfig
  private sessions: Map<string, VoiceAISession> = new Map()
  private sharedSessions: Map<string, SharedVoiceAISession> = new Map()
  private enabled: boolean = false

  // 个人会话回调函数
  public onAIResponse: ((sessionId: string, userId: string, text: string, questionId?: string, replyId?: string) => void) | null = null
  public onAIAudio: ((sessionId: string, userId: string, audioData: ArrayBuffer) => void) | null = null
  public onAIStateChange: ((sessionId: string, userId: string, state: string) => void) | null = null
  public onASRResult: ((sessionId: string, userId: string, text: string, isInterim: boolean) => void) | null = null
  public onError: ((sessionId: string, userId: string, error: string) => void) | null = null

  // 共享会话回调函数
  public onSharedAIResponse: ((sessionId: string, text: string, speakerName?: string) => void) | null = null
  public onSharedAIAudio: ((sessionId: string, audioData: ArrayBuffer) => void) | null = null
  public onSharedAIStateChange: ((sessionId: string, state: string, speaker?: { userId: string; userName: string } | null) => void) | null = null
  public onSharedASRResult: ((sessionId: string, userId: string, userName: string, text: string, isInterim: boolean) => void) | null = null
  public onSharedError: ((sessionId: string, error: string) => void) | null = null
  // 唤醒词触发回调 - 用于获取聊天记录
  public onWakeWordTriggered: ((sessionId: string) => Promise<Array<{role: 'user' | 'ai', text: string, userName?: string, timestamp?: string}>>) | null = null

  constructor() {
    this.config = {
      appId: process.env.VOLCANO_APP_ID || '',
      accessToken: process.env.VOLCANO_ACCESS_TOKEN || '',
      secretKey: process.env.VOLCANO_SECRET_KEY || '',
      endpoint: process.env.VOLCANO_ENDPOINT || 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue',
      apiAppKey: process.env.VOLCANO_API_APP_KEY || 'PlgvMymc7f3tQnJ6',
      apiResourceId: process.env.VOLCANO_API_RESOURCE_ID || 'volc.speech.dialog',
    }

    this.enabled = !!(
      this.config.appId &&
      this.config.accessToken
    )

    if (this.enabled) {
      // Service initialized
    } else {
      console.warn('[VoiceAI] Service not enabled - missing configuration')
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * 启动语音AI会话
   */
  async startSession(
    sessionId: string,
    userId: string,
    userName: string,
    ws: ServerWebSocket<unknown>,
    chatHistory?: Array<{role: 'user' | 'ai', text: string, timestamp?: string}>,
    files?: Array<{name: string, content: string, type: 'text' | 'base64'}>,
    voiceType?: string
  ): Promise<boolean> {
    if (!this.enabled) {
      console.warn('[VoiceAI] Service not enabled')
      this.sendErrorToClient(ws, 'Voice AI service not enabled')
      return false
    }

    const sessionKey = `${sessionId}:${userId}`

    // 如果已有会话，先关闭
    if (this.sessions.has(sessionKey)) {
      await this.stopSession(sessionId, userId)
    }


    // 创建会话
    const session: VoiceAISession = {
      sessionId,
      userId,
      userName,
      ws,
      volcanoWs: null,
      volcanoSessionId: this.generateSessionId(),
      isReady: false,
      audioBuffer: [],
      reconnectAttempts: 0,
      lastActivityTime: Date.now(),
      dialogId: '',
      // 限制历史记录和文件大小，防止内存泄漏
      chatHistory: (chatHistory || []).slice(-50),  // 最多50条历史
      files: (files || []).slice(-10),  // 最多10个文件
      voiceType: voiceType || 'ICL_zh_female_nuanxinxuejie_tob',  // 默认温暖学姐
    }

    this.sessions.set(sessionKey, session)

    // 连接火山引擎
    try {
      await this.connectToVolcano(session)
      return true
    } catch (error) {
      console.error('[VoiceAI] Failed to start session:', error)
      this.sessions.delete(sessionKey)
      this.sendErrorToClient(ws, `Failed to start voice AI: ${error}`)
      return false
    }
  }

  /**
   * 发送历史记录和文件内容给AI作为上下文
   */
  private async sendContextToAI(session: VoiceAISession): Promise<void> {
    if (!session.volcanoWs || session.volcanoWs.readyState !== 1) return

    const { chatHistory, files } = session

    // 构建上下文提示
    let contextPrompt = ''

    // 添加文件内容
    if (files && files.length > 0) {
      contextPrompt += '## 参考文件\n\n'
      for (const file of files) {
        contextPrompt += `### ${file.name}\n`
        if (file.type === 'text') {
          contextPrompt += file.content
        } else if (file.type === 'base64') {
          // base64内容作为二进制数据提示
          contextPrompt += `[文件内容已编码，长度: ${file.content.length} 字符]`
        }
        contextPrompt += '\n\n'
      }
    }

    // 添加历史聊天记录
    if (chatHistory && chatHistory.length > 0) {
      contextPrompt += '## 历史对话\n\n'
      for (const msg of chatHistory.slice(-20)) { // 最多20条历史记录
        const role = msg.role === 'user' ? '用户' : 'AI'
        contextPrompt += `${role}: ${msg.text}\n`
      }
      contextPrompt += '\n请根据以上上下文，主动打个招呼或回复。\n'
    }

    if (!contextPrompt) return


    // 发送系统提示（使用系统角色，不触发AI回复）
    try {
      // 注意：火山引擎可能不支持真正的system角色
      // 我们通过明确的指令告诉AI不要回复
      const message = BinaryProtocol.encodeClientEvent(
        EVENT_CHAT_TEXT_QUERY,
        session.volcanoSessionId,
        {
          content: contextPrompt,
          role: 'system',
          // 添加一个标记，表示这是背景信息，不需要回复
          metadata: { type: 'background', auto_reply: false }
        }
      )
      session.volcanoWs.send(message)
    } catch (error) {
      console.error('[VoiceAI] Failed to send context:', error)
    }
  }

  /**
   * 添加文件到现有会话的上下文
   */
  async addFileToSession(
    sessionId: string,
    userId: string,
    fileName: string,
    content: string,
    type: 'text' | 'base64' = 'text'
  ): Promise<boolean> {
    const sessionKey = `${sessionId}:${userId}`
    const session = this.sessions.get(sessionKey)

    if (!session || !session.isReady) {
      console.warn('[VoiceAI] Session not ready for adding file')
      return false
    }

    if (!session.volcanoWs || session.volcanoWs.readyState !== 1) {
      console.warn('[VoiceAI] WebSocket not connected')
      return false
    }

    // 初始化files数组
    if (!session.files) {
      session.files = []
    }

    // 添加文件到会话
    session.files.push({ name: fileName, content, type })

    // 限制文件数量，防止内存泄漏（最多保留10个文件）
    if (session.files.length > 10) {
      session.files = session.files.slice(-10)
    }

    // 发送文件内容给AI
    let filePrompt = `## 新添加的文件\n\n### ${fileName}\n`
    if (type === 'text') {
      filePrompt += content
    } else {
      filePrompt += `[文件内容已编码，长度: ${content.length} 字符]`
    }
    filePrompt += '\n\n请结合此文件内容回答。'

    try {
      const message = BinaryProtocol.encodeClientEvent(
        EVENT_CHAT_TEXT_QUERY,
        session.volcanoSessionId,
        { content: filePrompt, role: 'system' }
      )
      session.volcanoWs.send(message)
      return true
    } catch (error) {
      console.error('[VoiceAI] Failed to send file to AI:', error)
      return false
    }
  }

  /**
   * 生成会话ID (UUID格式)
   */
  private generateSessionId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0
      const v = c === 'x' ? r : (r & 0x3 | 0x8)
      return v.toString(16)
    })
  }

  /**
   * 获取会话信息
   */
  getSession(sessionId: string, userId: string): VoiceAISession | undefined {
    const sessionKey = `${sessionId}:${userId}`
    return this.sessions.get(sessionKey)
  }

  /**
   * 停止语音AI会话
   */
  async stopSession(sessionId: string, userId: string): Promise<void> {
    const sessionKey = `${sessionId}:${userId}`
    const session = this.sessions.get(sessionKey)

    if (!session) return


    // 标记会话正在关闭，忽略后续的AI响应
    session.isClosing = true

    // 发送结束会话消息
    if (session.volcanoWs && session.volcanoWs.readyState === 1) { // WebSocket.OPEN = 1
      try {
        const finishMessage = BinaryProtocol.encodeClientEvent(
          EVENT_FINISH_SESSION,
          session.volcanoSessionId,
          {}
        )
        session.volcanoWs.send(finishMessage)
      } catch (e) {
        console.error('[VoiceAI] Error sending finish message:', e)
      }

      // 等待短暂时间让消息发送
      await new Promise(resolve => setTimeout(resolve, 100))

      session.volcanoWs.close()
    }

    this.sessions.delete(sessionKey)
  }

  // =============================================================================
  // 共享语音AI会话管理
  // =============================================================================

  /**
   * 启动共享语音AI会话（第一个用户加入时调用）
   */
  async startSharedSession(
    sessionId: string,
    initialUserId: string,
    initialUserName: string,
    voiceType?: string,
    files?: Array<{name: string, content: string, type: 'text' | 'base64'}>
  ): Promise<boolean> {
    if (!this.enabled) {
      console.warn('[SharedVoiceAI] Service not enabled')
      return false
    }

    // 如果已有共享会话，直接让用户加入
    if (this.sharedSessions.has(sessionId)) {
      return this.joinSharedSession(sessionId, initialUserId, initialUserName)
    }


    // 创建共享会话
    const session: SharedVoiceAISession = {
      sessionId,
      volcanoWs: null,
      volcanoSessionId: this.generateSessionId(),
      isReady: false,
      participantUserIds: new Set([initialUserId]),
      participantNames: new Map([[initialUserId, initialUserName]]),
      currentSpeakerId: null,
      currentSpeakerName: null,
      createdAt: Date.now(),
      lastActivityTime: Date.now(),
      dialogId: '',
      audioBuffer: [],
      reconnectAttempts: 0,
      voiceType: voiceType || 'ICL_zh_female_nuanxinxuejie_tob',  // 默认温暖学姐
      files: files || [],
      speakingUserIds: new Set(),
      lastSpeakingHintTime: 0,
      // AI唤醒模式
      wakeWordMode: true,  // 默认启用唤醒词模式
      customWakeWords: ['AI', 'ai', 'Ai', '小爱', '小艾', '哎', '诶'],  // 默认唤醒词
      recentTranscripts: [],
      aiTriggered: false,
      triggerText: '',
      wakeWordDetected: false,
    }

    this.sharedSessions.set(sessionId, session)

    // 连接火山引擎
    try {
      await this.connectToVolcanoShared(session)
      return true
    } catch (error) {
      console.error('[SharedVoiceAI] Failed to start shared session:', error)
      this.sharedSessions.delete(sessionId)
      this.onSharedError?.(sessionId, `Failed to start shared voice AI: ${error}`)
      return false
    }
  }

  /**
   * 加入共享语音AI会话
   */
  joinSharedSession(
    sessionId: string,
    userId: string,
    userName: string
  ): boolean {
    const session = this.sharedSessions.get(sessionId)

    if (!session) {
      console.warn(`[SharedVoiceAI] Session ${sessionId} not found`)
      return false
    }

    if (session.participantUserIds.has(userId)) {
      return true
    }

    session.participantUserIds.add(userId)
    session.participantNames.set(userId, userName)
    session.lastActivityTime = Date.now()

    return true
  }

  /**
   * 离开共享语音AI会话
   * @returns true 如果会话仍然存在，false 如果会话已关闭
   */
  async leaveSharedSession(
    sessionId: string,
    userId: string
  ): Promise<boolean> {
    const session = this.sharedSessions.get(sessionId)

    if (!session) {
      return false
    }

    const userName = session.participantNames.get(userId) || userId
    session.participantUserIds.delete(userId)
    session.participantNames.delete(userId)
    session.speakingUserIds.delete(userId)  // 从说话者集合中移除

    // 如果没有参与者了，关闭会话
    if (session.participantUserIds.size === 0) {
      await this.stopSharedSession(sessionId)
      return false
    }

    // 如果当前说话者离开了，清除说话者状态
    if (session.currentSpeakerId === userId) {
      session.currentSpeakerId = null
      session.currentSpeakerName = null
    }

    session.lastActivityTime = Date.now()
    return true
  }

  /**
   * 发送共享音频数据
   */
  async sendSharedAudio(
    sessionId: string,
    userId: string,
    userName: string,
    audioData: ArrayBuffer,
    isSpeaking?: boolean
  ): Promise<void> {
    const session = this.sharedSessions.get(sessionId)

    if (!session) {
      console.warn(`[SharedVoiceAI] Session ${sessionId} not found`)
      return
    }

    if (!session.participantUserIds.has(userId)) {
      console.warn(`[SharedVoiceAI] User ${userId} not in session ${sessionId}`)
      return
    }

    if (!session.isReady) {
      // 缓存音频数据
      session.audioBuffer.push(audioData)
      if (session.audioBuffer.length > 250) {
        session.audioBuffer.shift()
      }
      return
    }

    if (!session.volcanoWs || session.volcanoWs.readyState !== 1) {
      return
    }

    const now = Date.now()
    const wasSpeaking = session.speakingUserIds.has(userId)
    const actuallySpeaking = isSpeaking === true

    // 更新说话状态
    if (actuallySpeaking) {
      session.speakingUserIds.add(userId)
      // 只有在用户真正说话时才更新 currentSpeaker
      session.currentSpeakerId = userId
      session.currentSpeakerName = userName
      session.lastActivityTime = now
    } else {
      session.speakingUserIds.delete(userId)
    }

    // 发送音频数据给火山引擎
    if (session.volcanoWs && session.volcanoWs.readyState === 1) {
      try {
        const audioBuffer = Buffer.from(audioData)
        const message = BinaryProtocol.encodeClientAudio(session.volcanoSessionId, audioBuffer)
        session.volcanoWs.send(message)
      } catch (error) {
        console.error('[SharedVoiceAI] Error sending audio:', error)
      }
    }
  }

  /**
   * 发送说话提示给AI（防止AI提前介入）
   */
  private sendSpeakingHint(session: SharedVoiceAISession, userName: string): void {
    if (!session.volcanoWs || session.volcanoWs.readyState !== 1) return

    try {
      const message = BinaryProtocol.encodeClientEvent(
        EVENT_CHAT_TEXT_QUERY,
        session.volcanoSessionId,
        { content: `[系统提示：${userName}正在说话...]`, role: 'system' }
      )
      session.volcanoWs.send(message)
    } catch (error) {
      console.error('[SharedVoiceAI] Error sending speaking hint:', error)
    }
  }

  /**
   * 发送唤醒词context给AI
   */
  private async sendWakeWordContext(
    session: SharedVoiceAISession,
    chatHistory?: Array<{role: 'user' | 'ai', text: string, userName?: string, timestamp?: string}>
  ): Promise<void> {
    if (!session.volcanoWs || session.volcanoWs.readyState !== 1) {
      console.error('[SharedVoiceAI] Volcano WebSocket not ready, state:', session.volcanoWs?.readyState)
      return
    }

    try {
      // 构建context消息
      let contextMessage = ''

      // 添加完整的聊天记录（从服务器获取）
      if (chatHistory && chatHistory.length > 0) {
        contextMessage += '## 历史聊天记录\n'
        // 只取最近的50条消息，避免超出长度限制
        const recentHistory = chatHistory.slice(-50)
        recentHistory.forEach(msg => {
          const role = msg.role === 'ai' ? 'AI' : (msg.userName || '用户')
          contextMessage += `${role}: ${msg.text}\n`
        })
        contextMessage += '\n'
      }

      // 添加最近的对话context（实时ASR结果）
      if (session.recentTranscripts.length > 0) {
        contextMessage += '## 最近语音对话\n'
        session.recentTranscripts.forEach(t => {
          contextMessage += `${t.userName}: ${t.text}\n`
        })
        contextMessage += '\n'
      }

      // 添加触发文本
      if (session.triggerText) {
        contextMessage += `## 当前问题\n${session.triggerText}\n\n请根据以上上下文回复。`
      }

      if (contextMessage) {
        console.log('[SharedVoiceAI] Sending context to AI:', contextMessage.substring(0, 200) + '...')

        const message = BinaryProtocol.encodeClientEvent(
          EVENT_CHAT_TEXT_QUERY,
          session.volcanoSessionId,
          { content: contextMessage }
        )
        session.volcanoWs.send(message)
        console.log('[SharedVoiceAI] Wake word context sent to AI')
      }
    } catch (error) {
      console.error('[SharedVoiceAI] Error sending wake word context:', error)
    }
  }

  /**
   * 发送共享文本消息
   */
  async sendSharedText(
    sessionId: string,
    userId: string,
    userName: string,
    text: string
  ): Promise<void> {
    const session = this.sharedSessions.get(sessionId)

    if (!session || !session.isReady) {
      console.warn('[SharedVoiceAI] Session not ready for text')
      return
    }

    if (!session.volcanoWs || session.volcanoWs.readyState !== 1) {
      return
    }

    // 更新当前说话者
    session.currentSpeakerId = userId
    session.currentSpeakerName = userName
    session.lastActivityTime = Date.now()

    try {
      const message = BinaryProtocol.encodeClientEvent(
        EVENT_CHAT_TEXT_QUERY,
        session.volcanoSessionId,
        { content: `[${userName}]: ${text}` }
      )
      session.volcanoWs.send(message)
    } catch (error) {
      console.error('[SharedVoiceAI] Error sending text:', error)
    }
  }

  /**
   * 添加文件/文本到共享会话的上下文（实时发送给AI）
   */
  async addFileToSharedSession(
    sessionId: string,
    userId: string,
    userName: string,
    fileName: string,
    content: string,
    type: 'text' | 'base64' = 'text'
  ): Promise<boolean> {
    const session = this.sharedSessions.get(sessionId)

    if (!session || !session.isReady) {
      console.warn('[SharedVoiceAI] Session not ready for adding file')
      return false
    }

    if (!session.volcanoWs || session.volcanoWs.readyState !== 1) {
      console.warn('[SharedVoiceAI] WebSocket not connected')
      return false
    }

    // 添加文件到会话
    if (!session.files) {
      session.files = []
    }
    session.files.push({ name: fileName, content, type })

    // 限制文件数量，防止内存泄漏（最多保留10个文件）
    if (session.files.length > 10) {
      session.files = session.files.slice(-10)
    }

    // 发送文件内容给AI
    let filePrompt = `## 新添加的文件（由 ${userName} 提供）\n\n### ${fileName}\n`
    if (type === 'text') {
      filePrompt += content
    } else {
      filePrompt += `[文件内容已编码，长度: ${content.length} 字符]`
    }
    filePrompt += '\n\n请结合此文件内容回答。'

    try {
      const message = BinaryProtocol.encodeClientEvent(
        EVENT_CHAT_TEXT_QUERY,
        session.volcanoSessionId,
        { content: filePrompt, role: 'system' }
      )
      session.volcanoWs.send(message)
      console.log('[SharedVoiceAI] File sent to AI:', fileName)
      return true
    } catch (error) {
      console.error('[SharedVoiceAI] Failed to send file to AI:', error)
      return false
    }
  }

  /**
   * 停止共享语音AI会话
   */
  async stopSharedSession(sessionId: string): Promise<void> {
    const session = this.sharedSessions.get(sessionId)

    if (!session) return

    // 标记会话正在关闭
    session.isClosing = true

    // 发送结束会话消息
    if (session.volcanoWs && session.volcanoWs.readyState === 1) {
      try {
        const finishMessage = BinaryProtocol.encodeClientEvent(
          EVENT_FINISH_SESSION,
          session.volcanoSessionId,
          {}
        )
        session.volcanoWs.send(finishMessage)
      } catch (e) {
        console.error('[SharedVoiceAI] Error sending finish message:', e)
      }

      await new Promise(resolve => setTimeout(resolve, 100))
      session.volcanoWs.close()
    }

    this.sharedSessions.delete(sessionId)
  }

  /**
   * 获取共享会话状态
   */
  getSharedSessionState(sessionId: string): SharedVoiceAIState | null {
    const session = this.sharedSessions.get(sessionId)

    if (!session) return null

    const participants = Array.from(session.participantUserIds).map(userId => ({
      userId,
      userName: session.participantNames.get(userId) || userId,
    }))

    const currentSpeaker = session.currentSpeakerId ? {
      userId: session.currentSpeakerId,
      userName: session.currentSpeakerName || session.currentSpeakerId,
    } : null

    return {
      isActive: true,
      isReady: session.isReady,
      participantCount: session.participantUserIds.size,
      participants,
      currentSpeaker,
    }
  }

  /**
   * 检查共享会话是否存在
   */
  hasSharedSession(sessionId: string): boolean {
    return this.sharedSessions.has(sessionId)
  }

  /**
   * 设置共享会话的唤醒词模式
   */
  setSharedWakeWordMode(sessionId: string, enabled: boolean): boolean {
    const session = this.sharedSessions.get(sessionId)
    if (!session) return false

    session.wakeWordMode = enabled
    // 重置唤醒词检测状态
    session.wakeWordDetected = false
    session.recentTranscripts = []
    console.log(`[SharedVoiceAI] Wake word mode ${enabled ? 'enabled' : 'disabled'} for session ${sessionId}`)
    return true
  }

  /**
   * 设置共享会话的自定义唤醒词
   */
  setSharedCustomWakeWords(sessionId: string, wakeWords: string[]): boolean {
    const session = this.sharedSessions.get(sessionId)
    if (!session) return false

    session.customWakeWords = wakeWords
    console.log(`[SharedVoiceAI] Custom wake words set for session ${sessionId}: ${wakeWords.join(', ')}`)
    return true
  }

  /**
   * 获取共享会话的当前唤醒词
   */
  getSharedCustomWakeWords(sessionId: string): string[] | null {
    const session = this.sharedSessions.get(sessionId)
    if (!session) return null

    return session.customWakeWords || ['AI', 'ai', 'Ai', '小爱', '小艾', '哎', '诶']
  }

  /**
   * 连接到火山引擎服务器（共享会话）
   */
  private async connectToVolcanoShared(session: SharedVoiceAISession): Promise<void> {
    return new Promise((resolve, reject) => {

      const volcanoWs = new WebSocket(this.config.endpoint, {
        headers: {
          'X-Api-App-ID': this.config.appId,
          'X-Api-Access-Key': this.config.accessToken,
          'X-Api-Resource-Id': this.config.apiResourceId,
          'X-Api-App-Key': this.config.apiAppKey,
        }
      })

      session.volcanoWs = volcanoWs as any

      volcanoWs.on('open', () => {
        const startConnectionMessage = BinaryProtocol.encodeClientEvent(
          EVENT_START_CONNECTION,
          null,
          {}
        )
        volcanoWs.send(startConnectionMessage)
      })

      volcanoWs.on('message', (data: Buffer, isBinary: boolean) => {
        this.handleVolcanoMessageShared(session, data, resolve, reject).catch(error => {
          console.error('[SharedVoiceAI] Error handling message:', error)
        })
      })

      volcanoWs.on('error', (error: Error) => {
        console.error('[SharedVoiceAI] WebSocket error:', error.message)
        this.onSharedError?.(session.sessionId, error.message)
        reject(error)
      })

      volcanoWs.on('close', (code: number, reason: Buffer) => {
        session.isReady = false

        // 如果有参与者且不在关闭中，尝试重连
        if (!session.isClosing && session.participantUserIds.size > 0 && session.reconnectAttempts < 3) {
          session.reconnectAttempts++
          setTimeout(() => {
            this.connectToVolcanoShared(session).catch(e => {
              console.error('[SharedVoiceAI] Reconnect failed:', e)
            })
          }, 1000 * session.reconnectAttempts)
        } else if (session.participantUserIds.size === 0) {
          // 没有参与者了，清理会话
          this.sharedSessions.delete(session.sessionId)
        }
      })

      // 设置超时
      setTimeout(() => {
        if (!session.isReady) {
          reject(new Error('Connection timeout'))
        }
      }, 15000)
    })
  }

  /**
   * 处理火山引擎消息（共享会话）
   */
  private async handleVolcanoMessageShared(
    session: SharedVoiceAISession,
    data: Buffer,
    resolve?: (value: void) => void,
    reject?: (reason: any) => void
  ): Promise<void> {
    const decoded = BinaryProtocol.decode(data)

    if (!decoded) {
      console.error('[SharedVoiceAI] Failed to decode message')
      return
    }

    const { eventId, payload } = decoded
    session.lastActivityTime = Date.now()

    switch (eventId) {
      case EVENT_CONNECTION_STARTED:
        this.sendStartSessionShared(session)
        break

      case EVENT_CONNECTION_FAILED:
        console.error('[SharedVoiceAI] Connection failed:', payload)
        this.onSharedError?.(session.sessionId, payload?.error || 'Connection failed')
        reject?.(new Error(payload?.error || 'Connection failed'))
        break

      case EVENT_SESSION_STARTED:
        session.isReady = true
        session.dialogId = payload?.dialog_id || ''
        // 发送上下文文件（如果有）
        this.sendContextToAIShared(session)
        // 发送缓存的音频
        this.flushAudioBufferShared(session)
        // 通知客户端
        this.onSharedAIStateChange?.(session.sessionId, 'listening', null)
        resolve?.()
        break

      case EVENT_SESSION_FAILED:
        console.error('[SharedVoiceAI] Session failed:', payload)
        this.onSharedError?.(session.sessionId, payload?.error || 'Session failed')
        reject?.(new Error(payload?.error || 'Session failed'))
        break

      case EVENT_ASR_INFO:
        // 检测到首字，用于打断播报
        this.onSharedAIStateChange?.(session.sessionId, 'listening', {
          userId: session.currentSpeakerId || 'unknown',
          userName: session.currentSpeakerName || 'Unknown',
        })
        break

      case EVENT_ASR_RESPONSE:
        // 语音识别结果 - 包含说话者信息
        const asrResults = payload?.results || []
        asrResults.forEach((result: any) => {
          const text = result.text || ''
          const isInterim = result.is_interim === true || result.is_final === false

          // 广播ASR结果，包含说话者信息（无论是否触发AI都广播）
          this.onSharedASRResult?.(
            session.sessionId,
            session.currentSpeakerId || 'unknown',
            session.currentSpeakerName || 'Unknown',
            text,
            isInterim
          )

          // 唤醒词模式：检测唤醒词
          if (session.wakeWordMode && !isInterim && text) {
            // 检测唤醒词（使用自定义唤醒词列表）
            const wakeWords = session.customWakeWords || ['AI', 'ai', 'Ai', '小爱', '小艾', '哎', '诶']
            const hasWakeWord = wakeWords.some(word => text.includes(word))

            // 保存到context
            session.recentTranscripts.push({
              userId: session.currentSpeakerId || 'unknown',
              userName: session.currentSpeakerName || 'Unknown',
              text: text,
              timestamp: Date.now()
            })
            if (session.recentTranscripts.length > 20) {
              session.recentTranscripts = session.recentTranscripts.slice(-20)
            }

            if (hasWakeWord) {
              console.log(`[SharedVoiceAI] Wake word detected in: "${text}"`)
              session.wakeWordDetected = true
            }
          }
        })
        break

      case EVENT_ASR_ENDED:
        // 用户说话结束
        if (session.wakeWordMode) {
          if (session.wakeWordDetected) {
            // 检测到唤醒词，获取聊天记录并发送context给AI
            this.onSharedAIStateChange?.(session.sessionId, 'thinking', {
              userId: session.currentSpeakerId || 'unknown',
              userName: session.currentSpeakerName || 'Unknown',
            })

            // 获取聊天记录并发送context
            try {
              const chatHistory = await this.onWakeWordTriggered?.(session.sessionId)
              if (chatHistory && chatHistory.length > 0) {
                await this.sendWakeWordContext(session, chatHistory)
              } else {
                // 如果没有获取到聊天记录，仍然发送基本的context
                await this.sendWakeWordContext(session)
              }
            } catch (error) {
              console.error('[SharedVoiceAI] Error handling wake word triggered:', error)
              // 出错时仍然发送基本的context
              await this.sendWakeWordContext(session)
            }
          } else {
            // 未检测到唤醒词，保持listening状态，忽略AI回复
            this.onSharedAIStateChange?.(session.sessionId, 'listening', null)
          }
        } else {
          // 非唤醒模式
          this.onSharedAIStateChange?.(session.sessionId, 'thinking', {
            userId: session.currentSpeakerId || 'unknown',
            userName: session.currentSpeakerName || 'Unknown',
          })
        }
        break

      case EVENT_CHAT_RESPONSE:
        // AI文本响应 - 唤醒模式下只有检测到唤醒词才处理
        if (session.wakeWordMode && !session.wakeWordDetected) {
          // 忽略AI回复
          break
        }
        const chatContent = payload?.content || ''
        if (!session.isClosing) {
          this.onSharedAIResponse?.(session.sessionId, chatContent)
        }
        break

      case EVENT_CHAT_ENDED:
        // AI回复结束，重置唤醒词检测标志
        if (session.wakeWordMode) {
          session.wakeWordDetected = false
        }
        break

      case EVENT_TTS_SENTENCE_START:
        // TTS句子开始 - 唤醒模式下只有检测到唤醒词才处理
        if (session.wakeWordMode && !session.wakeWordDetected) {
          break
        }
        this.onSharedAIStateChange?.(session.sessionId, 'speaking', null)
        break

      case EVENT_TTS_RESPONSE:
        // TTS音频响应 - 唤醒模式下只有检测到唤醒词才处理
        if (session.wakeWordMode && !session.wakeWordDetected) {
          break
        }
        if (payload && !session.isClosing) {
          const audioBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)
          this.onSharedAIAudio?.(session.sessionId, audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength))
        }
        break

      case EVENT_TTS_ENDED:
        // TTS结束
        this.onSharedAIStateChange?.(session.sessionId, 'listening', null)
        // 清除当前说话者
        session.currentSpeakerId = null
        session.currentSpeakerName = null
        // 重置唤醒词检测标志
        if (session.wakeWordMode) {
          session.wakeWordDetected = false
        }
        break

      case EVENT_DIALOG_COMMON_ERROR:
        // 对话错误
        const errorMsg = payload?.message || payload?.status_code || 'Unknown error'
        console.error('[SharedVoiceAI] Dialog error:', errorMsg)
        this.onSharedError?.(session.sessionId, errorMsg)
        break

      default:
    }
  }

  /**
   * 发送 StartSession 事件（共享会话）
   */
  private sendStartSessionShared(session: SharedVoiceAISession): void {
    const payload = {
      dialog: {
        bot_name: '豆包',
        dialog_id: session.dialogId || '',
        extra: {
          model: 'O'
        }
      },
      // AI介入时机配置：静音5秒后AI才介入
      end_smooth_window_ms: 5000
    }

    const message = BinaryProtocol.encodeClientEvent(
      EVENT_START_SESSION,
      session.volcanoSessionId,
      payload
    )

    session.volcanoWs?.send(message)
  }

  /**
   * 发送上下文文件给共享AI会话
   */
  private async sendContextToAIShared(session: SharedVoiceAISession): Promise<void> {
    if (!session.volcanoWs || session.volcanoWs.readyState !== 1) return

    const { files } = session

    // 如果没有文件，不发送
    if (!files || files.length === 0) return

    // 构建上下文提示
    let contextPrompt = ''

    // 添加文件内容
    contextPrompt += '## 参考文件\n\n'
    for (const file of files) {
      contextPrompt += `### ${file.name}\n`
      if (file.type === 'text') {
        contextPrompt += file.content
      } else if (file.type === 'base64') {
        // base64内容作为二进制数据提示
        contextPrompt += `[文件内容已编码，长度: ${file.content.length} 字符]`
      }
      contextPrompt += '\n\n'
    }

    if (!contextPrompt) return

    // 发送系统提示
    try {
      const message = BinaryProtocol.encodeClientEvent(
        EVENT_CHAT_TEXT_QUERY,
        session.volcanoSessionId,
        {
          content: contextPrompt,
          role: 'system',
          metadata: { type: 'background', auto_reply: false }
        }
      )
      session.volcanoWs.send(message)
      console.log('[SharedVoiceAI] Context files sent:', files?.map(f => f.name).join(', '))
    } catch (error) {
      console.error('[SharedVoiceAI] Failed to send context:', error)
    }
  }

  /**
   * 发送缓存的音频（共享会话）
   */
  private async flushAudioBufferShared(session: SharedVoiceAISession): Promise<void> {
    if (session.audioBuffer.length === 0) return


    for (const audioData of session.audioBuffer) {
      // 使用第一个参与者的信息发送音频
      const firstUserId = Array.from(session.participantUserIds)[0]
      const firstUserName = session.participantNames.get(firstUserId) || 'Unknown'
      await this.sendSharedAudio(session.sessionId, firstUserId, firstUserName, audioData)
    }

    session.audioBuffer = []
  }

  /**
   * 添加动态上下文（在下一次发送音频时一起发送）
   */
  async addPendingContext(sessionId: string, userId: string, context: string): Promise<boolean> {
    const sessionKey = `${sessionId}:${userId}`
    const session = this.sessions.get(sessionKey)

    if (!session || !session.isReady) {
      console.warn('[VoiceAI] Session not ready for adding context')
      return false
    }

    // 累积上下文（如果已有则追加）
    if (session.pendingContext) {
      session.pendingContext += '\n\n' + context
    } else {
      session.pendingContext = context
    }

    return true
  }

  /**
   * 发送音频数据
   */
  async sendAudio(sessionId: string, userId: string, audioData: ArrayBuffer): Promise<void> {
    const sessionKey = `${sessionId}:${userId}`
    const session = this.sessions.get(sessionKey)

    if (!session || !session.isReady) {
      // 缓存音频数据
      if (session) {
        session.audioBuffer.push(audioData)
        // 限制缓存大小（最多5秒音频）
        if (session.audioBuffer.length > 250) {
          session.audioBuffer.shift()
        }
      }
      return
    }

    if (!session.volcanoWs || session.volcanoWs.readyState !== 1) { // WebSocket.OPEN = 1
      return
    }

    // 发送音频数据
    try {
      const audioBuffer = Buffer.from(audioData)
      const message = BinaryProtocol.encodeClientAudio(session.volcanoSessionId, audioBuffer)
      session.volcanoWs.send(message)
      session.lastActivityTime = Date.now()
    } catch (error) {
      console.error('[VoiceAI] Error sending audio:', error)
    }
  }

  /**
   * 发送文本消息
   */
  async sendText(sessionId: string, userId: string, text: string): Promise<void> {
    const sessionKey = `${sessionId}:${userId}`
    const session = this.sessions.get(sessionKey)

    if (!session || !session.isReady) {
      console.warn('[VoiceAI] Session not ready for text')
      return
    }

    if (!session.volcanoWs || session.volcanoWs.readyState !== 1) { // WebSocket.OPEN = 1
      return
    }

    try {
      const message = BinaryProtocol.encodeClientEvent(
        EVENT_CHAT_TEXT_QUERY,
        session.volcanoSessionId,
        { content: text }
      )
      session.volcanoWs.send(message)
      session.lastActivityTime = Date.now()
    } catch (error) {
      console.error('[VoiceAI] Error sending text:', error)
    }
  }

  /**
   * 连接到火山引擎服务器
   */
  private async connectToVolcano(session: VoiceAISession): Promise<void> {
    return new Promise((resolve, reject) => {

      // 使用 ws 库创建 WebSocket 连接，携带认证 Header
      const volcanoWs = new WebSocket(this.config.endpoint, {
        headers: {
          'X-Api-App-ID': this.config.appId,
          'X-Api-Access-Key': this.config.accessToken,
          'X-Api-Resource-Id': this.config.apiResourceId,
          'X-Api-App-Key': this.config.apiAppKey,
        }
      })

      session.volcanoWs = volcanoWs as any

      volcanoWs.on('open', () => {

        // 1. 发送 StartConnection 事件
        const startConnectionMessage = BinaryProtocol.encodeClientEvent(
          EVENT_START_CONNECTION,
          null,  // Connect类事件不需要session_id
          {}
        )
        volcanoWs.send(startConnectionMessage)
      })

      volcanoWs.on('message', (data: Buffer, isBinary: boolean) => {
        this.handleVolcanoMessage(session, data, resolve, reject).catch(error => {
          console.error('[VoiceAI] Error handling message:', error)
        })
      })

      volcanoWs.on('error', (error: Error) => {
        console.error('[VoiceAI] WebSocket error:', error.message)
        this.handleVolcanoError(session, error)
        reject(error)
      })

      volcanoWs.on('close', (code: number, reason: Buffer) => {
        session.isReady = false

        // 尝试重连
        if (session.reconnectAttempts < 3) {
          session.reconnectAttempts++
          setTimeout(() => {
            this.connectToVolcano(session).catch(e => {
              console.error('[VoiceAI] Reconnect failed:', e)
            })
          }, 1000 * session.reconnectAttempts)
        } else {
          this.sendErrorToClient(session.ws, 'Voice AI connection lost')
        }
      })

      // 设置超时
      setTimeout(() => {
        if (!session.isReady) {
          reject(new Error('Connection timeout'))
        }
      }, 15000)
    })
  }

  /**
   * 处理火山引擎消息
   */
  private async handleVolcanoMessage(
    session: VoiceAISession,
    data: Buffer,
    resolve?: (value: void) => void,
    reject?: (reason: any) => void
  ): Promise<void> {
    const decoded = BinaryProtocol.decode(data)

    if (!decoded) {
      console.error('[VoiceAI] Failed to decode message')
      return
    }

    const { eventId, payload } = decoded
    session.lastActivityTime = Date.now()

    switch (eventId) {
      case EVENT_CONNECTION_STARTED:
        // 连接成功，发送 StartSession
        this.sendStartSession(session)
        break

      case EVENT_CONNECTION_FAILED:
        console.error('[VoiceAI] Connection failed:', payload)
        this.sendErrorToClient(session.ws, payload?.error || 'Connection failed')
        reject?.(new Error(payload?.error || 'Connection failed'))
        break

      case EVENT_SESSION_STARTED:
        session.isReady = true
        session.dialogId = payload?.dialog_id || ''

        // 如果有文件或历史记录，发送上下文（会触发AI回复）
        const hasContext = (session.files && session.files.length > 0) ||
                          (session.chatHistory && session.chatHistory.length > 0)
        if (hasContext) {
          await this.sendContextToAI(session)
        }

        // 发送缓存的音频
        this.flushAudioBuffer(session)
        // 通知客户端
        this.sendToClient(session.ws, {
          type: 'voice_ai.started',
          sessionId: session.sessionId,
          userId: session.userId,
        })
        this.onAIStateChange?.(session.sessionId, session.userId, 'listening')
        resolve?.()
        break

      case EVENT_SESSION_FAILED:
        console.error('[VoiceAI] Session failed:', payload)
        this.sendErrorToClient(session.ws, payload?.error || 'Session failed')
        reject?.(new Error(payload?.error || 'Session failed'))
        break

      case EVENT_ASR_INFO:
        // 检测到首字，用于打断播报
        this.onAIStateChange?.(session.sessionId, session.userId, 'listening')
        break

      case EVENT_ASR_RESPONSE:
        // 语音识别结果
        const asrResults = payload?.results || []
        asrResults.forEach((result: any) => {
          const text = result.text || ''
          // 火山引擎可能使用 is_interim 或 is_final 字段
          // is_interim=true 表示中间结果，is_final=true 表示最终结果
          const isInterim = result.is_interim === true || result.is_final === false
          // 只通过回调发送，避免重复
          this.onASRResult?.(session.sessionId, session.userId, text, isInterim)
        })
        break

      case EVENT_ASR_ENDED:
        // 用户说话结束
        this.onAIStateChange?.(session.sessionId, session.userId, 'thinking')
        break

      case EVENT_CHAT_RESPONSE:
        // AI文本响应
        const chatContent = payload?.content || ''
        const questionId = payload?.question_id
        const replyId = payload?.reply_id
        // 如果会话正在关闭，不发送回复给客户端
        if (session.isClosing) {
          break
        }
        // 只通过回调发送，避免重复
        this.onAIResponse?.(session.sessionId, session.userId, chatContent, questionId, replyId)
        break

      case EVENT_CHAT_ENDED:
        // AI回复结束
        break

      case EVENT_TTS_SENTENCE_START:
        // TTS句子开始
        this.onAIStateChange?.(session.sessionId, session.userId, 'speaking')
        break

      case EVENT_TTS_RESPONSE:
        // TTS音频响应 (OGG/Opus格式)

        if (payload) {
          // 确保 payload 是 Buffer
          const audioBuffer = Buffer.isBuffer(payload) ? payload : Buffer.from(payload)

          // 检查OGG魔数
          if (audioBuffer[0] === 0x4F && audioBuffer[1] === 0x67 && audioBuffer[2] === 0x67 && audioBuffer[3] === 0x53) {
          } else {
          }

          // 如果会话正在关闭，不发送音频给客户端
          if (session.isClosing) {
            break
          }

          // 发送音频数据
          this.onAIAudio?.(session.sessionId, session.userId, audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength))
        }
        break

      case EVENT_TTS_ENDED:
        // TTS结束
        this.onAIStateChange?.(session.sessionId, session.userId, 'listening')
        break

      case EVENT_DIALOG_COMMON_ERROR:
        // 对话错误
        const errorMsg = payload?.message || payload?.status_code || 'Unknown error'
        console.error('[VoiceAI] Dialog error:', errorMsg)
        this.sendErrorToClient(session.ws, errorMsg)
        this.onError?.(session.sessionId, session.userId, errorMsg)
        break

      default:
    }
  }

  /**
   * 发送 StartSession 事件
   */
  private sendStartSession(session: VoiceAISession): void {
    const payload = {
      dialog: {
        bot_name: '豆包',
        dialog_id: session.dialogId || '',  // 用于接续对话
        extra: {
          model: 'O',  // 使用O版本
        }
      },
      // AI介入时机配置：静音3秒后AI才介入
      end_smooth_window_ms: 3000
    }

    const message = BinaryProtocol.encodeClientEvent(
      EVENT_START_SESSION,
      session.volcanoSessionId,
      payload
    )

    session.volcanoWs?.send(message)
  }

  /**
   * 处理火山引擎错误
   */
  private handleVolcanoError(session: VoiceAISession, error: Error): void {
    console.error('[VoiceAI] Volcano error:', error)
    this.sendErrorToClient(session.ws, error.message)
    this.onError?.(session.sessionId, session.userId, error.message)
  }

  /**
   * 发送缓存的音频
   */
  private async flushAudioBuffer(session: VoiceAISession): Promise<void> {
    if (session.audioBuffer.length === 0) return


    for (const audioData of session.audioBuffer) {
      await this.sendAudio(session.sessionId, session.userId, audioData)
    }

    session.audioBuffer = []
  }

  /**
   * 发送消息到客户端
   */
  private sendToClient(ws: ServerWebSocket<unknown>, data: object): void {
    try {
      ws.send(JSON.stringify({
        ...data,
        timestamp: new Date().toISOString(),
      }))
    } catch (error) {
      console.error('[VoiceAI] Error sending to client:', error)
    }
  }

  /**
   * 发送错误消息到客户端
   */
  private sendErrorToClient(ws: ServerWebSocket<unknown>, message: string): void {
    this.sendToClient(ws, {
      type: 'voice_ai.error',
      message,
    })
  }

  /**
   * 获取会话状态
   */
  getSessionState(sessionId: string, userId: string): VoiceAIState | null {
    const sessionKey = `${sessionId}:${userId}`
    const session = this.sessions.get(sessionKey)

    if (!session) return null

    return {
      isSessionActive: !!session.volcanoWs && session.volcanoWs.readyState === 1, // WebSocket.OPEN = 1
      isListening: session.isReady,
      isSpeaking: false,
      currentTranscript: '',
      lastResponse: '',
    }
  }

  /**
   * 清理不活跃的会话
   */
  /**
   * 清理不活跃的会话
   */
  cleanupInactiveSessions(maxInactiveTime: number = 10 * 60 * 1000): void {
    const now = Date.now()
    let cleanedSessions = 0
    let cleanedSharedSessions = 0

    for (const [key, session] of this.sessions) {
      if (now - session.lastActivityTime > maxInactiveTime) {
        // 清理音频缓冲区
        session.audioBuffer = []
        this.stopSession(session.sessionId, session.userId)
        cleanedSessions++
      }
    }

    // 清理不活跃的共享会话
    for (const [sessionId, session] of this.sharedSessions) {
      if (now - session.lastActivityTime > maxInactiveTime) {
        // 清理音频缓冲区
        session.audioBuffer = []
        this.stopSharedSession(sessionId)
        cleanedSharedSessions++
      }
    }

    if (cleanedSessions > 0 || cleanedSharedSessions > 0) {
      console.log(`[VoiceAI] Cleaned ${cleanedSessions} sessions, ${cleanedSharedSessions} shared sessions`)
    }
  }
}

// 单例实例
let voiceAIServiceInstance: VoiceAIService | null = null

export function getVoiceAIService(): VoiceAIService {
  if (!voiceAIServiceInstance) {
    voiceAIServiceInstance = new VoiceAIService()
  }
  return voiceAIServiceInstance
}

export { VoiceAIService, BinaryProtocol }
