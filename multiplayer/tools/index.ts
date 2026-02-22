/**
 * Tool Registry and Executor
 * 工具注册中心和执行器
 *
 * 管理所有可用工具，执行工具调用循环
 */

// =============================================================================
// 工具类型定义
// =============================================================================

export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
  required?: string[]
}

export interface Tool {
  name: string
  description: string
  parameters: {
    type: "object"
    properties: Record<string, ToolParameter>
    required?: string[]
  }
  execute: (args: unknown) => Promise<ToolResult>
}

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
  output?: string // 用于显示给用户的格式化输出
}

export interface ToolCall {
  id: string
  tool: string
  arguments: unknown
}

export interface ToolCallResult {
  toolCallId: string
  tool: string
  result: ToolResult
}

// =============================================================================
// 工具注册中心
// =============================================================================

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map()
  private middlewares: Array<
    (tool: Tool, args: unknown) => Promise<ToolResult | undefined>
  > = []

  /**
   * 注册工具
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      console.warn(`[ToolRegistry] Tool '${tool.name}' is being overwritten`)
    }

    this.tools.set(tool.name, tool)
  }

  /**
   * 批量注册工具
   */
  registerMany(tools: Tool[]): void {
    for (const tool of tools) {
      this.register(tool)
    }
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /**
   * 获取工具
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  /**
   * 检查工具是否存在
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * 获取所有工具
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
   * 获取工具定义（用于 AI 调用）
   */
  getDefinitions(): Array<{
    name: string
    description: string
    parameters: Tool["parameters"]
  }> {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }))
  }

  /**
   * 添加中间件
   */
  use(
    middleware: (tool: Tool, args: unknown) => Promise<ToolResult | undefined>
  ): void {
    this.middlewares.push(middleware)
  }

  /**
   * 执行工具调用
   */
  async execute(toolCall: ToolCall): Promise<ToolCallResult> {
    const tool = this.tools.get(toolCall.tool)

    if (!tool) {
      return {
        toolCallId: toolCall.id,
        tool: toolCall.tool,
        result: {
          success: false,
          error: `Tool '${toolCall.tool}' not found`,
        },
      }
    }

    // 执行中间件
    for (const middleware of this.middlewares) {
      try {
        const result = await middleware(tool, toolCall.arguments)
        if (result !== undefined) {
          return {
            toolCallId: toolCall.id,
            tool: toolCall.tool,
            result,
          }
        }
      } catch (error) {
        return {
          toolCallId: toolCall.id,
          tool: toolCall.tool,
          result: {
            success: false,
            error: `Middleware error: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        }
      }
    }

    // 执行工具
    try {
      const result = await tool.execute(toolCall.arguments)
      return {
        toolCallId: toolCall.id,
        tool: toolCall.tool,
        result,
      }
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        tool: toolCall.tool,
        result: {
          success: false,
          error: `Execution error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      }
    }
  }

  /**
   * 批量执行工具调用
   */
  async executeMany(toolCalls: ToolCall[]): Promise<ToolCallResult[]> {
    const results: ToolCallResult[] = []

    // 串行执行（避免资源冲突）
    for (const toolCall of toolCalls) {
      const result = await this.execute(toolCall)
      results.push(result)
    }

    return results
  }

  /**
   * 清空所有工具
   */
  clear(): void {
    this.tools.clear()
    this.middlewares = []
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalTools: number
    toolNames: string[]
  } {
    return {
      totalTools: this.tools.size,
      toolNames: Array.from(this.tools.keys()),
    }
  }
}

// =============================================================================
// 工具执行循环
// =============================================================================

export interface ToolLoopOptions {
  maxIterations: number
  onToolCall?: (call: ToolCall) => void
  onToolResult?: (result: ToolCallResult) => void
  onIteration?: (iteration: number, results: ToolCallResult[]) => void
}

export const DEFAULT_TOOL_LOOP_OPTIONS: ToolLoopOptions = {
  maxIterations: 10,
}

export class ToolExecutor {
  private registry: ToolRegistry

  constructor(registry?: ToolRegistry) {
    this.registry = registry ?? new ToolRegistry()
  }

  /**
   * 获取注册中心
   */
  getRegistry(): ToolRegistry {
    return this.registry
  }

  /**
   * 执行工具调用循环
   *
   * 这是核心方法，处理 AI 的工具调用请求：
   * 1. 解析 AI 的工具调用请求
   * 2. 执行工具
   * 3. 返回结果给 AI
   * 4. 如果 AI 继续调用工具，重复步骤 1-3
   */
  async executeLoop(
    toolCalls: ToolCall[],
    options: Partial<ToolLoopOptions> = {}
  ): Promise<{
    results: ToolCallResult[]
    iterations: number
    completed: boolean
  }> {
    const opts = { ...DEFAULT_TOOL_LOOP_OPTIONS, ...options }
    const allResults: ToolCallResult[] = []
    let iterations = 0

    let currentCalls = [...toolCalls]

    while (currentCalls.length > 0 && iterations < opts.maxIterations) {
      iterations++
      opts.onIteration?.(iterations, allResults)

      // 执行当前批次的工具调用
      const batchResults: ToolCallResult[] = []

      for (const call of currentCalls) {
        opts.onToolCall?.(call)

        const result = await this.registry.execute(call)
        batchResults.push(result)

        opts.onToolResult?.(result)
      }

      allResults.push(...batchResults)

      // 检查是否有工具返回了需要进一步调用的请求
      // 这通常由 AI 服务处理，这里只是记录结果
      currentCalls = [] // 清空，等待下一次 AI 响应
    }

    return {
      results: allResults,
      iterations,
      completed: iterations < opts.maxIterations,
    }
  }

  /**
   * 解析 AI 响应中的工具调用
   *
   * 支持 OpenAI 格式的 tool_calls 字段
   */
  parseToolCallsFromResponse(response: unknown): ToolCall[] {
    if (!response || typeof response !== "object") {
      return []
    }

    const resp = response as Record<string, unknown>

    // OpenAI 格式
    if (resp.tool_calls && Array.isArray(resp.tool_calls)) {
      return resp.tool_calls
        .map((tc: unknown) => this.parseOpenAIToolCall(tc))
        .filter((tc): tc is ToolCall => tc !== null)
    }

    // DeepSeek 格式（与 OpenAI 兼容）
    if (resp.choices && Array.isArray(resp.choices)) {
      const firstChoice = resp.choices[0] as Record<string, unknown> | undefined
      if (firstChoice?.message && typeof firstChoice.message === "object") {
        const message = firstChoice.message as Record<string, unknown>
        if (message.tool_calls && Array.isArray(message.tool_calls)) {
          return message.tool_calls
            .map((tc: unknown) => this.parseOpenAIToolCall(tc))
            .filter((tc): tc is ToolCall => tc !== null)
        }
      }
    }

    return []
  }

  private parseOpenAIToolCall(toolCall: unknown): ToolCall | null {
    if (!toolCall || typeof toolCall !== "object") {
      return null
    }

    const tc = toolCall as Record<string, unknown>

    try {
      const id = String(tc.id || `call_${Date.now()}`)
      const tool = String(tc.function?.name || tc.name || "")
      let args: unknown = {}

      if (tc.function?.arguments) {
        args =
          typeof tc.function.arguments === "string"
            ? JSON.parse(tc.function.arguments)
            : tc.function.arguments
      } else if (tc.arguments) {
        args =
          typeof tc.arguments === "string"
            ? JSON.parse(tc.arguments)
            : tc.arguments
      }

      return { id, tool, arguments: args }
    } catch {
      return null
    }
  }

  /**
   * 构建工具调用请求（用于发送给 AI）
   */
  buildToolCallRequest(
    messages: Array<{ role: string; content: string }>,
    tools: Tool[]
  ): unknown {
    return {
      messages,
      tools: tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      })),
      tool_choice: "auto",
    }
  }
}

// =============================================================================
// 内置工具
// =============================================================================

/**
 * 思考工具 - 允许 AI 进行内部思考并规划工具使用
 */
export const thinkTool: Tool = {
  name: "think",
  description: `Use this tool to analyze user requests and plan your approach. Before responding to complex queries, use this tool to:
1. Analyze what the user is asking for
2. Determine if any tools are needed (read_file, search_files, etc.)
3. Plan the sequence of tool calls if multiple are needed
4. Consider edge cases and alternatives

Example thoughts:
- "User is asking about main.ts, I should read this file first"
- "User wants to search for a function, I'll use search_files"
- "This requires checking multiple files, I'll start with list_directory"`,
  parameters: {
    type: "object",
    properties: {
      thought: {
        type: "string",
        description: "Your analysis and plan. Explain what tools you will use and why.",
      },
      needsTools: {
        type: "boolean",
        description: "Whether you need to use other tools to answer this request",
      },
      plannedTools: {
        type: "array",
        description: "List of tools you plan to use, in order",
        items: {
          type: "string",
          enum: ["read_file", "write_file", "list_directory", "search_files", "execute_command", "save_chat_history", "wait"]
        }
      }
    },
    required: ["thought"],
  },
  execute: async (args) => {
    const { thought, needsTools, plannedTools } = args as { thought: string; needsTools?: boolean; plannedTools?: string[] }
    if (needsTools) {
    }
    return {
      success: true,
      data: { needsTools, plannedTools },
      output: needsTools
        ? `Thought: ${thought}\nPlan: Use ${plannedTools?.join(", ")}`
        : `Thought: ${thought}`,
    }
  },
}

/**
 * 等待工具 - 允许 AI 暂停一段时间
 */
export const waitTool: Tool = {
  name: "wait",
  description: "Wait for a specified amount of time before continuing",
  parameters: {
    type: "object",
    properties: {
      seconds: {
        type: "number",
        description: "Number of seconds to wait",
        minimum: 0,
        maximum: 60,
      },
    },
    required: ["seconds"],
  },
  execute: async (args) => {
    const { seconds } = args as { seconds: number }
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
    return {
      success: true,
      output: `Waited for ${seconds} seconds`,
    }
  },
}

// =============================================================================
// 任务规划工具（需要外部回调支持）
// =============================================================================

/** 任务规划回调类型 */
export type TaskPlanCallback = (plan: {
  planId: string
  title: string
  tasks: Array<{ id: string; title: string; description?: string }>
}) => void

/** 任务更新回调类型 */
export type TaskUpdateCallback = (update: {
  planId: string
  taskId: string
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped"
  result?: string
  error?: string
}) => void

// 全局回调存储
let taskPlanCallback: TaskPlanCallback | null = null
let taskUpdateCallback: TaskUpdateCallback | null = null

/**
 * 设置任务规划回调
 */
export function setTaskPlanCallback(callback: TaskPlanCallback | null): void {
  taskPlanCallback = callback
}

/**
 * 设置任务更新回调
 */
export function setTaskUpdateCallback(callback: TaskUpdateCallback | null): void {
  taskUpdateCallback = callback
}

/**
 * 创建任务规划工具
 */
export function createPlanTasksTool(): Tool {
  return {
    name: "plan_tasks",
    description: `Create a task plan for complex multi-step operations. Use this tool BEFORE starting complex tasks to:
1. Break down the task into clear steps
2. Show the user what you plan to do
3. Track progress as you complete each step

When to use:
- Complex tasks that require multiple steps (3+ steps)
- Tasks that might take time and need progress tracking
- Tasks where the user wants to see step-by-step progress

When NOT to use:
- Simple single-step requests
- Quick questions that can be answered directly`,
    parameters: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "A brief title for the overall task plan",
        },
        tasks: {
          type: "array",
          description: "List of tasks to execute in order",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Brief title of this task step",
              },
              description: {
                type: "string",
                description: "Optional detailed description of what this step involves",
              },
            },
            required: ["title"],
          },
          minItems: 1,
        },
      },
      required: ["title", "tasks"],
    },
    execute: async (args) => {
      const { title, tasks } = args as { title: string; tasks: Array<{ title: string; description?: string }> }

      const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

      const tasksWithIds = tasks.map((task, index) => ({
        id: `${planId}_task_${index + 1}`,
        title: task.title,
        description: task.description,
      }))

      // 调用回调通知外部
      if (taskPlanCallback) {
        taskPlanCallback({
          planId,
          title,
          tasks: tasksWithIds,
        })
      }

      const taskList = tasksWithIds
        .map((t, i) => `${i + 1}. ${t.title}${t.description ? ` - ${t.description}` : ""}`)
        .join("\n")


      return {
        success: true,
        data: {
          planId,
          taskCount: tasks.length,
        },
        output: `📋 任务计划已创建：${title}\n\n任务步骤：\n${taskList}\n\n现在开始执行...`,
      }
    },
  }
}

/**
 * 创建任务更新工具
 */
export function createUpdateTaskTool(): Tool {
  return {
    name: "update_task",
    description: `Update the status of a task in the current plan. Use this to:
1. Mark a task as "in_progress" when you start working on it
2. Mark a task as "completed" when done successfully
3. Mark a task as "failed" if something goes wrong
4. Provide results or error messages for each task

IMPORTANT: Always update task status as you progress so the user can see what's happening.`,
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "The ID of the task to update (e.g., 'plan_xxx_task_1')",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "completed", "failed", "skipped"],
          description: "The new status of the task",
        },
        result: {
          type: "string",
          description: "Brief result message (for completed tasks)",
        },
        error: {
          type: "string",
          description: "Error message (for failed tasks)",
        },
      },
      required: ["taskId", "status"],
    },
    execute: async (args) => {
      const { taskId, status, result, error } = args as {
        taskId: string
        status: "pending" | "in_progress" | "completed" | "failed" | "skipped"
        result?: string
        error?: string
      }

      // 从 taskId 提取 planId
      const planId = taskId.split("_task_")[0] || "unknown"

      // 调用回调通知外部
      if (taskUpdateCallback) {
        taskUpdateCallback({
          planId,
          taskId,
          status,
          result,
          error,
        })
      }

      const statusEmoji: Record<string, string> = {
        pending: "⏳",
        in_progress: "🔄",
        completed: "✅",
        failed: "❌",
        skipped: "⏭️",
      }

      let message = `${statusEmoji[status] || "📌"} 任务状态更新：${status}`
      if (result) message += `\n结果：${result}`
      if (error) message += `\n错误：${error}`


      return {
        success: true,
        data: { taskId, status },
        output: message,
      }
    },
  }
}

/**
 * 获取当前任务计划 ID（用于工具执行上下文）
 */
let currentPlanId: string | null = null

export function setCurrentPlanId(planId: string | null): void {
  currentPlanId = planId
}

export function getCurrentPlanId(): string | null {
  return currentPlanId
}

// =============================================================================
// 工具函数
// =============================================================================

export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry()
}

export function createToolExecutor(registry?: ToolRegistry): ToolExecutor {
  return new ToolExecutor(registry)
}

/**
 * 创建标准工具结果
 */
export function createToolResult(
  success: boolean,
  data?: unknown,
  error?: string,
  output?: string
): ToolResult {
  return {
    success,
    data,
    error,
    output: output || (success ? "Operation completed successfully" : error),
  }
}

/**
 * 创建成功结果
 */
export function createSuccessResult(data: unknown, output?: string): ToolResult {
  return createToolResult(true, data, undefined, output)
}

/**
 * 创建错误结果
 */
export function createErrorResult(error: string): ToolResult {
  return createToolResult(false, undefined, error, `Error: ${error}`)
}
