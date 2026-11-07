import { app, BrowserWindow, Menu, shell, dialog } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { AppService } from './service'
import { registerIpc, forwardServiceEvents, ensureUserDataDir } from './ipc'

let mainWindow: BrowserWindow | null = null
let service: AppService | null = null

function sendMenuAction(action: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('service:event', { type: 'menu:action', action })
  }
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: app.getName(),
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ] as Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction('new-project')
        },
        {
          label: 'Import Project…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenuAction('import-project')
        },
        {
          label: 'Export Project…',
          accelerator: 'CmdOrCtrl+S',
          click: () => sendMenuAction('export-project')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'MCP',
      submenu: [
        {
          label: 'Start MCP Server',
          click: () => sendMenuAction('mcp-start')
        },
        {
          label: 'Stop MCP Server',
          click: () => sendMenuAction('mcp-stop')
        },
        { type: 'separator' },
        {
          label: 'Copy Endpoint URL',
          click: () => sendMenuAction('mcp-copy-url')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Run Selected Tool',
          accelerator: 'CmdOrCtrl+R',
          click: () => sendMenuAction('run-tool')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Tools Development',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'Tools Development',
              message: `Tools Development ${app.getVersion()}`,
              detail:
                'Author, test and publish MCP tools.\n\nEvery project is exposed over the Model Context Protocol so any agent can call your tools.'
            })
          }
        },
        {
          label: 'Open Documentation',
          click: () => {
            void shell.openExternal('https://modelcontextprotocol.io')
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1040,
    minHeight: 660,
    show: false,
    title: 'Tools Development',
    backgroundColor: '#0b0e14',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Smoke test hook: capture the rendered window and quit (used by CI).
  const smokePath = process.env['TOOL_DEVELOPMENT_SMOKE']
  if (smokePath) {
    const smokeTab = process.env['TOOL_DEVELOPMENT_SMOKE_TAB']
    const smokeDelay = Number(process.env['TOOL_DEVELOPMENT_SMOKE_DELAY'] ?? 2500)
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        const selectTab = smokeTab
          ? mainWindow?.webContents.executeJavaScript(
              `(() => {
                const button = [...document.querySelectorAll('.tab')]
                  .find((item) => item.textContent.trim() === ${JSON.stringify(smokeTab)})
                if (button) { button.click(); return 'clicked' }
                return 'not-found'
              })()`
            )
          : Promise.resolve('skipped')

        void Promise.resolve(selectTab)
          .then(() => new Promise((resolve) => setTimeout(resolve, 1200)))
          .then(() => mainWindow?.webContents.capturePage())
          .then((image) => {
            if (image) fs.writeFileSync(smokePath, image.toPNG())
            app.quit()
          })
          .catch(() => app.quit())
      }, smokeDelay)
    })
  }
}

void app.whenReady().then(async () => {
  const dataDir = ensureUserDataDir()
  service = new AppService(dataDir)
  service.ensureStarterProject()

  forwardServiceEvents(service, () => mainWindow)
  registerIpc(service, () => mainWindow)

  buildMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void service?.stopMcp().catch(() => undefined)
})
