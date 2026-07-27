// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { PARITY_GROUPS } from '../../../stories/harness/parity/expectations.js'
import { YOUTRACK_PARITY_EXCLUSIONS } from './youtrack-parity-exclusions.js'

describe('youtrack parity exclusions integrity', () => {
  const ids = new Set(PARITY_GROUPS.map((group) => group.id))

  test('every excluded id names a real PARITY_GROUPS id', () => {
    for (const entry of YOUTRACK_PARITY_EXCLUSIONS) {
      expect(ids.has(entry.group)).toBe(true)
    }
  })

  test('every exclusion carries a non-empty reason', () => {
    for (const entry of YOUTRACK_PARITY_EXCLUSIONS) {
      expect(entry.reason.length).toBeGreaterThan(0)
    }
  })

  test('no duplicate exclusions', () => {
    const groups = YOUTRACK_PARITY_EXCLUSIONS.map((entry) => entry.group)
    expect(new Set(groups).size).toBe(groups.length)
  })

  test('run set = PARITY_GROUPS minus exclusions (nothing silently dropped)', () => {
    const excluded = new Set(YOUTRACK_PARITY_EXCLUSIONS.map((entry) => entry.group))
    const runSet = PARITY_GROUPS.filter((group) => !excluded.has(group.id))
    expect(runSet.length).toBe(PARITY_GROUPS.length - YOUTRACK_PARITY_EXCLUSIONS.length)
  })
})
