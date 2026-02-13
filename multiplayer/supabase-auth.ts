/**
 * Supabase Auth Integration
 * 使用 Supabase 作为用户认证系统
 */

import { createClient, SupabaseClient, User } from "@supabase/supabase-js"

// =============================================================================
// Supabase 配置
// =============================================================================

export interface SupabaseConfig {
  url: string
  publishableKey: string
  serviceRoleKey?: string
}

export function getSupabaseConfig(): SupabaseConfig {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  }
}

// =============================================================================
// Supabase 客户端
// =============================================================================

let supabaseClient: SupabaseClient | null = null
let serviceRoleClient: SupabaseClient | null = null

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const config = getSupabaseConfig()
    if (!config.url || !config.publishableKey) {
      throw new Error("Supabase URL and Publishable Key are required")
    }
    supabaseClient = createClient(config.url, config.publishableKey)
  }
  return supabaseClient
}

export function getServiceRoleClient(): SupabaseClient {
  if (!serviceRoleClient) {
    const config = getSupabaseConfig()
    if (!config.url || !config.serviceRoleKey) {
      throw new Error("Supabase URL and Service Role Key are required for admin operations")
    }
    serviceRoleClient = createClient(config.url, config.serviceRoleKey)
  }
  return serviceRoleClient
}

// =============================================================================
// 用户认证
// =============================================================================

export interface AuthResult {
  success: boolean
  user?: {
    id: string
    email: string
    name: string
    role: string
    avatar?: string
  }
  error?: string
}

/**
 * 验证 JWT Token
 */
export async function verifyToken(token: string): Promise<AuthResult> {
  try {
    const supabase = getSupabaseClient()
    const { data: { user }, error } = await supabase.auth.getUser(token)

    if (error || !user) {
      return { success: false, error: error?.message || "Invalid token" }
    }

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email || "",
        name: user.user_metadata?.name || user.email?.split("@")[0] || "Anonymous",
        role: user.user_metadata?.role || "member",
        avatar: user.user_metadata?.avatar_url,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Authentication failed",
    }
  }
}

/**
 * 通过邮箱和密码登录
 */
export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error || !data.user) {
      return { success: false, error: error?.message || "Login failed" }
    }

    return {
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email || "",
        name: data.user.user_metadata?.name || data.user.email?.split("@")[0] || "Anonymous",
        role: data.user.user_metadata?.role || "member",
        avatar: data.user.user_metadata?.avatar_url,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Login failed",
    }
  }
}

/**
 * 注册新用户
 */
export async function signUp(email: string, password: string, name: string): Promise<AuthResult> {
  try {
    const supabase = getSupabaseClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          role: "member",
        },
      },
    })

    if (error || !data.user) {
      return { success: false, error: error?.message || "Signup failed" }
    }

    return {
      success: true,
      user: {
        id: data.user.id,
        email: data.user.email || "",
        name: data.user.user_metadata?.name || name,
        role: "member",
        avatar: data.user.user_metadata?.avatar_url,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Signup failed",
    }
  }
}

/**
 * 登出
 */
export async function signOut(): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseClient()
    const { error } = await supabase.auth.signOut()

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Logout failed",
    }
  }
}

/**
 * 获取当前用户
 */
export async function getCurrentUser(): Promise<AuthResult> {
  try {
    const supabase = getSupabaseClient()
    const { data: { user }, error } = await supabase.auth.getUser()

    if (error || !user) {
      return { success: false, error: error?.message || "Not authenticated" }
    }

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email || "",
        name: user.user_metadata?.name || user.email?.split("@")[0] || "Anonymous",
        role: user.user_metadata?.role || "member",
        avatar: user.user_metadata?.avatar_url,
      },
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get user",
    }
  }
}

// =============================================================================
// 用户管理（需要 Service Role Key）
// =============================================================================

export interface UserInfo {
  id: string
  email: string
  name: string
  role: string
  avatar?: string
  created_at: string
  last_sign_in_at?: string
}

/**
 * 获取所有用户（管理员功能）
 */
export async function getAllUsers(): Promise<{ success: boolean; users?: UserInfo[]; error?: string }> {
  try {
    const supabase = getServiceRoleClient()
    const { data, error } = await supabase.auth.admin.listUsers()

    if (error) {
      return { success: false, error: error.message }
    }

    const users: UserInfo[] = data.users.map((user) => ({
      id: user.id,
      email: user.email || "",
      name: user.user_metadata?.name || user.email?.split("@")[0] || "Anonymous",
      role: user.user_metadata?.role || "member",
      avatar: user.user_metadata?.avatar_url,
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
    }))

    return { success: true, users }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to get users",
    }
  }
}

/**
 * 更新用户角色（管理员功能）
 */
export async function updateUserRole(userId: string, role: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getServiceRoleClient()
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { role },
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update role",
    }
  }
}

/**
 * 删除用户（管理员功能）
 */
export async function deleteUser(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getServiceRoleClient()
    const { error } = await supabase.auth.admin.deleteUser(userId)

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete user",
    }
  }
}

// =============================================================================
// WebSocket 集成
// =============================================================================

export interface WebSocketAuthData {
  token: string
  sessionId: string
  userId?: string
  userName?: string
  userRole?: string
}

/**
 * 验证 WebSocket 连接
 */
export async function authenticateWebSocket(data: WebSocketAuthData): Promise<AuthResult> {
  // 验证 JWT Token
  const result = await verifyToken(data.token)

  if (!result.success) {
    return result
  }

  // 可以在这里添加额外的验证逻辑
  // 例如：检查用户是否被允许加入特定会话

  return result
}
