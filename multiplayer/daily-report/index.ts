/**
 * Daily Report System
 * AI日报系统
 *
 * 自动抓取新闻、生成日报、支持AI讨论
 */

// 类型导出
export * from "./types"

// 服务导出
export { NewsCollector, getNewsCollector } from "./news-collector"
export { LinkVerifier, getLinkVerifier } from "./link-verifier"
export { ReportGenerator, getReportGenerator, initializeReportGenerator } from "./report-generator"
export { OpinionStorage, getOpinionStorage, clearOpinionStorageCache } from "./opinion-storage"
export { DiscussionService } from "./discussion-service"
export { DailyReportScheduler, getScheduler, initializeScheduler } from "./scheduler"
export { DailyReportAPIHandler, getDailyReportAPIHandler, initializeDailyReportAPIHandler } from "./api-handler"

// 配置导出
export {
  ConfigManager,
  getConfigManager,
  DEFAULT_CONFIG,
  DEFAULT_NEWS_SOURCES,
  CATEGORY_NAMES,
  PATHS,
  REPORT_GENERATION_PROMPT,
  DISCUSSION_SYSTEM_PROMPT,
  OPINION_SUMMARY_PROMPT,
} from "./config"

// 版本信息
export const DAILY_REPORT_VERSION = "1.0.0"
