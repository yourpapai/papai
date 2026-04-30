// tests/deferred-prompts/execution-modes.test.ts
//
// Mocked modules: ai, @ai-sdk/openai-compatible, ../src/logger.js
// (Uses mockLogger + setupTestDb helpers; mocks ai + openai-compatible in beforeEach)
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { setConfig } from '../../src/config.js'
import { dispatchExecution } from '../../src/deferred-prompts/proactive-llm.js'
import type { DeferredExecutionContext } from '../../src/deferred-prompts/proactive-llm.js'
import type { ExecutionMetadata } from '../../src/deferred-prompts/types.js'
import { appendHistory } from '../../src/history.js'
import { loadHistory } from '../../src/history.js'
import { loadFacts } from '../../src/memory.js'
import type { MemoryFact } from '../../src/types/memory.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

// Track generateText calls
type GenerateTextResult = {
  text: string
  toolCalls: unknown[]
  toolResults: unknown[]
  steps: unknown[] | undefined
  response: { messages: ModelMessage[] }
}
type GenerateTextCall = { model: string; system: string; messages: ModelMessage[]; tools: unknown }

// Helper defined outside test blocks — no-conditional-in-test requires predicate helpers at module scope
function messageIncludesText(msgs: readonly ModelMessage[], text: string): boolean {
  return msgs.some((m) => typeof m.content === 'string' && m.content.includes(text))
}

const containsFact = (
  facts: readonly MemoryFact[],
  expected: Readonly<Pick<MemoryFact, 'identifier' | 'title' | 'url'>>,
): boolean =>
  facts.some(
    (fact) => fact.identifier === expected.identifier && fact.title === expected.title && fact.url === expected.url,
  )

const USER_ID = 'exec-mode-user'
function makeExecCtx(): DeferredExecutionContext {
  return {
    createdByUserId: USER_ID,
    deliveryTarget: {
      contextId: USER_ID,
      contextType: 'dm',
      threadId: null,
      audience: 'personal',
      mentionUserIds: [],
      createdByUserId: USER_ID,
      createdByUsername: null,
    },
  }
}

function makeGroupThreadExecCtx(): DeferredExecutionContext {
  return {
    createdByUserId: USER_ID,
    deliveryTarget: {
      contextId: '-1001',
      contextType: 'group',
      threadId: '42',
      audience: 'personal',
      mentionUserIds: [USER_ID],
      createdByUserId: USER_ID,
      createdByUsername: null,
    },
  }
}

type UserConfigOptions = Readonly<{ smallModel: string | null }>

function setupUserConfig(...args: readonly [] | readonly [UserConfigOptions]): void {
  setConfig(USER_ID, 'llm_apikey', 'test-key')
  setConfig(USER_ID, 'llm_baseurl', 'http://localhost:11434/v1')
  setConfig(USER_ID, 'main_model', 'main-model')
  setConfig(USER_ID, 'timezone', 'UTC')
  const opts = args[0]
  if (opts !== undefined && opts.smallModel !== null) {
    setConfig(USER_ID, 'small_model', opts.smallModel)
  }
}

describe('dispatchExecution', () => {
  const generateTextCalls: GenerateTextCall[] = []

  let generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
    generateTextCalls.push(args)
    return Promise.resolve({
      text: 'Mock response',
      toolCalls: [],
      toolResults: [],
      steps: undefined,
      response: { messages: [] },
    })
  }

  beforeEach(async () => {
    mockLogger()
    generateTextCalls.length = 0
    generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
      generateTextCalls.push(args)
      return Promise.resolve({
        text: 'Mock response',
        toolCalls: [],
        toolResults: [],
        steps: undefined,
        response: { messages: [] },
      })
    }
    void mock.module('ai', () => ({
      generateText: (args: GenerateTextCall): Promise<GenerateTextResult> => generateTextImpl(args),
      tool: (opts: unknown): unknown => opts,
      stepCountIs: (_n: number): unknown => undefined,
    }))
    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible:
        (opts: { name: string; apiKey: string; baseURL: string }): ((modelId: string) => string) =>
        (modelId: string): string =>
          `${opts.name}:${modelId}`,
    }))
    await setupTestDb()
  })

  describe('lightweight mode', () => {
    const metadata: ExecutionMetadata = {
      mode: 'lightweight',
      delivery_brief: 'Friendly hydration reminder',
      context_snapshot: null,
    }

    test('uses small_model when configured', async () => {
      setupUserConfig({ smallModel: 'small-model' })
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.model).toContain('small-model')
    })

    test('falls back to main_model when small_model not set', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('includes get_current_time tool only', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      expect(generateTextCalls[0]!.tools).toBeDefined()
      expect(generateTextCalls[0]!.tools).toHaveProperty('get_current_time')
      // Should not have task-related tools in lightweight mode
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('create_task')
    })

    test('uses minimal system prompt', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      const system = generateTextCalls[0]!.system
      expect(system).toContain('[PROACTIVE EXECUTION]')
      expect(system).not.toContain('DEFERRED PROMPTS')
    })

    test('includes delivery brief in messages', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      const systemMsgs = messages.filter((m) => m.role === 'system')
      expect(messageIncludesText(systemMsgs, '[DELIVERY BRIEF]')).toBe(true)
      expect(messageIncludesText(systemMsgs, 'Friendly hydration reminder')).toBe(true)
    })

    test('wraps prompt in deferred task delimiters', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      const userMsgs = messages.filter((m) => m.role === 'user')
      expect(messageIncludesText(userMsgs, '===DEFERRED_TASK===')).toBe(true)
      expect(messageIncludesText(userMsgs, 'drink water')).toBe(true)
    })

    test('does not load conversation history', async () => {
      setupUserConfig()
      appendHistory(USER_ID, [{ role: 'user', content: 'old message' }])
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      expect(messageIncludesText(messages, 'old message')).toBe(false)
    })

    test('includes context snapshot when present', async () => {
      setupUserConfig()
      const withSnapshot: ExecutionMetadata = { ...metadata, context_snapshot: 'User discussed migration' }
      await dispatchExecution(makeExecCtx(), 'scheduled', 'remind about migration', withSnapshot, () => null)
      const messages = generateTextCalls[0]!.messages
      const systemMsgs = messages.filter((m) => m.role === 'system')
      expect(messageIncludesText(systemMsgs, '[CONTEXT FROM CREATION TIME]')).toBe(true)
    })

    test('omits context snapshot message when null', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'drink water', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      expect(messageIncludesText(messages, '[CONTEXT FROM CREATION TIME]')).toBe(false)
    })

    test('persists lightweight history to group thread delivery context instead of creator DM', async () => {
      setupUserConfig()
      generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
        generateTextCalls.push(args)
        return Promise.resolve({
          text: 'Thread reminder',
          toolCalls: [],
          toolResults: [],
          steps: undefined,
          response: { messages: [{ role: 'assistant', content: 'Thread reminder' }] },
        })
      }

      await dispatchExecution(makeGroupThreadExecCtx(), 'scheduled', 'drink water', metadata, () => null)

      expect(loadHistory('-1001:42')).toEqual([{ role: 'assistant', content: 'Thread reminder' }])
      expect(loadHistory(USER_ID)).toEqual([])
    })
  })

  describe('context mode', () => {
    const metadata: ExecutionMetadata = {
      mode: 'context',
      delivery_brief: 'Remind about the standup discussion',
      context_snapshot: 'Discussed Q2 sprint priorities',
    }

    test('uses main_model', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'standup reminder', metadata, () => null)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      appendHistory(USER_ID, [{ role: 'user', content: 'history message' }])
      await dispatchExecution(makeExecCtx(), 'scheduled', 'standup reminder', metadata, () => null)
      const messages = generateTextCalls[0]!.messages
      expect(messageIncludesText(messages, 'history message')).toBe(true)
    })

    test('includes get_current_time tool only', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'standup reminder', metadata, () => null)
      expect(generateTextCalls[0]!.tools).toBeDefined()
      expect(generateTextCalls[0]!.tools).toHaveProperty('get_current_time')
      // Should not have task-related tools in context mode
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('create_task')
    })

    test('uses minimal system prompt', async () => {
      setupUserConfig()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'standup reminder', metadata, () => null)
      const system = generateTextCalls[0]!.system
      expect(system).toContain('[PROACTIVE EXECUTION]')
    })
  })

  describe('full mode', () => {
    const metadata: ExecutionMetadata = {
      mode: 'full',
      delivery_brief: 'Check overdue tasks grouped by project',
      context_snapshot: null,
    }

    test('uses main_model', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('includes tools with proactive mode', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      expect(generateTextCalls[0]!.tools).toBeDefined()
      // Full mode with proactive delivery should exclude deferred prompt tools
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('create_deferred_prompt')
      expect(generateTextCalls[0]!.tools).toHaveProperty('papai_tool')
    })

    test('uses full system prompt', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      const system = generateTextCalls[0]!.system
      // Full system prompt includes provider-specific content
      expect(system.length).toBeGreaterThan(200)
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      appendHistory(USER_ID, [{ role: 'user', content: 'full mode history' }])
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      const messages = generateTextCalls[0]!.messages
      expect(messageIncludesText(messages, 'full mode history')).toBe(true)
    })

    test('returns error when provider cannot be built', async () => {
      setupUserConfig()
      const result = await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => null)
      expect(result).toContain('task provider not configured')
    })

    test('stores extracted facts in group thread delivery context instead of creator DM', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
        generateTextCalls.push(args)
        return Promise.resolve({
          text: 'Created task',
          toolCalls: [],
          toolResults: [{ toolName: 'create_task', output: { id: 'task-1', title: 'Thread task', number: 17 } }],
          steps: undefined,
          response: { messages: [] },
        })
      }

      await dispatchExecution(makeGroupThreadExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)

      expect(loadFacts('-1001:42')).toEqual([
        expect.objectContaining({ identifier: '#17', title: 'Thread task', url: '' }),
      ])
      expect(loadFacts(USER_ID)).toEqual([])
    })

    test('stores extracted facts from all tool-call steps', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
        generateTextCalls.push(args)
        return Promise.resolve({
          text: 'Created tasks',
          toolCalls: [{ toolName: 'create_task', input: { title: 'Later task' } }],
          toolResults: [{ toolName: 'create_task', output: { id: 'task-2', title: 'Later task', number: 19 } }],
          steps: [
            {
              toolCalls: [{ toolName: 'create_task', input: { title: 'Earlier task' } }],
              toolResults: [{ toolName: 'create_task', output: { id: 'task-1', title: 'Earlier task', number: 18 } }],
            },
            {
              toolCalls: [{ toolName: 'create_task', input: { title: 'Later task' } }],
              toolResults: [{ toolName: 'create_task', output: { id: 'task-2', title: 'Later task', number: 19 } }],
            },
          ],
          response: { messages: [] },
        })
      }

      await dispatchExecution(makeGroupThreadExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)

      const threadFacts = loadFacts('-1001:42')
      expect(containsFact(threadFacts, { identifier: '#18', title: 'Earlier task', url: '' })).toBe(true)
      expect(containsFact(threadFacts, { identifier: '#19', title: 'Later task', url: '' })).toBe(true)
      expect(loadFacts(USER_ID)).toEqual([])
    })
  })

  describe('fallback behavior', () => {
    test('treats empty metadata as full mode', async () => {
      setupUserConfig()
      const emptyMetadata: ExecutionMetadata = { mode: 'full', delivery_brief: '', context_snapshot: null }
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'test', emptyMetadata, () => provider)
      expect(generateTextCalls[0]!.tools).toBeDefined()
    })
  })

  describe('stored delivery context', () => {
    const metadata: ExecutionMetadata = {
      mode: 'full',
      delivery_brief: 'Check overdue tasks grouped by project',
      context_snapshot: null,
    }

    test('full mode uses stored delivery context for tools and history while reading config from creator', async () => {
      setupUserConfig()
      const provider = createMockProvider()

      await dispatchExecution(
        {
          createdByUserId: USER_ID,
          deliveryTarget: {
            contextId: '-1001:42',
            contextType: 'group',
            threadId: '42',
            audience: 'personal',
            mentionUserIds: [USER_ID],
            createdByUserId: USER_ID,
            createdByUsername: null,
          },
        },
        'scheduled',
        'check overdue',
        metadata,
        () => provider,
      )

      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.tools).toHaveProperty('papai_tool')
    })
  })
})
