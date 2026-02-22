/**
 * Daily Report API Handler
 * 日报系统API处理器
 *
 * 处理日报相关的HTTP请求
 */

import type { ReportListResponse, DiscussRequest, DiscussResponse, OpinionResponse } from "./types"
import { ReportGenerator } from "./report-generator"
import { OpinionStorage } from "./opinion-storage"
import { DiscussionService } from "./discussion-service"
import { DailyReportScheduler, getScheduler } from "./scheduler"
import { AIService } from "../ai-service"
import { OSSManager } from "../oss"
import { PATHS } from "./config"
import * as fs from "fs"
import * as path from "path"

export interface DailyReportAPIOptions {
  reportGenerator: ReportGenerator
  aiService: AIService
  ossManager?: OSSManager
}

export class DailyReportAPIHandler {
  private reportGenerator: ReportGenerator
  private aiService: AIService
  private ossManager?: OSSManager
  private discussionServices: Map<string, DiscussionService> = new Map()

  constructor(options: DailyReportAPIOptions) {
    this.reportGenerator = options.reportGenerator
    this.aiService = options.aiService
    this.ossManager = options.ossManager
  }

  /**
   * 处理API请求
   */
  async handleRequest(req: Request, url: URL): Promise<Response> {
    const pathname = url.pathname
    const method = req.method

    // CORS headers
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }

    // OPTIONS请求处理
    if (method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders, status: 204 })
    }

    try {
      // GET /api/daily-report/reports - 获取日报列表
      if (pathname === "/api/daily-report/reports" && method === "GET") {
        return await this.handleListReports(corsHeaders)
      }

      // GET /api/daily-report/reports/:date - 获取指定日期日报
      const reportMatch = pathname.match(/^\/api\/daily-report\/reports\/([^\/]+)$/)
      if (reportMatch && method === "GET") {
        const date = reportMatch[1]
        return await this.handleGetReport(date, corsHeaders)
      }

      // GET /api/daily-report/reports/:date/download - 下载日报
      const downloadMatch = pathname.match(/^\/api\/daily-report\/reports\/([^\/]+)\/download$/)
      if (downloadMatch && method === "GET") {
        const date = downloadMatch[1]
        return await this.handleDownloadReport(date, corsHeaders)
      }

      // POST /api/daily-report/discuss/init - 初始化讨论会话
      if (pathname === "/api/daily-report/discuss/init" && method === "POST") {
        return await this.handleInitDiscussion(req, corsHeaders)
      }

      // POST /api/daily-report/discuss - 讨论
      if (pathname === "/api/daily-report/discuss" && method === "POST") {
        return await this.handleDiscuss(req, corsHeaders)
      }

      // GET /api/daily-report/opinions - 获取观点
      if (pathname === "/api/daily-report/opinions" && method === "GET") {
        const userId = url.searchParams.get("userId") || "default"
        return await this.handleGetOpinions(userId, corsHeaders)
      }

      // POST /api/daily-report/trigger - 手动触发日报生成
      if (pathname === "/api/daily-report/trigger" && method === "POST") {
        return await this.handleTrigger(req, corsHeaders)
      }

      // GET /api/daily-report/status - 调度器状态
      if (pathname === "/api/daily-report/status" && method === "GET") {
        return await this.handleStatus(corsHeaders)
      }

      // 404
      return new Response(
        JSON.stringify({ error: "Not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    } catch (error) {
      console.error(`[DailyReportAPI] Error handling request:`, error)
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
  }

  /**
   * 获取日报列表
   */
  private async handleListReports(corsHeaders: Record<string, string>): Promise<Response> {
    const reports = this.reportGenerator.listReports()

    const response: ReportListResponse = {
      reports: reports.map(r => ({
        date: r.date,
        filename: r.filename,
        localPath: r.localPath || ``,
        size: r.size,
        createdAt: r.createdAt,
      })),
      total: reports.length,
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  /**
   * 获取指定日期日报
   */
  private async handleGetReport(date: string, corsHeaders: Record<string, string>): Promise<Response> {
    // 验证日期格式
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(
        JSON.stringify({ error: "Invalid date format. Use YYYY-MM-DD" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const report = this.reportGenerator.readReport(date)

    if (!report) {
      return new Response(
        JSON.stringify({ error: "Report not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    return new Response(JSON.stringify(report), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  /**
   * 下载日报
   */
  private async handleDownloadReport(date: string, corsHeaders: Record<string, string>): Promise<Response> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return new Response(
        JSON.stringify({ error: "Invalid date format. Use YYYY-MM-DD" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const filePath = path.join(PATHS.reportsDir, `${date}.md`)

    if (!fs.existsSync(filePath)) {
      return new Response(
        JSON.stringify({ error: "Report not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    try {
      const file = Bun.file(filePath)
      const encodedFilename = encodeURIComponent(`${date}-日报.md`)

      return new Response(file, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodedFilename}`,
        },
      })
    } catch (error) {
      return new Response(
        JSON.stringify({ error: "Failed to read report" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
  }

  /**
   * 初始化讨论会话
   */
  private async handleInitDiscussion(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const body = await req.json() as { date?: string; userId?: string }

    if (!body.date) {
      return new Response(
        JSON.stringify({ error: "Missing required field: date" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const userId = body.userId || "anonymous"

    // 获取或创建讨论服务
    let discussionService = this.discussionServices.get(userId)
    if (!discussionService) {
      const opinionStorage = new OpinionStorage({ userId, aiService: this.aiService })
      discussionService = new DiscussionService({
        aiService: this.aiService,
        opinionStorage,
        reportGenerator: this.reportGenerator,
        userId,
      })
      this.discussionServices.set(userId, discussionService)
    }

    try {
      // 创建新会话，这会生成AI开场白
      const session = await discussionService.createSession(body.date)

      // 获取开场白消息
      const openingMessage = session.messages[0]

      return new Response(JSON.stringify({
        message: openingMessage,
        sessionId: session.id,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Failed to initialize discussion" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
  }

  /**
   * 处理讨论请求
   */
  private async handleDiscuss(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const body = await req.json() as DiscussRequest

    if (!body.message || !body.date) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: message, date" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const userId = body.userId || "anonymous"

    // 获取或创建讨论服务
    let discussionService = this.discussionServices.get(userId)
    if (!discussionService) {
      const opinionStorage = new OpinionStorage({ userId, aiService: this.aiService })
      discussionService = new DiscussionService({
        aiService: this.aiService,
        opinionStorage,
        reportGenerator: this.reportGenerator,
        userId,
      })
      this.discussionServices.set(userId, discussionService)
    }

    try {
      // 获取或创建会话
      const session = await discussionService.getOrCreateSession(body.date, body.sessionId)

      // 发送消息
      const { message } = await discussionService.sendMessage(session.id, body.message)

      const response: DiscussResponse = {
        message,
        sessionId: session.id,
      }

      return new Response(JSON.stringify(response), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Discussion failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
  }

  /**
   * 获取用户观点
   */
  private async handleGetOpinions(userId: string, corsHeaders: Record<string, string>): Promise<Response> {
    const opinionStorage = new OpinionStorage({ userId, aiService: this.aiService })
    const record = opinionStorage.loadRecord()

    // 获取今天的观点
    const today = new Date().toISOString().split("T")[0]
    const todayOpinions = opinionStorage.getOpinionsByDate(today)

    const response: OpinionResponse = {
      opinions: record,
      todayTopics: todayOpinions.map(o => o.topic),
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  /**
   * 手动触发日报生成
   */
  private async handleTrigger(req: Request, corsHeaders: Record<string, string>): Promise<Response> {
    const body = await req.json().catch(() => ({})) as { date?: string; force?: boolean }

    try {
      const scheduler = getScheduler()
      const task = await scheduler.triggerManual(body.date, body.force)

      return new Response(JSON.stringify({
        success: true,
        task: {
          id: task.id,
          status: task.status,
          result: task.result,
          error: task.error,
        },
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error instanceof Error ? error.message : "Trigger failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
  }

  /**
   * 获取调度器状态
   */
  private async handleStatus(corsHeaders: Record<string, string>): Promise<Response> {
    const scheduler = getScheduler()
    const status = scheduler.getStatus()

    return new Response(JSON.stringify({
      enabled: status.config.enabled,
      isRunning: status.isRunning,
      schedule: status.config.schedule,
      lastTask: status.lastTask,
      taskCount: status.taskCount,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
}

// =============================================================================
// 单例实例
// =============================================================================

let globalAPIHandler: DailyReportAPIHandler | null = null

export function getDailyReportAPIHandler(options?: DailyReportAPIOptions): DailyReportAPIHandler {
  if (!globalAPIHandler) {
    if (!options) {
      throw new Error("DailyReportAPIHandler not initialized")
    }
    globalAPIHandler = new DailyReportAPIHandler(options)
  }
  return globalAPIHandler
}

export function initializeDailyReportAPIHandler(options: DailyReportAPIOptions): DailyReportAPIHandler {
  globalAPIHandler = new DailyReportAPIHandler(options)
  return globalAPIHandler
}
