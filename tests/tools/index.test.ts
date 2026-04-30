import { beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ToolExecutionOptions } from 'ai'

import { setConfig } from '../../src/config.js'
import { getScheduledPrompt } from '../../src/deferred-prompts/scheduled.js'
import { isToolFailureResult } from '../../src/tool-failure.js'
import { makeTools, type MakeToolsOptions } from '../../src/tools/index.js'
import { getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

type ProxyTextContent = {
  readonly type: 'text'
  readonly text: string
}

type ProxyTextResult = {
  readonly content: readonly ProxyTextContent[]
  readonly details: Readonly<Record<string, unknown>>
}

function toolOptions(toolCallId: string): ToolExecutionOptions {
  return { toolCallId, messages: [] }
}

function hasId(value: unknown): value is Readonly<Record<string, unknown>> & { readonly id: string } {
  return typeof value === 'object' && value !== null && 'id' in value && typeof value['id'] === 'string'
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function isProxyTextContent(value: unknown): value is ProxyTextContent {
  return isRecord(value) && value['type'] === 'text' && typeof value['text'] === 'string'
}

function isProxyTextResult(value: unknown): value is ProxyTextResult {
  if (!isRecord(value)) return false
  if (!Array.isArray(value['content'])) return false
  return value['content'].every(isProxyTextContent) && isRecord(value['details'])
}

function expectProxyTextResult(value: unknown): ProxyTextResult {
  assert.ok(isProxyTextResult(value), 'Expected proxy text result')
  return value
}

function firstText(result: ProxyTextResult): string {
  const first = result.content[0]
  assert.ok(first !== undefined, 'Expected proxy text content')
  return first.text
}

async function searchProxy(options: MakeToolsOptions, query: string): Promise<ProxyTextResult> {
  const tools = makeTools(createMockProvider(), options)
  const result = await getToolExecutor(tools['papai_tool'])(
    { search: query, includeSchemas: false },
    toolOptions(query),
  )
  return expectProxyTextResult(result)
}

describe('makeTools', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  beforeEach(async () => {
    await setupTestDb()
    setConfig('user-1', 'timezone', 'UTC')
  })

  test('exposes only papai_tool', () => {
    const tools = makeTools(createMockProvider(), { storageContextId: 'user-1', chatUserId: 'user-1' })

    expect(Object.keys(tools)).toEqual(['papai_tool'])
  })

  test('returns proxy status with internal tool count', async () => {
    const tools = makeTools(createMockProvider(), { storageContextId: 'user-1', chatUserId: 'user-1' })

    const result = expectProxyTextResult(await getToolExecutor(tools['papai_tool'])({}, toolOptions('status')))

    expect(result.details).toMatchObject({ mode: 'status' })
    expect(firstText(result)).toContain('Papai tools:')
  })

  test('describes internal tools through papai_tool', async () => {
    const tools = makeTools(createMockProvider(), { storageContextId: 'user-1', chatUserId: 'user-1' })

    const result = expectProxyTextResult(
      await getToolExecutor(tools['papai_tool'])({ describe: 'get_current_time' }, toolOptions('describe-time')),
    )

    expect(result.details).toMatchObject({ mode: 'describe', tool: 'get_current_time' })
    expect(firstText(result)).toContain('current date and time')
  })

  test('executes underlying tools through papai_tool', async () => {
    const getTask = mock(() =>
      Promise.resolve({ id: 'task-1', title: 'Test', status: 'todo', url: 'https://test.com/task/1' }),
    )
    const provider = createMockProvider({ getTask })
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })

    const result = await getToolExecutor(tools['papai_tool'])(
      { tool: 'get_task', args: JSON.stringify({ taskId: 'task-1' }) },
      toolOptions('get-task'),
    )

    expect(result).toEqual({ id: 'task-1', title: 'Test', status: 'todo', url: 'https://test.com/task/1' })
    expect(getTask).toHaveBeenCalledWith('task-1')
  })

  test('wraps underlying tool failures through papai_tool', async () => {
    const provider = createMockProvider({
      getTask: mock(() => Promise.reject(new Error('provider unavailable'))),
    })
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })

    const result = await getToolExecutor(tools['papai_tool'])(
      { tool: 'get_task', args: JSON.stringify({ taskId: 'task-1' }) },
      toolOptions('wrapped-failure'),
    )

    assert.ok(isToolFailureResult(result), 'Expected wrapped tool failure result')
    expect(result.toolName).toBe('get_task')
    expect(result.toolCallId).toBe('wrapped-failure')
    expect(result.error).toBe('provider unavailable')
  })

  test('web_fetch availability is visible only through proxy search when storage context exists', async () => {
    const withContext = await searchProxy({ storageContextId: 'user-1', chatUserId: 'user-1' }, 'web_fetch')
    const withoutContext = await searchProxy({ chatUserId: 'user-1' }, 'web_fetch')

    expect(firstText(withContext)).toContain('web_fetch')
    expect(withoutContext.details).toMatchObject({ matches: [] })
  })

  test('group history availability is visible only through proxy search for group storage contexts', async () => {
    const dm = await searchProxy({ storageContextId: 'user-1', chatUserId: 'user-1' }, 'lookup_group_history')
    const group = await searchProxy(
      { storageContextId: 'user-1:group-1', chatUserId: 'user-1' },
      'lookup_group_history',
    )

    expect(dm.details).toMatchObject({ matches: [] })
    expect(firstText(group)).toContain('lookup_group_history')
  })

  test('identity tool gating is visible through proxy search', async () => {
    const provider = createMockProvider({
      identityResolver: {
        searchUsers: () => Promise.resolve([]),
      },
    })
    const dmTools = makeTools(provider, { storageContextId: 'user-123', chatUserId: 'user-123', contextType: 'dm' })
    const groupTools = makeTools(provider, {
      storageContextId: 'group-123',
      chatUserId: 'user-456',
      contextType: 'group',
    })

    const dmResult = expectProxyTextResult(
      await getToolExecutor(dmTools['papai_tool'])({ search: 'identity', includeSchemas: false }, toolOptions('dm-id')),
    )
    const groupResult = expectProxyTextResult(
      await getToolExecutor(groupTools['papai_tool'])(
        { search: 'identity', includeSchemas: false },
        toolOptions('group-id'),
      ),
    )

    expect(firstText(dmResult)).not.toContain('set_my_identity')
    expect(firstText(groupResult)).toContain('set_my_identity')
    expect(firstText(groupResult)).toContain('clear_my_identity')
  })

  test('mode gating is visible through proxy search for deferred prompt tools', async () => {
    const normal = await searchProxy({ storageContextId: 'user-1', chatUserId: 'user-1' }, 'deferred_prompt')
    const proactive = await searchProxy(
      { storageContextId: 'user-1', chatUserId: 'user-1', mode: 'proactive' },
      'deferred_prompt',
    )

    expect(firstText(normal)).toContain('create_deferred_prompt')
    expect(firstText(proactive)).not.toContain('create_deferred_prompt')
  })

  test('capability gating is visible through proxy search', async () => {
    const provider = createMockProvider({
      capabilities: new Set(
        [...createMockProvider().capabilities].filter((capability) => capability !== 'tasks.count'),
      ),
    })
    const tools = makeTools(provider, { storageContextId: 'user-1', chatUserId: 'user-1' })

    const result = expectProxyTextResult(
      await getToolExecutor(tools['papai_tool'])(
        { search: 'count_tasks', includeSchemas: false },
        toolOptions('count'),
      ),
    )

    expect(result.details).toMatchObject({ matches: [] })
  })

  test('group deferred prompts created through papai_tool preserve creator username for personal delivery', async () => {
    const tools = makeTools(createMockProvider(), {
      storageContextId: '-1001:42',
      chatUserId: 'user-1',
      contextType: 'group',
      username: 'ki',
    })

    const future = new Date(Date.now() + 3_600_000)
    const date = future.toISOString().slice(0, 10)
    const time = future.toISOString().slice(11, 16)
    const result = await getToolExecutor(tools['papai_tool'])(
      {
        tool: 'create_deferred_prompt',
        args: JSON.stringify({
          prompt: 'Ping me later',
          schedule: { fire_at: { date, time } },
          delivery: { audience: 'personal', mention_user_ids: ['user-1'] },
          execution: { mode: 'context', delivery_brief: 'Personal reminder in thread' },
        }),
      },
      { ...toolOptions('tc1'), abortSignal: new AbortController().signal },
    )

    assert.ok(hasId(result), 'Expected create_deferred_prompt result with id')
    const created = getScheduledPrompt(result.id, 'user-1')
    expect(created).not.toBeNull()
    assert.ok(created !== null, 'Expected scheduled prompt to exist')
    expect(created.deliveryTarget.createdByUsername).toBe('ki')
  })
})
