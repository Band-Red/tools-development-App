import { type ReactElement } from 'react'
import { useApp } from '../store'

export default function Sidebar(): ReactElement {
  const projects = useApp((state) => state.projects)
  const projectId = useApp((state) => state.projectId)
  const toolId = useApp((state) => state.toolId)
  const selectProject = useApp((state) => state.selectProject)
  const selectTool = useApp((state) => state.selectTool)
  const createTool = useApp((state) => state.createTool)
  const duplicateTool = useApp((state) => state.duplicateTool)
  const deleteTool = useApp((state) => state.deleteTool)
  const createProject = useApp((state) => state.createProject)
  const importProject = useApp((state) => state.importProject)
  const deleteProject = useApp((state) => state.deleteProject)
  const exportProject = useApp((state) => state.exportProject)
  const mcpStatus = useApp((state) => state.mcpStatus)

  const project = projects.find((item) => item.id === projectId) ?? null

  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <header className="sidebar-header">
          <span>Projects</span>
          <div className="sidebar-actions">
            <button className="icon-btn" title="New project" onClick={() => void createProject()}>
              +
            </button>
            <button className="icon-btn" title="Import project" onClick={() => void importProject()}>
              ↥
            </button>
            <button
              className="icon-btn"
              title="Export current project"
              disabled={!project}
              onClick={() => void exportProject()}
            >
              ↧
            </button>
          </div>
        </header>

        <ul className="list">
          {projects.map((item) => (
            <li
              key={item.id}
              className={item.id === projectId ? 'list-item active' : 'list-item'}
              onClick={() => void selectProject(item.id)}
            >
              <span className="list-label">{item.name}</span>
              <span className="list-meta">{item.tools.length}</span>
              <button
                className="icon-btn danger"
                title="Delete project"
                onClick={(event) => {
                  event.stopPropagation()
                  if (confirm(`Delete project "${item.name}"? This cannot be undone.`)) {
                    void deleteProject(item.id)
                  }
                }}
              >
                ×
              </button>
            </li>
          ))}
          {projects.length === 0 && <li className="list-empty">No projects yet</li>}
        </ul>
      </section>

      <section className="sidebar-section grow">
        <header className="sidebar-header">
          <span>Tools</span>
          <div className="sidebar-actions">
            <button
              className="icon-btn"
              title="New tool"
              disabled={!project}
              onClick={() => void createTool()}
            >
              +
            </button>
          </div>
        </header>

        <ul className="list">
          {project?.tools.map((tool) => (
            <li
              key={tool.id}
              className={tool.id === toolId ? 'list-item active' : 'list-item'}
              onClick={() => void selectTool(tool.id)}
            >
              <span className={`status-dot ${tool.enabled === false ? 'off' : ''}`} />
              <span className="list-label">{tool.name}</span>
              <button
                className="icon-btn"
                title="Duplicate tool"
                onClick={(event) => {
                  event.stopPropagation()
                  void duplicateTool(tool.id)
                }}
              >
                ⧉
              </button>
              <button
                className="icon-btn danger"
                title="Delete tool"
                onClick={(event) => {
                  event.stopPropagation()
                  if (confirm(`Delete tool "${tool.name}"?`)) void deleteTool(tool.id)
                }}
              >
                ×
              </button>
            </li>
          ))}
          {project && project.tools.length === 0 && (
            <li className="list-empty">No tools in this project</li>
          )}
        </ul>
      </section>

      <footer className="sidebar-footer">
        <span className="muted">MCP endpoint</span>
        <code className="endpoint-mini">
          {mcpStatus?.url ?? 'http://127.0.0.1:8787/mcp'}
        </code>
      </footer>
    </aside>
  )
}
