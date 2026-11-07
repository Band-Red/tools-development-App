import { type ReactElement, useEffect, useMemo, useState, } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Extension } from '@codemirror/state'
import { useApp } from '../store'
import { api } from '../api'

function prettySchema(value: unknown): string {
  return JSON.stringify(value ?? { type: 'object', properties: {} }, null, 2)
}

export default function ToolEditor(): ReactElement {
  const draft = useApp((state) => state.draft)
  const dirty = useApp((state) => state.dirty)
  const patchDraft = useApp((state) => state.patchDraft)
  const saveTool = useApp((state) => state.saveTool)
  const deleteTool = useApp((state) => state.deleteTool)
  const runTest = useApp((state) => state.runTest)
  const notify = useApp((state) => state.notify)
  const settings = useApp((state) => state.settings)

  const [schemaText, setSchemaText] = useState(prettySchema(draft?.inputSchema))
  const [schemaErrors, setSchemaErrors] = useState<string[]>([])
  const [nameErrors, setNameErrors] = useState<string[]>([])

  useEffect(() => {
    setSchemaText(prettySchema(draft?.inputSchema))
    setSchemaErrors([])
    setNameErrors([])
  }, [draft?.id])

  const editorTheme = useMemo<'dark' | 'light' | Extension>(
    () => (settings?.theme === 'light' ? 'light' : oneDark),
    [settings?.theme]
  )
  const editorFontSize = `${settings?.editorFontSize ?? 13}px`

  const validateSchema = async (text: string): Promise<boolean> => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      setSchemaErrors([`Not valid JSON: ${(error as Error).message}`])
      return false
    }
    const result = await api.tools.validateSchema(parsed as Record<string, unknown>)
    setSchemaErrors(result.errors)
    return result.valid
  }

  const validateName = async (name: string): Promise<void> => {
    const result = await api.tools.validateName(name)
    setNameErrors(result.errors)
  }

  // The global Ctrl+S shortcut is routed here so the schema text is parsed first.
  useEffect(() => {
    const handler = (): void => {
      void handleSave()
    }
    window.addEventListener('td:save', handler)
    return () => window.removeEventListener('td:save', handler)
  })

  const handleSave = async (): Promise<void> => {
    if (!draft) return
    let parsed: unknown
    try {
      parsed = JSON.parse(schemaText)
    } catch (error) {
      notify('error', `Input schema is not valid JSON: ${(error as Error).message}`)
      return
    }
    const valid = await validateSchema(schemaText)
    if (!valid) {
      notify('error', 'Fix the input schema errors before saving')
      return
    }
    patchDraft({ inputSchema: parsed as Record<string, unknown> })
    await saveTool()
  }

  if (!draft) {
    return (
      <div className="empty-state">
        <h2>No tool selected</h2>
        <p>Create a tool in the sidebar to start authoring an MCP tool.</p>
      </div>
    )
  }

  return (
    <div className="editor">
      <div className="editor-toolbar">
        <div className="editor-title">
          <input
            className="name-input"
            value={draft.name}
            onChange={(event) => {
              patchDraft({ name: event.target.value })
              void validateName(event.target.value)
            }}
            spellCheck={false}
          />
          <span className="muted">/{draft.name}</span>
        </div>
        <div className="editor-toolbar-actions">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.enabled !== false}
              onChange={(event) => patchDraft({ enabled: event.target.checked })}
            />
            Enabled
          </label>
          <button className="btn" onClick={() => void runTest()} title="Run the tool (Ctrl+R)">
            Run
          </button>
          <button className="btn btn-primary" onClick={() => void handleSave()} disabled={!dirty}>
            {dirty ? 'Save changes' : 'Saved'}
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              if (confirm(`Delete tool "${draft.name}"?`)) void deleteTool(draft.id)
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {nameErrors.length > 0 && <div className="alert alert-error">{nameErrors.join(' ')}</div>}

      <div className="editor-grid">
        <section className="panel">
          <h3>Description</h3>
          <textarea
            className="input textarea"
            rows={3}
            value={draft.description}
            placeholder="What does this tool do? The agent reads this."
            onChange={(event) => patchDraft({ description: event.target.value })}
          />

          <div className="row">
            <label className="field">
              <span>Title</span>
              <input
                className="input"
                value={draft.annotations?.title ?? ''}
                placeholder="Optional display title"
                onChange={(event) =>
                  patchDraft({ annotations: { ...draft.annotations, title: event.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>Timeout (ms)</span>
              <input
                className="input"
                type="number"
                min={100}
                value={draft.timeoutMs ?? ''}
                placeholder={String(settings?.mcp ? 15000 : 15000)}
                onChange={(event) =>
                  patchDraft({ timeoutMs: event.target.value ? Number(event.target.value) : undefined })
                }
              />
            </label>
          </div>

          <div className="row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.annotations?.readOnlyHint ?? false}
                onChange={(event) =>
                  patchDraft({ annotations: { ...draft.annotations, readOnlyHint: event.target.checked } })
                }
              />
              Read only
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.annotations?.destructiveHint ?? false}
                onChange={(event) =>
                  patchDraft({
                    annotations: { ...draft.annotations, destructiveHint: event.target.checked }
                  })
                }
              />
              Destructive
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.annotations?.openWorldHint ?? false}
                onChange={(event) =>
                  patchDraft({ annotations: { ...draft.annotations, openWorldHint: event.target.checked } })
                }
              />
              Open world
            </label>
          </div>
        </section>

        <section className="panel">
          <h3>
            Input schema <span className="muted">(JSON Schema)</span>
          </h3>
          <div className="editor-code">
            <CodeMirror
              value={schemaText}
              height="260px"
              theme={editorTheme}
              extensions={[json()]}
              basicSetup={{ lineNumbers: true, foldGutter: false }}
              onChange={(value) => {
                setSchemaText(value)
                void validateSchema(value)
              }}
            />
          </div>
          {schemaErrors.length > 0 ? (
            <div className="alert alert-error">{schemaErrors.join(' ')}</div>
          ) : (
            <div className="alert alert-ok">Schema is valid</div>
          )}
        </section>
      </div>

      <section className="panel grow">
        <h3>
          Handler <span className="muted">(async (args, ctx) =&gt; result)</span>
        </h3>
        <div className="editor-code grow">
          <CodeMirror
            value={draft.handler}
            height="100%"
            theme={editorTheme}
            extensions={[javascript()]}
            basicSetup={{ lineNumbers: true, foldGutter: false }}
            onChange={(value) => patchDraft({ handler: value })}
          />
        </div>
        <p className="hint">
          The handler runs in a sandboxed worker. Use <code>ctx.log()</code> for diagnostics and return
          a value or an MCP <code>{'{ content: [...] }'}</code> payload.
        </p>
      </section>
    </div>
  )
}
