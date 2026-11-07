/**
 * Shared type model used by the Electron main process, the CLI, the preload
 * bridge and the renderer. Kept free of any Node/Electron imports so it can be
 * bundled into every target.
 */

export type JsonSchema = Record<string, any>

export interface ToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ToolDefinition {
  id: string
  /** MCP tool name. Must match /^[a-zA-Z0-9_-]{1,64}$/ */
  name: string
  description: string
  /** JSON Schema describing the tool arguments (object schema). */
  inputSchema: JsonSchema
  /** JavaScript source of the handler function. */
  handler: string
  enabled: boolean
  annotations?: ToolAnnotations
  /** Per-tool execution timeout override in milliseconds. */
  timeoutMs?: number
  createdAt: string
  updatedAt: string
}

export interface ProjectSettings {
  /** Node built-ins the sandbox is allowed to require. */
  allowModules: string[]
  /** Allows the `ctx.shell()` helper (arbitrary process execution). */
  allowShell: boolean
  defaultTimeoutMs: number
  maxOutputBytes: number
}

export interface ToolProject {
  id: string
  name: string
  description: string
  version: string
  tools: ToolDefinition[]
  settings: ProjectSettings
  createdAt: string
  updatedAt: string
}

export interface McpEndpointSettings {
  enabled: boolean
  host: string
  port: number
  autoStart: boolean
  /** Allow browser based MCP clients from any origin (localhost only). */
  allowAllOrigins: boolean
  allowedOrigins: string[]
}

export interface AppSettings {
  theme: 'dark' | 'light'
  editorFontSize: number
  mcp: McpEndpointSettings
  lastProjectId: string | null
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  ts: string
}

export interface RunError {
  message: string
  stack?: string
}

export interface RunResult {
  ok: boolean
  /** Raw handler return value (JSON serialisable parts only). */
  output?: unknown
  /** MCP content array when the handler produced one. */
  content?: McpContent[]
  error?: RunError
  logs: LogEntry[]
  durationMs: number
  isError?: boolean
}

export type McpContent =
  | { type: 'text'; text: string; mimeType?: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string; blob?: string } }

export interface McpServerStatus {
  running: boolean
  host: string
  port: number
  url: string
  sessionCount: number
  startedAt?: string
  error?: string
}

export interface McpLogEntry {
  id: string
  ts: string
  method: string
  tool?: string
  status: 'ok' | 'error'
  durationMs: number
  detail?: string
}

export interface ClientConfigSnippet {
  id: string
  label: string
  format: 'json' | 'toml' | 'command'
  description: string
  content: string
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export interface ToolDraft {
  id?: string
  name?: string
  description?: string
  inputSchema?: JsonSchema
  handler?: string
  enabled?: boolean
  annotations?: ToolAnnotations
  timeoutMs?: number
}
