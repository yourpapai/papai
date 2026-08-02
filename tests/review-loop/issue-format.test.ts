// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  formatDecidedLine,
  formatFoundLine,
  formatIssueRef,
  groupForStatus,
  shortIssueId,
} from '../../review-loop/src/issue-format.js'

const ref = {
  id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  severity: 'high',
  file: 'src/auth/login.ts',
  line: 42,
  title: 'Token refresh race on 401',
}

describe('shortIssueId', () => {
  test('takes the first 8 characters', () => {
    expect(shortIssueId(ref.id)).toBe('a1b2c3d4')
    expect(shortIssueId('short')).toBe('short')
  })
})

describe('formatIssueRef', () => {
  test('renders id, padded severity, file:line, and title', () => {
    expect(formatIssueRef(ref)).toBe('#a1b2c3d4 [high]     src/auth/login.ts:42 — Token refresh race on 401')
  })
  test('critical severity fills the pad exactly', () => {
    expect(formatIssueRef({ ...ref, severity: 'critical' })).toBe(
      '#a1b2c3d4 [critical] src/auth/login.ts:42 — Token refresh race on 401',
    )
  })
})

describe('formatFoundLine', () => {
  test('prefixes with indented plus', () => {
    expect(formatFoundLine(ref)).toBe('  + #a1b2c3d4 [high]     src/auth/login.ts:42 — Token refresh race on 401')
  })
})

describe('formatDecidedLine', () => {
  test('maps known verdicts to marks and labels', () => {
    expect(formatDecidedLine({ id: ref.id, verdict: 'fixed' })).toBe('✓ #a1b2c3d4 → fixed')
    expect(formatDecidedLine({ id: ref.id, verdict: 'invalid' })).toBe('✗ #a1b2c3d4 → rejected')
    expect(formatDecidedLine({ id: ref.id, verdict: 'needs_human' })).toBe('! #a1b2c3d4 → needs human')
    expect(formatDecidedLine({ id: ref.id, verdict: 'already_fixed' })).toBe('· #a1b2c3d4 → already fixed')
    expect(formatDecidedLine({ id: ref.id, verdict: 'plan_drift' })).toBe('! #a1b2c3d4 → plan drift')
    expect(formatDecidedLine({ id: ref.id, verdict: 'no_commit' })).toBe('· #a1b2c3d4 → no change')
  })
  test('appends note in parentheses', () => {
    expect(formatDecidedLine({ id: ref.id, verdict: 'needs_human', note: 'merge conflict' })).toBe(
      '! #a1b2c3d4 → needs human (merge conflict)',
    )
  })
  test('unknown verdict falls back to dot mark and raw verdict', () => {
    expect(formatDecidedLine({ id: ref.id, verdict: 'mystery' })).toBe('· #a1b2c3d4 → mystery')
  })
})

describe('groupForStatus', () => {
  test('maps ledger statuses to report groups', () => {
    expect(groupForStatus('needs_human')).toBe('needsHuman')
    expect(groupForStatus('closed')).toBe('fixed')
    expect(groupForStatus('rejected')).toBe('rejected')
    expect(groupForStatus('already_fixed')).toBe('alreadyFixed')
    expect(groupForStatus('discovered')).toBe('open')
    expect(groupForStatus('verified')).toBe('open')
    expect(groupForStatus('fixed_pending_review')).toBe('open')
    expect(groupForStatus('reopened')).toBe('open')
  })
})
