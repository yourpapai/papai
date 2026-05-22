// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  alertsForSubject,
  instructionsForSubject,
  memosForSubject,
  recurringForSubject,
  scheduledForSubject,
} from '../../src/stats/per-table.js'

describe('per-table helpers smoke check', () => {
  test('all per-subject helpers are exported as functions', () => {
    expect(typeof memosForSubject).toBe('function')
    expect(typeof scheduledForSubject).toBe('function')
    expect(typeof alertsForSubject).toBe('function')
    expect(typeof recurringForSubject).toBe('function')
    expect(typeof instructionsForSubject).toBe('function')
  })
})
