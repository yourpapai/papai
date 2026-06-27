// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Redaction release-gate: the coding-credentials store must never pass a secret
// value to the logger. `store.ts` binds `const log = logger.child(...)` at module
// load, so we install a tracked logger mock and import the store through a
// cachebuster query (mirroring tests/authorized-groups.test.ts) to get a fresh
// binding that resolves the mocked logger.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { createTrackedLoggerMock, type TrackedLoggerMock } from '../utils/logger-mock.js'
import { setupTestDb } from '../utils/test-helpers.js'

type StoreModule = typeof import('../../src/coding-credentials/store.js')

const importStore = (): Promise<StoreModule> =>
  import(`../../src/coding-credentials/store.js?test=${crypto.randomUUID()}`)

describe('coding-credentials redaction: no secret reaches the logger', () => {
  const tracked: TrackedLoggerMock = createTrackedLoggerMock()

  beforeEach(async () => {
    tracked.clearCalls()
    process.env['INSTANCE_CONFIG_KEY'] = '0'.repeat(64)
    void mock.module('../../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
    await setupTestDb()
  })

  afterEach(() => {
    delete process.env['INSTANCE_CONFIG_KEY']
  })

  test('updateCodingCredentials logs (contextId/namespace) but never the provider api key', async () => {
    const { updateCodingCredentials } = await importStore()
    updateCodingCredentials(
      'ctx-log',
      'agent-provider',
      { provider: 'anthropic', agent: 'claude', provider_api_key: 'sk-LOG-SECRET' },
      'u',
    )
    // Non-vacuous: the write DOES log (contextId/namespace/updatedBy) — so the
    // absence assertion below is meaningful, not a no-op against an empty array.
    expect(tracked.getCalls().length).toBeGreaterThan(0)
    expect(JSON.stringify(tracked.getCalls())).not.toContain('sk-LOG-SECRET')
  })

  test('updateCodingCredentials never logs the forge token', async () => {
    const { updateCodingCredentials } = await importStore()
    updateCodingCredentials('ctx-log', 'forge', { kind: 'github', forge_token: 'ghp_LOG_SECRET' }, 'u')
    expect(tracked.getCalls().length).toBeGreaterThan(0)
    expect(JSON.stringify(tracked.getCalls())).not.toContain('ghp_LOG_SECRET')
  })
})
