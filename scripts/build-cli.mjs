import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production')
  }
}

// The CLI entry point - a standalone binary that can serve MCP over stdio/http.
// The shebang lives in the source file; esbuild hoists it to the top of the bundle.
await build({
  ...common,
  entryPoints: [path.join(root, 'src/cli/index.ts')],
  outfile: path.join(root, 'out/cli/index.js'),
  external: ['electron']
})

// The sandbox worker used by the runner - must sit next to the CLI entry so
// `path.join(__dirname, 'worker.js')` resolves correctly.
await build({
  ...common,
  entryPoints: [path.join(root, 'src/main/runner/worker.ts')],
  outfile: path.join(root, 'out/cli/worker.js'),
  external: ['electron']
})

console.log('[tool-development] CLI bundle written to out/cli')
