import { z } from 'zod'

type JsonSchemaObject = Readonly<Record<string, unknown>>

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonSchemaLike(value: unknown): value is JsonSchemaObject {
  if (!isRecord(value)) return false
  if (typeof value['type'] === 'string') return true
  if (Array.isArray(value['type'])) return true
  if (Array.isArray(value['enum'])) return true
  if (Array.isArray(value['anyOf'])) return true
  if (Array.isArray(value['oneOf'])) return true
  return isRecord(value['properties'])
}

function isZodSchema(value: unknown): value is z.ZodType {
  return isRecord(value) && typeof value['safeParse'] === 'function'
}

export function toJsonSchemaObject(schema: unknown): JsonSchemaObject | null {
  if (!isZodSchema(schema)) return isJsonSchemaLike(schema) ? schema : null

  const jsonSchema = tryToJsonSchema(schema)
  return isRecord(jsonSchema) ? jsonSchema : null
}

function tryToJsonSchema(schema: z.ZodType): unknown {
  try {
    return z.toJSONSchema(schema)
  } catch {
    return null
  }
}

function getTypeLabel(schema: Readonly<Record<string, unknown>>): string {
  const type = schema['type']
  const enumValues = schema['enum']
  const anyOf = schema['anyOf']
  const oneOf = schema['oneOf']

  if (Array.isArray(enumValues)) {
    return `enum: ${enumValues.map((value) => JSON.stringify(value)).join(', ')}`
  }
  if (typeof type === 'string') return type
  if (Array.isArray(type)) return type.join(' | ')
  if (Array.isArray(anyOf) || Array.isArray(oneOf)) return 'union'
  return 'unknown'
}

function formatProperty(name: string, schema: unknown, required: boolean, indent: string): string {
  if (!isRecord(schema)) {
    return `${indent}${name}${required ? ' *required*' : ''}`
  }

  const description = schema['description']
  return [
    `${indent}${name}`,
    `(${getTypeLabel(schema)})`,
    ...(required ? ['*required*'] : []),
    ...(typeof description === 'string' && description.length > 0 ? [`- ${description}`] : []),
  ].join(' ')
}

function formatToolSchemaWithIndent(schema: unknown, indent: string): string {
  const jsonSchema = toJsonSchemaObject(schema)
  if (jsonSchema === null) return `${indent}(no schema)`

  const properties = jsonSchema['properties']
  if (!isRecord(properties)) return `${indent}(${getTypeLabel(jsonSchema)})`

  const entries = Object.entries(properties)
  if (entries.length === 0) return `${indent}(no parameters)`

  const required = Array.isArray(jsonSchema['required']) ? jsonSchema['required'] : []
  const requiredNames = new Set(required.filter((value): value is string => typeof value === 'string'))

  return entries
    .map(([name, propSchema]) => formatProperty(name, propSchema, requiredNames.has(name), indent))
    .join('\n')
}

export function formatToolSchema(schema: unknown): string
export function formatToolSchema(schema: unknown, indent: string): string
export function formatToolSchema(schema: unknown, ...indent: readonly string[]): string {
  const [firstIndent] = indent
  if (firstIndent === undefined) return formatToolSchemaWithIndent(schema, '  ')
  return formatToolSchemaWithIndent(schema, firstIndent)
}
