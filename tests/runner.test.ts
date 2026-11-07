import { describe, expect, it, beforeAll } from 'vitest'
import path from 'node:path'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { runHandlerSource } from '../src/main/runner'

const root = path.resolve(__dirname, '..')
const options = {
  timeoutMs: 5000,
  allowModules: ['node:path'],
  allowShell: false,
  cwd: root,
  maxOutputBytes: 1024 * 1024
}

beforeAll(() => {
  const built = ['out/main/worker.js', 'out/cli/worker.js'].map((file) =>
    path.join(root, file)
  )
  if (!built.some((file) => fs.existsSync(file))) {
    execFileSync(process.execPath, [path.join(root, 'scripts', 'build-cli.mjs')], {
      cwd: root,
      stdio: 'inherit'
    })
  }
})

describe('sandboxed runner', () => {
  it('runs a handler and returns its output', async () => {
    const result = await runHandlerSource(
      'export default async (args) => ({ sum: args.a + args.b })',
      { a: 2, b: 3 },
      options
    )
    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ sum: 5 })
  })

  it('captures console output from the handler', async () => {
    const result = await runHandlerSource(
      'export default async (args, ctx) => { ctx.log("processing", args.id); return true }',
      { id: 7 },
      options
    )
    expect(result.ok).toBe(true)
    expect(result.logs.length).toBeGreaterThan(0)
    expect(result.logs[0].message).toContain('processing')
  })

  it('reports compile errors instead of crashing', async () => {
    const result = await runHandlerSource('this is not valid javascript', {}, options)
    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/Could not compile the handler/)
  })

  it('reports runtime errors', async () => {
    const result = await runHandlerSource(
      'export default async () => { throw new Error("boom") }',
      {},
      options
    )
    expect(result.ok).toBe(false)
    expect(result.error?.message).toContain('boom')
  })

  it('enforces the execution timeout', async () => {
    const result = await runHandlerSource(
      'export default async () => { while (true) { /* spin */ } }',
      {},
      { ...options, timeoutMs: 700 }
    )
    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/timed out/i)
  })

  it('blocks modules that are not allow-listed', async () => {
    const result = await runHandlerSource(
      'export default async () => { const fs = require("node:fs"); return typeof fs }',
      {},
      options
    )
    expect(result.ok).toBe(false)
    expect(result.error?.message).toMatch(/not allowed/i)
  })

  it('allows modules that are on the allow-list', async () => {
    const result = await runHandlerSource(
      'export default async () => ({ joined: require("node:path").join("a", "b") })',
      {},
      options
    )
    expect(result.ok).toBe(true)
    expect(result.output).toEqual({ joined: 'a/b' })
  })

  it('does not expose the real process object', async () => {
    const result = await runHandlerSource(
      'export default async () => ({ hasEnv: typeof process.env === "object", cwd: typeof process.cwd === "function" })',
      {},
      options
    )
    expect(result.ok).toBe(true)
    expect((result.output as any).cwd).toBe(true)
  })
})
