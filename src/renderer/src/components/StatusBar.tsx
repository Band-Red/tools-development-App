import { type ReactElement } from 'react'
import { useApp } from '../store'

export default function StatusBar(): ReactElement {
  const info = useApp((state) => state.info)
  const status = useApp((state) => state.mcpStatus)
  const projects = useApp((state) => state.projects)
  const projectId = useApp((state) => state.projectId)

  const project = projects.find((item) => item.id === projectId)

  return (
    <footer className="statusbar">
      <span className="mono">
        v{info?.version ?? '1.0.0'} · Electron {info?.electron ?? '—'} · Node {info?.node ?? '—'}
      </span>
      <span className="mono">{info?.platform ?? '—'}/{info?.arch ?? '—'}</span>
      <span className="grow" />
      {project && (
        <span className="mono">
          {project.name} · {project.tools.length} tool(s)
        </span>
      )}
      <span className={`pill ${status?.running ? 'pill-ok' : 'pill-off'}`}>
        <span className="dot" />
        {status?.running ? `${status.sessionCount} session(s)` : 'MCP offline'}
      </span>
      <span className="mono muted" title={info?.dataDir}>
        {info?.dataDir ?? ''}
      </span>
    </footer>
  )
}
