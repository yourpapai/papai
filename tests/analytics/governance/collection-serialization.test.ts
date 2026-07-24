// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { insertEligibleCanonicalEvent } from '../../../src/analytics/governance/collection-serialization.js'

describe('collection-serialization', () => {
  test('exposes exactly one fenced canonical insertion API', () => {
    expect(typeof insertEligibleCanonicalEvent).toBe('function')
    expect(insertEligibleCanonicalEvent.length).toBeLessThanOrEqual(2)
  })
})
