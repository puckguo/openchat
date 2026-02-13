/**
 * Terminal Tools
 * 终端命令工具
 *
 * 提供安全的命令执行功能
 */

import { spawn } from "child_process"
import { platform } from "os"
import type { Tool, ToolResult } from "./index"
import { createSuccessResult, createErrorResult } from "./index"
import type { SecurityPolicy } from "./security"

// =============================================================================
// 终端工具类
// =============================================================================

export class TerminalTools {
  private security: SecurityPolicy
  private defaultTimeout: number

  constructor(security: SecurityPolicy, defaultTimeout: number = 30000) {
    this.security = security
    this.defaultTimeout = defaultTimeout
  }

  /**
   * 执行命令
   */
  async executeCommand(
    command: string,
    cwd?: string,
    timeout?: number,
    env?: Record<string, string>
  ): Promise<ToolResult> {
    // 清理命令
    const sanitizedCommand = this.security.sanitizeCommand(command)

    // 安全检查
    const securityCheck = this.security.validateCommand(sanitizedCommand)
    if (!securityCheck.allowed) {
      return createErrorResult(
        `Security check failed: ${securityCheck.reason}`
      )
    }

    // 检查工作目录
    if (cwd) {
      const pathCheck = this.security.validatePath(cwd)
      if (!pathCheck.allowed) {
        return createErrorResult(`Invalid working directory: ${pathCheck.reason}`)
      }
    }

    const actualTimeout = timeout || this.defaultTimeout

    try {
      const result = await this.runCommand(
        sanitizedCommand,
        cwd,
        actualTimeout,
        env
      )

      return createSuccessResult(
        {
          command: sanitizedCommand,
          cwd: cwd || process.cwd(),
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          duration: result.duration,
        },
        result.exitCode === 0
          ? `Command executed successfully (${result.duration}ms)`
          : `Command failed with exit code ${result.exitCode}`
      )
    } catch (error) {
      return createErrorResult(
        `Command execution failed: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  /**
   * 运行命令（内部实现）
   */
  private runCommand(
    command: string,
    cwd?: string,
    timeout: number = 30000,
    env?: Record<string, string>
  ): Promise<{
    exitCode: number
    stdout: string
    stderr: string
    duration: number
  }> {
    return new Promise((resolve, reject) => {
      const startTime = Date.now()

      // 确定 shell
      const isWindows = platform() === "win32"
      const shell = isWindows ? "cmd.exe" : "/bin/sh"
      const shellArgs = isWindows ? ["/c", command] : ["-c", command]

      // 创建子进程
      const child = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      })

      let stdout = ""
      let stderr = ""
      let killed = false

      // 收集输出
      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString("utf-8")
        // 限制输出大小
        if (stdout.length > 100000) {
          stdout = stdout.substring(0, 100000) + "\n... (truncated)"
          if (!killed) {
            killed = true
            child.kill()
          }
        }
      })

      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString("utf-8")
        // 限制输出大小
        if (stderr.length > 50000) {
          stderr = stderr.substring(0, 50000) + "\n... (truncated)"
        }
      })

      // 设置超时
      const timeoutId = setTimeout(() => {
        if (!killed) {
          killed = true
          child.kill("SIGTERM")
          // 5秒后强制终止
          setTimeout(() => {
            if (!child.killed) {
              child.kill("SIGKILL")
            }
          }, 5000)
        }
      }, timeout)

      // 进程结束
      child.on("close", (code) => {
        clearTimeout(timeoutId)
        const duration = Date.now() - startTime

        resolve({
          exitCode: code || 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          duration,
        })
      })

      child.on("error", (error) => {
        clearTimeout(timeoutId)
        reject(error)
      })
    })
  }

  /**
   * 获取当前工作目录
   */
  async getCurrentDirectory(): Promise<ToolResult> {
    return createSuccessResult(
      {
        cwd: process.cwd(),
        platform: platform(),
      },
      `Current directory: ${process.cwd()}`
    )
  }

  /**
   * 获取系统信息
   */
  async getSystemInfo(): Promise<ToolResult> {
    const os = require("os")
    const info = {
      platform: platform(),
      arch: process.arch,
      nodeVersion: process.version,
      pid: process.pid,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpus: os.cpus().length,
      homedir: os.homedir(),
      tmpdir: os.tmpdir(),
    }

    return createSuccessResult(info, `System: ${info.platform} (${info.arch})`)
  }
}

// =============================================================================
// 工具定义
// =============================================================================

export function createTerminalTools(
  security: SecurityPolicy,
  defaultTimeout?: number
): Tool[] {
  const terminalTools = new TerminalTools(security, defaultTimeout)

  return [
    {
      name: "execute_command",
      description:
        "Execute a shell command. The command will be checked against security policies before execution.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The command to execute",
          },
          cwd: {
            type: "string",
            description: "Working directory for the command",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 30000)",
          },
          env: {
            type: "object",
            description: "Environment variables to set",
            additionalProperties: { type: "string" },
          },
        },
        required: ["command"],
      },
      execute: async (args) => {
        const { command, cwd, timeout, env } = args as {
          command: string
          cwd?: string
          timeout?: number
          env?: Record<string, string>
        }
        return terminalTools.executeCommand(command, cwd, timeout, env)
      },
    },
    {
      name: "get_current_directory",
      description: "Get the current working directory.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        return terminalTools.getCurrentDirectory()
      },
    },
    {
      name: "get_system_info",
      description: "Get system information including platform and resources.",
      parameters: {
        type: "object",
        properties: {},
      },
      execute: async () => {
        return terminalTools.getSystemInfo()
      },
    },
  ]
}
