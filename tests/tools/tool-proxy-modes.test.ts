import { describe, expect, it, mock } from 'bun:test'

import { tool, type ToolExecutionOptions, type ToolSet } from 'ai'
import { z } from 'zod'

import { buildToolMetadata } from '../../src/tools/tool-metadata.js'
import {
  executeProxyCall,
  executeProxyDescribe,
  executeProxySearch,
  executeProxyStatus,
  type ProxyRuntime,
  type ProxyTextResult,
} from '../../src/tools/tool-proxy-modes.js'

const toolOptions: ToolExecutionOptions = { toolCallId: 'call-1', messages: [] }

function buildRuntime(tools: ToolSet): ProxyRuntime {
  return { tools, metadata: buildToolMetadata(tools) }
}

function expectFirstText(result: ProxyTextResult): string {
  const firstContent = result.content[0]
  if (firstContent === undefined) {
    throw new Error('Expected proxy result to contain text content')
  }
  return firstContent.text
}

function expectProxyTextResult(value: unknown): asserts value is ProxyTextResult {
  expect(value).toBeObject()
  expect(value).toHaveProperty('content')
  expect(value).toHaveProperty('details')
}

describe('tool-proxy-modes', () => {
  it('returns compact status guidance', () => {
    const runtime = buildRuntime({
      search_tasks: tool({
        description: 'Search tasks',
        inputSchema: z.object({ query: z.string() }),
        execute: () => [],
      }),
    })

    const result = executeProxyStatus(runtime.metadata)

    expect(result.details).toMatchObject({ mode: 'status', toolCount: 1 })
    expect(expectFirstText(result)).toContain('Papai tools: 1 available')
    expect(expectFirstText(result)).toContain('search')
  })

  it('searches names and descriptions with OR terms and schemas by default', () => {
    const runtime = buildRuntime({
      search_tasks: tool({
        description: 'Search task titles',
        inputSchema: z.object({ query: z.string().describe('Search text') }),
        execute: () => [],
      }),
      add_comment: tool({
        description: 'Comment on a task',
        inputSchema: z.object({ body: z.string() }),
        execute: () => ({}),
      }),
    })

    const result = executeProxySearch(runtime.metadata, 'comment find', false, true)

    expect(result.details).toMatchObject({ mode: 'search', count: 1, query: 'comment find' })
    expect(expectFirstText(result)).toContain('add_comment')
    expect(expectFirstText(result)).toContain('body (string)')
  })

  it('omits schemas when requested', () => {
    const runtime = buildRuntime({
      search_tasks: tool({
        description: 'Search task titles',
        inputSchema: z.object({ query: z.string().describe('Search text') }),
        execute: () => [],
      }),
    })

    const result = executeProxySearch(runtime.metadata, 'search', false, false)

    expect(expectFirstText(result)).toContain('search_tasks')
    expect(expectFirstText(result)).not.toContain('query (string)')
  })

  it('returns a readable no-match message when optional regex is omitted', () => {
    const runtime = buildRuntime({
      search_tasks: tool({
        description: 'Search task titles',
        inputSchema: z.object({ query: z.string().describe('Search text') }),
        execute: () => [],
      }),
    })

    const result = executeProxySearch(runtime.metadata, 'missing', undefined, false)

    expect(result.details).toMatchObject({ mode: 'search', count: 0, matches: [], query: 'missing' })
    expect(expectFirstText(result)).toContain('No tools found')
    expect(expectFirstText(result)).toContain('missing')
  })

  it('splits plain search terms on whitespace when optional regex is omitted', () => {
    const runtime = buildRuntime({
      add_comment: tool({
        description: 'Comment on a task',
        inputSchema: z.object({ body: z.string() }),
        execute: () => ({}),
      }),
    })

    const result = executeProxySearch(runtime.metadata, 'comment	find', undefined, false)

    expect(result.details).toMatchObject({ mode: 'search', count: 1, matches: ['add_comment'] })
    expect(expectFirstText(result)).toContain('add_comment')
  })

  it('returns a clear empty-query error', () => {
    const result = executeProxySearch([], '   ', false, true)

    expect(result.details).toMatchObject({ mode: 'search', error: 'empty_query' })
    expect(expectFirstText(result)).toBe(
      'Search query cannot be empty. Provide one or more words from the tool name or purpose.',
    )
  })

  it('returns a clear empty-query error for empty regex searches', () => {
    const result = executeProxySearch([], '   ', true, false)

    expect(result.details).toMatchObject({ mode: 'search', error: 'empty_query' })
    expect(expectFirstText(result)).toBe(
      'Search query cannot be empty. Provide one or more words from the tool name or purpose.',
    )
  })

  it('supports regex search and reports invalid regex patterns', () => {
    const runtime = buildRuntime({
      list_tasks: tool({
        description: 'List open tasks',
        inputSchema: z.object({}),
        execute: () => [],
      }),
    })

    const result = executeProxySearch(runtime.metadata, 'list_.*', true, false)
    expect(result.details).toMatchObject({ mode: 'search', count: 1, query: 'list_.*' })
    expect(expectFirstText(result)).toContain('list_tasks')

    const invalid = executeProxySearch(runtime.metadata, '[', true, false)
    expect(invalid.details).toMatchObject({ mode: 'search', error: 'invalid_pattern' })
    expect(expectFirstText(invalid)).toContain('Invalid regex pattern')
  })

  it('describes one tool with its schema', () => {
    const runtime = buildRuntime({
      update_task: tool({
        description: 'Update a task',
        inputSchema: z.object({ taskId: z.string().describe('Task identifier') }),
        execute: () => ({}),
      }),
    })

    const result = executeProxyDescribe(runtime.metadata, 'update-task')

    expect(result.details).toMatchObject({ mode: 'describe', tool: 'update_task' })
    expect(expectFirstText(result)).toContain('Update a task')
    expect(expectFirstText(result)).toContain('taskId (string) *required* - Task identifier')
  })

  it('returns a clear describe tool_not_found error', () => {
    const result = executeProxyDescribe([], 'missing_tool')

    expect(result.details).toMatchObject({ mode: 'describe', error: 'tool_not_found' })
    expect(expectFirstText(result)).toContain('Use search to find available tools')
  })

  it('calls the selected wrapped tool with parsed JSON args', async () => {
    const execute = mock(({ taskId }: { readonly taskId: string }) => ({ ok: true, taskId }))
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

  it('validates proxied args against the selected tool schema before execution', async () => {
    const execute = mock(({ taskId }: { readonly taskId: string }) => ({ ok: true, taskId }))
    const runtime = buildRuntime({
      get_task: tool({
        description: 'Get task',
        inputSchema: z.object({ taskId: z.string().describe('Task identifier') }),
        execute,
      }),
    })

    const result = await executeProxyCall(runtime, 'get_task', '{}', toolOptions)

    expect(execute).not.toHaveBeenCalled()
    expectProxyTextResult(result)
    expect(result.details).toMatchObject({ mode: 'call', error: 'invalid_tool_args', tool: 'get_task' })
    expect(expectFirstText(result)).toContain('Invalid arguments for tool get_task')
    expect(expectFirstText(result)).toContain('taskId (string) *required* - Task identifier')
  })

  it('executes proxied tools with parsed schema output', async () => {
    const execute = mock((input: { readonly limit: number }) => input)
    const runtime = buildRuntime({
      list_items: tool({
        description: 'List items',
        inputSchema: z.object({ limit: z.number().default(10) }),
        execute,
      }),
    })

    const result = await executeProxyCall(runtime, 'list_items', '{}', toolOptions)

    expect(execute).toHaveBeenCalledWith({ limit: 10 }, toolOptions)
    expect(result).toEqual({ limit: 10 })
  })

  it('executes proxied tools when args satisfy the selected tool schema', async () => {
    const execute = mock(({ taskId }: { readonly taskId: string }) => ({ ok: true, taskId }))
    const runtime = buildRuntime({
      get_task: tool({
        description: 'Get task',
        inputSchema: z.object({ taskId: z.string().describe('Task identifier') }),
        execute,
      }),
    })

    const result = await executeProxyCall(runtime, 'get_task', '{"taskId":"task-1"}', toolOptions)

    expect(result).toEqual({ ok: true, taskId: 'task-1' })
    expect(execute).toHaveBeenCalledWith({ taskId: 'task-1' }, toolOptions)
  })

  it('uses an empty object when args are missing or empty', async () => {
    const execute = mock((_args: Readonly<Record<string, never>>) => ({ ok: true }))
    const runtime = buildRuntime({
      list_tasks: tool({
        description: 'List tasks',
        inputSchema: z.object({}),
        execute,
      }),
    })

    await executeProxyCall(runtime, 'list_tasks', undefined, toolOptions)
    await executeProxyCall(runtime, 'list_tasks', '   ', toolOptions)

    expect(execute).toHaveBeenCalledWith({}, toolOptions)
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('returns clear invalid args errors', async () => {
    const runtime = buildRuntime({})

    const invalidJson = await executeProxyCall(runtime, 'get_task', '{bad', toolOptions)
    expectProxyTextResult(invalidJson)
    expect(invalidJson).toMatchObject({ details: { mode: 'call', error: 'invalid_args_json' } })
    expect(expectFirstText(invalidJson)).toContain('Invalid JSON in args')

    const invalidType = await executeProxyCall(runtime, 'get_task', '[1,2]', toolOptions)
    expectProxyTextResult(invalidType)
    expect(invalidType).toMatchObject({ details: { mode: 'call', error: 'invalid_args_type' } })
    expect(expectFirstText(invalidType)).toContain('must parse to a JSON object')
  })

  it('returns tool_not_found and tool_not_executable errors', async () => {
    const runtime = buildRuntime({
      queued_tool: {
        description: 'Queued tool',
        inputSchema: z.object({ id: z.string() }),
      },
    } satisfies ToolSet)

    const missing = await executeProxyCall(runtime, 'missing_tool', '{}', toolOptions)
    expectProxyTextResult(missing)
    expect(missing).toMatchObject({ details: { mode: 'call', error: 'tool_not_found' } })
    expect(expectFirstText(missing)).toContain('Use search to find available tools')

    const notExecutable = await executeProxyCall(runtime, 'queued_tool', '{}', toolOptions)
    expectProxyTextResult(notExecutable)
    expect(notExecutable).toMatchObject({ details: { mode: 'call', error: 'tool_not_executable' } })
    expect(expectFirstText(notExecutable)).toContain('cannot be executed directly')
  })
})
