import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  FactSchema,
  HistoryMessageSchema,
  InstructionSchema,
  LogEntrySchema,
  safeParseSession,
  ToolCallDetailSchema,
  StepDetailSchema,
  safeParseLlmTrace,
} from '../../src/debug/schemas.js'

describe('schemas', () => {
  describe('FactSchema', () => {
    test('parses valid fact', () => {
      const fact = {
        identifier: 'task-123',
        title: 'Example Task',
        url: 'https://example.com/task/123',
        lastSeen: '2024-01-15T10:30:00.000Z',
      }
      const result = FactSchema.safeParse(fact)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.identifier).toBe('task-123')
      expect(result.data.title).toBe('Example Task')
    })
  })

  describe('InstructionSchema', () => {
    test('parses valid instruction', () => {
      const instruction = {
        id: 'inst-1',
        text: 'Be helpful and concise',
        createdAt: '2024-01-15T10:30:00.000Z',
      }
      const result = InstructionSchema.safeParse(instruction)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.text).toBe('Be helpful and concise')
    })
  })

  describe('LogEntrySchema', () => {
    test('parses log entry with structured properties', () => {
      const entry = {
        time: '2024-01-15T10:30:00.000Z',
        level: 30,
        msg: 'Processing completed',
        scope: 'test-module',
        userId: 'user-123',
        count: 42,
        nested: { key: 'value' },
      }
      const result = LogEntrySchema.safeParse(entry)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.msg).toBe('Processing completed')
      expect(result.data['userId']).toBe('user-123')
      expect(result.data['count']).toBe(42)
    })

    test('parses basic log entry without extra properties', () => {
      const entry = {
        time: '2024-01-15T10:30:00.000Z',
        level: 30,
        msg: 'Simple message',
      }
      const result = LogEntrySchema.safeParse(entry)
      expect(result.success).toBe(true)
    })
  })

  describe('HistoryMessageSchema', () => {
    test('parses valid history message', () => {
      const message = {
        role: 'user',
        content: 'Hello, how are you?',
      }
      const result = HistoryMessageSchema.safeParse(message)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.role).toBe('user')
      expect(result.data.content).toBe('Hello, how are you?')
    })

    test('parses assistant message with tool_calls', () => {
      const message = {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call-1', name: 'create_task' }],
      }
      const result = HistoryMessageSchema.safeParse(message)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.role).toBe('assistant')
      expect(result.data.tool_calls).toBeDefined()
    })

    test('parses tool message with tool_call_id', () => {
      const message = {
        role: 'tool',
        content: '{"result": "success"}',
        tool_call_id: 'call-1',
      }
      const result = HistoryMessageSchema.safeParse(message)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.role).toBe('tool')
      expect(result.data.tool_call_id).toBe('call-1')
    })
  })

  describe('safeParseSession', () => {
    test('parses session with full data', () => {
      const session = {
        userId: 'user-123',
        lastAccessed: Date.now(),
        historyLength: 5,
        factsCount: 2,
        summary: 'Test summary',
        configKeys: ['key1', 'key2'],
        workspaceId: 'ws-123',
        facts: [
          {
            identifier: 'task-1',
            title: 'Task One',
            url: 'https://example.com/1',
            lastSeen: '2024-01-15T10:30:00.000Z',
          },
        ],
        config: { key1: 'value1', key2: null },
        hasTools: true,
        instructionsCount: 3,
      }
      const result = safeParseSession(session)
      expect(result).not.toBeNull()
      assert(result !== null)
      expect(result.userId).toBe('user-123')
      expect(result.facts).toHaveLength(1)
      expect(result.config?.['key1']).toBe('value1')
      expect(result.hasTools).toBe(true)
    })

    test('parses session with history', () => {
      const session = {
        userId: 'user-123',
        lastAccessed: Date.now(),
        historyLength: 3,
        factsCount: 0,
        summary: null,
        configKeys: [],
        workspaceId: null,
        history: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
          { role: 'user', content: 'How are you?' },
        ],
      }
      const result = safeParseSession(session)
      expect(result).not.toBeNull()
      assert(result !== null)
      expect(result.history).toHaveLength(3)
      expect(result.history?.[0]?.role).toBe('user')
      expect(result.history?.[0]?.content).toBe('Hello')
      expect(result.history?.[1]?.role).toBe('assistant')
    })

    test('parses session without optional full data', () => {
      const session = {
        userId: 'user-123',
        lastAccessed: Date.now(),
        historyLength: 0,
        factsCount: 0,
        summary: null,
        configKeys: [],
        workspaceId: null,
      }
      const result = safeParseSession(session)
      expect(result).not.toBeNull()
    })
  })

  describe('ToolCallDetailSchema', () => {
    test('parses tool call with all fields', () => {
      const toolCall = {
        toolName: 'create_task',
        durationMs: 500,
        success: true,
        toolCallId: 'call-1',
        args: { title: 'Test task', priority: 'high' },
        result: { id: 'task-123', title: 'Test task' },
      }
      const result = ToolCallDetailSchema.safeParse(toolCall)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.toolName).toBe('create_task')
      expect(result.data.toolCallId).toBe('call-1')
      expect(result.data.args).toEqual({ title: 'Test task', priority: 'high' })
    })

    test('parses tool call with error', () => {
      const toolCall = {
        toolName: 'search_tasks',
        durationMs: 300,
        success: false,
        toolCallId: 'call-2',
        args: { query: 'invalid' },
        error: 'API error: 500 Internal Server Error',
      }
      const result = ToolCallDetailSchema.safeParse(toolCall)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.success).toBe(false)
      expect(result.data.error).toBe('API error: 500 Internal Server Error')
    })

    test('parses minimal tool call', () => {
      const toolCall = {
        toolName: 'list_projects',
        durationMs: 100,
        success: true,
      }
      const result = ToolCallDetailSchema.safeParse(toolCall)
      expect(result.success).toBe(true)
    })
  })

  describe('StepDetailSchema', () => {
    test('parses step with tool calls', () => {
      const step = {
        stepNumber: 1,
        toolCalls: [
          { toolName: 'create_task', toolCallId: 'call-1', args: { title: 'Task 1' } },
          { toolName: 'search_tasks', toolCallId: 'call-2', args: { query: 'test' } },
        ],
        usage: { inputTokens: 100, outputTokens: 50 },
      }
      const result = StepDetailSchema.safeParse(step)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.stepNumber).toBe(1)
      expect(result.data.toolCalls).toHaveLength(2)
      expect(result.data.usage?.inputTokens).toBe(100)
    })

    test('parses minimal step', () => {
      const step = {
        stepNumber: 2,
      }
      const result = StepDetailSchema.safeParse(step)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.stepNumber).toBe(2)
    })

    test('parses step with text and finishReason', () => {
      const step = {
        stepNumber: 1,
        text: 'I will search for matching tasks.',
        finishReason: 'tool-calls',
        usage: { inputTokens: 100, outputTokens: 50 },
      }
      const result = StepDetailSchema.safeParse(step)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.text).toBe('I will search for matching tasks.')
      expect(result.data.finishReason).toBe('tool-calls')
    })

    test('parses step with inline tool result', () => {
      const step = {
        stepNumber: 1,
        toolCalls: [
          {
            toolName: 'create_task',
            toolCallId: 'call-1',
            args: { title: 'Task 1' },
            result: { id: 'task-abc' },
          },
        ],
      }
      const result = StepDetailSchema.safeParse(step)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.toolCalls?.[0]?.result).toEqual({ id: 'task-abc' })
    })

    test('parses step with inline tool error', () => {
      const step = {
        stepNumber: 1,
        toolCalls: [
          {
            toolName: 'create_task',
            toolCallId: 'call-1',
            args: { title: 'Task 1' },
            error: 'permission denied',
          },
        ],
      }
      const result = StepDetailSchema.safeParse(step)
      expect(result.success).toBe(true)
      assert(result.success)
      expect(result.data.toolCalls?.[0]?.error).toBe('permission denied')
    })
  })

  describe('safeParseLlmTrace with full data', () => {
    test('parses trace with complete data', () => {
      const trace = {
        timestamp: Date.now(),
        userId: 'user-123',
        model: 'gpt-4',
        duration: 2500,
        steps: 3,
        totalTokens: { inputTokens: 150, outputTokens: 250 },
        toolCalls: [
          {
            toolName: 'create_task',
            durationMs: 500,
            success: true,
            toolCallId: 'call-1',
            args: { title: 'Test task' },
            result: { id: 'task-123' },
          },
        ],
        responseId: 'resp-123',
        actualModel: 'gpt-4-0125-preview',
        finishReason: 'stop',
        messageCount: 5,
        toolCount: 10,
        generatedText: 'I created a task for you.',
        stepsDetail: [
          {
            stepNumber: 1,
            toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', args: {} }],
            usage: { inputTokens: 50, outputTokens: 80 },
          },
        ],
      }
      const result = safeParseLlmTrace(trace)
      expect(result).not.toBeNull()
      assert(result !== null)
      expect(result.responseId).toBe('resp-123')
      expect(result.actualModel).toBe('gpt-4-0125-preview')
      expect(result.generatedText).toBe('I created a task for you.')
      expect(result.stepsDetail).toHaveLength(1)
    })
  })
})
