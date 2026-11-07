import { describe, expect, it } from 'vitest'
import vm from 'node:vm'
import { compileHandler, buildCandidates } from '../src/main/runner/handler'

function compile(source: string): (...args: any[]) => any {
  const sandbox: Record<string, any> = { console }
  vm.createContext(sandbox)
  return compileHandler(source, (code) => vm.runInContext(code, sandbox))
}

describe('handler source compilation', () => {
  it('supports export default function declarations', async () => {
    const fn = compile(
      'export default async function handler(args) { return { sum: args.a + args.b } }'
    )
    await expect(fn({ a: 1, b: 2 })).resolves.toEqual({ sum: 3 })
  })

  it('supports export default arrow functions', async () => {
    const fn = compile('export default async (args) => ({ doubled: args.n * 2 })')
    await expect(fn({ n: 21 })).resolves.toEqual({ doubled: 42 })
  })

  it('supports module.exports', async () => {
    const fn = compile('module.exports = async (args) => `hello ${args.name}`')
    await expect(fn({ name: 'mcp' })).resolves.toBe('hello mcp')
  })

  it('supports exports.default', async () => {
    const fn = compile('exports.default = async () => ({ ok: true })')
    await expect(fn({})).resolves.toEqual({ ok: true })
  })

  it('supports bare function declarations', async () => {
    const fn = compile('async function handler(args) { return args.value * 2 }')
    await expect(fn({ value: 4 })).resolves.toBe(8)
  })

  it('supports function bodies that return a value', async () => {
    const fn = compile('const total = args.a + args.b\nreturn { total }')
    await expect(fn({ a: 2, b: 3 })).resolves.toEqual({ total: 5 })
  })

  it('passes the ctx helper to the handler', async () => {
    const fn = compile('export default async (args, ctx) => { ctx.log("hi"); return args }')
    await expect(fn({ x: 1 }, { log: () => undefined })).resolves.toEqual({ x: 1 })
  })

  it('reports a helpful error for unsupported sources', () => {
    expect(() => compile('this is not valid javascript')).toThrowError(
      /Could not compile the handler/
    )
  })

  it('rejects an empty handler', () => {
    expect(() => compile('   ')).toThrowError(/Handler source is empty/)
  })

  it('lists the supported forms in the error message', () => {
    expect(() => compile('this is not valid javascript')).toThrowError(/export default/)
  })

  it('builds candidates for common shapes', () => {
    expect(buildCandidates('export default async () => 1')[0].label).toBe('export default')
    expect(buildCandidates('module.exports = 1')[0].label).toBe('module.exports')
  })
})
