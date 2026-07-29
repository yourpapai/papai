// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  formatPreconditionMarker,
  formatScopesMarker,
  formatTurnsMarker,
  SHADOW_GATE_MIN_DISTINCT_SCOPES,
  SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS,
} from '../../src/long-term-memory/shadow-gate.js'

describe('shadow gate preconditions', () => {
  // These two numbers are pre-registered (frozen 2026-07-25). A failure here means
  // someone moved a protocol quantity -- that is a goalpost move, not a test to update.
  test('holds the frozen pre-registered thresholds', () => {
    expect(SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS).toBe(1000)
    expect(SHADOW_GATE_MIN_DISTINCT_SCOPES).toBe(50)
  })

  test('formatPreconditionMarker reads "below" under the threshold', () => {
    expect(formatPreconditionMarker(9, 10, 'X >= 10')).toBe('(below the pre-registered X >= 10)')
  })

  test('formatPreconditionMarker reads "meets" at the threshold exactly', () => {
    expect(formatPreconditionMarker(10, 10, 'X >= 10')).toBe('(meets the pre-registered X >= 10)')
  })

  test('formatPreconditionMarker reads "meets" above the threshold', () => {
    expect(formatPreconditionMarker(11, 10, 'X >= 10')).toBe('(meets the pre-registered X >= 10)')
  })

  test('formatTurnsMarker renders N on both sides and at the boundary', () => {
    expect(formatTurnsMarker(999)).toBe('(below the pre-registered N = 1000)')
    expect(formatTurnsMarker(1000)).toBe('(meets the pre-registered N = 1000)')
    expect(formatTurnsMarker(1001)).toBe('(meets the pre-registered N = 1000)')
  })

  test('formatScopesMarker renders M on both sides and at the boundary', () => {
    expect(formatScopesMarker(49)).toBe('(below the pre-registered M >= 50)')
    expect(formatScopesMarker(50)).toBe('(meets the pre-registered M >= 50)')
    expect(formatScopesMarker(51)).toBe('(meets the pre-registered M >= 50)')
  })

  // The markers describe; they never render a verdict. The go/no-go call stays with the
  // operator, read against the threats-to-validity ledger in the design doc.
  test('markers never render verdict words', () => {
    const samples = [formatTurnsMarker(1), formatTurnsMarker(5000), formatScopesMarker(1), formatScopesMarker(500)]
    for (const sample of samples) {
      expect(sample).not.toMatch(/PASS|FAIL|GO|STOP|ESCALATE/iu)
    }
  })
})
