// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { logMultistream, logger } from '../../src/logger.js'
import { makeRunDiagnosticsTool, type DiagnosticsDeps } from '../../src/tools/diagnostics.js'
import { applyGuestReadOnlyFilter, makeTools } from '../../src/tools/index.js'
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
