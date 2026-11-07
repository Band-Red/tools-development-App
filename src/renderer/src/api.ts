import type {
  AppSettings,
  ClientConfigSnippet,
  JsonSchema,
  McpLogEntry,
  McpServerStatus,
  RunResult,
  ToolDefinition,
  ToolProject,
  ValidationResult
} from '@shared/types'

export interface AppInfo {
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  dataDir: string
  appPath: string
  packaged: boolean
}

export interface ServiceEventPayload {
  type: 'mcp:status' | 'mcp:log' | 'project:changed' | 'menu:action'
  status?: McpServerStatus
  entry?: McpLogEntry
  projectId?: string | null
  action?: string
}

export interface ToolDevelopmentApi {
  app: { info: () => Promise<AppInfo> }
  projects: {
    list: () => Promise<ToolProject[]>
    get: (id: string) => Promise<ToolProject | null>
    create: (name?: string) => Promise<ToolProject>
    save: (project: ToolProject) => Promise<ToolProject>
    remove: (id: string) => Promise<boolean>
    import: (filePath: string) => Promise<ToolProject>
    export: (id: string, targetPath: string) => Promise<string>
    current: () => Promise<ToolProject | null>
    setCurrent: (id: string | null) => Promise<ToolProject | null>
  }
  tools: {
    create: (
      projectId: string,
      draft: Partial<ToolDefinition>
    ) => Promise<ToolDefinition>
    update: (projectId: string, tool: ToolDefinition) => Promise<ToolDefinition>
    remove: (projectId: string, toolId: string) => Promise<boolean>
    validateSchema: (schema: JsonSchema) => Promise<ValidationResult>
    validateName: (name: string) => Promise<ValidationResult>
  }
  run: {
    test: (projectId: string, toolId: string, argsText: string) => Promise<RunResult>
  }
  mcp: {
    status: () => Promise<McpServerStatus>
    start: (options?: Partial<AppSettings['mcp']>) => Promise<McpServerStatus>
    stop: () => Promise<McpServerStatus>
    log: () => Promise<McpLogEntry[]>
    clearLog: () => Promise<boolean>
    clientConfigs: () => Promise<ClientConfigSnippet[]>
    writeClaudeConfig: (snippetId: string) => Promise<string | null>
  }
  settings: {
    get: () => Promise<AppSettings>
    save: (settings: AppSettings) => Promise<AppSettings>
  }
  dialog: {
    openFile: (filters?: unknown) => Promise<string | null>
    saveFile: (defaultPath?: string) => Promise<string | null>
  }
  on: (callback: (event: ServiceEventPayload) => void) => () => void
}

declare global {
  interface Window {
    toolDevelopmentApi: ToolDevelopmentApi
  }
}

export const api: ToolDevelopmentApi = window.toolDevelopmentApi
