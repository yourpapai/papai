// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { computeRatchetedFloor } from '../../scripts/coverage/ratchet-stories.js'

const LCOV = ['SF:src/a.ts', 'FNF:1', 'FNH:1', 'DA:1,1', 'DA:2,1', 'LF:2', 'LH:2', 'end_of_record'].join('\n')

describe('computeRatchetedFloor', () => {
  it('raises the floor toward measured coverage minus epsilon', () => {
    const next = computeRatchetedFloor(LCOV, { lines: 0.5, functions: 0.5 }, 0.005)
    expect(next.lines).toBeGreaterThan(0.5)
    expect(next.functions).toBeGreaterThan(0.5)
  })

  it('never lowers an existing floor', () => {
    const next = computeRatchetedFloor(LCOV, { lines: 0.99, functions: 0.99 }, 0.005)
    expect(next.lines).toBe(0.99)
    expect(next.functions).toBe(0.99)
  })
})
