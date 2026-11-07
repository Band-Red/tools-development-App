import { describe, expect, it } from 'vitest'
import { validateArguments, validateInputSchema, validateToolName } from '../src/main/validation'

describe('input schema validation', () => {
  it('accepts a valid object schema', () => {
    const result = validateInputSchema({
      type: 'object',
      properties: { a: { type: 'number' } },
      required: ['a']
    })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('rejects a non object schema', () => {
    const result = validateInputSchema({ type: 'string' })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/must be "object"/)
  })

  it('rejects a broken schema', () => {
    const result = validateInputSchema({ type: 'object', properties: 42 })
    expect(result.valid).toBe(false)
  })
})

describe('argument validation', () => {
  const schema = {
    type: 'object',
    properties: {
      a: { type: 'number' },
      b: { type: 'string' }
    },
    required: ['a']
  }

  it('accepts valid arguments', () => {
    const result = validateArguments(schema, { a: 1, b: 'x' })
    expect(result.valid).toBe(true)
  })

  it('reports missing required properties', () => {
    const result = validateArguments(schema, { b: 'x' })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/required/)
  })

  it('reports wrong types', () => {
    const result = validateArguments(schema, { a: 'nope' })
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toMatch(/number/)
  })
})

describe('tool name validation', () => {
  it('accepts snake_case names', () => {
    expect(validateToolName('read_file').valid).toBe(true)
  })

  it('rejects spaces and symbols', () => {
    expect(validateToolName('read file!').valid).toBe(false)
  })

  it('rejects empty names', () => {
    expect(validateToolName('').valid).toBe(false)
  })

  it('rejects names longer than 64 characters', () => {
    expect(validateToolName('a'.repeat(65)).valid).toBe(false)
  })
})
