// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { RunRegistry } from '../../src/run-control/registry.js'
import { createStopRequestedCondition } from '../../src/run-control/stop-condition.js'
import { createMockReply } from '../utils/test-helpers.js'

describe('createStopRequestedCondition', () => {
  test('reflects the live stopRequested flag', () => {
    const { reply } = createMockReply()
    const run = new RunRegistry().begin('ctx', { turnId: 't', reply })
    const condition = createStopRequestedCondition(run)
    expect(condition()).toBe(false)
    run.stopRequested = true
    expect(condition()).toBe(true)
  })
})
