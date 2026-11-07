import { ipcMain, dialog, app, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { AppService } from './service'
import type { AppSettings, ToolDefinition, ToolDraft, ToolProject } from '@shared/types'

export function registerIpc(service: AppService, getWindow: () => BrowserWindow | null): void {
  const handle = (channel: string, listener: (...args: any[]) => any): void => {
    ipcMain.handle(channel, async (_event, ...args) => listener(...args))
  }

  handle('app:info', async () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    dataDir: service.projects.baseDir,
    appPath: app.getAppPath(),
    packaged: app.isPackaged
  }))

  handle('projects:list', async () => service.listProjects())
  handle('projects:get', async (id: string) => service.getProject(id))
  handle('projects:create', async (name?: string) => service.createProject(name))
  handle('projects:save', async (project: ToolProject) => service.saveProject(project))
  handle('projects:delete', async (id: string) => service.deleteProject(id))
  handle('projects:import', async (filePath: string) => service.importProject(filePath))
  handle('projects:export', async (id: string, targetPath: string) =>
    service.exportProject(id, targetPath)
  )
  handle('projects:current', async () => service.getCurrentProject())
  handle('projects:set-current', async (id: string | null) => {
    service.setCurrentProject(id)
    return service.getCurrentProject()
  })

  handle('tools:create', async (projectId: string, draft: ToolDraft) =>
    service.addTool(projectId, draft)
  )
  handle('tools:update', async (projectId: string, tool: ToolDefinition) =>
    service.updateTool(projectId, tool)
  )
  handle('tools:delete', async (projectId: string, toolId: string) =>
    service.deleteTool(projectId, toolId)
  )
  handle('tools:validate-schema', async (schema: unknown) =>
    service.validateSchema(schema as Record<string, any>)
  )
  handle('tools:validate-name', async (name: string) => service.validateName(name))

  handle('run:test', async (projectId: string, toolId: string, argsText: string) => {
    let args: unknown = {}
    const text = (argsText ?? '').trim()
    if (text) {
      try {
        args = JSON.parse(text)
      } catch (error) {
        throw new Error(`Arguments must be valid JSON: ${(error as Error).message}`)
      }
    }
    return await service.runTool(projectId, toolId, args)
  })

  handle('mcp:status', async () => service.mcpStatus())
  handle('mcp:start', async (options?: Partial<AppSettings['mcp']>) =>
    service.startMcp(options ?? {})
  )
  handle('mcp:stop', async () => service.stopMcp())
  handle('mcp:log', async () => service.getMcpLog())
  handle('mcp:log:clear', async () => {
    service.clearMcpLog()
    return true
  })
  handle('mcp:client-configs', async () => service.clientConfigs())
  handle('mcp:write-claude-config', async (snippetId: string) =>
    service.writeClaudeDesktopConfig(snippetId)
  )

  handle('settings:get', async () => service.settings.get())
  handle('settings:save', async (settings: AppSettings) => service.settings.save(settings))

  handle('dialog:open-file', async (filters?: Electron.FileFilter[]) => {
    const window = getWindow()
    const result = window
      ? await dialog.showOpenDialog(window, {
          properties: ['openFile'],
          filters: filters ?? [{ name: 'Tools Development project', extensions: ['json'] }]
        })
      : await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: filters ?? [{ name: 'Tools Development project', extensions: ['json'] }]
        })
    if (result.canceled || !result.filePaths.length) return null
    return result.filePaths[0]
  })

  handle('dialog:save-file', async (defaultPath?: string) => {
    const window = getWindow()
    const options: Electron.SaveDialogOptions = {
      title: 'Export project',
      defaultPath: defaultPath ?? path.join(app.getPath('documents'), 'project.json'),
      filters: [{ name: 'Tools Development project', extensions: ['json'] }]
    }
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    return result.filePath
  })

  // Auto-start the MCP endpoint when the app boots if the user asked for it.
  const settings = service.settings.get()
  if (settings.mcp.enabled && settings.mcp.autoStart) {
    void service.startMcp().catch((error) => {
      console.error('[tool-development] Could not start the MCP server:', error.message)
    })
  }
}

export function forwardServiceEvents(
  service: AppService,
  getWindow: () => BrowserWindow | null
): void {
  service.onEvent((event) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send('service:event', event)
    }
  })
}

export function ensureUserDataDir(): string {
  const dir = app.getPath('userData')
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  return dir
}
