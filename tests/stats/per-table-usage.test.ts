// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { llmUsageForSubject, toolCallsForSubject, webFetchesForSubject } from '../../src/stats/per-table-usage.js'

describe('per-table-usage helpers smoke check', () => {
  test('all usage helpers exported as functions', () => {
    expect(typeof webFetchesForSubject).toBe('function')
    expect(typeof llmUsageForSubject).toBe('function')
    expect(typeof toolCallsForSubject).toBe('function')
  })
})
