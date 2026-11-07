import path from 'node:path'
import fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import type { LogEntry, RunResult } from '@shared/types'

/**
 * Locates the sandbox worker bundle. The file sits next to the bundle that
 * imports it (out/main or out/cli); the extra candidates keep the runner
 * working when the sources are executed directly (tests, ts-node).
 */
function resolveWorkerPath(): string {
  const candidates = [
    path.join(__dirname, 'worker.js'),
    path.join(__dirname, '..', '..', 'out', 'main', 'worker.js'),
    path.join(__dirname, '..', '..', 'out', 'cli', 'worker.js'),
    path.join(process.cwd(), 'out', 'main', 'worker.js'),
    path.join(process.cwd(), 'out', 'cli', 'worker.js')
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

export interface RunOptions {
  timeoutMs: number
  allowModules: string[]
  allowShell: boolean
  cwd: string
  maxOutputBytes: number
}

interface WorkerMessage {
  type: 'log' | 'result' | 'error' | 'done'
  level?: string
  message?: string
  value?: unknown
  content?: unknown
  isError?: boolean
  error?: { message: string; stack?: string }
}

export async function runHandlerSource(
  source: string,
  args: unknown,
  options: RunOptions
): Promise<RunResult> {
  const started = Date.now()
  const logs: LogEntry[] = []
  // Resolve on each run: tests and CLI builds may create the bundle after this
  // module has been imported, so resolving at module load time can cache a path
  // to a worker that does not exist yet.
  const workerPath = resolveWorkerPath()

  return await new Promise<RunResult>((resolve) => {
    let settled = false
    let timedOut = false
    let worker: Worker

    const finish = (result: Omit<RunResult, 'durationMs' | 'logs'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate().catch(() => undefined)
      resolve({ ...result, logs, durationMs: Date.now() - started })
    }

    const timer = setTimeout(() => {
      timedOut = true
      finish({
        ok: false,
        error: {
          message: `Handler timed out after ${options.timeoutMs} ms.`,
          stack: undefined
        }
      })
    }, Math.max(100, options.timeoutMs))

    try {
      worker = new Worker(workerPath, {
        workerData: { source, args, options },
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 32
        },
        stdout: true,
        stderr: true
      })
    } catch (error) {
      finish({
        ok: false,
        error: { message: `Could not start the sandbox worker: ${(error as Error).message}` }
      })
      return
    }

    worker.on('message', (message: WorkerMessage) => {
      switch (message.type) {
        case 'log':
          logs.push({
            level: (message.level as LogEntry['level']) ?? 'info',
            message: message.message ?? '',
            ts: new Date().toISOString()
          })
          break
        case 'result':
          finish({
            ok: true,
            output: message.value,
            content: message.content as RunResult['content'],
            isError: message.isError
          })
          break
        case 'error':
          finish({
            ok: false,
            error: {
              message: message.error?.message ?? 'Unknown handler error',
              stack: message.error?.stack
            }
          })
          break
        default:
          break
      }
    })

    worker.on('error', (error) => {
      finish({ ok: false, error: { message: error.message, stack: error.stack } })
    })

    worker.on('exit', (code) => {
      if (settled) return
      if (timedOut) return
      finish({
        ok: false,
        error: {
          message: `Sandbox worker stopped unexpectedly (exit code ${code}).`,
          stack: undefined
        }
      })
    })
  })
}
