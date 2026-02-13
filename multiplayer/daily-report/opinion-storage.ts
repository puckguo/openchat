/**
 * Opinion Storage
 * 观点存储服务
 *
 * 管理用户观点历史，支持观点总结
 */

import type { UserOpinion, OpinionRecord, DailyOpinion, OpinionSummary } from "./types"
import { PATHS, OPINION_SUMMARY_PROMPT } from "./config"
import { AIService } from "../ai-service"
import * as fs from "fs"
import * as path from "path"

export interface OpinionStorageOptions {
  aiService?: AIService
  userId: string
}

export class OpinionStorage {
  private aiService?: AIService
  private userId: string
  private dataPath: string
  private cache: OpinionRecord | null = null

  constructor(options: OpinionStorageOptions) {
    this.aiService = options.aiService
    this.userId = options.userId
    this.dataPath = path.join(PATHS.opinionsDir, `${options.userId}.json`)

    // 确保目录存在
    if (!fs.existsSync(PATHS.opinionsDir)) {
      fs.mkdirSync(PATHS.opinionsDir, { recursive: true })
    }
  }

  /**
   * 加载用户观点记录
   */
  loadRecord(): OpinionRecord {
    if (this.cache) {
      return this.cache
    }

    if (!fs.existsSync(this.dataPath)) {
      const newRecord: OpinionRecord = {
        userId: this.userId,
        history: [],
        summary: {
          coreViews: [],
          interests: [],
          stanceMap: {},
        },
        updatedAt: new Date().toISOString(),
      }
      this.cache = newRecord
      return newRecord
    }

    try {
      const data = fs.readFileSync(this.dataPath, "utf-8")
      const record = JSON.parse(data) as OpinionRecord
      this.cache = record
      return record
    } catch (error) {
      console.error(`[OpinionStorage] Failed to load record:`, error)
      return {
        userId: this.userId,
        history: [],
        summary: {
          coreViews: [],
          interests: [],
          stanceMap: {},
        },
        updatedAt: new Date().toISOString(),
      }
    }
  }

  /**
   * 保存用户观点记录
   */
  saveRecord(record: OpinionRecord): void {
    record.updatedAt = new Date().toISOString()
    this.cache = record

    try {
      fs.writeFileSync(this.dataPath, JSON.stringify(record, null, 2), "utf-8")
      console.log(`[OpinionStorage] Saved record for ${this.userId}`)
    } catch (error) {
      console.error(`[OpinionStorage] Failed to save record:`, error)
      throw error
    }
  }

  /**
   * 添加新的观点
   */
  addOpinion(opinion: Omit<UserOpinion, "id" | "timestamp">): UserOpinion {
    const record = this.loadRecord()

    // 查找或创建当天的记录
    let dailyRecord = record.history.find(h => h.date === opinion.date)
    if (!dailyRecord) {
      dailyRecord = {
        date: opinion.date,
        topics: [],
        opinions: [],
      }
      record.history.push(dailyRecord)
    }

    // 创建观点对象
    const newOpinion: UserOpinion = {
      ...opinion,
      id: this.generateId(),
      timestamp: new Date().toISOString(),
    }

    // 添加到当天记录
    dailyRecord.opinions.push(newOpinion)

    // 更新话题列表
    if (!dailyRecord.topics.includes(opinion.topic)) {
      dailyRecord.topics.push(opinion.topic)
    }

    // 保存
    this.saveRecord(record)

    console.log(`[OpinionStorage] Added opinion: ${opinion.topic}`)

    return newOpinion
  }

  /**
   * 批量添加观点
   */
  addOpinions(opinions: Array<Omit<UserOpinion, "id" | "timestamp">>): UserOpinion[] {
    return opinions.map(o => this.addOpinion(o))
  }

  /**
   * 获取某天的观点
   */
  getOpinionsByDate(date: string): UserOpinion[] {
    const record = this.loadRecord()
    const dailyRecord = record.history.find(h => h.date === date)
    return dailyRecord?.opinions || []
  }

  /**
   * 获取所有历史观点
   */
  getAllOpinions(): UserOpinion[] {
    const record = this.loadRecord()
    return record.history.flatMap(h => h.opinions)
  }

  /**
   * 获取最近N天的观点
   */
  getRecentOpinions(days: number): UserOpinion[] {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - days)
    const cutoffStr = cutoffDate.toISOString().split("T")[0]

    const record = this.loadRecord()
    return record.history
      .filter(h => h.date >= cutoffStr)
      .flatMap(h => h.opinions)
  }

  /**
   * 获取按话题分组的观点
   */
  getOpinionsByTopic(): Map<string, UserOpinion[]> {
    const allOpinions = this.getAllOpinions()
    const grouped = new Map<string, UserOpinion[]>()

    for (const opinion of allOpinions) {
      const list = grouped.get(opinion.topic) || []
      list.push(opinion)
      grouped.set(opinion.topic, list)
    }

    return grouped
  }

  /**
   * 生成观点摘要（使用AI）
   */
  async generateSummary(): Promise<OpinionSummary> {
    const record = this.loadRecord()

    // 如果没有AI服务，返回简单摘要
    if (!this.aiService) {
      return this.generateSimpleSummary()
    }

    try {
      const opinionsText = record.history
        .slice(-30) // 最近30天
        .flatMap(h => h.opinions)
        .map(o => `日期: ${o.date}\n话题: ${o.topic}\n观点: ${o.view}`)
        .join("\n\n")

      const prompt = OPINION_SUMMARY_PROMPT.replace("{opinions}", opinionsText)

      const messages = [{
        id: "1",
        content: prompt,
        senderId: "system",
        senderName: "System",
        senderRole: "user" as const,
        timestamp: Date.now(),
        type: "text" as const,
      }]

      const response = await this.aiService.generateResponse(messages)

      // 尝试解析JSON响应
      try {
        const summary = JSON.parse(response) as OpinionSummary
        record.summary = summary
        this.saveRecord(record)
        return summary
      } catch {
        // JSON解析失败，返回简单摘要
        return this.generateSimpleSummary()
      }
    } catch (error) {
      console.error(`[OpinionStorage] Failed to generate summary:`, error)
      return this.generateSimpleSummary()
    }
  }

  /**
   * 生成简单摘要（无需AI）
   */
  generateSimpleSummary(): OpinionSummary {
    const record = this.loadRecord()
    const allOpinions = this.getAllOpinions()

    // 统计话题频率
    const topicCount = new Map<string, number>()
    for (const opinion of allOpinions) {
      topicCount.set(opinion.topic, (topicCount.get(opinion.topic) || 0) + 1)
    }

    // 按频率排序获取兴趣领域
    const interests = Array.from(topicCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic]) => topic)

    // 构建立场映射
    const stanceMap: Record<string, string> = {}
    for (const opinion of allOpinions.slice(-50)) {
      stanceMap[opinion.topic] = opinion.view.substring(0, 100)
    }

    return {
      coreViews: interests.slice(0, 5),
      interests,
      stanceMap,
    }
  }

  /**
   * 获取观点上下文（用于AI讨论）
   */
  getOpinionContext(): string {
    const record = this.loadRecord()
    const recentOpinions = this.getRecentOpinions(30)

    if (recentOpinions.length === 0) {
      return "用户暂无历史观点记录。"
    }

    // 按话题分组
    const byTopic = this.getOpinionsByTopic()

    let context = "用户历史观点:\n"

    // 添加核心观点
    if (record.summary.coreViews.length > 0) {
      context += "\n核心立场:\n"
      for (const view of record.summary.coreViews) {
        context += `- ${view}\n`
      }
    }

    // 添加关注领域
    if (record.summary.interests.length > 0) {
      context += "\n关注领域: " + record.summary.interests.join(", ") + "\n"
    }

    // 添加近期具体观点
    context += "\n近期观点记录:\n"
    for (const [topic, opinions] of byTopic) {
      const recentTopicOpinions = opinions
        .filter(o => {
          const date = new Date(o.date)
          const thirtyDaysAgo = new Date()
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
          return date >= thirtyDaysAgo
        })
        .slice(-3) // 每个话题最多3条

      if (recentTopicOpinions.length > 0) {
        context += `\n【${topic}】\n`
        for (const opinion of recentTopicOpinions) {
          context += `  ${opinion.date}: ${opinion.view.substring(0, 100)}${opinion.view.length > 100 ? "..." : ""}\n`
        }
      }
    }

    return context
  }

  /**
   * 搜索相关观点
   */
  searchOpinions(keyword: string): UserOpinion[] {
    const allOpinions = this.getAllOpinions()
    const lowerKeyword = keyword.toLowerCase()

    return allOpinions.filter(o =>
      o.topic.toLowerCase().includes(lowerKeyword) ||
      o.view.toLowerCase().includes(lowerKeyword)
    )
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.cache = null
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }
}

// =============================================================================
// 单例管理
// =============================================================================

const storageInstances = new Map<string, OpinionStorage>()

export function getOpinionStorage(userId: string, aiService?: AIService): OpinionStorage {
  if (!storageInstances.has(userId)) {
    storageInstances.set(userId, new OpinionStorage({ userId, aiService }))
  }
  return storageInstances.get(userId)!
}

export function clearOpinionStorageCache(userId?: string): void {
  if (userId) {
    storageInstances.delete(userId)
  } else {
    storageInstances.clear()
  }
}
