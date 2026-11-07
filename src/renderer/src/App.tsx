import { useEffect, type ReactElement } from 'react'
import { useApp } from './store'
import { api } from './api'
import Sidebar from './components/Sidebar'
import ToolEditor from './components/ToolEditor'
import TestPanel from './components/TestPanel'
import McpPanel from './components/McpPanel'
import StatusBar from './components/StatusBar'

export default function App(): ReactElement {
  const bootstrap = useApp((state) => state.bootstrap)
  const handleServiceEvent = useApp((state) => state.handleServiceEvent)
  const notify = useApp((state) => state.notify)
  const notices = useApp((state) => state.notices)
  const dismissNotice = useApp((state) => state.dismissNotice)
  const tab = useApp((state) => state.tab)
  const setTab = useApp((state) => state.setTab)
  const mcpStatus = useApp((state) => state.mcpStatus)

  useEffect(() => {
    void bootstrap()
    const unsubscribe = api.on(handleServiceEvent)
    return unsubscribe
  }, [bootstrap, handleServiceEvent])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const meta = event.ctrlKey || event.metaKey
      if (meta && event.key.toLowerCase() === 's') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('td:save'))
      }
      if (meta && event.key.toLowerCase() === 'r') {
        event.preventDefault()
        void useApp.getState().runTest()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    const onMenu = (event: { action?: string }) => {
      const state = useApp.getState()
      switch (event.action) {
        case 'new-project':
          void state.createProject()
          break
        case 'import-project':
          void state.importProject()
          break
        case 'export-project':
          void state.exportProject()
          break
        case 'mcp-start':
          void state.startMcp()
          break
        case 'mcp-stop':
          void state.stopMcp()
          break
        case 'mcp-copy-url':
          void navigator.clipboard.writeText(state.mcpStatus?.url ?? '')
          state.notify('success', 'Endpoint URL copied to the clipboard')
          break
        case 'run-tool':
          void state.runTest()
          break
        default:
          break
      }
    }

    const unsubscribe = api.on((event) => {
      if (event.type === 'menu:action') onMenu(event)
    })
    return unsubscribe
  }, [notify])

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">TD</span>
          <span className="brand-name">Tools Development</span>
        </div>
        <nav className="tabs">
          <button
            className={tab === 'editor' ? 'tab active' : 'tab'}
            onClick={() => setTab('editor')}
          >
            Editor
          </button>
          <button
            className={tab === 'test' ? 'tab active' : 'tab'}
            onClick={() => setTab('test')}
          >
            Test
          </button>
          <button
            className={tab === 'mcp' ? 'tab active' : 'tab'}
            onClick={() => setTab('mcp')}
          >
            MCP
          </button>
        </nav>
        <div className="titlebar-right">
          <span
            className={`pill ${mcpStatus?.running ? 'pill-ok' : 'pill-off'}`}
            title={mcpStatus?.url ?? 'MCP server is not running'}
          >
            <span className="dot" />
            {mcpStatus?.running ? `MCP ${mcpStatus.url}` : 'MCP offline'}
          </span>
        </div>
      </header>

      <div className="body">
        <Sidebar />
        <main className="main">
          {tab === 'editor' && <ToolEditor />}
          {tab === 'test' && <TestPanel />}
          {tab === 'mcp' && <McpPanel />}
        </main>
      </div>

      <StatusBar />

      <div className="notices">
        {notices.map((notice) => (
          <div key={notice.id} className={`notice notice-${notice.kind}`} onClick={() => dismissNotice(notice.id)}>
            {notice.message}
          </div>
        ))}
      </div>
    </div>
  )
}
