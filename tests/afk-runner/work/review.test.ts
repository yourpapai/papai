// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import type { KernelContext } from '../../../afk-runner/src/kernel/machine.js'
import { owesVerificationRound } from '../../../afk-runner/src/work/review.js'

const needsReviewRecord = {
  round: 3,
  verdict: 'needs-review',
  counts: { blocker: 0, material: 1, nitpick: 0 },
  open: { blocker: 0, material: 0, nitpick: 0 },
  concerns: [],
  resolved: 1,
  dismissed: 0,
} as const

function contextOf(overrides: Partial<KernelContext> = {}): KernelContext {
  return {
    stages: {},
    depth: 'M',
    round: { current: 3, cap: 3 },
    perRound: [],
    lastVerdict: needsReviewRecord,
    gate: null,
    autoDecisions: [],
    children: {},
    tally: {},
    gateOutcome: null,
    gateDeadlineAt: null,
    gateDeadlineReArmed: false,
    failures: {},
    failureKinds: {},
    ...overrides,
  } as KernelContext
}

describe('owesVerificationRound — the thrash denial conjunct (loop-memory D6)', () => {
  it('a plain needs-review at the base cap still owes the round', () => {
    expect(owesVerificationRound(contextOf(), 'M')).toBe(true)
  })

  it('a thrash-ended last verdict (concerns non-empty) is denied — fold-derived, resume-safe', () => {
    const thrashed = contextOf({
      lastVerdict: { ...needsReviewRecord, concerns: ['id names never proposal scope'] },
    })
    expect(owesVerificationRound(thrashed, 'M')).toBe(false)
  })
})
