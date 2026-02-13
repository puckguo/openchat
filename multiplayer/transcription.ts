/**
 * Voice Transcription Service
 * 语音转录服务
 *
 * 使用 OpenAI Whisper API 将语音转为文字
 */

import { createOpenAI } from "@ai-sdk/openai"
import { readFile } from "fs/promises"

// =============================================================================
// 转录配置
// =============================================================================

export interface TranscriptionConfig {
  /** API 密钥 */
  apiKey?: string
  /** API 基础 URL */
  baseURL?: string
  /** 转录模型 */
  model: "whisper-1"
  /** 语言（可选，自动检测） */
  language?: string
  /** 提示词（帮助转录特定术语） */
  prompt?: string
  /** 温度（0-1，越高越随机） */
  temperature: number
  /** 响应格式 */
  responseFormat: "json" | "text" | "srt" | "verbose_json" | "vtt"
}

export const DEFAULT_TRANSCRIPTION_CONFIG: TranscriptionConfig = {
  model: "whisper-1",
  temperature: 0,
  responseFormat: "json",
}

// =============================================================================
// 转录结果
// =============================================================================

export interface TranscriptionResult {
  /** 转录文本 */
  text: string
  /** 是否成功 */
  success: boolean
  /** 错误信息 */
  error?: string
  /** 语言（自动检测） */
  language?: string
  /** 持续时间（秒） */
  duration?: number
  /** 分段信息（verbose_json 格式） */
  segments?: TranscriptionSegment[]
  /** 单词级时间戳（如有） */
  words?: TranscriptionWord[]
}

export interface TranscriptionSegment {
  id: number
  start: number
  end: number
  text: string
  confidence: number
}

export interface TranscriptionWord {
  word: string
  start: number
  end: number
  confidence: number
}

// =============================================================================
// 音频处理
// =============================================================================

export interface AudioProcessingOptions {
  /** 目标格式 */
  targetFormat?: "mp3" | "mp4" | "mpeg" | "mpga" | "m4a" | "wav" | "webm"
  /** 目标采样率 */
  sampleRate?: number
  /** 压缩质量（0-9，越低越好） */
  compressionQuality?: number
}

/**
 * 支持的音频格式
 */
export const SUPPORTED_AUDIO_FORMATS = [
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "oga",
  "ogg",
  "wav",
  "webm",
]

/**
 * 检查文件格式是否支持
 */
export function isSupportedAudioFormat(filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase()
  return ext ? SUPPORTED_AUDIO_FORMATS.includes(ext) : false
}

/**
 * 获取文件 MIME 类型
 */
export function getAudioMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || ""
  const mimeTypes: Record<string, string> = {
    flac: "audio/flac",
    m4a: "audio/m4a",
    mp3: "audio/mpeg",
    mp4: "audio/mp4",
    mpeg: "audio/mpeg",
    mpga: "audio/mpeg",
    oga: "audio/ogg",
    ogg: "audio/ogg",
    wav: "audio/wav",
    webm: "audio/webm",
  }
  return mimeTypes[ext] || "audio/mpeg"
}

// =============================================================================
// 转录服务
// =============================================================================

export class TranscriptionService {
  private config: TranscriptionConfig

  constructor(config: Partial<TranscriptionConfig> = {}) {
    this.config = { ...DEFAULT_TRANSCRIPTION_CONFIG, ...config }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<TranscriptionConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取当前配置
   */
  getConfig(): TranscriptionConfig {
    return { ...this.config }
  }

  /**
   * 转录音频文件
   */
  async transcribeFile(filePath: string): Promise<TranscriptionResult> {
    try {
      // 检查文件格式
      if (!isSupportedAudioFormat(filePath)) {
        return {
          text: "",
          success: false,
          error: `Unsupported audio format. Supported: ${SUPPORTED_AUDIO_FORMATS.join(", ")}`,
        }
      }

      // 读取文件
      const audioData = await readFile(filePath)

      // 转录
      return await this.transcribeBuffer(audioData, filePath)
    } catch (error) {
      return {
        text: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 转录音频 Buffer
   */
  async transcribeBuffer(
    audioBuffer: Buffer,
    filename: string = "audio.wav"
  ): Promise<TranscriptionResult> {
    try {
      if (!this.config.apiKey) {
        return {
          text: "",
          success: false,
          error: "API key is required",
        }
      }

      const formData = new FormData()
      const blob = new Blob([audioBuffer], { type: getAudioMimeType(filename) })
      formData.append("file", blob, filename)
      formData.append("model", this.config.model)
      formData.append("temperature", String(this.config.temperature))
      formData.append("response_format", this.config.responseFormat)

      if (this.config.language) {
        formData.append("language", this.config.language)
      }

      if (this.config.prompt) {
        formData.append("prompt", this.config.prompt)
      }

      const response = await fetch(
        `${this.config.baseURL || "https://api.openai.com/v1"}/audio/transcriptions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: formData,
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          text: "",
          success: false,
          error: errorData.error?.message || `API error: ${response.status}`,
        }
      }

      const data = await response.json()

      return this.parseResult(data)
    } catch (error) {
      return {
        text: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 转录音频 URL（先下载再转录）
   */
  async transcribeUrl(audioUrl: string): Promise<TranscriptionResult> {
    try {
      const response = await fetch(audioUrl)
      if (!response.ok) {
        return {
          text: "",
          success: false,
          error: `Failed to download audio: ${response.status}`,
        }
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // 从 URL 提取文件名
      const filename = audioUrl.split("/").pop() || "audio.wav"

      return await this.transcribeBuffer(buffer, filename)
    } catch (error) {
      return {
        text: "",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * 流式转录（用于实时语音）
   * 注意：Whisper API 本身不支持真正的流式，这里模拟分段处理
   */
  async *transcribeStream(
    audioChunks: AsyncIterable<Buffer>,
    chunkDuration: number = 5 // 每 5 秒处理一次
  ): AsyncGenerator<TranscriptionResult, void, unknown> {
    const chunks: Buffer[] = []
    let totalDuration = 0

    for await (const chunk of audioChunks) {
      chunks.push(chunk)
      totalDuration += chunkDuration

      // 累积足够的数据后转录
      if (totalDuration >= chunkDuration) {
        const buffer = Buffer.concat(chunks)
        const result = await this.transcribeBuffer(buffer)

        if (result.success) {
          yield result
        }

        // 清空已处理的 chunks
        chunks.length = 0
        totalDuration = 0
      }
    }

    // 处理剩余数据
    if (chunks.length > 0) {
      const buffer = Buffer.concat(chunks)
      const result = await this.transcribeBuffer(buffer)
      yield result
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  private parseResult(data: unknown): TranscriptionResult {
    // 处理不同响应格式
    if (typeof data === "string") {
      return {
        text: data,
        success: true,
      }
    }

    const result = data as {
      text?: string
      language?: string
      duration?: number
      segments?: TranscriptionSegment[]
      words?: TranscriptionWord[]
    }

    return {
      text: result.text || "",
      success: true,
      language: result.language,
      duration: result.duration,
      segments: result.segments,
      words: result.words,
    }
  }
}

// =============================================================================
// 转录任务管理器
// =============================================================================

export interface TranscriptionTask {
  id: string
  messageId: string
  status: "pending" | "processing" | "completed" | "failed"
  progress: number
  result?: TranscriptionResult
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export class TranscriptionManager {
  private service: TranscriptionService
  private tasks: Map<string, TranscriptionTask> = new Map()
  private processingQueue: string[] = []
  private maxConcurrent: number = 3
  private currentProcessing: number = 0

  constructor(service: TranscriptionService) {
    this.service = service
  }

  /**
   * 创建转录任务
   */
  createTask(messageId: string, audioUrl: string): TranscriptionTask {
    const task: TranscriptionTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      messageId,
      status: "pending",
      progress: 0,
      createdAt: Date.now(),
    }

    this.tasks.set(task.id, task)
    this.processingQueue.push(task.id)
    this.processQueue()

    return task
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): TranscriptionTask | undefined {
    return this.tasks.get(taskId)
  }

  /**
   * 获取消息关联的任务
   */
  getTaskByMessageId(messageId: string): TranscriptionTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.messageId === messageId) {
        return task
      }
    }
    return undefined
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task) return false

    if (task.status === "pending") {
      task.status = "failed"
      task.error = "Cancelled"
      task.completedAt = Date.now()

      // 从队列中移除
      const queueIndex = this.processingQueue.indexOf(taskId)
      if (queueIndex > -1) {
        this.processingQueue.splice(queueIndex, 1)
      }

      return true
    }

    return false
  }

  /**
   * 清理已完成任务
   */
  cleanup(maxAge: number = 24 * 60 * 60 * 1000): void {
    // 默认清理 24 小时前的任务
    const cutoff = Date.now() - maxAge

    for (const [id, task] of this.tasks) {
      if (task.completedAt && task.completedAt < cutoff) {
        this.tasks.delete(id)
      }
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  private async processQueue(): Promise<void> {
    if (this.currentProcessing >= this.maxConcurrent) return
    if (this.processingQueue.length === 0) return

    const taskId = this.processingQueue.shift()
    if (!taskId) return

    const task = this.tasks.get(taskId)
    if (!task || task.status !== "pending") return

    this.currentProcessing++
    task.status = "processing"
    task.startedAt = Date.now()

    try {
      // 获取音频 URL 并转录
      const message = task.messageId // 这里需要实际获取消息数据
      const result = await this.service.transcribeUrl(message)

      task.result = result
      task.status = result.success ? "completed" : "failed"
      task.error = result.error
      task.progress = 100
      task.completedAt = Date.now()
    } catch (error) {
      task.status = "failed"
      task.error = error instanceof Error ? error.message : String(error)
      task.completedAt = Date.now()
    } finally {
      this.currentProcessing--
      this.processQueue()
    }
  }
}

// =============================================================================
// 工具函数
// =============================================================================

/**
 * 创建转录服务
 */
export function createTranscriptionService(
  config?: Partial<TranscriptionConfig>
): TranscriptionService {
  return new TranscriptionService(config)
}

/**
 * 创建转录管理器
 */
export function createTranscriptionManager(
  service: TranscriptionService
): TranscriptionManager {
  return new TranscriptionManager(service)
}

/**
 * 格式化转录文本（添加标点、清理）
 */
export function formatTranscription(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, " ") // 合并多个空格
    .replace(/([.?!])([^\s])/g, "$1 $2") // 标点后面加空格
}

/**
 * 检测语言（简单启发式）
 */
export function detectLanguage(text: string): "zh" | "en" | "unknown" {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const englishChars = (text.match(/[a-zA-Z]/g) || []).length
  const totalChars = text.length

  if (totalChars === 0) return "unknown"

  const chineseRatio = chineseChars / totalChars
  const englishRatio = englishChars / totalChars

  if (chineseRatio > 0.3) return "zh"
  if (englishRatio > 0.5) return "en"
  return "unknown"
}
