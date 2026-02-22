/**
 * Voice Chat Service
 * 多人语音聊天服务 - 使用阿里云DashScope实时语音识别API
 *
 * 支持两种 ASR 模型：
 * 1. paraformer-realtime-v1 (旧版API，使用 inference 端点)
 * 2. qwen3-asr-flash-realtime (新版API，使用 realtime 端点，OpenAI风格)
 *
 * API 参考：
 * - paraformer: https://help.aliyun.com/zh/dashscope/developer-reference/websocket-api
 * - qwen3-asr: https://help.aliyun.com/zh/model-studio/qwen-real-time-speech-recognition
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
  /** 是否使用新版 OpenAI 风格 API (qwen3-asr-flash-realtime) */
  useOpenAIStyle: boolean
}

export function getVoiceChatConfig(): VoiceChatConfig {
  const model = process.env.DASHSCOPE_ASR_MODEL || "qwen3-asr-flash-realtime"
  // 检测是否使用新版 API
  const useOpenAIStyle = model.includes("qwen3-asr")

  // 根据模型选择端点
  let endpoint = process.env.DASHSCOPE_ENDPOINT
  if (!endpoint) {
    if (useOpenAIStyle) {
      // Qwen3-ASR 使用 realtime 端点
      endpoint = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${model}`
    } else {
      // 旧版使用 inference 端点
      endpoint = "wss://dashscope.aliyuncs.com/api-ws/v1/inference/"
    }
  }

  return {
    apiKey: process.env.DASHSCOPE_API_KEY || "",
    endpoint,
    model,
    useOpenAIStyle,
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
  lastSentTranscript?: { text: string; time: number }
  asrCooldownUntil?: number  // ASR 冷却结束时间
  // 单字缓冲（等待合并到下一句）
  pendingSingleChar?: string
  pendingSingleCharTime?: number
  pendingSingleCharTimer?: ReturnType<typeof setTimeout>
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

/** 阿里云 ASR WebSocket 消息格式 (旧版 paraformer) */
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

/** Qwen3-ASR-Flash OpenAI 风格消息格式 */
interface QwenASRSessionUpdate {
  event_id: string
  type: "session.update"
  session: {
    modalities: string[]
    input_audio_format: string
    sample_rate: number
    input_audio_transcription: {
      language: string
    }
    turn_detection: {
      type: string
      threshold: number
      silence_duration_ms: number
    } | null
  }
}

interface QwenASRAudioAppend {
  event_id: string
  type: "input_audio_buffer.append"
  audio: string  // base64 encoded
}

interface QwenASRSessionFinish {
  event_id: string
  type: "session.finish"
}

interface QwenASRResponse {
  type: string
  event_id?: string
  session?: {
    id: string
  }
  transcript?: string  // 最终结果
  text?: string  // 中间结果 (stash)
  stash?: string  // 中间结果
  error?: {
    message: string
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
  }

  isEnabled(): boolean {
    return this.enabled
  }

  getConfig(): VoiceChatConfig {
    return this.config
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
      return false
    }

    const room = this.getOrCreateRoom(sessionId)

    if (room.participants.has(userId)) {
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

    // 清理参与者的定时器
    if (participant.pendingSingleCharTimer) {
      clearTimeout(participant.pendingSingleCharTimer)
    }

    this.closeASRConnection(userId, participant)
    room.participants.delete(userId)


    this.broadcastToRoom(room, {
      type: "voice.leave",
      userId,
      userName: participant.userName,
      participantCount: room.participants.size,
    })

    if (room.participants.size === 0) {
      // 清理房间的 AI 响应定时器
      const aiTimer = this.autoAIResponseTimers.get(sessionId)
      if (aiTimer) {
        clearTimeout(aiTimer)
        this.autoAIResponseTimers.delete(sessionId)
      }
      this.rooms.delete(sessionId)
    }
  }

  async handleContinuousAudio(
    sessionId: string,
    userId: string,
    audioData: ArrayBuffer,
    isSpeech: boolean
  ): Promise<void> {

    const room = this.rooms.get(sessionId)
    if (!room) {
      return
    }

    const participant = room.participants.get(userId)
    if (!participant) {
      return
    }
    if (!participant.isJoined) {
      return
    }

    // 更新最后音频时间
    participant.lastAudioTime = Date.now()

    // 处理说话状态变化（VAD检测）
    if (isSpeech) {
      participant.silenceCount = 0

      if (!participant.isSpeaking) {
        participant.isSpeaking = true
        participant.speakStartTime = Date.now()
        participant.currentTranscript = ""

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

    // 广播音频给其他参与者（实现语音对讲功能）
    // 注意：音频广播独立于ASR状态，确保实时语音通话正常
    console.log(`[VoiceChat] Broadcasting audio from ${userId}, room has ${room.participants.size} participants, asrReady=${participant.asrReady}`)
    this.broadcastAudioToRoom(room, userId, participant.userName, audioData, isSpeech)

    // 处理ASR连接和音频发送
    if (!participant.asrConnection) {
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
      return
    }

    if (participant.asrConnection.readyState !== WebSocket.OPEN) {
      return
    }

    // 始终发送音频给 ASR（保持连接活跃并让 ASR 自己做识别）
    await this.sendAudioToASR(participant, audioData)
  }

  private handleSpeechEnd(sessionId: string, userId: string): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    const participant = room.participants.get(userId)
    if (!participant || !participant.isSpeaking) return

    participant.isSpeaking = false
    participant.silenceCount = 0

    this.onSpeakingStateChange?.(sessionId, userId, participant.userName, false)
    this.broadcastToRoom(room, {
      type: "voice.speaking.end",
      userId,
      userName: participant.userName,
    }, [userId])

    // 发送结束消息
    if (participant.asrConnection?.readyState === WebSocket.OPEN) {
      try {
        if (this.config.useOpenAIStyle) {
          // Qwen3-ASR-Flash: 发送 session.finish
          const finishMessage: QwenASRSessionFinish = {
            event_id: `event_${Date.now()}`,
            type: "session.finish"
          }
          participant.asrConnection.send(JSON.stringify(finishMessage))
        } else if (participant.taskId) {
          // 旧版 paraformer: 发送 finish-task
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

    return new Promise((resolve, reject) => {
      // 根据API风格选择headers
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.config.apiKey}`,
      }

      if (this.config.useOpenAIStyle) {
        // Qwen3-ASR-Flash 使用 OpenAI 风格 header
        headers["OpenAI-Beta"] = "realtime=v1"
      } else {
        // 旧版 paraformer 使用 DashScope header
        headers["X-DashScope-DataInspection"] = "enable"
      }

      const ws = new WebSocket(wsUrl, { headers })

      let connected = false
      const timeout = setTimeout(() => {
        if (!connected) {
          ws.close()
          reject(new Error("ASR connection timeout"))
        }
      }, 15000)

      ws.onopen = () => {
        // 立即设置连接，让音频可以开始发送
        participant.asrConnection = ws

        if (this.config.useOpenAIStyle) {
          // Qwen3-ASR-Flash: 发送 session.update 配置
          const sessionUpdate: QwenASRSessionUpdate = {
            event_id: `event_${Date.now()}`,
            type: "session.update",
            session: {
              modalities: ["text"],
              input_audio_format: "pcm",
              sample_rate: 16000,
              input_audio_transcription: {
                language: "zh"
              },
              turn_detection: {
                type: "server_vad",
                threshold: 0.0,
                silence_duration_ms: 400
              }
            }
          }
          ws.send(JSON.stringify(sessionUpdate))
        } else {
          // 旧版 paraformer: 发送 run-task 消息
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
        }
      }

      ws.onmessage = (event) => {
        try {
          const rawData = event.data as string
          const data = JSON.parse(rawData)

          if (this.config.useOpenAIStyle) {
            // Qwen3-ASR-Flash OpenAI 风格响应处理
            this.handleQwenASRMessage(sessionId, userId, data, participant, () => {
              connected = true
              clearTimeout(timeout)
              resolve()
            })
          } else {
            // 旧版 paraformer 响应处理
            if (data.header?.event === "task-started") {
              connected = true
              participant.asrReady = true
              clearTimeout(timeout)
              // 发送缓冲的音频数据
              this.sendBufferedAudio(participant)
              // 通知前端 ASR 已准备好
              this.sendToParticipant(participant, {
                type: "voice.asr_ready",
                userId: participant.userId,
                userName: participant.userName,
              })
              resolve()
            } else if (data.header?.event === "result-generated") {
              this.handleASRResult(sessionId, userId, data)
            } else if (data.header?.event === "error") {
              console.error(`[VoiceChat] ASR error for ${userId}:`, data)
            }
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
        participant.asrReady = false
        if (participant.asrConnection === ws) {
          participant.asrConnection = undefined
        }

        if (participant.isJoined && room.participants.has(userId)) {
          setTimeout(() => {
            if (room.participants.has(userId)) {
              this.connectToASR(sessionId, userId).catch(err => {
                console.error(`[VoiceChat] Reconnection failed for ${userId}:`, err)
              })
            }
          }, 5000)
        }
      }
    })
  }

  /**
   * 处理 Qwen3-ASR-Flash OpenAI 风格的消息
   */
  private handleQwenASRMessage(
    sessionId: string,
    userId: string,
    data: QwenASRResponse,
    participant: VoiceChatParticipant,
    onReady: () => void
  ): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    switch (data.type) {
      case "session.created":
        console.log(`[VoiceChat] Qwen ASR session created: ${data.session?.id}`)
        participant.asrReady = true
        onReady()
        // 发送缓冲的音频数据
        this.sendBufferedAudio(participant)
        // 通知前端 ASR 已准备好
        this.sendToParticipant(participant, {
          type: "voice.asr_ready",
          userId: participant.userId,
          userName: participant.userName,
        })
        break

      case "input_audio_buffer.speech_started":
        // VAD 检测到开始说话
        if (!participant.isSpeaking) {
          participant.isSpeaking = true
          participant.speakStartTime = Date.now()
          participant.currentTranscript = ""
          this.onSpeakingStateChange?.(sessionId, userId, participant.userName, true)
          this.broadcastToRoom(room, {
            type: "voice.speaking.start",
            userId,
            userName: participant.userName,
          }, [userId])
        }
        break

      case "input_audio_buffer.speech_stopped":
        // VAD 检测到停止说话
        if (participant.isSpeaking) {
          participant.isSpeaking = false
          this.onSpeakingStateChange?.(sessionId, userId, participant.userName, false)
          this.broadcastToRoom(room, {
            type: "voice.speaking.end",
            userId,
            userName: participant.userName,
          }, [userId])
        }
        break

      case "conversation.item.input_audio_transcription.text":
        // 中间结果 (stash)
        if (data.text || data.stash) {
          const text = data.text || data.stash || ""
          participant.currentTranscript = text

          const transcript: VoiceTranscript = {
            id: `vt_${Date.now()}_${userId}`,
            sessionId,
            userId,
            userName: participant.userName,
            text,
            timestamp: Date.now(),
            isFinal: false,
            speakStartTime: participant.speakStartTime,
          }

          console.log(`[VoiceChat] Broadcasting transcript (non-final) from ${userId}: "${text.substring(0, 30)}..." to ${room.participants.size} participants`)

          this.broadcastToRoom(room, {
            type: "voice.transcript",
            transcript,
            userId,
            userName: participant.userName,
          })
        }
        break

      case "conversation.item.input_audio_transcription.completed":
        // 最终结果（使用单字合并逻辑）
        console.log(`[VoiceChat] Received final transcript from ${userId}: "${data.transcript?.substring(0, 30)}..."`)
        if (data.transcript) {
          this.processFinalTranscript(sessionId, userId, data.transcript, room, participant, Date.now())
        }
        break

      case "session.finished":
        console.log(`[VoiceChat] Qwen ASR session finished`)
        break

      case "error":
        console.error(`[VoiceChat] Qwen ASR error:`, data.error)
        break

      default:
        // 忽略其他事件类型
        break
    }
  }

  /**
   * 发送缓冲的音频数据
   */
  private sendBufferedAudio(participant: VoiceChatParticipant): void {
    if (participant.audioBuffer && participant.audioBuffer.length > 0) {
      for (const bufferedAudio of participant.audioBuffer) {
        this.sendAudioToASR(participant, bufferedAudio).catch(err => {
          console.error(`[VoiceChat] Error sending buffered audio:`, err)
        })
      }
      participant.audioBuffer = []
    }
  }

  private async sendAudioToASR(participant: VoiceChatParticipant, audioData: ArrayBuffer | Buffer): Promise<void> {
    if (!participant.asrConnection) {
      return
    }
    if (participant.asrConnection.readyState !== WebSocket.OPEN) {
      return
    }

    try {
      // 确保数据是 Uint8Array 格式
      const uint8Data = audioData instanceof ArrayBuffer
        ? new Uint8Array(audioData)
        : new Uint8Array(audioData.buffer, audioData.byteOffset, audioData.byteLength)

      if (this.config.useOpenAIStyle) {
        // Qwen3-ASR-Flash: 使用 Base64 编码的 JSON 消息
        const base64Audio = Buffer.from(uint8Data).toString('base64')
        const audioMessage: QwenASRAudioAppend = {
          event_id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: "input_audio_buffer.append",
          audio: base64Audio
        }
        participant.asrConnection.send(JSON.stringify(audioMessage))
      } else {
        // 旧版 paraformer: 直接发送二进制数据
        participant.asrConnection.send(uint8Data)
      }

      // 统计发送次数
      if (!participant.sendCount) participant.sendCount = 0
      participant.sendCount++
    } catch (error) {
      console.error(`[VoiceChat] Failed to send audio data:`, error)
    }
  }

  private handleASRResult(sessionId: string, userId: string, data: ASRMessage): void {
    const room = this.rooms.get(sessionId)
    if (!room) return

    const participant = room.participants.get(userId)
    if (!participant) return

    const now = Date.now()

    // 检查是否在冷却期内（收到最终结果后 2 秒内忽略所有 ASR 结果）
    if (participant.asrCooldownUntil && now < participant.asrCooldownUntil) {
      return
    }

    const sentence = data.payload?.output?.sentence
    if (!sentence || !sentence.text) {
      return
    }

    const text = sentence.text
    const isFinal = sentence.end_time > 0

    // 最终结果：处理单字合并逻辑
    if (isFinal) {
      this.processFinalTranscript(sessionId, userId, text, room, participant, now)
    } else {
      // 临时结果：只更新当前转录文本
      participant.currentTranscript = text

      const transcript: VoiceTranscript = {
        id: `vt_${Date.now()}_${userId}`,
        sessionId,
        userId,
        userName: participant.userName,
        text,
        timestamp: now,
        isFinal: false,
        speakStartTime: participant.speakStartTime,
      }

      // 广播中间结果
      this.broadcastToRoom(room, {
        type: "voice.transcript",
        transcript,
        userId,
        userName: participant.userName,
      })
    }
  }

  /**
   * 检查是否为单个字符（忽略标点符号）
   */
  private isSingleChar(text: string): boolean {
    const normalized = text.replace(/[，。！？、；：""''（）\s,.!?;:'"()\s]/g, '')
    return normalized.length === 1
  }

  /**
   * 处理最终转录结果（包含单字合并逻辑）
   */
  private processFinalTranscript(
    sessionId: string,
    userId: string,
    text: string,
    room: VoiceChatRoom,
    participant: VoiceChatParticipant,
    now: number
  ): void {
    const isSingle = this.isSingleChar(text)

    // 清除之前的单字定时器
    if (participant.pendingSingleCharTimer) {
      clearTimeout(participant.pendingSingleCharTimer)
      participant.pendingSingleCharTimer = undefined
    }

    if (isSingle) {
      // 单字：等待合并或5秒后显示
      if (participant.pendingSingleChar) {
        // 已有待处理的单字，先发送它
        this.sendTranscript(sessionId, userId, participant.pendingSingleChar, room, participant, now)
      }

      // 缓存当前单字，设置5秒定时器
      participant.pendingSingleChar = text
      participant.pendingSingleCharTime = now

      participant.pendingSingleCharTimer = setTimeout(() => {
        if (participant.pendingSingleChar) {
          this.sendTranscript(sessionId, userId, participant.pendingSingleChar, room, participant, Date.now())
          participant.pendingSingleChar = undefined
          participant.pendingSingleCharTime = undefined
        }
      }, 5000)
    } else {
      // 非单字：合并待处理的单字并发送
      let finalText = text
      if (participant.pendingSingleChar) {
        finalText = participant.pendingSingleChar + finalText
        participant.pendingSingleChar = undefined
        participant.pendingSingleCharTime = undefined
      }

      this.sendTranscript(sessionId, userId, finalText, room, participant, now)
    }
  }

  /**
   * 发送转录结果
   */
  private sendTranscript(
    sessionId: string,
    userId: string,
    text: string,
    room: VoiceChatRoom,
    participant: VoiceChatParticipant,
    now: number
  ): void {
    // 检查重复
    const lastSent = participant.lastSentTranscript
    if (lastSent && lastSent.text) {
      if (now - lastSent.time < 3000) {
        const similarity = this.calculateStringSimilarity(text, lastSent.text)
        if (similarity > 0.5) {
          return
        }
      }
    }

    // 更新记录并设置冷却期
    participant.lastSentTranscript = { text, time: now }
    participant.asrCooldownUntil = now + 2000

    participant.currentTranscript = text

    const transcript: VoiceTranscript = {
      id: `vt_${Date.now()}_${userId}`,
      sessionId,
      userId,
      userName: participant.userName,
      text,
      timestamp: now,
      isFinal: true,
      speakStartTime: participant.speakStartTime,
    }

    room.transcripts.push(transcript)
    // 限制 transcripts 大小，防止内存泄漏（保留最近500条）
    if (room.transcripts.length > 500) {
      room.transcripts = room.transcripts.slice(-500)
    }
    this.onTranscript?.(sessionId, transcript)

    // 广播给房间内所有参与者
    this.broadcastToRoom(room, {
      type: "voice.transcript.final",
      transcript,
      userId,
      userName: participant.userName,
    })

    participant.currentTranscript = ""

    // 自动触发AI分析（如果启用）
    if (process.env.ENABLE_AUTO_AI_RESPONSE === 'true') {
      this.handleAutoAIResponse(sessionId, room)
    }
  }

  // 计算两个字符串的相似度
  private calculateStringSimilarity(str1: string, str2: string): number {
    if (!str1 || !str2) return 0
    if (str1 === str2) return 1

    // 去掉标点符号后比较
    const normalize = (s: string) => s.replace(/[，。！？、；：""''（）\s,.!?;:'"()\s]/g, '')
    const norm1 = normalize(str1)
    const norm2 = normalize(str2)

    if (norm1 === norm2) return 0.95  // 只有标点差异，认为几乎相同

    const len1 = norm1.length
    const len2 = norm2.length
    const maxLen = Math.max(len1, len2)
    if (maxLen === 0) return 1

    // 计算编辑距离的简化版本：统计相同位置的字符匹配数
    let matchCount = 0
    const minLen = Math.min(len1, len2)
    for (let i = 0; i < minLen; i++) {
      if (norm1[i] === norm2[i]) matchCount++
    }

    return matchCount / maxLen
  }

  private closeASRConnection(userId: string, participant: VoiceChatParticipant): void {
    if (participant.asrConnection) {
      try {
        if (participant.asrConnection.readyState === WebSocket.OPEN) {
          if (this.config.useOpenAIStyle) {
            // Qwen3-ASR-Flash: 发送 session.finish
            const finishMessage: QwenASRSessionFinish = {
              event_id: `event_${Date.now()}`,
              type: "session.finish"
            }
            participant.asrConnection.send(JSON.stringify(finishMessage))
          } else if (participant.taskId) {
            // 旧版 paraformer: 发送 finish-task
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


    this.broadcastToRoom(room, {
      type: "voice.ai_analyze",
      status: "analyzing",
      triggeredBy: userId,
      triggeredByName: participant.userName,
    })

    this.onAIAnalyze?.(sessionId, recentTranscripts)
  }

  // 用于自动AI响应的debounce控制
  private autoAIResponseTimers: Map<string, ReturnType<typeof setTimeout>> = new Map()

  /**
   * 自动触发AI响应
   * 当房间内有人说完一句话后，延迟一段时间触发AI分析
   */
  private handleAutoAIResponse(sessionId: string, room: VoiceChatRoom): void {
    // 清除之前的定时器（避免重复触发）
    const existingTimer = this.autoAIResponseTimers.get(sessionId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // 设置新的定时器，延迟2秒后触发AI分析
    // 这样可以等待是否还有人继续说话
    const timer = setTimeout(() => {
      this.autoAIResponseTimers.delete(sessionId)

      // 检查最近是否有人正在说话（避免打断）
      const now = Date.now()
      let someoneSpeaking = false
      for (const participant of room.participants.values()) {
        if (participant.isSpeaking) {
          someoneSpeaking = true
          break
        }
      }

      if (someoneSpeaking) {
        return
      }

      // 获取最后一个转录的参与者
      const lastTranscript = room.transcripts[room.transcripts.length - 1]
      if (!lastTranscript) return

      this.triggerAIAnalysis(sessionId, lastTranscript.userId)
    }, 2000)

    this.autoAIResponseTimers.set(sessionId, timer)
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

    // 将 ArrayBuffer 转换为 Base64 (使用 Buffer 替代 btoa，确保在 Bun 环境中正常工作)
    const uint8Array = new Uint8Array(audioData)
    const base64Audio = Buffer.from(uint8Array).toString('base64')

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

    // 广播给房间内的其他参与者（不包括发送者）
    let broadcastCount = 0
    let skippedCount = 0
    let errorCount = 0

    for (const [userId, participant] of room.participants) {
      // 记录每个参与者的广播状态
      const wsState = participant.ws.readyState
      const isSender = userId === senderUserId

      if (isSender) {
        skippedCount++
        console.log(`[VoiceChat] Broadcast: skipping sender ${userId.slice(-6)}`)
        continue
      }

      if (wsState !== WebSocket.OPEN) {
        skippedCount++
        console.log(`[VoiceChat] Broadcast: skipping ${userId.slice(-6)}, wsState=${wsState} (not OPEN)`)
        continue
      }

      try {
        participant.ws.send(messageStr)
        broadcastCount++
        console.log(`[VoiceChat] Broadcast: SENT to ${userId.slice(-6)}`)
      } catch (error) {
        errorCount++
        console.error(`[VoiceChat] broadcastAudioToRoom: FAILED to send to ${userId}:`, error)
      }
    }


    // 调试日志：每帧都打印（临时调试用）
    if (!room.audioBroadcastCount) room.audioBroadcastCount = 0
    room.audioBroadcastCount++
    console.log(`[VoiceChat] Broadcast: sent=${broadcastCount}, skipped=${skippedCount}, errors=${errorCount}, total=${room.participants.size}, sender=${senderUserId.slice(-6)}`)

    // 每100帧打印一次详细统计
    if (room.audioBroadcastCount % 100 === 0) {
      console.log(`[VoiceChat] Broadcast stats (100 frames): total=${room.participants.size}`)
    }

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
