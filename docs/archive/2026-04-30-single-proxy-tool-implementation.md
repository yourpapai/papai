# Single Proxy Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace papai's default LLM-facing tool surface with one `papai_tool` proxy while preserving the existing internal tool implementations and behavior.

**Architecture:** Keep `buildTools()` as the authoritative internal registry, wrap internal executors with `wrapToolExecution()`, derive in-memory metadata from the wrapped toolset, and expose only one AI SDK tool from `makeTools()`. The proxy supports status, search, describe, and call modes with JSON-string arguments.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK `ToolSet` and `tool()`, Zod v4, Bun test runner, existing OpenAI-compatible model setup for the benchmark.

---

## File Structure

- Create: `src/tools/tool-schema-format.ts`
  Converts Zod or JSON-like input schemas to concise text for search, describe, and error hints.
- Create: `tests/tools/tool-schema-format.test.ts`
  Covers formatting for object properties, required fields, descriptions, enums, empty objects, and unknown schemas.
- Create: `src/tools/tool-metadata.ts`
  Extracts stable `{ name, description, inputSchema, executable }` records from a `ToolSet` and resolves tool names.
- Create: `tests/tools/tool-metadata.test.ts`
  Covers metadata extraction, non-executable tool handling, and hyphen/underscore name resolution.
- Create: `src/tools/tool-proxy-modes.ts`
  Implements status, search, describe, and call mode functions.
- Create: `tests/tools/tool-proxy-modes.test.ts`
  Covers deterministic proxy mode behavior and LLM-readable errors.
- Create: `src/tools/tool-proxy.ts`
  Creates the `papai_tool` AI SDK tool with compact schema and delegates execution to proxy modes.
- Create: `tests/tools/tool-proxy.test.ts`
  Covers proxy schema validation and mode priority through the exported tool executor.
- Modify: `src/tools/index.ts`
  Keeps internal wrapping, then returns `{ papai_tool }` by default.
- Modify: `tests/tools/tools-builder.test.ts`
  Adds integration coverage for default proxy-only `makeTools()` output and internal gating through the proxy.
- Create: `scripts/tool-proxy-benchmark.ts`
  Runs direct-vs-proxy fake-tool benchmarks against configured OpenAI-compatible models.
- Create: `tests/scripts/tool-proxy-benchmark.test.ts`
  Covers benchmark argument parsing and result summarization without external model calls.
- Modify: `package.json`
  Adds `benchmark:tool-proxy` script.

---

### Task 1: Schema Formatting

**Files:**

- Create: `tests/tools/tool-schema-format.test.ts`
- Create: `src/tools/tool-schema-format.ts`

- [ ] **Step 1: Write the failing schema formatter tests**

Create `tests/tools/tool-schema-format.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { z } from 'zod'

import { formatToolSchema, toJsonSchemaObject } from '../../src/tools/tool-schema-format.js'

describe('tool-schema-format', () => {
  it('converts a Zod object schema to JSON schema metadata', () => {
    const schema = z.object({
      taskId: z.string().describe('Task identifier'),
      priority: z.enum(['low', 'high']).optional().describe('Priority value'),
    })

    const json = toJsonSchemaObject(schema)

    expect(json?.type).toBe('object')
    expect(json?.properties).toBeObject()
    expect((json?.properties as Record<string, unknown>)['taskId']).toBeObject()
  })

  it('formats required, optional, descriptions, and enum values', () => {
    const schema = z.object({
      taskId: z.string().describe('Task identifier'),
      priority: z.enum(['low', 'high']).optional().describe('Priority value'),
    })

    expect(formatToolSchema(schema)).toBe(
      ['  taskId (string) *required* - Task identifier', '  priority (enum: "low", "high") - Priority value'].join(
        '\n',
      ),
    )
  })

  it('formats JSON schema objects directly', () => {
    const schema = {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number' },
      },
      required: ['query'],
    }

    expect(formatToolSchema(schema)).toBe(['  query (string) *required* - Search query', '  limit (number)'].join('\n'))
  })

  it('formats empty object schemas as no parameters', () => {
    expect(formatToolSchema(z.object({}))).toBe('  (no parameters)')
  })

  it('returns no schema for unsupported schema values', () => {
    expect(toJsonSchemaObject('not-a-schema')).toBeNull()
    expect(formatToolSchema('not-a-schema')).toBe('  (no schema)')
  })
})
```

- [ ] **Step 2: Run the schema formatter tests to verify they fail**

Run: `bun test tests/tools/tool-schema-format.test.ts`

Expected: FAIL because `src/tools/tool-schema-format.ts` does not exist.

- [ ] **Step 3: Implement the schema formatter**

Create `src/tools/tool-schema-format.ts`:

```typescript
import { z } from 'zod'

type JsonSchemaObject = Record<string, unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonSchemaLike(value: unknown): value is JsonSchemaObject {
  if (!isRecord(value)) return false
  return typeof value['type'] === 'string' || isRecord(value['properties'])
}

function isZodSchema(value: unknown): value is z.ZodType {
  return isRecord(value) && typeof value['safeParse'] === 'function'
}

export function toJsonSchemaObject(schema: unknown): JsonSchemaObject | null {
  if (isJsonSchemaLike(schema)) return schema
  if (!isZodSchema(schema)) return null

  const jsonSchema = z.toJSONSchema(schema)
  return isRecord(jsonSchema) ? jsonSchema : null
}

function getTypeLabel(schema: Record<string, unknown>): string {
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

  const parts = [`${indent}${name}`, `(${getTypeLabel(schema)})`]
  if (required) parts.push('*required*')
  if (typeof schema['description'] === 'string' && schema['description'].length > 0) {
    parts.push(`- ${schema['description']}`)
  }
  return parts.join(' ')
}

export function formatToolSchema(schema: unknown, indent = '  '): string {
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
```

- [ ] **Step 4: Run the schema formatter tests to verify they pass**

Run: `bun test tests/tools/tool-schema-format.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit schema formatting**

```bash
git add tests/tools/tool-schema-format.test.ts src/tools/tool-schema-format.ts
git commit -m "feat: add tool schema formatting"
```

---

### Task 2: Tool Metadata Extraction

**Files:**

- Create: `tests/tools/tool-metadata.test.ts`
- Create: `src/tools/tool-metadata.ts`

- [ ] **Step 1: Write the failing metadata tests**

Create `tests/tools/tool-metadata.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'

import { buildToolMetadata, findToolMetadata } from '../../src/tools/tool-metadata.js'

describe('tool-metadata', () => {
  it('extracts name, description, schema, and executable flag', () => {
    const tools: ToolSet = {
      search_tasks: tool({
        description: 'Search tasks by text',
        inputSchema: z.object({ query: z.string().describe('Search text') }),
        execute: async () => [],
      }),
    }

    const metadata = buildToolMetadata(tools)

    expect(metadata).toHaveLength(1)
    expect(metadata[0]).toMatchObject({
      name: 'search_tasks',
      description: 'Search tasks by text',
      executable: true,
    })
    expect(metadata[0]?.inputSchema).toBeDefined()
  })

  it('keeps non-executable tools visible for describe errors', () => {
    const tools = {
      queued_tool: {
        description: 'Queued tool without local executor',
        inputSchema: z.object({ id: z.string() }),
      },
    } as unknown as ToolSet

    expect(buildToolMetadata(tools)[0]).toMatchObject({
      name: 'queued_tool',
      description: 'Queued tool without local executor',
      executable: false,
    })
  })

  it('resolves exact and hyphen-normalized tool names', () => {
    const metadata = buildToolMetadata({
      add_task_relation: tool({
        description: 'Add relation',
        inputSchema: z.object({ taskId: z.string() }),
        execute: async () => ({}),
      }),
    })

    expect(findToolMetadata(metadata, 'add_task_relation')?.name).toBe('add_task_relation')
    expect(findToolMetadata(metadata, 'add-task-relation')?.name).toBe('add_task_relation')
  })
})
```

- [ ] **Step 2: Run the metadata tests to verify they fail**

Run: `bun test tests/tools/tool-metadata.test.ts`

Expected: FAIL because `src/tools/tool-metadata.ts` does not exist.

- [ ] **Step 3: Implement metadata extraction**

Create `src/tools/tool-metadata.ts`:

```typescript
import type { ToolSet } from 'ai'

export type ToolMetadata = {
  readonly name: string
  readonly description: string
  readonly inputSchema: unknown
  readonly executable: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeToolName(value: string): string {
  return value.replace(/-/g, '_')
}

export function buildToolMetadata(tools: ToolSet): readonly ToolMetadata[] {
  return Object.entries(tools).flatMap(([name, tool]) => {
    if (!isRecord(tool)) return []
    const description = typeof tool['description'] === 'string' ? tool['description'] : ''
    return [
      {
        name,
        description,
        inputSchema: tool['inputSchema'],
        executable: typeof tool['execute'] === 'function',
      },
    ]
  })
}

export function findToolMetadata(metadata: readonly ToolMetadata[], toolName: string): ToolMetadata | undefined {
  const exact = metadata.find((tool) => tool.name === toolName)
  if (exact !== undefined) return exact

  const normalized = normalizeToolName(toolName)
  return metadata.find((tool) => normalizeToolName(tool.name) === normalized)
}
```

- [ ] **Step 4: Run metadata and schema tests**

Run: `bun test tests/tools/tool-metadata.test.ts tests/tools/tool-schema-format.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit metadata extraction**

```bash
git add tests/tools/tool-metadata.test.ts src/tools/tool-metadata.ts
git commit -m "feat: add tool metadata extraction"
```

---

### Task 3: Proxy Modes

**Files:**

- Create: `tests/tools/tool-proxy-modes.test.ts`
- Create: `src/tools/tool-proxy-modes.ts`

- [ ] **Step 1: Write failing proxy mode tests**

Create `tests/tools/tool-proxy-modes.test.ts`:

```typescript
import { describe, expect, it, mock } from 'bun:test'
import { tool, type ToolExecutionOptions, type ToolSet } from 'ai'
import { z } from 'zod'

import { buildToolMetadata } from '../../src/tools/tool-metadata.js'
import {
  executeProxyCall,
  executeProxyDescribe,
  executeProxySearch,
  executeProxyStatus,
} from '../../src/tools/tool-proxy-modes.js'

const toolOptions: ToolExecutionOptions = { toolCallId: 'call-1', messages: [] }

function buildRuntime(tools: ToolSet) {
  return { tools, metadata: buildToolMetadata(tools) }
}

describe('tool-proxy-modes', () => {
  it('returns compact status guidance', () => {
    const runtime = buildRuntime({
      search_tasks: tool({
        description: 'Search tasks',
        inputSchema: z.object({ query: z.string() }),
        execute: async () => [],
      }),
    })

    const result = executeProxyStatus(runtime.metadata)

    expect(result.details).toMatchObject({ mode: 'status', toolCount: 1 })
    expect(result.content[0]?.text).toContain('Papai tools: 1 available')
    expect(result.content[0]?.text).toContain('search')
  })

  it('searches names and descriptions with OR terms and schemas by default', () => {
    const runtime = buildRuntime({
      search_tasks: tool({
        description: 'Search task titles',
        inputSchema: z.object({ query: z.string().describe('Search text') }),
        execute: async () => [],
      }),
      add_comment: tool({
        description: 'Comment on a task',
        inputSchema: z.object({ body: z.string() }),
        execute: async () => ({}),
      }),
    })

    const result = executeProxySearch(runtime.metadata, 'comment find', false, true)

    expect(result.details).toMatchObject({ mode: 'search', count: 1, query: 'comment find' })
    expect(result.content[0]?.text).toContain('add_comment')
    expect(result.content[0]?.text).toContain('body (string)')
  })

  it('returns a clear empty-query error', () => {
    const result = executeProxySearch([], '   ', false, true)

    expect(result.details).toMatchObject({ mode: 'search', error: 'empty_query' })
    expect(result.content[0]?.text).toBe(
      'Search query cannot be empty. Provide one or more words from the tool name or purpose.',
    )
  })

  it('describes one tool with its schema', () => {
    const runtime = buildRuntime({
      update_task: tool({
        description: 'Update a task',
        inputSchema: z.object({ taskId: z.string().describe('Task identifier') }),
        execute: async () => ({}),
      }),
    })

    const result = executeProxyDescribe(runtime.metadata, 'update-task')

    expect(result.details).toMatchObject({ mode: 'describe', tool: 'update_task' })
    expect(result.content[0]?.text).toContain('Update a task')
    expect(result.content[0]?.text).toContain('taskId (string) *required* - Task identifier')
  })

  it('calls the selected wrapped tool with parsed JSON args', async () => {
    const execute = mock(async ({ taskId }: { taskId: string }) => ({ ok: true, taskId }))
    const runtime = buildRuntime({
      get_task: tool({
        description: 'Get task',
        inputSchema: z.object({ taskId: z.string() }),
        execute,
      }),
    })

    const result = await executeProxyCall(runtime, 'get_task', '{"taskId":"task-1"}', toolOptions)

    expect(result).toEqual({ ok: true, taskId: 'task-1' })
    expect(execute).toHaveBeenCalledWith({ taskId: 'task-1' }, toolOptions)
  })

  it('returns clear invalid args errors', async () => {
    const runtime = buildRuntime({})

    const invalidJson = await executeProxyCall(runtime, 'get_task', '{bad', toolOptions)
    expect(invalidJson).toMatchObject({ details: { mode: 'call', error: 'invalid_args_json' } })
    expect(invalidJson.content[0].text).toContain('Invalid JSON in args')

    const invalidType = await executeProxyCall(runtime, 'get_task', '[1,2]', toolOptions)
    expect(invalidType).toMatchObject({ details: { mode: 'call', error: 'invalid_args_type' } })
    expect(invalidType.content[0].text).toContain('must parse to a JSON object')
  })

  it('returns tool_not_found and tool_not_executable errors', async () => {
    const runtime = buildRuntime({
      queued_tool: {
        description: 'Queued tool',
        inputSchema: z.object({ id: z.string() }),
      },
    } as unknown as ToolSet)

    const missing = await executeProxyCall(runtime, 'missing_tool', '{}', toolOptions)
    expect(missing).toMatchObject({ details: { mode: 'call', error: 'tool_not_found' } })
    expect(missing.content[0].text).toContain('Use search to find available tools')

    const notExecutable = await executeProxyCall(runtime, 'queued_tool', '{}', toolOptions)
    expect(notExecutable).toMatchObject({ details: { mode: 'call', error: 'tool_not_executable' } })
    expect(notExecutable.content[0].text).toContain('cannot be executed directly')
  })
})
```

- [ ] **Step 2: Run proxy mode tests to verify they fail**

Run: `bun test tests/tools/tool-proxy-modes.test.ts`

Expected: FAIL because `src/tools/tool-proxy-modes.ts` does not exist.

- [ ] **Step 3: Implement proxy modes**

Create `src/tools/tool-proxy-modes.ts`:

```typescript
import type { ToolExecutionOptions, ToolSet } from 'ai'

import { findToolMetadata, type ToolMetadata } from './tool-metadata.js'
import { formatToolSchema } from './tool-schema-format.js'

export type ProxyTextResult = {
  readonly content: readonly [{ readonly type: 'text'; readonly text: string }]
  readonly details: Record<string, unknown>
}

export type ProxyRuntime = {
  readonly tools: ToolSet
  readonly metadata: readonly ToolMetadata[]
}

function textResult(text: string, details: Record<string, unknown>): ProxyTextResult {
  return { content: [{ type: 'text', text }], details }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function escapeRegexTerm(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildSearchPattern(query: string, regex: boolean | undefined): RegExp | ProxyTextResult {
  if (regex === true) {
    try {
      return new RegExp(query, 'i')
    } catch {
      return textResult('Invalid regex search pattern. Retry with a simpler search string or set regex to false.', {
        mode: 'search',
        error: 'invalid_pattern',
        query,
      })
    }
  }

  const terms = query
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0)
  if (terms.length === 0) {
    return textResult('Search query cannot be empty. Provide one or more words from the tool name or purpose.', {
      mode: 'search',
      error: 'empty_query',
      query,
    })
  }
  return new RegExp(terms.map(escapeRegexTerm).join('|'), 'i')
}

function formatSearchMatch(tool: ToolMetadata, includeSchemas: boolean): string {
  if (!includeSchemas) {
    const suffix = tool.description.length > 0 ? ` - ${tool.description}` : ''
    return `- ${tool.name}${suffix}`
  }

  const lines = [tool.name, `  ${tool.description.length > 0 ? tool.description : '(no description)'}`]
  lines.push('', `  Parameters:\n${formatToolSchema(tool.inputSchema, '    ')}`)
  return lines.join('\n')
}

function parseArgs(
  args: string | undefined,
): { ok: true; value: Record<string, unknown> } | { ok: false; result: ProxyTextResult } {
  if (args === undefined || args.trim().length === 0) return { ok: true, value: {} }

  let parsed: unknown
  try {
    parsed = JSON.parse(args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      result: textResult(
        `Invalid JSON in args. Provide args as a JSON object string like "{\\"taskId\\":\\"...\\"}". Parser message: ${message}`,
        { mode: 'call', error: 'invalid_args_json', message },
      ),
    }
  }

  if (!isRecord(parsed)) {
    const gotType = Array.isArray(parsed) ? 'array' : parsed === null ? 'null' : typeof parsed
    return {
      ok: false,
      result: textResult(
        `Invalid args type. The args string must parse to a JSON object, not an array, null, string, number, or boolean. Got ${gotType}.`,
        { mode: 'call', error: 'invalid_args_type', gotType },
      ),
    }
  }

  return { ok: true, value: parsed }
}

export function executeProxyStatus(metadata: readonly ToolMetadata[]): ProxyTextResult {
  const text = [
    `Papai tools: ${metadata.length} available.`,
    'Use search to find tools, describe to inspect one tool, or call a tool with JSON-string args.',
    'Examples: papai_tool({ search: "task" }); papai_tool({ describe: "create_task" }); papai_tool({ tool: "get_task", args: "{\\"taskId\\":\\"...\\"}" }).',
  ].join('\n')

  return textResult(text, { mode: 'status', toolCount: metadata.length })
}

export function executeProxySearch(
  metadata: readonly ToolMetadata[],
  query: string,
  regex: boolean | undefined,
  includeSchemas: boolean | undefined,
): ProxyTextResult {
  const pattern = buildSearchPattern(query, regex)
  if (!(pattern instanceof RegExp)) return pattern

  const matches = metadata.filter((tool) => pattern.test(tool.name) || pattern.test(tool.description))
  if (matches.length === 0) {
    return textResult(`No tools matching "${query}". Try broader terms like "task", "project", "memo", or "comment".`, {
      mode: 'search',
      matches: [],
      count: 0,
      query,
    })
  }

  const showSchemas = includeSchemas !== false
  const body = matches.map((tool) => formatSearchMatch(tool, showSchemas)).join('\n\n')
  return textResult(`Found ${matches.length} tool${matches.length === 1 ? '' : 's'} matching "${query}":\n\n${body}`, {
    mode: 'search',
    matches: matches.map((tool) => tool.name),
    count: matches.length,
    query,
  })
}

export function executeProxyDescribe(metadata: readonly ToolMetadata[], toolName: string): ProxyTextResult {
  const found = findToolMetadata(metadata, toolName)
  if (found === undefined) {
    return textResult(
      `Tool "${toolName}" was not found in this context. Use search to find available tools before calling one.`,
      {
        mode: 'describe',
        error: 'tool_not_found',
        requestedTool: toolName,
      },
    )
  }

  const text = [
    found.name,
    '',
    found.description.length > 0 ? found.description : '(no description)',
    '',
    `Parameters:\n${formatToolSchema(found.inputSchema)}`,
  ].join('\n')
  return textResult(text, { mode: 'describe', tool: found.name })
}

export async function executeProxyCall(
  runtime: ProxyRuntime,
  toolName: string,
  args: string | undefined,
  options: ToolExecutionOptions,
): Promise<unknown> {
  const parsed = parseArgs(args)
  if (!parsed.ok) return parsed.result

  const found = findToolMetadata(runtime.metadata, toolName)
  if (found === undefined) {
    return textResult(
      `Tool "${toolName}" was not found in this context. Use search to find available tools before calling one.`,
      {
        mode: 'call',
        error: 'tool_not_found',
        requestedTool: toolName,
      },
    )
  }

  const target = runtime.tools[found.name]
  const execute = isRecord(target) ? target['execute'] : undefined
  if (typeof execute !== 'function') {
    return textResult(
      `Tool "${found.name}" cannot be executed directly in this context. Use search or describe to choose another available tool.`,
      {
        mode: 'call',
        error: 'tool_not_executable',
        requestedTool: toolName,
        tool: found.name,
      },
    )
  }

  return execute(parsed.value, options)
}
```

- [ ] **Step 4: Run proxy mode and dependency tests**

Run: `bun test tests/tools/tool-proxy-modes.test.ts tests/tools/tool-metadata.test.ts tests/tools/tool-schema-format.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit proxy modes**

```bash
git add tests/tools/tool-proxy-modes.test.ts src/tools/tool-proxy-modes.ts
git commit -m "feat: add papai tool proxy modes"
```

---

### Task 4: Proxy Tool Factory And Default Assembly

**Files:**

- Create: `tests/tools/tool-proxy.test.ts`
- Create: `src/tools/tool-proxy.ts`
- Modify: `tests/tools/tools-builder.test.ts`
- Modify: `src/tools/index.ts`

- [ ] **Step 1: Write failing proxy factory tests**

Create `tests/tools/tool-proxy.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { tool, type ToolExecutionOptions, type ToolSet } from 'ai'
import { z } from 'zod'

import { makeToolProxy } from '../../src/tools/tool-proxy.js'
import { getToolExecutor, schemaValidates } from '../utils/test-helpers.js'

const toolOptions: ToolExecutionOptions = { toolCallId: 'proxy-call-1', messages: [] }

describe('makeToolProxy', () => {
  it('accepts compact proxy input schema', () => {
    const proxy = makeToolProxy({})

    expect(schemaValidates(proxy, {})).toBe(true)
    expect(schemaValidates(proxy, { search: 'task' })).toBe(true)
    expect(schemaValidates(proxy, { describe: 'create_task' })).toBe(true)
    expect(schemaValidates(proxy, { tool: 'get_task', args: '{"taskId":"task-1"}' })).toBe(true)
    expect(schemaValidates(proxy, { args: { taskId: 'task-1' } })).toBe(false)
  })

  it('uses call mode before search or describe when tool is present', async () => {
    const internalTools: ToolSet = {
      get_task: tool({
        description: 'Get a task',
        inputSchema: z.object({ taskId: z.string() }),
        execute: async ({ taskId }) => ({ called: 'get_task', taskId }),
      }),
    }
    const proxy = makeToolProxy(internalTools)

    const result = await getToolExecutor(proxy)(
      { tool: 'get_task', search: 'comment', describe: 'search_tasks', args: '{"taskId":"task-1"}' },
      toolOptions,
    )

    expect(result).toEqual({ called: 'get_task', taskId: 'task-1' })
  })

  it('returns status when no mode field is provided', async () => {
    const proxy = makeToolProxy({})

    const result = await getToolExecutor(proxy)({}, toolOptions)

    expect(result).toMatchObject({ details: { mode: 'status', toolCount: 0 } })
  })
})
```

- [ ] **Step 2: Add failing `makeTools()` integration tests**

Append this `describe` block to `tests/tools/tools-builder.test.ts`. Use `makeTools` instead of `buildTools` because `buildTools` remains the internal direct registry.

```typescript
describe('makeTools proxy integration', () => {
  it('exposes only papai_tool by default', () => {
    const provider = createMockProvider()

    const tools = makeTools(provider, { storageContextId: 'user-123', chatUserId: 'user-123', contextType: 'dm' })

    expect(Object.keys(tools)).toEqual(['papai_tool'])
  })

  it('keeps internal context gating available through proxy search', async () => {
    const provider = createMockProvider({
      identityResolver: {
        searchUsers: () => Promise.resolve([]),
      },
    })

    const dmTools = makeTools(provider, { storageContextId: 'user-123', chatUserId: 'user-123', contextType: 'dm' })
    const groupTools = makeTools(provider, {
      storageContextId: 'group-123',
      chatUserId: 'user-123',
      contextType: 'group',
    })

    const dmResult = await getToolExecutor(dmTools['papai_tool'])(
      { search: 'identity', includeSchemas: false },
      {
        toolCallId: 'dm-search',
        messages: [],
      },
    )
    const groupResult = await getToolExecutor(groupTools['papai_tool'])(
      { search: 'identity', includeSchemas: false },
      {
        toolCallId: 'group-search',
        messages: [],
      },
    )

    expect(JSON.stringify(dmResult)).not.toContain('set_my_identity')
    expect(JSON.stringify(groupResult)).toContain('set_my_identity')
  })
})
```

Also add `makeTools` to the existing import at the top of `tests/tools/tools-builder.test.ts`:

```typescript
import { makeTools } from '../../src/tools/index.js'
```

- [ ] **Step 3: Run proxy factory and integration tests to verify they fail**

Run: `bun test tests/tools/tool-proxy.test.ts tests/tools/tools-builder.test.ts`

Expected: FAIL because `src/tools/tool-proxy.ts` does not exist and `makeTools()` still exposes direct tools.

- [ ] **Step 4: Implement the proxy factory**

Create `src/tools/tool-proxy.ts`:

```typescript
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { buildToolMetadata } from './tool-metadata.js'
import { executeProxyCall, executeProxyDescribe, executeProxySearch, executeProxyStatus } from './tool-proxy-modes.js'

export function makeToolProxy(internalTools: ToolSet): ToolSet[string] {
  const metadata = buildToolMetadata(internalTools)
  const runtime = { tools: internalTools, metadata }

  return tool({
    description: [
      'Papai tool gateway. Use this single tool to discover and call papai task, memo, project, identity, web, recurring, and deferred-prompt tools.',
      'Call with search to find tools, describe to inspect parameters, or tool plus args to execute. Args must be a JSON object encoded as a string.',
    ].join(' '),
    inputSchema: z.object({
      tool: z.string().optional().describe('Underlying papai tool name to call, for example "create_task"'),
      args: z
        .string()
        .optional()
        .describe('Arguments for the underlying tool as a JSON object string, for example "{\"taskId\":\"task-1\"}"'),
      describe: z.string().optional().describe('Underlying papai tool name to describe before calling it'),
      search: z.string().optional().describe('Search words for finding papai tools by name or description'),
      regex: z
        .boolean()
        .optional()
        .describe('Treat search as a regular expression instead of space-separated OR terms'),
      includeSchemas: z.boolean().optional().describe('Include parameter schemas in search results; defaults to true'),
    }),
    execute: async ({ tool: toolName, args, describe, search, regex, includeSchemas }, options) => {
      if (toolName !== undefined) return executeProxyCall(runtime, toolName, args, options)
      if (describe !== undefined) return executeProxyDescribe(metadata, describe)
      if (search !== undefined) return executeProxySearch(metadata, search, regex, includeSchemas)
      return executeProxyStatus(metadata)
    },
  })
}
```

- [ ] **Step 5: Modify `makeTools()` to expose only `papai_tool`**

Update `src/tools/index.ts` to import `makeToolProxy` and return a proxy-only toolset:

```typescript
import type { ToolSet } from 'ai'

import type { TaskProvider } from '../providers/types.js'
import { buildTools } from './tools-builder.js'
import { makeToolProxy } from './tool-proxy.js'
import type { MakeToolsOptions, ToolMode } from './types.js'
import { wrapToolExecution } from './wrap-tool-execution.js'

export type { MakeToolsOptions, ToolMode }

function wrapToolSet(tools: ToolSet): ToolSet {
  const wrapped: ToolSet = {}
  for (const [name, tool] of Object.entries(tools)) {
    if (tool === undefined || tool === null) continue
    if (tool.execute === undefined) continue
    wrapped[name] = {
      ...tool,
      execute: wrapToolExecution(tool.execute.bind(tool), name),
    }
  }
  return wrapped
}

/**
 * Build a proxy-only tool set for the given provider and context.
 *
 * The full context-aware tool registry remains internal and is available through `papai_tool`.
 */
export function makeTools(provider: TaskProvider, options?: MakeToolsOptions): ToolSet {
  const storageContextId = options?.storageContextId
  const chatUserId = options?.chatUserId
  const username = options?.username
  const contextId = storageContextId
  const mode = options?.mode ?? 'normal'
  const contextType = options?.contextType

  const internalTools = buildTools(provider, chatUserId, contextId, mode, contextType, username)
  const wrappedInternalTools = wrapToolSet(internalTools)
  return { papai_tool: makeToolProxy(wrappedInternalTools) }
}
```

- [ ] **Step 6: Run proxy factory and integration tests**

Run: `bun test tests/tools/tool-proxy.test.ts tests/tools/tools-builder.test.ts tests/tools/tool-proxy-modes.test.ts`

Expected: PASS.

- [ ] **Step 7: Run orchestrator tests that observe tool count**

Run: `bun test tests/llm-orchestrator.test.ts tests/llm-orchestrator-events.test.ts tests/llm-orchestrator-steps.test.ts`

Expected: PASS. If a test asserts the old direct tool count, update the expected count to `1` and assert `papai_tool` is present.

- [ ] **Step 8: Commit proxy assembly**

```bash
git add tests/tools/tool-proxy.test.ts tests/tools/tools-builder.test.ts src/tools/tool-proxy.ts src/tools/index.ts
git commit -m "feat: expose papai tools through single proxy"
```

---

### Task 5: Benchmark Script

**Files:**

- Create: `tests/scripts/tool-proxy-benchmark.test.ts`
- Create: `scripts/tool-proxy-benchmark.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing benchmark utility tests**

Create `tests/scripts/tool-proxy-benchmark.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'

import { parseBenchmarkArgs, summarizeBenchmarkResults } from '../../scripts/tool-proxy-benchmark.js'

describe('tool-proxy-benchmark utilities', () => {
  it('parses explicit benchmark flags', () => {
    const args = parseBenchmarkArgs([
      '--base-url',
      'https://llm.example/v1',
      '--api-key-env',
      'TEST_KEY',
      '--models',
      'model-a,model-b',
      '--output',
      'docs/superpowers/plans/result.md',
      '--repetitions',
      '2',
    ])

    expect(args).toEqual({
      baseUrl: 'https://llm.example/v1',
      apiKeyEnv: 'TEST_KEY',
      models: ['model-a', 'model-b'],
      outputPath: 'docs/superpowers/plans/result.md',
      repetitions: 2,
    })
  })

  it('rejects missing flag values and invalid repetitions', () => {
    expect(() => parseBenchmarkArgs(['--models'])).toThrow('Missing value for --models')
    expect(() => parseBenchmarkArgs(['--repetitions', '0'])).toThrow(
      'Invalid positive integer value for --repetitions: 0',
    )
  })

  it('summarizes success rate by model and mode', () => {
    const markdown = summarizeBenchmarkResults([
      {
        model: 'model-a',
        mode: 'direct',
        scenario: 'create-task',
        success: true,
        toolCallCount: 1,
        stepCount: 1,
        failureCategory: null,
      },
      {
        model: 'model-a',
        mode: 'direct',
        scenario: 'delete-task',
        success: false,
        toolCallCount: 1,
        stepCount: 1,
        failureCategory: 'confirmation_error',
      },
      {
        model: 'model-a',
        mode: 'proxy',
        scenario: 'create-task',
        success: true,
        toolCallCount: 2,
        stepCount: 2,
        failureCategory: null,
      },
    ])

    expect(markdown).toContain('| model-a | direct | 2 | 50.0% | 1.0 | 1.0 | confirmation_error: 1 |')
    expect(markdown).toContain('| model-a | proxy | 1 | 100.0% | 2.0 | 2.0 | none |')
  })
})
```

- [ ] **Step 2: Run benchmark utility tests to verify they fail**

Run: `bun test tests/scripts/tool-proxy-benchmark.test.ts`

Expected: FAIL because `scripts/tool-proxy-benchmark.ts` does not exist.

- [ ] **Step 3: Implement benchmark script exports and runner**

Create `scripts/tool-proxy-benchmark.ts`:

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, tool, type ToolSet } from 'ai'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import { makeToolProxy } from '../src/tools/tool-proxy.js'

export type BenchmarkMode = 'direct' | 'proxy'

export type BenchmarkArgs = {
  readonly baseUrl: string
  readonly apiKeyEnv: string
  readonly models: readonly string[]
  readonly outputPath: string
  readonly repetitions: number
}

export type BenchmarkResult = {
  readonly model: string
  readonly mode: BenchmarkMode
  readonly scenario: string
  readonly success: boolean
  readonly toolCallCount: number
  readonly stepCount: number
  readonly failureCategory: string | null
}

type FakeState = {
  readonly calls: string[]
  readonly tasks: Map<string, { title: string; status: string; comments: string[]; assignee?: string }>
}

type Scenario = {
  readonly name: string
  readonly prompt: string
  readonly evaluate: (state: FakeState) => { readonly success: boolean; readonly failureCategory: string | null }
}

const defaultArgs = (): BenchmarkArgs => ({
  baseUrl: process.env['TOOL_PROXY_BENCHMARK_BASE_URL'] ?? process.env['LLM_BASE_URL'] ?? 'https://api.openai.com/v1',
  apiKeyEnv: process.env['TOOL_PROXY_BENCHMARK_API_KEY_ENV'] ?? 'TOOL_PROXY_BENCHMARK_API_KEY',
  models: (process.env['TOOL_PROXY_BENCHMARK_MODELS'] ?? 'gpt-4.1-mini')
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0),
  outputPath: 'docs/superpowers/plans/tool-proxy-benchmark-results.md',
  repetitions: 1,
})

function requireFlagValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('--')) throw new TypeError(`Missing value for ${flag}`)
  return value
}

function parsePositiveInteger(flag: string, value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new TypeError(`Invalid positive integer value for ${flag}: ${value}`)
  return parsed
}

function parseArgsRecursive(args: readonly string[], index: number, current: BenchmarkArgs): BenchmarkArgs {
  const flag = args[index]
  const value = args[index + 1]
  if (flag === undefined) return current
  if (flag === '--base-url')
    return parseArgsRecursive(args, index + 2, { ...current, baseUrl: requireFlagValue(flag, value) })
  if (flag === '--api-key-env')
    return parseArgsRecursive(args, index + 2, { ...current, apiKeyEnv: requireFlagValue(flag, value) })
  if (flag === '--models') {
    const models = requireFlagValue(flag, value)
      .split(',')
      .map((model) => model.trim())
      .filter((model) => model.length > 0)
    return parseArgsRecursive(args, index + 2, { ...current, models })
  }
  if (flag === '--output')
    return parseArgsRecursive(args, index + 2, { ...current, outputPath: requireFlagValue(flag, value) })
  if (flag === '--repetitions') {
    return parseArgsRecursive(args, index + 2, {
      ...current,
      repetitions: parsePositiveInteger(flag, requireFlagValue(flag, value)),
    })
  }
  if (flag.startsWith('--')) throw new TypeError(`Unknown flag: ${flag}`)
  throw new TypeError(`Unexpected positional argument: ${flag}`)
}

export function parseBenchmarkArgs(args: readonly string[]): BenchmarkArgs {
  return parseArgsRecursive(args, 0, defaultArgs())
}

function createFakeState(): FakeState {
  return { calls: [], tasks: new Map() }
}

function createFakeTools(state: FakeState): ToolSet {
  return {
    create_task: tool({
      description: 'Create a task with a title and optional priority.',
      inputSchema: z.object({ title: z.string(), priority: z.string().optional() }),
      execute: async ({ title }) => {
        state.calls.push('create_task')
        state.tasks.set('task-1', { title, status: 'todo', comments: [] })
        return { id: 'task-1', title, status: 'todo' }
      },
    }),
    search_tasks: tool({
      description: 'Search tasks by title text.',
      inputSchema: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        state.calls.push('search_tasks')
        return [...state.tasks.entries()]
          .filter(([, task]) => task.title.toLowerCase().includes(query.toLowerCase()))
          .map(([id, task]) => ({ id, ...task }))
      },
    }),
    update_task: tool({
      description: 'Update task status.',
      inputSchema: z.object({ taskId: z.string(), status: z.string() }),
      execute: async ({ taskId, status }) => {
        state.calls.push('update_task')
        const task = state.tasks.get(taskId)
        if (task !== undefined) state.tasks.set(taskId, { ...task, status })
        return { id: taskId, status }
      },
    }),
    add_comment: tool({
      description: 'Add a comment to a task.',
      inputSchema: z.object({ taskId: z.string(), body: z.string() }),
      execute: async ({ taskId, body }) => {
        state.calls.push('add_comment')
        const task = state.tasks.get(taskId)
        if (task !== undefined) task.comments.push(body)
        return { id: 'comment-1', body }
      },
    }),
    assign_user: tool({
      description: 'Assign a user to a task.',
      inputSchema: z.object({ taskId: z.string(), userId: z.string() }),
      execute: async ({ taskId, userId }) => {
        state.calls.push('assign_user')
        const task = state.tasks.get(taskId)
        if (task !== undefined) state.tasks.set(taskId, { ...task, assignee: userId })
        return { taskId, userId }
      },
    }),
    get_current_time: tool({
      description: 'Get the current date and time.',
      inputSchema: z.object({}),
      execute: async () => {
        state.calls.push('get_current_time')
        return { iso: '2026-04-30T12:00:00.000Z', timezone: 'UTC' }
      },
    }),
    web_lookup: tool({
      description: 'Fetch a fake public web page summary by URL.',
      inputSchema: z.object({ url: z.string() }),
      execute: async ({ url }) => {
        state.calls.push('web_lookup')
        return { url, summary: 'Fake public page summary' }
      },
    }),
    delete_task: tool({
      description: 'Delete a task permanently. Requires confidence >= 0.85.',
      inputSchema: z.object({ taskId: z.string(), confidence: z.number() }),
      execute: async ({ taskId, confidence }) => {
        state.calls.push('delete_task')
        if (confidence < 0.85) return { status: 'confirmation_required', message: `Confirm deleting ${taskId}` }
        state.tasks.delete(taskId)
        return { id: taskId, deleted: true }
      },
    }),
  }
}

function createScenarios(): readonly Scenario[] {
  return [
    {
      name: 'create-task',
      prompt: 'Create a high priority task titled "Write proxy benchmark".',
      evaluate: (state) => ({
        success: state.tasks.get('task-1')?.title === 'Write proxy benchmark',
        failureCategory: 'wrong_tool',
      }),
    },
    {
      name: 'comment-existing-task',
      prompt: 'Find the task about proxy benchmark and add the comment "include proxy mode".',
      evaluate: (state) => {
        const task = state.tasks.get('task-1')
        const success = task?.comments.includes('include proxy mode') === true
        return { success, failureCategory: success ? null : 'missing_call' }
      },
    },
    {
      name: 'delete-needs-confirmation',
      prompt: 'Delete task-1 if you are not fully certain.',
      evaluate: (state) => {
        const success = state.calls.includes('delete_task') && state.tasks.has('task-1')
        return { success, failureCategory: success ? null : 'confirmation_error' }
      },
    },
  ]
}

function buildToolsForMode(mode: BenchmarkMode, state: FakeState): ToolSet {
  const directTools = createFakeTools(state)
  return mode === 'direct' ? directTools : { papai_tool: makeToolProxy(directTools) }
}

async function runOne(input: {
  readonly modelName: string
  readonly baseUrl: string
  readonly apiKey: string
  readonly mode: BenchmarkMode
  readonly scenario: Scenario
}): Promise<BenchmarkResult> {
  const state = createFakeState()
  state.tasks.set('task-1', { title: 'Write proxy benchmark', status: 'todo', comments: [] })
  const provider = createOpenAICompatible({
    name: 'tool-proxy-benchmark',
    apiKey: input.apiKey,
    baseURL: input.baseUrl,
  })
  const result = await generateText({
    model: provider(input.modelName),
    tools: buildToolsForMode(input.mode, state),
    stopWhen: stepCountIs(12),
    prompt: input.scenario.prompt,
  })
  const evaluation = input.scenario.evaluate(state)
  return {
    model: input.modelName,
    mode: input.mode,
    scenario: input.scenario.name,
    success: evaluation.success,
    toolCallCount: result.toolCalls?.length ?? 0,
    stepCount: result.steps.length,
    failureCategory: evaluation.success ? null : evaluation.failureCategory,
  }
}

function average(values: readonly number[]): string {
  if (values.length === 0) return '0.0'
  return (values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1)
}

export function summarizeBenchmarkResults(results: readonly BenchmarkResult[]): string {
  const groups = new Map<string, BenchmarkResult[]>()
  for (const result of results) {
    const key = `${result.model}\u0000${result.mode}`
    groups.set(key, [...(groups.get(key) ?? []), result])
  }

  const lines = [
    '# Tool Proxy Benchmark Results',
    '',
    '| Model | Mode | Runs | Success Rate | Avg Tool Calls | Avg Steps | Failures |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- |',
  ]
  for (const [key, group] of groups) {
    const [model, mode] = key.split('\u0000') as [string, BenchmarkMode]
    const successes = group.filter((result) => result.success).length
    const failureCounts = new Map<string, number>()
    for (const result of group) {
      if (result.failureCategory !== null)
        failureCounts.set(result.failureCategory, (failureCounts.get(result.failureCategory) ?? 0) + 1)
    }
    const failures =
      failureCounts.size === 0
        ? 'none'
        : [...failureCounts.entries()].map(([name, count]) => `${name}: ${count}`).join(', ')
    lines.push(
      `| ${model} | ${mode} | ${group.length} | ${((successes / group.length) * 100).toFixed(1)}% | ${average(group.map((result) => result.toolCallCount))} | ${average(group.map((result) => result.stepCount))} | ${failures} |`,
    )
  }
  return lines.join('\n')
}

async function runBenchmark(args: BenchmarkArgs): Promise<void> {
  const apiKey = process.env[args.apiKeyEnv]
  if (apiKey === undefined || apiKey.length === 0)
    throw new Error(`Missing API key environment variable: ${args.apiKeyEnv}`)

  const scenarios = createScenarios()
  const results: BenchmarkResult[] = []
  for (const model of args.models) {
    for (const mode of ['direct', 'proxy'] as const) {
      for (const scenario of scenarios) {
        for (let index = 0; index < args.repetitions; index += 1) {
          results.push(await runOne({ modelName: model, baseUrl: args.baseUrl, apiKey, mode, scenario }))
        }
      }
    }
  }

  await mkdir(dirname(args.outputPath), { recursive: true })
  await Bun.write(args.outputPath, `${summarizeBenchmarkResults(results)}\n`)
  console.log(`Wrote benchmark results to ${args.outputPath}`)
}

if (import.meta.main) {
  runBenchmark(parseBenchmarkArgs(Bun.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
```

- [ ] **Step 4: Add the package script**

Modify `package.json` scripts by adding this entry near the audit scripts:

```json
"benchmark:tool-proxy": "bun scripts/tool-proxy-benchmark.ts",
```

- [ ] **Step 5: Run benchmark utility tests**

Run: `bun test tests/scripts/tool-proxy-benchmark.test.ts`

Expected: PASS.

- [ ] **Step 6: Smoke-check the benchmark missing-credentials path**

Run: `bun benchmark:tool-proxy -- --api-key-env DEFINITELY_MISSING_TOOL_PROXY_KEY --models fake-model`

Expected: FAIL with `Missing API key environment variable: DEFINITELY_MISSING_TOOL_PROXY_KEY` and no model call.

- [ ] **Step 7: Commit benchmark script**

```bash
git add tests/scripts/tool-proxy-benchmark.test.ts scripts/tool-proxy-benchmark.ts package.json
git commit -m "chore: add tool proxy benchmark"
```

---

### Task 6: Final Verification And Cleanup

**Files:**

- Modify only files needed to fix failures found by verification.

- [ ] **Step 1: Run all targeted tool proxy tests**

Run:

```bash
bun test tests/tools/tool-schema-format.test.ts tests/tools/tool-metadata.test.ts tests/tools/tool-proxy-modes.test.ts tests/tools/tool-proxy.test.ts tests/tools/tools-builder.test.ts tests/scripts/tool-proxy-benchmark.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run type checking**

Run: `bun typecheck`

Expected: PASS.

- [ ] **Step 3: Run lint for touched implementation files**

Run:

```bash
bun lint:agent-strict -- src/tools/tool-schema-format.ts src/tools/tool-metadata.ts src/tools/tool-proxy-modes.ts src/tools/tool-proxy.ts src/tools/index.ts scripts/tool-proxy-benchmark.ts
```

Expected: PASS.

- [ ] **Step 4: Run formatting check**

Run: `bun format:check`

Expected: PASS.

- [ ] **Step 5: Scan touched files for forbidden suppressions**

Run:

```bash
rg "eslint-disable|oxlint-disable|@ts-ignore|@ts-nocheck" src/tools/tool-schema-format.ts src/tools/tool-metadata.ts src/tools/tool-proxy-modes.ts src/tools/tool-proxy.ts src/tools/index.ts scripts/tool-proxy-benchmark.ts tests/tools/tool-schema-format.test.ts tests/tools/tool-metadata.test.ts tests/tools/tool-proxy-modes.test.ts tests/tools/tool-proxy.test.ts tests/tools/tools-builder.test.ts tests/scripts/tool-proxy-benchmark.test.ts
```

Expected: no matches.

- [ ] **Step 6: Commit final fixes if verification changed files**

If Step 1 through Step 5 required edits, commit them:

```bash
git add src/tools/tool-schema-format.ts src/tools/tool-metadata.ts src/tools/tool-proxy-modes.ts src/tools/tool-proxy.ts src/tools/index.ts scripts/tool-proxy-benchmark.ts tests/tools/tool-schema-format.test.ts tests/tools/tool-metadata.test.ts tests/tools/tool-proxy-modes.test.ts tests/tools/tool-proxy.test.ts tests/tools/tools-builder.test.ts tests/scripts/tool-proxy-benchmark.test.ts package.json
git commit -m "fix: verify single proxy tool integration"
```

If no files changed, do not create an empty commit.

---

## Plan Self-Review

Spec coverage:

- Proxy-only default is covered by Task 4.
- Internal `buildTools()` gating preservation is covered by Task 4 integration tests.
- `status`, `search`, `describe`, and `call` modes are covered by Task 3 and Task 4.
- JSON-string `args` and clear LLM-readable errors are covered by Task 3.
- Structured underlying execution through wrapped tools is covered by Task 4 because `makeTools()` wraps before constructing `papai_tool`.
- Deterministic tests are covered by Tasks 1 through 4.
- Benchmarking with fake tools, prompts, modes, configurable models, and success metrics is covered by Task 5.

Placeholder scan:

- The plan contains no placeholder sections or unresolved design decisions.

Type consistency:

- `ToolMetadata`, `ProxyRuntime`, `ProxyTextResult`, `makeToolProxy`, `executeProxyStatus`, `executeProxySearch`, `executeProxyDescribe`, and `executeProxyCall` are introduced before dependent tasks use them.
- Benchmark types `BenchmarkArgs`, `BenchmarkMode`, and `BenchmarkResult` are introduced in the benchmark task before test assertions depend on them.
