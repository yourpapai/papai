// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, afterEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { Tool } from 'ai'

import { enableByokForContext, setByokRoles, upsertByokProvider } from '../../src/byok-llm/store.js'
import { setCachedTools } from '../../src/cache.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import { recentLlm, resetLlmBuffers, type LlmTrace } from '../../src/debug/llm-trace-collector.js'
import { logBuffer } from '../../src/debug/log-buffer.js'
import {
  recentToolFailures,
  recentTurns,
  resetTurnBuffers,
  type ToolFailure,
  type Turn,
} from '../../src/debug/turn-assembly.js'
import { setContextSettings } from '../../src/instances/context-store.js'
import { insertTaskInstance } from '../../src/instances/task-store.js'
import { createLlmProvider, setAdminRoleBindings } from '../../src/llm-providers/store.js'
import { clearLlmAdminCacheForTesting } from '../../src/llm-providers/store.testing.js'
import type { LlmProviderAccount } from '../../src/llm-providers/types.js'
import { logMultistream, logger } from '../../src/logger.js'
import { makeRunDiagnosticsTool, maybeAddDiagnosticsTools, type DiagnosticsDeps } from '../../src/tools/diagnostics.js'
import { applyGuestReadOnlyFilter, makeTools } from '../../src/tools/index.js'
import { setToolPrefs } from '../../src/tools/tool-preferences.js'
import type { MakeToolsOptions } from '../../src/tools/types.js'
import { getToolExecutor, mockLogger, seedTestPlatformInstance, setupTestDb } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const CONTEXT = 'diag-gate-user'

const adminDmOptions = (overrides: Partial<MakeToolsOptions> = {}): MakeToolsOptions => ({
  storageContextId: CONTEXT,
  chatUserId: CONTEXT,
  contextType: 'dm',
  mode: 'normal',
  isBotAdmin: true,
  platformInstanceId: 'pi-diag',
  ...overrides,
})

const recordField = (items: unknown[], field: string): unknown[] =>
  items.map((item) => (isRecord(item) ? item[field] : undefined))

describe('run_diagnostics gate matrix', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an admin DM normal-mode toolset exposes run_diagnostics', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions())

    expect(tools).toHaveProperty('run_diagnostics')
  })

  test('an admin DM toolset exposes run_diagnostics when mode is omitted (orchestrator descriptor-cache path)', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ mode: undefined }))

    expect(tools).toHaveProperty('run_diagnostics')
  })

  test('isBotAdmin false excludes run_diagnostics', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ isBotAdmin: false }))

    expect(tools).not.toHaveProperty('run_diagnostics')
  })

  test('omitting isBotAdmin excludes run_diagnostics', async () => {
    const tools = await makeTools(
      createMockProvider(),
      adminDmOptions({ isBotAdmin: undefined, platformInstanceId: undefined }),
    )

    expect(tools).not.toHaveProperty('run_diagnostics')
  })

  test('a group context excludes run_diagnostics even for an admin', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ contextType: 'group' }))

    expect(tools).not.toHaveProperty('run_diagnostics')
  })

  test('proactive mode excludes run_diagnostics even for an admin DM', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ mode: 'proactive' }))

    expect(tools).not.toHaveProperty('run_diagnostics')
  })

  test('a guest-filtered toolset never contains run_diagnostics', async () => {
    const descriptors = await makeTools(createMockProvider(), adminDmOptions({ isBotAdmin: false }))

    const guestTools = applyGuestReadOnlyFilter(descriptors)

    expect(guestTools).not.toHaveProperty('run_diagnostics')
  })
})

const READER_TOOLS = ['read_recent_logs', 'read_llm_traces', 'read_recent_turns', 'read_recent_tool_failures'] as const

describe('diagnostics reader family gate matrix', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an admin DM normal-mode toolset exposes the full reader family', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions())

    for (const name of READER_TOOLS) expect(tools).toHaveProperty(name)
  })

  test('an admin DM toolset exposes the reader family when mode is omitted (orchestrator descriptor-cache path)', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ mode: undefined }))

    for (const name of READER_TOOLS) expect(tools).toHaveProperty(name)
  })

  test('isBotAdmin false excludes the reader family', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ isBotAdmin: false }))

    for (const name of READER_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('omitting isBotAdmin excludes the reader family', async () => {
    const tools = await makeTools(
      createMockProvider(),
      adminDmOptions({ isBotAdmin: undefined, platformInstanceId: undefined }),
    )

    for (const name of READER_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('a group context excludes the reader family even for an admin', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ contextType: 'group' }))

    for (const name of READER_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('proactive mode excludes the reader family even for an admin DM', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions({ mode: 'proactive' }))

    for (const name of READER_TOOLS) expect(tools).not.toHaveProperty(name)
  })

  test('a guest-filtered toolset never contains the reader family', async () => {
    const descriptors = await makeTools(createMockProvider(), adminDmOptions({ isBotAdmin: false }))

    const guestTools = applyGuestReadOnlyFilter(descriptors)

    for (const name of READER_TOOLS) expect(guestTools).not.toHaveProperty(name)
  })
})

describe('diagnostics reader family visibility principal', () => {
  const PRINCIPAL = 'diag-family-principal'

  const principalTurn = (turnId: string, userId: string): Turn => ({
    turnId,
    scope: { kind: 'user', userId },
    startedAt: 1000,
    endedAt: 2000,
    status: 'ok',
    incomingMessageCount: 1,
    toolCalls: [],
  })

  const principalTrace = (chatUserId: string | undefined): LlmTrace => ({
    timestamp: 1000,
    userId: 'internal',
    chatUserId,
    model: 'gpt-main',
    steps: 1,
    totalTokens: { inputTokens: 10, outputTokens: 5 },
    duration: 500,
    toolCalls: [],
    error: undefined,
    responseId: 'resp-1',
    actualModel: undefined,
    finishReason: 'stop',
    messageCount: 2,
    toolCount: 0,
    exposedToolCount: 0,
    fullToolCount: 0,
    toolSchemaBytes: 0,
    routingIntent: undefined,
    routingConfidence: undefined,
    routingReason: undefined,
    generatedText: chatUserId === undefined ? undefined : `reply-for-${chatUserId}`,
    stepsDetail: undefined,
  })

  const principalFailure = (turnId: string, userId: string): ToolFailure => ({
    timestamp: 1000,
    scope: { kind: 'user', userId },
    data: { turnId, toolName: 'create_task', durationMs: 90, ok: false, failureReason: 'provider 500' },
  })

  let tools: Record<string, Tool>

  beforeEach(() => {
    mockLogger()
    logBuffer.clear()
    resetTurnBuffers()
    resetLlmBuffers()

    logBuffer.push({
      level: 30,
      time: '2026-08-23T00:00:01.000Z',
      msg: 'own entry',
      chatUserId: PRINCIPAL,
      ownText: 'own verbatim',
    })
    logBuffer.push({
      level: 30,
      time: '2026-08-23T00:00:02.000Z',
      msg: 'foreign entry',
      chatUserId: 'user-2',
      foreignText: 'leak',
    })
    recentLlm.push(principalTrace(PRINCIPAL))
    recentLlm.push(principalTrace('user-2'))
    recentTurns.push(principalTurn('turn-own', PRINCIPAL))
    recentTurns.push(principalTurn('turn-foreign', 'user-2'))
    recentTurns.push({ ...principalTurn('turn-global', 'x'), scope: { kind: 'global' } })
    recentToolFailures.push(principalFailure('failure-own', PRINCIPAL))
    recentToolFailures.push(principalFailure('failure-foreign', 'user-2'))

    tools = {}
    maybeAddDiagnosticsTools(tools, adminDmOptions({ chatUserId: PRINCIPAL }))
  })

  afterEach(() => {
    logBuffer.clear()
    resetTurnBuffers()
    resetLlmBuffers()
  })

  test('read_recent_logs egresses under the assembly-time chatUserId principal', async () => {
    const result: unknown = await getToolExecutor(tools['read_recent_logs']!)({})

    assert(isRecord(result))
    const entries = result['entries']
    assert(Array.isArray(entries))
    const byMsg = new Map<string, Record<string, unknown>>()
    for (const e of entries) {
      assert(isRecord(e))
      byMsg.set(String(e['msg']), e)
    }
    expect(byMsg.get('own entry')!['ownText']).toBe('own verbatim')
    expect(byMsg.get('foreign entry')!['foreignText']).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('leak')
  })

  test('read_llm_traces egresses under the assembly-time chatUserId principal', async () => {
    const result: unknown = await getToolExecutor(tools['read_llm_traces']!)({})

    assert(isRecord(result))
    const traces = result['traces']
    assert(Array.isArray(traces))
    expect(traces).toHaveLength(2)
    const texts = recordField(traces, 'generatedText')
    expect(texts).toContain(`reply-for-${PRINCIPAL}`)
    expect(texts).toContain(undefined)
  })

  test('read_recent_turns egresses under the assembly-time chatUserId principal', async () => {
    const result: unknown = await getToolExecutor(tools['read_recent_turns']!)({})

    assert(isRecord(result))
    const turns = result['turns']
    assert(Array.isArray(turns))
    const ids = recordField(turns, 'turnId')
    expect(ids).toEqual(['turn-own', 'turn-global'])
  })

  test('read_recent_tool_failures egresses under the assembly-time chatUserId principal', async () => {
    const result: unknown = await getToolExecutor(tools['read_recent_tool_failures']!)({})

    assert(isRecord(result))
    const failures = result['failures']
    assert(Array.isArray(failures))
    const ids = recordField(failures, 'turnId')
    expect(ids).toEqual(['failure-own'])
  })
})

describe('run_diagnostics payload', () => {
  const PROBE = 'probe-error-canary'

  const failingDeps = (): DiagnosticsDeps => ({
    platformInstanceActive: (): boolean => {
      throw new Error(PROBE)
    },
  })

  const isProbeWarn = (line: string): boolean =>
    line.includes('"level":40') && line.includes('Diagnostics probe failed')

  beforeEach(async () => {
    await setupTestDb()
  })

  test('returns only the whitelisted fields with healthy probe values', async () => {
    seedTestPlatformInstance({ id: 'pi-diag-payload' })
    const result: unknown = await getToolExecutor(makeRunDiagnosticsTool('pi-diag-payload'))({})
    assert(isRecord(result), 'diagnostics result must be an object')

    expect(Object.keys(result).sort()).toEqual([
      'descriptor_cache_present',
      'llm_config',
      'mcp_pool',
      'platform_instance_active',
      'queue_count',
      'task_instance',
      'uptime_seconds',
    ])
    expect(result['platform_instance_active']).toBe(true)
    expect(result['task_instance']).toEqual({ status: 'not_configured' })
    expect(result['llm_config']).toBe('unconfigured')
    expect(typeof result['uptime_seconds']).toBe('number')
    expect(result['uptime_seconds']).toBeGreaterThanOrEqual(0)
  })

  test('reports the task instance id and type only when configured', async () => {
    const deps: DiagnosticsDeps = { taskInstance: () => ({ id: 'ti-1', type: 'kaneo' }) }
    const result: unknown = await getToolExecutor(makeRunDiagnosticsTool('pi-diag-payload', deps))({})
    assert(isRecord(result), 'diagnostics result must be an object')

    expect(result['task_instance']).toEqual({ status: 'configured', id: 'ti-1', type: 'kaneo' })
  })

  test('default probe reads the assigned task instance from the config context (production wiring passes empty deps)', async () => {
    seedTestPlatformInstance({ id: 'pi-diag' })
    insertTaskInstance({
      id: 'ti-diag-assigned',
      type: 'kaneo',
      config: { baseUrl: 'https://kaneo.invalid' },
      status: 'active',
    })
    setContextSettings({ contextId: CONTEXT, taskInstanceId: 'ti-diag-assigned', platformInstanceId: 'pi-diag' })
    const result: unknown = await getToolExecutor(makeRunDiagnosticsTool('pi-diag', {}, CONTEXT))({})
    assert(isRecord(result), 'diagnostics result must be an object')

    expect(result['task_instance']).toEqual({ status: 'configured', id: 'ti-diag-assigned', type: 'kaneo' })
  })

  test('no token/key/credential-bearing value appears in the result or log output', async () => {
    seedTestPlatformInstance({ id: 'pi-diag-payload' })
    const logLines: string[] = []
    const stream = { write: (chunk: string): void => void logLines.push(chunk) }
    logMultistream.add(stream)
    logger.level = 'debug'
    try {
      const result = await getToolExecutor(makeRunDiagnosticsTool('pi-diag-payload'))({})
      const serialized = JSON.stringify(result) + logLines.join('')
      expect(serialized).not.toContain('token')
      expect(serialized).not.toContain('apiKey')
      expect(serialized).not.toContain('api_key')
      expect(serialized).not.toContain('secret')
      expect(serialized).not.toContain('credential')
      expect(serialized).not.toContain('baseUrl')
    } finally {
      logger.level = 'silent'
    }
  })

  test('a throwing probe degrades to a per-field error marker instead of an uncaught failure', async () => {
    seedTestPlatformInstance({ id: 'pi-diag-payload' })
    const raw: unknown = await getToolExecutor(makeRunDiagnosticsTool('pi-diag-payload', failingDeps()))({})
    assert(isRecord(raw), 'diagnostics result must be an object')
    const result = raw

    expect(result['platform_instance_active']).toBe('probe_error')
    // The other probes still report their values.
    expect(result['llm_config']).toBe('unconfigured')
    expect(typeof result['uptime_seconds']).toBe('number')
    expect(JSON.stringify(result)).not.toContain(PROBE)
  })

  test('a failed probe logs the result field name and the normalized error cause', async () => {
    seedTestPlatformInstance({ id: 'pi-diag-payload' })
    const logLines: string[] = []
    const stream = { write: (chunk: string): void => void logLines.push(chunk) }
    logMultistream.add(stream)
    logger.level = 'debug'
    try {
      const raw: unknown = await getToolExecutor(makeRunDiagnosticsTool('pi-diag-payload', failingDeps()))({})
      assert(isRecord(raw), 'diagnostics result must be an object')

      expect(raw['platform_instance_active']).toBe('probe_error')
      const warns = logLines.filter(isProbeWarn)
      expect(warns).toHaveLength(1)
      expect(warns[0]).toContain('"field":"platform_instance_active"')
      expect(warns[0]).toContain('"errorClass":"Error"')
      expect(warns[0]).not.toContain(PROBE)
    } finally {
      logger.level = 'silent'
    }
  })
})

describe('run_diagnostics descriptor_cache_present probe', () => {
  const CACHE_CTX = 'diag-cache-ctx'
  const CACHE_USER = 'diag-cache-user'

  const assembledDescriptorCache = (options: MakeToolsOptions): Promise<unknown> => {
    const tools: Record<string, Tool> = {}
    maybeAddDiagnosticsTools(tools, options)
    const runDiagnostics = tools['run_diagnostics']
    assert(runDiagnostics !== undefined, 'run_diagnostics must be assembled')
    return getToolExecutor(runDiagnostics)({})
  }

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('reports true when descriptors are cached for the storage context (production wiring passes empty deps)', async () => {
    seedTestPlatformInstance({ id: 'pi-diag' })
    setCachedTools('provider-backed:no-staged-download:no-resolver:diag-cache-ctx:diag-cache-user::admin', {
      some_tool: {},
    })
    const result: unknown = await assembledDescriptorCache(
      adminDmOptions({ storageContextId: CACHE_CTX, chatUserId: CACHE_USER, platformInstanceId: 'pi-diag' }),
    )
    assert(isRecord(result), 'diagnostics result must be an object')

    expect(result['descriptor_cache_present']).toBe(true)
  })

  test('reports false for a storage context with no cached descriptors', async () => {
    seedTestPlatformInstance({ id: 'pi-diag' })
    const result: unknown = await assembledDescriptorCache(adminDmOptions({ platformInstanceId: 'pi-diag' }))
    assert(isRecord(result), 'diagnostics result must be an object')

    expect(result['descriptor_cache_present']).toBe(false)
  })
})

describe('run_diagnostics tool preferences', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('tool_prefs deny removes run_diagnostics from an otherwise-qualifying admin DM toolset', async () => {
    setToolPrefs('diag-prefs-deny', { domainDefaults: {}, toolOverrides: { run_diagnostics: 'deny' } })

    const tools = await makeTools(
      createMockProvider(),
      adminDmOptions({ storageContextId: 'diag-prefs-deny', chatUserId: 'diag-prefs-deny' }),
    )

    expect(tools).not.toHaveProperty('run_diagnostics')
  })

  test('tool_prefs ask wraps run_diagnostics so an ungranted call returns permission_denied', async () => {
    setToolPrefs('diag-prefs-ask', { domainDefaults: {}, toolOverrides: { run_diagnostics: 'ask' } })

    const tools = await makeTools(
      createMockProvider(),
      adminDmOptions({ storageContextId: 'diag-prefs-ask', chatUserId: 'diag-prefs-ask' }),
    )

    expect(tools).toHaveProperty('run_diagnostics')
    const wrapped = tools['run_diagnostics']
    expect(wrapped).toBeDefined()
    assert(wrapped !== undefined)
    // ask wraps the execute fn; with no chat surface (askPermission undefined)
    // an ungranted call returns the structured permission_denied result.
    const out: unknown = await getToolExecutor(wrapped)(
      { _permission_reason: 'health check' },
      { toolCallId: 't1', messages: [], context: {} },
    )
    expect(out).toMatchObject({ status: 'permission_denied' })
  })
})

describe('run_diagnostics llm_config probe', () => {
  const originalKey = process.env['INSTANCE_CONFIG_KEY']

  const makeByokProvider = (): LlmProviderAccount => ({
    id: 'prov-byok',
    label: 'BYOK provider',
    providerType: 'custom',
    baseUrl: 'https://byok.invalid/v1',
    apiKey: 'sk-byok',
    verification: { status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null },
  })

  const seedByokMain = (configContextId: string): void => {
    enableByokForContext(configContextId, 'admin-1')
    upsertByokProvider(configContextId, makeByokProvider(), 'admin-1')
    setByokRoles(
      configContextId,
      { main: { providerId: 'prov-byok', model: 'byok-main' }, small: null, embedding: null },
      'admin-1',
    )
  }

  const assembledLlmConfig = (options: MakeToolsOptions): Promise<unknown> => {
    const tools: Record<string, Tool> = {}
    maybeAddDiagnosticsTools(tools, options)
    const runDiagnostics = tools['run_diagnostics']
    assert(runDiagnostics !== undefined, 'run_diagnostics must be assembled')
    return getToolExecutor(runDiagnostics)({})
  }

  beforeEach(async () => {
    mockLogger()
    process.env['INSTANCE_CONFIG_KEY'] = 'd'.repeat(64)
    await setupTestDb()
    clearLlmAdminCacheForTesting()
  })

  afterEach(() => {
    if (originalKey === undefined) delete process.env['INSTANCE_CONFIG_KEY']
    else process.env['INSTANCE_CONFIG_KEY'] = originalKey
  })

  test('reports byok when the config context has an enabled BYOK bundle', async () => {
    seedByokMain(CONTEXT)
    const result: unknown = await assembledLlmConfig(adminDmOptions())
    assert(isRecord(result), 'diagnostics result must be an object')

    expect(result['llm_config']).toBe('byok')
  })

  test('reports byok when the BYOK bundle is bound on the group config context of a thread-scoped storage context', async () => {
    const configContextId = toScopedContextId({ platformInstanceId: 'pi-diag', nativeContextId: 'diag-group' })
    const threadStorageId = toScopedThreadContextId({
      platformInstanceId: 'pi-diag',
      nativeContextId: 'diag-group',
      threadId: 't-1',
    })
    seedByokMain(configContextId)
    const result: unknown = await assembledLlmConfig(adminDmOptions({ storageContextId: threadStorageId }))
    assert(isRecord(result), 'diagnostics result must be an object')

    expect(result['llm_config']).toBe('byok')
  })

  test('reports central when only the admin/global config resolves', async () => {
    const provider = createLlmProvider(
      { label: 'admin-llm', providerType: 'openai', baseUrl: 'https://admin.invalid/v1', apiKey: 'sk-admin' },
      'admin-1',
    )
    setAdminRoleBindings(
      { main: { providerId: provider.id, model: 'gpt-main' }, small: null, embedding: null },
      'admin-1',
    )
    const result: unknown = await assembledLlmConfig(adminDmOptions())
    assert(isRecord(result), 'diagnostics result must be an object')

    expect(result['llm_config']).toBe('central')
  })

  test('reports central when the main model runs on admin/global creds even if small/embedding resolve BYOK (mixed source)', async () => {
    const provider = createLlmProvider(
      { label: 'admin-llm', providerType: 'openai', baseUrl: 'https://admin.invalid/v1', apiKey: 'sk-admin' },
      'admin-1',
    )
    setAdminRoleBindings(
      { main: { providerId: provider.id, model: 'gpt-main' }, small: null, embedding: null },
      'admin-1',
    )
    enableByokForContext(CONTEXT, 'admin-1')
    upsertByokProvider(CONTEXT, makeByokProvider(), 'admin-1')
    setByokRoles(
      CONTEXT,
      { main: { providerId: '', model: '' }, small: { providerId: 'prov-byok', model: 'byok-small' }, embedding: null },
      'admin-1',
    )
    const result: unknown = await assembledLlmConfig(adminDmOptions())
    assert(isRecord(result), 'diagnostics result must be an object')

    expect(result['llm_config']).toBe('central')
  })
})
