// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ToolSet } from 'ai'

import type { AnalyticsEventV1 } from '../../src/analytics/contracts.js'
import { KeyVersionSchema, VersionStringSchema } from '../../src/analytics/controlled-types.js'
import {
  createFeatureObserver,
  FEATURE_OPPORTUNITY_REFERENCE_DOMAIN,
  FEATURE_PRODUCERS,
  FEATURE_V1,
  featureOpportunitySourceReference,
  setFeatureObserverForTesting,
} from '../../src/analytics/feature-observer.js'
import type { FeatureObserver } from '../../src/analytics/feature-observer.js'
import { normalize } from '../../src/analytics/normalizer.js'
import type { NormalizerEnv } from '../../src/analytics/normalizer.js'
import type { AnalyticsRequestContext } from '../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  runWithProviderRequestScope,
} from '../../src/analytics/provider-request-scope.js'
import type { AnalyticsObserver } from '../../src/analytics/runtime.js'
import type {
  AnalyticsSourceContext,
  AnalyticsSourceFact,
  FeatureOpportunityFact,
} from '../../src/analytics/source-facts.js'
import { insertCanonicalEventRow } from '../../src/analytics/storage/event-store.js'
import { saveAttachment } from '../../src/attachments/store.js'
import { userCachesForTesting } from '../../src/cache.js'
import type { LlmInvocationOptions } from '../../src/llm-orchestrator-tools.js'
import { prepareLlmInvocation } from '../../src/llm-orchestrator-tools.js'
import { runMemoryCapture } from '../../src/long-term-memory/capture.js'
import { searchMemoryRecords } from '../../src/long-term-memory/store.js'
import { convertMcpToolsToToolSet } from '../../src/mcp/tool-adapter.js'
import { makeCreateRecurringTaskTool } from '../../src/tools/create-recurring-task.js'
import { makeCreateReminderTool } from '../../src/tools/create-reminder.js'
import type { RecurringTaskRecord } from '../../src/types/recurring.js'
import { fetchAndExtract } from '../../src/web/fetch-extract.js'
import { activate, options, runtimeCtx } from '../plugins/acp/support.js'
import { getTestDb, getToolExecutor, mockLogger, setupTestDb } from '../utils/test-helpers.js'
import { createTestEpoch, TEST_EPOCH_ID } from './storage-fixtures.js'

const makeSource = (overrides: Partial<AnalyticsSourceContext> = {}): AnalyticsSourceContext => ({
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-1',
  nativeContextId: 'chat-1',
  storageContextId: 'pi-1:chat-1',
  configContextId: 'pi-1:chat-1',
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: 'ti-1',
  taskProvider: 'kaneo',
  invocationMode: 'normal',
  rawTurnId: 'turn-1',
  ...overrides,
})

const makeRequestContext = (source: AnalyticsSourceContext = makeSource()): AnalyticsRequestContext => ({
  source,
  sourceEventId: 'turn-1:feature-test',
})

const makeActorScope = (
  requestContext: AnalyticsRequestContext = makeRequestContext(),
): ReturnType<typeof createActorProviderRequestScope> =>
  createActorProviderRequestScope({ requestContext, observeProviderRequest: () => {} })

type Recorder = Readonly<{ observer: AnalyticsObserver; facts: AnalyticsSourceFact[] }>

const createRecorder = (): Recorder => {
  const facts: AnalyticsSourceFact[] = []
  return {
    facts,
    observer: {
      observe: (fact) => {
        facts.push(fact)
      },
      flush: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    },
  }
}

const normalizerEnv: NormalizerEnv = {
  hmacKey: Buffer.alloc(32, 7),
  keyVersion: KeyVersionSchema.parse('v1'),
  installId: 'install-1',
  appVersion: VersionStringSchema.parse('0.0.0'),
  policyVersion: 0,
  ingestedAtMs: 1700000000000,
}

let recorder: Recorder
let featureObserver: FeatureObserver

beforeEach(() => {
  mockLogger()
  recorder = createRecorder()
  featureObserver = createFeatureObserver(recorder.observer)
  setFeatureObserverForTesting(featureObserver)
})

afterEach(() => {
  setFeatureObserverForTesting(null)
})

const factsOfType = <T extends AnalyticsSourceFact['type']>(type: T): Extract<AnalyticsSourceFact, { type: T }>[] =>
  recorder.facts.filter((fact): fact is Extract<AnalyticsSourceFact, { type: T }> => fact.type === type)

describe('feature observer facts', () => {
  test('feature_used emits a controlled fact with null coding ids by default', () => {
    featureObserver.featureUsed(makeRequestContext(), {
      feature: 'memory_write',
      operation: 'create',
      outcome: 'success',
    })
    const facts = factsOfType('feature_used')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      type: 'feature_used',
      feature: 'memory_write',
      operation: 'create',
      outcome: 'success',
      codingProjectRawId: null,
      codingSessionRawId: null,
    })
  })

  test('feature_opportunity emits the deterministic daily reference', () => {
    const nowMs = Date.UTC(2026, 6, 25, 12, 0, 0)
    featureObserver.featureOpportunity(makeRequestContext(), {
      feature: 'web_fetch',
      available: true,
      reason: 'available',
      nowMs,
    })
    const facts = factsOfType('feature_opportunity')
    expect(facts).toHaveLength(1)
    const reference = featureOpportunitySourceReference({
      actorBasis: 'pi-1|user-1',
      feature: 'web_fetch',
      utcDay: '2026-07-25',
    })
    expect(facts[0]!.sourceEventId).toBe(`${FEATURE_OPPORTUNITY_REFERENCE_DOMAIN}:${reference}`)
    expect(facts[0]).toMatchObject({ sampling: 'first_eligible_actor_day', available: true, reason: 'available' })
  })

  test('milestone emitters produce controlled facts', () => {
    const rc = makeRequestContext()
    featureObserver.mcpAvailability(rc, { origin: 'user_endpoint', serverRawId: 'srv-1', outcome: 'available' })
    featureObserver.configLinkIssued(rc, 'issued')
    featureObserver.settingsOpened(rc, { entry: 'config_link', result: 'success' })
    featureObserver.taskInstanceAssigned(rc, { change: 'first_assignment', fromProvider: 'none', toProvider: 'kaneo' })
    featureObserver.rateLimitBlocked(rc, 'web_fetch')
    featureObserver.unconfiguredReply(rc, { missing: 'central_llm', surface: 'chat' })
    expect(recorder.facts.map((fact) => fact.type)).toEqual([
      'mcp_availability',
      'config_link_issued',
      'settings_opened',
      'task_instance_assigned',
      'rate_limit_blocked',
      'unconfigured_reply',
    ])
  })

  test('a throwing observer never escapes the emitter', () => {
    const throwing = createFeatureObserver({
      observe: () => {
        throw new Error('observer exploded')
      },
      flush: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    })
    expect(() =>
      throwing.featureUsed(makeRequestContext(), { feature: 'mcp', operation: 'read', outcome: 'failure' }),
    ).not.toThrow()
  })
})

describe('durable daily uniqueness', () => {
  const dayMs = Date.UTC(2026, 6, 25, 8, 0, 0)

  const emitOpportunity = (observer: FeatureObserver, feature: (typeof FEATURE_V1)[number], nowMs: number): void => {
    observer.featureOpportunity(makeRequestContext(), { feature, available: true, reason: 'available', nowMs })
  }

  test('retry, process restart, and concurrent first write share one source reference', () => {
    emitOpportunity(featureObserver, 'attachment', dayMs)
    emitOpportunity(featureObserver, 'attachment', dayMs + 60_000)
    const facts = factsOfType('feature_opportunity')
    expect(facts).toHaveLength(2)
    expect(facts[0]!.sourceEventId).toBe(facts[1]!.sourceEventId)

    const restartedRecorder = createRecorder()
    const restartedObserver = createFeatureObserver(restartedRecorder.observer)
    emitOpportunity(restartedObserver, 'attachment', dayMs + 120_000)
    expect(restartedRecorder.facts[0]!.sourceEventId).toBe(facts[0]!.sourceEventId)

    emitOpportunity(featureObserver, 'coding', dayMs)
    const other = factsOfType('feature_opportunity').at(-1)!
    expect(other.sourceEventId).not.toBe(facts[0]!.sourceEventId)
  })

  test('one durable event row survives retry, restart, and concurrent first writes', async () => {
    await setupTestDb()
    const db = getTestDb()
    createTestEpoch(db)

    const toEvent = (fact: FeatureOpportunityFact): AnalyticsEventV1 => {
      const result = normalize(fact, normalizerEnv)
      assert.ok(result.status === 'ok', 'expected normalization to succeed')
      return result.event
    }

    emitOpportunity(featureObserver, 'mcp', dayMs)
    const fact = factsOfType('feature_opportunity')[0]!
    const event = toEvent(fact)

    const input = {
      storageGeneration: 'gen-test',
      processEpochId: TEST_EPOCH_ID,
      sourceRefKey: event.event.id,
      sourceKind: 'live',
      expiresAtMs: dayMs + 90 * 24 * 60 * 60 * 1000,
      event,
    }

    const first = insertCanonicalEventRow(db, input)
    expect(first.status).toBe('created')

    const retried = insertCanonicalEventRow(db, input)
    expect(retried.status).toBe('already_present')
    expect(retried.eventId).toBe(first.eventId)

    const [a, b] = await Promise.all([
      Promise.resolve().then(() => insertCanonicalEventRow(db, input)),
      Promise.resolve().then(() => insertCanonicalEventRow(db, input)),
    ])
    expect(a.eventId).toBe(first.eventId)
    expect(b.eventId).toBe(first.eventId)

    const rows = db.$client.query('SELECT event_id FROM analytics_events').all()
    expect(rows).toHaveLength(1)
  })
})

describe('tool and memory features', () => {
  test('recurring task creation emits feature_used recurring/create', async () => {
    await setupTestDb()
    const tool = makeCreateRecurringTaskTool('user-1', {
      createRecurringTask: mock((): RecurringTaskRecord => ({
        id: 'rec-1',
        userId: 'user-1',
        title: 'standup',
        description: null,
        priority: null,
        status: null,
        assignee: null,
        labels: [],
        projectId: 'proj-1',
        triggerType: 'on_complete' as const,
        rrule: null,
        dtstartUtc: null,
        timezone: 'UTC',
        enabled: true,
        catchUp: false,
        lastRun: null,
        nextRun: null,
        createdAt: '2026-07-25T00:00:00.000Z',
        updatedAt: '2026-07-25T00:00:00.000Z',
      })),
    })
    const executor = getToolExecutor(tool)
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      await executor({ title: 'standup', projectId: 'proj-1', triggerType: 'on_complete' })
    })
    const facts = factsOfType('feature_used').filter((fact) => fact.feature === 'recurring')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ operation: 'create', outcome: 'success' })
  })

  test('recurring task creation failure emits outcome failure', async () => {
    await setupTestDb()
    const tool = makeCreateRecurringTaskTool('user-1', {
      createRecurringTask: mock(() => {
        throw new Error('db exploded')
      }),
    })
    const executor = getToolExecutor(tool)
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      try {
        await executor({ title: 'standup', projectId: 'proj-1', triggerType: 'on_complete' })
      } catch {
        // expected: deps throw
      }
    })
    const facts = factsOfType('feature_used').filter((fact) => fact.feature === 'recurring')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ operation: 'create', outcome: 'failure' })
  })

  test('deferred prompt creation emits feature_used deferred/create', async () => {
    await setupTestDb()
    const tool = makeCreateReminderTool('user-1', 'pi-1:chat-1', 'dm')
    const executor = getToolExecutor(tool)
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      await executor({ prompt: 'check the build', schedule: { fire_at: { date: '2026-07-26', time: '09:00' } } })
    })
    const facts = factsOfType('feature_used').filter((fact) => fact.feature === 'deferred')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ operation: 'create', outcome: 'success' })
  })

  test('memory capture emits memory_write write success and extraction failure', async () => {
    await setupTestDb()
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      await runMemoryCapture(
        {
          storageContextId: 'pi-1:chat-1:thread-9',
          configContextId: 'pi-1:chat-1',
          contextType: 'group',
          history: [{ role: 'user', content: 'we decided to ship Friday' }],
        },
        {
          extractMemoryPatch: () => Promise.resolve({ profile: null, records: [], updates: [] }),
          getEmbedding: () => Promise.resolve(null),
          now: () => '2026-07-25T00:00:00.000Z',
          randomUUID: () => 'mem-1',
        },
      )
      await runMemoryCapture(
        {
          storageContextId: 'pi-1:chat-1:thread-9',
          configContextId: 'pi-1:chat-1',
          contextType: 'group',
          history: [{ role: 'user', content: 'more context' }],
        },
        {
          extractMemoryPatch: () => Promise.reject(new Error('extractor down')),
          getEmbedding: () => Promise.resolve(null),
          now: () => '2026-07-25T00:00:00.000Z',
          randomUUID: () => 'mem-2',
        },
      )
    })
    const facts = factsOfType('feature_used').filter((fact) => fact.feature === 'memory_write')
    expect(facts.map((fact) => fact.outcome)).toEqual(['success', 'failure'])
    expect(facts.every((fact) => fact.operation === 'update')).toBe(true)
  })

  test('memory search emits memory_search search success', async () => {
    await setupTestDb()
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, () => {
      searchMemoryRecords({ query: 'ship', scopeId: 'pi-1:chat-1', scopeType: 'group' })
    })
    const facts = factsOfType('feature_used').filter((fact) => fact.feature === 'memory_search')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ operation: 'search', outcome: 'success' })
  })

  test('no feature facts under NO_ANALYTICS_SCOPE', async () => {
    await setupTestDb()
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, async () => {
      searchMemoryRecords({ query: 'ship', scopeId: 'pi-1:chat-1', scopeType: 'group' })
      await saveAttachment({
        contextId: 'pi-1:chat-1',
        sourceProvider: 'telegram',
        filename: 'doc.pdf',
        content: Buffer.from([1, 2, 3]),
        status: 'available',
      })
    })
    expect(factsOfType('feature_used')).toHaveLength(0)
  })
})

describe('surface features', () => {
  test('attachment store emits attachment/create success', async () => {
    await setupTestDb()
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      await saveAttachment({
        contextId: 'pi-1:chat-1',
        sourceProvider: 'telegram',
        filename: 'canary-file-name.pdf',
        content: Buffer.from([1, 2, 3]),
        status: 'available',
      })
    })
    const facts = factsOfType('feature_used').filter((fact) => fact.feature === 'attachment')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ operation: 'create', outcome: 'success' })
    expect(JSON.stringify(recorder.facts)).not.toContain('canary-file-name.pdf')
  })

  const webDeps: Parameters<typeof fetchAndExtract>[1] = {
    consumeWebFetchQuota: (): { allowed: true; remaining: number } => ({ allowed: true, remaining: 19 }),
    safeFetchContent: (): Promise<{ finalUrl: string; body: Uint8Array; contentType: string }> =>
      Promise.resolve({
        finalUrl: 'https://example.com/page',
        body: new TextEncoder().encode('<html><title>t</title>hello</html>'),
        contentType: 'text/html',
      }),
    extractHtmlContent: (): Promise<{ title: string; content: string }> =>
      Promise.resolve({ title: 't', content: 'hello' }),
    distillWebContent: (): Promise<{ summary: string; excerpt: string; truncated: boolean }> =>
      Promise.resolve({ summary: 's', excerpt: 'e', truncated: false }),
    getCachedWebFetch: (): null => null,
    putCachedWebFetch: (): void => {},
    now: (): number => 1700000000000,
  }

  test('web fetch emits web_fetch read success', async () => {
    await setupTestDb()
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      await fetchAndExtract({ storageContextId: 'pi-1:chat-1', url: 'https://example.com/page' }, webDeps)
    })
    const facts = factsOfType('feature_used').filter((fact) => fact.feature === 'web_fetch')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ operation: 'read', outcome: 'success' })
    expect(JSON.stringify(recorder.facts)).not.toContain('example.com')
  })

  test('web quota denial emits one blocked use and one rate_limit_blocked fact without URL or actor id', async () => {
    await setupTestDb()
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      await fetchAndExtract(
        { storageContextId: 'pi-1:chat-1', actorUserId: 'user-1', url: 'https://example.com/blocked' },
        { ...webDeps, consumeWebFetchQuota: () => ({ allowed: false, remaining: 0, retryAfterSec: 30 }) },
      ).catch(() => undefined)
    })
    const used = factsOfType('feature_used').filter((fact) => fact.feature === 'web_fetch')
    expect(used).toHaveLength(1)
    expect(used[0]).toMatchObject({ operation: 'read', outcome: 'blocked' })
    const blocked = factsOfType('rate_limit_blocked')
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toMatchObject({ limit: 'web_fetch' })
    // Only base envelope + type + limit: no URL, no actor-identifying extras.
    expect(Object.keys(blocked[0]!).sort()).toEqual(
      ['limit', 'occurredAtMs', 'source', 'sourceEventId', 'type', 'version'].sort(),
    )
    const serialized = JSON.stringify(recorder.facts)
    expect(serialized).not.toContain('example.com')
  })

  test('live status lifecycle emits live_status create success and platform blocked', async () => {
    await setupTestDb()
    const { createLiveStatusReporter } = await import('../../src/live-status/reporter.js')
    const baseReply = {
      text: (): Promise<void> => Promise.resolve(),
      formatted: (): Promise<void> => Promise.resolve(),
      typing: (): Promise<void> => Promise.resolve(),
      buttons: (): Promise<undefined> => Promise.resolve(undefined),
    }
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      const okReporter = createLiveStatusReporter({
        ...baseReply,
        createStatus: () => Promise.resolve({ update: () => Promise.resolve(), dismiss: () => Promise.resolve() }),
      })
      await okReporter.start()
      const unsupported = createLiveStatusReporter(baseReply)
      await unsupported.start()
    })
    const facts = factsOfType('feature_used').filter((fact) => fact.feature === 'live_status')
    expect(facts.map((fact) => fact.outcome)).toEqual(['success', 'blocked'])
  })
})

describe('integration features', () => {
  test('coding session start emits coding/start success with purpose-key inputs only', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ sessionId: 'sess-canary-1', url: 'http://magi/s/sess-canary-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )
    const { tools } = activate(fetchMock)
    const startTool = tools.get('start_session')!
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      await startTool.execute({ project: 'demo', prompt: 'fix the bug' }, runtimeCtx(), options())
    })
    expect(fetchMock).toHaveBeenCalled()
    const facts = factsOfType('feature_used').filter((fact) => fact.feature === 'coding')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ operation: 'start', outcome: 'success', codingProjectRawId: 'demo' })
    const serialized = JSON.stringify(recorder.facts)
    expect(serialized).not.toContain('fix the bug')
    expect(serialized).not.toContain('magi')
  })

  test('MCP tool execution emits mcp read success and failure', async () => {
    const okToolResult = { content: [{ type: 'text', text: 'ok' }], isError: false }
    const callTool = mock((_params: { name: string }): Promise<typeof okToolResult> => Promise.resolve(okToolResult))
    callTool
      .mockImplementationOnce(() => Promise.resolve(okToolResult))
      .mockImplementationOnce(() => Promise.reject(new Error('upstream blew up')))
    const toolSet = convertMcpToolsToToolSet(
      'srv',
      [
        { name: 'read_thing', inputSchema: { type: 'object', properties: {} } },
        { name: 'explode', inputSchema: { type: 'object', properties: {} } },
      ],
      { callTool },
    )
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      await getToolExecutor(toolSet['mcp_srv__read_thing'])({})
      await getToolExecutor(toolSet['mcp_srv__explode'])({})
    })
    const facts = factsOfType('feature_used').filter((fact) => fact.feature === 'mcp')
    expect(facts.map((fact) => fact.outcome)).toEqual(['success', 'failure'])
    const serialized = JSON.stringify(recorder.facts)
    expect(serialized).not.toContain('read_thing')
    expect(serialized).not.toContain('upstream blew up')
  })
})

describe('per-invocation opportunity emission', () => {
  test('cache-hit invocations still emit: one durable row per day, a second row on a new UTC day', async () => {
    await setupTestDb()
    const db = getTestDb()
    createTestEpoch(db)
    userCachesForTesting.clear()

    const { createMockProvider } = await import('../tools/mock-provider.js')
    const buildSpy = mock((_provider: unknown, _options: unknown): Promise<ToolSet> => Promise.resolve({}))
    const deps = {
      buildToolDescriptors: buildSpy,
      buildProviderlessToolDescriptors: mock((_options: unknown): Promise<ToolSet> => Promise.resolve({})),
      applyResultCompaction: (tools: ToolSet): ToolSet => tools,
    }
    const invocationOpts = (): LlmInvocationOptions => ({
      contextId: 'pi-1:chat-1',
      configId: 'pi-1:chat-1',
      chatUserId: 'user-1',
      username: null,
      contextType: 'dm',
      provider: createMockProvider(),
      history: [],
      userText: 'hello',
      stagedDownloadFn: undefined,
      askPermission: undefined,
      providerRequestScope: makeActorScope(),
    })

    // First invocation populates the descriptor cache; the second is a hit.
    await prepareLlmInvocation(invocationOpts(), deps)
    await prepareLlmInvocation(invocationOpts(), deps)
    expect(buildSpy).toHaveBeenCalledTimes(1)

    const dayOne = factsOfType('feature_opportunity').filter((fact) => fact.feature === 'web_fetch')
    expect(dayOne).toHaveLength(2)
    expect(dayOne[0]!.sourceEventId).toBe(dayOne[1]!.sourceEventId)

    const toEvent = (fact: FeatureOpportunityFact): AnalyticsEventV1 => {
      const result = normalize(fact, normalizerEnv)
      assert.ok(result.status === 'ok', 'expected normalization to succeed')
      return result.event
    }
    const insertFor = (fact: FeatureOpportunityFact): string => {
      const event = toEvent(fact)
      const inserted = insertCanonicalEventRow(db, {
        storageGeneration: 'gen-test',
        processEpochId: TEST_EPOCH_ID,
        sourceRefKey: event.event.id,
        sourceKind: 'live',
        expiresAtMs: fact.occurredAtMs + 90 * 24 * 60 * 60 * 1000,
        event,
      })
      return inserted.status
    }

    expect(insertFor(dayOne[0]!)).toBe('created')
    expect(insertFor(dayOne[1]!)).toBe('already_present')
    expect(db.$client.query('SELECT event_id FROM analytics_events').all()).toHaveLength(1)

    const realNow = Date.now
    Date.now = (): number => realNow() + 24 * 60 * 60 * 1000
    try {
      await prepareLlmInvocation(invocationOpts(), deps)
    } finally {
      Date.now = realNow
    }
    const all = factsOfType('feature_opportunity').filter((fact) => fact.feature === 'web_fetch')
    expect(all).toHaveLength(3)
    expect(all[2]!.sourceEventId).not.toBe(all[0]!.sourceEventId)
    expect(insertFor(all[2]!)).toBe('created')
    expect(db.$client.query('SELECT event_id FROM analytics_events').all()).toHaveLength(2)
  })
})

describe('feature-boundary closure', () => {
  test('every registered feature has one named success/failure/blocked producer', () => {
    for (const feature of FEATURE_V1) {
      const producers = FEATURE_PRODUCERS[feature]
      expect(producers, feature).toBeDefined()
      for (const key of ['opportunity', 'success', 'failure', 'blocked'] as const) {
        expect(producers[key], `${feature}.${key}`).toMatch(/#.+/u)
      }
    }
    expect(Object.keys(FEATURE_PRODUCERS).sort()).toEqual([...FEATURE_V1].sort())
  })

  test('content-free opportunity observer emits one fact per feature after makeTools resolves the surface', async () => {
    await setupTestDb()
    const { makeTools } = await import('../../src/tools/index.js')
    const { createMockProvider } = await import('../tools/mock-provider.js')
    const scope = makeActorScope()
    await runWithProviderRequestScope(scope, async () => {
      await makeTools(createMockProvider(), {
        storageContextId: 'pi-1:chat-1',
        chatUserId: 'user-1',
        mode: 'normal',
        contextType: 'dm',
      })
    })
    const facts = factsOfType('feature_opportunity')
    expect(facts.map((fact) => fact.feature).sort()).toEqual([...FEATURE_V1].sort())
    for (const fact of facts) {
      expect(fact.sampling).toBe('first_eligible_actor_day')
    }
    const serialized = JSON.stringify(facts)
    expect(serialized).not.toContain('user-1:chat')
  })

  test('no opportunity facts under NO_ANALYTICS_SCOPE', async () => {
    await setupTestDb()
    const { makeTools } = await import('../../src/tools/index.js')
    const { createMockProvider } = await import('../tools/mock-provider.js')
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, async () => {
      await makeTools(createMockProvider(), {
        storageContextId: 'pi-1:chat-1',
        chatUserId: 'user-1',
        mode: 'normal',
        contextType: 'dm',
      })
    })
    expect(factsOfType('feature_opportunity')).toHaveLength(0)
  })
})
