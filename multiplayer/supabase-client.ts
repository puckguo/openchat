/**
 * Supabase Auth WebSocket Client
 * 集成 Supabase 认证的 WebSocket 客户端
 */

import { createClient, SupabaseClient, User } from "@supabase/supabase-js"
import { MultiplayerWebSocketClient } from "./websocket-client"
import type { WebSocketClientConfig, WebSocketClientHandlers } from "./websocket-client"

// =============================================================================
// Supabase 配置
// =============================================================================

export interface SupabaseConfig {
  url: string
  publishableKey: string
}

export function getSupabaseConfig(): SupabaseConfig {
  return {
    url: import.meta.env?.VITE_SUPABASE_URL ||
         process.env.VITE_SUPABASE_URL ||
         process.env.SUPABASE_URL ||
         "",
    publishableKey: import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
                    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
                    process.env.SUPABASE_PUBLISHABLE_KEY ||
                    "",
  }
}

// =============================================================================
// Supabase WebSocket 客户端
// =============================================================================

export class SupabaseWebSocketClient extends MultiplayerWebSocketClient {
  private supabase: SupabaseClient
  private user: User | null = null

  constructor(
    config: WebSocketClientConfig,
    handlers: WebSocketClientHandlers,
    supabaseConfig?: SupabaseConfig
  ) {
    super(config, handlers)

    const config_ = supabaseConfig || getSupabaseConfig()
    if (!config_.url || !config_.publishableKey) {
      throw new Error("Supabase URL and Publishable Key are required")
    }

    this.supabase = createClient(config_.url, config_.publishableKey)
  }

  /**
   * 获取 Supabase 客户端
   */
  getSupabase(): SupabaseClient {
    return this.supabase
  }

  /**
   * 获取当前用户
   */
  getUser(): User | null {
    return this.user
  }

  /**
   * 使用邮箱和密码登录
   */
  async signInWithPassword(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await this.supabase.auth.signInWithPassword({ email, password })

    if (error) {
      return { success: false, error: error.message }
    }

    this.user = data.user
    return { success: true }
  }

  /**
   * 注册新用户
   */
  async signUp(email: string, password: string, name: string): Promise<{ success: boolean; error?: string }> {
    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    })

    if (error) {
      return { success: false, error: error.message }
    }

    this.user = data.user
    return { success: true }
  }

  /**
   * 登出
   */
  async signOut(): Promise<{ success: boolean; error?: string }> {
    const { error } = await this.supabase.auth.signOut()

    if (error) {
      return { success: false, error: error.message }
    }

    this.user = null
    return { success: true }
  }

  /**
   * 连接到 WebSocket 服务器（带认证）
   */
  async connect(
    sessionId: string,
    userId?: string,
    userName?: string,
    userRole?: string
  ): Promise<void> {
    // 获取当前会话
    const { data: { session } } = await this.supabase.auth.getSession()

    if (!session) {
      throw new Error("Not authenticated. Please sign in first.")
    }

    this.user = session.user

    // 使用 Supabase 用户信息
    const name = userName || session.user.user_metadata?.name || session.user.email?.split("@")[0] || "Anonymous"
    const role = userRole || session.user.user_metadata?.role || "member"
    const id = userId || session.user.id

    // 保存配置供后续使用
    this.config.sessionId = sessionId
    this.config.userId = id
    this.config.userName = name
    this.config.userRole = role as any

    // 获取 WebSocket URL 并添加 token
    const wsUrl = new URL(this.config.url)
    wsUrl.searchParams.set("token", session.access_token)
    wsUrl.searchParams.set("session", sessionId)
    wsUrl.searchParams.set("name", name)
    wsUrl.searchParams.set("role", role)

    // 使用 token 连接
    await this.connectWithToken(wsUrl.toString())
  }

  /**
   * 使用 token 连接
   */
  private async connectWithToken(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url)

        this.ws.onopen = () => {
          this.reconnectAttempts = 0
          this.startHeartbeat()
          this.handlers.onConnect?.()
          resolve()
        }

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data)
            this.handleServerMessage(data)
          } catch (error) {
            console.error("[WebSocket] Failed to parse message:", error)
          }
        }

        this.ws.onclose = (event) => {
          this.stopHeartbeat()
          this.handlers.onDisconnect?.(event.reason)

          if (this.config.reconnect && this.reconnectAttempts < (this.config.maxReconnectAttempts || 5)) {
            this.scheduleReconnect()
          }
        }

        this.ws.onerror = (error) => {
          this.handlers.onError?.(new Error("WebSocket error"))
          reject(error)
        }
      } catch (error) {
        reject(error)
      }
    })
  }
}

// =============================================================================
// React/Vue Hook (可选)
// =============================================================================

/**
 * 创建 Supabase WebSocket 客户端 Hook
 *
 * 使用示例 (React):
 * ```tsx
 * function ChatComponent() {
 *   const client = useSupabaseWebSocketClient({
 *     url: "ws://localhost:3001",
 *   }, {
 *     onMessage: (msg) => console.log(msg),
 *   })
 *
 *   const handleLogin = async () => {
 *     const result = await client.signInWithPassword("user@example.com", "password")
 *     if (result.success) {
 *       await client.connect("my-session")
 *     }
 *   }
 *
 *   // ...
 * }
 * ```
 */
export function useSupabaseWebSocketClient(
  config: Omit<WebSocketClientConfig, "sessionId" | "userId" | "userName" | "userRole">,
  handlers: WebSocketClientHandlers,
  supabaseConfig?: SupabaseConfig
): SupabaseWebSocketClient {
  // 注意：这需要在 React/Vue 组件中使用
  // 这里只是类型定义，实际实现取决于框架
  return new SupabaseWebSocketClient(config, handlers, supabaseConfig)
}
