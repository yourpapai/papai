// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createRecordingHealth } from '../../src/analytics/runtime.testing.js'

describe('runtime.testing', () => {
  test('recording health counts increments', () => {
    const health = createRecordingHealth()
    health.increment('queue_full')
    health.increment('queue_full')
    health.increment('observer_failure')
    expect(health.counts).toEqual({ queue_full: 2, observer_failure: 1, normalization_rejection: 0 })
  })
})
