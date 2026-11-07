#!/usr/bin/env node
import path from 'node:path'
import fs from 'node:fs'
import { AppService, resolveDefaultDataDir } from '../main/service'
import { runStdioServer } from '../main/mcp/stdioServer'
import { ToolRegistry } from '../main/mcp/registry'
import { normalizeProject, ProjectStore } from '../main/store'
import type { ToolProject } from '@shared/types'

interface Args {
  command: string
  flags: Record<string, string | boolean>
  positional: string[]
}

function parseArgs(argv: string[]): Args {
  const [command = 'help', ...rest] = argv
  const flags: Record<string, string | boolean> = {}
  const positional: string[] = []
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (token.startsWith('--')) {
      const [key, inlineValue] = token.slice(2).split('=')
      if (inlineValue !== undefined) {
        flags[key] = inlineValue
      } else if (rest[i + 1] && !rest[i + 1].startsWith('--')) {
        flags[key] = rest[i + 1]
        i += 1
      } else {
        flags[key] = true
      }
    } else {
      positional.push(token)
    }
  }
  return { command, flags, positional }
}

function loadProjectFromPath(target: string): { project: ToolProject; cwd: string } {
  const resolved = path.resolve(target)
  const file = fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()
    ? path.join(resolved, 'project.json')
    : resolved
  if (!fs.existsSync(file)) {
    throw new Error(`No project found at ${target}`)
  }
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as ToolProject
  return { project: normalizeProject(parsed), cwd: path.dirname(file) }
}

const HELP = `Tools Development - author, test and publish MCP tools

Usage:
  tool-development mcp --stdio [--project <path>]     Serve MCP over stdio (for agents that spawn processes)
  tool-development mcp --http  [--port <n>] [--host <h>] [--project <path>]
                                                      Serve MCP over Streamable HTTP
  tool-development project list                        List the projects of the local workspace
  tool-development project new [name]                  Create a new project
  tool-development project export <id> <file>          Export a project as JSON
  tool-development --help                              Show this help
  tool-development --version                           Print the version

Environment:
  TOOL_DEVELOPMENT_DATA_DIR   Directory that stores projects (default: ~/.tool-development)
`

async function main(): Promise<void> {
  const { command, flags, positional } = parseArgs(process.argv.slice(2))

  if (flags['version'] || command === 'version') {
    process.stdout.write('1.0.0\n')
    return
  }

  if (command === 'help' || flags['help']) {
    process.stdout.write(HELP)
    return
  }

  const baseDir = resolveDefaultDataDir()
  const service = new AppService(baseDir)

  if (command === 'project') {
    const action = positional[0] ?? 'list'
    if (action === 'list') {
      const projects = service.listProjects()
      if (!projects.length) {
        process.stdout.write('No projects yet. Create one in the app or with `project new`.\n')
      }
      for (const project of projects) {
        process.stdout.write(
          `${project.id}  ${project.name}  (${project.tools.length} tool${
            project.tools.length === 1 ? '' : 's'
          })\n`
        )
      }
      return
    }
    if (action === 'new') {
      const project = service.createProject(positional[1])
      process.stdout.write(`${project.id}  ${project.name}\n`)
      return
    }
    if (action === 'export') {
      const id = positional[1]
      const file = positional[2]
      if (!id || !file) throw new Error('Usage: project export <id> <file>')
      const target = service.exportProject(id, path.resolve(file))
      process.stdout.write(`${target}\n`)
      return
    }
    throw new Error(`Unknown project action: ${action}`)
  }

  if (command === 'mcp') {
    const projectPath = typeof flags['project'] === 'string' ? (flags['project'] as string) : null
    let registry: ToolRegistry
    let cwd = baseDir

    if (projectPath) {
      const loaded = loadProjectFromPath(projectPath)
      registry = new ToolRegistry({ getProject: () => loaded.project, cwd: loaded.cwd })
      cwd = loaded.cwd
      service.setProjectOverride(loaded.project)
    } else {
      const store = new ProjectStore(path.join(baseDir, 'data'))
      const current = service.getCurrentProject()
      const project = current ?? store.list()[0] ?? null
      registry = new ToolRegistry({ getProject: () => project, cwd })
    }

    if (flags['stdio']) {
      await runStdioServer(registry)
      return
    }

    if (flags['http']) {
      const port = Number(flags['port'] ?? 8787)
      const host = String(flags['host'] ?? '127.0.0.1')
      const settings = service.settings.get()
      const status = await service.startMcp({
        ...settings.mcp,
        host,
        port,
        enabled: true
      })
      process.stderr.write(
        `[tool-development] MCP server listening on ${status.url} (${registry.listTools().length} tool(s))\n`
      )
      const shutdown = async () => {
        await service.stopMcp().catch(() => undefined)
        process.exit(0)
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      return
    }

    process.stderr.write(HELP)
    return
  }

  process.stdout.write(HELP)
}

main().catch((error: Error) => {
  process.stderr.write(`[tool-development] ${error.message}\n`)
  process.exitCode = 1
})
