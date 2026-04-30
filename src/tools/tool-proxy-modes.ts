import type { ToolExecutionOptions, ToolSet } from 'ai'

import { findToolMetadata, type ToolMetadata } from './tool-metadata.js'
import { formatToolSchema } from './tool-schema-format.js'

type ProxyTextContent = {
  readonly type: 'text'
  readonly text: string
}

export type ProxyTextResult = {
  readonly content: readonly ProxyTextContent[]
  readonly details: Readonly<Record<string, unknown>>
}

export type ProxyRuntime = {
  readonly tools: ToolSet
  readonly metadata: readonly ToolMetadata[]
}

type ExecutableTool = {
  readonly execute: (args: unknown, options: ToolExecutionOptions) => unknown
}

type ParsedArgsResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly error: 'invalid_args_json' | 'invalid_args_type'; readonly message: string }

type SchemaArgsResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

type SafeParseResult = { readonly success: true; readonly data: unknown } | { readonly success: false }

type SafeParsableSchema = {
  readonly safeParse: (value: unknown) => unknown
}

function textResult(text: string, details: Readonly<Record<string, unknown>>): ProxyTextResult {
  return { content: [{ type: 'text', text }], details }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isExecutableTool(value: unknown): value is ExecutableTool {
  return isRecord(value) && typeof value['execute'] === 'function'
}

function isSafeParsableSchema(value: unknown): value is SafeParsableSchema {
  return isRecord(value) && typeof value['safeParse'] === 'function'
}

function isSafeParseResult(value: unknown): value is SafeParseResult {
  if (!isRecord(value)) return false

  const success = value['success']
  if (typeof success !== 'boolean') return false
  if (success) return Object.hasOwn(value, 'data')
  return true
}

function renderTool(metadata: ToolMetadata, includeSchema: boolean): string {
  const summary = [`${metadata.name}: ${metadata.description}`]
  if (!includeSchema) return summary.join('\n')
  return [...summary, 'Parameters:', formatToolSchema(metadata.inputSchema)].join('\n')
}

function toolSearchText(tool: ToolMetadata): string {
  return `${tool.name} ${tool.description}`
}

function splitTerms(query: string): readonly string[] {
  return query
    .trim()
    .split(/\s+/u)
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
}

function matchPlainQuery(tool: ToolMetadata, terms: readonly string[]): boolean {
  const searchableText = toolSearchText(tool).toLowerCase()
  return terms.some((term) => searchableText.includes(term.toLowerCase()))
}

function parseArgs(args: string | undefined): ParsedArgsResult {
  if (args === undefined || args.trim().length === 0) return { ok: true, value: {} }

  try {
    const parsed: unknown = JSON.parse(args)
    if (!isRecord(parsed)) {
      return {
        ok: false,
        error: 'invalid_args_type',
        message: 'Tool args must parse to a JSON object. Use an object like {"taskId":"task-1"}.',
      }
    }
    return { ok: true, value: parsed }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: 'invalid_args_json',
      message: `Invalid JSON in args: ${message}. Provide args as a JSON object string.`,
    }
  }
}

function missingToolResult(mode: 'describe' | 'call', toolName: string): ProxyTextResult {
  return textResult(
    `Tool not found: ${toolName}. Use search to find available tools, then retry with the exact tool name.`,
    {
      mode,
      error: 'tool_not_found',
      tool: toolName,
    },
  )
}

export function executeProxyStatus(metadata: readonly ToolMetadata[]): ProxyTextResult {
  return textResult(
    [
      `Papai tools: ${metadata.length} available.`,
      'Use search with words from a tool name or purpose, describe a tool for its schema, then call it with JSON args.',
    ].join('\n'),
    { mode: 'status', toolCount: metadata.length },
  )
}

export function executeProxySearch(
  metadata: readonly ToolMetadata[],
  query: string,
  regex: boolean | undefined,
  includeSchemas: boolean | undefined,
): ProxyTextResult {
  const useRegex = regex === true
  const terms = splitTerms(query)
  if (terms.length === 0) {
    return textResult('Search query cannot be empty. Provide one or more words from the tool name or purpose.', {
      mode: 'search',
      error: 'empty_query',
      query,
    })
  }

  const pattern = buildSearchPattern(query, useRegex)
  if (!pattern.ok) return pattern.result

  const includeSchema = includeSchemas !== false
  const matches = metadata.filter((toolMetadata) => pattern.matches(toolMetadata))
  const text =
    matches.length === 0
      ? `No tools found for search query "${query}". Try different words from the tool name or purpose.`
      : matches.map((toolMetadata) => renderTool(toolMetadata, includeSchema)).join('\n\n')
  return textResult(text, {
    mode: 'search',
    matches: matches.map((toolMetadata) => toolMetadata.name),
    count: matches.length,
    query,
  })
}

function buildSearchPattern(
  query: string,
  regex: boolean,
):
  | { readonly ok: true; readonly matches: (toolMetadata: ToolMetadata) => boolean }
  | { readonly ok: false; readonly result: ProxyTextResult } {
  if (!regex) {
    const terms = splitTerms(query)
    return { ok: true, matches: (toolMetadata) => matchPlainQuery(toolMetadata, terms) }
  }

  try {
    const pattern = new RegExp(query, 'i')
    return { ok: true, matches: (toolMetadata) => pattern.test(toolSearchText(toolMetadata)) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      result: textResult(`Invalid regex pattern: ${message}. Provide a valid JavaScript regular expression.`, {
        mode: 'search',
        error: 'invalid_pattern',
        query,
      }),
    }
  }
}

function validateArgsAgainstSchema(schema: unknown, args: Readonly<Record<string, unknown>>): SchemaArgsResult {
  if (!isSafeParsableSchema(schema)) return { ok: true, value: args }

  try {
    const result = schema.safeParse(args)
    if (!isSafeParseResult(result)) return { ok: true, value: args }
    return result.success ? { ok: true, value: result.data } : { ok: false }
  } catch {
    return { ok: true, value: args }
  }
}

function invalidToolArgsResult(requestedToolName: string, resolvedToolName: string, schema: unknown): ProxyTextResult {
  const expectedSchema = formatToolSchema(schema)
  return textResult(
    [`Invalid arguments for tool ${resolvedToolName}. Expected parameters:`, expectedSchema].join('\n'),
    {
      mode: 'call',
      error: 'invalid_tool_args',
      tool: requestedToolName,
      requestedTool: requestedToolName,
      resolvedTool: resolvedToolName,
      expectedSchema,
    },
  )
}

export function executeProxyDescribe(metadata: readonly ToolMetadata[], toolName: string): ProxyTextResult {
  const toolMetadata = findToolMetadata(metadata, toolName)
  if (toolMetadata === undefined) return missingToolResult('describe', toolName)

  return textResult(
    [
      `${toolMetadata.name}: ${toolMetadata.description}`,
      'Parameters:',
      formatToolSchema(toolMetadata.inputSchema),
    ].join('\n'),
    { mode: 'describe', tool: toolMetadata.name },
  )
}

export function executeProxyCall(
  runtime: ProxyRuntime,
  toolName: string,
  args: string | undefined,
  options: ToolExecutionOptions,
): unknown {
  const parsedArgs = parseArgs(args)
  if (!parsedArgs.ok) return textResult(parsedArgs.message, { mode: 'call', error: parsedArgs.error, tool: toolName })

  const toolMetadata = findToolMetadata(runtime.metadata, toolName)
  if (toolMetadata === undefined) return missingToolResult('call', toolName)

  const selectedTool: unknown = runtime.tools[toolMetadata.name]
  if (!isExecutableTool(selectedTool)) {
    return textResult(
      `Tool ${toolMetadata.name} cannot be executed directly. Use another available tool or search again.`,
      {
        mode: 'call',
        error: 'tool_not_executable',
        tool: toolMetadata.name,
      },
    )
  }

  const validation = validateArgsAgainstSchema(toolMetadata.inputSchema, parsedArgs.value)
  if (!validation.ok) return invalidToolArgsResult(toolName, toolMetadata.name, toolMetadata.inputSchema)

  return selectedTool.execute(validation.value, options)
}
