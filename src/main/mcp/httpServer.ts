import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  StreamableHTTPServerTransport,
  type StreamableHTTPServerTransportOptions
} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { McpLogEntry, McpServerStatus } from '@shared/types'
import { ToolRegistry, firstText } from './registry'

export interface McpHttpOptions {
  host: string
  port: number
  allowAllOrigins: boolean
  allowedOrigins: string[]
  registry: ToolRegistry
  onLog?: (entry: McpLogEntry) => void
}

interface Session {
  server: Server
  transport: StreamableHTTPServerTransport
}

const MCP_PATH = '/mcp'

function isAllowedOrigin(origin: string, allowAll: boolean, allowed: string[]): boolean {
  if (allowAll) return true
  if (!origin) return true
  if (allowed.includes(origin)) return true
  try {
    const url = new URL(origin)
    return ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * Exposes the current project over MCP using the Streamable HTTP transport so
 * any agent (or browser based client) can connect to a single local URL.
 */
export class McpHttpServer {
  private httpServer: http.Server | null = null
  private sessions = new Map<string, Session>()
  private running = false
  private startedAt: string | undefined
  private lastError: string | undefined
  private host = '127.0.0.1'
  private port = 8787

  get url(): string {
    return `http://${this.host}:${this.port}${MCP_PATH}`
  }

  getStatus(): McpServerStatus {
    return {
      running: this.running,
      host: this.host,
      port: this.port,
      url: this.url,
      sessionCount: this.sessions.size,
      startedAt: this.startedAt,
      error: this.lastError
    }
  }

  private createServer(registry: ToolRegistry, onLog?: (entry: McpLogEntry) => void): Server {
    const server = new Server(
      { name: 'tool-development', version: '1.0.0' },
      { capabilities: { tools: {} } }
    )

    server.setRequestHandler(ListToolsRequestSchema, async () => {
      const tools = registry.listTools()
      onLog?.({
        id: randomUUID(),
        ts: new Date().toISOString(),
        method: 'tools/list',
        status: 'ok',
        durationMs: 0,
        detail: `${tools.length} tool(s)`
      })
      return { tools }
    })

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const started = Date.now()
      const name = request.params.name
      try {
        const result = await registry.callTool(name, request.params.arguments ?? {})
        onLog?.({
          id: randomUUID(),
          ts: new Date().toISOString(),
          method: 'tools/call',
          tool: name,
          status: result.isError ? 'error' : 'ok',
          durationMs: Date.now() - started,
          detail: result.isError ? firstText(result.content).slice(0, 400) : undefined
        })
        return result
      } catch (error) {
        const message = (error as Error).message
        onLog?.({
          id: randomUUID(),
          ts: new Date().toISOString(),
          method: 'tools/call',
          tool: name,
          status: 'error',
          durationMs: Date.now() - started,
          detail: message
        })
        return { content: [{ type: 'text', text: message }], isError: true }
      }
    })

    return server
  }

  async start(options: McpHttpOptions): Promise<McpServerStatus> {
    if (this.running) return this.getStatus()
    this.host = options.host
    this.port = options.port
    this.lastError = undefined

    const { registry, onLog, allowAllOrigins, allowedOrigins } = options

    const transportOptions: StreamableHTTPServerTransportOptions = {
      sessionIdGenerator: () => randomUUID()
    }

    const createSession = async (): Promise<Session> => {
      const server = this.createServer(registry, onLog)
      let session: Session | null = null
      const transport = new StreamableHTTPServerTransport({
        ...transportOptions,
        // The session id is generated while the initialize request is handled,
        // so the session has to be registered from this callback.
        onsessioninitialized: (sessionId: string) => {
          if (session) this.sessions.set(sessionId, session)
        }
      })
      transport.onclose = () => {
        const id = transport.sessionId
        if (id) this.sessions.delete(id)
      }
      await server.connect(transport)
      session = { server, transport }
      if (transport.sessionId) this.sessions.set(transport.sessionId, session)
      return session
    }

    const handle = async (
      req: http.IncomingMessage,
      res: http.ServerResponse
    ): Promise<void> => {
      const origin = (req.headers.origin as string) ?? ''

      if (!isAllowedOrigin(origin, allowAllOrigins, allowedOrigins)) {
        res.writeHead(403, { 'content-type': 'text/plain' })
        res.end('Origin not allowed')
        return
      }

      res.setHeader('Access-Control-Allow-Origin', origin || '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Accept, mcp-session-id, mcp-protocol-version, Authorization, Last-Event-ID'
      )
      res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version')

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`)
      if (url.pathname !== MCP_PATH) {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'Not found', hint: `Use ${MCP_PATH}` }))
        return
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined
      const existing = sessionId ? this.sessions.get(sessionId) : undefined

      try {
        if (!existing) {
          if (req.method !== 'POST') {
            res.writeHead(400, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ error: 'Bad Request: missing mcp-session-id header' }))
            return
          }
          const body = await readBody(req)
          const session = await createSession()
          await session.transport.handleRequest(req, res, body)
          return
        }
        await existing.transport.handleRequest(req, res)
      } catch (error) {
        this.lastError = (error as Error).message
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: (error as Error).message }))
        }
      }
    }

    const httpServer = http.createServer((req, res) => {
      void handle(req, res)
    })

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        httpServer.removeListener('listening', onListening)
        reject(error)
      }
      const onListening = (): void => {
        httpServer.removeListener('error', onError)
        resolve()
      }
      httpServer.once('error', onError)
      httpServer.once('listening', onListening)
      httpServer.listen(options.port, options.host)
    })

    this.httpServer = httpServer
    this.running = true
    this.startedAt = new Date().toISOString()
    this.lastError = undefined
    return this.getStatus()
  }

  async stop(): Promise<McpServerStatus> {
    for (const session of this.sessions.values()) {
      try {
        await session.server.close()
      } catch {
        /* ignore */
      }
    }
    this.sessions.clear()

    if (this.httpServer) {
      const server = this.httpServer
      this.httpServer = null
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections?.()
      })
    }
    this.running = false
    this.startedAt = undefined
    return this.getStatus()
  }
}
