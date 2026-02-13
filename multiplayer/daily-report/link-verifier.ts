/**
 * Link Verifier
 * 链接验证服务
 *
 * 验证新闻链接的有效性和可访问性
 */

import type { NewsItem } from "./types"

export interface LinkVerifyResult {
  item: NewsItem
  status: "success" | "failed" | "timeout" | "skipped"
  statusCode?: number
  responseTime: number
  error?: string
}

export interface LinkVerifierOptions {
  timeout: number
  maxRetries: number
  concurrency: number
  checkContent: boolean
}

const DEFAULT_OPTIONS: LinkVerifierOptions = {
  timeout: 10000,
  maxRetries: 2,
  concurrency: 5,
  checkContent: false,
}

export class LinkVerifier {
  private options: LinkVerifierOptions

  constructor(options: Partial<LinkVerifierOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * 验证单个链接
   */
  async verifyLink(item: NewsItem): Promise<LinkVerifyResult> {
    const startTime = Date.now()

    for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), this.options.timeout)

        const response = await fetch(item.url, {
          method: "HEAD",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          },
          signal: controller.signal,
          redirect: "follow",
        })

        clearTimeout(timeoutId)

        const responseTime = Date.now() - startTime

        // 2xx 和 3xx 状态码都认为是成功的
        if (response.ok || (response.status >= 300 && response.status < 400)) {
          return {
            item,
            status: "success",
            statusCode: response.status,
            responseTime,
          }
        }

        // 如果是 405 Method Not Allowed，尝试 GET 请求
        if (response.status === 405 && attempt === 0) {
          return await this.verifyWithGet(item, startTime)
        }

        // 其他错误状态码，如果是最后一次尝试则返回失败
        if (attempt === this.options.maxRetries - 1) {
          return {
            item,
            status: "failed",
            statusCode: response.status,
            responseTime,
            error: `HTTP ${response.status}: ${response.statusText}`,
          }
        }

        // 重试前等待
        await this.delay(1000 * (attempt + 1))

      } catch (error) {
        const responseTime = Date.now() - startTime

        if (error instanceof Error) {
          if (error.name === "AbortError") {
            if (attempt === this.options.maxRetries - 1) {
              return {
                item,
                status: "timeout",
                responseTime,
                error: "Request timeout",
              }
            }
          } else {
            // 网络错误，可能是域名不存在或无法连接
            if (attempt === this.options.maxRetries - 1) {
              return {
                item,
                status: "failed",
                responseTime,
                error: error.message,
              }
            }
          }
        }

        // 重试前等待
        await this.delay(1000 * (attempt + 1))
      }
    }

    return {
      item,
      status: "failed",
      responseTime: Date.now() - startTime,
      error: "Max retries exceeded",
    }
  }

  /**
   * 使用 GET 请求验证（用于不支持 HEAD 的站点）
   */
  private async verifyWithGet(item: NewsItem, startTime: number): Promise<LinkVerifyResult> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.options.timeout)

      const response = await fetch(item.url, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      const responseTime = Date.now() - startTime

      if (response.ok) {
        return {
          item,
          status: "success",
          statusCode: response.status,
          responseTime,
        }
      }

      return {
        item,
        status: "failed",
        statusCode: response.status,
        responseTime,
        error: `HTTP ${response.status}`,
      }
    } catch (error) {
      return {
        item,
        status: "failed",
        responseTime: Date.now() - startTime,
        error: error instanceof Error ? error.message : "Unknown error",
      }
    }
  }

  /**
   * 批量验证链接
   */
  async verifyLinks(items: NewsItem[]): Promise<LinkVerifyResult[]> {
    console.log(`[LinkVerifier] Starting verification of ${items.length} links`)

    const results: LinkVerifyResult[] = []
    const batchSize = this.options.concurrency

    // 分批处理
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize)
      const batchPromises = batch.map(item => this.verifyLink(item))

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)

      // 进度日志
      const progress = Math.min(i + batchSize, items.length)
      const successCount = results.filter(r => r.status === "success").length
      console.log(`[LinkVerifier] Progress: ${progress}/${items.length}, Success: ${successCount}`)

      // 批次间延迟，避免请求过快
      if (i + batchSize < items.length) {
        await this.delay(500)
      }
    }

    const summary = {
      total: results.length,
      success: results.filter(r => r.status === "success").length,
      failed: results.filter(r => r.status === "failed").length,
      timeout: results.filter(r => r.status === "timeout").length,
    }

    console.log(`[LinkVerifier] Verification complete:`, summary)

    return results
  }

  /**
   * 过滤有效的新闻
   */
  filterValidNews(results: LinkVerifyResult[]): NewsItem[] {
    return results
      .filter(r => r.status === "success")
      .map(r => ({
        ...r.item,
        verified: true,
        verifyStatus: "success" as const,
      }))
  }

  /**
   * 延迟
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// =============================================================================
// 单例实例
// =============================================================================

let globalLinkVerifier: LinkVerifier | null = null

export function getLinkVerifier(options?: Partial<LinkVerifierOptions>): LinkVerifier {
  if (!globalLinkVerifier) {
    globalLinkVerifier = new LinkVerifier(options)
  }
  return globalLinkVerifier
}
