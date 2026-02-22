/**
 * Daily Report Configuration
 * 日报系统配置管理
 */

import type { DailyReportConfig, NewsSource, NewsCategory } from "./types"

// =============================================================================
// 默认新闻源配置
// =============================================================================

export const DEFAULT_NEWS_SOURCES: NewsSource[] = [
  // 科技新闻
  {
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/",
    category: "technology",
    type: "rss",
    enabled: true,
    weight: 1.0,
  },
  {
    name: "36氪",
    url: "https://36kr.com/feed",
    category: "technology",
    type: "rss",
    enabled: true,
    weight: 1.2,
  },
  {
    name: "虎嗅",
    url: "https://www.huxiu.com/rss",
    category: "business",
    type: "rss",
    enabled: true,
    weight: 1.0,
  },
  // 财经新闻
  {
    name: "华尔街见闻",
    url: "https://wallstreetcn.com/rss",
    category: "business",
    type: "rss",
    enabled: true,
    weight: 1.0,
  },
  // 国际新闻
  {
    name: "BBC News",
    url: "http://feeds.bbci.co.uk/news/rss.xml",
    category: "international",
    type: "rss",
    enabled: true,
    weight: 1.0,
  },
  {
    name: "Reuters",
    url: "https://www.reutersagency.com/feed/?taxonomy=markets&post_type=reuters-best",
    category: "business",
    type: "rss",
    enabled: true,
    weight: 0.9,
  },
  // 科学探索
  {
    name: "Solidot",
    url: "https://www.solidot.org/index.rss",
    category: "science",
    type: "rss",
    enabled: true,
    weight: 1.0,
  },
]

// =============================================================================
// 分类名称映射
// =============================================================================

export const CATEGORY_NAMES: Record<NewsCategory, string> = {
  politics: "🏛️ 时政要闻",
  technology: "💻 科技动态",
  business: "💼 商业财经",
  international: "🌍 国际新闻",
  society: "👥 社会民生",
  sports: "⚽ 体育竞技",
  entertainment: "🎬 娱乐文化",
  science: "🔬 科学探索",
  other: "📰 其他资讯",
}

// =============================================================================
// 默认配置
// =============================================================================

export const DEFAULT_CONFIG: DailyReportConfig = {
  enabled: true,
  schedule: {
    enabled: true,
    hourRange: [0, 6],  // 凌晨0点到6点
    randomDelay: true,
  },
  newsSources: DEFAULT_NEWS_SOURCES,
  reportFormat: {
    summaryLength: 1000,
    maxNewsPerCategory: 8,
    includeUnverified: false,
  },
  storage: {
    localEnabled: true,
    ossEnabled: true,
    retentionDays: 30,
  },
  discussion: {
    loadHistoryOpinions: true,
    maxContextMessages: 20,
  },
}

// =============================================================================
// 配置管理类
// =============================================================================

export class ConfigManager {
  private config: DailyReportConfig

  constructor() {
    this.config = this.loadConfig()
  }

  private loadConfig(): DailyReportConfig {
    // 从环境变量加载配置
    const envConfig: Partial<DailyReportConfig> = {
      enabled: process.env.DAILY_REPORT_ENABLED !== "false",
      schedule: {
        enabled: process.env.DAILY_REPORT_SCHEDULE_ENABLED !== "false",
        hourRange: this.parseHourRange(process.env.DAILY_REPORT_SCHEDULE_HOURS),
        randomDelay: process.env.DAILY_REPORT_RANDOM_DELAY !== "false",
      },
      storage: {
        localEnabled: process.env.DAILY_REPORT_LOCAL_STORAGE !== "false",
        ossEnabled: process.env.DAILY_REPORT_OSS_STORAGE === "true",
        retentionDays: parseInt(process.env.DAILY_REPORT_RETENTION_DAYS || "30"),
      },
    }

    return {
      ...DEFAULT_CONFIG,
      ...envConfig,
      schedule: { ...DEFAULT_CONFIG.schedule, ...envConfig.schedule },
      storage: { ...DEFAULT_CONFIG.storage, ...envConfig.storage },
    }
  }

  private parseHourRange(hoursStr?: string): [number, number] {
    if (!hoursStr) return [0, 6]
    const parts = hoursStr.split(",").map(Number)
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return [parts[0], parts[1]]
    }
    return [0, 6]
  }

  getConfig(): DailyReportConfig {
    return this.config
  }

  updateConfig(newConfig: Partial<DailyReportConfig>): void {
    this.config = { ...this.config, ...newConfig }
  }

  getEnabledSources(): NewsSource[] {
    return this.config.newsSources.filter(s => s.enabled)
  }

  getSourcesByCategory(category: NewsCategory): NewsSource[] {
    return this.getEnabledSources().filter(s => s.category === category)
  }

  isScheduleEnabled(): boolean {
    return this.config.enabled && this.config.schedule.enabled
  }
}

// =============================================================================
// 单例实例
// =============================================================================

let globalConfigManager: ConfigManager | null = null

export function getConfigManager(): ConfigManager {
  if (!globalConfigManager) {
    globalConfigManager = new ConfigManager()
  }
  return globalConfigManager
}

// =============================================================================
// 路径配置
// =============================================================================

export const PATHS = {
  reportsDir: "./data/daily-report/reports",
  opinionsDir: "./data/daily-report/opinions",
  downloadDir: "./data/daily-report/download",
  ossPrefix: "daily-report/",
}

// =============================================================================
// AI提示词配置
// =============================================================================

export const REPORT_GENERATION_PROMPT = `你是一位资深新闻编辑，负责撰写每日资讯日报。

请根据提供的新闻素材，生成一份结构化的日报，要求：

1. **今日概览**（约1000字）：
   - 综合分析当天各领域重要新闻
   - 提炼关键趋势和要点
   - 使用专业但易懂的语言

2. **分领域新闻列表**：
   - 按领域分类列出重要新闻
   - 每条新闻包含：标题、来源、链接（确保可验证）、简短摘要
   - 只包含经过验证的链接

格式要求：
- 使用Markdown格式
- 标题层次分明
- 链接使用标准Markdown格式：[标题](URL)

今天是 {date}。`

export const DISCUSSION_SYSTEM_PROMPT = `你是一位博学的新闻评论员，正在与用户讨论今日新闻日报。

背景信息：
- 今天是 {date}
- 当前讨论基于今日日报内容

{opinionContext}

讨论原则：
1. 基于日报内容提出有深度的问题或观点
2. 倾听用户的看法，进行有意义的对话
3. 记录用户的观点，形成观点档案
4. 如果用户提及之前的观点，要表现出记忆和连贯性
5. 保持客观、理性、建设性的讨论氛围
6. 可以适当挑战用户的观点，但要尊重、有理有据

当前日报摘要：
{reportSummary}

请基于以上内容与用户展开讨论。`

export const OPINION_SUMMARY_PROMPT = `请从以下用户观点记录中，总结用户的核心立场和兴趣领域。

要求输出格式：
1. 核心观点（3-5条）
2. 关注领域（列出感兴趣的领域）
3. 立场倾向（对各主要议题的立场）

用户观点记录：
{opinions}

请用简洁的JSON格式返回：
{
  "coreViews": ["观点1", "观点2", ...],
  "interests": ["领域1", "领域2", ...],
  "stanceMap": {"议题": "立场", ...}
}`
