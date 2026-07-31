// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createContributorTracker } from '../../src/analytics/aggregate-contributors.js'

describe('aggregate-contributors', () => {
  test('tracker module is importable and counts distinct contributors', () => {
    const tracker = createContributorTracker()
    tracker.record('2023-11-14', 'scope', 'actor-1')
    tracker.record('2023-11-14', 'scope', 'actor-1')
    expect(tracker.count('2023-11-14', 'scope')).toBe(1)
  })
})
