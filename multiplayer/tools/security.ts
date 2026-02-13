/**
 * Security Policy
 * 安全策略模块
 *
 * 提供命令白名单、路径限制和危险操作拦截
 */

// =============================================================================
// 安全配置
// =============================================================================

export interface SecurityConfig {
  /** 允许执行的命令白名单 */
  allowedCommands: string[]
  /** 禁止执行的命令黑名单 */
  blockedCommands: string[]
  /** 允许访问的基础路径 */
  allowedBasePaths: string[]
  /** 禁止访问的路径模式 */
  blockedPathPatterns: RegExp[]
  /** 是否启用路径检查 */
  enablePathCheck: boolean
  /** 是否启用命令检查 */
  enableCommandCheck: boolean
  /** 最大文件大小 (字节) */
  maxFileSize: number
  /** 命令执行超时 (毫秒) */
  commandTimeout: number
  /** 是否允许写入操作 */
  allowWrite: boolean
  /** 是否允许删除操作 */
  allowDelete: boolean
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  allowedCommands: [
    // 文件操作
    "ls", "cat", "head", "tail", "grep", "find", "pwd", "cd", "echo",
    // Windows equivalents
    "dir", "type", "cd", "echo",
    // 代码工具
    "node", "bun", "npm", "npx", "git",
    // 系统信息
    "uname", "df", "du", "ps", "top", "which", "where",
    // Windows system
    "systeminfo", "tasklist", "ver",
  ],
  blockedCommands: [
    // 危险命令
    "rm", "mv", "cp", "dd", "mkfs", "fdisk", "mount", "umount",
    "chmod", "chown", "sudo", "su", "passwd", "shutdown", "reboot",
    "halt", "poweroff", "init", "systemctl", "service",
    // Windows危险
    "format", "diskpart", "reg", "sc", "net", "shutdown", "del", "erase", "rd", "rmdir",
    // 网络危险
    "curl", "wget", "nc", "netcat", "telnet", "ssh", "scp", "sftp",
    // 其他危险
    "eval", "exec", "source", ".", "bash", "sh", "zsh", "powershell", "cmd",
  ],
  allowedBasePaths: [
    process.cwd(),
    "/tmp",
    "/var/tmp",
  ],
  blockedPathPatterns: [
    /\/etc\/passwd/,
    /\/etc\/shadow/,
    /\/etc\/sudoers/,
    /\.ssh\//,
    /\.gnupg\//,
    /node_modules/,
    /\.\.\//,
  ],
  enablePathCheck: true,
  enableCommandCheck: true,
  maxFileSize: 10 * 1024 * 1024, // 10MB
  commandTimeout: 30000, // 30秒
  allowWrite: true,
  allowDelete: false,
}

// =============================================================================
// 安全策略类
// =============================================================================

export class SecurityPolicy {
  private config: SecurityConfig

  constructor(config: Partial<SecurityConfig> = {}) {
    this.config = { ...DEFAULT_SECURITY_CONFIG, ...config }
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取当前配置
   */
  getConfig(): SecurityConfig {
    return { ...this.config }
  }

  /**
   * 检查命令是否允许执行
   */
  validateCommand(command: string): { allowed: boolean; reason?: string } {
    if (!this.config.enableCommandCheck) {
      return { allowed: true }
    }

    // 提取命令名（去除参数）
    const cmdName = command.trim().split(/\s+/)[0].toLowerCase()

    // 检查黑名单
    if (this.config.blockedCommands.includes(cmdName)) {
      return {
        allowed: false,
        reason: `Command '${cmdName}' is in the blocked list`,
      }
    }

    // 检查白名单
    if (
      this.config.allowedCommands.length > 0 &&
      !this.config.allowedCommands.includes(cmdName)
    ) {
      return {
        allowed: false,
        reason: `Command '${cmdName}' is not in the allowed list`,
      }
    }

    // 检查危险字符
    const dangerousPatterns = [
      /[;&|]\s*rm/,
      /`.*`/,
      /\$\(.*\)/,
      />.*\/etc\//,
      />.*\/usr\//,
      />.*\/bin\//,
      />.*\/sbin\//,
    ]

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return {
          allowed: false,
          reason: "Command contains dangerous patterns",
        }
      }
    }

    return { allowed: true }
  }

  /**
   * 检查路径是否允许访问
   */
  validatePath(filePath: string): { allowed: boolean; reason?: string } {
    if (!this.config.enablePathCheck) {
      return { allowed: true }
    }

    // 规范化路径
    const normalizedPath = this.normalizePath(filePath)

    // 检查禁止的模式
    for (const pattern of this.config.blockedPathPatterns) {
      if (pattern.test(normalizedPath)) {
        return {
          allowed: false,
          reason: `Path matches blocked pattern`,
        }
      }
    }

    // 检查是否在允许的基础路径下
    const isUnderAllowedPath = this.config.allowedBasePaths.some((basePath) => {
      const normalizedBase = this.normalizePath(basePath)
      return normalizedPath.startsWith(normalizedBase) || normalizedPath.includes(normalizedBase.replace(/\//g, '\\'))
    })

    if (!isUnderAllowedPath) {
      return {
        allowed: false,
        reason: `Path is not under allowed base paths`,
      }
    }

    return { allowed: true }
  }

  /**
   * 检查文件大小是否允许
   */
  validateFileSize(size: number): { allowed: boolean; reason?: string } {
    if (size > this.config.maxFileSize) {
      return {
        allowed: false,
        reason: `File size ${size} exceeds maximum allowed ${this.config.maxFileSize}`,
      }
    }
    return { allowed: true }
  }

  /**
   * 检查是否允许写入操作
   */
  validateWriteOperation(): { allowed: boolean; reason?: string } {
    if (!this.config.allowWrite) {
      return {
        allowed: false,
        reason: "Write operations are disabled",
      }
    }
    return { allowed: true }
  }

  /**
   * 检查是否允许删除操作
   */
  validateDeleteOperation(): { allowed: boolean; reason?: string } {
    if (!this.config.allowDelete) {
      return {
        allowed: false,
        reason: "Delete operations are disabled",
      }
    }
    return { allowed: true }
  }

  /**
   * 清理命令参数，防止注入
   */
  sanitizeCommand(command: string): string {
    // 移除控制字符
    let sanitized = command.replace(/[\x00-\x1F\x7F]/g, "")

    // 限制长度
    const maxLength = 1000
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength)
    }

    return sanitized.trim()
  }

  /**
   * 规范化路径
   */
  private normalizePath(filePath: string): string {
    // 解析相对路径
    if (!filePath.startsWith("/") && !filePath.match(/^[A-Za-z]:/)) {
      filePath = `${process.cwd()}/${filePath}`
    }

    // 简化路径（处理 . 和 ..）
    const parts = filePath.split(/[\\/]/)
    const resolved: string[] = []

    for (const part of parts) {
      if (part === "..") {
        resolved.pop()
      } else if (part !== "." && part !== "") {
        resolved.push(part)
      }
    }

    return resolved.join("/")
  }

  /**
   * 添加允许的基础路径
   */
  addAllowedBasePath(path: string): void {
    const normalized = this.normalizePath(path)
    if (!this.config.allowedBasePaths.includes(normalized)) {
      this.config.allowedBasePaths.push(normalized)
    }
  }

  /**
   * 添加允许的命令
   */
  addAllowedCommand(command: string): void {
    const cmdName = command.toLowerCase()
    if (!this.config.allowedCommands.includes(cmdName)) {
      this.config.allowedCommands.push(cmdName)
    }
  }
}

// =============================================================================
// 安全错误类
// =============================================================================

export class SecurityError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = "SecurityError"
  }
}

// =============================================================================
// 工具函数
// =============================================================================

export function createSecurityPolicy(
  config?: Partial<SecurityConfig>
): SecurityPolicy {
  return new SecurityPolicy(config)
}

export function isSecurityError(error: unknown): error is SecurityError {
  return error instanceof SecurityError
}
