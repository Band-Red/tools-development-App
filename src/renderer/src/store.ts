import { create } from 'zustand'
import type {
  AppSettings,
  ClientConfigSnippet,
  JsonSchema,
  McpLogEntry,
  McpServerStatus,
  RunResult,
  ToolDefinition,
  ToolProject
} from '@shared/types'
import { api, type AppInfo, type ServiceEventPayload } from './api'

export type TabId = 'editor' | 'test' | 'mcp'

export interface Notice {
  id: number
  kind: 'info' | 'success' | 'error'
  message: string
}

interface AppState {
  info: AppInfo | null
  projects: ToolProject[]
  projectId: string | null
  toolId: string | null
  /** Editable copy of the selected tool (unsaved changes included). */
  draft: ToolDefinition | null
  dirty: boolean
  tab: TabId
  settings: AppSettings | null
  mcpStatus: McpServerStatus | null
  mcpLog: McpLogEntry[]
  clientConfigs: ClientConfigSnippet[]
  runResult: RunResult | null
  argsText: string
  running: boolean
  notices: Notice[]

  bootstrap: () => Promise<void>
  selectProject: (id: string) => Promise<void>
  selectTool: (id: string) => Promise<void>
  setTab: (tab: TabId) => void
  patchDraft: (patch: Partial<ToolDefinition>) => void
  saveTool: () => Promise<void>
  createTool: () => Promise<void>
  duplicateTool: (id: string) => Promise<void>
  deleteTool: (id: string) => Promise<void>
  createProject: () => Promise<void>
  importProject: () => Promise<void>
  exportProject: () => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setArgsText: (text: string) => void
  runTest: () => Promise<void>
  startMcp: () => Promise<void>
  stopMcp: () => Promise<void>
  refreshMcpLog: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  notify: (kind: Notice['kind'], message: string) => void
  dismissNotice: (id: number) => void
  handleServiceEvent: (event: ServiceEventPayload) => void
}

let noticeId = 0

function cloneTool(tool: ToolDefinition | null): ToolDefinition | null {
  return tool ? (JSON.parse(JSON.stringify(tool)) as ToolDefinition) : null
}

export const useApp = create<AppState>((set, get) => ({
  info: null,
  projects: [],
  projectId: null,
  toolId: null,
  draft: null,
  dirty: false,
  tab: 'editor',
  settings: null,
  mcpStatus: null,
  mcpLog: [],
  clientConfigs: [],
  runResult: null,
  argsText: '{\n  \n}',
  running: false,
  notices: [],

  bootstrap: async () => {
    const [info, projects, current, settings, mcpStatus, mcpLog, clientConfigs] = await Promise.all([
      api.app.info(),
      api.projects.list(),
      api.projects.current(),
      api.settings.get(),
      api.mcp.status(),
      api.mcp.log(),
      api.mcp.clientConfigs()
    ])

    const project = current ?? projects[0] ?? null
    const tool = project?.tools[0] ?? null

    set({
      info,
      projects,
      projectId: project?.id ?? null,
      toolId: tool?.id ?? null,
      draft: cloneTool(tool),
      dirty: false,
      settings,
      mcpStatus,
      mcpLog,
      clientConfigs
    })
  },

  selectProject: async (id) => {
    await api.projects.setCurrent(id)
    const project = get().projects.find((item) => item.id === id) ?? null
    const tool = project?.tools[0] ?? null
    set({ projectId: id, toolId: tool?.id ?? null, draft: cloneTool(tool), dirty: false, runResult: null })
  },

  selectTool: async (id) => {
    const project = get().projects.find((item) => item.id === get().projectId)
    const tool = project?.tools.find((item) => item.id === id) ?? null
    set({ toolId: id, draft: cloneTool(tool), dirty: false, runResult: null })
  },

  setTab: (tab) => set({ tab }),

  patchDraft: (patch) => {
    const draft = get().draft
    if (!draft) return
    set({ draft: { ...draft, ...patch }, dirty: true })
  },

  saveTool: async () => {
    const { draft, projectId } = get()
    if (!draft || !projectId) return
    const saved = await api.tools.update(projectId, draft)
    const projects = get().projects.map((project) =>
      project.id === projectId
        ? { ...project, tools: project.tools.map((tool) => (tool.id === saved.id ? saved : tool)) }
        : project
    )
    set({ projects, draft: cloneTool(saved), dirty: false })
    get().notify('success', `Saved tool "${saved.name}"`)
  },

  createTool: async () => {
    const { projectId } = get()
    if (!projectId) return
    const tool = await api.tools.create(projectId, {})
    const projects = get().projects.map((project) =>
      project.id === projectId ? { ...project, tools: [...project.tools, tool] } : project
    )
    set({ projects, toolId: tool.id, draft: cloneTool(tool), dirty: false, tab: 'editor' })
    get().notify('success', `Created tool "${tool.name}"`)
  },

  duplicateTool: async (id) => {
    const { projectId } = get()
    if (!projectId) return
    const project = get().projects.find((item) => item.id === projectId)
    const source = project?.tools.find((tool) => tool.id === id)
    if (!source) return
    const tool = await api.tools.create(projectId, {
      ...source,
      id: undefined,
      name: `${source.name}_copy`,
      createdAt: undefined,
      updatedAt: undefined
    })
    const projects = get().projects.map((item) =>
      item.id === projectId ? { ...item, tools: [...item.tools, tool] } : item
    )
    set({ projects, toolId: tool.id, draft: cloneTool(tool), dirty: false, tab: 'editor' })
  },

  deleteTool: async (id) => {
    const { projectId } = get()
    if (!projectId) return
    await api.tools.remove(projectId, id)
    const projects = get().projects.map((project) =>
      project.id === projectId
        ? { ...project, tools: project.tools.filter((tool) => tool.id !== id) }
        : project
    )
    const nextTool = projects.find((project) => project.id === projectId)?.tools[0] ?? null
    set({
      projects,
      toolId: nextTool?.id ?? null,
      draft: cloneTool(nextTool),
      dirty: false
    })
  },

  createProject: async () => {
    const project = await api.projects.create()
    const projects = await api.projects.list()
    set({
      projects,
      projectId: project.id,
      toolId: project.tools[0]?.id ?? null,
      draft: cloneTool(project.tools[0] ?? null),
      dirty: false
    })
    get().notify('success', `Created project "${project.name}"`)
  },

  importProject: async () => {
    const file = await api.dialog.openFile()
    if (!file) return
    try {
      const project = await api.projects.import(file)
      const projects = await api.projects.list()
      set({
        projects,
        projectId: project.id,
        toolId: project.tools[0]?.id ?? null,
        draft: cloneTool(project.tools[0] ?? null),
        dirty: false
      })
      get().notify('success', `Imported "${project.name}"`)
    } catch (error) {
      get().notify('error', (error as Error).message)
    }
  },

  exportProject: async () => {
    const { projectId } = get()
    if (!projectId) return
    const target = await api.dialog.saveFile()
    if (!target) return
    try {
      await api.projects.export(projectId, target)
      get().notify('success', `Exported to ${target}`)
    } catch (error) {
      get().notify('error', (error as Error).message)
    }
  },

  deleteProject: async (id) => {
    await api.projects.remove(id)
    const projects = await api.projects.list()
    const next = projects[0] ?? null
    if (next) await api.projects.setCurrent(next.id)
    set({
      projects,
      projectId: next?.id ?? null,
      toolId: next?.tools[0]?.id ?? null,
      draft: cloneTool(next?.tools[0] ?? null),
      dirty: false
    })
  },

  runTest: async () => {
    const { projectId, toolId, draft } = get()
    if (!projectId || !toolId || !draft) return
    set({ running: true })
    try {
      const result = await api.run.test(projectId, toolId, get().argsText)
      set({ runResult: result, tab: 'test' })
      if (!result.ok) get().notify('error', result.error?.message ?? 'Tool run failed')
    } catch (error) {
      get().notify('error', (error as Error).message)
    } finally {
      set({ running: false })
    }
  },

  setArgsText: (text) => set({ argsText: text }),

  startMcp: async () => {
    try {
      const status = await api.mcp.start()
      set({ mcpStatus: status, tab: 'mcp' })
      get().notify('success', `MCP server listening on ${status.url}`)
    } catch (error) {
      get().notify('error', (error as Error).message)
    }
  },

  stopMcp: async () => {
    const status = await api.mcp.stop()
    set({ mcpStatus: status })
    get().notify('info', 'MCP server stopped')
  },

  refreshMcpLog: async () => {
    const log = await api.mcp.log()
    set({ mcpLog: log })
  },

  updateSettings: async (patch) => {
    const current = get().settings
    if (!current) return
    const next = { ...current, ...patch, mcp: { ...current.mcp, ...(patch.mcp ?? {}) } }
    const saved = await api.settings.save(next)
    set({ settings: saved })
  },

  notify: (kind, message) => {
    const id = ++noticeId
    set({ notices: [...get().notices, { id, kind, message }] })
    setTimeout(() => get().dismissNotice(id), 6000)
  },

  dismissNotice: (id) => set({ notices: get().notices.filter((notice) => notice.id !== id) }),

  handleServiceEvent: (event) => {
    if (event.type === 'mcp:status' && event.status) set({ mcpStatus: event.status })
    if (event.type === 'mcp:log' && event.entry) {
      set({ mcpLog: [event.entry, ...get().mcpLog].slice(0, 500) })
    }
    if (event.type === 'project:changed') {
      void api.projects.list().then((projects) => set({ projects }))
    }
  }
}))

export function schemaText(schema: JsonSchema): string {
  return JSON.stringify(schema ?? { type: 'object', properties: {} }, null, 2)
}
