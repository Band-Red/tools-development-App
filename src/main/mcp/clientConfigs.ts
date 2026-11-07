import os from 'node:os'
import path from 'node:path'
import type { ClientConfigSnippet } from '@shared/types'

export interface ClientConfigOptions {
  /** URL of the built-in Streamable HTTP endpoint. */
  httpUrl: string
  /** Command that starts the stdio server. */
  stdioCommand: string
  /** Arguments for the stdio command. */
  stdioArgs: string[]
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

export function buildClientConfigs(options: ClientConfigOptions): ClientConfigSnippet[] {
  const httpEntry = { type: 'http', url: options.httpUrl }
  const stdioEntry = { command: options.stdioCommand, args: options.stdioArgs }

  const home = os.homedir()

  return [
    {
      id: 'claude-desktop-macos',
      label: 'Claude Desktop (macOS)',
      format: 'json',
      description: path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json'),
      content: json({ mcpServers: { 'tool-development': httpEntry } })
    },
    {
      id: 'claude-desktop-windows',
      label: 'Claude Desktop (Windows)',
      format: 'json',
      description: '%APPDATA%\\Claude\\claude_desktop_config.json',
      content: json({ mcpServers: { 'tool-development': httpEntry } })
    },
    {
      id: 'claude-desktop-linux',
      label: 'Claude Desktop (Linux / WSL)',
      format: 'json',
      description: path.join(home, '.config', 'Claude', 'claude_desktop_config.json'),
      content: json({ mcpServers: { 'tool-development': httpEntry } })
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      format: 'command',
      description: 'Add the server to your project or user configuration.',
      content: `claude mcp add --transport http tool-development ${options.httpUrl}\n# or, over stdio:\nclaude mcp add tool-development -- ${options.stdioCommand} ${options.stdioArgs.join(' ')}`
    },
    {
      id: 'cursor',
      label: 'Cursor',
      format: 'json',
      description: path.join(home, '.cursor', 'mcp.json'),
      content: json({ mcpServers: { 'tool-development': httpEntry } })
    },
    {
      id: 'vscode',
      label: 'VS Code (Copilot agent mode)',
      format: 'json',
      description: '.vscode/mcp.json in your workspace',
      content: json({ servers: { 'tool-development': httpEntry } })
    },
    {
      id: 'windsurf',
      label: 'Windsurf',
      format: 'json',
      description: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'),
      content: json({ mcpServers: { 'tool-development': httpEntry } })
    },
    {
      id: 'continue',
      label: 'Continue',
      format: 'json',
      description: path.join(home, '.continue', 'config.json'),
      content: json({ mcpServers: { 'tool-development': httpEntry } })
    },
    {
      id: 'gemini-cli',
      label: 'Gemini CLI',
      format: 'json',
      description: path.join(home, '.gemini', 'settings.json'),
      content: json({ mcpServers: { 'tool-development': httpEntry } })
    },
    {
      id: 'zed',
      label: 'Zed',
      format: 'json',
      description: path.join(home, '.config', 'zed', 'settings.json'),
      content: json({ context_servers: { 'tool-development': httpEntry } })
    },
    {
      id: 'generic-stdio',
      label: 'Any agent over stdio',
      format: 'json',
      description: 'Generic { "mcpServers": ... } block for agents that spawn a process.',
      content: json({ mcpServers: { 'tool-development': stdioEntry } })
    }
  ]
}
