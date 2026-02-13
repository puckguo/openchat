/**
 * Voice Chat Service
 * 多人语音聊天服务 - 使用阿里云DashScope实时语音识别API
 *
 * 正确API格式参考：https://help.aliyun.com/zh/dashscope/developer-reference/websocket-api
 *
 * 支持：
 * 1. 每个用户独立的 ASR WebSocket 连接
 * 2. 持续音频流识别
 * 3. 自动带 userId 的识别结果
 */

import type { ServerWebSocket } from "bun"

// =============================================================================
// 配置
// =============================================================================

export interface VoiceChatConfig {
  /** 阿里云 DashScope API Key */
  apiKey: string
  /** WebSocket 端点 */
  endpoint: string
  /** 模型名称 */
  model: string
}

export function getVoiceChatConfig(): VoiceChatConfig {
  return {
    apiKey: process.env.DASHSCOPE_API_KEY || "",
    endpoint: process.env.DASHSCOPE_ENDPOINT || "wss://dashscope.aliyuncs.com/api-ws/v1/inference/",
    model: process.env.DASHSCOPE_ASR_MODEL || "paraformer-realtime-v1",
  }
}

// =============================================================================
// 类型定义
// =============================================================================

/** 语音聊天参与者 */
export interface VoiceChatParticipant {
  userId: string
  userName: string
  ws: ServerWebSocket<unknown>
  isJoined: boolean
  isSpeaking: boolean
  asrConnection?: WebSocket
  currentTranscript: string
  lastAudioTime: number
  speakStartTime?: number
  silenceCount: number
  taskId?: string
  asrReady: boolean
  audioBuffer?: ArrayBuffer[]
  sendCount?: number
}

/** 语音聊天室 */
export interface VoiceChatRoom {
  sessionId: string
  participants: Map<string, VoiceChatParticipant>
  isActive: boolean
  createdAt: number
  transcripts: VoiceTranscript[]
  audioBroadcastCount?: number  // 音频广播计数（用于调试）
}

/** 语音转录结果 */
export interface VoiceTranscript {
  id: string
  sessionId: string
  userId: string
  userName: string
  text: string
  timestamp: number
  isFinal: boolean
  speakStartTime?: number
  speakEndTime?: number
}

/** 阿里云 ASR WebSocket 消息格式 */
interface ASRMessage {
  header: {
    message_id: string
    task_id: string
    namespace: string
    name: string
    status: number
    status_message?: string
    event: string
  }
  payload: {
    output?: {
      sentence?: {
        sentence_id: number
        text: string
        begin_time: number
        end_time: number
        words?: Array<{
          text: string
          begin_time: number
          end_time: number
        }>
        speech_rate?: number
        emotion?: string
      }
      subtitle?: {
        begin_time: number
        text: string
      }
    }
    usage?: {
      input_tokens: number
    }
  }
}

// =============================================================================
// VAD 配置
// =============================================================================

const VAD_CONFIG = {
  SILENCE_THRESHOLD: 15,
  MAX_SILENCE_TIME: 2000,
  MIN_SPEECH_LENGTH: 500,
  AUDIO_INTERVAL: 100,
}

// =============================================================================
// 语音聊天服务
// =============================================================================

export class VoiceChatService {
  private config: VoiceChatConfig
  private rooms: Map<string, VoiceChatRoom> = new Map()
  private enabled: boolean = false

  public onTranscript: ((sessionId: string, transcript: VoiceTranscript) => void) | null = null
  public onSpeakingStateChange: ((sessionId: string, userId: string, userName: string, isSpeaking: boolean) => void) | null = null
  public onAIAnalyze: ((sessionId: string, context: string) => void) | null = null

  constructor() {
    this.config = getVoiceChatConfig()
    this.enabled = !!this.config.apiKey
    console.log(`[VoiceChat] Service ${this.enabled ? 'enabled' : 'disabled'}, model: ${this.config.model}`)
  }

  isEnabled(): boolean {
    return this.enabled
  }

  getOrCreateRoom(sessionId: string): VoiceChatRoom {
    let room = this.rooms.get(sessionId)
    if (!room) {
      room = {
        sessionId,
        participants: new Map(),
        isActive: false,
        createdAt: Date.now(),
        transcripts: [],
      }
      this.rooms.set(sessionId, room)
      console.log(`[VoiceChat] Created room: ${sessionId}`)
    }
    return room
  }

  async joinVoiceChat(
    sessionId: string,
    userId: string,
    userName: string,
    ws: ServerWebSocket<unknown>
  ): Promise<boolean> {
    if (!this.enabled) {
      console.log(`[VoiceChat] Cannot join: service not enabled`)
      return false
    }

    const room = this.getOrCreateRoom(sessionId)

    if (room.participants.has(userId)) {
      console.log(`[VoiceChat] User ${userId} already in room ${sessionId}`)
      return true
    }

    const participant: VoiceChatParticipant = {
      userId,
      userName,
      ws,
      isJoined: true,
      isSpeaking: false,
      currentTranscript: "",
      lastAudioTime: 0,
      silenceCount: 0,
      asrReady: false,
    }

    room.participants.set(userId, participant)
    room.isActive = true

    console.log(`[VoiceChat] User ${userName}(${userId}) joined room ${sessionId}`)

    // 立即返回成功，让前端知道已加入
    // ASR 连接异步建立，建立好后（task-started 事件）会通知前端
    this.connectToASR(sessionId, userId).catch(error => {
      console.error(`[VoiceChat] Failed to establish ASR connection for ${userId}:`, error)
      this.sendToParticipant(participant, {
        type: "voice.error",
        error: "asr_connection_failed",
        message: "语音识别服务连接失败",
      })
    })

    // 广播给其他参与者（不包括自己）
    this.broadcastToRoom(room, {
      type: "voice.join",
      userId,
      userName,
      participantCount: room.participants.size,
    }, [userId])

    return true
  }

  leaveVoiceChat(sessionId: string, userId: string): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    const participant = room.participants.get(userId)
    if (!participant) return

    if (participant.isSpeaking) {
      this.handleSpeechEnd(sessionId, userId)
    }

    this.closeASRConnection(userId, participant)
    room.participants.delete(userId)

    console.log(`[VoiceChat] User ${participant.userName}(${userId}) left room ${sessionId}`)

    this.broadcastToRoom(room, {
      type: "voice.leave",
      userId,
      userName: participant.userName,
      participantCount: room.participants.size,
    })

    if (room.participants.size === 0) {
      this.rooms.delete(sessionId)
      console.log(`[VoiceChat] Deleted empty room: ${sessionId}`)
    }
  }

  async handleContinuousAudio(
    sessionId: string,
    userId: string,
    audioData: ArrayBuffer,
    isSpeech: boolean
  ): Promise<void> {
    console.log(`[VoiceChat] handleContinuousAudio: ENTER - sessionId=${sessionId}, userId=${userId}, audioDataSize=${audioData.byteLength}, isSpeech=${isSpeech}`)

    const room = this.rooms.get(sessionId)
    if (!room) {
      console.log(`[VoiceChat] handleContinuousAudio: room not found for ${sessionId}`)
      return
    }

    const participant = room.participants.get(userId)
    if (!participant) {
      console.log(`[VoiceChat] handleContinuousAudio: participant not found for ${userId}`)
      return
    }
    if (!participant.isJoined) {
      console.log(`[VoiceChat] handleContinuousAudio: participant ${userId} not joined`)
      return
    }

    // 记录 ASR 连接状态
    console.log(`[VoiceChat] handleContinuousAudio: ASR connection status for ${userId}: asrConnection=${participant.asrConnection ? 'EXISTS' : 'NULL'}, asrReady=${participant.asrReady}, readyState=${participant.asrConnection?.readyState}`)

    if (!participant.asrConnection) {
      console.log(`[VoiceChat] handleContinuousAudio: no ASR connection for ${userId}, buffering audio...`)
      // 还没有ASR连接，先缓冲音频
      if (!participant.audioBuffer) {
        participant.audioBuffer = []
      }
      participant.audioBuffer.push(audioData)
      if (participant.audioBuffer.length > 500) {
        participant.audioBuffer.shift()
      }
      return
    }
    // 需要等待 ASR task-started 后才能发送音频
    if (!participant.asrReady) {
      // ASR 还在准备中，缓冲音频数据
      if (!participant.audioBuffer) {
        participant.audioBuffer = []
      }
      participant.audioBuffer.push(audioData)
      // 限制缓冲区大小（约5秒音频），防止内存泄漏
      if (participant.audioBuffer.length > 500) {
        participant.audioBuffer.shift()
      }
      console.log(`[VoiceChat] handleContinuousAudio: ASR not ready yet for ${userId}, buffered ${participant.audioBuffer.length} frames`)
      return
    }
    if (participant.asrConnection.readyState !== WebSocket.OPEN) {
      console.log(`[VoiceChat] handleContinuousAudio: ASR connection not open for ${userId}, state=${participant.asrConnection.readyState}`)
      return
    }

    participant.lastAudioTime = Date.now()

    // 调试日志：显示音频数据状态
    console.log(`[VoiceChat] handleContinuousAudio: isSpeech=${isSpeech}, audioDataSize=${audioData.byteLength}, asrReady=${participant.asrReady}, connectionState=${participant.asrConnection?.readyState}`)

    // 始终发送音频数据给 ASR（ASR 自己做 VAD），但用 isSpeech 控制 UI 状态
    if (isSpeech) {
      participant.silenceCount = 0

      if (!participant.isSpeaking) {
        participant.isSpeaking = true
        participant.speakStartTime = Date.now()
        participant.currentTranscript = ""
        console.log(`[VoiceChat] User ${participant.userName} started speaking`)

        this.onSpeakingStateChange?.(sessionId, userId, participant.userName, true)
        this.broadcastToRoom(room, {
          type: "voice.speaking.start",
          userId,
          userName: participant.userName,
        }, [userId])
      }
    } else {
      if (participant.isSpeaking) {
        participant.silenceCount++
        const silenceTime = participant.silenceCount * VAD_CONFIG.AUDIO_INTERVAL

        if (silenceTime >= VAD_CONFIG.MAX_SILENCE_TIME) {
          this.handleSpeechEnd(sessionId, userId)
        }
      }
    }

    // 始终发送音频给 ASR（保持连接活跃并让 ASR 自己做识别）
    await this.sendAudioToASR(participant, audioData)

    // 广播音频给其他参与者（实现语音对讲功能）
    console.log(`[VoiceChat] handleContinuousAudio: calling broadcastAudioToRoom for user ${userId} (${participant.userName}), room has ${room.participants.size} participants`)
    this.broadcastAudioToRoom(room, userId, participant.userName, audioData, isSpeech)
    console.log(`[VoiceChat] handleContinuousAudio: EXIT - userId=${userId}`)
  }

  private handleSpeechEnd(sessionId: string, userId: string): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    const participant = room.participants.get(userId)
    if (!participant || !participant.isSpeaking) return

    const speakDuration = Date.now() - (participant.speakStartTime || Date.now())
    console.log(`[VoiceChat] User ${participant.userName} stopped speaking, duration: ${speakDuration}ms`)

    participant.isSpeaking = false
    participant.silenceCount = 0

    this.onSpeakingStateChange?.(sessionId, userId, participant.userName, false)
    this.broadcastToRoom(room, {
      type: "voice.speaking.end",
      userId,
      userName: participant.userName,
    }, [userId])

    if (participant.asrConnection?.readyState === WebSocket.OPEN && participant.taskId) {
      try {
        const finishMessage = {
          header: {
            action: "finish-task",
            task_id: participant.taskId,
            streaming: "duplex"
          },
          payload: {
            input: {}
          }
        }
        participant.asrConnection.send(JSON.stringify(finishMessage))
        console.log(`[VoiceChat] Sent finish message to ASR for ${participant.userName}`)
      } catch (error) {
        console.error(`[VoiceChat] Error sending finish:`, error)
      }
    }
  }

  private async connectToASR(sessionId: string, userId: string): Promise<void> {
    const room = this.rooms.get(sessionId)
    if (!room) throw new Error("Room not found")

    const participant = room.participants.get(userId)
    if (!participant) throw new Error("Participant not found")

    const wsUrl = this.config.endpoint
    const taskId = `task_${userId}_${Date.now()}`
    participant.taskId = taskId

    console.log(`[VoiceChat] Connecting to ASR for user ${userId}: ${wsUrl}`)

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "X-DashScope-DataInspection": "enable",
        },
      })

      let connected = false
      const timeout = setTimeout(() => {
        if (!connected) {
          ws.close()
          reject(new Error("ASR connection timeout"))
        }
      }, 15000)

      ws.onopen = () => {
        console.log(`[VoiceChat] ASR WebSocket connected for user ${userId}`)
        // 立即设置连接，让音频可以开始发送
        participant.asrConnection = ws
        console.log(`[VoiceChat] ASR connection assigned for ${userId}, participant.asrConnection=${!!participant.asrConnection}`)

        // 根据阿里云文档的完整格式
        const runTaskMessage = {
          header: {
            action: "run-task",
            task_id: taskId,
            streaming: "duplex"
          },
          payload: {
            task_group: "audio",
            task: "asr",
            function: "recognition",
            model: this.config.model,
            parameters: {
              format: "pcm",
              sample_rate: 16000,
              disfluency_removal_enabled: false
            },
            input: {}
          }
        }

        ws.send(JSON.stringify(runTaskMessage))
        console.log(`[VoiceChat] Sent run-task message for ${userId}`)
      }

      ws.onmessage = (event) => {
        try {
          const rawData = event.data as string
          console.log(`[VoiceChat] ASR raw data from ${userId}:`, rawData.substring(0, 200))

          const data = JSON.parse(rawData)

          if (data.header?.event === "task-started") {
            console.log(`[VoiceChat] ASR task started for ${userId}`)
            connected = true
            participant.asrReady = true
            // 连接已经在 onopen 中设置，这里只标记 ready
            clearTimeout(timeout)
            // 立即发送缓冲的音频数据（ASR不能等，会超时）
            if (participant.audioBuffer && participant.audioBuffer.length > 0) {
              console.log(`[VoiceChat] Sending ${participant.audioBuffer.length} buffered audio frames to ASR for ${userId}`)
              // 打印第一帧的预览
              if (participant.audioBuffer.length > 0) {
                const firstFrame = new Uint8Array(participant.audioBuffer[0])
                console.log(`[VoiceChat] First buffered frame preview: ${Buffer.from(firstFrame.slice(0, 16)).toString('hex')}`)
              }
              for (const bufferedAudio of participant.audioBuffer) {
                this.sendAudioToASR(participant, bufferedAudio).catch(err => {
                  console.error(`[VoiceChat] Error sending buffered audio:`, err)
                })
              }
              participant.audioBuffer = []
            }
            // 通知前端 ASR 已准备好
            this.sendToParticipant(participant, {
              type: "voice.asr_ready",
              userId: participant.userId,
              userName: participant.userName,
            })
            console.log(`[VoiceChat] Sent voice.asr_ready to ${userId}`)
            resolve()
          } else if (data.header?.event === "result-generated") {
            console.log(`[VoiceChat] ASR result-generated for ${userId}:`, JSON.stringify(data.payload, null, 2))
            this.handleASRResult(sessionId, userId, data)
          } else if (data.header?.event === "error") {
            console.error(`[VoiceChat] ASR error for ${userId}:`, data)
          } else if (data.header?.event === "task-finished") {
            console.log(`[VoiceChat] ASR task finished for ${userId}`)
          }
        } catch (error) {
          console.error(`[VoiceChat] Failed to parse ASR message:`, error)
        }
      }

      ws.onerror = (error) => {
        console.error(`[VoiceChat] ASR WebSocket error for ${userId}:`, error)
        if (!connected) {
          clearTimeout(timeout)
          reject(error)
        }
      }

      ws.onclose = () => {
        console.log(`[VoiceChat] ASR WebSocket closed for ${userId}`)
        participant.asrReady = false
        if (participant.asrConnection === ws) {
          participant.asrConnection = undefined
        }

        if (participant.isJoined && room.participants.has(userId)) {
          setTimeout(() => {
            if (room.participants.has(userId)) {
              console.log(`[VoiceChat] Attempting to reconnect ASR for ${userId}`)
              this.connectToASR(sessionId, userId).catch(err => {
                console.error(`[VoiceChat] Reconnection failed for ${userId}:`, err)
              })
            }
          }, 5000)
        }
      }
    })
  }

  private async sendAudioToASR(participant: VoiceChatParticipant, audioData: ArrayBuffer | Buffer): Promise<void> {
    if (!participant.asrConnection) {
      console.log(`[VoiceChat] sendAudioToASR: no connection for ${participant.userId}`)
      return
    }
    if (participant.asrConnection.readyState !== WebSocket.OPEN) {
      console.log(`[VoiceChat] sendAudioToASR: connection not open for ${participant.userId}, state=${participant.asrConnection.readyState}`)
      return
    }

    try {
      // 确保数据是 Uint8Array 格式
      const uint8Data = audioData instanceof ArrayBuffer
        ? new Uint8Array(audioData)
        : new Uint8Array(audioData.buffer, audioData.byteOffset, audioData.byteLength)

      // 检查音频数据是否有效（16-bit PCM 样本）
      let maxVal = 0
      let sumVal = 0
      const samples = uint8Data.length / 2
      for (let i = 0; i < uint8Data.length; i += 2) {
        // 小端序读取 16-bit 有符号整数
        const sample = (uint8Data[i] | (uint8Data[i + 1] << 8))
        const signedSample = sample > 32767 ? sample - 65536 : sample
        const absVal = Math.abs(signedSample)
        maxVal = Math.max(maxVal, absVal)
        sumVal += absVal
      }
      const avgVal = samples > 0 ? sumVal / samples : 0

      // 每10帧打印一次音频统计（用于调试）
      if (!participant.sendCount) participant.sendCount = 0
      participant.sendCount++
      if (participant.sendCount % 10 === 0) {
        const preview = Buffer.from(uint8Data.slice(0, 16)).toString('hex')
        console.log(`[VoiceChat] Sent ${participant.sendCount} frames to ASR for ${participant.userId}, audio max=${maxVal}, avg=${avgVal.toFixed(2)}, preview=${preview}`)
      }

      participant.asrConnection.send(uint8Data)

      // 每50帧打印一次确认
      if (participant.sendCount % 50 === 0) {
        console.log(`[VoiceChat] ✓ Sent frame ${participant.sendCount} to ASR (${uint8Data.length} bytes)`)
      }
    } catch (error) {
      console.error(`[VoiceChat] Failed to send audio data:`, error)
    }
  }

  private handleASRResult(sessionId: string, userId: string, data: ASRMessage): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    const participant = room.participants.get(userId)
    if (!participant) return

    console.log(`[VoiceChat] handleASRResult called for ${userId}, payload:`, JSON.stringify(data.payload, null, 2))

    const sentence = data.payload?.output?.sentence
    if (!sentence || !sentence.text) {
      console.log(`[VoiceChat] No sentence or text in ASR result for ${userId}`)
      return
    }

    const text = sentence.text
    const isFinal = sentence.end_time > 0

    participant.currentTranscript = text

    const transcript: VoiceTranscript = {
      id: `vt_${Date.now()}_${userId}`,
      sessionId,
      userId,
      userName: participant.userName,
      text,
      timestamp: Date.now(),
      isFinal,
      speakStartTime: participant.speakStartTime,
    }

    if (isFinal) {
      room.transcripts.push(transcript)
      this.onTranscript?.(sessionId, transcript)

      // 广播给房间内所有参与者（包括发送者，让说话者自己也能看到转录结果）
      this.broadcastToRoom(room, {
        type: "voice.transcript.final",
        transcript,
        userId,
        userName: participant.userName,
      })

      participant.currentTranscript = ""
      console.log(`[VoiceChat] Final transcript from ${participant.userName}: ${text} (broadcasted to ${room.participants.size} participants)`)
    } else {
      // 广播中间结果给所有参与者（包括发送者）
      this.broadcastToRoom(room, {
        type: "voice.transcript",
        transcript,
        userId,
        userName: participant.userName,
      })
      console.log(`[VoiceChat] Transcript from ${participant.userName}: ${text} (intermediate, broadcasted to ${room.participants.size} participants)`)
    }
  }

  private closeASRConnection(userId: string, participant: VoiceChatParticipant): void {
    if (participant.asrConnection) {
      try {
        if (participant.asrConnection.readyState === WebSocket.OPEN && participant.taskId) {
          const finishMessage = {
            header: {
              action: "finish-task",
              task_id: participant.taskId,
              streaming: "duplex"
            },
            payload: {
              input: {}
            }
          }
          participant.asrConnection.send(JSON.stringify(finishMessage))
        }

        setTimeout(() => {
          try {
            participant.asrConnection?.close()
          } catch {}
          participant.asrConnection = undefined
          participant.asrReady = false
        }, 500)
      } catch (error) {
        console.error(`[VoiceChat] Error closing ASR connection for ${userId}:`, error)
      }
    }
  }

  triggerAIAnalysis(sessionId: string, userId: string): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    const participant = room.participants.get(userId)
    if (!participant) return

    const recentTranscripts = room.transcripts
      .slice(-20)
      .map(t => `${t.userName}: ${t.text}`)
      .join("\n")

    if (!recentTranscripts.trim()) {
      this.sendToParticipant(participant, {
        type: "voice.error",
        error: "no_content",
        message: "暂无可分析的语音内容",
      })
      return
    }

    console.log(`[VoiceChat] AI analysis triggered by ${participant.userName} in room ${sessionId}`)

    this.broadcastToRoom(room, {
      type: "voice.ai_analyze",
      status: "analyzing",
      triggeredBy: userId,
      triggeredByName: participant.userName,
    })

    this.onAIAnalyze?.(sessionId, recentTranscripts)
  }

  getRoomInfo(sessionId: string) {
    const room = this.rooms.get(sessionId)
    if (!room) return null

    return {
      sessionId: room.sessionId,
      isActive: room.isActive,
      participantCount: room.participants.size,
      participants: Array.from(room.participants.values()).map(p => ({
        userId: p.userId,
        userName: p.userName,
        isJoined: p.isJoined,
        isSpeaking: p.isSpeaking,
        hasASRConnection: !!p.asrConnection && p.asrConnection.readyState === WebSocket.OPEN,
        asrReady: p.asrReady,
      })),
      transcriptCount: room.transcripts.length,
    }
  }

  getTranscripts(sessionId: string, limit: number = 50): VoiceTranscript[] {
    const room = this.rooms.get(sessionId)
    if (!room) return []

    return room.transcripts.slice(-limit)
  }

  cleanupUser(userId: string): void {
    for (const [sessionId, room] of this.rooms) {
      if (room.participants.has(userId)) {
        this.leaveVoiceChat(sessionId, userId)
      }
    }
  }

  forceEndSpeaking(sessionId: string, userId: string): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    const participant = room.participants.get(userId)
    if (!participant || !participant.isSpeaking) return

    const lastAudioTime = participant.lastAudioTime
    const now = Date.now()

    if (now - lastAudioTime > VAD_CONFIG.MAX_SILENCE_TIME) {
      console.log(`[VoiceChat] Force ending speech for ${participant.userName} due to timeout`)
      this.handleSpeechEnd(sessionId, userId)
    }
  }

  private sendToParticipant(participant: VoiceChatParticipant, message: unknown): void {
    try {
      participant.ws.send(JSON.stringify(message))
    } catch (error) {
      console.error(`[VoiceChat] Failed to send message to ${participant.userId}:`, error)
    }
  }

  private broadcastToRoom(room: VoiceChatRoom, message: unknown, excludeUserIds: string[] = []): void {
    const messageStr = JSON.stringify(message)

    for (const [userId, participant] of room.participants) {
      if (excludeUserIds.includes(userId)) continue

      try {
        participant.ws.send(messageStr)
      } catch (error) {
        console.error(`[VoiceChat] Failed to broadcast to ${userId}:`, error)
      }
    }
  }

  /**
   * 广播音频数据给房间内其他参与者（实现语音对讲）
   */
  private broadcastAudioToRoom(
    room: VoiceChatRoom,
    senderUserId: string,
    senderUserName: string,
    audioData: ArrayBuffer,
    isSpeech: boolean
  ): void {
    console.log(`[VoiceChat] broadcastAudioToRoom: ENTER - sender=${senderUserId} (${senderUserName}), roomParticipants=${room.participants.size}, audioSize=${audioData.byteLength}, isSpeech=${isSpeech}`)

    // 将 ArrayBuffer 转换为 Base64 (使用 Buffer 替代 btoa，确保在 Bun 环境中正常工作)
    const uint8Array = new Uint8Array(audioData)
    const base64Audio = Buffer.from(uint8Array).toString('base64')
    console.log(`[VoiceChat] broadcastAudioToRoom: audio converted to base64, length=${base64Audio.length}`)

    // 构建音频消息
    const audioMessage = {
      type: "voice.audio",
      userId: senderUserId,
      userName: senderUserName,
      audioData: base64Audio,
      isSpeech: isSpeech,
      timestamp: Date.now(),
    }

    const messageStr = JSON.stringify(audioMessage)
    console.log(`[VoiceChat] broadcastAudioToRoom: message prepared, JSON length=${messageStr.length}`)

    // 广播给房间内的其他参与者（不包括发送者）
    let broadcastCount = 0
    let skippedCount = 0
    let errorCount = 0

    console.log(`[VoiceChat] broadcastAudioToRoom: iterating ${room.participants.size} participants...`)
    for (const [userId, participant] of room.participants) {
      // 记录每个参与者的广播状态
      const wsState = participant.ws.readyState
      const isSender = userId === senderUserId
      console.log(`[VoiceChat] broadcastAudioToRoom: checking participant ${userId} - isSender=${isSender}, wsReadyState=${wsState}, isJoined=${participant.isJoined}`)

      if (isSender) {
        console.log(`[VoiceChat] broadcastAudioToRoom: SKIPPING sender ${userId}`)
        skippedCount++
        continue
      }

      if (wsState !== WebSocket.OPEN) {
        console.log(`[VoiceChat] broadcastAudioToRoom: SKIPPING ${userId} - WebSocket not OPEN (state=${wsState})`)
        skippedCount++
        continue
      }

      try {
        participant.ws.send(messageStr)
        broadcastCount++
        console.log(`[VoiceChat] broadcastAudioToRoom: SUCCESS sent to ${userId}`)
      } catch (error) {
        errorCount++
        console.error(`[VoiceChat] broadcastAudioToRoom: FAILED to send to ${userId}:`, error)
      }
    }

    console.log(`[VoiceChat] broadcastAudioToRoom: SUMMARY - totalParticipants=${room.participants.size}, broadcastCount=${broadcastCount}, skippedCount=${skippedCount}, errorCount=${errorCount}`)

    // 调试日志：每100帧打印一次
    if (!room.audioBroadcastCount) room.audioBroadcastCount = 0
    room.audioBroadcastCount++
    if (room.audioBroadcastCount % 100 === 0) {
      console.log(`[VoiceChat] Broadcasted audio frame ${room.audioBroadcastCount} to ${broadcastCount} participants, size=${audioData.byteLength} bytes`)
    }

    console.log(`[VoiceChat] broadcastAudioToRoom: EXIT`)
  }
}

// =============================================================================
// 单例实例
// =============================================================================

let globalVoiceChatService: VoiceChatService | null = null

export function getVoiceChatService(): VoiceChatService {
  if (!globalVoiceChatService) {
    globalVoiceChatService = new VoiceChatService()
  }
  return globalVoiceChatService
}

export function initializeVoiceChatService(): VoiceChatService {
  globalVoiceChatService = new VoiceChatService()
  return globalVoiceChatService
}
