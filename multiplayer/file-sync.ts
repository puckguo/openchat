/**
 * File Synchronization Module
 * 文件同步模块
 *
 * 实现文件变更的实时通知和同步
 */

import type { SharedWorkspace, FileChangeEvent, FileConflict } from "../tool/workspace"
import type { MultiplayerWebSocketClient } from "./websocket-client"
import type { MultiplayerWebSocketServer } from "./websocket-server"

// =============================================================================
// 类型定义
// =============================================================================

/** 文件同步消息类型 */
export type FileSyncMessageType =
  | "file:change"
  | "file:lock"
  | "file:unlock"
  | "file:request"
  | "file:response"
  | "file:conflict"
  | "file:resolve"
  | "file:subscribe"
  | "file:unsubscribe"

/** 文件同步消息 */
export interface FileSyncMessage {
  type: FileSyncMessageType
  workspaceId: string
  sessionId: string
  userId: string
  timestamp: number
  payload: FileChangeEvent | FileLockPayload | FileUnlockPayload | FileRequestPayload | FileResponsePayload | FileConflictPayload | FileResolvePayload | FileSubscribePayload
}

/** 文件锁定消息载荷 */
export interface FileLockPayload {
  path: string
  lockedBy: string
  duration: number
}

/** 文件解锁消息载荷 */
export interface FileUnlockPayload {
  path: string
  unlockedBy: string
}

/** 文件请求载荷 */
export interface FileRequestPayload {
  path: string
  requestId: string
  version?: number
}

/** 文件响应载荷 */
export interface FileResponsePayload {
  path: string
  requestId: string
  content?: string // base64
  metadata?: FileMetadataPayload
  error?: string
}

/** 文件元数据载荷 */
export interface FileMetadataPayload {
  path: string
  size: number
  mtime: number
  hash: string
  version: number
  lastModifiedBy: string
}

/** 文件冲突载荷 */
export interface FileConflictPayload {
  path: string
  localVersion: FileMetadataPayload
  remoteVersion: FileMetadataPayload
  conflictType: "content" | "delete" | "permission"
}

/** 文件冲突解决载荷 */
export interface FileResolvePayload {
  path: string
  resolution: "local" | "remote" | "merge"
  mergedContent?: string
}

/** 文件订阅载荷 */
export interface FileSubscribePayload {
  paths: string[] // 空数组表示订阅所有
  workspaceId: string
}

/** 同步状态 */
export interface FileSyncState {
  workspaceId: string
  isSubscribed: boolean
  subscribedPaths: Set<string>
  pendingChanges: FileChangeEvent[]
  syncQueue: FileSyncMessage[]
  lastSyncTime: number
  isSyncing: boolean
}

/** 文件同步选项 */
export interface FileSyncOptions {
  /** 是否自动订阅 */
  autoSubscribe: boolean
  /** 同步间隔（毫秒） */
  syncInterval: number
  /** 最大重试次数 */
  maxRetries: number
  /** 重试间隔（毫秒） */
  retryInterval: number
  /** 是否自动解决冲突 */
  autoResolveConflicts: boolean
  /** 冲突解决策略 */
  conflictStrategy: "local" | "remote" | "merge"
}

// =============================================================================
// 文件同步管理器（客户端）
// =============================================================================

export class FileSyncManager {
  private client: MultiplayerWebSocketClient
  private workspaces: Map<string, SharedWorkspace> = new Map()
  private syncStates: Map<string, FileSyncState> = new Map()
  private options: FileSyncOptions
  private syncIntervals: Map<string, NodeJS.Timeout> = new Map()
  private messageHandlers: Map<FileSyncMessageType, (msg: FileSyncMessage) => void> = new Map()
  private changeCallbacks: Set<(event: FileChangeEvent) => void> = new Set()
  private conflictCallbacks: Set<(conflict: FileConflictPayload) => void> = new Set()

  constructor(client: MultiplayerWebSocketClient, options?: Partial<FileSyncOptions>) {
    this.client = client
    this.options = {
      autoSubscribe: true,
      syncInterval: 5000,
      maxRetries: 3,
      retryInterval: 1000,
      autoResolveConflicts: false,
      conflictStrategy: "remote",
      ...options,
    }

    this.setupMessageHandlers()
  }

  // ===========================================================================
  // 初始化与清理
  // ===========================================================================

  /**
   * 注册工作区
   */
  registerWorkspace(workspace: SharedWorkspace): void {
    const workspaceId = workspace.getConfig().id
    this.workspaces.set(workspaceId, workspace)

    // 初始化同步状态
    const syncState: FileSyncState = {
      workspaceId,
      isSubscribed: false,
      subscribedPaths: new Set(),
      pendingChanges: [],
      syncQueue: [],
      lastSyncTime: 0,
      isSyncing: false,
    }
    this.syncStates.set(workspaceId, syncState)

    // 监听本地文件变更
    workspace.onChange((event) => {
      this.handleLocalChange(workspaceId, event)
    })

    // 自动订阅
    if (this.options.autoSubscribe && this.client.getState().status.state === "connected") {
      this.subscribe(workspaceId)
    }

    // 启动同步循环
    this.startSyncLoop(workspaceId)
  }

  /**
   * 取消注册工作区
   */
  unregisterWorkspace(workspaceId: string): void {
    this.stopSyncLoop(workspaceId)
    this.unsubscribe(workspaceId)
    this.workspaces.delete(workspaceId)
    this.syncStates.delete(workspaceId)
  }

  /**
   * 清理所有资源
   */
  dispose(): void {
    for (const workspaceId of this.syncStates.keys()) {
      this.stopSyncLoop(workspaceId)
    }
    this.syncIntervals.clear()
    this.workspaces.clear()
    this.syncStates.clear()
    this.changeCallbacks.clear()
    this.conflictCallbacks.clear()
  }

  // ===========================================================================
  // 订阅管理
  // ===========================================================================

  /**
   * 订阅工作区文件变更
   */
  subscribe(workspaceId: string, paths?: string[]): void {
    const state = this.syncStates.get(workspaceId)
    if (!state) return

    const payload: FileSubscribePayload = {
      paths: paths || [],
      workspaceId,
    }

    this.sendMessage("file:subscribe", workspaceId, payload)
    state.isSubscribed = true
    if (paths) {
      paths.forEach((p) => state.subscribedPaths.add(p))
    }
  }

  /**
   * 取消订阅
   */
  unsubscribe(workspaceId: string): void {
    const state = this.syncStates.get(workspaceId)
    if (!state) return

    this.sendMessage("file:unsubscribe", workspaceId, {
      paths: Array.from(state.subscribedPaths),
      workspaceId,
    })

    state.isSubscribed = false
    state.subscribedPaths.clear()
  }

  // ===========================================================================
  // 文件操作
  // ===========================================================================

  /**
   * 锁定文件
   */
  async lockFile(workspaceId: string, filePath: string, duration?: number): Promise<boolean> {
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) return false

    const userId = this.client.getState().userId
    if (!userId) return false

    // 本地锁定
    const locked = workspace.lockFile(filePath, userId, duration)
    if (!locked) return false

    // 广播锁定
    this.sendMessage("file:lock", workspaceId, {
      path: filePath,
      lockedBy: userId,
      duration: duration || 300000,
    })

    return true
  }

  /**
   * 解锁文件
   */
  async unlockFile(workspaceId: string, filePath: string): Promise<boolean> {
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) return false

    const userId = this.client.getState().userId
    if (!userId) return false

    // 本地解锁
    const unlocked = workspace.unlockFile(filePath, userId)
    if (!unlocked) return false

    // 广播解锁
    this.sendMessage("file:unlock", workspaceId, {
      path: filePath,
      unlockedBy: userId,
    })

    return true
  }

  /**
   * 请求文件内容
   */
  async requestFile(workspaceId: string, filePath: string): Promise<string | null> {
    return new Promise((resolve) => {
      const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

      // 设置一次性处理器
      const handler = (msg: FileSyncMessage) => {
        const payload = msg.payload as FileResponsePayload
        if (payload.requestId === requestId) {
          this.messageHandlers.delete("file:response")
          if (payload.error) {
            console.error(`Failed to get file: ${payload.error}`)
            resolve(null)
          } else {
            resolve(payload.content || null)
          }
        }
      }

      this.messageHandlers.set("file:response", handler)

      // 发送请求
      this.sendMessage("file:request", workspaceId, {
        path: filePath,
        requestId,
      })

      // 超时处理
      setTimeout(() => {
        this.messageHandlers.delete("file:response")
        resolve(null)
      }, 10000)
    })
  }

  /**
   * 解决冲突
   */
  async resolveConflict(
    workspaceId: string,
    filePath: string,
    resolution: "local" | "remote" | "merge",
    mergedContent?: string
  ): Promise<void> {
    const workspace = this.workspaces.get(workspaceId)
    if (!workspace) return

    // 本地解决
    workspace.resolveConflict(filePath, resolution, mergedContent)

    // 广播解决
    this.sendMessage("file:resolve", workspaceId, {
      path: filePath,
      resolution,
      mergedContent,
    })
  }

  // ===========================================================================
  // 同步逻辑
  // ===========================================================================

  private handleLocalChange(workspaceId: string, event: FileChangeEvent): void {
    const state = this.syncStates.get(workspaceId)
    if (!state) return

    // 添加到待同步队列
    state.pendingChanges.push(event)

    // 立即通知（如果是删除或创建）
    if (event.operation === "create" || event.operation === "delete") {
      this.broadcastChange(workspaceId, event)
    }
  }

  private async broadcastChange(workspaceId: string, event: FileChangeEvent): Promise<void> {
    if (this.client.getState().status.state !== "connected") {
      return // 离线时只保存在本地队列
    }

    this.sendMessage("file:change", workspaceId, event)

    // 通知本地监听器
    this.notifyChangeListeners(event)
  }

  private async handleRemoteChange(message: FileSyncMessage): Promise<void> {
    const event = message.payload as FileChangeEvent
    const workspace = this.workspaces.get(message.workspaceId)
    if (!workspace) return

    // 应用远程变更
    const success = await workspace.applyRemoteChange(event)

    if (!success) {
      // 检测到冲突
      const state = workspace.getState()
      const conflicts = state.conflicts
      const latestConflict = conflicts[conflicts.length - 1]

      if (latestConflict) {
        const conflictPayload: FileConflictPayload = {
          path: latestConflict.path,
          localVersion: {
            path: latestConflict.localVersion.path,
            size: latestConflict.localVersion.size,
            mtime: latestConflict.localVersion.mtime,
            hash: latestConflict.localVersion.hash,
            version: latestConflict.localVersion.version,
            lastModifiedBy: latestConflict.localVersion.lastModifiedBy,
          },
          remoteVersion: {
            path: latestConflict.remoteVersion.path,
            size: latestConflict.remoteVersion.size,
            mtime: latestConflict.remoteVersion.mtime,
            hash: latestConflict.remoteVersion.hash,
            version: latestConflict.remoteVersion.version,
            lastModifiedBy: latestConflict.remoteVersion.lastModifiedBy,
          },
          conflictType: latestConflict.type,
        }

        this.notifyConflictListeners(conflictPayload)

        // 自动解决冲突
        if (this.options.autoResolveConflicts) {
          await this.resolveConflict(
            message.workspaceId,
            latestConflict.path,
            this.options.conflictStrategy
          )
        }
      }
    }

    // 通知本地监听器
    this.notifyChangeListeners(event)
  }

  // ===========================================================================
  // 同步循环
  // ===========================================================================

  private startSyncLoop(workspaceId: string): void {
    if (this.syncIntervals.has(workspaceId)) return

    const intervalId = setInterval(() => {
      this.performSync(workspaceId)
    }, this.options.syncInterval)

    this.syncIntervals.set(workspaceId, intervalId)
  }

  private stopSyncLoop(workspaceId: string): void {
    const intervalId = this.syncIntervals.get(workspaceId)
    if (intervalId) {
      clearInterval(intervalId)
      this.syncIntervals.delete(workspaceId)
    }
  }

  private async performSync(workspaceId: string): Promise<void> {
    const state = this.syncStates.get(workspaceId)
    const workspace = this.workspaces.get(workspaceId)

    if (!state || !workspace || state.isSyncing) return
    if (this.client.getState().status.state !== "connected") return

    state.isSyncing = true

    try {
      // 同步待处理的变更
      const changes = [...state.pendingChanges]
      state.pendingChanges = []

      for (const change of changes) {
        await this.broadcastChange(workspaceId, change)
      }

      state.lastSyncTime = Date.now()
    } finally {
      state.isSyncing = false
    }
  }

  // ===========================================================================
  // 消息处理
  // ===========================================================================

  private setupMessageHandlers(): void {
    // 文件变更
    this.messageHandlers.set("file:change", (msg) => {
      this.handleRemoteChange(msg)
    })

    // 文件锁定
    this.messageHandlers.set("file:lock", (msg) => {
      const payload = msg.payload as FileLockPayload
      const workspace = this.workspaces.get(msg.workspaceId)
      if (workspace && payload.lockedBy !== this.client.getState().userId) {
        // 远程锁定
        workspace.lockFile(payload.path, payload.lockedBy, payload.duration)
      }
    })

    // 文件解锁
    this.messageHandlers.set("file:unlock", (msg) => {
      const payload = msg.payload as FileUnlockPayload
      const workspace = this.workspaces.get(msg.workspaceId)
      if (workspace && payload.unlockedBy !== this.client.getState().userId) {
        // 远程解锁
        workspace.unlockFile(payload.path, payload.unlockedBy)
      }
    })

    // 文件请求
    this.messageHandlers.set("file:request", async (msg) => {
      const payload = msg.payload as FileRequestPayload
      const workspace = this.workspaces.get(msg.workspaceId)
      if (!workspace) return

      try {
        // 读取文件内容
        const { content, metadata } = await workspace.readFile(
          payload.path,
          msg.userId,
          "guest" // 默认角色
        )

        // 发送响应
        this.sendMessage("file:response", msg.workspaceId, {
          path: payload.path,
          requestId: payload.requestId,
          content: content.toString("base64"),
          metadata: {
            path: metadata.path,
            size: metadata.size,
            mtime: metadata.mtime,
            hash: metadata.hash,
            version: metadata.version,
            lastModifiedBy: metadata.lastModifiedBy,
          },
        })
      } catch (error) {
        // 发送错误响应
        this.sendMessage("file:response", msg.workspaceId, {
          path: payload.path,
          requestId: payload.requestId,
          error: error instanceof Error ? error.message : "Unknown error",
        })
      }
    })

    // 冲突通知
    this.messageHandlers.set("file:conflict", (msg) => {
      const payload = msg.payload as FileConflictPayload
      this.notifyConflictListeners(payload)
    })
  }

  /**
   * 处理收到的消息
   */
  handleMessage(message: FileSyncMessage): void {
    const handler = this.messageHandlers.get(message.type)
    if (handler) {
      handler(message)
    }
  }

  private sendMessage(
    type: FileSyncMessageType,
    workspaceId: string,
    payload: FileSyncMessage["payload"]
  ): void {
    const message: FileSyncMessage = {
      type,
      workspaceId,
      sessionId: this.client.getState().sessionId || "",
      userId: this.client.getState().userId || "",
      timestamp: Date.now(),
      payload,
    }

    // 通过 WebSocket 发送
    // 注意：实际发送逻辑依赖于 WebSocket 客户端的实现
    // 这里假设客户端有 send 方法
    ;(this.client as any).send?.(message)
  }

  // ===========================================================================
  // 事件监听
  // ===========================================================================

  /**
   * 监听文件变更
   */
  onChange(callback: (event: FileChangeEvent) => void): () => void {
    this.changeCallbacks.add(callback)
    return () => this.changeCallbacks.delete(callback)
  }

  /**
   * 监听冲突
   */
  onConflict(callback: (conflict: FileConflictPayload) => void): () => void {
    this.conflictCallbacks.add(callback)
    return () => this.conflictCallbacks.delete(callback)
  }

  private notifyChangeListeners(event: FileChangeEvent): void {
    for (const callback of this.changeCallbacks) {
      try {
        callback(event)
      } catch (error) {
        console.error("Error in change callback:", error)
      }
    }
  }

  private notifyConflictListeners(conflict: FileConflictPayload): void {
    for (const callback of this.conflictCallbacks) {
      try {
        callback(conflict)
      } catch (error) {
        console.error("Error in conflict callback:", error)
      }
    }
  }

  // ===========================================================================
  // 公共 API
  // ===========================================================================

  /**
   * 获取同步状态
   */
  getSyncState(workspaceId: string): FileSyncState | undefined {
    return this.syncStates.get(workspaceId)
  }

  /**
   * 获取所有同步状态
   */
  getAllSyncStates(): FileSyncState[] {
    return Array.from(this.syncStates.values())
  }

  /**
   * 强制同步
   */
  async forceSync(workspaceId: string): Promise<void> {
    await this.performSync(workspaceId)
  }

  /**
   * 检查是否有未同步的变更
   */
  hasPendingChanges(workspaceId: string): boolean {
    const state = this.syncStates.get(workspaceId)
    return state ? state.pendingChanges.length > 0 : false
  }

  /**
   * 获取待同步变更数
   */
  getPendingChangeCount(workspaceId: string): number {
    const state = this.syncStates.get(workspaceId)
    return state ? state.pendingChanges.length : 0
  }
}

// =============================================================================
// 文件同步服务器（WebSocket 服务器端）
// =============================================================================

export class FileSyncServer {
  private server: MultiplayerWebSocketServer
  private workspaces: Map<string, SharedWorkspace> = new Map()
  private subscriptions: Map<string, Set<string>> = new Map() // sessionId -> workspaceIds

  constructor(server: MultiplayerWebSocketServer) {
    this.server = server
  }

  /**
   * 注册工作区
   */
  registerWorkspace(workspace: SharedWorkspace): void {
    this.workspaces.set(workspace.getConfig().id, workspace)

    // 监听本地变更并广播
    workspace.onChange((event) => {
      this.broadcastChange(workspace.getConfig().id, event)
    })
  }

  /**
   * 处理客户端消息
   */
  handleMessage(sessionId: string, message: FileSyncMessage): void {
    switch (message.type) {
      case "file:subscribe":
        this.handleSubscribe(sessionId, message.payload as FileSubscribePayload)
        break
      case "file:unsubscribe":
        this.handleUnsubscribe(sessionId, message.payload as FileSubscribePayload)
        break
      case "file:change":
        this.handleFileChange(sessionId, message)
        break
      case "file:lock":
      case "file:unlock":
        this.handleLockMessage(sessionId, message)
        break
      case "file:request":
        this.handleFileRequest(sessionId, message)
        break
      case "file:resolve":
        this.handleConflictResolve(sessionId, message)
        break
    }
  }

  private handleSubscribe(sessionId: string, payload: FileSubscribePayload): void {
    let subscribedWorkspaces = this.subscriptions.get(sessionId)
    if (!subscribedWorkspaces) {
      subscribedWorkspaces = new Set()
      this.subscriptions.set(sessionId, subscribedWorkspaces)
    }
    subscribedWorkspaces.add(payload.workspaceId)
  }

  private handleUnsubscribe(sessionId: string, payload: FileSubscribePayload): void {
    const subscribedWorkspaces = this.subscriptions.get(sessionId)
    if (subscribedWorkspaces) {
      subscribedWorkspaces.delete(payload.workspaceId)
    }
  }

  private handleFileChange(sessionId: string, message: FileSyncMessage): void {
    // 广播给其他订阅者
    this.broadcastToWorkspace(
      message.workspaceId,
      message,
      sessionId // 排除发送者
    )
  }

  private handleLockMessage(sessionId: string, message: FileSyncMessage): void {
    // 广播锁定/解锁消息给其他用户
    this.broadcastToWorkspace(message.workspaceId, message, sessionId)
  }

  private async handleFileRequest(sessionId: string, message: FileSyncMessage): Promise<void> {
    // 转发请求给工作区所有者或其他客户端
    // 这里简化处理，实际可能需要更复杂的逻辑
    this.broadcastToWorkspace(message.workspaceId, message, sessionId)
  }

  private handleConflictResolve(sessionId: string, message: FileSyncMessage): void {
    // 广播冲突解决给其他用户
    this.broadcastToWorkspace(message.workspaceId, message, sessionId)
  }

  private broadcastChange(workspaceId: string, event: FileChangeEvent): void {
    const message: FileSyncMessage = {
      type: "file:change",
      workspaceId,
      sessionId: "server",
      userId: "system",
      timestamp: Date.now(),
      payload: event,
    }

    this.broadcastToWorkspace(workspaceId, message)
  }

  private broadcastToWorkspace(
    workspaceId: string,
    message: FileSyncMessage,
    excludeSessionId?: string
  ): void {
    for (const [sessionId, subscribedWorkspaces] of this.subscriptions) {
      if (sessionId === excludeSessionId) continue
      if (!subscribedWorkspaces.has(workspaceId)) continue

      // 发送消息到客户端
      // 实际发送逻辑依赖于 WebSocket 服务器的实现
      ;(this.server as any).sendToSession?.(sessionId, message)
    }
  }

  /**
   * 客户端断开连接
   */
  handleDisconnect(sessionId: string): void {
    this.subscriptions.delete(sessionId)
  }

  /**
   * 清理
   */
  dispose(): void {
    this.workspaces.clear()
    this.subscriptions.clear()
  }
}

// =============================================================================
// 导出
// =============================================================================

export default FileSyncManager
