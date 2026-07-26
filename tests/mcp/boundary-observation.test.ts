// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import type { FeatureObserver } from '../../src/analytics/feature-observer.js'
import { setFeatureObserverForTesting } from '../../src/analytics/feature-observer.js'
import type { AnalyticsRequestContext, ProviderRequestObservation } from '../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  ProviderScopeMissingError,
  runWithoutProviderRequestScope,
  runWithProviderRequestScope,
} from '../../src/analytics/provider-request-scope.js'
import type { AnalyticsSourceContext, AnalyticsSourceFact } from '../../src/analytics/source-facts.js'
import type { McpEndpointConfig, McpPluginConfig } from '../../src/mcp/types.js'
import { createTrackedLoggerMock } from '../utils/logger-mock.js'
import { getToolExecutor } from '../utils/test-helpers.js'

const tracked = createTrackedLoggerMock()
void mock.module('../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))

const mockConnect = mock(() => Promise.resolve())
const mockClose = mock(() => Promise.resolve())
const mockListTools = mock(() => Promise.resolve({ tools: [] }))

const MockClient = mock(() => ({
  connect: mockConnect,
  close: mockClose,
  listTools: mockListTools,
}))

void mock.module('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: MockClient,
}))

void mock.module('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: mock(() => ({})),
}))

const { McpConnectionPool } = await import('../../src/mcp/client-pool.js')
const { buildMcpToolSet } = await import('../../src/mcp/user-endpoints.js')
const { buildPluginMcpToolSet } = await import('../../src/mcp/plugin-endpoints.js')
const { convertMcpToolsToToolSet } = await import('../../src/mcp/tool-adapter.js')

const CANARY_URL = 'https://canary-mcp.example/secret-path'
const CANARY_LABEL = 'canary-server-label'
const CANARY_HEADER = 'canary-header-token'
const CANARY_TOOL = 'canary_tool_name'
const CANARY_ARG = 'canary-argument-value'
const CANARY_ERROR = 'canary-upstream-error-text'

const makeSource = (): AnalyticsSourceContext => ({
  platform: 'telegram',
  platformInstanceId: 'pi-1',
  chatUserId: 'user-1',
  nativeContextId: 'chat-1',
  storageContextId: 'pi-1:chat-1',
  configContextId: 'pi-1:chat-1',
  contextType: 'dm',
  actorRole: 'member',
  taskInstanceId: null,
  taskProvider: 'none',
  invocationMode: 'normal',
  rawTurnId: 'turn-1',
})

type Recorder = Readonly<{
  observations: ProviderRequestObservation[]
  observe: (ctx: AnalyticsRequestContext, observation: ProviderRequestObservation) => void
}>

const createRecorder = (): Recorder => {
  const observations: ProviderRequestObservation[] = []
  return {
    observations,
    observe: (_ctx, observation) => {
      observations.push(observation)
    },
  }
}

const actorScopeOf = (recorder: Recorder): ReturnType<typeof createActorProviderRequestScope> =>
  createActorProviderRequestScope({
    requestContext: { source: makeSource(), sourceEventId: 'turn-1:test' },
    observeProviderRequest: recorder.observe,
  })

const facts: AnalyticsSourceFact[] = []
const featureObserverStub: FeatureObserver = {
  featureUsed: () => {},
  featureOpportunity: () => {},
  mcpAvailability: (_ctx, input) => {
    facts.push({
      version: 1,
      sourceEventId: 'turn-1:test:mcp_availability:test',
      occurredAtMs: 0,
      source: makeSource(),
      type: 'mcp_availability',
      origin: input.origin,
      serverRawId: input.serverRawId,
      outcome: input.outcome,
    })
  },
  configLinkIssued: () => {},
  settingsOpened: () => {},
  taskInstanceAssigned: () => {},
  rateLimitBlocked: () => {},
  unconfiguredReply: () => {},
}

const endpointOf = (overrides: Partial<McpEndpointConfig> = {}): McpEndpointConfig => ({
  id: 'server-1',
  url: CANARY_URL,
  label: CANARY_LABEL,
  headers: { Authorization: CANARY_HEADER },
  enabled: true,
  ...overrides,
})

const pluginConfigOf = (): McpPluginConfig => ({
  transport: 'streamable-http',
  url: CANARY_URL,
  headers: { Authorization: CANARY_HEADER },
})

const serializedObservations = (recorder: Recorder): string => JSON.stringify(recorder.observations)
const serializedFacts = (): string => JSON.stringify(facts)
const serializedLogs = (): string => JSON.stringify(tracked.getCalls())

const expectNoCanary = (serialized: string): void => {
  expect(serialized).not.toContain(CANARY_URL)
  expect(serialized).not.toContain(CANARY_LABEL)
  expect(serialized).not.toContain(CANARY_HEADER)
  expect(serialized).not.toContain(CANARY_TOOL)
  expect(serialized).not.toContain(CANARY_ARG)
  expect(serialized).not.toContain(CANARY_ERROR)
}

beforeEach(() => {
  facts.length = 0
  tracked.clearCalls()
  setFeatureObserverForTesting(featureObserverStub)
  mockConnect.mockClear()
  mockConnect.mockImplementation(() => Promise.resolve())
  mockListTools.mockClear()
  mockListTools.mockImplementation(() => Promise.resolve({ tools: [] }))
  MockClient.mockClear()
  MockClient.mockImplementation(() => ({ connect: mockConnect, close: mockClose, listTools: mockListTools }))
})

afterEach(() => {
  setFeatureObserverForTesting(null)
})

describe('McpConnectionPool connectWithRetry observation', () => {
  test('available: observes connect success and mcp_availability available', async () => {
    const recorder = createRecorder()
    const pool = new McpConnectionPool()
    await runWithProviderRequestScope(actorScopeOf(recorder), () => pool.getOrCreateFromUser(endpointOf()))
    expect(recorder.observations).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({
      provider: 'mcp',
      operation: 'connect',
      outcome: 'success',
      statusClass: '2xx',
    })
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({ type: 'mcp_availability', origin: 'user_endpoint', outcome: 'available' })
    expectNoCanary(serializedObservations(recorder))
    expectNoCanary(serializedFacts())
    expectNoCanary(serializedLogs())
  })

  test('connection failure: observes failure, stores only a controlled lastError class', async () => {
    const recorder = createRecorder()
    mockConnect.mockImplementation(() => Promise.reject(new TypeError('fetch failed')))
    const pool = new McpConnectionPool()
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      pool.getOrCreateFromUser(endpointOf()).catch(() => undefined),
    )
    expect(recorder.observations).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({
      provider: 'mcp',
      operation: 'connect',
      outcome: 'failure',
      statusClass: 'network',
    })
    expect(facts[0]).toMatchObject({ outcome: 'connection_failed' })
    const infos = pool.getServerInfos()
    expect(infos).toHaveLength(0)
    expectNoCanary(serializedObservations(recorder))
    expectNoCanary(serializedLogs())
  })

  test('a failed connect is evicted from the visible server infos', async () => {
    mockConnect.mockImplementation(() => Promise.reject(new TypeError('fetch failed')))
    const pool = new McpConnectionPool()
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      pool.getOrCreateFromUser(endpointOf()).catch(() => undefined),
    )
    expect(pool.getServerInfos()).toHaveLength(0)
  })

  test('timeout: observes the timeout class and mcp_availability timeout', async () => {
    const recorder = createRecorder()
    const timeoutError = new Error('timed out')
    timeoutError.name = 'TimeoutError'
    mockConnect.mockImplementation(() => Promise.reject(timeoutError))
    const pool = new McpConnectionPool()
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      pool.getOrCreateFromUser(endpointOf()).catch(() => undefined),
    )
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: 'timeout' })
    expect(facts[0]).toMatchObject({ outcome: 'timeout' })
  })

  test('auth failure: observes the auth class and mcp_availability auth_failed', async () => {
    const recorder = createRecorder()
    const authError = new Error('unauthorized')
    Object.assign(authError, { statusCode: 401 })
    mockConnect.mockImplementation(() => Promise.reject(authError))
    const pool = new McpConnectionPool()
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      pool.getOrCreateFromUser(endpointOf()).catch(() => undefined),
    )
    expect(recorder.observations[0]).toMatchObject({ outcome: 'failure', statusClass: 'auth' })
    expect(facts[0]).toMatchObject({ outcome: 'auth_failed' })
  })

  test('plugin origin is attributed with the plugin id as server key input', async () => {
    const recorder = createRecorder()
    const pool = new McpConnectionPool()
    await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      pool.getOrCreateFromPlugin('canary-plugin', pluginConfigOf()),
    )
    expect(facts[0]).toMatchObject({ origin: 'plugin_endpoint', serverRawId: 'canary-plugin', outcome: 'available' })
    expectNoCanary(serializedObservations(recorder))
  })

  test('NO_ANALYTICS_SCOPE connects without any observation', async () => {
    const recorder = createRecorder()
    const pool = new McpConnectionPool()
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () => pool.getOrCreateFromUser(endpointOf()))
    expect(mockConnect).toHaveBeenCalled()
    expect(recorder.observations).toHaveLength(0)
    expect(facts).toHaveLength(0)
  })

  test('an omitted scope fails before any connect I/O', async () => {
    const pool = new McpConnectionPool()
    await runWithoutProviderRequestScope(async () => {
      await expect(pool.getOrCreateFromUser(endpointOf())).rejects.toThrow(ProviderScopeMissingError)
    })
    expect(mockConnect).not.toHaveBeenCalled()
  })
})

describe('tool-adapter callTool observation', () => {
  const toolSetWith = (
    callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<{
      content: unknown
      isError?: boolean
    }>,
  ): ReturnType<typeof convertMcpToolsToToolSet> =>
    convertMcpToolsToToolSet('server-1', [{ name: CANARY_TOOL, description: 'd' }], { callTool })

  test('observes a successful callTool without leaking tool name or arguments', async () => {
    const recorder = createRecorder()
    const toolSet = toolSetWith(() => Promise.resolve({ content: [{ type: 'text', text: 'ok' }] }))
    const execute = getToolExecutor(toolSet[`mcp_server-1__${CANARY_TOOL}`]!)
    await runWithProviderRequestScope(actorScopeOf(recorder), () => execute({ value: CANARY_ARG }))
    expect(recorder.observations).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({ provider: 'mcp', outcome: 'success', statusClass: '2xx' })
    expectNoCanary(serializedObservations(recorder))
  })

  test('observes a thrown callTool failure without leaking exception text', async () => {
    const recorder = createRecorder()
    const toolSet = toolSetWith(() => Promise.reject(new Error(CANARY_ERROR)))
    const execute = getToolExecutor(toolSet[`mcp_server-1__${CANARY_TOOL}`]!)
    await runWithProviderRequestScope(actorScopeOf(recorder), () => execute({ value: CANARY_ARG }))
    expect(recorder.observations[0]).toMatchObject({ provider: 'mcp', outcome: 'failure' })
    expectNoCanary(serializedObservations(recorder))
  })

  test('observes an isError response as failure', async () => {
    const recorder = createRecorder()
    const toolSet = toolSetWith(() =>
      Promise.resolve({ content: [{ type: 'text', text: CANARY_ERROR }], isError: true }),
    )
    const execute = getToolExecutor(toolSet[`mcp_server-1__${CANARY_TOOL}`]!)
    await runWithProviderRequestScope(actorScopeOf(recorder), () => execute({}))
    expect(recorder.observations[0]).toMatchObject({ provider: 'mcp', outcome: 'failure' })
    expectNoCanary(serializedObservations(recorder))
  })

  test('an omitted scope fails before the client call', async () => {
    const callTool = mock(() => Promise.resolve({ content: [] }))
    const toolSet = toolSetWith(callTool)
    const execute = getToolExecutor(toolSet[`mcp_server-1__${CANARY_TOOL}`]!)
    await runWithoutProviderRequestScope(async () => {
      await expect(execute({})).rejects.toThrow(ProviderScopeMissingError)
    })
    expect(callTool).not.toHaveBeenCalled()
  })
})

describe('endpoint builders listTools observation', () => {
  test('buildMcpToolSet returns {} without a scope when no endpoints are configured', async () => {
    const getOrCreate = mock(() => Promise.reject(new Error('must not be called')))
    await runWithoutProviderRequestScope(async () => {
      const toolSet = await buildMcpToolSet('ctx-1', { getCachedConfig: () => null, getOrCreate })
      expect(toolSet).toEqual({})
    })
    expect(getOrCreate).not.toHaveBeenCalled()
  })

  test('buildPluginMcpToolSet returns {} without a scope when no plugins are active', async () => {
    const pool = {
      getOrCreateFromPlugin: mock(() => Promise.reject(new Error('must not be called'))),
    }
    await runWithoutProviderRequestScope(async () => {
      const toolSet = await buildPluginMcpToolSet([], new Map(), pool)
      expect(toolSet).toEqual({})
    })
    expect(pool.getOrCreateFromPlugin).not.toHaveBeenCalled()
  })

  test('buildMcpToolSet observes listTools and fails closed without a scope', async () => {
    const recorder = createRecorder()
    const client = {
      listTools: (): Promise<{ tools: Array<{ name: string }> }> => Promise.resolve({ tools: [{ name: CANARY_TOOL }] }),
      callTool: (): Promise<{ content: unknown[] }> => Promise.resolve({ content: [] }),
    }
    const deps = {
      getCachedConfig: (): string => JSON.stringify([endpointOf()]),
      getOrCreate: (): Promise<{ hash: string; client: typeof client }> => Promise.resolve({ hash: 'h1', client }),
    }
    const toolSet = await runWithProviderRequestScope(actorScopeOf(recorder), () => buildMcpToolSet('ctx-1', deps))
    expect(Object.keys(toolSet)).toHaveLength(1)
    expect(recorder.observations).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({ provider: 'mcp', operation: 'read', outcome: 'success' })
    expectNoCanary(serializedObservations(recorder))

    await runWithoutProviderRequestScope(async () => {
      await expect(buildMcpToolSet('ctx-1', deps)).rejects.toThrow(ProviderScopeMissingError)
    })
  })

  test('buildMcpToolSet observes a listTools failure and skips the server', async () => {
    const recorder = createRecorder()
    const deps = {
      getCachedConfig: (): string => JSON.stringify([endpointOf()]),
      getOrCreate: (): Promise<{
        hash: string
        client: {
          listTools: () => Promise<{ tools: Array<{ name: string }> }>
          callTool: () => Promise<{ content: unknown[] }>
        }
      }> =>
        Promise.resolve({
          hash: 'h1',
          client: {
            listTools: (): Promise<{ tools: Array<{ name: string }> }> => Promise.reject(new Error(CANARY_ERROR)),
            callTool: (): Promise<{ content: unknown[] }> => Promise.resolve({ content: [] }),
          },
        }),
    }
    const toolSet = await runWithProviderRequestScope(actorScopeOf(recorder), () => buildMcpToolSet('ctx-1', deps))
    expect(Object.keys(toolSet)).toHaveLength(0)
    expect(recorder.observations[0]).toMatchObject({ provider: 'mcp', operation: 'read', outcome: 'failure' })
    expectNoCanary(serializedObservations(recorder))
  })

  test('buildPluginMcpToolSet observes listTools and fails closed without a scope', async () => {
    const recorder = createRecorder()
    const pool = {
      getOrCreateFromPlugin: (): Promise<{
        hash: string
        client: {
          listTools: () => Promise<{
            tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>
          }>
          callTool: (params: {
            name: string
            arguments?: Record<string, unknown>
          }) => Promise<{ content: Array<{ type: string; text?: string }>; isError?: boolean }>
        }
      }> =>
        Promise.resolve({
          hash: 'h1',
          client: {
            listTools: () => Promise.resolve({ tools: [{ name: CANARY_TOOL }] }),
            callTool: () => Promise.resolve({ content: [] }),
          },
        }),
    }
    const descriptors = new Map([
      ['plugin-1', { mcp: pluginConfigOf(), configRequirements: [] as const, configValues: {} }],
    ])
    const toolSet = await runWithProviderRequestScope(actorScopeOf(recorder), () =>
      buildPluginMcpToolSet(['plugin-1'], descriptors, pool),
    )
    expect(Object.keys(toolSet)).toHaveLength(1)
    expect(recorder.observations[0]).toMatchObject({ provider: 'mcp', operation: 'read', outcome: 'success' })
    expectNoCanary(serializedObservations(recorder))

    await runWithoutProviderRequestScope(async () => {
      await expect(buildPluginMcpToolSet(['plugin-1'], descriptors, pool)).rejects.toThrow(ProviderScopeMissingError)
    })
  })
})
