/**
 * Message Sync Protocol
 * 消息同步协议
 *
 * 实现版本向量、冲突解决、离线消息队列
 */

import type { ChatMessage } from "./types"

// =============================================================================
// 版本向量 (Vector Clock)
// =============================================================================

/**
 * 版本向量 - 用于检测并发和因果关系
 * 每个参与者维护一个计数器，用于确定事件的偏序关系
 */
export type VectorClock = Record<string, number>

export class VectorClockUtil {
  /**
   * 创建新的版本向量
   */
  static create(userId: string): VectorClock {
    return { [userId]: 1 }
  }

  /**
   * 递增本地时钟
   */
  static increment(clock: VectorClock, userId: string): VectorClock {
    return {
      ...clock,
      [userId]: (clock[userId] || 0) + 1,
    }
  }

  /**
   * 合并两个版本向量（取最大值）
   */
  static merge(a: VectorClock, b: VectorClock): VectorClock {
    const result: VectorClock = { ...a }
    for (const [key, value] of Object.entries(b)) {
      result[key] = Math.max(result[key] || 0, value)
    }
    return result
  }

  /**
   * 比较两个版本向量
   * @returns -1: a < b, 0: 并发/相等, 1: a > b
   */
  static compare(a: VectorClock, b: VectorClock): -1 | 0 | 1 {
    let aGreater = false
    let bGreater = false

    const allKeys = new Set([...Object.keys(a), ...Object.keys(b)])

    for (const key of allKeys) {
      const aVal = a[key] || 0
      const bVal = b[key] || 0

      if (aVal > bVal) aGreater = true
      if (bVal > aVal) bGreater = true
    }

    if (aGreater && !bGreater) return 1
    if (bGreater && !aGreater) return -1
    return 0
  }

  /**
   * 检查是否有因果关系（a 发生在 b 之前）
   */
  static isBefore(a: VectorClock, b: VectorClock): boolean {
    return this.compare(a, b) === -1
  }

  /**
   * 检查是否并发（没有因果关系）
   */
  static isConcurrent(a: VectorClock, b: VectorClock): boolean {
    return this.compare(a, b) === 0 && !this.equal(a, b)
  }

  /**
   * 检查是否相等
   */
  static equal(a: VectorClock, b: VectorClock): boolean {
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)

    if (keysA.length !== keysB.length) return false

    for (const key of keysA) {
      if (a[key] !== b[key]) return false
    }

    return true
  }

  /**
   * 转换为字符串（用于存储/传输）
   */
  static serialize(clock: VectorClock): string {
    return JSON.stringify(clock)
  }

  /**
   * 从字符串解析
   */
  static deserialize(serialized: string): VectorClock {
    try {
      return JSON.parse(serialized)
    } catch {
      return {}
    }
  }
}

// =============================================================================
// 同步操作类型
// =============================================================================

export type SyncOperationType = "CREATE" | "UPDATE" | "DELETE"

export interface SyncOperation {
  id: string
  type: SyncOperationType
  table: "messages" | "participants" | "config"
  recordId: string
  data?: unknown
  vectorClock: VectorClock
  timestamp: number
  userId: string
  sessionId: string
}

export interface SyncMessage {
  operations: SyncOperation[]
  fromVectorClock: VectorClock
  toVectorClock: VectorClock
}

// =============================================================================
// 冲突解决策略
// =============================================================================

export type ConflictResolutionStrategy =
  | "last-write-wins"      // 最后写入胜出
  | "first-write-wins"     // 先写入胜出
  | "merge"                // 合并（用于文本）
  | "custom"               // 自定义策略

export interface ConflictResolution {
  strategy: ConflictResolutionStrategy
  winner?: SyncOperation
  loser?: SyncOperation
  merged?: unknown
}

export class ConflictResolver {
  /**
   * 解决冲突
   */
  static resolve(
    localOp: SyncOperation,
    remoteOp: SyncOperation,
    strategy: ConflictResolutionStrategy = "last-write-wins"
  ): ConflictResolution {
    const comparison = VectorClockUtil.compare(localOp.vectorClock, remoteOp.vectorClock)

    // 没有冲突，有明确的因果关系
    if (comparison !== 0) {
      const winner = comparison > 0 ? localOp : remoteOp
      const loser = comparison > 0 ? remoteOp : localOp
      return {
        strategy,
        winner,
        loser,
      }
    }

    // 并发冲突，需要解决策略
    switch (strategy) {
      case "last-write-wins":
        return this.resolveLastWriteWins(localOp, remoteOp)
      case "first-write-wins":
        return this.resolveFirstWriteWins(localOp, remoteOp)
      case "merge":
        return this.resolveMerge(localOp, remoteOp)
      default:
        return this.resolveLastWriteWins(localOp, remoteOp)
    }
  }

  private static resolveLastWriteWins(localOp: SyncOperation, remoteOp: SyncOperation): ConflictResolution {
    // 使用时间戳作为决胜规则
    const winner = localOp.timestamp >= remoteOp.timestamp ? localOp : remoteOp
    const loser = localOp.timestamp >= remoteOp.timestamp ? remoteOp : localOp

    return {
      strategy: "last-write-wins",
      winner,
      loser,
    }
  }

  private static resolveFirstWriteWins(localOp: SyncOperation, remoteOp: SyncOperation): ConflictResolution {
    // 先写入的胜出
    const winner = localOp.timestamp <= remoteOp.timestamp ? localOp : remoteOp
    const loser = localOp.timestamp <= remoteOp.timestamp ? remoteOp : localOp

    return {
      strategy: "first-write-wins",
      winner,
      loser,
    }
  }

  private static resolveMerge(localOp: SyncOperation, remoteOp: SyncOperation): ConflictResolution {
    // 尝试合并数据（适用于文本等可合并类型）
    const merged = this.mergeData(localOp.data, remoteOp.data)

    return {
      strategy: "merge",
      merged,
    }
  }

  private static mergeData(local: unknown, remote: unknown): unknown {
    // 简单的深合并实现
    if (typeof local === "string" && typeof remote === "string") {
      // 对于文本，可以尝试使用 diff 算法合并
      return remote // 简化处理：返回远程版本
    }

    if (typeof local === "object" && typeof remote === "object" && local !== null && remote !== null) {
      return { ...local, ...remote }
    }

    return remote
  }
}

// =============================================================================
// 离线消息队列
// =============================================================================

export interface QueuedMessage {
  id: string
  message: ChatMessage
  timestamp: number
  retryCount: number
  maxRetries: number
}

export class OfflineMessageQueue {
  private queue: QueuedMessage[] = []
  private maxSize: number
  private storageKey: string

  constructor(sessionId: string, maxSize: number = 1000) {
    this.maxSize = maxSize
    this.storageKey = `opencode_offline_queue_${sessionId}`
    this.loadFromStorage()
  }

  /**
   * 添加消息到队列
   */
  enqueue(message: ChatMessage, maxRetries: number = 3): QueuedMessage {
    const queuedMessage: QueuedMessage = {
      id: this.generateId(),
      message,
      timestamp: Date.now(),
      retryCount: 0,
      maxRetries,
    }

    this.queue.push(queuedMessage)

    // 限制队列大小
    if (this.queue.length > this.maxSize) {
      this.queue = this.queue.slice(-this.maxSize)
    }

    this.saveToStorage()
    return queuedMessage
  }

  /**
   * 从队列取出消息（FIFO）
   */
  dequeue(): QueuedMessage | undefined {
    const message = this.queue.shift()
    this.saveToStorage()
    return message
  }

  /**
   * 查看队列头部消息
   */
  peek(): QueuedMessage | undefined {
    return this.queue[0]
  }

  /**
   * 标记消息重试
   */
  markRetry(id: string): boolean {
    const message = this.queue.find((m) => m.id === id)
    if (!message) return false

    message.retryCount++
    message.timestamp = Date.now()

    if (message.retryCount > message.maxRetries) {
      this.remove(id)
      return false
    }

    this.saveToStorage()
    return true
  }

  /**
   * 从队列移除消息
   */
  remove(id: string): void {
    this.queue = this.queue.filter((m) => m.id !== id)
    this.saveToStorage()
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = []
    this.saveToStorage()
  }

  /**
   * 获取队列大小
   */
  size(): number {
    return this.queue.length
  }

  /**
   * 检查是否为空
   */
  isEmpty(): boolean {
    return this.queue.length === 0
  }

  /**
   * 获取所有消息
   */
  getAll(): QueuedMessage[] {
    return [...this.queue]
  }

  private generateId(): string {
    return `queued_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }

  private saveToStorage(): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(this.storageKey, JSON.stringify(this.queue))
      }
    } catch (error) {
      console.error("[OfflineQueue] Failed to save to storage:", error)
    }
  }

  private loadFromStorage(): void {
    try {
      if (typeof localStorage !== "undefined") {
        const data = localStorage.getItem(this.storageKey)
        if (data) {
          this.queue = JSON.parse(data)
        }
      }
    } catch (error) {
      console.error("[OfflineQueue] Failed to load from storage:", error)
    }
  }
}

// =============================================================================
// 消息去重
// =============================================================================

export class MessageDeduplicator {
  private seenIds: Set<string> = new Set()
  private maxSize: number

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize
  }

  /**
   * 检查消息是否已见过
   */
  hasSeen(messageId: string): boolean {
    return this.seenIds.has(messageId)
  }

  /**
   * 标记消息为已见
   */
  markSeen(messageId: string): void {
    this.seenIds.add(messageId)

    // 限制大小
    if (this.seenIds.size > this.maxSize) {
      const iterator = this.seenIds.values()
      const toDelete = this.seenIds.size - this.maxSize
      for (let i = 0; i < toDelete; i++) {
        const value = iterator.next().value
        this.seenIds.delete(value)
      }
    }
  }

  /**
   * 批量标记已见
   */
  markSeenBatch(messageIds: string[]): void {
    for (const id of messageIds) {
      this.seenIds.add(id)
    }
  }

  /**
   * 清除所有记录
   */
  clear(): void {
    this.seenIds.clear()
  }

  /**
   * 获取已见消息数量
   */
  size(): number {
    return this.seenIds.size
  }
}

// =============================================================================
// 同步管理器
// =============================================================================

export interface SyncState {
  vectorClock: VectorClock
  lastSyncTime: number
  pendingOperations: SyncOperation[]
}

export class SyncManager {
  private userId: string
  private sessionId: string
  private state: SyncState
  private queue: OfflineMessageQueue
  private deduplicator: MessageDeduplicator

  constructor(userId: string, sessionId: string) {
    this.userId = userId
    this.sessionId = sessionId
    this.state = {
      vectorClock: VectorClockUtil.create(userId),
      lastSyncTime: 0,
      pendingOperations: [],
    }
    this.queue = new OfflineMessageQueue(sessionId)
    this.deduplicator = new MessageDeduplicator()
  }

  /**
   * 创建新的同步操作
   */
  createOperation(
    type: SyncOperationType,
    table: SyncOperation["table"],
    recordId: string,
    data?: unknown
  ): SyncOperation {
    // 递增向量时钟
    this.state.vectorClock = VectorClockUtil.increment(this.state.vectorClock, this.userId)

    const operation: SyncOperation = {
      id: this.generateOperationId(),
      type,
      table,
      recordId,
      data,
      vectorClock: { ...this.state.vectorClock },
      timestamp: Date.now(),
      userId: this.userId,
      sessionId: this.sessionId,
    }

    this.state.pendingOperations.push(operation)
    return operation
  }

  /**
   * 应用远程操作
   */
  applyRemoteOperation(operation: SyncOperation): {
    applied: boolean
    conflict?: ConflictResolution
  } {
    // 检查是否已处理过
    if (this.deduplicator.hasSeen(operation.id)) {
      return { applied: false }
    }

    // 检查是否存在冲突
    const localOp = this.state.pendingOperations.find(
      (op) => op.table === operation.table && op.recordId === operation.recordId
    )

    if (localOp) {
      const comparison = VectorClockUtil.compare(localOp.vectorClock, operation.vectorClock)

      // 如果远程操作更旧，忽略
      if (comparison > 0) {
        this.deduplicator.markSeen(operation.id)
        return { applied: false }
      }

      // 如果并发，需要解决冲突
      if (comparison === 0) {
        const resolution = ConflictResolver.resolve(localOp, operation, "last-write-wins")
        this.deduplicator.markSeen(operation.id)

        // 更新向量时钟
        this.state.vectorClock = VectorClockUtil.merge(
          this.state.vectorClock,
          operation.vectorClock
        )

        return { applied: true, conflict: resolution }
      }
    }

    // 应用操作
    this.deduplicator.markSeen(operation.id)
    this.state.vectorClock = VectorClockUtil.merge(
      this.state.vectorClock,
      operation.vectorClock
    )

    // 从待处理中移除已完成的操作
    this.state.pendingOperations = this.state.pendingOperations.filter(
      (op) => !(op.table === operation.table && op.recordId === operation.recordId)
    )

    return { applied: true }
  }

  /**
   * 获取待同步的操作
   */
  getPendingOperations(): SyncOperation[] {
    return [...this.state.pendingOperations]
  }

  /**
   * 清除已完成的操作
   */
  clearCompletedOperation(operationId: string): void {
    this.state.pendingOperations = this.state.pendingOperations.filter(
      (op) => op.id !== operationId
    )
  }

  /**
   * 更新最后同步时间
   */
  updateLastSyncTime(): void {
    this.state.lastSyncTime = Date.now()
  }

  /**
   * 获取当前向量时钟
   */
  getVectorClock(): VectorClock {
    return { ...this.state.vectorClock }
  }

  /**
   * 获取离线消息队列
   */
  getQueue(): OfflineMessageQueue {
    return this.queue
  }

  /**
   * 获取去重器
   */
  getDeduplicator(): MessageDeduplicator {
    return this.deduplicator
  }

  private generateOperationId(): string {
    return `op_${this.userId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
  }
}

// =============================================================================
// 工具函数
// =============================================================================

/**
 * 检测消息序列中的间隙
 */
export function detectMessageGaps(
  messages: ChatMessage[],
  expectedIds: string[]
): { missing: string[]; unexpected: string[] } {
  const messageIds = new Set(messages.map((m) => m.id))
  const expectedSet = new Set(expectedIds)

  const missing = expectedIds.filter((id) => !messageIds.has(id))
  const unexpected = messages.filter((m) => !expectedSet.has(m.id)).map((m) => m.id)

  return { missing, unexpected }
}

/**
 * 按因果关系排序消息
 */
export function sortMessagesByCausality(messages: Array<{ id: string; vectorClock: VectorClock }>): typeof messages {
  return [...messages].sort((a, b) => {
    const comparison = VectorClockUtil.compare(a.vectorClock, b.vectorClock)
    if (comparison !== 0) return comparison
    // 如果并发，按 ID 排序以确保一致性
    return a.id.localeCompare(b.id)
  })
}

/**
 * 计算同步差异
 */
export function calculateSyncDiff(
  localClock: VectorClock,
  remoteClock: VectorClock
): {
  localAhead: string[]
  remoteAhead: string[]
  diverged: string[]
} {
  const allKeys = new Set([...Object.keys(localClock), ...Object.keys(remoteClock)])
  const localAhead: string[] = []
  const remoteAhead: string[] = []
  const diverged: string[] = []

  for (const key of allKeys) {
    const localVal = localClock[key] || 0
    const remoteVal = remoteClock[key] || 0

    if (localVal > remoteVal) {
      localAhead.push(key)
    } else if (remoteVal > localVal) {
      remoteAhead.push(key)
    }

    if (localVal !== remoteVal) {
      diverged.push(key)
    }
  }

  return { localAhead, remoteAhead, diverged }
}
