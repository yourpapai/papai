import { describe, expect, test } from 'bun:test'

import { extractFactToolCalls, extractFactToolResults } from '../src/memory-tool-steps.js'

describe('memory-tool-steps', () => {
  test('extracts tool calls and results from every result step', () => {
    const result = {
      toolCalls: [{ toolName: 'create_task', input: { title: 'Final task' } }],
      toolResults: [{ toolName: 'create_task', output: { id: 'task-2' } }],
      steps: [
        {
          toolCalls: [{ toolName: 'create_task', input: { title: 'First task' } }],
          toolResults: [{ toolName: 'create_task', output: { id: 'task-1' } }],
        },
        {
          toolCalls: [{ toolName: 'create_task', input: { title: 'Second task' } }],
          toolResults: [{ toolName: 'create_task', output: { id: 'task-2' } }],
        },
      ],
    }

    expect(extractFactToolCalls(result)).toEqual([
      { toolName: 'create_task', input: { title: 'First task' } },
      { toolName: 'create_task', input: { title: 'Second task' } },
    ])
    expect(extractFactToolResults(result)).toEqual([
      { toolName: 'create_task', output: { id: 'task-1' } },
      { toolName: 'create_task', output: { id: 'task-2' } },
    ])
  })

  test('falls back to top-level calls and results when steps are absent', () => {
    const result = {
      toolCalls: [{ toolName: 'create_task', input: { title: 'Only task' } }],
      toolResults: [{ toolName: 'create_task', output: { id: 'task-1' } }],
    }

    expect(extractFactToolCalls(result)).toEqual([{ toolName: 'create_task', input: { title: 'Only task' } }])
    expect(extractFactToolResults(result)).toEqual([{ toolName: 'create_task', output: { id: 'task-1' } }])
  })

  test('ignores malformed tool step entries', () => {
    const result = {
      steps: [
        null,
        {
          toolCalls: [{ toolName: 'create_task' }, { toolName: 'create_task', input: { title: 'Valid task' } }],
          toolResults: [{ toolName: 'create_task' }, { toolName: 'create_task', output: { id: 'task-1' } }],
        },
      ],
    }

    expect(extractFactToolCalls(result)).toEqual([{ toolName: 'create_task', input: { title: 'Valid task' } }])
    expect(extractFactToolResults(result)).toEqual([{ toolName: 'create_task', output: { id: 'task-1' } }])
  })
})
