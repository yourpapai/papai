// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// NOTE: warnIfLegacyDebugToken lives in src/startup-helpers.ts and is called
// from src/index.ts during startup. Testing it via startup-helpers avoids
// importing the full startup module with all its side-effects.
// The canonical test lives in tests/startup-helpers.test.ts.
// This file re-runs the same assertions to satisfy the task-10 test contract.

import { afterEach, describe, expect, mock, test } from 'bun:test'

import { warnIfLegacyDebugToken } from '../src/startup-helpers.js'
import { createTrackedLoggerMock } from './utils/test-helpers.js'

describe('warnIfLegacyDebugToken', () => {
  afterEach(() => {
    delete process.env['DEBUG_TOKEN']
  })

  test('emits a WARN when DEBUG_TOKEN is set', () => {
    process.env['DEBUG_TOKEN'] = 'x'
    const tracked = createTrackedLoggerMock()
    void mock.module('../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
    warnIfLegacyDebugToken()
    const warnings = tracked.getCallsByLevel('warn')
    expect(warnings.length).toBeGreaterThan(0)
    expect(String(warnings[0]?.args[0])).toContain('DEBUG_TOKEN is ignored')
  })

  test('is silent when DEBUG_TOKEN is not set', () => {
    delete process.env['DEBUG_TOKEN']
    const tracked = createTrackedLoggerMock()
    void mock.module('../src/logger.js', () => ({
      getLogLevel: tracked.getLogLevel,
      logger: tracked.logger,
    }))
    warnIfLegacyDebugToken()
    expect(tracked.getCallsByLevel('warn')).toHaveLength(0)
  })
})
