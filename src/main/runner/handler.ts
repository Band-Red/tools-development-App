/**
 * Compiles tool handler source into a callable function inside a sandbox
 * context. Supported source forms:
 *
 *   export default async function handler(args, ctx) { ... }
 *   export default async (args, ctx) => { ... }
 *   module.exports = async (args, ctx) => { ... }
 *   exports.default = async (args, ctx) => { ... }
 *   async function handler(args, ctx) { ... }
 *   async (args, ctx) => { ... }
 *   // any function body ending with `return ...`
 */

const IMPORT_LINE = /^\s*import\s[^\n]*$/gm

export interface CompileCandidate {
  label: string
  code: string
}

export function buildCandidates(source: string): CompileCandidate[] {
  const trimmed = (source ?? '').trim()
  const candidates: CompileCandidate[] = []

  const withoutImports = trimmed.replace(IMPORT_LINE, '').trim()
  const exportMatch = /(?:^|\n)\s*export\s+default\s+/.exec(withoutImports)

  if (exportMatch) {
    const start = exportMatch.index + exportMatch[0].length
    const expression = withoutImports.slice(start).trim()
    candidates.push({ label: 'export default', code: `(${expression})` })
  }

  const body = withoutImports
  if (/\bmodule\s*\.\s*exports\s*=/.test(body)) {
    candidates.push({
      label: 'module.exports',
      code: `const module = { exports: {} };\nconst exports = module.exports;\n${body}\n;module.exports`
    })
  } else if (/\bexports\s*\.\s*default\s*=/.test(body)) {
    candidates.push({
      label: 'exports.default',
      code: `const exports = {};\n${body}\n;exports.default`
    })
  }

  if (/^(async\s+)?function\b/.test(body)) {
    candidates.push({ label: 'function declaration', code: `(${body})` })
  }

  if (!exportMatch) {
    candidates.push({ label: 'function expression', code: `(${body})` })
  }

  candidates.push({
    label: 'function body',
    code: `(async function handler(args, ctx) {\n${body}\n})`
  })

  return candidates
}

export const SUPPORTED_HANDLER_FORMS = [
  'export default async function handler(args, ctx) { ... }',
  'export default async (args, ctx) => { ... }',
  'module.exports = async (args, ctx) => { ... }',
  'exports.default = async (args, ctx) => { ... }',
  'async function handler(args, ctx) { ... }',
  'async (args, ctx) => { ... }',
  'a function body ending with `return ...`'
]

/**
 * Compiles the handler inside `sandbox` (a vm context) and returns the
 * callable. Throws a descriptive error when no supported form matches.
 */
export function compileHandler(
  source: string,
  run: (code: string) => unknown
): (...args: any[]) => any {
  const trimmed = (source ?? '').trim()
  if (!trimmed) {
    throw new Error(
      `Handler source is empty. Supported forms: ${SUPPORTED_HANDLER_FORMS.join('; ')}`
    )
  }

  const candidates = buildCandidates(trimmed)
  const failures: string[] = []

  for (const candidate of candidates) {
    try {
      const value = run(candidate.code)
      if (typeof value === 'function') return value as (...args: any[]) => any
      if (value && typeof (value as any).default === 'function') {
        return (value as any).default
      }
      failures.push(`${candidate.label}: produced ${typeof value}, expected a function`)
    } catch (error) {
      failures.push(`${candidate.label}: ${(error as Error).message}`)
    }
  }

  throw new Error(
    `Could not compile the handler. Tried:\n- ${failures.join('\n- ')}\n\nSupported forms: ${SUPPORTED_HANDLER_FORMS.join('; ')}`
  )
}
