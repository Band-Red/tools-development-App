import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ProjectStore, SettingsStore, createProject, createTool } from '../src/main/store'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'td-store-'))
}

describe('project store', () => {
  it('saves and reads a project', () => {
    const store = new ProjectStore(tmpDir())
    const project = createProject({ name: 'Demo' })
    store.save(project)
    const loaded = store.read(project.id)
    expect(loaded?.name).toBe('Demo')
  })

  it('lists saved projects', () => {
    const store = new ProjectStore(tmpDir())
    store.save(createProject({ name: 'A' }))
    store.save(createProject({ name: 'B' }))
    expect(store.list()).toHaveLength(2)
  })

  it('removes a project', () => {
    const store = new ProjectStore(tmpDir())
    const project = createProject({ name: 'A' })
    store.save(project)
    expect(store.remove(project.id)).toBe(true)
    expect(store.read(project.id)).toBeNull()
  })

  it('exports and re-imports a project', () => {
    const store = new ProjectStore(tmpDir())
    const project = createProject({ name: 'Round trip' })
    project.tools = [createTool({ name: 'echo_tool' })]
    store.save(project)

    const target = path.join(tmpDir(), 'exported.json')
    store.exportTo(project.id, target)
    expect(fs.existsSync(target)).toBe(true)

    const imported = store.importFrom(target)
    expect(imported.name).toBe('Round trip')
    expect(imported.tools[0].name).toBe('echo_tool')
    expect(imported.id).not.toBe(project.id)
  })

  it('falls back to defaults for a corrupt project file', () => {
    const root = tmpDir()
    const store = new ProjectStore(root)
    const project = createProject({ name: 'Broken' })
    store.save(project)
    fs.writeFileSync(path.join(root, 'projects', project.id, 'project.json'), '{ not json')
    expect(store.read(project.id)).toBeNull()
  })
})

describe('settings store', () => {
  it('returns defaults when nothing is stored', () => {
    const settings = new SettingsStore(tmpDir()).get()
    expect(settings.mcp.port).toBeGreaterThan(0)
    expect(settings.mcp.host).toBe('127.0.0.1')
  })

  it('persists changes', () => {
    const dir = tmpDir()
    const store = new SettingsStore(dir)
    const current = store.get()
    store.save({ ...current, mcp: { ...current.mcp, port: 9123 } })
    expect(new SettingsStore(dir).get().mcp.port).toBe(9123)
  })
})
