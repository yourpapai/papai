// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { createFeatureObserver, setFeatureObserverForTesting } from '../src/analytics/feature-observer.js'
import type { FeatureObserver } from '../src/analytics/feature-observer.js'
import { NO_ANALYTICS_SCOPE } from '../src/analytics/provider-request-scope.js'
import type { AnalyticsObserver } from '../src/analytics/runtime.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from '../src/analytics/source-facts.js'
import { getActiveAnalyticsRuntime, startAnalytics, stopAnalytics } from '../src/analytics/start-analytics.js'
import type { ReplyFn } from '../src/chat/types.js'
import { setConfigValue } from '../src/config.js'
import { byokLlmCredentials } from '../src/db/byok-llm-schema.js'
import { getDrizzleDb } from '../src/db/drizzle.js'
import { llmAdminRoles } from '../src/db/schema.js'
import { setContextSettings } from '../src/instances/context-store.js'
import { getTaskInstance, insertTaskInstance } from '../src/instances/task-store.js'
import type { LlmOrchestratorDeps } from '../src/llm-orchestrator-types.js'
import { clearLlmAdminCacheForTesting } from '../src/llm-providers/store.testing.js'
import {
  registerContributedTaskProviderType,
  unregisterContributedTaskProviderType,
} from '../src/providers/registry.js'
import { createMockProvider } from './tools/mock-provider.js'
import {
  createMockReply,
  mockLogger,
  seedAdminLlmBinding,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from './utils/test-helpers.js'

// AI SDK mock — the same seam tests/llm-orchestrator.test.ts uses: generateText
// and stepCountIs are replaced; every other export (including `tool`) stays real.
const realAi = await import('ai')

type GenerateTextArgs = Partial<{ messages: unknown[]; tools: Record<string, unknown> }>

type GenerateTextResult = {
  text: string
  toolCalls: Array<{ toolName: string; toolCallId: string; input: unknown }>
  toolResults: Array<{ toolName: string; toolCallId: string; output: unknown }>
  steps: unknown[]
  finalStep: { response: { messages: ModelMessage[] } }
  usage: Record<string, unknown>
  finishReason: string
  warnings: unknown[] | undefined
  request: unknown
  providerMetadata: unknown
}

const cannedGenerateTextResult = (): Promise<GenerateTextResult> =>
  Promise.resolve({
    text: 'Hello!',
    toolCalls: [],
    toolResults: [],
    steps: [],
    finalStep: { response: { messages: [{ role: 'assistant' as const, content: 'Hello!' }] } },
    usage: {},
    finishReason: 'stop',
    warnings: undefined,
    request: {},
    providerMetadata: undefined,
  })

let generateTextImpl: (args: GenerateTextArgs) => Promise<GenerateTextResult> = cannedGenerateTextResult

const installAiMock = (): void => {
  void mock.module('ai', () => ({
    ...realAi,
    generateText: (args: GenerateTextArgs): Promise<GenerateTextResult> => generateTextImpl(args),
    stepCountIs: (): (() => boolean) => () => false,
  }))
}

installAiMock()

const { defaultDeps, processMessage, resetBotMisconfiguredNotifiedForTesting } =
  await import('../src/llm-orchestrator.js')
const { resolveLlmForTurn } = await import('../src/llm-orchestrator-unconfigured.js')

const CTX_ID = 'unc-ctx-1'
const TURN_ID = 'turn-unconfigured-1'
const KANEO_PLUGIN_ID = 'task-provider-kaneo'
const KANEO_CREDENTIAL_KEY = 'plugin:task-provider-kaneo:provider:credential'
const TASK_INSTANCE_ID = 'ti-unc-kaneo'

const source: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'telegram-default',
  chatUserId: 'user-1',
  nativeContextId: CTX_ID,
  storageContextId: CTX_ID,
  configContextId: CTX_ID,
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: TASK_INSTANCE_ID,
  taskProvider: 'kaneo',
  invocationMode: 'normal',
  rawTurnId: TURN_ID,
}

const facts: AnalyticsSourceFact[] = []
const recordingObserver: AnalyticsObserver = {
  observe: (fact) => {
    facts.push(fact)
  },
  flush: () => Promise.resolve(),
  stop: () => Promise.resolve(),
}
let featureObserver: FeatureObserver

const unconfiguredFacts = (): Extract<AnalyticsSourceFact, { type: 'unconfigured_reply' }>[] =>
  facts.filter(
    (fact): fact is Extract<AnalyticsSourceFact, { type: 'unconfigured_reply' }> => fact.type === 'unconfigured_reply',
  )

const clearAdminLlmBinding = (): void => {
  getDrizzleDb().delete(llmAdminRoles).run()
  clearLlmAdminCacheForTesting()
}

const insertUnreadableByokConfig = (contextId: string): void => {
  getDrizzleDb()
    .insert(byokLlmCredentials)
    .values({ contextId, enabled: true, encryptedConfig: 'not-base64', updatedAt: Date.now(), updatedBy: 'admin-1' })
    .run()
}

const assignKaneoContext = (): void => {
  if (getTaskInstance(TASK_INSTANCE_ID) === null) {
    insertTaskInstance({
      id: TASK_INSTANCE_ID,
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
  }
  setContextSettings({ contextId: CTX_ID, taskInstanceId: TASK_INSTANCE_ID, platformInstanceId: 'telegram-default' })
}

const cannedDeps = (resolve: LlmOrchestratorDeps['resolve']): LlmOrchestratorDeps => ({
  ...defaultDeps,
  resolve,
  maybeAutoProvision: (): Promise<boolean> => Promise.resolve(false),
})

const failingReply = (): ReplyFn => {
  const { reply } = createMockReply()
  return { ...reply, text: () => Promise.reject(new Error('send failed')) }
}

beforeEach(async () => {
  installAiMock()
  generateTextImpl = cannedGenerateTextResult
  mockLogger()
  await setupTestDb()
  seedCommonTestPlatformInstances()
  seedAdminLlmBinding()
  resetBotMisconfiguredNotifiedForTesting()
  registerContributedTaskProviderType('kaneo', {
    pluginId: KANEO_PLUGIN_ID,
    factory: (config) => createMockProvider({ name: 'kaneo', ...config }),
    capabilities: new Set(),
    displayName: 'Kaneo',
    instanceConfigSchema: [{ key: 'baseUrl', label: 'Kaneo URL', required: true, sensitive: false, scope: 'instance' }],
    contextConfigSchema: [
      { key: 'credential', label: 'Kaneo API key', required: true, sensitive: true, scope: 'context' },
    ],
    traits: new Set(),
  })
  facts.length = 0
  featureObserver = createFeatureObserver(recordingObserver)
  setFeatureObserverForTesting(featureObserver)
  startAnalytics()
  const runtime = getActiveAnalyticsRuntime()
  if (runtime === null) throw new Error('analytics runtime did not start')
  runtime.registry.register({ turnId: TURN_ID, source })
})

afterEach(async () => {
  setFeatureObserverForTesting(null)
  unregisterContributedTaskProviderType(KANEO_PLUGIN_ID)
  await stopAnalytics()
})

describe('resolveLlmForTurn', () => {
  test('returns the resolved config and emits nothing when LLM config is complete', async () => {
    const { reply } = createMockReply()
    const resolved = await resolveLlmForTurn(reply, CTX_ID, CTX_ID, NO_ANALYTICS_SCOPE)
    expect(resolved).not.toBeNull()
    expect(unconfiguredFacts()).toHaveLength(0)
  })
})

describe('unconfigured_reply chat-turn producers', () => {
  test('central LLM unconfigured emits one central_llm fact after the fallback reply', async () => {
    clearAdminLlmBinding()
    const { reply, textCalls } = createMockReply()
    await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm', undefined, undefined, undefined, TURN_ID)

    expect(textCalls[0]).toContain('not fully configured')
    const emitted = unconfiguredFacts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ missing: 'central_llm', surface: 'chat' })
  })

  test('no central_llm fact when the fallback reply fails', async () => {
    clearAdminLlmBinding()
    await expect(
      processMessage(failingReply(), CTX_ID, 'user-1', null, 'hello', 'dm', undefined, undefined, undefined, TURN_ID),
    ).rejects.toThrow('send failed')
    expect(unconfiguredFacts()).toHaveLength(0)
  })

  test('no central_llm fact when the central LLM is configured', async () => {
    assignKaneoContext()
    setConfigValue(CTX_ID, KANEO_CREDENTIAL_KEY, 'test-kaneo-key')
    const { reply } = createMockReply()
    await processMessage(
      reply,
      CTX_ID,
      'user-1',
      null,
      'hello',
      'dm',
      undefined,
      cannedDeps(() => createMockProvider()),
      undefined,
      TURN_ID,
    )
    expect(unconfiguredFacts()).toHaveLength(0)
  })

  test('unreadable BYOK credentials emit provider_credentials after the fallback reply', async () => {
    insertUnreadableByokConfig(CTX_ID)
    const { reply, textCalls } = createMockReply()
    await processMessage(reply, CTX_ID, 'user-1', null, 'hello', 'dm', undefined, undefined, undefined, TURN_ID)

    expect(textCalls[0]).toContain('unreadable')
    const emitted = unconfiguredFacts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ missing: 'provider_credentials', surface: 'chat' })
    expect(JSON.stringify(emitted)).not.toContain('not-base64')
  })

  test('missing required provider config keys emit provider_credentials after the fallback reply', async () => {
    assignKaneoContext()
    const { reply, textCalls } = createMockReply()
    await processMessage(
      reply,
      CTX_ID,
      'user-1',
      null,
      'hello',
      'dm',
      undefined,
      cannedDeps(() => createMockProvider()),
      undefined,
      TURN_ID,
    )

    expect(textCalls[0]).toContain('Missing configuration')
    const emitted = unconfiguredFacts()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({ missing: 'provider_credentials', surface: 'chat' })
    expect(JSON.stringify(emitted)).not.toContain(KANEO_CREDENTIAL_KEY)
  })

  test('no provider_credentials fact when required provider config is present', async () => {
    assignKaneoContext()
    setConfigValue(CTX_ID, KANEO_CREDENTIAL_KEY, 'test-kaneo-key')
    const { reply } = createMockReply()
    await processMessage(
      reply,
      CTX_ID,
      'user-1',
      null,
      'hello',
      'dm',
      undefined,
      cannedDeps(() => createMockProvider()),
      undefined,
      TURN_ID,
    )
    expect(unconfiguredFacts()).toHaveLength(0)
  })
})
