import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ToolRegistry } from './registry'

/**
 * Runs the MCP server over stdio so agents that spawn processes (Claude Code,
 * Claude Desktop, Cursor, ...) can use the project directly.
 *
 * IMPORTANT: nothing may be written to stdout in this mode - the protocol owns
 * it. All diagnostics go to stderr.
 */
export async function runStdioServer(registry: ToolRegistry): Promise<void> {
  const server = new Server(
    { name: 'tool-development', version: '1.0.0' },
    { capabilities: { tools: {} } }
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.listTools()
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      return await registry.callTool(request.params.name, request.params.arguments ?? {})
    } catch (error) {
      return {
        content: [{ type: 'text' as const, text: (error as Error).message }],
        isError: true
      }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
