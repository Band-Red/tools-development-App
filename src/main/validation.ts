import Ajv, { type ValidateFunction } from 'ajv'
import addFormats from 'ajv-formats'
import type { JsonSchema, ValidationResult } from '@shared/types'

let ajv: Ajv | null = null

function getAjv(): Ajv {
  if (ajv) return ajv
  const instance = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: true,
    messages: true
  })
  addFormats(instance)
  ajv = instance
  return instance
}

const compileCache = new Map<string, ValidateFunction>()

/**
 * Validates that the given JSON Schema can be compiled and is usable as an MCP
 * tool input schema (MCP requires a JSON object schema).
 */
export function validateInputSchema(schema: JsonSchema | undefined): ValidationResult {
  const errors: string[] = []
  if (!schema || typeof schema !== 'object') {
    return { valid: false, errors: ['Input schema must be a JSON object.'] }
  }
  if (schema.type !== undefined && schema.type !== 'object') {
    errors.push('Input schema "type" must be "object" for MCP tools.')
  }
  if (schema.properties && typeof schema.properties !== 'object') {
    errors.push('Input schema "properties" must be an object.')
  }
  try {
    getAjv().compile(schema)
  } catch (error) {
    errors.push((error as Error).message)
  }
  return { valid: errors.length === 0, errors }
}

function getValidator(schema: JsonSchema): ValidateFunction {
  const key = JSON.stringify(schema)
  const cached = compileCache.get(key)
  if (cached) return cached
  const validator = getAjv().compile(schema)
  compileCache.set(key, validator)
  if (compileCache.size > 200) {
    const first = compileCache.keys().next().value
    if (first) compileCache.delete(first)
  }
  return validator
}

export interface ArgValidationResult extends ValidationResult {
  /** Value coerced/defaulted by ajv (useDefaults are applied by the schema). */
  coerced?: unknown
}

/** Validates tool arguments against the tool input schema. */
export function validateArguments(schema: JsonSchema, args: unknown): ArgValidationResult {
  const errors: string[] = []
  let validator: ValidateFunction
  try {
    validator = getValidator(schema)
  } catch (error) {
    return { valid: false, errors: [`Invalid input schema: ${(error as Error).message}`] }
  }
  const ok = validator(args)
  if (!ok && validator.errors) {
    for (const issue of validator.errors) {
      const where = issue.instancePath || '(root)'
      errors.push(`${where} ${issue.message ?? 'is invalid'}`)
    }
  }
  return { valid: errors.length === 0, errors, coerced: args }
}

/** Validates an MCP tool name against the spec constraints. */
export function validateToolName(name: string): ValidationResult {
  const errors: string[] = []
  if (!name) errors.push('Tool name is required.')
  else if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    errors.push('Tool name must be 1-64 characters of letters, digits, underscore or dash.')
  }
  return { valid: errors.length === 0, errors }
}
