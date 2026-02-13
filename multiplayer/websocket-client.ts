/**
 * WebSocket Client
 * WebSocket 客户端连接管理
 *
 * 管理与服务器的连接、断线重连、状态同步
 */

import type { ChatMessage, Participant, UserRole, WebSocketEvent } from "./types"

// =============================================================================
// 配置类型
// =============================================================================

export interface WebSocketClientConfig {
  /** 服务器 URL */
  url: string
  /** 自动重连 */
  autoReconnect?: boolean
  /** 最大重连尝试次数（0 表示无限） */
  maxReconnectAttempts?: number
  /** 初始重连延迟（毫秒） */
  reconnectDelay?: number
  /** 最大重连延迟（毫秒） */
  maxReconnectDelay?: number
  /** 重连延迟倍数（指数退避） */
  reconnectBackoff?: number
  /** 心跳间隔（毫秒） */
  heartbeatInterval?: number
  /** 心跳超时（毫秒） */
  heartbeatTimeout?: number
  /** 连接超时（毫秒） */
  connectionTimeout?: number
}

export const DEFAULT_CLIENT_CONFIG: WebSocketClientConfig = {
  url: "ws://localhost:8080",
  autoReconnect: true,
  maxReconnectAttempts: 0, // 无限重连
  reconnectDelay: 1000,
  maxReconnectDelay: 30000,
  reconnectBackoff: 1.5,
  heartbeatInterval: 30000,
  heartbeatTimeout: 60000,
  connectionTimeout: 10000,
}

// =============================================================================
// 连接状态
// =============================================================================

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"

export interface ConnectionStatus {
  state: ConnectionState
  connectedAt?: Date
  disconnectedAt?: Date
  lastError?: string
  reconnectAttempts: number
  latency?: number
}

// =============================================================================
// 事件处理器类型
// =============================================================================

export interface WebSocketClientHandlers {
  onConnect?: () => void
  onDisconnect?: (reason: string) => void
  onError?: (error: Error) => void
  onMessage?: (message: ChatMessage) => void
  onMessageUpdated?: (messageId: string, content: string, editedAt: string) => void
  onMessageDeleted?: (messageId: string) => void
  onUserJoined?: (participant: Participant) => void
  onUserLeft?: (userId: string, userName: string) => void
  onUserStatusChanged?: (userId: string, status: Participant["status"]) => void
  onTypingStart?: (userId: string, userName: string) => void
  onTypingStop?: (userId: string, userName: string) => void
  onReaction?: (messageId: string, emoji: string, userId: string, action: "add" | "remove") => void
  onAIResponse?: (message: ChatMessage) => void
  onAIThinking?: (thinking: string) => void
  onVoiceTranscribed?: (messageId: string, transcript: string, success: boolean) => void
  onFileShared?: (fileInfo: {
    fileName: string
    fileSize: number
    mimeType: string
    content: string
    sharedBy: string
    sharedByName: string
  }) => void
  onHistoryLoaded?: (messages: ChatMessage[]) => void
  onConnectionStateChange?: (status: ConnectionStatus) => void
  onLatencyUpdate?: (latency: number) => void
}

// =============================================================================
// WebSocket 客户端
// =============================================================================

export class MultiplayerWebSocketClient {
  private config: WebSocketClientConfig
  private handlers: WebSocketClientHandlers
  private ws: WebSocket | null = null
  private status: ConnectionStatus = {
    state: "disconnected",
    reconnectAttempts: 0,
  }

  // 定时器
  private heartbeatTimer: NodeJS.Timeout | null = null
  private heartbeatTimeoutTimer: NodeJS.Timeout | null = null
  private reconnectTimer: NodeJS.Timeout | null = null
  private connectionTimeoutTimer: NodeJS.Timeout | null = null

  // 连接信息
  private sessionId: string = ""
  private userId: string = ""
  private userName: string = ""
  private userRole: UserRole = "guest"
  private messageQueue: Array<{ type: string; payload: unknown }> = []

  constructor(
    config: Partial<WebSocketClientConfig> = {},
    handlers: WebSocketClientHandlers = {}
  ) {
    this.config = { ...DEFAULT_CLIENT_CONFIG, ...config }
    this.handlers = handlers
  }

  // ============================================================================
  // 连接管理
  // ============================================================================

  /**
   * 连接到服务器
   */
  connect(sessionId: string, userId: string, userName: string, userRole: UserRole): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.warn("[WebSocket Client] Already connected")
      return
    }

    this.sessionId = sessionId
    this.userId = userId
    this.userName = userName
    this.userRole = userRole

    this.updateStatus({ state: "connecting" })

    try {
      this.ws = new WebSocket(this.config.url)

      // 连接超时
      this.connectionTimeoutTimer = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.ws?.close()
          this.handleConnectionTimeout()
        }
      }, this.config.connectionTimeout)

      this.ws.onopen = () => this.handleOpen()
      this.ws.onclose = (event) => this.handleClose(event)
      this.ws.onerror = (error) => this.handleError(error)
      this.ws.onmessage = (event) => this.handleMessage(event)
    } catch (error) {
      this.handleError(error as Error)
    }
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    // 停止重连
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // 停止心跳
    this.stopHeartbeat()

    // 关闭连接
    if (this.ws) {
      this.ws.close(1000, "Client disconnected")
      this.ws = null
    }

    this.updateStatus({
      state: "disconnected",
      disconnectedAt: new Date(),
    })
  }

  /**
   * 重新连接
   */
  reconnect(): void {
    this.disconnect()
    this.status.reconnectAttempts = 0
    this.connect(this.sessionId, this.userId, this.userName, this.userRole)
  }

  // ============================================================================
  // 事件处理器
  // ============================================================================

  private handleOpen(): void {
    // 清除连接超时
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer)
      this.connectionTimeoutTimer = null
    }

    // 重置重连计数
    this.status.reconnectAttempts = 0

    // 更新状态
    this.updateStatus({
      state: "connected",
      connectedAt: new Date(),
    })

    // 发送连接消息
    this.send({
      type: "connect",
      sessionId: this.sessionId,
      userId: this.userId,
      userName: this.userName,
      userRole: this.userRole,
    })

    // 启动心跳
    this.startHeartbeat()

    // 发送队列中的消息
    this.flushMessageQueue()

    this.handlers.onConnect?.()
  }

  private handleClose(event: CloseEvent): void {
    // 清除定时器
    if (this.connectionTimeoutTimer) {
      clearTimeout(this.connectionTimeoutTimer)
      this.connectionTimeoutTimer = null
    }

    this.stopHeartbeat()

    const wasConnected = this.status.state === "connected"
    const reason = event.reason || `Code: ${event.code}`

    this.updateStatus({
      state: "disconnected",
      disconnectedAt: new Date(),
    })

    this.handlers.onDisconnect?.(reason)

    // 自动重连
    if (this.config.autoReconnect && wasConnected) {
      this.scheduleReconnect()
    }
  }

  private handleError(error: Error | Event): void {
    const errorMessage = error instanceof Error ? error.message : "WebSocket error"

    this.updateStatus({
      state: "error",
      lastError: errorMessage,
    })

    this.handlers.onError?.(error instanceof Error ? error : new Error(errorMessage))
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data) as WebSocketEvent
      this.processServerMessage(data)
    } catch (error) {
      console.error("[WebSocket Client] Failed to parse message:", error)
    }
  }

  private handleConnectionTimeout(): void {
    console.error("[WebSocket Client] Connection timeout")
    this.updateStatus({
      state: "error",
      lastError: "Connection timeout",
    })

    if (this.config.autoReconnect) {
      this.scheduleReconnect()
    }
  }

  // ============================================================================
  // 消息处理
  // ============================================================================

  private processServerMessage(event: WebSocketEvent): void {
    switch (event.type) {
      case "connection.established":
        // 连接已建立，可以开始发送消息
        break

      case "connection.pong":
        this.handlePong(event.payload as { clientTimestamp: number; serverTimestamp: number })
        break

      case "message.new":
        this.handlers.onMessage?.(event.payload as ChatMessage)
        break

      case "message.updated":
        const updatePayload = event.payload as { messageId: string; content: string; editedAt: string }
        this.handlers.onMessageUpdated?.(updatePayload.messageId, updatePayload.content, updatePayload.editedAt)
        break

      case "message.deleted":
        const deletePayload = event.payload as { messageId: string }
        this.handlers.onMessageDeleted?.(deletePayload.messageId)
        break

      case "message.reaction":
        const reactionPayload = event.payload as {
          messageId: string
          emoji: string
          userId: string
          action: "add" | "remove"
        }
        this.handlers.onReaction?.(
          reactionPayload.messageId,
          reactionPayload.emoji,
          reactionPayload.userId,
          reactionPayload.action
        )
        break

      case "user.joined":
        const joinedPayload = event.payload as Participant
        this.handlers.onUserJoined?.(joinedPayload)
        break

      case "user.left":
        const leftPayload = event.payload as { userId: string; userName: string }
        this.handlers.onUserLeft?.(leftPayload.userId, leftPayload.userName)
        break

      case "user.status_changed":
        const statusPayload = event.payload as { userId: string; status: Participant["status"] }
        this.handlers.onUserStatusChanged?.(statusPayload.userId, statusPayload.status)
        break

      case "typing.start":
        const typingStartPayload = event.payload as { userId: string; userName: string }
        this.handlers.onTypingStart?.(typingStartPayload.userId, typingStartPayload.userName)
        break

      case "typing.stop":
        const typingStopPayload = event.payload as { userId: string; userName: string }
        this.handlers.onTypingStop?.(typingStopPayload.userId, typingStopPayload.userName)
        break

      case "ai.response":
        this.handlers.onAIResponse?.(event.payload as ChatMessage)
        break

      case "ai.thinking":
        const thinkingPayload = event.payload as { thinking: string }
        this.handlers.onAIThinking?.(thinkingPayload.thinking)
        break

      case "voice.transcribed":
        const transcribedPayload = event.payload as {
          messageId: string
          transcript: string
          success: boolean
        }
        this.handlers.onVoiceTranscribed?.(
          transcribedPayload.messageId,
          transcribedPayload.transcript,
          transcribedPayload.success
        )
        break

      case "file.shared":
        this.handlers.onFileShared?.(event.payload as {
          fileName: string
          fileSize: number
          mimeType: string
          content: string
          sharedBy: string
          sharedByName: string
        })
        break

      case "history.loaded":
        const historyPayload = event.payload as { messages: ChatMessage[] }
        this.handlers.onHistoryLoaded?.(historyPayload.messages)
        break

      case "error":
        const errorPayload = event.payload as { message: string; details?: unknown }
        console.error("[WebSocket Client] Server error:", errorPayload.message, errorPayload.details)
        break
    }
  }

  // ============================================================================
  // 心跳机制
  // ============================================================================

  private startHeartbeat(): void {
    this.stopHeartbeat()

    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== WebSocket.OPEN) return

      const timestamp = Date.now()
      this.send({ type: "ping", timestamp })

      // 设置心跳超时
      this.heartbeatTimeoutTimer = setTimeout(() => {
        console.warn("[WebSocket Client] Heartbeat timeout")
        this.ws?.close()
      }, this.config.heartbeatTimeout)
    }, this.config.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer)
      this.heartbeatTimeoutTimer = null
    }
  }

  private handlePong(payload: { clientTimestamp: number; serverTimestamp: number }): void {
    // 清除心跳超时
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer)
      this.heartbeatTimeoutTimer = null
    }

    // 计算延迟
    const now = Date.now()
    const latency = now - payload.clientTimestamp
    this.status.latency = latency
    this.handlers.onLatencyUpdate?.(latency)
  }

  // ============================================================================
  // 重连机制
  // ============================================================================

  private scheduleReconnect(): void {
    const maxAttempts = this.config.maxReconnectAttempts ?? 0

    // 检查是否达到最大重连次数
    if (maxAttempts > 0 && this.status.reconnectAttempts >= maxAttempts) {
      console.error("[WebSocket Client] Max reconnection attempts reached")
      this.updateStatus({ state: "error", lastError: "Max reconnection attempts reached" })
      return
    }

    this.status.reconnectAttempts++
    this.updateStatus({ state: "reconnecting" })

    // 计算延迟（指数退避）
    const delay = Math.min(
      this.config.reconnectDelay! * Math.pow(this.config.reconnectBackoff!, this.status.reconnectAttempts - 1),
      this.config.maxReconnectDelay!
    )

    console.log(`[WebSocket Client] Reconnecting in ${delay}ms (attempt ${this.status.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect(this.sessionId, this.userId, this.userName, this.userRole)
    }, delay)
  }

  // ============================================================================
  // 消息发送
  // ============================================================================

  private send(data: unknown): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
      return true
    }
    return false
  }

  private queueMessage(type: string, payload: unknown): void {
    this.messageQueue.push({ type, payload })
    // 限制队列大小
    if (this.messageQueue.length > 100) {
      this.messageQueue = this.messageQueue.slice(-50)
    }
  }

  private flushMessageQueue(): void {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift()
      if (message) {
        this.send(message)
      }
    }
  }

  // ============================================================================
  // 公共 API
  // ============================================================================

  /**
   * 发送聊天消息
   */
  sendMessage(message: Omit<ChatMessage, "sessionId" | "senderId" | "senderName" | "senderRole" | "timestamp">): void {
    const data = {
      type: "message",
      message,
    }

    if (!this.send(data)) {
      this.queueMessage("message", message)
    }
  }

  /**
   * 发送正在输入状态
   */
  sendTyping(isTyping: boolean): void {
    this.send({ type: "typing", isTyping })
  }

  /**
   * 发送状态变更
   */
  sendStatus(status: Participant["status"]): void {
    this.send({ type: "status", status })
  }

  /**
   * 编辑消息
   */
  editMessage(messageId: string, content: string): void {
    this.send({ type: "edit_message", messageId, content })
  }

  /**
   * 删除消息
   */
  deleteMessage(messageId: string): void {
    this.send({ type: "delete_message", messageId })
  }

  /**
   * 添加/移除反应
   */
  sendReaction(messageId: string, emoji: string, action: "add" | "remove"): void {
    this.send({ type: "reaction", messageId, emoji, action })
  }

  /**
   * 邀请用户
   */
  inviteUser(userId: string, userName: string, role: UserRole): void {
    this.send({ type: "invite", userId, userName, role })
  }

  /**
   * 踢出用户
   */
  kickUser(userId: string, reason?: string): void {
    this.send({ type: "kick", userId, reason })
  }

  /**
   * 更改用户角色
   */
  changeUserRole(userId: string, newRole: UserRole): void {
    this.send({ type: "change_role", userId, newRole })
  }

  /**
   * 分享文件
   */
  shareFile(fileName: string, fileSize: number, mimeType: string, content: string): void {
    this.send({ type: "share_file", fileName, fileSize, mimeType, content })
  }

  /**
   * 请求语音转录
   */
  requestTranscription(messageId: string, voiceUrl: string): void {
    this.send({ type: "transcribe_voice", messageId, voiceUrl })
  }

  /**
   * 获取历史消息
   */
  getHistory(before?: string, limit: number = 50): void {
    this.send({ type: "get_history", before, limit })
  }

  // ============================================================================
  // 状态获取
  // ============================================================================

  /**
   * 获取当前连接状态
   */
  getStatus(): ConnectionStatus {
    return { ...this.status }
  }

  /**
   * 获取客户端完整状态
   */
  getState(): {
    status: ConnectionStatus
    sessionId: string
    userId: string
    userName: string
    userRole: UserRole
  } {
    return {
      status: { ...this.status },
      sessionId: this.sessionId,
      userId: this.userId,
      userName: this.userName,
      userRole: this.userRole,
    }
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.status.state === "connected" && this.ws?.readyState === WebSocket.OPEN
  }

  /**
   * 获取当前延迟
   */
  getLatency(): number | undefined {
    return this.status.latency
  }

  // ============================================================================
  // 内部方法
  // ============================================================================

  private updateStatus(updates: Partial<ConnectionStatus>): void {
    this.status = { ...this.status, ...updates }
    this.handlers.onConnectionStateChange?.(this.getStatus())
  }
}
