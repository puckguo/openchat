/**
 * 手动生成今日日报
 */

import { NewsCollector } from "./multiplayer/daily-report/news-collector"
import { LinkVerifier } from "./multiplayer/daily-report/link-verifier"
import { ReportGenerator } from "./multiplayer/daily-report/report-generator"
import { AIService } from "./multiplayer/ai-service"
import { getConfigManager } from "./multiplayer/daily-report/config"

async function generateTodayReport() {
  console.log("=== 手动生成今日日报 ===\n")

  const today = new Date().toISOString().split("T")[0]
  console.log(`目标日期: ${today}`)

  const aiService = new AIService()
  const reportGenerator = new ReportGenerator({
    aiService,
    summaryLength: 1000,
    maxNewsPerCategory: 8,
  })

  // 检查是否已存在
  if (reportGenerator.reportExists(today)) {
    console.log(`报告 ${today} 已存在，跳过生成`)
    return
  }

  const newsCollector = new NewsCollector()
  const linkVerifier = new LinkVerifier()

  try {
    // 1. 抓取新闻
    console.log("\n1. 抓取新闻...")
    const sources = getConfigManager().getEnabledSources()
    console.log(`   启用的新闻源: ${sources.length} 个`)
    sources.forEach(s => console.log(`   - ${s.name} (${s.category})`))

    const news = await newsCollector.fetchFromSources(sources)
    console.log(`   抓取到 ${news.length} 条新闻`)

    if (news.length === 0) {
      throw new Error("没有抓取到新闻")
    }

    // 2. 验证链接
    console.log("\n2. 验证链接...")
    const verifyResults = await linkVerifier.verifyLinks(news)
    const validNews = linkVerifier.filterValidNews(verifyResults)
    console.log(`   有效链接: ${validNews.length} / ${news.length}`)

    if (validNews.length === 0) {
      throw new Error("没有有效新闻")
    }

    // 3. 生成报告
    console.log("\n3. 生成报告...")
    const report = await reportGenerator.generateReport(validNews, today)
    console.log(`   报告摘要: ${report.summary.substring(0, 100)}...`)

    // 4. 保存报告
    console.log("\n4. 保存报告...")
    const { localPath } = await reportGenerator.saveReport(report)
    console.log(`   已保存到: ${localPath}`)

    console.log("\n✅ 日报生成成功!")
  } catch (error) {
    console.error("\n❌ 生成失败:", error)
    process.exit(1)
  }
}

generateTodayReport()
