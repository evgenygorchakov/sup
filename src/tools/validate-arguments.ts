import type { ToolDefinition } from '../types.ts'

interface PropertySchema {
  type?: string
}

interface ParametersSchema {
  properties?: Record<string, PropertySchema>
  required?: string[]
}

function actualType(value: unknown): string {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}

function matchesType(value: unknown, expected: string): boolean {
  switch (expected) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number'
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    default:
      return true
  }
}

function describeParameters(properties: Record<string, PropertySchema>, required: readonly string[]): string {
  return Object.entries(properties)
    .map(([name, schema]) => `${name} (${schema.type ?? 'any'}${required.includes(name) ? ', required' : ''})`)
    .join(', ')
}

export function validateArguments(definition: ToolDefinition, args: Record<string, unknown>): string | null {
  const name = definition.function.name
  const schema = definition.function.parameters as ParametersSchema
  const properties = schema.properties ?? {}
  const required = schema.required ?? []

  const problems: string[] = []

  for (const key of required) {
    if (args[key] === undefined) {
      problems.push(`missing required parameter "${key}"`)
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const property = properties[key]

    if (!property) {
      problems.push(`unknown parameter "${key}"`)
      continue
    }

    if (value !== undefined && property.type !== undefined && !matchesType(value, property.type)) {
      problems.push(`parameter "${key}" must be ${property.type}, got ${actualType(value)}`)
    }
  }

  if (problems.length === 0) {
    return null
  }

  return [
    `ERROR: invalid arguments for ${name}: ${problems.join('; ')}.`,
    `Expected parameters: ${describeParameters(properties, required)}.`,
    'Fix the arguments and call the tool again.',
  ].join(' ')
}
