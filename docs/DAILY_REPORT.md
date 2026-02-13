# AI日报系统使用文档

## 📋 系统概述

AI日报系统是一个自动化的资讯收集、总结和讨论平台。系统每天自动抓取新闻、生成结构化日报，并与用户进行智能讨论，记录用户观点。

## ✨ 核心功能

### 1. 自动新闻收集
- 支持RSS新闻源
- 多领域分类（科技、财经、国际、科学等）
- 自动去重和筛选

### 2. 链接验证
- 验证新闻链接有效性
- 确保引用来源可靠
- 自动过滤失效链接

### 3. AI日报生成
- 每日1000字综合总结
- 按领域分类展示
- 包含验证过的原文链接
- 支持本地和OSS双存储

### 4. 智能讨论
- 基于日报内容发起讨论
- 加载用户历史观点
- AI记住用户立场
- 自动提取和存储观点

### 5. 观点档案
- 记录用户对各领域观点
- 生成观点总结
- 支持观点搜索和回顾

### 6. 定时调度
- 每天0-6点自动执行
- 支持手动触发
- 任务状态监控

## 🚀 快速开始

### 访问方式

**前端页面:**
```
https://your-server:3002/daily-report.html
```

**API端点:**
```
GET  /api/daily-report/status          # 系统状态
GET  /api/daily-report/reports         # 日报列表
GET  /api/daily-report/reports/:date   # 指定日期日报
GET  /api/daily-report/reports/:date/download  # 下载日报
POST /api/daily-report/discuss         # 发起讨论
GET  /api/daily-report/opinions?userId=xxx     # 获取观点
POST /api/daily-report/trigger         # 手动触发生成
```

## ⚙️ 配置说明

### 环境变量

```bash
# 日报系统总开关（默认启用）
ENABLE_DAILY_REPORT=true

# 定时调度开关
DAILY_REPORT_SCHEDULE_ENABLED=true

# 执行时间段（24小时制，默认0-6点）
DAILY_REPORT_SCHEDULE_HOURS=0,6

# 随机延迟（避免固定时间请求）
DAILY_REPORT_RANDOM_DELAY=true

# 存储配置
DAILY_REPORT_LOCAL_STORAGE=true
DAILY_REPORT_OSS_STORAGE=true

# 数据保留天数
DAILY_REPORT_RETENTION_DAYS=30
```

### 新闻源配置

编辑 `multiplayer/daily-report/config.ts`:

```typescript
export const DEFAULT_NEWS_SOURCES: NewsSource[] = [
  {
    name: "TechCrunch",
    url: "https://techcrunch.com/feed/",
    category: "technology",
    type: "rss",
    enabled: true,
  },
  // 添加更多源...
]
```

## 📁 文件结构

```
project/
├── multiplayer/daily-report/      # 日报系统核心模块
│   ├── index.ts                   # 模块入口
│   ├── types.ts                   # 类型定义
│   ├── config.ts                  # 配置管理
│   ├── news-collector.ts          # 新闻抓取
│   ├── link-verifier.ts           # 链接验证
│   ├── report-generator.ts        # 日报生成
│   ├── opinion-storage.ts         # 观点存储
│   ├── discussion-service.ts      # 讨论服务
│   ├── scheduler.ts               # 定时调度
│   └── api-handler.ts             # API处理器
├── public/
│   └── daily-report.html          # 前端页面
├── data/daily-report/
│   ├── reports/                   # 日报文件
│   └── opinions/                  # 用户观点
└── docs/DAILY_REPORT.md           # 本文档
```

## 🧪 测试方法

```bash
# 运行日报系统测试
bun run test:daily-report

# 手动触发日报生成（需服务器运行中）
curl -X POST https://localhost:3002/api/daily-report/trigger \
  -H "Content-Type: application/json" \
  -d '{"date":"2026-02-12","force":true}'
```

## 📊 日报格式示例

```markdown
# 每日资讯日报 - 2026-02-12

> 生成时间: 2026/2/12 15:39:13
> 数据来源: 2 个媒体源
> 新闻总数: 5 条 (已验证: 5 条)

---

## 📋 今日概览

今日全球科技领域主要关注AI发展...

---

## 💻 科技动态

1. **[新闻标题](验证过的链接)** - 来源
   > 新闻摘要...

2. **[新闻标题](验证过的链接)** - 来源
   > 新闻摘要...

---

*本日报由 AI 自动生成，仅供参考*
```

## 🔧 故障排查

### 日报未生成
1. 检查 `ENABLE_DAILY_REPORT` 是否启用
2. 检查 `DEEPSEEK_API_KEY` 是否配置
3. 查看服务器日志中的 `[Scheduler]` 输出

### 新闻抓取失败
1. 检查新闻源URL是否有效
2. 检查网络连接
3. 查看 `[NewsCollector]` 日志

### 链接验证失败
1. 检查目标网站是否可访问
2. 检查是否被反爬虫限制
3. 调整 `LinkVerifier` 的超时设置

## 📝 注意事项

1. **API密钥安全:** 确保 `DEEPSEEK_API_KEY` 不泄露
2. **RSS源稳定性:** 定期检查新闻源可用性
3. **存储空间:** 监控 `data/daily-report` 目录大小
4. **网络请求:** 避免频繁抓取同一源，遵守robots.txt

## 🔄 更新日志

### v1.0.0 (2026-02-12)
- 初始版本发布
- 支持RSS新闻抓取
- AI自动生成日报
- 智能讨论系统
- 观点存储功能
