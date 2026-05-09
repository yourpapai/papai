import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ModelMessage, ToolCallPart, ToolResultPart } from 'ai'

import { validateToolResults } from '../src/llm-orchestrator-validation.js'
import { isToolFailureResult } from '../src/tool-failure.js'

function getToolContent(message: ModelMessage): ToolResultPart[] {
  if (message.role !== 'tool') return []
  if (typeof message.content === 'string') return []
  if (!Array.isArray(message.content)) return []
  return message.content.filter((part): part is ToolResultPart => part.type === 'tool-result')
}

describe('validateToolResults', () => {
  test('returns unchanged messages when all tool calls have results', () => {
    const toolCall: ToolCallPart = {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'create_task',
      input: {},
    }
    const toolResult: ToolResultPart = {
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'create_task',
      output: { type: 'json', value: { id: '1' } },
    }
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Create a task' },
      { role: 'assistant', content: [toolCall] },
      { role: 'tool', content: [toolResult] },
    ]

    const result = validateToolResults(messages)

    expect(result).toEqual(messages)
  })

  test('injects synthetic result for missing tool result', () => {
    const toolCall: ToolCallPart = {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'create_task',
      input: {},
    }
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Create a task' },
      { role: 'assistant', content: [toolCall] },
    ]

    const result = validateToolResults(messages)

    expect(result).toHaveLength(3)
    expect(result[2]).toMatchObject({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: 'create_task',
        },
      ],
    })
    const toolMessage = result[2]!
    expect(typeof toolMessage.content).toBe('object')
    expect(Array.isArray(toolMessage.content)).toBe(true)
    const toolContent = getToolContent(toolMessage)
    expect(toolContent[0]!.output.type).toBe('json')
    const output = toolContent[0]!.output
    expect(output.type).toBe('json')
    assert(output.type === 'json')
    expect(isToolFailureResult(output.value)).toBe(true)
    assert(isToolFailureResult(output.value))
    expect(output.value).toMatchObject({
      toolName: 'create_task',
      toolCallId: 'call-1',
      errorType: 'tool-execution',
      errorCode: 'interrupted',
      recovered: true,
      retryable: true,
    })
  })

  test('handles multiple missing results', () => {
    const toolCall1: ToolCallPart = {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'task_a',
      input: {},
    }
    const toolCall2: ToolCallPart = {
      type: 'tool-call',
      toolCallId: 'call-2',
      toolName: 'task_b',
      input: {},
    }
    const toolResult: ToolResultPart = {
      type: 'tool-result',
      toolCallId: 'call-1',
      toolName: 'task_a',
      output: { type: 'json', value: {} },
    }
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Do things' },
      { role: 'assistant', content: [toolCall1, toolCall2] },
      { role: 'tool', content: [toolResult] },
    ]

    const result = validateToolResults(messages)

    const toolMessages = result.filter((m) => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
  })
})
