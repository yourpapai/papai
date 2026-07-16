// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { createTrackedLoggerMock, type TrackedLoggerMock } from './utils/test-helpers.js'

// startup-helpers.ts binds `logger` at module-eval time. A static import would
// capture the real logger before the per-test mock is registered, and the live
// binding does not reliably refresh under serial (single-process) test runs.
// Cache-busting dynamic import (see tests/index-startup.test.ts) forces a fresh
// evaluation AFTER mock.module() installs the stub, so the bound logger is the
// mock.
type StartupHelpersModule = typeof import('../src/startup-helpers.js')

const isStartupHelpersModule = (value: unknown): value is StartupHelpersModule =>
  typeof value === 'object' && value !== null && typeof Reflect.get(value, 'warnIfLegacyDebugToken') === 'function'

async function loadWarnIfLegacyDebugToken(tracked: TrackedLoggerMock): Promise<() => void> {
  void mock.module('../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  const loaded: unknown = await import(`../src/startup-helpers.js?t=${crypto.randomUUID()}`)
  if (isStartupHelpersModule(loaded)) return loaded.warnIfLegacyDebugToken
  throw new Error('startup-helpers module did not export warnIfLegacyDebugToken')
}

describe('warnIfLegacyDebugToken', () => {
  afterEach(() => {
    delete process.env['DEBUG_TOKEN']
  })

  test('emits a WARN when DEBUG_TOKEN is set', async () => {
    process.env['DEBUG_TOKEN'] = 'x'
    const tracked = createTrackedLoggerMock()
    const warnIfLegacyDebugToken = await loadWarnIfLegacyDebugToken(tracked)
    warnIfLegacyDebugToken()
    const warnings = tracked.getCallsByLevel('warn')
    expect(warnings.length).toBeGreaterThan(0)
    expect(String(warnings[0]?.args[0])).toContain('DEBUG_TOKEN is ignored')
  })

  test('is silent when DEBUG_TOKEN is not set', async () => {
    delete process.env['DEBUG_TOKEN']
    const tracked = createTrackedLoggerMock()
    const warnIfLegacyDebugToken = await loadWarnIfLegacyDebugToken(tracked)
    warnIfLegacyDebugToken()
    expect(tracked.getCallsByLevel('warn')).toHaveLength(0)
  })
})
