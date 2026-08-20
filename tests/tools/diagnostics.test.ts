// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, afterEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { Tool } from 'ai'

import { enableByokForContext, setByokRoles, upsertByokProvider } from '../../src/byok-llm/store.js'
import { toScopedContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
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

describe('run_diagnostics gate matrix', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('an admin DM normal-mode toolset exposes run_diagnostics', async () => {
    const tools = await makeTools(createMockProvider(), adminDmOptions())

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

describe('run_diagnostics payload', () => {
  const PROBE = 'probe-error-canary'

  const failingDeps = (): DiagnosticsDeps => ({
    platformInstanceActive: (): boolean => {
      throw new Error(PROBE)
    },
  })

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
})
