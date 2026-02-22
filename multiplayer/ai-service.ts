/**
 * AI Service
 * AI 服务集成
 *
 * 支持 DeepSeek AI API
 */

import type { ChatMessage } from "./types"

// =============================================================================
// DeepSeek Configuration
// =============================================================================

export interface DeepSeekConfig {
  apiKey: string
  baseUrl: string
  model: string
  maxTokens: number
  temperature: number
}

export function getDeepSeekConfig(): DeepSeekConfig {
  const config = {
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseUrl: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
    maxTokens: 4096,
    temperature: parseFloat(process.env.DEEPSEEK_TEMPERATURE || "0.7"),
  }
  return config
}

// =============================================================================
// AI Service
// =============================================================================

export class AIService {
  private config: DeepSeekConfig

  constructor(config?: Partial<DeepSeekConfig>) {
    this.config = { ...getDeepSeekConfig(), ...config }
  }

  /**
   * 生成 AI 回复
   */
  async generateResponse(
    messages: ChatMessage[],
    systemPrompt?: string
  ): Promise<string> {
    try {
      const apiKey = this.config.apiKey
      if (!apiKey) {
        throw new Error("DeepSeek API key not configured")
      }

      // 构建消息历史
      const chatHistory = this.buildChatHistory(messages)

      // 添加系统提示
      const finalMessages = systemPrompt
        ? [{ role: "system", content: systemPrompt }, ...chatHistory]
        : chatHistory


      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: finalMessages,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(`DeepSeek API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content

      if (!content) {
        throw new Error("Empty response from AI")
      }

      return content

    } catch (error) {
      console.error("[AI] Error generating response:", error)
      throw error
    }
  }

  /**
   * 生成流式 AI 回复
   */
  async *generateStreamResponse(
    messages: ChatMessage[],
    systemPrompt?: string
  ): AsyncGenerator<string, void, unknown> {
    try {
      const apiKey = this.config.apiKey
      if (!apiKey) {
        throw new Error("DeepSeek API key not configured")
      }

      const chatHistory = this.buildChatHistory(messages)
      const finalMessages = systemPrompt
        ? [{ role: "system", content: systemPrompt }, ...chatHistory]
        : chatHistory

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: finalMessages,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          stream: true,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(`DeepSeek API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
      }

      const reader = response.body?.getReader()
      if (!reader) {
        throw new Error("No response body")
      }

      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === "data: [DONE]") continue

          if (trimmed.startsWith("data: ")) {
            try {
              const json = JSON.parse(trimmed.slice(6))
              const content = json.choices?.[0]?.delta?.content
              if (content) {
                yield content
              }
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

    } catch (error) {
      console.error("[AI] Error in stream response:", error)
      throw error
    }
  }

  /**
   * 构建聊天历史
   */
  private buildChatHistory(messages: ChatMessage[]): Array<{ role: string; content: string }> {
    return messages.map((msg) => ({
      role: msg.senderRole === "ai" ? "assistant" : "user",
      content: `${msg.senderName}: ${msg.content}`,
    }))
  }

  /**
   * 检查 AI 是否可用
   */
  isAvailable(): boolean {
    return !!this.config.apiKey
  }

  /**
   * 翻译文本到目标语言
   * @param text 要翻译的文本
   * @param targetLanguage 目标语言代码 (en, zh, ja, ko, etc.)
   * @param sourceLanguage 源语言代码 (可选，自动检测)
   */
  async translateText(
    text: string,
    targetLanguage: string,
    sourceLanguage?: string
  ): Promise<string> {
    try {
      const apiKey = this.config.apiKey
      if (!apiKey) {
        throw new Error("DeepSeek API key not configured")
      }

      // 语言名称映射
      const languageNames: Record<string, string> = {
        zh: "Chinese",
        en: "English",
        ja: "Japanese",
        ko: "Korean",
        fr: "French",
        de: "German",
        es: "Spanish",
        ru: "Russian",
        pt: "Portuguese",
        it: "Italian",
        ar: "Arabic",
        th: "Thai",
        vi: "Vietnamese",
      }

      const targetLangName = languageNames[targetLanguage] || targetLanguage

      let systemPrompt: string
      if (sourceLanguage) {
        const sourceLangName = languageNames[sourceLanguage] || sourceLanguage
        systemPrompt = `You are a professional translator. Translate the following ${sourceLangName} text to ${targetLangName}. Only return the translated text, no explanations or additional content. Preserve the original formatting and structure.`
      } else {
        systemPrompt = `You are a professional translator. Translate the following text to ${targetLangName}. Only return the translated text, no explanations or additional content. Preserve the original formatting and structure.`
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: text }
          ],
          max_tokens: this.config.maxTokens,
          temperature: 0.3, // 使用较低的温度以获得更稳定的翻译
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(`Translation API error: ${response.status} - ${errorData.error?.message || response.statusText}`)
      }

      const data = await response.json()
      const translatedText = data.choices?.[0]?.message?.content

      if (!translatedText) {
        throw new Error("Empty translation response")
      }

      return translatedText.trim()

    } catch (error) {
      console.error("[AI] Error translating text:", error)
      throw error
    }
  }
}

// =============================================================================
// 默认系统提示
// =============================================================================

export const DEFAULT_AI_SYSTEM_PROMPT = `你是 OpenCode Multiplayer 的智能助手，一个专业的编程协作 AI。

你的职责：
1. 帮助用户解答编程相关的问题
2. 提供代码审查和建议
3. 协助调试和解决问题
4. 解释技术概念和最佳实践

回复风格：
- 简洁明了，重点突出
- 使用 Markdown 格式增强可读性
- 代码块使用适当的语法高亮
- 保持友好和专业的语气

注意：你是协作会话中的一员，可以查看历史消息上下文。`

// =============================================================================
// 单例实例
// =============================================================================

let globalAIService: AIService | null = null

export function getAIService(): AIService {
  if (!globalAIService) {
    globalAIService = new AIService()
  }
  return globalAIService
}

export function initializeAIService(config?: Partial<DeepSeekConfig>): AIService {
  globalAIService = new AIService(config)
  return globalAIService
}
