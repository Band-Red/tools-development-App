import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type {
  AppSettings,
  ProjectSettings,
  ToolDefinition,
  ToolProject
} from '@shared/types'

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  allowModules: ['node:path', 'node:url', 'node:util', 'node:os', 'node:crypto'],
  allowShell: false,
  defaultTimeoutMs: 15_000,
  maxOutputBytes: 512 * 1024
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'dark',
  editorFontSize: 13,
  mcp: {
    enabled: true,
    host: '127.0.0.1',
    port: 8787,
    autoStart: true,
    allowAllOrigins: false,
    allowedOrigins: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ]
  },
  lastProjectId: null
}

export const DEFAULT_HANDLER = `// The handler receives (args, ctx) and may be async.
// Return a value, or an MCP content array via { content: [...] }.
export default async function handler(args, ctx) {
  ctx.log('received args', args)

  return {
    echo: args,
    ok: true
  }
}
`

export function newId(prefix = ''): string {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 12)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function createTool(partial: Partial<ToolDefinition> = {}): ToolDefinition {
  const ts = nowIso()
  return {
    id: partial.id ?? newId('tool_'),
    name: partial.name ?? 'new_tool',
    description: partial.description ?? '',
    inputSchema: partial.inputSchema ?? {
      type: 'object',
      properties: {},
      required: []
    },
    handler: partial.handler ?? DEFAULT_HANDLER,
    enabled: partial.enabled ?? true,
    annotations: partial.annotations ?? {
      title: partial.name ?? 'new_tool',
      readOnlyHint: true
    },
    timeoutMs: partial.timeoutMs,
    createdAt: partial.createdAt ?? ts,
    updatedAt: ts
  }
}

export function createProject(partial: Partial<ToolProject> = {}): ToolProject {
  const ts = nowIso()
  return {
    id: partial.id ?? newId('proj_'),
    name: partial.name ?? 'Untitled project',
    description: partial.description ?? '',
    version: partial.version ?? '0.1.0',
    tools: partial.tools ?? [createTool({ name: 'example_tool' })],
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...(partial.settings ?? {}) },
    createdAt: partial.createdAt ?? ts,
    updatedAt: ts
  }
}

/** The project that is created the first time the application is started. */
export function createStarterProject(): ToolProject {
  return createProject({
    name: 'Getting started',
    description: 'A starter project with two example tools.',
    tools: [
      createTool({
        name: 'echo',
        description:
          'Echoes the given text back to the caller. Use it to verify that the MCP connection works.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string', description: 'The text to echo back' } },
          required: ['text']
        },
        handler: `export default async function handler(args, ctx) {
  ctx.log('echo called with', args.text)

  return { echo: args.text }
}
`,
        annotations: { title: 'Echo', readOnlyHint: true }
      }),
      createTool({
        name: 'current_time',
        description: 'Returns the current server time in ISO 8601 format.',
        inputSchema: { type: 'object', properties: {}, required: [] },
        handler: `export default async function handler(args, ctx) {
  ctx.log('time requested')

  return {
    now: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
  }
}
`,
        annotations: { title: 'Current time', readOnlyHint: true }
      })
    ]
  })
}

export class ProjectStore {
  private readonly root: string

  constructor(root: string) {
    this.root = root
    fs.mkdirSync(this.root, { recursive: true })
  }

  get baseDir(): string {
    return this.root
  }

  projectDir(id: string): string {
    return path.join(this.root, 'projects', id)
  }

  list(): ToolProject[] {
    const dir = path.join(this.root, 'projects')
    if (!fs.existsSync(dir)) return []
    const out: ToolProject[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const project = this.read(entry.name)
      if (project) out.push(project)
    }
    return out.sort((a, b) => a.name.localeCompare(b.name))
  }

  read(id: string): ToolProject | null {
    const file = path.join(this.projectDir(id), 'project.json')
    if (!fs.existsSync(file)) return null
    try {
      const raw = fs.readFileSync(file, 'utf8')
      const parsed = JSON.parse(raw) as ToolProject
      return normalizeProject(parsed)
    } catch {
      return null
    }
  }

  save(project: ToolProject): ToolProject {
    const dir = this.projectDir(project.id)
    fs.mkdirSync(dir, { recursive: true })
    const next: ToolProject = {
      ...project,
      updatedAt: nowIso(),
      settings: { ...DEFAULT_PROJECT_SETTINGS, ...(project.settings ?? {}) }
    }
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(next, null, 2), 'utf8')
    return next
  }

  remove(id: string): boolean {
    const dir = this.projectDir(id)
    if (!fs.existsSync(dir)) return false
    fs.rmSync(dir, { recursive: true, force: true })
    return true
  }

  /** Imports a project from a project.json file or an exported .json bundle. */
  importFrom(filePath: string): ToolProject {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const incoming = parsed.project ?? parsed
    const project = normalizeProject({
      ...createProject(),
      ...incoming,
      id: newId('proj_'),
      createdAt: nowIso(),
      updatedAt: nowIso()
    })
    return this.save(project)
  }

  exportTo(id: string, targetPath: string): string {
    const project = this.read(id)
    if (!project) throw new Error(`Unknown project: ${id}`)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.writeFileSync(targetPath, JSON.stringify(project, null, 2), 'utf8')
    return targetPath
  }
}

export function normalizeProject(project: ToolProject): ToolProject {
  return {
    ...createProject(),
    ...project,
    tools: Array.isArray(project.tools)
      ? project.tools.map((tool) => ({
          ...createTool(),
          ...tool,
          inputSchema: tool.inputSchema ?? { type: 'object', properties: {} }
        }))
      : [],
    settings: { ...DEFAULT_PROJECT_SETTINGS, ...(project.settings ?? {}) }
  }
}

export class SettingsStore {
  private readonly file: string
  private cache: AppSettings | null = null

  constructor(root: string) {
    this.file = path.join(root, 'settings.json')
    fs.mkdirSync(root, { recursive: true })
  }

  get(): AppSettings {
    if (this.cache) return this.cache
    let value: AppSettings = structuredClone(DEFAULT_APP_SETTINGS)
    if (fs.existsSync(this.file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<AppSettings>
        value = {
          ...value,
          ...parsed,
          mcp: { ...value.mcp, ...(parsed.mcp ?? {}) }
        }
      } catch {
        /* fall back to defaults */
      }
    }
    this.cache = value
    return value
  }

  save(next: AppSettings): AppSettings {
    const merged: AppSettings = {
      ...this.get(),
      ...next,
      mcp: { ...this.get().mcp, ...(next.mcp ?? {}) }
    }
    this.cache = merged
    fs.writeFileSync(this.file, JSON.stringify(merged, null, 2), 'utf8')
    return merged
  }
}
