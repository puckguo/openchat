/**
 * File Tools
 * 文件操作工具
 *
 * 提供安全的文件读写、目录列表和搜索功能
 */

import { promises as fs, constants as fsConstants, createReadStream } from "fs"
import { join, resolve, relative, dirname, basename, extname } from "path"
import { createInterface } from "readline"
import type { Tool, ToolResult } from "./index"
import { createSuccessResult, createErrorResult } from "./index"
import type { SecurityPolicy } from "./security"

// =============================================================================
// 文件工具类
// =============================================================================

export class FileTools {
  private security: SecurityPolicy
  private basePath: string

  constructor(security: SecurityPolicy, basePath: string = process.cwd()) {
    this.security = security
    this.basePath = basePath
  }

  /**
   * 解析路径
   */
  private resolvePath(filePath: string): string {
    if (filePath.startsWith("/") || filePath.match(/^[A-Za-z]:/)) {
      return resolve(filePath)
    }
    return resolve(this.basePath, filePath)
  }

  /**
   * 读取文件
   */
  async readFile(
    path: string,
    offset?: number,
    limit: number = 100
  ): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(path)

    // 安全检查
    const securityCheck = this.security.validatePath(resolvedPath)
    if (!securityCheck.allowed) {
      return createErrorResult(
        `Security check failed: ${securityCheck.reason}`
      )
    }

    try {
      // 检查文件是否存在
      await fs.access(resolvedPath, fsConstants.R_OK)

      const stats = await fs.stat(resolvedPath)
      if (!stats.isFile()) {
        return createErrorResult(`Path is not a file: ${path}`)
      }

      // 检查文件大小
      const sizeCheck = this.security.validateFileSize(stats.size)
      if (!sizeCheck.allowed) {
        return createErrorResult(sizeCheck.reason || "File too large")
      }

      // 读取文件内容
      const content = await fs.readFile(resolvedPath, "utf-8")
      const lines = content.split("\n")

      // 应用 offset 和 limit
      let startLine = 0
      let endLine = lines.length

      if (offset !== undefined && offset > 0) {
        startLine = Math.min(offset - 1, lines.length)
      }

      if (limit !== undefined && limit > 0) {
        endLine = Math.min(startLine + limit, lines.length)
      }

      const selectedLines = lines.slice(startLine, endLine)

      return createSuccessResult(
        {
          path: resolvedPath,
          content: selectedLines.join("\n"),
          totalLines: lines.length,
          startLine: startLine + 1,
          endLine: endLine,
          size: stats.size,
          lastModified: stats.mtime.toISOString(),
        },
        `Read ${selectedLines.length} lines from ${path} (lines ${
          startLine + 1
        }-${endLine} of ${lines.length})`
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createErrorResult(`File not found: ${path}`)
      }
      if ((error as NodeJS.ErrnoException).code === "EACCES") {
        return createErrorResult(`Permission denied: ${path}`)
      }
      return createErrorResult(
        `Error reading file: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  /**
   * 写入文件
   */
  async writeFile(
    path: string,
    content: string,
    append: boolean = false
  ): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(path)

    // 安全检查
    const pathCheck = this.security.validatePath(resolvedPath)
    if (!pathCheck.allowed) {
      return createErrorResult(`Security check failed: ${pathCheck.reason}`)
    }

    const writeCheck = this.security.validateWriteOperation()
    if (!writeCheck.allowed) {
      return createErrorResult(`Write not allowed: ${writeCheck.reason}`)
    }

    try {
      // 确保目录存在
      const dir = dirname(resolvedPath)
      await fs.mkdir(dir, { recursive: true })

      // 写入文件
      const flag = append ? "a" : "w"
      await fs.writeFile(resolvedPath, content, { flag })

      const stats = await fs.stat(resolvedPath)

      return createSuccessResult(
        {
          path: resolvedPath,
          size: stats.size,
          operation: append ? "append" : "write",
        },
        `Successfully ${append ? "appended to" : "wrote"} ${path} (${
          content.length
        } characters)`
      )
    } catch (error) {
      return createErrorResult(
        `Error writing file: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  /**
   * 列出目录
   */
  async listDirectory(
    path: string,
    recursive: boolean = false,
    pattern?: string
  ): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(path)

    // 安全检查
    const securityCheck = this.security.validatePath(resolvedPath)
    if (!securityCheck.allowed) {
      return createErrorResult(
        `Security check failed: ${securityCheck.reason}`
      )
    }

    try {
      const stats = await fs.stat(resolvedPath)
      if (!stats.isDirectory()) {
        return createErrorResult(`Path is not a directory: ${path}`)
      }

      const entries = await this.listDirectoryRecursive(
        resolvedPath,
        recursive,
        pattern
      )

      return createSuccessResult(
        {
          path: resolvedPath,
          entries,
          totalCount: entries.length,
        },
        `Listed ${entries.length} items in ${path}${
          recursive ? " (recursive)" : ""
        }${pattern ? ` matching '${pattern}'` : ""}`
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createErrorResult(`Directory not found: ${path}`)
      }
      return createErrorResult(
        `Error listing directory: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  private async listDirectoryRecursive(
    dirPath: string,
    recursive: boolean,
    pattern?: string,
    basePath: string = dirPath
  ): Promise<
    Array<{
      name: string
      path: string
      type: "file" | "directory"
      size?: number
      relativePath: string
    }>
  > {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const results: Array<{
      name: string
      path: string
      type: "file" | "directory"
      size?: number
      relativePath: string
    }> = []

    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      const relativePath = relative(basePath, fullPath)

      // 跳过隐藏文件和 node_modules
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build"
      ) {
        continue
      }

      if (entry.isDirectory()) {
        results.push({
          name: entry.name,
          path: fullPath,
          type: "directory",
          relativePath,
        })

        if (recursive) {
          const subEntries = await this.listDirectoryRecursive(
            fullPath,
            recursive,
            pattern,
            basePath
          )
          results.push(...subEntries)
        }
      } else if (entry.isFile()) {
        // 应用模式过滤
        if (pattern && !this.matchPattern(entry.name, pattern)) {
          continue
        }

        const stats = await fs.stat(fullPath)
        results.push({
          name: entry.name,
          path: fullPath,
          type: "file",
          size: stats.size,
          relativePath,
        })
      }
    }

    return results.sort((a, b) => {
      // 目录在前，文件在后
      if (a.type !== b.type) {
        return a.type === "directory" ? -1 : 1
      }
      return a.name.localeCompare(b.name)
    })
  }

  private matchPattern(filename: string, pattern: string): boolean {
    // 简单的 glob 匹配
    const regex = new RegExp(
      "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$"
    )
    return regex.test(filename)
  }

  /**
   * 搜索文件
   */
  async searchFiles(
    query: string,
    searchPath: string = this.basePath,
    useRegex: boolean = false,
    filePattern?: string,
    maxResults: number = 50
  ): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(searchPath)

    // 安全检查
    const securityCheck = this.security.validatePath(resolvedPath)
    if (!securityCheck.allowed) {
      return createErrorResult(
        `Security check failed: ${securityCheck.reason}`
      )
    }

    try {
      const stats = await fs.stat(resolvedPath)
      if (!stats.isDirectory()) {
        return createErrorResult(`Path is not a directory: ${searchPath}`)
      }

      const results: Array<{
        file: string
        line: number
        content: string
        match: string
      }> = []

      const searchRegex = useRegex
        ? new RegExp(query, "i")
        : new RegExp(this.escapeRegex(query), "i")

      await this.searchInDirectory(
        resolvedPath,
        searchRegex,
        filePattern,
        maxResults,
        results
      )

      return createSuccessResult(
        {
          query,
          path: resolvedPath,
          results,
          totalResults: results.length,
          regex: useRegex,
        },
        `Found ${results.length} matches for '${query}' in ${searchPath}`
      )
    } catch (error) {
      return createErrorResult(
        `Error searching files: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }

  private async searchInDirectory(
    dirPath: string,
    regex: RegExp,
    filePattern: string | undefined,
    maxResults: number,
    results: Array<{
      file: string
      line: number
      content: string
      match: string
    }>
  ): Promise<void> {
    if (results.length >= maxResults) return

    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      if (results.length >= maxResults) break

      const fullPath = join(dirPath, entry.name)

      // 跳过隐藏文件和目录
      if (
        entry.name.startsWith(".") ||
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "build"
      ) {
        continue
      }

      if (entry.isDirectory()) {
        await this.searchInDirectory(
          fullPath,
          regex,
          filePattern,
          maxResults,
          results
        )
      } else if (entry.isFile()) {
        // 应用文件模式过滤
        if (filePattern && !this.matchPattern(entry.name, filePattern)) {
          continue
        }

        // 只搜索文本文件
        if (!this.isTextFile(entry.name)) {
          continue
        }

        await this.searchInFile(fullPath, regex, results)
      }
    }
  }

  private async searchInFile(
    filePath: string,
    regex: RegExp,
    results: Array<{
      file: string
      line: number
      content: string
      match: string
    }>
  ): Promise<void> {
    try {
      const fileStream = createReadStream(filePath, { encoding: "utf-8" })
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      })

      let lineNumber = 0

      for await (const line of rl) {
        lineNumber++

        const match = line.match(regex)
        if (match) {
          results.push({
            file: filePath,
            line: lineNumber,
            content: line.trim().substring(0, 200), // 限制长度
            match: match[0],
          })
        }
      }
    } catch {
      // 忽略无法读取的文件
    }
  }

  private isTextFile(filename: string): boolean {
    const textExtensions = [
      ".ts", ".js", ".tsx", ".jsx", ".json", ".md", ".txt", ".html", ".css",
      ".scss", ".less", ".yaml", ".yml", ".xml", ".svg", ".vue", ".py",
      ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".php", ".sh",
      ".bash", ".zsh", ".fish",
    ]
    const ext = extname(filename).toLowerCase()
    return textExtensions.includes(ext)
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  /**
   * 获取文件信息
   */
  async getFileInfo(path: string): Promise<ToolResult> {
    const resolvedPath = this.resolvePath(path)

    // 安全检查
    const securityCheck = this.security.validatePath(resolvedPath)
    if (!securityCheck.allowed) {
      return createErrorResult(
        `Security check failed: ${securityCheck.reason}`
      )
    }

    try {
      const stats = await fs.stat(resolvedPath)

      return createSuccessResult(
        {
          path: resolvedPath,
          name: basename(resolvedPath),
          type: stats.isDirectory() ? "directory" : "file",
          size: stats.size,
          created: stats.birthtime.toISOString(),
          modified: stats.mtime.toISOString(),
          accessed: stats.atime.toISOString(),
          permissions: stats.mode.toString(8),
          isFile: stats.isFile(),
          isDirectory: stats.isDirectory(),
          isSymbolicLink: stats.isSymbolicLink(),
        },
        `File info: ${path} (${stats.isDirectory() ? "directory" : "file"}, ${
          stats.size
        } bytes)`
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return createErrorResult(`File not found: ${path}`)
      }
      return createErrorResult(
        `Error getting file info: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
  }
}

// =============================================================================
// 工具定义
// =============================================================================

export function createFileTools(
  security: SecurityPolicy,
  basePath?: string
): Tool[] {
  const fileTools = new FileTools(security, basePath)

  return [
    {
      name: "read_file",
      description:
        "Read the contents of a file. Use offset and limit to read specific line ranges.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path or relative path to the file",
          },
          offset: {
            type: "number",
            description: "Line number to start reading from (1-based)",
          },
          limit: {
            type: "number",
            description: "Maximum number of lines to read (default: 100)",
          },
        },
        required: ["path"],
      },
      execute: async (args) => {
        const { path, offset, limit } = args as { path: string; offset?: number; limit?: number }
        return fileTools.readFile(path, offset, limit)
      },
    },
    {
      name: "write_file",
      description:
        "Write content to a file. Creates the file if it doesn't exist.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path or relative path to the file",
          },
          content: {
            type: "string",
            description: "Content to write to the file",
          },
          append: {
            type: "boolean",
            description:
              "Whether to append to the file instead of overwriting",
          },
        },
        required: ["path", "content"],
      },
      execute: async (args) => {
        const { path, content, append } = args as { path: string; content: string; append?: boolean }
        return fileTools.writeFile(path, content, append)
      },
    },
    {
      name: "list_directory",
      description:
        "List the contents of a directory. Can optionally list recursively and filter by pattern.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Absolute path or relative path to the directory",
          },
          recursive: {
            type: "boolean",
            description: "Whether to list files recursively",
          },
          pattern: {
            type: "string",
            description: "Glob pattern to filter files (e.g., '*.ts')",
          },
        },
        required: ["path"],
      },
      execute: async (args) => {
        const { path, recursive, pattern } = args as { path: string; recursive?: boolean; pattern?: string }
        return fileTools.listDirectory(path, recursive, pattern)
      },
    },
    {
      name: "search_files",
      description:
        "Search for text content in files within a directory. Supports regex patterns.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Directory to search in (default: current directory)",
          },
          query: {
            type: "string",
            description: "Search query string or regex pattern",
          },
          regex: {
            type: "boolean",
            description: "Whether to treat query as regex",
          },
          filePattern: {
            type: "string",
            description: "File pattern to filter (e.g., '*.ts')",
          },
          maxResults: {
            type: "number",
            description: "Maximum number of results to return",
          },
        },
        required: ["query"],
      },
      execute: async (args) => {
        const { path, query, regex, filePattern, maxResults } = args as {
          path?: string; query: string; regex?: boolean; filePattern?: string; maxResults?: number
        }
        return fileTools.searchFiles(query, path, regex, filePattern, maxResults)
      },
    },
    {
      name: "file_info",
      description: "Get detailed information about a file or directory.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to the file or directory",
          },
        },
        required: ["path"],
      },
      execute: async (args) => {
        const { path } = args as { path: string }
        return fileTools.getFileInfo(path)
      },
    },
  ]
}
