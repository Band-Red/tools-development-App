import { type ReactElement, useState, } from 'react'
import { useApp } from '../store'
import { api } from '../api'

export default function McpPanel(): ReactElement {
  const status = useApp((state) => state.mcpStatus)
  const log = useApp((state) => state.mcpLog)
  const configs = useApp((state) => state.clientConfigs)
  const settings = useApp((state) => state.settings)
  const startMcp = useApp((state) => state.startMcp)
  const stopMcp = useApp((state) => state.stopMcp)
  const updateSettings = useApp((state) => state.updateSettings)
  const notify = useApp((state) => state.notify)

  const [activeSnippet, setActiveSnippet] = useState(configs[0]?.id ?? '')
  const snippet = configs.find((item) => item.id === activeSnippet) ?? configs[0] ?? null

  const copy = async (text: string, message: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text)
      notify('success', message)
    } catch {
      notify('error', 'Could not write to the clipboard')
    }
  }

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <div className="editor-title">
          <span className="section-title">Model Context Protocol</span>
          <span className={`pill ${status?.running ? 'pill-ok' : 'pill-off'}`}>
            <span className="dot" />
            {status?.running ? 'running' : 'stopped'}
          </span>
        </div>
        <div className="editor-toolbar-actions">
          {status?.running ? (
            <button className="btn" onClick={() => void stopMcp()}>
              Stop server
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void startMcp()}>
              Start server
            </button>
          )}
        </div>
      </div>

      <div className="mcp-grid">
        <section className="panel">
          <h3>Endpoint</h3>
          <div className="endpoint">
            <code>{status?.url ?? `http://${settings?.mcp.host ?? '127.0.0.1'}:${settings?.mcp.port ?? 8787}/mcp`}</code>
            <button
              className="btn"
              onClick={() => void copy(status?.url ?? '', 'Endpoint URL copied')}
            >
              Copy
            </button>
          </div>

          <div className="row">
            <label className="field">
              <span>Host</span>
              <input
                className="input"
                value={settings?.mcp.host ?? '127.0.0.1'}
                onChange={(event) => void updateSettings({ mcp: { ...settings!.mcp, host: event.target.value } })}
              />
            </label>
            <label className="field">
              <span>Port</span>
              <input
                className="input"
                type="number"
                value={settings?.mcp.port ?? 8787}
                onChange={(event) =>
                  void updateSettings({ mcp: { ...settings!.mcp, port: Number(event.target.value) } })
                }
              />
            </label>
          </div>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={settings?.mcp.autoStart ?? true}
              onChange={(event) => void updateSettings({ mcp: { ...settings!.mcp, autoStart: event.target.checked } })}
            />
            Start the endpoint automatically when the app launches
          </label>

          <p className="hint">
            The endpoint speaks <strong>Streamable HTTP</strong>. Point any MCP client at the URL, or
            use the stdio server from the command line:{' '}
            <code>tool-development mcp --stdio --project &lt;path&gt;</code>
          </p>
        </section>

        <section className="panel">
          <h3>Connect an agent</h3>
          <div className="snippet-tabs">
            {configs.map((item) => (
              <button
                key={item.id}
                className={item.id === activeSnippet ? 'snippet-tab active' : 'snippet-tab'}
                onClick={() => setActiveSnippet(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {snippet && (
            <>
              <p className="muted path-hint">{snippet.description}</p>
              <pre className="code-block">{snippet.content}</pre>
              <div className="row">
                <button className="btn btn-primary" onClick={() => void copy(snippet.content, 'Configuration copied')}>
                  Copy configuration
                </button>
                {snippet.id.startsWith('claude-desktop') && (
                  <button
                    className="btn"
                    onClick={() => {
                      void api.mcp.writeClaudeConfig(snippet.id).then((target) => {
                        if (target) notify('info', `Claude Desktop config: ${target}`)
                      })
                    }}
                  >
                    Write to Claude config
                  </button>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <section className="panel grow">
        <h3>Activity</h3>
        {log.length === 0 ? (
          <p className="muted">No MCP calls yet. Connect an agent and call a tool.</p>
        ) : (
          <table className="log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Method</th>
                <th>Tool</th>
                <th>Status</th>
                <th>Duration</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {log.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono">{entry.ts.slice(11, 23)}</td>
                  <td className="mono">{entry.method}</td>
                  <td className="mono">{entry.tool ?? '-'}</td>
                  <td className={entry.status === 'ok' ? 'ok-text' : 'err-text'}>{entry.status}</td>
                  <td className="mono">{entry.durationMs} ms</td>
                  <td className="detail">{entry.detail ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
