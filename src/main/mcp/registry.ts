import type { CallToolResult, ContentBlock } from '@modelcontextprotocol/sdk/types.js'
import type { ToolDefinition, ToolProject } from '@shared/types'
import { validateArguments } from '../validation'
import { runHandlerSource } from '../runner'

export interface McpToolDescriptor {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, any>
  annotations?: Record<string, unknown>
}

/** The shape returned to MCP clients for a tools/call request. */
export type McpCallResult = CallToolResult

export interface ToolRegistryOptions {
  getProject: () => ToolProject | null
  cwd: string
}

/** Returns the text of the first text block of a content array. */
export function firstText(content: ContentBlock[] | undefined): string {
  if (!content?.length) return ''
  for (const block of content) {
    if (block.type === 'text') return block.text
  }
  return ''
}

/** Maps a handler return value onto MCP content blocks. */
export function toMcpContent(value: unknown): ContentBlock[] {
  if (value === null || value === undefined) {
    return [{ type: 'text', text: 'null' }]
  }
  if (typeof value === 'string') {
    return [{ type: 'text', text: value }]
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && value.every((item) => item && typeof item === 'object' && 'type' in item)) {
      return value as ContentBlock[]
    }
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (Array.isArray(obj['content'])) {
      return obj['content'] as ContentBlock[]
    }
    if (typeof obj['text'] === 'string') {
      return [{ type: 'text', text: obj['text'] }]
    }
    return [{ type: 'text', text: JSON.stringify(obj, null, 2) }]
  }
  return [{ type: 'text', text: String(value) }]
}

/**
 * Exposes the tools of the currently open project through the MCP protocol.
 */
export class ToolRegistry {
  private readonly getProject: () => ToolProject | null
  private readonly cwd: string

  constructor(options: ToolRegistryOptions) {
    this.getProject = options.getProject
    this.cwd = options.cwd
  }

  listTools(): McpToolDescriptor[] {
    const project = this.getProject()
    if (!project) return []
    return project.tools
      .filter((tool) => tool.enabled !== false)
      .map((tool) => this.toDescriptor(tool))
  }

  private toDescriptor(tool: ToolDefinition): McpToolDescriptor {
    const descriptor: McpToolDescriptor = {
      name: tool.name,
      description: tool.description || `Tool ${tool.name}`,
      inputSchema: tool.inputSchema ?? { type: 'object', properties: {} }
    }
    if (tool.annotations?.title) descriptor.title = tool.annotations.title
    const annotations: Record<string, unknown> = {}
    if (tool.annotations?.readOnlyHint !== undefined) annotations['readOnlyHint'] = tool.annotations.readOnlyHint
    if (tool.annotations?.destructiveHint !== undefined) annotations['destructiveHint'] = tool.annotations.destructiveHint
    if (tool.annotations?.idempotentHint !== undefined) annotations['idempotentHint'] = tool.annotations.idempotentHint
    if (tool.annotations?.openWorldHint !== undefined) annotations['openWorldHint'] = tool.annotations.openWorldHint
    if (Object.keys(annotations).length > 0) descriptor.annotations = annotations
    return descriptor
  }

  findTool(name: string): ToolDefinition | undefined {
    const project = this.getProject()
    if (!project) return undefined
    return project.tools.find((tool) => tool.name === name && tool.enabled !== false)
  }

  async callTool(name: string, args: unknown): Promise<McpCallResult> {
    const project = this.getProject()
    if (!project) {
      return {
        content: [{ type: 'text', text: 'No project is open in Tools Development.' }],
        isError: true
      }
    }

    const tool = this.findTool(name)
    if (!tool) {
      return {
        content: [
          {
            type: 'text',
            text: `Unknown tool "${name}". Available tools: ${
              project.tools
                .filter((t) => t.enabled !== false)
                .map((t) => t.name)
                .join(', ') || 'none'
            }`
          }
        ],
        isError: true
      }
    }

    const validation = validateArguments(tool.inputSchema ?? { type: 'object' }, args ?? {})
    if (!validation.valid) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid arguments for "${tool.name}":\n${validation.errors.join('\n')}`
          }
        ],
        isError: true
      }
    }

    const result = await runHandlerSource(tool.handler, args ?? {}, {
      timeoutMs: tool.timeoutMs ?? project.settings.defaultTimeoutMs,
      allowModules: project.settings.allowModules,
      allowShell: project.settings.allowShell,
      cwd: this.cwd,
      maxOutputBytes: project.settings.maxOutputBytes
    })

    if (!result.ok) {
      return {
        content: [
          {
            type: 'text',
            text: `Tool "${tool.name}" failed: ${result.error?.message ?? 'unknown error'}${
              result.error?.stack ? `\n\n${result.error.stack}` : ''
            }`
          }
        ],
        isError: true
      }
    }

    const content = result.content?.length ? (result.content as ContentBlock[]) : toMcpContent(result.output)
    return { content, isError: result.isError === true ? true : undefined }
  }
}
