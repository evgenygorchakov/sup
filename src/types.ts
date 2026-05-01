export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface Message {
  role: Role
  content: string
  tool_calls?: ToolCall[]
  tool_call_id?: string
}

export interface ToolCall {
  id?: string
  function: {
    name: string
    arguments: Record<string, unknown>
  }
}

export interface ToolDefinition {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: object
  }
}

export type ToolHandler = (rawArguments: unknown) => Promise<string>

export interface Tool {
  definition: ToolDefinition
  handler: ToolHandler
  primaryArgs?: readonly string[]
  accentColor?: (text: string) => string
  renderResult?: (args: Record<string, unknown>, result: string) => string
  autoApprove?: boolean
}
