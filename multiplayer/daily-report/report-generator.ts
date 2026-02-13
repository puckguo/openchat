/**
 * Report Generator
 * 日报生成器
 *
 * 使用AI生成结构化日报
 */

import type { NewsItem, DailyReport, ReportSection, ReportMetadata, NewsCategory } from "./types"
import { CATEGORY_NAMES, REPORT_GENERATION_PROMPT, PATHS } from "./config"
import { AIService } from "../ai-service"
import { OSSManager } from "../oss"
import * as fs from "fs"
import * as path from "path"

export interface ReportGeneratorOptions {
  aiService: AIService
  ossManager?: OSSManager
  summaryLength: number
  maxNewsPerCategory: number
}

export class ReportGenerator {
  private aiService: AIService
  private ossManager?: OSSManager
  private options: Omit<ReportGeneratorOptions, "aiService" | "ossManager">

  constructor(options: ReportGeneratorOptions) {
    this.aiService = options.aiService
    this.ossManager = options.ossManager
    this.options = {
      summaryLength: options.summaryLength,
      maxNewsPerCategory: options.maxNewsPerCategory,
    }
  }

  /**
   * 生成日报
   */
  async generateReport(news: NewsItem[], date: string): Promise<DailyReport> {
    const startTime = Date.now()
    console.log(`[ReportGenerator] Generating report for ${date} with ${news.length} news items`)

    // 按领域分类
    const categorized = this.categorizeNews(news)

    // 构建AI提示词
    const prompt = this.buildPrompt(news, date)

    // 调用AI生成
    const aiResponse = await this.callAI(prompt)

    // 解析AI响应
    const { summary, sections } = this.parseAIResponse(aiResponse, categorized)

    // 构建报告对象
    const report: DailyReport = {
      date,
      generatedAt: new Date().toISOString(),
      summary,
      sections,
      metadata: {
        totalSources: new Set(news.map(n => n.source)).size,
        totalNews: news.length,
        verifiedNews: news.filter(n => n.verified).length,
        generationTime: Date.now() - startTime,
        model: "deepseek-chat",
      },
    }

    console.log(`[ReportGenerator] Report generated in ${report.metadata.generationTime}ms`)

    return report
  }

  /**
   * 保存日报到本地和OSS
   */
  async saveReport(report: DailyReport): Promise<{ localPath: string; ossUrl?: string }> {
    const filename = `${report.date}.md`
    const markdown = this.convertToMarkdown(report)

    // 确保目录存在
    if (!fs.existsSync(PATHS.reportsDir)) {
      fs.mkdirSync(PATHS.reportsDir, { recursive: true })
    }

    // 保存到本地
    const localPath = path.join(PATHS.reportsDir, filename)
    fs.writeFileSync(localPath, markdown, "utf-8")
    console.log(`[ReportGenerator] Saved to local: ${localPath}`)

    // 上传到OSS
    let ossUrl: string | undefined
    if (this.ossManager) {
      try {
        const ossKey = `${PATHS.ossPrefix}${filename}`
        const buffer = Buffer.from(markdown, "utf-8")
        const result = await this.ossManager.uploadFile(ossKey, buffer, {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
          },
        })
        ossUrl = result.url
        console.log(`[ReportGenerator] Uploaded to OSS: ${ossUrl}`)
      } catch (error) {
        console.error(`[ReportGenerator] Failed to upload to OSS:`, error)
      }
    }

    return { localPath, ossUrl }
  }

  /**
   * 读取本地日报
   */
  readReport(date: string): DailyReport | null {
    const localPath = path.join(PATHS.reportsDir, `${date}.md`)

    if (!fs.existsSync(localPath)) {
      return null
    }

    try {
      const markdown = fs.readFileSync(localPath, "utf-8")
      return this.parseMarkdown(markdown, date)
    } catch (error) {
      console.error(`[ReportGenerator] Failed to read report:`, error)
      return null
    }
  }

  /**
   * 检查日报是否存在
   */
  reportExists(date: string): boolean {
    const localPath = path.join(PATHS.reportsDir, `${date}.md`)
    return fs.existsSync(localPath)
  }

  /**
   * 获取所有日报列表
   */
  listReports(): Array<{ date: string; filename: string; size: number; createdAt: string }> {
    if (!fs.existsSync(PATHS.reportsDir)) {
      return []
    }

    const files = fs.readdirSync(PATHS.reportsDir)
      .filter(f => f.endsWith(".md"))
      .map(filename => {
        const filePath = path.join(PATHS.reportsDir, filename)
        const stats = fs.statSync(filePath)
        const date = filename.replace(".md", "")

        return {
          date,
          filename,
          size: stats.size,
          createdAt: stats.birthtime.toISOString(),
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date)) // 降序排列

    return files
  }

  /**
   * 构建AI提示词
   */
  private buildPrompt(news: NewsItem[], date: string): string {
    const categorized = this.categorizeNews(news)

    let newsContent = ""

    for (const [category, items] of categorized) {
      const categoryName = CATEGORY_NAMES[category]
      newsContent += `\n## ${categoryName}\n\n`

      for (const item of items.slice(0, this.options.maxNewsPerCategory)) {
        newsContent += `标题: ${item.title}\n`
        newsContent += `来源: ${item.source}\n`
        newsContent += `链接: ${item.url}\n`
        newsContent += `摘要: ${item.summary}\n\n`
      }
    }

    return REPORT_GENERATION_PROMPT.replace("{date}", date) +
      "\n\n## 新闻素材\n\n" +
      newsContent
  }

  /**
   * 调用AI生成
   */
  private async callAI(prompt: string): Promise<string> {
    try {
      // 使用AI服务生成
      const messages = [{ id: "1", content: prompt, senderId: "system", senderName: "System", senderRole: "user", timestamp: Date.now(), type: "text" }]

      const response = await this.aiService.generateResponse(messages, "You are a professional news editor.")

      return response
    } catch (error) {
      console.error(`[ReportGenerator] AI generation failed:`, error)
      throw error
    }
  }

  /**
   * 解析AI响应
   */
  private parseAIResponse(response: string, categorized: Map<NewsCategory, NewsItem[]>): { summary: string; sections: ReportSection[] } {
    // 提取概览部分（第一个##之前的内容）
    const summaryMatch = response.match(/^(?:#\s*.*?\n)?([\s\S]*?)(?=\n##\s|$)/)
    const summary = summaryMatch ? summaryMatch[1].trim() : ""

    // 解析各部分
    const sections: ReportSection[] = []

    for (const [category, items] of categorized) {
      const categoryName = CATEGORY_NAMES[category]

      // 只包含已验证的新闻
      const verifiedItems = items.filter(i => i.verified).slice(0, this.options.maxNewsPerCategory)

      if (verifiedItems.length > 0) {
        sections.push({
          category,
          categoryName,
          news: verifiedItems,
        })
      }
    }

    return { summary, sections }
  }

  /**
   * 转换为Markdown格式
   */
  private convertToMarkdown(report: DailyReport): string {
    let markdown = `# 每日资讯日报 - ${report.date}\n\n`

    // 元信息
    markdown += `> 生成时间: ${new Date(report.generatedAt).toLocaleString("zh-CN")}\n`
    markdown += `> 数据来源: ${report.metadata.totalSources} 个媒体源\n`
    markdown += `> 新闻总数: ${report.metadata.totalNews} 条 (已验证: ${report.metadata.verifiedNews} 条)\n\n`

    // 概览
    markdown += `---\n\n## 📋 今日概览\n\n`
    markdown += report.summary
    markdown += `\n\n---\n\n`

    // 各领域新闻
    for (const section of report.sections) {
      markdown += `## ${section.categoryName}\n\n`

      for (let i = 0; i < section.news.length; i++) {
        const news = section.news[i]
        markdown += `${i + 1}. **[${news.title}](${news.url})** - ${news.source}\n`
        if (news.summary) {
          markdown += `   > ${news.summary}\n`
        }
        markdown += `\n`
      }
    }

    // 页脚
    markdown += `---\n\n`
    markdown += `*本日报由 AI 自动生成，仅供参考*\n`

    return markdown
  }

  /**
   * 解析Markdown（增强版）
   */
  private parseMarkdown(markdown: string, date: string): DailyReport {
    try {
      // 标准化换行符
      const normalizedMarkdown = markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

      // 提取元数据
      const metadataMatch = normalizedMarkdown.match(/数据来源:\s*(\d+)\s*个媒体源/)
      const totalNewsMatch = normalizedMarkdown.match(/新闻总数:\s*(\d+)\s*条.*?已验证[:\s]*(\d+)\s*条/)
      const generatedAtMatch = normalizedMarkdown.match(/生成时间:\s*(\d{4}\/\d{1,2}\/\d{1,2}\s+\d{1,2}:\d{1,2}:\d{1,2})/)

      const totalSources = metadataMatch ? parseInt(metadataMatch[1]) : 0
      const totalNews = totalNewsMatch ? parseInt(totalNewsMatch[1]) : 0
      const verifiedNews = totalNewsMatch ? parseInt(totalNewsMatch[2]) : 0
      const generatedAt = generatedAtMatch ? this.parseChineseDate(generatedAtMatch[1]) : new Date().toISOString()

      // 提取今日概览 - 查找两个 --- 之间的内容
      let summary = ""
      const overviewSection = normalizedMarkdown.match(/##\s*\ud83d\udccb\s*今日概览[\s\S]*?(?=##\s*[^#]|$)/)
      if (overviewSection) {
        // 移除标题和分隔线，保留正文
        const content = overviewSection[0]
          .replace(/##\s*\ud83d\udccb\s*今日概览\s*/, "")
          .replace(/\*\*日期：[^*]+\*\*/g, "")
          .replace(/---+\s*/g, "")
          .trim()
        if (content && content.length > 10) {
          summary = content.substring(0, 1000) // 限制长度
        }
      }

      // 解析各个分类的新闻
      const sections: ReportSection[] = []

      // 按分类标题分割内容
      const categoryEmojis = ['💻', '💼', '🌍', '🔬', '⚽', '🎬', '🏛️', '👥', '📰']
      const categoryNames: Record<string, string> = {
        '💻': '科技动态',
        '💼': '商业财经',
        '🌍': '国际新闻',
        '🔬': '科学探索',
        '⚽': '体育竞技',
        '🎬': '娱乐文化',
        '🏛️': '时政要闻',
        '👥': '社会民生',
        '📰': '其他资讯',
      }

      for (const emoji of categoryEmojis) {
        // 构建正则匹配该分类部分
        const categoryPattern = new RegExp(`##\\s*${emoji}\\s*([^\\n]+)([\\s\\S]*?)(?=##\\s*[^#]|\\*本日报由|$)`, 'g')
        const match = categoryPattern.exec(normalizedMarkdown)

        if (match) {
          const categoryName = match[1].trim()
          const newsContent = match[2]
          const category = this.emojiToCategory(emoji)
          const news: NewsItem[] = []

          // 解析每条新闻 - 匹配格式: 1. **[标题](链接)** - 来源\n   > 摘要
          const newsPattern = /\d+\.\s*\*\*\[([^\]]+)\]\(([^)]+)\)\*\*\s*-\s*([^\n]+)\n\s*>\s*([^\n]+)/g
          let newsMatch: RegExpExecArray | null

          while ((newsMatch = newsPattern.exec(newsContent)) !== null) {
            news.push({
              title: newsMatch[1].trim(),
              url: newsMatch[2].trim(),
              source: newsMatch[3].trim(),
              summary: newsMatch[4].trim(),
              category,
              verified: true,
            })
          }

          if (news.length > 0) {
            sections.push({
              category,
              categoryName: categoryName || categoryNames[emoji] || '其他',
              news,
            })
          }
        }
      }

      return {
        date,
        generatedAt,
        summary: summary || `${date} 新闻日报`,
        sections,
        metadata: {
          totalSources,
          totalNews: totalNews || sections.reduce((sum, s) => sum + s.news.length, 0),
          verifiedNews: verifiedNews || sections.reduce((sum, s) => sum + s.news.length, 0),
          generationTime: 0,
          model: "unknown",
        },
      }
    } catch (error) {
      console.error(`[ReportGenerator] Failed to parse markdown:`, error)
      return {
        date,
        generatedAt: new Date().toISOString(),
        summary: "",
        sections: [],
        metadata: {
          totalSources: 0,
          totalNews: 0,
          verifiedNews: 0,
          generationTime: 0,
          model: "unknown",
        },
      }
    }
  }

  /**
   * 解析中文日期格式
   */
  private parseChineseDate(dateStr: string): string {
    try {
      const match = dateStr.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/)
      if (match) {
        const [_, year, month, day, hour, minute, second] = match
        return new Date(
          parseInt(year),
          parseInt(month) - 1,
          parseInt(day),
          parseInt(hour),
          parseInt(minute),
          parseInt(second)
        ).toISOString()
      }
    } catch (e) {
      console.error("[ReportGenerator] Failed to parse date:", dateStr)
    }
    return new Date().toISOString()
  }

  /**
   * 表情符号转分类
   */
  private emojiToCategory(emoji: string): NewsCategory {
    const map: Record<string, NewsCategory> = {
      "💻": "technology",
      "💼": "business",
      "🌍": "international",
      "🔬": "science",
      "⚽": "sports",
      "🎬": "entertainment",
      "🏛️": "politics",
      "👥": "society",
      "📰": "other",
    }
    return map[emoji] || "other"
  }

  /**
   * 按领域分类新闻
   */
  private categorizeNews(news: NewsItem[]): Map<NewsCategory, NewsItem[]> {
    const categorized = new Map<NewsCategory, NewsItem[]>()

    for (const item of news) {
      const list = categorized.get(item.category) || []
      list.push(item)
      categorized.set(item.category, list)
    }

    return categorized
  }

  /**
   * 生成报告的简短摘要（用于讨论上下文）
   */
  generateBriefSummary(report: DailyReport): string {
    const sections = report.sections.map(s =>
      `${s.categoryName}: ${s.news.slice(0, 3).map(n => n.title).join(", ")}`
    ).join("\n")

    return `今日日报概要:\n${report.summary.substring(0, 500)}...\n\n主要内容:\n${sections}`
  }
}

// =============================================================================
// 单例实例
// =============================================================================

let globalReportGenerator: ReportGenerator | null = null

export function getReportGenerator(options?: Partial<ReportGeneratorOptions>): ReportGenerator {
  if (!globalReportGenerator) {
    const aiService = new AIService()
    globalReportGenerator = new ReportGenerator({
      aiService,
      summaryLength: 1000,
      maxNewsPerCategory: 8,
      ...options,
    })
  }
  return globalReportGenerator
}

export function initializeReportGenerator(options: ReportGeneratorOptions): ReportGenerator {
  globalReportGenerator = new ReportGenerator(options)
  return globalReportGenerator
}
