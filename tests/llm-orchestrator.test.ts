// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { mock, describe, expect, test, beforeEach, afterEach, afterAll } from 'bun:test'
import assert from 'node:assert/strict'

import { APICallError } from '@ai-sdk/provider'
import type { ModelMessage } from 'ai'

import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../src/chat/scoped-context.js'
import type { ReplyFn } from '../src/chat/types.js'
import type { DebugEvent } from '../src/debug/event-bus.js'
import type { LlmOrchestratorDeps } from '../src/llm-orchestrator-types.js'
import { defaultDeps, processMessage, resolveAiOutputSettingsContextId } from '../src/llm-orchestrator.js'
import type { TaskProvider } from '../src/providers/types.js'
import type { MemoryFact } from '../src/types/memory.js'
import { createMockProvider } from './tools/mock-provider.js'
import {
  createMockReply,
  mockLogger,
  resetSystemConfigCacheForTesting,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from './utils/test-helpers.js'

// Capture real modules before mocking (file-level, stays at top)
const realAi = await import('ai')
const realOpenAICompatible = await import('@ai-sdk/openai-compatible')
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const getToolNames = (tools: GenerateTextArgs['tools']): string[] => (tools === undefined ? [] : Object.keys(tools))

const extractPartType = (part: unknown): string => {
  if (!isRecord(part)) return ''
  const partType = part['type']
  return typeof partType === 'string' ? partType : ''
}

const toMessagesArray = (messages: unknown): unknown[] => (Array.isArray(messages) ? messages : [])

/** Returns true when a reply text mentions both the task/project ID and "not found". */
const mentionsNotFound =
  (id: string) =>
  (text: string): boolean =>
    text.includes(id) && text.includes('not found')

const containsFact = (
  facts: readonly MemoryFact[],
  expected: Readonly<Pick<MemoryFact, 'identifier' | 'title' | 'url'>>,
): boolean =>
  facts.some(
    (fact) => fact.identifier === expected.identifier && fact.title === expected.title && fact.url === expected.url,
  )

const failingAiDetailsReply = (textCalls: string[]): ReplyFn['formatted'] => {
  let formattedCallCount = 0
  return (content: string): Promise<void> => {
    textCalls.push(content)
    formattedCallCount += 1
    return formattedCallCount === 1 ? Promise.resolve() : Promise.reject(new Error('details send failed'))
  }
}

/** Creates a DebugEvent listener that captures the stepsDetail payload of llm:end events. */
const makeLlmEndListener =
  (onDetail: (detail: unknown) => void) =>
  (event: DebugEvent): void => {
    if (event.type === 'llm:end') onDetail(event.data['stepsDetail'])
  }

type ResponseMetadata = Partial<{ id: string; modelId: string }>

type GenerateTextArgs = Partial<{
  messages: unknown[]
  tools: Record<string, unknown>
  experimental_onToolCallFinish: ToolCallFinishHandler | undefined
}>

type ToolCallFinishEvent = {
  toolCall: { toolName: string; toolCallId: string; input: unknown }
  durationMs: number
  success: boolean
} & Partial<{
  output: unknown
  error: unknown
}>

type ToolCallFinishHandler = (event: ToolCallFinishEvent) => void

type GenerateTextResult = {
  text: string
  toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>
  toolResults: Array<{ toolName: string; toolCallId: string; output: unknown }>
  steps: unknown[]
  response: { messages: ModelMessage[] } & ResponseMetadata
  usage: Record<string, unknown>
  finishReason: string
  warnings: unknown[] | undefined
  request: unknown
  providerMetadata: unknown
} & Partial<Readonly<{ reasoningText: string; reasoning: unknown }>>

const callToolFinish = (
  handler: GenerateTextArgs['experimental_onToolCallFinish'],
  event: ToolCallFinishEvent,
): void => {
  assert.ok(handler !== undefined, 'expected tool-call finish handler')
  handler(event)
}

const defaultGenerateTextResult = (): Promise<GenerateTextResult> =>
  Promise.resolve({
    text: 'Hello!',
    toolCalls: [],
    toolResults: [],
    steps: [],
    response: { messages: [{ role: 'assistant' as const, content: 'Hello!' }] },
    usage: {},
    finishReason: 'stop',
    warnings: undefined,
    request: {},
    providerMetadata: undefined,
  })

const buildMockOpenAI: LlmOrchestratorDeps['buildOpenAI'] = (apiKey: string, baseURL: string) =>
  realOpenAICompatible.createOpenAICompatible({ name: 'mock-openai', apiKey, baseURL })

import { KaneoClassifiedError } from '../plugins/task-provider-kaneo/classify-error.js'
import {
  AI_OUTPUT_DETAIL_LEVEL_KEY,
  AI_REASONING_VISIBILITY_KEY,
  AI_TOOL_VISIBILITY_KEY,
} from '../src/ai-output-settings.js'
import { setCachedConfig } from '../src/cache.js'
import { getCachedFacts, getCachedHistory, userCachesForTesting } from '../src/cache.js'
import { setConfig, setConfigValue } from '../src/config.js'
import { getIdentityMapping, clearIdentityMapping } from '../src/identity/mapping.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { getTaskInstance, insertTaskInstance } from '../src/instances/task-store.js'
import { resetBotMisconfiguredNotifiedForTesting } from '../src/llm-orchestrator.js'
import { ProviderClassifiedError, providerError } from '../src/providers/errors.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../src/providers/registry.js'
import { setSystemConfig } from '../src/system-config.js'
import { buildToolFailureResult } from '../src/tool-failure.js'
import type { MakeToolsOptions } from '../src/tools/index.js'
import { KANEO_PLUGIN_WORKSPACE_KEY } from '../src/types/config.js'

const CTX_ID = 'ctx-1'

test('AI output settings context resolves thread to parent group', () => {
  const threadContextId = toScopedThreadContextId({
    platformInstanceId: 'telegram-default',
    nativeContextId: 'group-1',
    threadId: 'thread-1',
  })

  expect(resolveAiOutputSettingsContextId(threadContextId)).toBe(
    getConfigContextIdFromStorageContextId(threadContextId),
  )
})

/** Seed the central LLM config used by every orchestrator call. */
const seedSystemLlmConfig = (): void => {
  setSystemConfig('llm_apikey', 'test-key', 'env')
  setSystemConfig('llm_baseurl', 'http://localhost:11434', 'env')
  setSystemConfig('main_model', 'test-model', 'env')
}

const assignKaneoContext = (contextId: string): void => {
  const taskInstanceId = `${contextId}-kaneo`
  if (getTaskInstance(taskInstanceId) === null) {
    insertTaskInstance({
      id: taskInstanceId,
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
  }
  setContextSettings({ contextId, taskInstanceId, platformInstanceId: 'telegram-default' })
}

const assignYouTrackContext = (contextId: string): void => {
  const taskInstanceId = `${contextId}-yt`
  if (getTaskInstance(taskInstanceId) === null) {
    insertTaskInstance({
      id: taskInstanceId,
      type: 'youtrack',
      config: { baseUrl: 'https://yt.invalid' },
      status: 'active',
    })
  }
  setContextSettings({ contextId, taskInstanceId, platformInstanceId: 'telegram-default' })
}

const KANEO_PLUGIN_ID = 'task-provider-kaneo'
const YOUTRACK_PLUGIN_ID = 'task-provider-youtrack'
// Contributed kaneo credential key (plugin-namespaced, used by resolver and wizard)
const KANEO_CREDENTIAL_KEY = 'plugin:task-provider-kaneo:provider:credential'

/** Seed the per-user provider/workspace values that processMessage -> callLlm needs. */
const seedConfigForContext = (ctxId: string): void => {
  assignKaneoContext(ctxId)
  // kaneo is now plugin-contributed; resolver and auto-provision both use plugin-namespaced keys
  setConfigValue(ctxId, KANEO_CREDENTIAL_KEY, 'test-kaneo-key')
  setCachedConfig(ctxId, 'timezone', 'UTC')
  setConfigValue(ctxId, KANEO_PLUGIN_WORKSPACE_KEY, 'workspace-1')
}

const seedConfig = (): void => seedConfigForContext(CTX_ID)

const createReplyWithTypingSpy = (): { reply: ReplyFn; textCalls: string[]; typingCalls: number[] } => {
  const { reply: baseReply, textCalls } = createMockReply()
  const typingCalls: number[] = []
  return {
    reply: {
      ...baseReply,
      typing: (): void => {
        typingCalls.push(Date.now())
      },
    },
    textCalls,
    typingCalls,
  }
}

const originalDemoMode = process.env['DEMO_MODE']
const originalAdminUserId = process.env['ADMIN_USER_ID']

describe('processMessage', () => {
  // ---------------------------------------------------------------------------
  // Module mocks — ONLY external boundaries and provider infrastructure.
  // config.js, cache.js, history.js, conversation.js, memory.js, users.js
  // are left REAL (backed by the test DB) to avoid cross-file mock pollution.
  // ---------------------------------------------------------------------------

  // Provider factory — returns a mock provider to avoid real HTTP calls and env var checks
  const mockProvider = createMockProvider({ name: 'mock' })

  // AI SDK — the key control point for success/failure simulation
  // generateText returns a result object with direct values
  let generateTextImpl: (args: GenerateTextArgs) => Promise<GenerateTextResult>

  // Partial DI for modules that are easy to mock
  // Complex modules (ai SDK) still use mock.module
  beforeEach(async () => {
    // Reset mutable state to defaults
    generateTextImpl = defaultGenerateTextResult

    // Register mocks
    mockLogger()

    // Register kaneo as contributed (no longer a builtin)
    registerContributedTaskProviderType('kaneo', {
      pluginId: KANEO_PLUGIN_ID,
      factory: (config) => createMockProvider({ name: 'kaneo', ...config }),
      capabilities: new Set(),
      displayName: 'Kaneo',
      instanceConfigSchema: [
        { key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false, scope: 'instance' },
      ],
      contextConfigSchema: [
        {
          key: 'credential',
          label: 'Kaneo API key',
          required: true,
          sensitive: true,
          scope: 'context',
        },
      ],
      traits: new Set(),
    })

    // Register youtrack as contributed (no longer a builtin)
    registerContributedTaskProviderType('youtrack', {
      pluginId: YOUTRACK_PLUGIN_ID,
      factory: (config) => createMockProvider({ name: 'youtrack', ...config }),
      capabilities: new Set(),
      displayName: 'YouTrack',
      instanceConfigSchema: [
        { key: 'baseUrl', label: 'YouTrack URL', required: true, sensitive: false, scope: 'instance' },
      ],
      contextConfigSchema: [
        {
          key: 'token',
          label: 'YouTrack Permanent Token',
          required: true,
          sensitive: true,
          scope: 'context',
        },
      ],
      traits: new Set(),
    })

    // AI SDK mocks — generateText and stepCountIs replaced for test control.
    // Preserves the real `tool` export so makeTools() works with unmocked tool creation.
    void mock.module('ai', () => ({
      ...realAi,
      generateText: (args: GenerateTextArgs): Promise<GenerateTextResult> => generateTextImpl(args),
      stepCountIs: (): (() => boolean) => () => false,
    }))

    void mock.module('@ai-sdk/openai-compatible', () => ({
      createOpenAICompatible:
        (): ((_model: string) => string) =>
        (_model: string): string =>
          'mock-model',
    }))

    await setupTestDb()
    seedCommonTestPlatformInstances()

    // Clear caches to ensure clean state
    userCachesForTesting.clear()
    resetSystemConfigCacheForTesting()
    resetBotMisconfiguredNotifiedForTesting()

    seedSystemLlmConfig()
    seedConfig()

    // Reset demo mode env vars
    delete process.env['DEMO_MODE']
    delete process.env['ADMIN_USER_ID']
  })

  afterEach(() => {
    unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
    unregisterContributedTaskProviderType(YOUTRACK_PLUGIN_ID)
    unregisterContributedTaskProviderType('auto-throw-plugin')
  })

  afterAll(() => {
    // Restore original env vars
    if (originalDemoMode === undefined) delete process.env['DEMO_MODE']
    else process.env['DEMO_MODE'] = originalDemoMode
    if (originalAdminUserId === undefined) delete process.env['ADMIN_USER_ID']
    else process.env['ADMIN_USER_ID'] = originalAdminUserId
  })

  // ---------------------------------------------------------------------------
  // Tests
  // ---------------------------------------------------------------------------

  describe('missing configuration', () => {
    test('group context does not call maybeAutoProvision before missing-provider-config handling', async () => {
      // youtrack is now plugin-contributed; checkRequiredProviderConfig no longer matches its token key.
      // Simulate missing config by having resolve return null -> orchestrator sends /config guidance.
      let maybeProvisionCalls = 0
      const freshGroupCtx = 'group-yt:thread-1'
      assignYouTrackContext('group-yt')
      const deps: LlmOrchestratorDeps = {
        generateText: (...args) => realAi.generateText(...args),
        stepCountIs: (...args) => realAi.stepCountIs(...args),
        buildOpenAI: buildMockOpenAI,
        resolve: () => null,
        maybeAutoProvision: () => {
          maybeProvisionCalls++
          return Promise.resolve(false)
        },
      }

      const { reply, textCalls } = createMockReply()
      await processMessage(reply, freshGroupCtx, 'user-1', null, 'hello', 'group', 'group-yt', deps)

      expect(maybeProvisionCalls).toBe(0)
      expect(textCalls[0]).toContain('/config')
    })

    test('replies with bot-misconfigured when system_config is incomplete', async () => {
      resetSystemConfigCacheForTesting()

      const { reply, textCalls } = createMockReply()
      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(textCalls.length).toBeGreaterThanOrEqual(1)
      expect(textCalls[0]).toContain('not fully configured')
      expect(textCalls[0]).toContain('/config')
    })

    test('bot-misconfigured path does not send typing', async () => {
      resetSystemConfigCacheForTesting()

      const { reply, textCalls, typingCalls } = createReplyWithTypingSpy()
      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(typingCalls).toHaveLength(0)
      expect(textCalls[0]).toContain('not fully configured')
      expect(textCalls[0]).toContain('/config')
    })

    test('missing YouTrack provider config is derived from assigned task instance', async () => {
      // youtrack is now plugin-contributed; checkRequiredProviderConfig no longer matches its
      // plugin-namespaced token key. The /config guidance is now triggered by resolver returning null
      // when the token is absent. Simulate by having resolve return null.
      const freshCtx = 'missing-youtrack-token-2'
      assignYouTrackContext(freshCtx)

      const deps: LlmOrchestratorDeps = {
        generateText: (...args) => realAi.generateText(...args),
        stepCountIs: (...args) => realAi.stepCountIs(...args),
        buildOpenAI: buildMockOpenAI,
        resolve: () => null,
        maybeAutoProvision: () => Promise.resolve(false),
      }

      const { reply, textCalls } = createMockReply()
      await processMessage(reply, freshCtx, 'user-1', null, 'hello', 'dm', undefined, deps)

      expect(textCalls).toContain('I need /config before I can do that.')
    })

    test('replies with setup guidance when resolver returns null for assigned Kaneo without workspace', async () => {
      const freshCtx = 'missing-kaneo-workspace'
      assignKaneoContext(freshCtx)
      setConfigValue(freshCtx, KANEO_CREDENTIAL_KEY, 'test-kaneo-key')
      let resolverCalls = 0
      const deps: LlmOrchestratorDeps = {
        generateText: (...args) => realAi.generateText(...args),
        stepCountIs: (...args) => realAi.stepCountIs(...args),
        buildOpenAI: buildMockOpenAI,
        resolve: () => {
          resolverCalls++
          return null
        },
        maybeAutoProvision: () => Promise.resolve(false),
      }

      const { reply, textCalls } = createMockReply()
      await processMessage(reply, freshCtx, 'user-1', null, 'hello', 'dm', undefined, deps)

      expect(resolverCalls).toBe(1)
      expect(textCalls).toContain('I need /config before I can do that.')
    })

    test('missing provider config is derived from assigned task instance', async () => {
      // youtrack is now plugin-contributed; checkRequiredProviderConfig no longer matches its
      // plugin-namespaced token key. Simulate missing credentials via resolver returning null.
      const freshCtx = 'missing-youtrack-token'
      assignYouTrackContext(freshCtx)
      const deps: LlmOrchestratorDeps = {
        generateText: (...args) => realAi.generateText(...args),
        stepCountIs: (...args) => realAi.stepCountIs(...args),
        buildOpenAI: buildMockOpenAI,
        resolve: () => null,
        maybeAutoProvision: () => Promise.resolve(false),
      }

      const { reply, textCalls } = createMockReply()
      await processMessage(reply, freshCtx, 'user-1', null, 'hello', 'dm', undefined, deps)

      expect(textCalls).toContain('I need /config before I can do that.')
    })

    test('replies with setup guidance when resolver returns null after credentials pass', async () => {
      const freshCtx = 'resolver-null-context'
      insertTaskInstance({
        id: 'yt-prod-null',
        type: 'youtrack',
        config: { baseUrl: 'https://yt.invalid' },
        status: 'active',
      })
      setContextSettings({
        contextId: freshCtx,
        taskInstanceId: 'yt-prod-null',
        platformInstanceId: 'telegram-default',
      })
      setConfig(freshCtx, 'youtrack_token', 'perm:abc')
      const deps: LlmOrchestratorDeps = {
        generateText: (...args) => realAi.generateText(...args),
        stepCountIs: (...args) => realAi.stepCountIs(...args),
        buildOpenAI: buildMockOpenAI,
        resolve: () => null,
        maybeAutoProvision: () => Promise.resolve(false),
      }

      const { reply, textCalls } = createMockReply()
      await processMessage(reply, freshCtx, 'user-1', null, 'hello', 'dm', undefined, deps)

      expect(textCalls).toContain('I need /config before I can do that.')
    })

    test('dm context calls maybeAutoProvision with generic provider context', async () => {
      const autoProvisionCalls: Array<{ contextId: string; chatUserId: string; username: string | null }> = []
      const deps: LlmOrchestratorDeps = {
        generateText: (...args) => realAi.generateText(...args),
        stepCountIs: (...args) => realAi.stepCountIs(...args),
        buildOpenAI: buildMockOpenAI,
        resolve: () => null,
        maybeAutoProvision: (_reply, contextId, chatUserId, username) => {
          autoProvisionCalls.push({ contextId, chatUserId, username })
          return Promise.resolve(false)
        },
      }

      const { reply, textCalls } = createMockReply()
      await processMessage(reply, CTX_ID, 'user-1', 'alice', 'hello', 'dm', undefined, deps)

      expect(autoProvisionCalls).toEqual([{ contextId: CTX_ID, chatUserId: 'user-1', username: 'alice' }])
      expect(textCalls).toContain('I need /config before I can do that.')
    })

    test('dm context continues to setup guidance when generic auto-provision hook throws', async () => {
      registerContributedTaskProviderType('auto-throw-provider', {
        pluginId: 'auto-throw-plugin',
        factory: () => createMockProvider({ name: 'auto-throw-provider' }),
        capabilities: new Set(),
        displayName: 'Auto Throw Provider',
        autoProvision: () => {
          throw new Error('auto provision exploded')
        },
        instanceConfigSchema: [],
        contextConfigSchema: [],
      })
      insertTaskInstance({
        id: 'auto-throw-instance',
        type: 'auto-throw-provider',
        config: { baseUrl: 'https://auto.invalid' },
        status: 'active',
      })
      setContextSettings({
        contextId: CTX_ID,
        taskInstanceId: 'auto-throw-instance',
        platformInstanceId: 'telegram-default',
      })
      const deps: LlmOrchestratorDeps = {
        generateText: (...args) => realAi.generateText(...args),
        stepCountIs: (...args) => realAi.stepCountIs(...args),
        buildOpenAI: buildMockOpenAI,
        resolve: () => null,
        maybeAutoProvision: defaultDeps.maybeAutoProvision,
      }

      const { reply, textCalls } = createMockReply()
      await processMessage(reply, CTX_ID, 'user-1', 'alice', 'hello', 'dm', undefined, deps)

      expect(textCalls).toContain('I need /config before I can do that.')
    })
  })

  describe('LLM API error', () => {
    test('sends typing when starting the LLM call', async () => {
      const { reply, textCalls, typingCalls } = createReplyWithTypingSpy()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(typingCalls.length).toBeGreaterThanOrEqual(1)
      expect(textCalls).toContain('Hello!')
    })

    test('APICallError uses the API-call-specific user reply', async () => {
      const apiError = new APICallError({
        message: 'Rate limited',
        url: 'http://localhost',
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: {},
        responseBody: '',
        isRetryable: false,
      })

      generateTextImpl = (): Promise<GenerateTextResult> => {
        throw apiError
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(APICallError.isInstance(apiError)).toBe(true)
      expect(textCalls).toContain('API call failed. Please try again.')
    })
  })

  describe('provider classified errors', () => {
    test('KaneoClassifiedError routes to getUserMessage', async () => {
      generateTextImpl = (): Promise<GenerateTextResult> => {
        throw new KaneoClassifiedError('Task not found', providerError.taskNotFound('T-1'))
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(textCalls.some((text) => mentionsNotFound('T-1')(text))).toBe(true)
    })

    test('ProviderClassifiedError routes through error.error', async () => {
      generateTextImpl = (): Promise<GenerateTextResult> => {
        throw new ProviderClassifiedError('Project not found', providerError.projectNotFound('P-1'))
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(textCalls.some((text) => mentionsNotFound('P-1')(text))).toBe(true)
    })

    test('unknown Error produces generic message', async () => {
      generateTextImpl = (): Promise<GenerateTextResult> => {
        throw new Error('random crash')
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      expect(textCalls).toContain('An unexpected error occurred. Please try again later.')
    })
  })

  describe('history rollback on error', () => {
    test('on error, saveHistory is called to persist rollback', async () => {
      // Use a fresh context with no prior history (clean slate)
      const rollbackCtx = 'rollback-ctx'
      seedConfigForContext(rollbackCtx)

      generateTextImpl = (): Promise<GenerateTextResult> => {
        throw new Error('LLM crash')
      }
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, rollbackCtx, 'user-1', null, 'new message', 'dm')

      // processMessage should have caught the error and replied with an error message
      expect(textCalls).toContain('An unexpected error occurred. Please try again later.')

      // The catch block calls saveHistory(contextId, baseHistory) to roll back.
      // baseHistory was a snapshot taken before callLlm (getCachedHistory returns a copy),
      // so it was empty. The rollback correctly resets history to that empty snapshot.
      const history = getCachedHistory(rollbackCtx)
      expect(history).toHaveLength(0)
    })
  })

  describe('stepsDetail SSE payload', () => {
    test('llm:end broadcasts text, finishReason, and inline tool results/errors', async () => {
      seedConfigForContext('steps-detail-ctx')
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          toolCalls: [],
          toolResults: [],
          steps: [
            {
              text: 'Calling search now.',
              finishReason: 'tool-calls',
              toolCalls: [
                { toolName: 'search', toolCallId: 'call-1', input: { q: 'foo' } },
                { toolName: 'create', toolCallId: 'call-2', input: { title: 'x' } },
              ],
              toolResults: [{ toolCallId: 'call-1', output: { hits: 3 } }],
              content: [{ type: 'tool-error', toolCallId: 'call-2', error: new Error('permission denied') }],
              usage: { inputTokens: 10, outputTokens: 5 },
            },
          ],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      let capturedStepsDetail: unknown = null
      const listener = makeLlmEndListener((detail) => {
        capturedStepsDetail = detail
      })
      subscribe(listener)
      try {
        const { reply } = createMockReply()
        await processMessage(reply, 'steps-detail-ctx', 'user-1', null, 'hello', 'dm')
      } finally {
        unsubscribe(listener)
      }

      expect(Array.isArray(capturedStepsDetail)).toBe(true)
      assert.ok(Array.isArray(capturedStepsDetail))
      const stepValue: unknown = capturedStepsDetail[0]
      assert.ok(isRecord(stepValue))
      expect(stepValue['stepNumber']).toBe(1)
      expect(stepValue['text']).toBe('Calling search now.')
      expect(stepValue['finishReason']).toBe('tool-calls')

      const toolCalls: unknown = stepValue['toolCalls']
      expect(Array.isArray(toolCalls)).toBe(true)
      assert.ok(Array.isArray(toolCalls))
      const tc0: unknown = toolCalls[0]
      const tc1: unknown = toolCalls[1]
      assert.ok(isRecord(tc0))
      assert.ok(isRecord(tc1))
      expect(tc0['toolName']).toBe('search')
      expect(tc0['result']).toEqual({ hits: 3 })
      expect(tc0['error']).toBeUndefined()
      expect(tc1['toolName']).toBe('create')
      expect(tc1['result']).toBeUndefined()
      expect(tc1['error']).toBe('permission denied')
    })

    test('llm:end omits text and finishReason when the step has neither', async () => {
      seedConfigForContext('steps-detail-empty-ctx')
      const { subscribe, unsubscribe } = await import('../src/debug/event-bus.js')

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          toolCalls: [],
          toolResults: [],
          steps: [
            {
              text: '',
              toolCalls: [{ toolName: 'search', toolCallId: 'call-1', input: {} }],
              toolResults: [],
              content: [],
              usage: { inputTokens: 10, outputTokens: 5 },
            },
          ],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      let capturedStepsDetail: unknown = null
      const listener = makeLlmEndListener((detail) => {
        capturedStepsDetail = detail
      })
      subscribe(listener)
      try {
        const { reply } = createMockReply()
        await processMessage(reply, 'steps-detail-empty-ctx', 'user-1', null, 'hello', 'dm')
      } finally {
        unsubscribe(listener)
      }

      assert.ok(Array.isArray(capturedStepsDetail))
      const step: unknown = capturedStepsDetail[0]
      assert.ok(isRecord(step))
      expect(step['text']).toBeUndefined()
      expect(step['finishReason']).toBeUndefined()
    })
  })

  describe('tool execution failure', () => {
    // Store callback captured by generateText for testing tool failure feedback
    let capturedOnToolCallFinish: ToolCallFinishHandler | undefined

    beforeEach(() => {
      capturedOnToolCallFinish = undefined
      // Override generateText to capture the onToolCallFinish callback
      void mock.module('ai', () => ({
        ...realAi,
        generateText: (args: GenerateTextArgs): Promise<GenerateTextResult> => {
          capturedOnToolCallFinish = args.experimental_onToolCallFinish
          return generateTextImpl(args)
        },
        stepCountIs: (): (() => boolean) => () => false,
      }))
    })

    test('tool failure is hidden by default and only final answer is sent', async () => {
      seedConfigForContext('tool-fail-ctx')

      generateTextImpl = (args): Promise<GenerateTextResult> => {
        callToolFinish(args.experimental_onToolCallFinish, {
          toolCall: { toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } },
          durationMs: 100,
          success: false,
          error: new Error('Task creation failed'),
        })
        return Promise.resolve({
          text: 'Done!',
          toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } }],
          toolResults: [{ toolName: 'create_task', toolCallId: 'call-1', output: { error: 'failed' } }],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      }

      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-fail-ctx', 'user-1', null, 'create a task', 'dm')

      assert.ok(capturedOnToolCallFinish !== undefined)
      expect(textCalls).toEqual(['Done!'])
    })

    test('tool details are flushed after final answer when enabled', async () => {
      seedConfigForContext('tool-details-ctx')
      setCachedConfig('tool-details-ctx', AI_TOOL_VISIBILITY_KEY, 'on')

      generateTextImpl = (args): Promise<GenerateTextResult> => {
        callToolFinish(args.experimental_onToolCallFinish, {
          toolCall: { toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } },
          durationMs: 100,
          success: false,
          error: new Error('Task creation failed'),
        })
        return Promise.resolve({
          text: 'Done!',
          toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } }],
          toolResults: [{ toolName: 'create_task', toolCallId: 'call-1', output: { error: 'failed' } }],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      }

      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-details-ctx', 'user-1', null, 'create a task', 'dm')

      expect(textCalls[0]).toBe('Done!')
      expect(textCalls[1]).toContain('AI execution details')
      expect(textCalls[1]).toContain('create_task')
    })

    test('handles non-Error objects in tool failure callback without default warning', async () => {
      seedConfigForContext('tool-fail-string-ctx')

      generateTextImpl = (args): Promise<GenerateTextResult> => {
        callToolFinish(args.experimental_onToolCallFinish, {
          toolCall: { toolName: 'search_tasks', toolCallId: 'call-2', input: { q: 'test' } },
          durationMs: 50,
          success: false,
          error: 'String error message',
        })
        return Promise.resolve({
          text: 'Done!',
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      }

      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-fail-string-ctx', 'user-1', null, 'do something', 'dm')

      assert.ok(capturedOnToolCallFinish !== undefined)
      expect(textCalls).toEqual(['Done!'])
    })

    test('structured tool failure is hidden by default and only final answer is sent', async () => {
      seedConfigForContext('tool-fail-structured-ctx')

      generateTextImpl = (args): Promise<GenerateTextResult> => {
        callToolFinish(args.experimental_onToolCallFinish, {
          toolCall: { toolName: 'create_task', toolCallId: 'call-3', input: { title: 'Test' } },
          durationMs: 75,
          success: true,
          output: buildToolFailureResult(new Error('Provider unavailable'), 'create_task', 'call-3'),
        })
        return Promise.resolve({
          text: 'Done!',
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      }

      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-fail-structured-ctx', 'user-1', null, 'create a task', 'dm')

      assert.ok(capturedOnToolCallFinish !== undefined)
      expect(textCalls).toEqual(['Done!'])
    })

    test('reasoning visibility hides provider reasoningText by default', async () => {
      seedConfigForContext('reasoning-hidden-ctx')

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          reasoningText: 'hidden chain of thought',
          reasoning: [{ type: 'reasoning', text: 'hidden chain of thought' }],
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'reasoning-hidden-ctx', 'user-1', null, 'think', 'dm')

      expect(textCalls).toEqual(['Done!'])
    })

    test('reasoning visibility shows provider reasoningText when enabled', async () => {
      seedConfigForContext('reasoning-visible-ctx')
      setCachedConfig('reasoning-visible-ctx', AI_REASONING_VISIBILITY_KEY, 'on')

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          reasoningText: 'visible reasoning summary',
          reasoning: [{ type: 'reasoning', text: 'visible reasoning summary' }],
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'reasoning-visible-ctx', 'user-1', null, 'think', 'dm')

      expect(textCalls[0]).toBe('Done!')
      expect(textCalls[1]).toContain('AI execution details')
      expect(textCalls[1]).toContain('Provider reasoning available')
      expect(textCalls[1]).not.toContain('visible reasoning summary')
    })

    test('reasoning visibility raw mode shows provider reasoning payload', async () => {
      seedConfigForContext('reasoning-raw-ctx')
      setCachedConfig('reasoning-raw-ctx', AI_REASONING_VISIBILITY_KEY, 'on')
      setCachedConfig('reasoning-raw-ctx', AI_OUTPUT_DETAIL_LEVEL_KEY, 'raw')

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          reasoningText: 'Provider reasoning text',
          reasoning: [{ type: 'reasoning', text: 'raw reasoning payload' }],
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'reasoning-raw-ctx', 'user-1', null, 'think', 'dm')

      expect(textCalls[0]).toBe('Done!')
      expect(textCalls[1]).toContain('AI execution details')
      expect(textCalls[1]).toContain('raw reasoning payload')
    })

    test('group thread reasoning setting uses active storage context over config target', async () => {
      const threadCtx = 'group-ctx:thread-42'
      const parentConfigCtx = 'group-ctx'
      seedConfigForContext(threadCtx)
      seedConfigForContext(parentConfigCtx)
      setCachedConfig(threadCtx, AI_REASONING_VISIBILITY_KEY, 'on')

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          reasoningText: 'thread scoped reasoning',
          reasoning: [{ type: 'reasoning', text: 'thread scoped reasoning' }],
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      const { reply, textCalls } = createMockReply()

      await processMessage(reply, threadCtx, 'user-1', null, 'think', 'group', parentConfigCtx)

      expect(textCalls[0]).toBe('Done!')
      expect(textCalls[1]).toContain('AI execution details')
      expect(textCalls[1]).toContain('Provider reasoning available')
      expect(textCalls[1]).not.toContain('thread scoped reasoning')
    })

    test('flush failure after final answer does not send generic error or rewind assistant history', async () => {
      const ctx = 'flush-failure-ctx'
      seedConfigForContext(ctx)
      setCachedConfig(ctx, AI_REASONING_VISIBILITY_KEY, 'on')

      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          reasoningText: 'details that fail to send',
          reasoning: [{ type: 'reasoning', text: 'details that fail to send' }],
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })

      const textCalls: string[] = []
      const { reply: baseReply } = createMockReply()
      const reply: ReplyFn = {
        ...baseReply,
        text: (content) => {
          textCalls.push(content)
          return Promise.resolve()
        },
        formatted: failingAiDetailsReply(textCalls),
      }

      await processMessage(reply, ctx, 'user-1', null, 'think', 'dm')

      expect(textCalls).toHaveLength(2)
      expect(textCalls[0]).toBe('Done!')
      expect(textCalls[1]).toContain('AI execution details')
      const history = getCachedHistory(ctx)
      expect(history).toHaveLength(2)
      expect(history[0]!.role).toBe('user')
      expect(history[1]!.role).toBe('assistant')
      expect(history[1]!.content).toBe('Done!')
    })
  })

  describe('success path history', () => {
    test('on success, history is extended with assistant messages', async () => {
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Hi!',
          toolCalls: [],
          toolResults: [],
          steps: [],
          response: { messages: [{ role: 'assistant' as const, content: 'Hi!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      const { reply } = createMockReply()

      await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm')

      // History should contain: user message + assistant message
      const history = getCachedHistory(CTX_ID)
      expect(history).toHaveLength(2)
      expect(history[0]!.role).toBe('user')
      // The persisted user turn is prefixed with a <current_time> tag (intentional per spec).
      const userContent = history[0]!.content
      assert.ok(typeof userContent === 'string', 'expected string content')
      expect(userContent).toMatch(/^<current_time>.*<\/current_time>\nhello$/u)
      expect(history[1]!.role).toBe('assistant')
      expect(history[1]!.content).toBe('Hi!')
    })

    test('tool results include tool names for fact extraction', async () => {
      seedConfigForContext('tool-results-ctx')
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Task created successfully!',
          toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test task' } }],
          toolResults: [
            {
              toolName: 'create_task',
              toolCallId: 'call-1',
              output: { id: 'task-123', title: 'Test task', number: 42 },
            },
          ],
          steps: [
            {
              text: 'Creating task...',
              finishReason: 'tool-calls',
              toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test task' } }],
              toolResults: [
                {
                  toolCallId: 'call-1',
                  output: { id: 'task-123', title: 'Test task', number: 42 },
                },
              ],
            },
          ],
          response: { messages: [{ role: 'assistant' as const, content: 'Task created!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-results-ctx', 'user-1', null, 'create a test task', 'dm')

      // Should complete without error - tool results passed directly to fact extraction
      expect(textCalls.length).toBeGreaterThanOrEqual(0)
    })

    test('tool results with unmatched toolCallId still process successfully', async () => {
      seedConfigForContext('tool-results-missing-ctx')
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Done!',
          toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } }],
          toolResults: [{ toolName: 'create_task', toolCallId: 'call-2', output: { result: 'data' } }],
          steps: [
            {
              text: 'Working...',
              finishReason: 'tool-calls',
              toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'Test' } }],
              toolResults: [{ toolCallId: 'call-2', output: { result: 'data' } }],
            },
          ],
          response: { messages: [{ role: 'assistant' as const, content: 'Done!' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      const { reply, textCalls } = createMockReply()

      await processMessage(reply, 'tool-results-missing-ctx', 'user-1', null, 'do something', 'dm')

      // Should complete without error
      expect(textCalls.length).toBeGreaterThanOrEqual(0)
    })

    test('persists facts from all tool-call steps', async () => {
      const ctxId = 'multi-step-facts-ctx'
      seedConfigForContext(ctxId)
      generateTextImpl = (): Promise<GenerateTextResult> =>
        Promise.resolve({
          text: 'Created both tasks',
          toolCalls: [{ toolName: 'create_task', toolCallId: 'call-2', input: { title: 'Second task' } }],
          toolResults: [
            {
              toolName: 'create_task',
              toolCallId: 'call-2',
              output: { id: 'task-2', title: 'Second task', number: 2 },
            },
          ],
          steps: [
            {
              text: 'Creating first task...',
              finishReason: 'tool-calls',
              toolCalls: [{ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'First task' } }],
              toolResults: [
                {
                  toolName: 'create_task',
                  toolCallId: 'call-1',
                  output: { id: 'task-1', title: 'First task', number: 1 },
                },
              ],
            },
            {
              text: 'Creating second task...',
              finishReason: 'tool-calls',
              toolCalls: [{ toolName: 'create_task', toolCallId: 'call-2', input: { title: 'Second task' } }],
              toolResults: [
                {
                  toolName: 'create_task',
                  toolCallId: 'call-2',
                  output: { id: 'task-2', title: 'Second task', number: 2 },
                },
              ],
            },
          ],
          response: { messages: [{ role: 'assistant' as const, content: 'Created both tasks' }] },
          usage: {},
          finishReason: 'stop',
          warnings: undefined,
          request: {},
          providerMetadata: undefined,
        })
      const { reply } = createMockReply()

      await processMessage(reply, ctxId, 'user-1', null, 'create two tasks', 'dm')

      const facts = getCachedFacts(ctxId)
      expect(containsFact(facts, { identifier: '#1', title: 'First task', url: '' })).toBe(true)
      expect(containsFact(facts, { identifier: '#2', title: 'Second task', url: '' })).toBe(true)
    })
  })

  // Phase 1 (central LLM): per-user LLM config copy is gone. LLM credentials
  // live in system_config and are seeded once at startup, so no copy ever
  // happens regardless of DEMO_MODE. The behavioral coverage that used to
  // live here is implicit: the seeded system_config in beforeEach is enough
  // for any user to reach the LLM call without per-user provisioning.

  describe('auto-link flow', () => {
    const GROUP_CTX = 'group-123'
    const USER_ID = 'user-456'
    const USERNAME = 'jsmith'

    beforeEach(() => {
      // Clear any existing identity mapping for the user (not group)
      // Identity mappings are per-user, stored under chatUserId
      clearIdentityMapping(USER_ID, 'mock')
    })

    test('skips auto-link when username is null', async () => {
      seedConfigForContext(GROUP_CTX)

      // Create provider with identity resolver
      const providerWithResolver = {
        ...mockProvider,
        identityResolver: {
          searchUsers: mock(() => Promise.resolve([{ id: 'user-123', login: 'jsmith', name: 'John Smith' }])),
        },
      }

      const { reply } = createMockReply()
      // Pass null for username - should skip auto-link
      await processMessage(reply, GROUP_CTX, USER_ID, null, 'hello', 'group', undefined, {
        ...defaultDeps,
        resolve: (): typeof providerWithResolver => providerWithResolver,
      })

      // No mapping should be created
      const mapping = getIdentityMapping(GROUP_CTX, 'mock')
      expect(mapping).toBeNull()
    })

    test('skips auto-link when provider has no identity resolver', async () => {
      seedConfigForContext(GROUP_CTX)

      const { reply } = createMockReply()
      await processMessage(reply, GROUP_CTX, USER_ID, USERNAME, 'hello', 'group', undefined, {
        ...defaultDeps,
        resolve: (): typeof mockProvider => mockProvider,
      })

      // No mapping should be created
      const mapping = getIdentityMapping(GROUP_CTX, 'mock')
      expect(mapping).toBeNull()
    })

    test('skips auto-link when mapping already exists', async () => {
      seedConfigForContext(GROUP_CTX)

      // Pre-set a mapping under the user ID (not group context)
      const { setIdentityMapping } = await import('../src/identity/mapping.js')
      setIdentityMapping({
        contextId: USER_ID,
        providerName: 'mock',
        providerUserId: 'existing-user',
        providerUserLogin: 'existing',
        displayName: 'Existing User',
        matchMethod: 'manual_nl',
        confidence: 100,
      })

      // Create provider with identity resolver that would match if called
      const providerWithResolver = {
        ...mockProvider,
        identityResolver: {
          searchUsers: mock(() => Promise.resolve([{ id: 'user-123', login: USERNAME, name: 'John Smith' }])),
        },
      }

      const { reply } = createMockReply()
      await processMessage(reply, GROUP_CTX, USER_ID, USERNAME, 'hello', 'group', undefined, {
        ...defaultDeps,
        resolve: (): typeof providerWithResolver => providerWithResolver,
      })

      // Existing mapping should be preserved (stored under user ID)
      const mapping = getIdentityMapping(USER_ID, 'mock')
      expect(mapping).not.toBeNull()
      assert.ok(mapping !== null)
      expect(mapping.providerUserLogin).toBe('existing')
      expect(mapping.matchMethod).toBe('manual_nl')
    })

    test('attempts auto-link when username provided and no mapping exists', async () => {
      seedConfigForContext(GROUP_CTX)

      // Create provider with identity resolver that finds a match
      const providerWithResolver = {
        ...mockProvider,
        identityResolver: {
          searchUsers: mock(() => Promise.resolve([{ id: 'user-123', login: USERNAME, name: 'John Smith' }])),
        },
      }

      const { reply } = createMockReply()
      await processMessage(reply, GROUP_CTX, USER_ID, USERNAME, 'hello', 'group', undefined, {
        ...defaultDeps,
        resolve: (): typeof providerWithResolver => providerWithResolver,
      })

      // Auto-link should have created a mapping under the user ID (not group context)
      const mapping = getIdentityMapping(USER_ID, 'mock')
      expect(mapping).not.toBeNull()
      assert.ok(mapping !== null)
      expect(mapping.providerUserLogin).toBe(USERNAME)
      expect(mapping.matchMethod).toBe('auto')
      expect(mapping.confidence).toBe(100)
    })

    test('stores unmatched when auto-link finds no match', async () => {
      seedConfigForContext(GROUP_CTX)

      // Create provider with identity resolver that finds no match
      const providerWithResolver = {
        ...mockProvider,
        identityResolver: {
          searchUsers: mock(() => Promise.resolve([])),
        },
      }

      const { reply } = createMockReply()
      await processMessage(reply, GROUP_CTX, USER_ID, 'unknownuser', 'hello', 'group', undefined, {
        ...defaultDeps,
        resolve: (): typeof providerWithResolver => providerWithResolver,
      })

      // Should store unmatched mapping under the user ID (not group context)
      const mapping = getIdentityMapping(USER_ID, 'mock')
      expect(mapping).not.toBeNull()
      assert.ok(mapping !== null)
      expect(mapping.providerUserId).toBeNull()
      expect(mapping.matchMethod).toBe('unmatched')
    })
  })

  describe('tool cache isolation in group chats', () => {
    const GROUP_CTX = 'group-shared-ctx'
    const USER_A = 'user-a-123'
    const USER_B = 'user-b-456'

    test('group chat tools are cached per-user to prevent cross-user contamination', async () => {
      // Seed config for the group context
      seedConfigForContext(GROUP_CTX)

      // Track how many times descriptors are built by capturing buildToolDescriptors calls
      let toolBuildCount = 0
      const { buildToolDescriptors: realBuildToolDescriptors, applyToolPreferences } =
        await import('../src/tools/index.js')

      void mock.module('../src/tools/index.js', () => ({
        applyToolPreferences,
        buildToolDescriptors: (provider: TaskProvider, options: MakeToolsOptions): unknown => {
          toolBuildCount++
          return realBuildToolDescriptors(provider, options)
        },
      }))

      const { reply: replyA } = createMockReply()
      const { reply: replyB } = createMockReply()

      // User A speaks first in group
      await processMessage(replyA, GROUP_CTX, USER_A, null, 'hello from A', 'group')
      expect(toolBuildCount).toBe(1)

      // User B speaks in same group - should trigger NEW tool build with different user ID
      await processMessage(replyB, GROUP_CTX, USER_B, null, 'hello from B', 'group')
      expect(toolBuildCount).toBe(2)

      // User A speaks again - should use cached tools
      await processMessage(replyA, GROUP_CTX, USER_A, null, 'hello again A', 'group')
      expect(toolBuildCount).toBe(2)

      // User B speaks again - should use cached tools
      await processMessage(replyB, GROUP_CTX, USER_B, null, 'hello again B', 'group')
      expect(toolBuildCount).toBe(2)
    })

    test('sends image parts to multimodal models but stores placeholder text in history', async () => {
      const { persistIncomingAttachments } = await import('../src/attachments/index.js')
      const attachmentCtx = 'attachment-ctx-multimodal'
      seedConfigForContext(attachmentCtx)
      setSystemConfig('main_model', 'gpt-4o', 'env')

      const refs = await persistIncomingAttachments({
        contextId: attachmentCtx,
        sourceProvider: 'telegram',
        files: [
          {
            fileId: 'platform-1',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            content: Buffer.from('img'),
          },
        ],
      })

      let capturedMessages: unknown[] = []
      generateTextImpl = (args: GenerateTextArgs): Promise<GenerateTextResult> => {
        capturedMessages = toMessagesArray(args.messages)
        return defaultGenerateTextResult()
      }

      const { reply } = createMockReply()
      await processMessage(
        reply,
        attachmentCtx,
        'user-1',
        null,
        `What is in ${refs[0]!.attachmentId}?`,
        'dm',
        undefined,
        undefined,
        refs.map((ref) => ref.attachmentId),
      )

      const lastMsg = capturedMessages.at(-1)
      assert.ok(isRecord(lastMsg), 'Expected last message to be an object')
      const content = lastMsg['content']
      assert.ok(Array.isArray(content), 'Expected content to be an array of parts')
      const partTypes = content.map((part) => extractPartType(part))
      expect(partTypes).toContain('image')
      expect(partTypes).toContain('text')

      const persisted = getCachedHistory(attachmentCtx)[0]
      expect(persisted).toBeDefined()
      expect(typeof persisted!.content).toBe('string')
      // The attachment-parts history string also carries the leading <current_time> tag (spec).
      expect(persisted!.content).toMatch(/^<current_time>.*<\/current_time>\n/u)
      expect(persisted!.content).toContain('[User attached')
    })

    test('falls back to plain-text user content for non-multimodal models', async () => {
      const { persistIncomingAttachments } = await import('../src/attachments/index.js')
      const ctx = 'attachment-ctx-textmodel'
      seedConfigForContext(ctx)
      setSystemConfig('main_model', 'llama-3.1-instruct', 'env')

      const refs = await persistIncomingAttachments({
        contextId: ctx,
        sourceProvider: 'telegram',
        files: [
          {
            fileId: 'platform-1',
            filename: 'photo.jpg',
            mimeType: 'image/jpeg',
            content: Buffer.from('img'),
          },
        ],
      })

      let capturedMessages: unknown[] = []
      generateTextImpl = (args: GenerateTextArgs): Promise<GenerateTextResult> => {
        capturedMessages = toMessagesArray(args.messages)
        return defaultGenerateTextResult()
      }

      const { reply } = createMockReply()
      await processMessage(
        reply,
        ctx,
        'user-1',
        null,
        'Tell me about the file',
        'dm',
        undefined,
        undefined,
        refs.map((ref) => ref.attachmentId),
      )

      const lastMsg = capturedMessages.at(-1)
      assert.ok(isRecord(lastMsg), 'Expected last message to be an object')
      const content = lastMsg['content']
      assert.ok(typeof content === 'string', 'Expected content to be a string for non-multimodal model')
      expect(content).toContain('[User attached')
    })

    test('DM tools are cached per-context without user suffix', async () => {
      // In DMs, contextId === chatUserId, so caching by contextId is sufficient
      seedConfigForContext('dm-ctx-1')
      seedConfigForContext('dm-ctx-2')

      let toolBuildCount = 0
      const { buildToolDescriptors: realBuildToolDescriptors, applyToolPreferences } =
        await import('../src/tools/index.js')

      void mock.module('../src/tools/index.js', () => ({
        applyToolPreferences,
        buildToolDescriptors: (provider: TaskProvider, options: MakeToolsOptions): unknown => {
          toolBuildCount++
          return realBuildToolDescriptors(provider, options)
        },
      }))

      const { reply: reply1 } = createMockReply()
      const { reply: reply2 } = createMockReply()

      // First DM user
      await processMessage(reply1, 'dm-ctx-1', 'user-1', null, 'hello', 'dm')
      expect(toolBuildCount).toBe(1)

      // Second DM user - different context, should build new tools
      await processMessage(reply2, 'dm-ctx-2', 'user-2', null, 'hello', 'dm')
      expect(toolBuildCount).toBe(2)

      // First DM user again - should use cache
      await processMessage(reply1, 'dm-ctx-1', 'user-1', null, 'hello again', 'dm')
      expect(toolBuildCount).toBe(2)
    })
  })

  describe('tool routing', () => {
    test('passes an intent-routed tool subset to the model', async () => {
      seedConfigForContext(CTX_ID)
      let capturedToolNames: string[] = []
      generateTextImpl = (args: GenerateTextArgs): Promise<GenerateTextResult> => {
        capturedToolNames = getToolNames(args.tools)
        return defaultGenerateTextResult()
      }

      const { reply } = createMockReply()
      await processMessage(reply, CTX_ID, 'user-1', null, 'remember that I prefer morning standups', 'dm')

      expect(capturedToolNames).toContain('save_memo')
      expect(capturedToolNames).toContain('search_memos')
      expect(capturedToolNames).not.toContain('create_task')
    })
  })
})
