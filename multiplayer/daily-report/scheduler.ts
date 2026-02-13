/**
 * Daily Report Scheduler
 * 日报定时调度器
 *
 * 在指定时间段内自动执行日报生成任务
 */

import type { DailyReportConfig } from "./types"
import { NewsCollector } from "./news-collector"
import { LinkVerifier } from "./link-verifier"
import { ReportGenerator } from "./report-generator"
import { getConfigManager, DEFAULT_CONFIG } from "./config"
import { AIService } from "../ai-service"
import { OSSManager } from "../oss"

export interface SchedulerOptions {
  newsCollector: NewsCollector
  linkVerifier: LinkVerifier
  reportGenerator: ReportGenerator
  config?: Partial<DailyReportConfig>
}

export interface ScheduledTask {
  id: string
  type: "generate_report"
  scheduledAt: Date
  status: "pending" | "running" | "completed" | "failed"
  result?: any
  error?: string
}

export class DailyReportScheduler {
  private newsCollector: NewsCollector
  private linkVerifier: LinkVerifier
  private reportGenerator: ReportGenerator
  private config: DailyReportConfig
  private tasks: Map<string, ScheduledTask> = new Map()
  private isRunning: boolean = false
  private checkInterval: Timer | null = null
  private lastAttemptDate: string | null = null

  constructor(options: SchedulerOptions) {
    this.newsCollector = options.newsCollector
    this.linkVerifier = options.linkVerifier
    this.reportGenerator = options.reportGenerator
    this.config = { ...DEFAULT_CONFIG, ...options.config }
  }

  /**
   * 启动调度器
   */
  start(): void {
    if (this.isRunning) {
      console.log("[Scheduler] Already running")
      return
    }

    if (!this.config.enabled || !this.config.schedule.enabled) {
      console.log("[Scheduler] Disabled, not starting")
      return
    }

    this.isRunning = true
    console.log("[Scheduler] Started")

    // 每分钟检查一次是否需要执行任务
    this.checkInterval = setInterval(() => this.checkAndExecute(), 60000)

    // 立即检查一次
    this.checkAndExecute()
  }

  /**
   * 停止调度器
   */
  stop(): void {
    this.isRunning = false
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    console.log("[Scheduler] Stopped")
  }

  /**
   * 检查并执行任务
   */
  private async checkAndExecute(): Promise<void> {
    const now = new Date()
    const currentHour = now.getHours()
    const currentMinute = now.getMinutes()

    // 检查是否在执行时间段内
    const [startHour, endHour] = this.config.schedule.hourRange

    if (currentHour < startHour || currentHour >= endHour) {
      return // 不在执行时间段
    }

    // 检查今天是否已经生成过日报
    const today = now.toISOString().split("T")[0]
    if (this.reportGenerator.reportExists(today)) {
      return // 今天已生成
    }

    // 检查是否有正在执行的任务
    for (const task of this.tasks.values()) {
      if (task.status === "running") {
        return // 有任务正在执行
      }
    }

    // 计算随机延迟（如果是随机模式）
    if (this.config.schedule.randomDelay) {
      // 确保在窗口期内至少执行一次
      // 策略：记录今天是否已尝试调度，如果没有，在窗口的后半段必定执行
      const hasAttemptedToday = this.hasAttemptedToday(today)

      if (!hasAttemptedToday) {
        // 前半段（0-30分钟）：随机等待，但每分钟增加概率
        // 后半段（30分钟后）：必定执行
        if (currentMinute < 30) {
          // 随着分钟增加，概率从5%逐渐增加到50%
          const probability = 0.05 + (currentMinute / 30) * 0.45
          if (Math.random() > probability) {
            return
          }
        }
        // 30分钟后必定执行，不需要return
      } else {
        // 已经尝试过了，不需要再执行
        return
      }
    }

    // 执行任务
    await this.executeTask(today)
  }

  /**
   * 检查今天是否已经尝试过调度
   */
  private hasAttemptedToday(date: string): boolean {
    return this.lastAttemptDate === date
  }

  /**
   * 记录今天的调度尝试
   */
  private recordAttempt(date: string): void {
    this.lastAttemptDate = date
  }

  /**
   * 执行日报生成任务
   */
  async executeTask(date?: string): Promise<ScheduledTask> {
    const targetDate = date || new Date().toISOString().split("T")[0]

    // 记录调度尝试
    this.recordAttempt(targetDate)

    const task: ScheduledTask = {
      id: `task_${Date.now()}`,
      type: "generate_report",
      scheduledAt: new Date(),
      status: "running",
    }

    this.tasks.set(task.id, task)
    console.log(`[Scheduler] Starting task ${task.id} for ${targetDate}`)

    try {
      // 1. 抓取新闻
      console.log(`[Scheduler] Step 1: Collecting news...`)
      const sources = getConfigManager().getEnabledSources()
      const news = await this.newsCollector.fetchFromSources(sources)

      if (news.length === 0) {
        throw new Error("No news collected")
      }

      console.log(`[Scheduler] Collected ${news.length} news items`)

      // 2. 验证链接
      console.log(`[Scheduler] Step 2: Verifying links...`)
      const verifyResults = await this.linkVerifier.verifyLinks(news)
      const validNews = this.linkVerifier.filterValidNews(verifyResults)

      console.log(`[Scheduler] Verified ${validNews.length} valid links`)

      if (validNews.length === 0) {
        throw new Error("No valid news after verification")
      }

      // 3. 生成日报
      console.log(`[Scheduler] Step 3: Generating report...`)
      const report = await this.reportGenerator.generateReport(validNews, targetDate)

      // 4. 保存日报
      console.log(`[Scheduler] Step 4: Saving report...`)
      const { localPath, ossUrl } = await this.reportGenerator.saveReport(report)

      task.status = "completed"
      task.result = {
        date: targetDate,
        localPath,
        ossUrl,
        totalNews: news.length,
        validNews: validNews.length,
      }

      console.log(`[Scheduler] Task ${task.id} completed successfully`)

    } catch (error) {
      task.status = "failed"
      task.error = error instanceof Error ? error.message : String(error)
      console.error(`[Scheduler] Task ${task.id} failed:`, error)
    }

    this.tasks.set(task.id, task)
    return task
  }

  /**
   * 手动触发日报生成
   */
  async triggerManual(date?: string, force: boolean = false): Promise<ScheduledTask> {
    const targetDate = date || new Date().toISOString().split("T")[0]

    // 检查是否已存在
    if (!force && this.reportGenerator.reportExists(targetDate)) {
      throw new Error(`Report for ${targetDate} already exists. Use force=true to overwrite.`)
    }

    return this.executeTask(targetDate)
  }

  /**
   * 获取任务列表
   */
  getTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values())
  }

  /**
   * 获取任务状态
   */
  getTask(taskId: string): ScheduledTask | null {
    return this.tasks.get(taskId) || null
  }

  /**
   * 获取调度器状态
   */
  getStatus(): {
    isRunning: boolean
    config: DailyReportConfig
    taskCount: number
    lastTask?: ScheduledTask
  } {
    const tasks = Array.from(this.tasks.values())
    const lastTask = tasks[tasks.length - 1]

    return {
      isRunning: this.isRunning,
      config: this.config,
      taskCount: tasks.length,
      lastTask,
    }
  }

  /**
   * 清理旧任务记录
   */
  cleanupOldTasks(maxAgeHours: number = 24): void {
    const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000

    for (const [id, task] of this.tasks) {
      if (task.scheduledAt.getTime() < cutoff) {
        this.tasks.delete(id)
      }
    }

    console.log(`[Scheduler] Cleaned up old tasks, remaining: ${this.tasks.size}`)
  }
}

// =============================================================================
// 单例实例
// =============================================================================

let globalScheduler: DailyReportScheduler | null = null

export function getScheduler(options?: Partial<SchedulerOptions>): DailyReportScheduler {
  if (!globalScheduler) {
    const aiService = new AIService()
    const ossManager = process.env.VITE_OSS_ACCESS_KEY_ID ? new OSSManager() : undefined

    const newsCollector = new NewsCollector()
    const linkVerifier = new LinkVerifier()
    const reportGenerator = new ReportGenerator({
      aiService,
      ossManager,
      summaryLength: 1000,
      maxNewsPerCategory: 8,
    })

    globalScheduler = new DailyReportScheduler({
      newsCollector,
      linkVerifier,
      reportGenerator,
    })
  }
  return globalScheduler
}

export function initializeScheduler(options: SchedulerOptions): DailyReportScheduler {
  globalScheduler = new DailyReportScheduler(options)
  return globalScheduler
}
