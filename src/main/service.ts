import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  ProjectStore,
  SettingsStore,
  createProject,
  createStarterProject,
  createTool,
  nowIso
} from './store'
import { ToolRegistry } from './mcp/registry'
import { McpHttpServer } from './mcp/httpServer'
import { buildClientConfigs, type ClientConfigOptions } from './mcp/clientConfigs'
import { runHandlerSource } from './runner'
import { validateArguments, validateInputSchema, validateToolName } from './validation'
import type {
  AppSettings,
  ClientConfigSnippet,
  JsonSchema,
  McpLogEntry,
  McpServerStatus,
  RunResult,
  ToolDefinition,
  ToolDraft,
  ToolProject,
  ValidationResult
} from '@shared/types'

/** Platform specific location of the Claude Desktop configuration file. */
export function claudeDesktopConfigPath(home: string, platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
  }
  if (platform === 'win32') {
    return path.join(process.env['APPDATA'] ?? path.join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
  }
  return path.join(home, '.config', 'Claude', 'claude_desktop_config.json')
}

export type ServiceEvent =
  | { type: 'mcp:status'; status: McpServerStatus }
  | { type: 'mcp:log'; entry: McpLogEntry }
  | { type: 'project:changed'; projectId: string | null }

export function resolveDefaultDataDir(): string {
  const override = process.env['TOOL_DEVELOPMENT_DATA_DIR']
  if (override) return path.resolve(override)
  return path.join(os.homedir(), '.tool-development')
}

/**
 * Application core shared by the Electron shell and the headless CLI.
 */
export class AppService {
  readonly projects: ProjectStore
  readonly settings: SettingsStore
  readonly registry: ToolRegistry
  private readonly mcpServer = new McpHttpServer()
  private currentProjectId: string | null = null
  private projectOverride: ToolProject | null = null
  private mcpLog: McpLogEntry[] = []
  private readonly listeners = new Set<(event: ServiceEvent) => void>()
  private readonly clientConfigOptions?: ClientConfigOptions

  constructor(baseDir: string, clientConfigOptions?: ClientConfigOptions) {
    this.projects = new ProjectStore(path.join(baseDir, 'data'))
    this.settings = new SettingsStore(path.join(baseDir, 'data'))
    this.clientConfigOptions = clientConfigOptions
    this.registry = new ToolRegistry({
      getProject: () => this.projectOverride ?? this.getCurrentProject(),
      cwd: baseDir
    })
  }

  /**
   * Serves a specific project instead of the one selected in the workspace.
   * Used by the CLI when `--project <path>` is given.
   */
  setProjectOverride(project: ToolProject | null): void {
    this.projectOverride = project
  }

  // ---------------------------------------------------------------- events

  onEvent(listener: (event: ServiceEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: ServiceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        /* listeners must never break the service */
      }
    }
  }

  // -------------------------------------------------------------- projects

  /** Creates the starter project when the workspace is still empty. */
  ensureStarterProject(): ToolProject | null {
    if (this.projects.list().length > 0) return null
    const project = this.projects.save(createStarterProject())
    this.setCurrentProject(project.id)
    return project
  }

  listProjects(): ToolProject[] {
    return this.projects.list()
  }

  getProject(id: string): ToolProject | null {
    return this.projects.read(id)
  }

  createProject(name?: string): ToolProject {
    const project = createProject({ name: name ?? 'Untitled project' })
    const saved = this.projects.save(project)
    this.setCurrentProject(saved.id)
    this.emit({ type: 'project:changed', projectId: saved.id })
    return saved
  }

  saveProject(project: ToolProject): ToolProject {
    const saved = this.projects.save(project)
    this.emit({ type: 'project:changed', projectId: saved.id })
    return saved
  }

  deleteProject(id: string): boolean {
    const removed = this.projects.remove(id)
    if (this.currentProjectId === id) {
      const next = this.listProjects()[0]
      this.currentProjectId = next?.id ?? null
    }
    this.emit({ type: 'project:changed', projectId: this.currentProjectId })
    return removed
  }

  importProject(filePath: string): ToolProject {
    const project = this.projects.importFrom(filePath)
    this.setCurrentProject(project.id)
    this.emit({ type: 'project:changed', projectId: project.id })
    return project
  }

  exportProject(id: string, targetPath: string): string {
    return this.projects.exportTo(id, targetPath)
  }

  getCurrentProject(): ToolProject | null {
    if (!this.currentProjectId) {
      const projects = this.projects.list()
      if (!projects.length) return null
      this.currentProjectId = projects[0].id
    }
    return this.projects.read(this.currentProjectId)
  }

  setCurrentProject(id: string | null): void {
    this.currentProjectId = id
    if (id) {
      const settings = this.settings.get()
      if (settings.lastProjectId !== id) {
        this.settings.save({ ...settings, lastProjectId: id })
      }
    }
    this.emit({ type: 'project:changed', projectId: id })
  }

  // ----------------------------------------------------------------- tools

  addTool(projectId: string, draft: ToolDraft = {}): ToolDefinition {
    const project = this.projects.read(projectId)
    if (!project) throw new Error(`Unknown project: ${projectId}`)
    const tool = createTool(draft)
    project.tools.push(tool)
    this.projects.save(project)
    this.emit({ type: 'project:changed', projectId })
    return tool
  }

  updateTool(projectId: string, tool: ToolDefinition): ToolDefinition {
    const project = this.projects.read(projectId)
    if (!project) throw new Error(`Unknown project: ${projectId}`)
    const index = project.tools.findIndex((item) => item.id === tool.id)
    if (index === -1) throw new Error(`Unknown tool: ${tool.id}`)
    const next: ToolDefinition = { ...tool, updatedAt: nowIso() }
    project.tools[index] = next
    this.projects.save(project)
    this.emit({ type: 'project:changed', projectId })
    return next
  }

  deleteTool(projectId: string, toolId: string): boolean {
    const project = this.projects.read(projectId)
    if (!project) return false
    const before = project.tools.length
    project.tools = project.tools.filter((tool) => tool.id !== toolId)
    this.projects.save(project)
    this.emit({ type: 'project:changed', projectId })
    return project.tools.length !== before
  }

  // ------------------------------------------------------------ validation

  validateSchema(schema: JsonSchema): ValidationResult {
    return validateInputSchema(schema)
  }

  validateName(name: string): ValidationResult {
    return validateToolName(name)
  }

  // ------------------------------------------------------------------- run

  /** Runs a tool with the given JSON arguments and returns a full report. */
  async runTool(projectId: string, toolId: string, args: unknown): Promise<RunResult> {
    const project = this.projects.read(projectId)
    if (!project) throw new Error(`Unknown project: ${projectId}`)
    const tool = project.tools.find((item) => item.id === toolId)
    if (!tool) throw new Error(`Unknown tool: ${toolId}`)

    const validation = validateArguments(tool.inputSchema ?? { type: 'object' }, args ?? {})
    if (!validation.valid) {
      return {
        ok: false,
        error: { message: `Invalid arguments:\n${validation.errors.join('\n')}` },
        logs: [],
        durationMs: 0
      }
    }

    return await runHandlerSource(tool.handler, args ?? {}, {
      timeoutMs: tool.timeoutMs ?? project.settings.defaultTimeoutMs,
      allowModules: project.settings.allowModules,
      allowShell: project.settings.allowShell,
      cwd: this.projects.baseDir,
      maxOutputBytes: project.settings.maxOutputBytes
    })
  }

  // ------------------------------------------------------------------- mcp

  mcpStatus(): McpServerStatus {
    return this.mcpServer.getStatus()
  }

  async startMcp(overrides: Partial<AppSettings['mcp']> = {}): Promise<McpServerStatus> {
    const settings = this.settings.get()
    const mcp = { ...settings.mcp, ...overrides }
    this.settings.save({ ...settings, mcp })
    const status = await this.mcpServer.start({
      host: mcp.host,
      port: mcp.port,
      allowAllOrigins: mcp.allowAllOrigins,
      allowedOrigins: mcp.allowedOrigins,
      registry: this.registry,
      onLog: (entry) => this.pushLog(entry)
    })
    this.emit({ type: 'mcp:status', status })
    return status
  }

  async stopMcp(): Promise<McpServerStatus> {
    const status = await this.mcpServer.stop()
    this.emit({ type: 'mcp:status', status })
    return status
  }

  getMcpLog(): McpLogEntry[] {
    return this.mcpLog.slice().reverse()
  }

  clearMcpLog(): void {
    this.mcpLog = []
  }

  private pushLog(entry: McpLogEntry): void {
    this.mcpLog.push(entry)
    if (this.mcpLog.length > 500) this.mcpLog.splice(0, this.mcpLog.length - 500)
    this.emit({ type: 'mcp:log', entry })
  }

  clientConfigs(): ClientConfigSnippet[] {
    const settings = this.settings.get()
    const options: ClientConfigOptions = this.clientConfigOptions ?? {
      httpUrl: this.mcpServer.url,
      stdioCommand: 'tool-development',
      stdioArgs: ['mcp', '--stdio']
    }
    return buildClientConfigs({
      ...options,
      httpUrl: options.httpUrl || `http://${settings.mcp.host}:${settings.mcp.port}/mcp`
    })
  }

  /** Writes a config snippet into the Claude Desktop configuration file. */
  async writeClaudeDesktopConfig(snippetId: string): Promise<string | null> {
    const snippets = this.clientConfigs()
    const snippet = snippets.find((item) => item.id === snippetId)
    if (!snippet) return null
    const os = await import('node:os')
    const fs = await import('node:fs')
    const home = os.homedir()
    const target = claudeDesktopConfigPath(home, process.platform)
    let existing: Record<string, any> = {}
    if (fs.existsSync(target)) {
      try {
        existing = JSON.parse(fs.readFileSync(target, 'utf8'))
      } catch {
        existing = {}
      }
    }
    const parsed = JSON.parse(snippet.content)
    existing.mcpServers = { ...(existing.mcpServers ?? {}), ...parsed.mcpServers }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(existing, null, 2), 'utf8')
    return target
  }

  newRequestId(): string {
    return randomUUID()
  }
}
