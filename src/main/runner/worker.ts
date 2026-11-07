import { parentPort, workerData } from 'node:worker_threads'
import vm from 'node:vm'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { compileHandler } from './handler'

interface WorkerOptions {
  timeoutMs: number
  allowModules: string[]
  allowShell: boolean
  cwd: string
  maxOutputBytes: number
}

interface WorkerPayload {
  source: string
  args: unknown
  options: WorkerOptions
}

const payload = workerData as WorkerPayload
const options = payload.options

const logs: Array<{ level: string; message: string; ts: string }> = []

function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>()
    return JSON.stringify(
      value,
      (_key, val) => {
        if (typeof val === 'bigint') return val.toString()
        if (typeof val === 'function') return `[Function ${val.name || 'anonymous'}]`
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val as object)) return '[Circular]'
          seen.add(val as object)
        }
        return val
      },
      2
    ) ?? String(value)
  } catch {
    return String(value)
  }
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => (typeof arg === 'string' ? arg : safeStringify(arg)))
    .join(' ')
}

const pushLog = (level: string) => (...args: unknown[]) => {
  const message = formatArgs(args)
  logs.push({ level, message, ts: new Date().toISOString() })
  if (logs.length > 500) logs.splice(0, logs.length - 500)
  post({ type: 'log', level, message })
}

const consoleShim = {
  log: pushLog('info'),
  info: pushLog('info'),
  debug: pushLog('debug'),
  warn: pushLog('warn'),
  error: pushLog('error'),
  trace: pushLog('error'),
  dir: pushLog('info'),
  table: pushLog('info')
}

const nodeRequire = createRequire(path.join(options.cwd, '__tool_development__.js'))

function isAllowedModule(id: string): boolean {
  if (id.startsWith('.') || path.isAbsolute(id)) return true
  const normalized = id.replace(/^node:/, '')
  return (
    options.allowModules.includes(id) ||
    options.allowModules.includes(normalized) ||
    options.allowModules.includes(`node:${normalized}`)
  )
}

function safeRequire(id: string): unknown {
  if (!isAllowedModule(id)) {
    throw new Error(
      `Module "${id}" is not allowed. Add it to "Allowed modules" in the project settings.`
    )
  }
  return nodeRequire(id)
}

const safeEnv: Record<string, string> = {}
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === 'string') safeEnv[key] = value
}

function shellHelper(command: string, args: string[] = [], runTimeout = 30_000): Promise<unknown> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { cwd: options.cwd, timeout: runTimeout, maxBuffer: options.maxOutputBytes },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? '',
          stderr: stderr?.toString() ?? '',
          code: error ? ((error as NodeJS.ErrnoException).code ?? 1) : 0
        })
      }
    )
  })
}

const sandbox: Record<string, any> = {
  console: consoleShim,
  require: safeRequire,
  process: {
    env: safeEnv,
    argv: [],
    platform: process.platform,
    arch: process.arch,
    version: process.version,
    versions: process.versions,
    cwd: () => options.cwd
  },
  fetch,
  Headers,
  Request,
  Response,
  FormData,
  Blob,
  URL,
  URLSearchParams,
  TextEncoder,
  TextDecoder,
  AbortController,
  AbortSignal,
  Buffer,
  structuredClone,
  queueMicrotask,
  crypto,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  setImmediate,
  clearImmediate
}

vm.createContext(sandbox)

const ctx = {
  log: (...args: unknown[]) => consoleShim.log(...args),
  warn: (...args: unknown[]) => consoleShim.warn(...args),
  error: (...args: unknown[]) => consoleShim.error(...args),
  projectDir: options.cwd,
  env: safeEnv,
  require: safeRequire,
  shell: options.allowShell ? shellHelper : undefined
}

/** Converts a handler result into something structured-clone friendly. */
function sanitize(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value ?? null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value as number) ? value : String(value)
  if (type === 'bigint') return (value as bigint).toString()
  if (type === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`
  if (type === 'symbol') return String(value)
  if (value instanceof Date) return value.toISOString()
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  if (Buffer.isBuffer(value)) return { type: 'Buffer', data: Array.from(value) }
  if (type === 'object') {
    const obj = value as Record<string, unknown>
    if (seen.has(obj)) return '[Circular]'
    seen.add(obj)
    if (Array.isArray(obj)) return obj.map((item) => sanitize(item, seen))
    if (obj instanceof Map) return Object.fromEntries(obj.entries())
    if (obj instanceof Set) return Array.from(obj.values())
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(obj)) {
      if (key === 'shell' || key === 'require') continue
      out[key] = sanitize(item, seen)
    }
    return out
  }
  return String(value)
}

function post(message: Record<string, unknown>): void {
  parentPort?.postMessage(message)
}

async function main(): Promise<void> {
  const handler = compileHandler(payload.source, (code) =>
    vm.runInContext(code, sandbox, { timeout: options.timeoutMs })
  )

  const result = await handler(payload.args, ctx)
  const sanitized = sanitize(result)
  const payloadOut = sanitized as Record<string, unknown> | null

  post({
    type: 'result',
    value: sanitized,
    content: Array.isArray(payloadOut?.['content']) ? payloadOut['content'] : undefined,
    isError: payloadOut?.['isError'] === true
  })
}

main()
  .then(() => {
    post({ type: 'done' })
  })
  .catch((error: unknown) => {
    const err = error as Error
    post({
      type: 'error',
      error: {
        message: err?.message ?? String(error),
        stack: err?.stack
      }
    })
    post({ type: 'done' })
  })
