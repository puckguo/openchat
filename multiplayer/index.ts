/**
 * Multiplayer Module
 * 多人协作聊天模块
 *
 * 导出所有多人协作相关功能
 */

// 类型定义
export * from "./types"

// 角色系统
export * from "./role"

// 存储层
export * from "./storage"

// WebSocket 服务器
export * from "./websocket-server"

// WebSocket 客户端
export * from "./websocket-client"

// 同步协议
export * from "./sync"

// @提及解析
export * from "./mention"

// AI 触发控制器
export * from "./ai-trigger"

// 语音转录服务
export * from "./transcription"

// 上下文组装
export * from "./context"

// 文件同步
export * from "./file-sync"

/**
 * 模块版本
 */
export const MULTIPLAYER_VERSION = "1.0.0"

/**
 * 模块信息
 */
export const MULTIPLAYER_INFO = {
  name: "opencode-multiplayer",
  version: MULTIPLAYER_VERSION,
  description: "Multiplayer collaborative chat for OpenCode",
} as const
