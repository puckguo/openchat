/**
 * Mention Parser
 * @提及解析模块
 *
 * 解析消息中的 @提及，支持用户和 AI
 */

import type { ChatMessage, Participant, UserRole } from "./types"

// =============================================================================
// 提及类型
// =============================================================================

export interface Mention {
  /** 提及在文本中的起始位置 */
  start: number
  /** 提及在文本中的结束位置 */
  end: number
  /** 提及的原始文本（包含 @ 符号） */
  raw: string
  /** 提及的用户名（不包含 @ 符号） */
  username: string
  /** 提及类型 */
  type: "user" | "ai" | "all" | "unknown"
  /** 对应的用户 ID（如果已解析） */
  userId?: string
  /** 对应的用户角色（如果已解析） */
  userRole?: UserRole
}

export interface ParseMentionsResult {
  /** 解析到的所有提及 */
  mentions: Mention[]
  /** 是否包含 @ai */
  hasAI: boolean
  /** 是否包含 @all */
  hasAll: boolean
  /** 普通用户提及 */
  userMentions: Mention[]
  /** 清理后的文本（移除提及或保留） */
  cleanText: string
}

// =============================================================================
// 正则表达式
// =============================================================================

/** 提及匹配正则 - 支持 @username、@"user name"、@ai、@all */
const MENTION_REGEX = /@(?:"([^"]+)"|(\w+))/g

/** 无效用户名 */
const INVALID_USERNAMES = new Set(["", " ", "here", "channel", "everyone"])

// =============================================================================
// 提及解析
// =============================================================================

/**
 * 解析文本中的提及
 */
export function parseMentions(
  text: string,
  participants: Participant[] = []
): ParseMentionsResult {
  const mentions: Mention[] = []
  let hasAI = false
  let hasAll = false

  // 重置正则
  MENTION_REGEX.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const raw = match[0]
    const username = (match[1] || match[2]).trim().toLowerCase()

    // 跳过无效用户名
    if (INVALID_USERNAMES.has(username)) {
      continue
    }

    // 判断提及类型
    let type: Mention["type"] = "unknown"
    let userId: string | undefined
    let userRole: UserRole | undefined

    if (username === "ai") {
      type = "ai"
      hasAI = true
    } else if (username === "all" || username === "everyone" || username === "channel") {
      type = "all"
      hasAll = true
    } else {
      // 尝试匹配参与者
      const participant = participants.find(
        (p) => p.name.toLowerCase() === username || p.id.toLowerCase() === username
      )

      if (participant) {
        type = "user"
        userId = participant.id
        userRole = participant.role
      } else {
        type = "unknown"
      }
    }

    mentions.push({
      start: match.index,
      end: match.index + raw.length,
      raw,
      username,
      type,
      userId,
      userRole,
    })
  }

  return {
    mentions,
    hasAI,
    hasAll,
    userMentions: mentions.filter((m) => m.type === "user"),
    cleanText: removeMentions(text, mentions),
  }
}

/**
 * 快速检测是否包含 @ai
 */
export function hasAIMention(text: string): boolean {
  return /@ai\b/i.test(text)
}

/**
 * 快速检测是否包含任何提及
 */
export function hasAnyMention(text: string): boolean {
  return /@\w+/.test(text)
}

/**
 * 获取提及的用户名列表
 */
export function extractMentionUsernames(text: string): string[] {
  const usernames: string[] = []
  MENTION_REGEX.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const username = (match[1] || match[2]).trim().toLowerCase()
    if (!INVALID_USERNAMES.has(username)) {
      usernames.push(username)
    }
  }

  return [...new Set(usernames)] // 去重
}

/**
 * 从文本中移除提及
 */
export function removeMentions(text: string, mentions: Mention[]): string {
  let result = text

  // 从后往前替换，避免位置偏移
  const sortedMentions = [...mentions].sort((a, b) => b.start - a.start)

  for (const mention of sortedMentions) {
    result = result.slice(0, mention.start) + result.slice(mention.end)
  }

  // 清理多余空格
  return result.replace(/\s+/g, " ").trim()
}

/**
 * 将提及替换为其他格式
 */
export function replaceMentions(
  text: string,
  mentions: Mention[],
  replacer: (mention: Mention) => string
): string {
  let result = ""
  let lastIndex = 0

  // 按位置排序
  const sortedMentions = [...mentions].sort((a, b) => a.start - b.start)

  for (const mention of sortedMentions) {
    result += text.slice(lastIndex, mention.start)
    result += replacer(mention)
    lastIndex = mention.end
  }

  result += text.slice(lastIndex)
  return result
}

/**
 * 将提及转换为 HTML 高亮
 */
export function highlightMentions(text: string, mentions: Mention[]): string {
  return replaceMentions(text, mentions, (mention) => {
    const className = `mention mention-${mention.type}`
    const dataAttrs = mention.userId ? `data-user-id="${mention.userId}"` : ""
    return `<span class="${className}" ${dataAttrs}>${mention.raw}</span>`
  })
}

/**
 * 将提及转换为 Markdown 格式
 */
export function mentionsToMarkdown(text: string, mentions: Mention[]): string {
  return replaceMentions(text, mentions, (mention) => {
    if (mention.userId) {
      return `[${mention.raw}](user://${mention.userId})`
    }
    return mention.raw
  })
}

// =============================================================================
// 提及补全
// =============================================================================

export interface MentionSuggestion {
  id: string
  name: string
  displayName: string
  avatar?: string
  role: UserRole
  matchScore: number
}

/**
 * 获取提及建议
 */
export function getMentionSuggestions(
  query: string,
  participants: Participant[],
  currentUserId?: string,
  maxResults: number = 5
): MentionSuggestion[] {
  const lowerQuery = query.toLowerCase().trim()

  // 过滤当前用户和 AI（AI 需要单独输入 @ai）
  const candidates = participants.filter(
    (p) => p.id !== currentUserId && p.role !== "ai"
  )

  const suggestions: MentionSuggestion[] = candidates.map((p) => {
    const nameLower = p.name.toLowerCase()
    let matchScore = 0

    // 完全匹配
    if (nameLower === lowerQuery) {
      matchScore = 100
    }
    // 开头匹配
    else if (nameLower.startsWith(lowerQuery)) {
      matchScore = 80
    }
    // 包含匹配
    else if (nameLower.includes(lowerQuery)) {
      matchScore = 50
    }
    // ID 匹配
    else if (p.id.toLowerCase().includes(lowerQuery)) {
      matchScore = 30
    }

    return {
      id: p.id,
      name: p.name,
      displayName: `${p.name} (${p.role})`,
      avatar: p.avatar,
      role: p.role,
      matchScore,
    }
  })

  // 按匹配分数排序并限制结果
  return suggestions
    .filter((s) => s.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, maxResults)
}

/**
 * 获取所有可提及的目标（包括特殊提及）
 */
export function getAllMentionTargets(
  participants: Participant[],
  currentUserId?: string
): Array<{ type: "user" | "special"; id: string; name: string; icon?: string }> {
  const targets: Array<{ type: "user" | "special"; id: string; name: string; icon?: string }> = [
    { type: "special", id: "ai", name: "AI 助手", icon: "🤖" },
    { type: "special", id: "all", name: "所有人", icon: "👥" },
  ]

  const userTargets = participants
    .filter((p) => p.id !== currentUserId)
    .map((p) => ({
      type: "user" as const,
      id: p.id,
      name: p.name,
      icon: p.role === "owner" ? "👑" : p.role === "admin" ? "🛡️" : "👤",
    }))

  return [...targets, ...userTargets]
}

// =============================================================================
// 消息处理
// =============================================================================

/**
 * 处理消息中的提及，添加元数据
 */
export function processMessageMentions(
  message: ChatMessage,
  participants: Participant[]
): ChatMessage {
  const result = parseMentions(message.content, participants)

  return {
    ...message,
    mentions: result.mentions
      .filter((m) => m.userId)
      .map((m) => m.userId!),
    mentionsAI: result.hasAI,
  }
}

/**
 * 提取需要通知的用户 ID 列表
 */
export function getUsersToNotify(
  mentions: Mention[],
  participants: Participant[],
  senderId: string
): string[] {
  const userIds = new Set<string>()

  for (const mention of mentions) {
    switch (mention.type) {
      case "ai":
        // AI 不需要通知
        break

      case "all":
        // 通知所有在线用户（除了发送者）
        for (const p of participants) {
          if (p.id !== senderId && p.role !== "ai") {
            userIds.add(p.id)
          }
        }
        break

      case "user":
        if (mention.userId && mention.userId !== senderId) {
          userIds.add(mention.userId)
        }
        break
    }
  }

  return [...userIds]
}

// =============================================================================
// 输入处理
// =============================================================================

export interface InputMentionState {
  /** 是否正在输入提及 */
  isTypingMention: boolean
  /** 提及查询字符串 */
  query: string
  /** 提及开始位置 */
  startPosition: number
  /** 当前光标位置 */
  cursorPosition: number
}

/**
 * 检测输入状态是否正在输入提及
 */
export function detectMentionInput(
  text: string,
  cursorPosition: number
): InputMentionState {
  // 查找光标前最后一个 @
  const textBeforeCursor = text.slice(0, cursorPosition)
  const lastAtIndex = textBeforeCursor.lastIndexOf("@")

  if (lastAtIndex === -1) {
    return {
      isTypingMention: false,
      query: "",
      startPosition: cursorPosition,
      cursorPosition,
    }
  }

  // 检查 @ 后面是否有空格（如果有，说明已经结束）
  const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
  if (/\s/.test(textAfterAt)) {
    return {
      isTypingMention: false,
      query: "",
      startPosition: cursorPosition,
      cursorPosition,
    }
  }

  return {
    isTypingMention: true,
    query: textAfterAt,
    startPosition: lastAtIndex,
    cursorPosition,
  }
}

/**
 * 在输入中插入提及
 */
export function insertMention(
  text: string,
  mentionState: InputMentionState,
  mentionName: string
): { newText: string; newCursorPosition: number } {
  const before = text.slice(0, mentionState.startPosition)
  const after = text.slice(mentionState.cursorPosition)

  // 如果用户名包含空格，使用引号包裹
  const formattedName = mentionName.includes(" ")
    ? `@"${mentionName}"`
    : `@${mentionName}`

  const newText = before + formattedName + " " + after
  const newCursorPosition = before.length + formattedName.length + 1

  return { newText, newCursorPosition }
}
