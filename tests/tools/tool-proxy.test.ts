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
        execute: ({ taskId }) => ({ called: 'get_task', taskId }),
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
