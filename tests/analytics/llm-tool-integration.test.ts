// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { generateText, stepCountIs } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'

import { deriveAttemptHealth } from '../../src/analytics/attempt-health.js'
import { KeyVersionSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import type { EligibilityDecision } from '../../src/analytics/governance/eligibility.js'
import type { NormalizerEnv } from '../../src/analytics/normalizer.js'
import { createAnalyticsObserver } from '../../src/analytics/runtime.js'
import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import { createRecordingHealth, createRecordingSinks } from '../../src/analytics/runtime.testing.js'
import type { AnalyticsSourceContext } from '../../src/analytics/source-facts.js'
import type { AnalyticsSourceFact } from '../../src/analytics/source-facts.js'
import { initAnalyticsRuntime, stopAnalyticsRuntime } from '../../src/analytics/subscriber.js'
import { createTurnContextRegistry } from '../../src/analytics/turn-context.js'
import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { emitUser } from '../../src/debug/event-bus.js'
import { emitLlmStart } from '../../src/llm-orchestrator-events.js'
import { invokeModel } from '../../src/llm-orchestrator-invoke.js'
import { emitLlmError } from '../../src/llm-orchestrator-logging.js'
import { handleToolCallFinishEvent, handleToolCallStart } from '../../src/llm-orchestrator-tool-events.js'
import type { LlmOrchestratorDeps, ToolCallContext } from '../../src/llm-orchestrator-types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const T0 = 1_700_000_000_000

const memberSource: AnalyticsSourceContext = {
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-42',
  nativeContextId: 'user-42',
  storageContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  configContextId: toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'user-42' }),
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-raw-1',
}

const cannedUsage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
} as const

const cannedModel = (): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    provider: 'test-provider',
    modelId: 'test-model',
    doGenerate: {
      content: [{ type: 'text', text: 'Done!' }],
      finishReason: { unified: 'stop', raw: undefined },
      usage: cannedUsage,
      warnings: [],
    },
  })

const streamingModel = (): MockLanguageModelV4 =>
  new MockLanguageModelV4({
    provider: 'test-provider',
    modelId: 'test-model',
    doStream: {
      stream: new ReadableStream<LanguageModelV4StreamPart>({
        start(controller): void {
          controller.enqueue({ type: 'stream-start', warnings: [] })
          controller.enqueue({ type: 'text-start', id: 't1' })
          controller.enqueue({ type: 'text-delta', id: 't1', delta: 'Done' })
          controller.enqueue({ type: 'text-end', id: 't1' })
          controller.enqueue({
            type: 'finish',
            finishReason: { unified: 'stop', raw: undefined },
            usage: cannedUsage,
          })
          controller.close()
        },
      }),
    },
  })

// A real, fully-typed result reused as the canned success return so the fake
// deps stay assignable to LlmOrchestratorDeps without an unsafe assertion.
const okResult = await generateText({ model: cannedModel(), prompt: 'hi' })

const fakeDeps = (): LlmOrchestratorDeps => ({
  generateText: (): ReturnType<LlmOrchestratorDeps['generateText']> => Promise.resolve(okResult),
  stepCountIs,
  buildModel: (): ReturnType<LlmOrchestratorDeps['buildModel']> => cannedModel(),
  resolve: (): ReturnType<LlmOrchestratorDeps['resolve']> => null,
  maybeAutoProvision: (): ReturnType<LlmOrchestratorDeps['maybeAutoProvision']> => Promise.resolve(false),
})

/**
 * Deps whose generateText drives the model's stream end-to-end, simulating a
 * streaming caller so the TTFT middleware observes real text deltas. The plain
 * generateText path is non-streaming (doGenerate), where TTFT stays null.
 */
const streamDrivingDeps = (): LlmOrchestratorDeps => ({
  ...fakeDeps(),
  generateText: async (options): ReturnType<LlmOrchestratorDeps['generateText']> => {
    const model = options.model
    if (typeof model === 'string' || model.specificationVersion !== 'v4') {
      throw new Error('test harness expects a v4 model')
    }
    const { stream } = await model.doStream({ prompt: [] })
    const reader = stream.getReader()
    for (;;) {
      const { done } = await reader.read()
      if (done) break
    }
    return okResult
  },
})

function decideAlwaysPseudonymous(): EligibilityDecision {
  return {
    allowed: true,
    lane: 'local_pseudonymous',
    policyVersion: 0,
    collectionEligibility: { refKey: 'integration-ref', keyVersion: 'v1', generation: 1 },
    deliveryGrant: null,
  }
}

function createIntegrationNormalizerEnv(): NormalizerEnv {
  return {
    hmacKey: Buffer.alloc(32, 7),
    keyVersion: KeyVersionSchema.parse('v1'),
    installId: 'install-integration',
    appVersion: VersionStringSchema.parse('1.0.0'),
    policyVersion: 0,
    ingestedAtMs: Date.now(),
  }
}

type Harness = {
  observer: AnalyticsObserver
  recording: ReturnType<typeof createRecordingSinks>
  registry: ReturnType<typeof createTurnContextRegistry>
}

const setupHarness = (): Harness => {
  const recording = createRecordingSinks()
  const health = createRecordingHealth()
  const normalizerEnv = createIntegrationNormalizerEnv()
  const observer = createAnalyticsObserver({
    decide: decideAlwaysPseudonymous,
    normalizerEnv: () => normalizerEnv,
    health,
    log: { warn: () => {} },
    sinks: recording.sinks,
  })
  const registry = createTurnContextRegistry({ nowMs: () => T0 })
  initAnalyticsRuntime({ observer, registry })
  return { observer, recording, registry }
}

const invokeMainModel = (
  turnId: string,
  analytics?: { providerBinding?: 'global' | 'byok' | 'mixed' },
): ReturnType<typeof invokeModel> =>
  invokeModel({
    contextId: memberSource.storageContextId,
    chatUserId: 'user-42',
    contextType: 'dm',
    mainModel: 'gpt-x-2026-01-01',
    model: cannedModel(),
    provider: null,
    tools: {},
    enabledToolNames: new Set<string>(),
    messages: [{ role: 'user', content: 'hi' }],
    deps: fakeDeps(),
    turnId,
    reply: undefined,
    ...(analytics === undefined ? {} : { analytics }),
  })

type RecordedEvent = ReturnType<typeof createRecordingSinks>['events'][number]

const eventsNamed = (events: readonly RecordedEvent[], name: string): RecordedEvent[] =>
  events.filter((item) => item.event.event.name === name)

const llmProps = (item: RecordedEvent): Record<string, unknown> => item.event.props as Record<string, unknown>

type AttemptObservation = Readonly<{
  rawAttemptId: string
  startedAtMs: number
  terminalAtMs: number | null
}>

const buildAttemptObservations = (
  started: readonly RecordedEvent[],
  completed: readonly RecordedEvent[],
): AttemptObservation[] => {
  const terminals = new Map<string, number>()
  for (const item of completed) {
    terminals.set(String(llmProps(item)['attempt_key']), item.event.event.occurred_at_ms)
  }
  return started.map((item) => {
    const key = String(llmProps(item)['attempt_key'])
    const terminal = terminals.get(key)
    return { rawAttemptId: key, startedAtMs: item.event.event.occurred_at_ms, terminalAtMs: terminal ?? null }
  })
}

describe('analytics llm/tool integration', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    stopAnalyticsRuntime()
  })

  afterEach(() => {
    stopAnalyticsRuntime()
  })

  test('one invoke produces one llm_started and exactly one terminal llm_completed sharing the attempt_key', async () => {
    const { observer, recording, registry } = setupHarness()
    registry.register({ turnId: 'turn-1', source: memberSource })
    await invokeMainModel('turn-1', { providerBinding: 'byok' })
    await observer.flush()

    const started = eventsNamed(recording.events, 'llm_started')
    const completed = eventsNamed(recording.events, 'llm_completed')
    const failed = eventsNamed(recording.events, 'llm_failed')
    expect(started).toHaveLength(1)
    expect(completed).toHaveLength(1)
    expect(failed).toHaveLength(0)
    const startProps = llmProps(started[0]!)
    const completedProps = llmProps(completed[0]!)
    expect(typeof startProps['attempt_key']).toBe('string')
    expect(completedProps['attempt_key']).toBe(startProps['attempt_key'])
    expect(startProps['model_role']).toBe('main')
    expect(completedProps['model_role']).toBe('main')
  })

  test('a second attempt in the same turn gets a distinct attempt_key (ordinal identity)', async () => {
    const { observer, recording, registry } = setupHarness()
    registry.register({ turnId: 'turn-2', source: memberSource })
    await invokeMainModel('turn-2', { providerBinding: 'byok' })
    await invokeMainModel('turn-2', { providerBinding: 'byok' })
    await observer.flush()

    const started = eventsNamed(recording.events, 'llm_started')
    const completed = eventsNamed(recording.events, 'llm_completed')
    expect(started).toHaveLength(2)
    expect(completed).toHaveLength(2)
    const startKeys = started.map((item) => llmProps(item)['attempt_key'])
    expect(new Set(startKeys).size).toBe(2)
    const completedKeys = completed.map((item) => llmProps(item)['attempt_key'])
    expect(new Set(completedKeys).size).toBe(2)
    for (const key of completedKeys) {
      expect(startKeys).toContain(key)
    }
  })

  test('model/provider identifiers never leak: no raw model id, response id, generated text, or steps detail', async () => {
    const { observer, recording, registry } = setupHarness()
    registry.register({ turnId: 'turn-3', source: memberSource })
    await invokeMainModel('turn-3', { providerBinding: 'byok' })
    await observer.flush()

    expect(recording.events.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(recording.events)
    expect(serialized).not.toContain('gpt-x-2026-01-01')
    expect(serialized).not.toContain('test-model')
    expect(serialized).not.toContain('Done!')
    expect(serialized).not.toContain('byok')
    expect(serialized).not.toContain('actualModel')
    expect(serialized).not.toContain('stepsDetail')
    const startProps = llmProps(eventsNamed(recording.events, 'llm_started')[0]!)
    expect(typeof startProps['model_key']).toBe('string')
  })

  test.each([
    ['resolution', 'configuration'],
    ['request', 'provider_4xx'],
    ['stream', 'llm_provider'],
  ] as const)('one bounded llm_failed terminal for the %s phase without a raw error', async (phase, errorClass) => {
    const { observer, recording, registry } = setupHarness()
    registry.register({ turnId: 'turn-fail', source: memberSource })
    emitLlmError(
      'ctx-fail',
      'user-42',
      'dm',
      'gpt-x-2026-01-01',
      T0 - 120,
      3,
      new Error('raw provider boom'),
      'turn-fail',
      {
        attemptOrdinal: 0,
        modelRole: 'main',
        providerBinding: 'global',
        phase,
        errorClass,
        retryable: null,
      },
    )
    await observer.flush()

    const failed = eventsNamed(recording.events, 'llm_failed')
    expect(failed).toHaveLength(1)
    const props = llmProps(failed[0]!)
    expect(props['phase']).toBe(phase)
    expect(props['error_class']).toBe(errorClass)
    expect(JSON.stringify(recording.events)).not.toContain('raw provider boom')
    expect(JSON.stringify(recording.events)).not.toContain('gpt-x-2026-01-01')
  })

  test('a legacy llm:error without controlled fields still maps with bounded defaults', async () => {
    const { observer, recording, registry } = setupHarness()
    registry.register({ turnId: 'turn-legacy', source: memberSource })
    emitLlmError('ctx-fail', 'user-42', 'dm', 'gpt-x-2026-01-01', T0 - 50, 1, new Error('legacy boom'), 'turn-legacy')
    await observer.flush()

    const failed = eventsNamed(recording.events, 'llm_failed')
    expect(failed).toHaveLength(1)
    const props = llmProps(failed[0]!)
    expect(props['phase']).toBe('request')
    expect(props['error_class']).toBe('llm_provider')
    expect(props['retryable']).toBeNull()
    expect(JSON.stringify(recording.events)).not.toContain('legacy boom')
  })

  test('an attempt with no terminal after the observation timeout reports aged_open, never provider failure', async () => {
    const { observer, recording, registry } = setupHarness()
    registry.register({ turnId: 'turn-aged', source: memberSource })
    // Ordinal 0: a completed attempt. Ordinal 1: a start that never sees a terminal.
    await invokeMainModel('turn-aged', { providerBinding: 'global' })
    emitLlmStart('ctx-fail', 'gpt-x-2026-01-01', [{ role: 'user', content: 'hi' }], {}, 'turn-aged', {
      attemptOrdinal: 1,
      modelRole: 'main',
      providerBinding: 'global',
    })
    await observer.flush()

    const started = eventsNamed(recording.events, 'llm_started')
    const completed = eventsNamed(recording.events, 'llm_completed')
    expect(started).toHaveLength(2)
    expect(completed).toHaveLength(1)
    const observations = buildAttemptObservations(started, completed)

    const latestStartMs = Math.max(...observations.map((obs) => obs.startedAtMs))
    const withinTimeout = deriveAttemptHealth(observations, latestStartMs + 1000, 5 * 60 * 1000)
    const pastTimeout = deriveAttemptHealth(observations, latestStartMs + 10 * 60 * 1000, 5 * 60 * 1000)
    const closedKey = String(llmProps(completed[0]!)['attempt_key'])
    const openKey = String(
      llmProps(started.find((item) => String(llmProps(item)['attempt_key']) !== closedKey)!)['attempt_key'],
    )
    const withinByAttempt = new Map(withinTimeout.map((entry) => [entry.rawAttemptId, entry.status]))
    const pastByAttempt = new Map(pastTimeout.map((entry) => [entry.rawAttemptId, entry.status]))
    expect(withinByAttempt.get(closedKey)).toBe('closed')
    expect(withinByAttempt.get(openKey)).toBe('open')
    expect(pastByAttempt.get(closedKey)).toBe('closed')
    expect(pastByAttempt.get(openKey)).toBe('aged_open')
    expect([...pastByAttempt.values()]).not.toContain('provider_failure')
  })

  test('a streamed text delta produces a bounded non-null time_to_first_token_ms', async () => {
    const { observer, recording, registry } = setupHarness()
    registry.register({ turnId: 'turn-ttft', source: memberSource })
    await invokeModel({
      contextId: memberSource.storageContextId,
      chatUserId: 'user-42',
      contextType: 'dm',
      mainModel: 'gpt-x-2026-01-01',
      model: streamingModel(),
      provider: null,
      tools: {},
      enabledToolNames: new Set<string>(),
      messages: [{ role: 'user', content: 'hi' }],
      deps: streamDrivingDeps(),
      turnId: 'turn-ttft',
      reply: undefined,
      analytics: { providerBinding: 'global' },
    })
    await observer.flush()

    const completed = eventsNamed(recording.events, 'llm_completed')
    expect(completed).toHaveLength(1)
    const ttft = llmProps(completed[0]!)['time_to_first_token_ms']
    expect(typeof ttft).toBe('number')
    expect(ttft).toBeGreaterThanOrEqual(0)
  })

  test('a tool-only attempt records a null time_to_first_token_ms', async () => {
    const { observer, recording, registry } = setupHarness()
    registry.register({ turnId: 'turn-no-ttft', source: memberSource })
    await invokeMainModel('turn-no-ttft', { providerBinding: 'global' })
    await observer.flush()

    const completed = eventsNamed(recording.events, 'llm_completed')
    expect(completed).toHaveLength(1)
    expect(llmProps(completed[0]!)['time_to_first_token_ms']).toBeNull()
  })
})

type FactHarness = {
  facts: AnalyticsSourceFact[]
  registry: ReturnType<typeof createTurnContextRegistry>
}

const setupFactHarness = (): FactHarness => {
  const facts: AnalyticsSourceFact[] = []
  const registry = createTurnContextRegistry({ nowMs: () => T0 })
  initAnalyticsRuntime({
    observer: {
      observe: (fact) => {
        facts.push(fact)
      },
      flush: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    },
    registry,
  })
  return { facts, registry }
}

const toolCtx = (turnId: string): ToolCallContext => ({
  contextId: memberSource.storageContextId,
  chatUserId: 'user-42',
  contextType: 'dm',
  model: 'gpt-x-2026-01-01',
  modelRole: 'main',
  turnId,
})

const toolFactsOfType = <T extends AnalyticsSourceFact['type']>(
  facts: readonly AnalyticsSourceFact[],
  type: T,
): Extract<AnalyticsSourceFact, { type: T }>[] =>
  facts.filter((fact): fact is Extract<AnalyticsSourceFact, { type: T }> => fact.type === type)

describe('analytics tool event mapping', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    stopAnalyticsRuntime()
  })

  afterEach(() => {
    stopAnalyticsRuntime()
  })

  test('tool:execute_end, tool:failure_classified, and llm:tool_result canaries create no facts', () => {
    const { facts, registry } = setupFactHarness()
    registry.register({ turnId: 'turn-canary', source: memberSource })
    emitUser(
      'tool:execute_end',
      memberSource.storageContextId,
      { toolName: 'create_task', toolCallId: 'call-1', success: true, durationMs: 5, canary: 'raw-args-canary' },
      'turn-canary',
    )
    emitUser(
      'tool:failure_classified',
      memberSource.storageContextId,
      { toolName: 'create_task', toolCallId: 'call-1', errorType: 'llm', canary: 'failure-canary' },
      'turn-canary',
    )
    emitUser(
      'llm:tool_result',
      memberSource.storageContextId,
      { toolName: 'create_task', toolCallId: 'call-1', canary: 'result-canary' },
      'turn-canary',
    )

    expect(facts).toHaveLength(0)
    expect(JSON.stringify(facts)).not.toContain('canary')
  })

  test('tool facts classify a core builtin from registered descriptors', () => {
    const { facts, registry } = setupFactHarness()
    registry.register({ turnId: 'turn-tool', source: memberSource })
    const ctx = toolCtx('turn-tool')
    handleToolCallStart(ctx, { toolCall: { toolName: 'create_task', toolCallId: 'call-1', input: { title: 'x' } } })
    handleToolCallFinishEvent(ctx, {
      toolCall: { toolName: 'create_task', toolCallId: 'call-1', input: { title: 'x' } },
      durationMs: 12,
      success: true,
      output: { ok: true },
    })

    const started = toolFactsOfType(facts, 'tool_started')
    const completed = toolFactsOfType(facts, 'tool_completed')
    expect(started).toHaveLength(1)
    expect(completed).toHaveLength(1)
    for (const fact of [...started, ...completed]) {
      expect(fact.toolSlug).toBe('create_task')
      expect(fact.toolOrigin).toBe('core')
      expect(fact.toolDomain).toBe('task')
      expect(fact.risk).toBe('write')
    }
    expect(completed[0]!.executionOutcome).toBe('semantic_success')
  })

  test('started and completed facts share the lifecycle analyticsSourceId', () => {
    const { facts, registry } = setupFactHarness()
    registry.register({ turnId: 'turn-srcid', source: memberSource })
    const ctx = toolCtx('turn-srcid')
    handleToolCallStart(ctx, { toolCall: { toolName: 'web_fetch', toolCallId: 'call-9', input: { url: 'https://x' } } })
    handleToolCallFinishEvent(ctx, {
      toolCall: { toolName: 'web_fetch', toolCallId: 'call-9', input: { url: 'https://x' } },
      durationMs: 30,
      success: true,
      output: 'page',
    })

    const started = toolFactsOfType(facts, 'tool_started')
    const completed = toolFactsOfType(facts, 'tool_completed')
    expect(started).toHaveLength(1)
    expect(completed).toHaveLength(1)
    expect(started[0]!.sourceEventId).toBe('turn-srcid:call-9')
    expect(completed[0]!.sourceEventId).toBe('turn-srcid:call-9')
    expect(started[0]!.toolSlug).toBe('web_fetch')
    expect(started[0]!.risk).toBe('open_world')
  })

  test('external tool names collapse to external_other with bounded origin', () => {
    const { facts, registry } = setupFactHarness()
    registry.register({ turnId: 'turn-ext', source: memberSource })
    const ctx = toolCtx('turn-ext')
    handleToolCallStart(ctx, {
      toolCall: { toolName: 'mcp_github__create_issue', toolCallId: 'call-mcp', input: {} },
    })
    handleToolCallStart(ctx, {
      toolCall: { toolName: 'plugin_unknown__do_thing', toolCallId: 'call-plug', input: {} },
    })

    const started = toolFactsOfType(facts, 'tool_started')
    expect(started).toHaveLength(2)
    const byCall = new Map(started.map((fact) => [fact.sourceEventId, fact]))
    const mcp = byCall.get('turn-ext:call-mcp')
    const plug = byCall.get('turn-ext:call-plug')
    assert(mcp !== undefined)
    assert(plug !== undefined)
    expect(mcp.toolSlug).toBe('external_other')
    expect(mcp.toolOrigin).toBe('user_mcp')
    expect(plug.toolSlug).toBe('external_other')
    expect(plug.toolOrigin).toBe('external_plugin')
    expect(JSON.stringify(facts)).not.toContain('mcp_github')
    expect(JSON.stringify(facts)).not.toContain('plugin_unknown')
  })

  test('SDK success with a structured failure is never semantic success', () => {
    const { facts, registry } = setupFactHarness()
    registry.register({ turnId: 'turn-struct', source: memberSource })
    const ctx = toolCtx('turn-struct')
    handleToolCallStart(ctx, { toolCall: { toolName: 'get_task', toolCallId: 'call-sf', input: { id: '1' } } })
    handleToolCallFinishEvent(ctx, {
      toolCall: { toolName: 'get_task', toolCallId: 'call-sf', input: { id: '1' } },
      durationMs: 7,
      success: true,
      output: {
        success: false,
        error: 'Task not found',
        toolName: 'get_task',
        toolCallId: 'call-sf',
        timestamp: new Date(T0).toISOString(),
        errorType: 'tool-execution',
        errorCode: 'task-not-found',
        userMessage: 'Task not found',
        agentMessage: 'Task not found',
        retryable: false,
      },
    })

    const completed = toolFactsOfType(facts, 'tool_completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]!.executionOutcome).toBe('structured_failure')
    expect(completed[0]!.errorClass).toBe('not_found')
  })

  test('disclosure fallback accepts only the bounded reasons', () => {
    const { facts, registry } = setupFactHarness()
    registry.register({ turnId: 'turn-disc', source: memberSource })
    emitUser(
      'disclosure:fallback',
      memberSource.storageContextId,
      { stepNumber: 2, reason: 'no_real_load' },
      'turn-disc',
    )
    emitUser(
      'disclosure:fallback',
      memberSource.storageContextId,
      { stepNumber: 3, reason: 'meta_tool_churn' },
      'turn-disc',
    )
    emitUser(
      'disclosure:fallback',
      memberSource.storageContextId,
      { stepNumber: 4, reason: 'model_got_bored' },
      'turn-disc',
    )

    const fallbacks = toolFactsOfType(facts, 'disclosure_fallback')
    expect(fallbacks).toHaveLength(2)
    expect(fallbacks.map((fact) => fact.reason).sort()).toEqual(['meta_tool_churn', 'no_real_load'])
    expect(JSON.stringify(facts)).not.toContain('model_got_bored')
  })
})
