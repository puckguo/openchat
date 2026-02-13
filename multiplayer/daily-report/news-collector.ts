/**
 * News Collector
 * 新闻抓取服务
 *
 * 支持RSS源抓取
 */

import type { NewsItem, NewsSource, NewsCategory } from "./types"
import { CATEGORY_NAMES } from "./config"

// =============================================================================
// RSS Parser (简化实现，避免依赖)
// =============================================================================

interface RSSItem {
  title: string
  link: string
  description?: string
  pubDate?: string
  content?: string
}

interface RSSFeed {
  title: string
  items: RSSItem[]
}

// 简单的RSS解析器
async function parseRSS(url: string): Promise<RSSFeed> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; OpenCode-Bot/1.0)",
      },
      timeout: 15000,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const xml = await response.text()
    return parseRSSXML(xml)
  } catch (error) {
    throw new Error(`Failed to fetch RSS from ${url}: ${error}`)
  }
}

function parseRSSXML(xml: string): RSSFeed {
  const items: RSSItem[] = []

  // 提取title
  const titleMatch = xml.match(/<title>([^<]+)<\/title>/)
  const title = titleMatch ? titleMatch[1].trim() : "Unknown Feed"

  // 提取所有item
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match

  while ((match = itemRegex.exec(xml)) !== null) {
    const itemContent = match[1]

    const item: RSSItem = {
      title: extractTag(itemContent, "title") || "Untitled",
      link: extractTag(itemContent, "link") || "",
      description: extractTag(itemContent, "description") || extractTag(itemContent, "content:encoded"),
      pubDate: extractTag(itemContent, "pubDate") || extractTag(itemContent, "pubdate"),
    }

    if (item.link) {
      items.push(item)
    }
  }

  return { title, items }
}

function extractTag(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i")
  const match = xml.match(regex)
  if (match) {
    // 清理CDATA和HTML实体
    let content = match[1]
      .replace(/<!\[CDATA\[(.*?)\]\]>/s, "$1")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]+>/g, " ") // 移除HTML标签
      .trim()
    return content
  }
  return undefined
}

// =============================================================================
// News Collector
// =============================================================================

export interface NewsCollectorOptions {
  maxItemsPerSource: number
  maxAgeHours: number
  timeout: number
}

const DEFAULT_OPTIONS: NewsCollectorOptions = {
  maxItemsPerSource: 10,
  maxAgeHours: 48,  // 只获取48小时内的新闻
  timeout: 20000,
}

export class NewsCollector {
  private options: NewsCollectorOptions

  constructor(options: Partial<NewsCollectorOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options }
  }

  /**
   * 从单个RSS源抓取新闻
   */
  async fetchFromSource(source: NewsSource): Promise<NewsItem[]> {
    console.log(`[NewsCollector] Fetching from ${source.name} (${source.url})`)

    try {
      const feed = await Promise.race([
        parseRSS(source.url),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timeout")), this.options.timeout)
        ),
      ])

      const newsItems: NewsItem[] = []
      const cutoffTime = Date.now() - this.options.maxAgeHours * 60 * 60 * 1000

      for (let i = 0; i < Math.min(feed.items.length, this.options.maxItemsPerSource); i++) {
        const item = feed.items[i]

        // 检查发布时间
        if (item.pubDate) {
          const pubTime = new Date(item.pubDate).getTime()
          if (!isNaN(pubTime) && pubTime < cutoffTime) {
            continue // 跳过太旧的新闻
          }
        }

        newsItems.push({
          id: this.generateId(item.link),
          title: this.cleanTitle(item.title),
          summary: this.generateSummary(item.description || item.content || ""),
          url: item.link,
          source: source.name,
          category: source.category,
          publishTime: item.pubDate || new Date().toISOString(),
          verified: false,
        })
      }

      console.log(`[NewsCollector] Fetched ${newsItems.length} items from ${source.name}`)
      return newsItems

    } catch (error) {
      console.error(`[NewsCollector] Error fetching from ${source.name}:`, error)
      return []
    }
  }

  /**
   * 从多个源抓取新闻
   */
  async fetchFromSources(sources: NewsSource[]): Promise<NewsItem[]> {
    console.log(`[NewsCollector] Fetching from ${sources.length} sources`)

    const allNews: NewsItem[] = []
    const errors: string[] = []

    // 串行抓取，避免请求过多
    for (const source of sources) {
      try {
        const items = await this.fetchFromSource(source)
        allNews.push(...items)
        // 延迟避免请求过快
        await this.delay(500)
      } catch (error) {
        errors.push(`${source.name}: ${error}`)
      }
    }

    // 去重（基于URL）
    const uniqueNews = this.deduplicate(allNews)

    console.log(`[NewsCollector] Total unique news: ${uniqueNews.length}, Errors: ${errors.length}`)
    if (errors.length > 0) {
      console.log(`[NewsCollector] Errors:`, errors)
    }

    return uniqueNews
  }

  /**
   * 按领域分类新闻
   */
  categorizeNews(news: NewsItem[]): Map<NewsCategory, NewsItem[]> {
    const categorized = new Map<NewsCategory, NewsItem[]>()

    for (const item of news) {
      const list = categorized.get(item.category) || []
      list.push(item)
      categorized.set(item.category, list)
    }

    return categorized
  }

  /**
   * 生成新闻ID
   */
  private generateId(url: string): string {
    // 使用URL的hash作为ID
    let hash = 0
    for (let i = 0; i < url.length; i++) {
      const char = url.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash
    }
    return `news_${Math.abs(hash).toString(36)}`
  }

  /**
   * 清理标题
   */
  private cleanTitle(title: string): string {
    return title
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 200)
  }

  /**
   * 生成摘要
   */
  private generateSummary(content: string): string {
    if (!content) return ""

    // 清理内容
    let summary = content
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 300)

    if (content.length > 300) {
      summary += "..."
    }

    return summary
  }

  /**
   * 去重
   */
  private deduplicate(news: NewsItem[]): NewsItem[] {
    const seen = new Set<string>()
    return news.filter(item => {
      // 规范化URL用于比较
      const normalizedUrl = item.url.toLowerCase().replace(/\/$/, "")
      if (seen.has(normalizedUrl)) {
        return false
      }
      seen.add(normalizedUrl)
      return true
    })
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

let globalNewsCollector: NewsCollector | null = null

export function getNewsCollector(options?: Partial<NewsCollectorOptions>): NewsCollector {
  if (!globalNewsCollector) {
    globalNewsCollector = new NewsCollector(options)
  }
  return globalNewsCollector
}
