// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// tests/deferred-prompts/proactive-llm.test.ts
//
// Mocked modules: ai, @ai-sdk/openai-compatible, ../src/logger.js
// (Uses mockLogger + setupTestDb helpers; mocks ai + openai-compatible in beforeEach)
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { NO_ANALYTICS_SCOPE } from '../../src/analytics/provider-request-scope.js'
import { updateByokLlmConfig } from '../../src/byok-llm/store.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { setConfig } from '../../src/config.testing.js'
import {
  subscribe as subscribeDebugBus,
  type DebugEvent,
  unsubscribe as unsubscribeDebugBus,
} from '../../src/debug/event-bus.js'
import { dispatchExecution } from '../../src/deferred-prompts/proactive-llm.js'
import type { DeferredExecutionContext } from '../../src/deferred-prompts/proactive-llm.js'
import type { ExecutionMetadata } from '../../src/deferred-prompts/types.js'
import { appendHistory } from '../../src/history.js'
import { createLlmProvider, setAdminRoleBindings } from '../../src/llm-providers/store.js'
import { clearLlmAdminCacheForTesting } from '../../src/llm-providers/store.testing.js'
import { saveMemoryProfile } from '../../src/long-term-memory/store.js'
import { loadFacts } from '../../src/memory.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import type { MemoryFact } from '../../src/types/memory.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { flushMicrotasks, mockLogger, seedAdminLlmBinding, setupTestDb } from '../utils/test-helpers.js'

// Track generateText calls
type GenerateTextResult = {
  text: string
  finishReason?: string
  toolCalls: unknown[]
  toolResults: unknown[]
  steps: unknown[] | undefined
  usage?: { inputTokens: number; outputTokens: number }
  finalStep: { response: { id?: string; modelId?: string; messages: ModelMessage[] } }
}
type GenerateTextCall = {
  model: string
  instructions: string
  messages: ModelMessage[]
  tools: unknown
  toolsContext?: Record<string, unknown>
  stopWhen?: unknown
  prepareStep?: (arg: { stepNumber: number; steps?: readonly unknown[] }) => { activeTools?: string[] }
}
type BuildModelCall = { apiKey: string; baseURL: string; modelId: string }

// Helper defined outside test blocks — no-conditional-in-test requires predicate helpers at module scope
function messageIncludesText(msgs: readonly ModelMessage[], text: string): boolean {
  return msgs.some((m) => typeof m.content === 'string' && m.content.includes(text))
}

function toolNamesOf(tools: unknown): string[] {
  return typeof tools === 'object' && tools !== null ? Object.keys(tools) : []
}

type ToolDescriptorProbe = { contextSchema?: unknown; execute?: unknown }

function toolDescriptorsOf(tools: unknown): Record<string, ToolDescriptorProbe> {
  if (typeof tools !== 'object' || tools === null) return {}
  const entries = Object.entries(tools).map(([name, descriptor]): readonly [string, ToolDescriptorProbe] => {
    const probe: ToolDescriptorProbe = {}
    if (typeof descriptor === 'object' && descriptor !== null) {
      probe.contextSchema = Reflect.get(descriptor, 'contextSchema')
      probe.execute = Reflect.get(descriptor, 'execute')
    }
    return [name, probe]
  })
  return Object.fromEntries(entries)
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

function setupUserConfig(): void {
  setConfig(USER_ID, 'timezone', 'UTC')
  const provider = createLlmProvider(
    { label: 'admin', providerType: 'openai', baseUrl: 'http://localhost:11434/v1', apiKey: 'test-key' },
    'admin',
  )
  setAdminRoleBindings(
    {
      main: { providerId: provider.id, model: 'main-model' },
      small: null,
      embedding: null,
    },
    'admin',
  )
}

describe('dispatchExecution', () => {
  const generateTextCalls: GenerateTextCall[] = []
  const buildModelCalls: BuildModelCall[] = []

  let generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
    generateTextCalls.push(args)
    return Promise.resolve({
      text: 'Mock response',
      toolCalls: [],
      toolResults: [],
      steps: [],
      finalStep: { response: { messages: [] } },
    })
  }

  beforeEach(async () => {
    mockLogger()
    clearLlmAdminCacheForTesting()
    generateTextCalls.length = 0
    buildModelCalls.length = 0
    generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
      generateTextCalls.push(args)
      return Promise.resolve({
        text: 'Mock response',
        toolCalls: [],
        toolResults: [],
        steps: [],
        finalStep: { response: { messages: [] } },
      })
    }
    void mock.module('ai', () => ({
      generateText: (args: GenerateTextCall): Promise<GenerateTextResult> => generateTextImpl(args),
      tool: (opts: unknown): unknown => opts,
      isStepCount: (n: number): unknown => ({ __stopAfterSteps: n }),
    }))
    void mock.module('../../src/llm-model-builder.js', () => ({
      buildChatModel: (apiKey: string, baseUrl: string, modelId: string): string => {
        buildModelCalls.push({ apiKey, baseURL: baseUrl, modelId })
        return `openai-compatible:${modelId}`
      },
      getOpenAICompatibleProvider:
        (apiKey: string, baseUrl: string): ((modelId: string) => string) =>
        (modelId: string): string => {
          buildModelCalls.push({ apiKey, baseURL: baseUrl, modelId })
          return `openai-compatible:${modelId}`
        },
      clearModelBuilderCacheForTesting: (): void => {},
    }))
    await setupTestDb()
  })

  describe('unified execution', () => {
    test('dispatchExecution always builds the full toolset regardless of stored metadata', async () => {
      // metadata that used to select the "lightweight" branch must now still expose task tools
      const metadata: ExecutionMetadata = {
        delivery_brief: 'be brief',
        context_snapshot: null,
      }
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'ping', metadata, () => provider)
      const call = generateTextCalls[generateTextCalls.length - 1]!
      const toolNames = toolNamesOf(call.tools)
      expect(toolNames).toContain('search_tools')
      expect(toolNames).toContain('load_tool')
    })
  })

  describe('llm trace emission', () => {
    const metadata: ExecutionMetadata = {
      delivery_brief: 'be brief',
      context_snapshot: null,
    }

    const captureBus = (): { events: DebugEvent[]; stop: () => void } => {
      const events: DebugEvent[] = []
      const listener = (event: DebugEvent): void => {
        events.push(event)
      }
      subscribeDebugBus(listener)
      return { events, stop: (): void => unsubscribeDebugBus(listener) }
    }

    test('emits llm:start/llm:end attributed to the delivery target for trace correlation', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
        generateTextCalls.push(args)
        return Promise.resolve({
          text: 'Proactive reply',
          toolCalls: [],
          toolResults: [],
          steps: [],
          usage: { inputTokens: 11, outputTokens: 7 },
          finishReason: 'stop',
          finalStep: { response: { id: 'resp-1', modelId: 'main-model', messages: [] } },
        })
      }
      const bus = captureBus()
      try {
        await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      } finally {
        bus.stop()
      }

      const start = bus.events.find((event) => event.type === 'llm:start')
      const end = bus.events.find((event) => event.type === 'llm:end')
      expect(start).toBeDefined()
      expect(end).toBeDefined()
      expect(start?.scope).toEqual({ kind: 'user', userId: USER_ID })
      expect(start?.data['model']).toBe('main-model')
      expect(end?.scope).toEqual({ kind: 'user', userId: USER_ID })
      expect(end?.data['chatUserId']).toBe(USER_ID)
      expect(end?.data['contextType']).toBe('dm')
      expect(end?.data['model']).toBe('main-model')
      expect(end?.data['generatedText']).toBe('Proactive reply')
      expect(end?.data['finishReason']).toBe('stop')
      expect(end?.data['totalDuration']).toBeNumber()
      expect(String(end?.turnId)).toContain('proactive:')
    })

    test('emits llm:error and rethrows when generation fails', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      generateTextImpl = (): Promise<GenerateTextResult> => Promise.reject(new Error('provider down'))
      const bus = captureBus()
      try {
        await expect(
          dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider),
        ).rejects.toThrow('provider down')
      } finally {
        bus.stop()
      }

      const error = bus.events.find((event) => event.type === 'llm:error')
      expect(error).toBeDefined()
      expect(error?.scope).toEqual({ kind: 'user', userId: USER_ID })
      expect(error?.data['chatUserId']).toBe(USER_ID)
      expect(error?.data['contextType']).toBe('dm')
      expect(error?.data['model']).toBe('main-model')
      expect(error?.data['error']).toBe('provider down')
    })
  })

  describe('progressive disclosure prepareStep gating', () => {
    test('gates activeTools to core + meta tools before any tool is loaded', async () => {
      const metadata: ExecutionMetadata = {
        delivery_brief: 'be brief',
        context_snapshot: null,
      }
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'ping', metadata, () => provider)
      const call = generateTextCalls[generateTextCalls.length - 1]!
      expect(call.prepareStep).toBeDefined()

      // Exercise the real createDisclosurePrepareStep closure at a pre-load step boundary
      // (no steps completed yet, so neither the pre-load stall nor meta-churn fallback opens).
      const result = call.prepareStep!({ stepNumber: 0, steps: [] })

      expect(result.activeTools).toBeDefined()
      const activeTools = result.activeTools!
      expect(activeTools).toContain('get_current_time')
      expect(activeTools).toContain('search_tools')
      expect(activeTools).toContain('load_tool')
      expect(activeTools).not.toContain('create_task')
      expect(activeTools).not.toContain('search_tasks')
    })
  })

  describe('unified proactive run', () => {
    const metadata: ExecutionMetadata = {
      delivery_brief: 'Check overdue tasks grouped by project',
      context_snapshot: null,
    }

    test('uses main_model', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      expect(generateTextCalls[0]!.model).toContain('main-model')
    })

    test('uses complete BYOK config for full generation (overriding admin)', async () => {
      seedAdminLlmBinding()
      setConfig(USER_ID, 'timezone', 'UTC')
      updateByokLlmConfig(
        USER_ID,
        {
          llm_apikey: 'sk-byok-deferred',
          llm_baseurl: 'https://byok-deferred.invalid/v1',
          main_model: 'byok-main-deferred',
        },
        'admin-1',
      )
      const provider = createMockProvider()

      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)

      expect(buildModelCalls).toEqual([
        {
          apiKey: 'sk-byok-deferred',
          baseURL: 'https://byok-deferred.invalid/v1',
          modelId: 'byok-main-deferred',
        },
      ])
      expect(generateTextCalls[0]!.model).toBe('openai-compatible:byok-main-deferred')
    })

    test('includes tools with proactive mode', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      expect(generateTextCalls[0]!.tools).toBeDefined()
      // Proactive delivery excludes deferred-prompt tools
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('create_reminder')
      expect(generateTextCalls[0]!.tools).toHaveProperty('create_task')
      expect(generateTextCalls[0]!.tools).toHaveProperty('search_tasks')
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('papai_tool')
    })

    test('risky ru turn → verifier prompt is Russian', async () => {
      setupUserConfig()
      setConfig(USER_ID, 'language', 'ru')
      const provider = createMockProvider()
      generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
        generateTextCalls.push(args)
        return Promise.resolve({
          text: '',
          toolCalls: [],
          toolResults: [],
          steps: [],
          finalStep: { response: { messages: [] } },
        })
      }

      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)

      expect(generateTextCalls).toHaveLength(2)
      expect(generateTextCalls[1]!.instructions).toContain('Отвечай на русском языке')
    })

    test('uses full system prompt', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      const instructions = generateTextCalls[0]!.instructions
      // Full system prompt includes provider-specific content
      expect(instructions.length).toBeGreaterThan(200)
    })

    test('loads conversation history', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      appendHistory(USER_ID, [{ role: 'user', content: 'full mode history' }])
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)
      const messages = generateTextCalls[0]!.messages
      expect(messageIncludesText(messages, 'full mode history')).toBe(true)
    })

    test('uses group long-term memory for group thread delivery context', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      saveMemoryProfile(
        { scopeId: '-1001', scopeType: 'group' },
        '## Group memory\n- Group escalations use the incident queue',
        '2026-06-12T00:00:00.000Z',
      )
      saveMemoryProfile(
        { scopeId: '-1001:42', scopeType: 'personal' },
        '## Personal memory\n- This personal thread profile should not be injected',
        '2026-06-12T00:00:00.000Z',
      )

      await dispatchExecution(makeGroupThreadExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)

      const instructions = generateTextCalls[0]!.instructions
      expect(instructions).toContain('Group escalations use the incident queue')
      expect(instructions).not.toContain('This personal thread profile should not be injected')
    })

    test('falls back to providerless full execution when provider cannot be built', async () => {
      setupUserConfig()
      const result = await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', metadata, () => null)
      expect(result).toBe('Mock response')
      expect(generateTextCalls).toHaveLength(1)
      expect(generateTextCalls[0]!.instructions).toContain('task tracker tools are unavailable')
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('create_task')
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
          steps: [],
          finalStep: { response: { messages: [] } },
        })
      }

      await dispatchExecution(makeGroupThreadExecCtx(), 'scheduled', 'check overdue', metadata, () => provider)

      expect(loadFacts('-1001:42')).toEqual([
        expect.objectContaining({ identifier: '#17', title: 'Thread task', url: '' }),
      ])
      expect(loadFacts(USER_ID)).toEqual([])
    })

    test('resolves provider from storage context instead of creator ID', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      const resolvedContextIds: string[] = []

      await dispatchExecution(makeGroupThreadExecCtx(), 'scheduled', 'check overdue', metadata, (contextId) => {
        resolvedContextIds.push(contextId)
        return provider
      })

      expect(resolvedContextIds).toEqual(['-1001:42'])
    })

    test('resolves provider from scoped main context while preserving thread storage', async () => {
      setupUserConfig()
      const scopedThreadContextId = toScopedThreadContextId({
        platformInstanceId: 'telegram-secondary',
        nativeContextId: '-1001',
        threadId: '42',
      })
      const scopedMainContextId = toScopedContextId({
        platformInstanceId: 'telegram-secondary',
        nativeContextId: '-1001',
      })
      const provider = createMockProvider()
      const resolvedContextIds: string[] = []
      generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
        generateTextCalls.push(args)
        return Promise.resolve({
          text: 'Created task',
          toolCalls: [],
          toolResults: [{ toolName: 'create_task', output: { id: 'task-1', title: 'Scoped thread task', number: 21 } }],
          steps: [],
          finalStep: { response: { messages: [] } },
        })
      }

      await dispatchExecution(
        {
          createdByUserId: USER_ID,
          deliveryTarget: {
            contextId: '-1001',
            storageContextId: scopedThreadContextId,
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
        (contextId) => {
          resolvedContextIds.push(contextId)
          return provider
        },
      )

      expect(resolvedContextIds).toEqual([scopedMainContextId])
      expect(loadFacts(scopedThreadContextId)).toEqual([
        expect.objectContaining({ identifier: '#21', title: 'Scoped thread task', url: '' }),
      ])
    })

    test('background trim uses scoped main config context instead of thread storage', async () => {
      seedAdminLlmBinding()
      setConfig(USER_ID, 'timezone', 'UTC')
      const scopedThreadContextId = toScopedThreadContextId({
        platformInstanceId: 'telegram-secondary',
        nativeContextId: '-1001',
        threadId: '42',
      })
      const scopedMainContextId = toScopedContextId({
        platformInstanceId: 'telegram-secondary',
        nativeContextId: '-1001',
      })
      updateByokLlmConfig(
        scopedMainContextId,
        {
          llm_apikey: 'sk-byok-full-trim',
          llm_baseurl: 'https://byok-full-trim.invalid/v1',
          main_model: 'byok-full-main',
          small_model: 'byok-full-small',
        },
        'admin-1',
      )
      appendHistory(
        scopedThreadContextId,
        Array.from({ length: 99 }, (_, index): ModelMessage => ({ role: 'assistant', content: `old ${index}` })),
      )
      const generateTextResults: readonly Promise<GenerateTextResult>[] = [
        Promise.resolve({
          text: 'Thread response',
          toolCalls: [],
          toolResults: [],
          steps: [],
          finalStep: { response: { messages: [{ role: 'assistant', content: 'new response' }] } },
        }),
        Promise.resolve({
          text: JSON.stringify({ keep_indices: Array.from({ length: 50 }, (_, index) => index), summary: 'trimmed' }),
          toolCalls: [],
          toolResults: [],
          steps: [],
          finalStep: { response: { messages: [] } },
        }),
        Promise.resolve({
          text: JSON.stringify({ profile: null, records: [], updates: [] }),
          toolCalls: [],
          toolResults: [],
          steps: [],
          finalStep: { response: { messages: [] } },
        }),
      ]
      let callIndex = 0
      generateTextImpl = (args: GenerateTextCall): Promise<GenerateTextResult> => {
        generateTextCalls.push(args)
        const result = generateTextResults[callIndex]!
        callIndex += 1
        return result
      }

      await dispatchExecution(
        {
          createdByUserId: USER_ID,
          deliveryTarget: {
            contextId: '-1001',
            storageContextId: scopedThreadContextId,
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
        () => createMockProvider(),
      )
      await flushMicrotasks()

      expect(buildModelCalls).toEqual([
        { apiKey: 'sk-byok-full-trim', baseURL: 'https://byok-full-trim.invalid/v1', modelId: 'byok-full-main' },
        { apiKey: 'sk-byok-full-trim', baseURL: 'https://byok-full-trim.invalid/v1', modelId: 'byok-full-small' },
        { apiKey: 'sk-byok-full-trim', baseURL: 'https://byok-full-trim.invalid/v1', modelId: 'byok-full-small' },
      ])
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
              toolResults: [
                {
                  toolName: 'create_task',
                  output: { id: 'task-1', title: 'Earlier task', number: 18 },
                },
              ],
            },
            {
              toolCalls: [{ toolName: 'create_task', input: { title: 'Later task' } }],
              toolResults: [
                {
                  toolName: 'create_task',
                  output: { id: 'task-2', title: 'Later task', number: 19 },
                },
              ],
            },
          ],
          finalStep: { response: { messages: [] } },
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
    test('treats empty metadata as a full run', async () => {
      setupUserConfig()
      const emptyMetadata: ExecutionMetadata = {
        delivery_brief: '',
        context_snapshot: null,
      }
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'test', emptyMetadata, () => provider)
      expect(generateTextCalls[0]!.tools).toBeDefined()
    })
  })

  describe('stored delivery context', () => {
    const metadata: ExecutionMetadata = {
      delivery_brief: 'Check overdue tasks grouped by project',
      context_snapshot: null,
    }

    test('uses stored delivery context for tools and history while reading config from creator', async () => {
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
      expect(generateTextCalls[0]!.tools).toHaveProperty('create_task')
      expect(generateTextCalls[0]!.tools).not.toHaveProperty('papai_tool')
    })
  })

  describe('system prompt context scoping', () => {
    const fullMetadata: ExecutionMetadata = {
      delivery_brief: 'Check overdue tasks',
      context_snapshot: null,
    }

    test('builds system prompt from delivery storageContextId, not creator userId', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      const deliveryStorageContextId = '-1001:thread-7'
      // Disable save_memo only in the delivery context (storageContextId).
      // The creator's personal context (USER_ID) has empty prefs.
      // When the system prompt uses the delivery context, buildUnavailableLine sees save_memo
      // as a disabled override and emits the "Unavailable tools" safety-net line.
      // When the bug is present (uses creator context), getToolPrefs(USER_ID) is empty
      // so buildUnavailableLine returns null and the line is absent.
      setToolPrefs(deliveryStorageContextId, {
        domainDefaults: {},
        toolOverrides: { save_memo: 'deny' },
      })

      await dispatchExecution(
        {
          createdByUserId: USER_ID,
          deliveryTarget: {
            contextId: '-1001',
            contextType: 'group',
            threadId: 'thread-7',
            audience: 'personal',
            mentionUserIds: [USER_ID],
            createdByUserId: USER_ID,
            createdByUsername: null,
          },
        },
        'scheduled',
        'check overdue',
        fullMetadata,
        () => provider,
      )

      expect(generateTextCalls).toHaveLength(1)
      const instructions = generateTextCalls[0]!.instructions
      // After the fix: prompt uses delivery storageContextId prefs -> "Unavailable tools" line present.
      // With the bug: prompt uses creator userId prefs (empty) -> no unavailable line.
      expect(instructions).toContain('Unavailable tools')
    })
  })

  describe('provider request scope closure', () => {
    const scopeMetadata: ExecutionMetadata = {
      delivery_brief: 'Check overdue tasks',
      context_snapshot: null,
    }

    const makeExecCtxFor = (userId: string): DeferredExecutionContext => ({
      createdByUserId: userId,
      deliveryTarget: {
        contextId: userId,
        contextType: 'dm',
        threadId: null,
        audience: 'personal',
        mentionUserIds: [],
        createdByUserId: userId,
        createdByUsername: null,
      },
    })

    test('passes a toolsContext record keyed by every name in the final ToolSet', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', scopeMetadata, () => provider)

      const call = generateTextCalls[generateTextCalls.length - 1]!
      const toolsContext = call.toolsContext
      expect(toolsContext).toBeDefined()
      const toolNames = toolNamesOf(call.tools)
      expect(Object.keys(toolsContext!).toSorted()).toEqual(toolNames.toSorted())
      // Every value references the same scope object.
      const scopes = new Set(Object.values(toolsContext!))
      expect(scopes.size).toBe(1)
    })

    test('attaches the strict provider scope contextSchema to every executable tool', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      await dispatchExecution(makeExecCtx(), 'scheduled', 'check overdue', scopeMetadata, () => provider)

      const call = generateTextCalls[generateTextCalls.length - 1]!
      const tools = toolDescriptorsOf(call.tools)
      const executables = Object.entries(tools).filter(([, descriptor]) => descriptor.execute !== undefined)
      expect(executables.length).toBeGreaterThan(0)
      for (const [name, descriptor] of executables) {
        expect(descriptor.contextSchema, name).toBeDefined()
      }
    })

    test('consecutive owners never share a scope object', async () => {
      setupUserConfig()
      const provider = createMockProvider()
      const scopeInputs: string[] = []
      let scopeCounter = 0
      const deps = {
        resolveScope: (input: { createdByUserId: string }): typeof NO_ANALYTICS_SCOPE => {
          scopeInputs.push(input.createdByUserId)
          scopeCounter += 1
          return NO_ANALYTICS_SCOPE
        },
      }

      await dispatchExecution(
        makeExecCtxFor('owner-a'),
        'scheduled',
        'a',
        scopeMetadata,
        () => provider,
        undefined,
        deps,
      )
      await dispatchExecution(
        makeExecCtxFor('owner-b'),
        'scheduled',
        'b',
        scopeMetadata,
        () => provider,
        undefined,
        deps,
      )

      expect(scopeInputs).toEqual(['owner-a', 'owner-b'])
      expect(scopeCounter).toBe(2)
      // Each execution built its own toolsContext record (per-call scope resolution).
      const first = generateTextCalls[0]!.toolsContext
      const second = generateTextCalls[1]!.toolsContext
      expect(first).not.toBe(second)
    })
  })
})
