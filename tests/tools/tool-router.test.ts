import { describe, expect, test } from 'bun:test'

import { classifyToolRoutingIntent, routeToolsForMessage } from '../../src/tools/tool-router.js'
import { buildTools } from '../../src/tools/tools-builder.js'
import { createMockProvider } from './mock-provider.js'

const fullTools = (): ReturnType<typeof buildTools> =>
  buildTools(createMockProvider(), 'user-1', 'ctx-1', 'normal', 'dm')

describe('tool router', () => {
  test('routes trivial acknowledgements to an empty tool set', () => {
    const routed = routeToolsForMessage('thanks!', fullTools())

    expect(routed.decision.intent).toBe('trivial')
    expect(Object.keys(routed.tools)).toHaveLength(0)
    expect(routed.fullToolCount).toBeGreaterThan(routed.exposedToolCount)
  })

  test('routes memo requests to memo tools instead of task mutation tools', () => {
    const routed = routeToolsForMessage('remember that I prefer morning standups', fullTools())

    expect(routed.decision.intent).toBe('memo')
    expect(routed.tools).toHaveProperty('save_memo')
    expect(routed.tools).toHaveProperty('search_memos')
    expect(routed.tools).not.toHaveProperty('create_task')
  })

  test('routes task reads to read-only task context', () => {
    const routed = routeToolsForMessage('show me the status and comments for PROJ-123', fullTools())

    expect(routed.decision.intent).toBe('task_read')
    expect(routed.tools).toHaveProperty('search_tasks')
    expect(routed.tools).toHaveProperty('get_task')
    expect(routed.tools).toHaveProperty('get_comments')
    expect(routed.tools).not.toHaveProperty('create_task')
    expect(routed.tools).not.toHaveProperty('delete_task')
  })

  test('routes task mutations to task/project/status context without unrelated personal tools', () => {
    const routed = routeToolsForMessage('create a task to fix login tomorrow', fullTools())

    expect(routed.decision.intent).toBe('task_mutation')
    expect(routed.tools).toHaveProperty('create_task')
    expect(routed.tools).toHaveProperty('list_projects')
    expect(routed.tools).toHaveProperty('get_current_time')
    expect(routed.tools).not.toHaveProperty('save_memo')
    expect(routed.tools).not.toHaveProperty('create_deferred_prompt')
  })

  test('falls back to the full tool set when intent is uncertain', () => {
    const tools = fullTools()
    const routed = routeToolsForMessage('can you handle the thing we discussed', tools)

    expect(routed.decision.intent).toBe('full')
    expect(routed.exposedToolCount).toBe(Object.keys(tools).length)
  })

  test('classifies URLs before broad task keywords', () => {
    const decision = classifyToolRoutingIntent('turn https://example.com/release-notes into a task')

    expect(decision.intent).toBe('web')
  })
})
