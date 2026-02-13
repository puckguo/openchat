/**
 * Role System
 * 角色权限系统
 *
 * 定义和管理多人协作中的角色与权限
 */

import { z } from "zod"
import type { Participant, UserRole } from "./types"

// =============================================================================
// 角色定义
// =============================================================================

export const ROLES = {
  OWNER: "owner" as const,
  ADMIN: "admin" as const,
  MEMBER: "member" as const,
  GUEST: "guest" as const,
  AI: "ai" as const,
}

/** 角色层级（数字越大权限越高） */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  guest: 0,
  ai: 1,
  member: 2,
  admin: 3,
  owner: 4,
}

/** 角色显示名称 */
export const ROLE_DISPLAY_NAMES: Record<UserRole, string> = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
  guest: "访客",
  ai: "AI 助手",
}

/** 角色图标/标识 */
export const ROLE_ICONS: Record<UserRole, string> = {
  owner: "👑",
  admin: "🛡️",
  member: "👤",
  guest: "👋",
  ai: "🤖",
}

/** 角色密码 - 用于验证创建带密码房间的权限 */
export const ROLE_PASSWORDS: Record<UserRole, string | null> = {
  owner: "123456",
  admin: "794613",
  member: null,
  guest: null,
  ai: null,
}

/**
 * 验证角色密码
 * @param role 要验证的角色
 * @param password 输入的密码
 * @returns 是否验证通过
 */
export function verifyRolePassword(role: UserRole, password: string): boolean {
  const requiredPassword = ROLE_PASSWORDS[role]
  // 如果角色不需要密码，直接通过
  if (!requiredPassword) return true
  // 验证密码
  return password === requiredPassword
}

/**
 * 检查角色是否需要密码验证
 * @param role 要检查的角色
 * @returns 是否需要密码
 */
export function roleRequiresPassword(role: UserRole): boolean {
  return ROLE_PASSWORDS[role] !== null
}

// =============================================================================
// 权限定义
// =============================================================================

export type Permission =
  // 消息权限
  | "message:send"
  | "message:edit_own"
  | "message:edit_any"
  | "message:delete_own"
  | "message:delete_any"
  | "message:react"
  | "message:pin"

  // 用户权限
  | "user:invite"
  | "user:kick"
  | "user:change_role"
  | "user:view_online"

  // AI 权限
  | "ai:trigger"
  | "ai:configure"
  | "ai:view_thinking"

  // 文件权限
  | "file:upload"
  | "file:download"
  | "file:delete"
  | "file:execute"

  // 会话权限
  | "session:rename"
  | "session:delete"
  | "session:settings"
  | "session:view_history"

  // 代码权限
  | "code:read"
  | "code:write"
  | "code:execute"

// =============================================================================
// 角色权限映射
// =============================================================================

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  owner: [
    // 消息
    "message:send",
    "message:edit_own",
    "message:edit_any",
    "message:delete_own",
    "message:delete_any",
    "message:react",
    "message:pin",
    // 用户
    "user:invite",
    "user:kick",
    "user:change_role",
    "user:view_online",
    // AI
    "ai:trigger",
    "ai:configure",
    "ai:view_thinking",
    // 文件
    "file:upload",
    "file:download",
    "file:delete",
    "file:execute",
    // 会话
    "session:rename",
    "session:delete",
    "session:settings",
    "session:view_history",
    // 代码
    "code:read",
    "code:write",
    "code:execute",
  ],
  admin: [
    // 消息
    "message:send",
    "message:edit_own",
    "message:edit_any",
    "message:delete_own",
    "message:delete_any",
    "message:react",
    "message:pin",
    // 用户
    "user:invite",
    "user:kick",
    "user:change_role",
    "user:view_online",
    // AI
    "ai:trigger",
    "ai:configure",
    "ai:view_thinking",
    // 文件
    "file:upload",
    "file:download",
    "file:delete",
    "file:execute",
    // 会话
    "session:rename",
    "session:settings",
    "session:view_history",
    // 代码
    "code:read",
    "code:write",
    "code:execute",
  ],
  member: [
    // 消息
    "message:send",
    "message:edit_own",
    "message:delete_own",
    "message:react",
    // 用户
    "user:view_online",
    // AI
    "ai:trigger",
    "ai:view_thinking",
    // 文件
    "file:upload",
    "file:download",
    "file:execute",
    // 会话
    "session:view_history",
    // 代码
    "code:read",
    "code:write",
    "code:execute",
  ],
  guest: [
    // 消息
    "message:send",
    "message:react",
    // 用户
    "user:view_online",
    // AI
    "ai:trigger",
    "ai:view_thinking",
    // 文件
    "file:download",
    // 会话
    "session:view_history",
    // 代码
    "code:read",
  ],
  ai: [
    // 消息
    "message:send",
    "message:edit_own",
    // 用户
    "user:view_online",
    // AI
    "ai:trigger",
    "ai:view_thinking",
    // 文件
    "file:upload",
    "file:download",
    "file:execute",
    // 会话
    "session:view_history",
    // 代码
    "code:read",
    "code:write",
    "code:execute",
  ],
}

// =============================================================================
// 权限检查函数
// =============================================================================

/**
 * 检查指定角色是否拥有特定权限
 */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false
}

/**
 * 检查角色是否拥有所有指定权限
 */
export function hasAllPermissions(role: UserRole, permissions: Permission[]): boolean {
  const rolePerms = ROLE_PERMISSIONS[role] ?? []
  return permissions.every((p) => rolePerms.includes(p))
}

/**
 * 检查角色是否拥有任意一个指定权限
 */
export function hasAnyPermission(role: UserRole, permissions: Permission[]): boolean {
  const rolePerms = ROLE_PERMISSIONS[role] ?? []
  return permissions.some((p) => rolePerms.includes(p))
}

/**
 * 检查一个角色是否可以管理另一个角色
 * （需要层级高于目标角色）
 */
export function canManageRole(managerRole: UserRole, targetRole: UserRole): boolean {
  // 不能管理相同或更高层级的角色
  return ROLE_HIERARCHY[managerRole] > ROLE_HIERARCHY[targetRole]
}

/**
 * 获取角色的所有权限
 */
export function getRolePermissions(role: UserRole): Permission[] {
  return ROLE_PERMISSIONS[role] ?? []
}

/**
 * 获取用户可分配给别人的角色列表
 * （只能分配层级低于自己的角色）
 */
export function getAssignableRoles(role: UserRole): UserRole[] {
  const allRoles: UserRole[] = ["owner", "admin", "member", "guest", "ai"]
  return allRoles.filter((r) => ROLE_HIERARCHY[r] < ROLE_HIERARCHY[role])
}

// =============================================================================
// 角色操作验证
// =============================================================================

/**
 * 验证是否可以踢出用户
 */
export function canKickUser(
  kickerRole: UserRole,
  targetRole: UserRole,
  kickerId: string,
  targetId: string,
  ownerId: string
): { allowed: boolean; reason?: string } {
  // 不能踢出自己
  if (kickerId === targetId) {
    return { allowed: false, reason: "不能踢出自己" }
  }

  // 不能踢出所有者
  if (targetId === ownerId) {
    return { allowed: false, reason: "不能踢出会话所有者" }
  }

  // 需要足够高的权限
  if (!canManageRole(kickerRole, targetRole)) {
    return {
      allowed: false,
      reason: `权限不足，需要高于 ${ROLE_DISPLAY_NAMES[targetRole]} 的角色`,
    }
  }

  return { allowed: true }
}

/**
 * 验证是否可以更改角色
 */
export function canChangeRole(
  changerRole: UserRole,
  targetCurrentRole: UserRole,
  targetNewRole: UserRole,
  changerId: string,
  targetId: string,
  ownerId: string
): { allowed: boolean; reason?: string } {
  // 不能更改自己的角色
  if (changerId === targetId) {
    return { allowed: false, reason: "不能更改自己的角色" }
  }

  // 不能更改所有者的角色
  if (targetId === ownerId) {
    return { allowed: false, reason: "不能更改会话所有者的角色" }
  }

  // 需要足够高的权限来管理目标用户
  if (!canManageRole(changerRole, targetCurrentRole)) {
    return {
      allowed: false,
      reason: `权限不足，无法管理 ${ROLE_DISPLAY_NAMES[targetCurrentRole]}`,
    }
  }

  // 只能分配给低于自己的角色
  if (ROLE_HIERARCHY[targetNewRole] >= ROLE_HIERARCHY[changerRole]) {
    return {
      allowed: false,
      reason: `无法分配 ${ROLE_DISPLAY_NAMES[targetNewRole]} 角色`,
    }
  }

  return { allowed: true }
}

// =============================================================================
// 角色工具函数
// =============================================================================

/**
 * 创建参与者对象
 */
export function createParticipant(
  id: string,
  name: string,
  role: UserRole = "member",
  options?: {
    avatar?: string
    status?: Participant["status"]
  }
): Participant {
  const now = new Date().toISOString()
  return {
    id,
    name,
    role,
    avatar: options?.avatar,
    status: options?.status ?? "online",
    joinedAt: now,
    lastSeen: now,
  }
}

/**
 * 创建 AI 参与者
 */
export function createAIParticipant(
  agentName: string,
  options?: {
    avatar?: string
    model?: string
  }
): Participant {
  const now = new Date().toISOString()
  return {
    id: `ai_${agentName}`,
    name: agentName,
    role: "ai",
    avatar: options?.avatar ?? "🤖",
    status: "online",
    joinedAt: now,
    lastSeen: now,
    preferences: {
      language: "zh",
      notifications: false,
      aiTriggerMode: "mention",
    },
  }
}

/**
 * 更新参与者状态
 */
export function updateParticipantStatus(
  participant: Participant,
  status: Participant["status"]
): Participant {
  return {
    ...participant,
    status,
    lastSeen: new Date().toISOString(),
  }
}

/**
 * 更新参与者角色
 */
export function updateParticipantRole(
  participant: Participant,
  newRole: UserRole
): Participant {
  return {
    ...participant,
    role: newRole,
    lastSeen: new Date().toISOString(),
  }
}

// =============================================================================
// 角色相关常量导出
// =============================================================================

export const RoleConstants = {
  ROLES,
  ROLE_HIERARCHY,
  ROLE_DISPLAY_NAMES,
  ROLE_ICONS,
  ROLE_PERMISSIONS,
  ROLE_PASSWORDS,
} as const
