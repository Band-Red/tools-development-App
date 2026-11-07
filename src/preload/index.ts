import { contextBridge, ipcRenderer } from 'electron'

export interface ServiceEventPayload {
  type: 'mcp:status' | 'mcp:log' | 'project:changed'
  status?: any
  entry?: any
  projectId?: string | null
}

const invoke = (channel: string, ...args: unknown[]): Promise<any> =>
  ipcRenderer.invoke(channel, ...args)

const api = {
  app: {
    info: () => invoke('app:info')
  },
  projects: {
    list: () => invoke('projects:list'),
    get: (id: string) => invoke('projects:get', id),
    create: (name?: string) => invoke('projects:create', name),
    save: (project: unknown) => invoke('projects:save', project),
    remove: (id: string) => invoke('projects:delete', id),
    import: (filePath: string) => invoke('projects:import', filePath),
    export: (id: string, targetPath: string) => invoke('projects:export', id, targetPath),
    current: () => invoke('projects:current'),
    setCurrent: (id: string | null) => invoke('projects:set-current', id)
  },
  tools: {
    create: (projectId: string, draft: unknown) => invoke('tools:create', projectId, draft),
    update: (projectId: string, tool: unknown) => invoke('tools:update', projectId, tool),
    remove: (projectId: string, toolId: string) => invoke('tools:delete', projectId, toolId),
    validateSchema: (schema: unknown) => invoke('tools:validate-schema', schema),
    validateName: (name: string) => invoke('tools:validate-name', name)
  },
  run: {
    test: (projectId: string, toolId: string, argsText: string) =>
      invoke('run:test', projectId, toolId, argsText)
  },
  mcp: {
    status: () => invoke('mcp:status'),
    start: (options?: unknown) => invoke('mcp:start', options),
    stop: () => invoke('mcp:stop'),
    log: () => invoke('mcp:log'),
    clearLog: () => invoke('mcp:log:clear'),
    clientConfigs: () => invoke('mcp:client-configs'),
    writeClaudeConfig: (snippetId: string) => invoke('mcp:write-claude-config', snippetId)
  },
  settings: {
    get: () => invoke('settings:get'),
    save: (settings: unknown) => invoke('settings:save', settings)
  },
  dialog: {
    openFile: (filters?: unknown) => invoke('dialog:open-file', filters),
    saveFile: (defaultPath?: string) => invoke('dialog:save-file', defaultPath)
  },
  on: (callback: (event: ServiceEventPayload) => void): (() => void) => {
    const listener = (_event: unknown, payload: ServiceEventPayload) => callback(payload)
    ipcRenderer.on('service:event', listener)
    return () => ipcRenderer.removeListener('service:event', listener)
  }
}

export type ToolDevelopmentApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('toolDevelopmentApi', api)
} else {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).toolDevelopmentApi = api
}
