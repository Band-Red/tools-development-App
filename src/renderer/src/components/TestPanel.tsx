import { type ReactElement } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import { useApp } from '../store'

export default function TestPanel(): ReactElement {
  const draft = useApp((state) => state.draft)
  const argsText = useApp((state) => state.argsText)
  const setArgsText = useApp((state) => state.setArgsText)
  const runResult = useApp((state) => state.runResult)
  const running = useApp((state) => state.running)
  const runTest = useApp((state) => state.runTest)
  const settings = useApp((state) => state.settings)

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <div className="editor-title">
          <span className="section-title">Test console</span>
          <span className="muted">{draft ? draft.name : 'no tool'}</span>
        </div>
        <div className="editor-toolbar-actions">
          <button className="btn btn-primary" disabled={!draft || running} onClick={() => void runTest()}>
            {running ? 'Running…' : 'Run tool'}
          </button>
        </div>
      </div>

      <div className="test-grid">
        <section className="panel">
          <h3>Arguments</h3>
          <div className="editor-code">
            <CodeMirror
              value={argsText}
              height="260px"
              theme={settings?.theme === 'light' ? 'light' : oneDark}
              extensions={[json()]}
              onChange={(value) => setArgsText(value)}
            />
          </div>
          <p className="hint">JSON object passed to the handler as <code>args</code>.</p>
        </section>

        <section className="panel">
          <h3>Result</h3>
          {!runResult && <p className="muted">Run the tool to see its output here.</p>}
          {runResult && (
            <>
              <div className="result-meta">
                <span className={`pill ${runResult.ok ? 'pill-ok' : 'pill-error'}`}>
                  {runResult.ok ? 'ok' : 'error'}
                </span>
                <span className="muted">{runResult.durationMs} ms</span>
                {runResult.logs.length > 0 && (
                  <span className="muted">{runResult.logs.length} log line(s)</span>
                )}
              </div>

              {runResult.error && (
                <pre className="code-block error">{runResult.error.stack ?? runResult.error.message}</pre>
              )}

              {runResult.ok && (
                <pre className="code-block">
                  {JSON.stringify(runResult.output ?? null, null, 2)}
                </pre>
              )}

              {runResult.logs.length > 0 && (
                <>
                  <h4>Logs</h4>
                  <pre className="code-block logs">
                    {runResult.logs
                      .map(
                        (log) =>
                          `${log.ts.slice(11, 23)}  ${log.level.toUpperCase().padEnd(5)}  ${log.message}`
                      )
                      .join('\n')}
                  </pre>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
