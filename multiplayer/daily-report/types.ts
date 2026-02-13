/**
 * Daily Report System Types
 * 日报系统类型定义
 */

// =============================================================================
// 新闻相关类型
// =============================================================================

export interface NewsItem {
  id: string
  title: string
  summary: string
  url: string
  source: string
  category: NewsCategory
  publishTime: string
  verified: boolean
  verifyStatus?: 'success' | 'failed' | 'timeout'
}

export type NewsCategory =
  | 'politics'      // 时政要闻
  | 'technology'    // 科技动态
  | 'business'      // 商业财经
  | 'international' // 国际新闻
  | 'society'       // 社会民生
  | 'sports'        // 体育竞技
  | 'entertainment' // 娱乐文化
  | 'science'       // 科学探索
  | 'other'         // 其他

export interface NewsSource {
  name: string
  url: string
  category: NewsCategory
  type: 'rss' | 'api' | 'webhook'
  enabled: boolean
  weight?: number
}

// =============================================================================
// 日报相关类型
// =============================================================================

export interface DailyReport {
  date: string                    // YYYY-MM-DD
  generatedAt: string
  summary: string                 // 1000字总结
  sections: ReportSection[]
  metadata: ReportMetadata
}

export interface ReportSection {
  category: NewsCategory
  categoryName: string
  news: NewsItem[]
}

export interface ReportMetadata {
  totalSources: number
  totalNews: number
  verifiedNews: number
  generationTime: number          // 毫秒
  model: string
}

export interface ReportFile {
  date: string
  filename: string
  localPath: string
  ossUrl?: string
  size: number
  createdAt: string
}

// =============================================================================
// 讨论相关类型
// =============================================================================

export interface DiscussionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  topic?: string
}

export interface DiscussionSession {
  id: string
  date: string
  messages: DiscussionMessage[]
  topics: string[]
  startedAt: string
  lastMessageAt: string
}

// =============================================================================
// 观点相关类型
// =============================================================================

export interface UserOpinion {
  id: string
  date: string
  topic: string
  view: string
  context?: string
  timestamp: string
  source: 'discussion' | 'manual'
}

export interface OpinionRecord {
  userId: string
  history: DailyOpinion[]
  summary: OpinionSummary
  updatedAt: string
}

export interface DailyOpinion {
  date: string
  topics: string[]
  opinions: UserOpinion[]
}

export interface OpinionSummary {
  coreViews: string[]
  interests: string[]
  stanceMap: Record<string, string>
}

// =============================================================================
// API 请求/响应类型
// =============================================================================

export interface GenerateReportRequest {
  date?: string
  force?: boolean
}

export interface DiscussRequest {
  message: string
  date: string
  sessionId?: string
}

export interface DiscussResponse {
  message: DiscussionMessage
  sessionId: string
}

export interface ReportListResponse {
  reports: ReportFile[]
  total: number
}

export interface OpinionResponse {
  opinions: OpinionRecord
  todayTopics: string[]
}

// =============================================================================
// 配置类型
// =============================================================================

export interface DailyReportConfig {
  enabled: boolean
  schedule: {
    enabled: boolean
    hourRange: [number, number]  // [0, 6] 表示0-6点
    randomDelay: boolean
  }
  newsSources: NewsSource[]
  reportFormat: {
    summaryLength: number        // 默认1000字
    maxNewsPerCategory: number
    includeUnverified: boolean
  }
  storage: {
    localEnabled: boolean
    ossEnabled: boolean
    retentionDays: number
  }
  discussion: {
    loadHistoryOpinions: boolean
    maxContextMessages: number
  }
}
