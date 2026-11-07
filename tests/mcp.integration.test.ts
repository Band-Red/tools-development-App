import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const root = path.resolve(__dirname, '..')
const cliPath = path.join(root, 'out', 'cli', 'index.js')
const now = new Date().toISOString()

function buildFixture(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'td-mcp-'))
  const project = {
    id: 'proj_integration',
    name: 'Integration project',
    description: 'Fixture used by the automated tests',
    version: '0.1.0',
    tools: [
      {
        id: 'tool_add',
        name: 'add_numbers',
        description: 'Adds two numbers and returns the sum',
        inputSchema: {
          type: 'object',
          properties: { a: { type: 'number' }, b: { type: 'number' } },
          required: ['a', 'b']
        },
        handler: 'export default async (args) => ({ sum: args.a + args.b })',
        enabled: true,
        annotations: { title: 'Add numbers', readOnlyHint: true },
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'tool_echo',
        name: 'echo_tool',
        description: 'Echoes the given text back to the caller',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text']
        },
        handler:
          'export default async (args, ctx) => { ctx.log("echoing"); return { echo: args.text } }',
        enabled: true,
        annotations: { title: 'Echo', readOnlyHint: true },
        createdAt: now,
        updatedAt: now
      }
    ],
    settings: {
      allowModules: [],
      allowShell: false,
      defaultTimeoutMs: 10_000,
      maxOutputBytes: 262_144
    },
    createdAt: now,
    updatedAt: now
  }
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify(project, null, 2), 'utf8')
  return dir
}

let fixtureDir: string

beforeAll(() => {
  if (!fs.existsSync(cliPath)) {
    throw new Error(`The CLI bundle is missing. Run "npm run build" before the tests. (${cliPath})`)
  }
  fixtureDir = buildFixture()
})

describe('MCP over stdio', () => {
  let client: Client
  let transport: StdioClientTransport

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [cliPath, 'mcp', '--stdio', '--project', fixtureDir],
      stderr: 'pipe'
    })
    client = new Client({ name: 'integration-test', version: '1.0.0' })
    await client.connect(transport)
  })

  afterAll(async () => {
    await client?.close().catch(() => undefined)
  })

  it('lists the tools of the project', async () => {
    const result = await client.listTools()
    const names = result.tools.map((tool) => tool.name).sort()
    expect(names).toEqual(['add_numbers', 'echo_tool'])
  })

  it('publishes the input schema of a tool', async () => {
    const result = await client.listTools()
    const tool = result.tools.find((item) => item.name === 'add_numbers')
    expect(tool?.description).toContain('Adds two numbers')
    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      required: ['a', 'b']
    })
  })

  it('calls a tool and returns its result', async () => {
    const result: any = await client.callTool({
      name: 'add_numbers',
      arguments: { a: 2, b: 3 }
    })
    expect(result.isError).toBeFalsy()
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text).toContain('"sum": 5')
  })

  it('validates arguments against the schema', async () => {
    const result: any = await client.callTool({
      name: 'add_numbers',
      arguments: { a: 'not a number' }
    })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Invalid arguments')
  })

  it('reports unknown tools', async () => {
    const result: any = await client.callTool({ name: 'nope', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown tool')
  })
})

describe('MCP over Streamable HTTP', () => {
  let child: ChildProcess
  let client: Client
  const port = 8931
  const url = `http://127.0.0.1:${port}/mcp`

  beforeAll(async () => {
    child = spawn(
      process.execPath,
      [cliPath, 'mcp', '--http', '--port', String(port), '--project', fixtureDir],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    const deadline = Date.now() + 20_000
    let ready = false
    while (Date.now() < deadline) {
      try {
        await fetch(url, { method: 'GET' })
        ready = true
        break
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
    if (!ready) throw new Error('The MCP HTTP server did not start in time')

    const transport = new StreamableHTTPClientTransport(new URL(url))
    client = new Client({ name: 'integration-test', version: '1.0.0' })
    await client.connect(transport)
  }, 40_000)

  afterAll(async () => {
    await client?.close().catch(() => undefined)
    child?.kill('SIGTERM')
  })

  it('lists the tools over HTTP', async () => {
    const result = await client.listTools()
    expect(result.tools.map((tool) => tool.name).sort()).toEqual(['add_numbers', 'echo_tool'])
  })

  it('calls a tool over HTTP', async () => {
    const result: any = await client.callTool({
      name: 'echo_tool',
      arguments: { text: 'hello mcp' }
    })
    expect(result.isError).toBeFalsy()
    expect(result.content[0].text).toContain('hello mcp')
  })

  it('reuses the session across calls', async () => {
    const first: any = await client.callTool({
      name: 'add_numbers',
      arguments: { a: 1, b: 1 }
    })
    const second: any = await client.callTool({
      name: 'add_numbers',
      arguments: { a: 10, b: 5 }
    })
    expect(first.content[0].text).toContain('"sum": 2')
    expect(second.content[0].text).toContain('"sum": 15')
  })

  it('answers 404 for unknown paths', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/nope`)
    expect(response.status).toBe(404)
  })
})
