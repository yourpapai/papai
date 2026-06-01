// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { strict as assert } from 'node:assert'

import { evaluateStartupGuard } from '../../src/plugins/startup-guard.js'

describe('evaluateStartupGuard', () => {
  test('recommends exit when plugins directory is missing and DEBUG_SERVER=true', () => {
    const decision = evaluateStartupGuard({ directoryMissing: true, debugServerEnabled: true })
    assert.equal(decision.action, 'exit')
    assert('reason' in decision)
    expect(decision.reason).toContain('DEBUG_SERVER=true')
  })

  test('recommends warn-and-continue when plugins directory is missing and DEBUG_SERVER=false', () => {
    const decision = evaluateStartupGuard({ directoryMissing: true, debugServerEnabled: false })
    expect(decision.action).toBe('warn')
  })

  test('recommends ok when plugins directory is present', () => {
    const decision = evaluateStartupGuard({ directoryMissing: false, debugServerEnabled: true })
    expect(decision.action).toBe('ok')
  })
})
