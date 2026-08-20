// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  deleteStatusMessage,
  laneHint,
  RIGHTS_UNAVAILABLE_TEXT,
} from '../../../../client/settings/sections/analytics-preferences-copy.js'
import type { LaneHintInput } from '../../../../client/settings/sections/analytics-preferences-copy.js'

const base: LaneHintInput = {
  lane: 'localLongitudinal',
  value: 'unknown',
  effectiveAtMs: null,
  lawfulBasisMode: 'consent',
  policyEffectiveAtMs: null,
  nowMs: 1_800_000_000_000,
}

describe('laneHint', () => {
  test('an allowed lane names the date the choice took effect', () => {
    expect(laneHint({ ...base, value: 'allow', effectiveAtMs: 1_800_000_000_000 })).toBe(
      'Allowed since 2027-01-15 08:00.',
    )
  })

  test('a denied lane names the date the choice took effect', () => {
    expect(laneHint({ ...base, value: 'deny', effectiveAtMs: 1_800_000_000_000 })).toBe(
      'Denied since 2027-01-15 08:00.',
    )
  })

  test('a recorded choice with no timestamp omits the date', () => {
    expect(laneHint({ ...base, value: 'allow', effectiveAtMs: null })).toBe('Allowed.')
    expect(laneHint({ ...base, value: 'deny', effectiveAtMs: null })).toBe('Denied.')
  })

  test('an unset external lane is always off until allowed', () => {
    expect(laneHint({ ...base, lane: 'externalPseudonymous', value: 'unknown' })).toBe(
      'No choice recorded — external analytics stay off until you allow them.',
    )
  })

  test('an unset external lane stays off even under legitimate interest', () => {
    expect(
      laneHint({
        ...base,
        lane: 'externalPseudonymous',
        lawfulBasisMode: 'legitimate_interest',
        policyEffectiveAtMs: 1_700_000_000_000,
      }),
    ).toBe('No choice recorded — external analytics stay off until you allow them.')
  })

  test('an unset local lane under consent stays off', () => {
    expect(laneHint(base)).toBe('No choice recorded — local analytics stay off until you allow them.')
  })

  test('an unset local lane under legitimate interest before the effective date stays off', () => {
    expect(laneHint({ ...base, lawfulBasisMode: 'legitimate_interest', policyEffectiveAtMs: 1_900_000_000_000 })).toBe(
      'No choice recorded — local analytics stay off until you allow them.',
    )
  })

  test('an unset local lane under legitimate interest with no effective date stays off', () => {
    expect(laneHint({ ...base, lawfulBasisMode: 'legitimate_interest', policyEffectiveAtMs: null })).toBe(
      'No choice recorded — local analytics stay off until you allow them.',
    )
  })

  test('an unset local lane under legitimate interest past the effective date is collected', () => {
    expect(laneHint({ ...base, lawfulBasisMode: 'legitimate_interest', policyEffectiveAtMs: 1_700_000_000_000 })).toBe(
      'No choice recorded — local analytics are collected until you deny them.',
    )
  })

  test('an unset local lane under legitimate interest exactly at the effective date is collected', () => {
    expect(laneHint({ ...base, lawfulBasisMode: 'legitimate_interest', policyEffectiveAtMs: base.nowMs })).toBe(
      'No choice recorded — local analytics are collected until you deny them.',
    )
  })

  test('an unset local lane with no lawful basis published stays off', () => {
    expect(laneHint({ ...base, lawfulBasisMode: null, policyEffectiveAtMs: 1_700_000_000_000 })).toBe(
      'No choice recorded — local analytics stay off until you allow them.',
    )
  })
})

describe('deleteStatusMessage', () => {
  test('a completed deletion is a success announcement', () => {
    expect(deleteStatusMessage('completed')).toEqual({
      tone: 'status',
      text: 'Your analytics data has been deleted. Analytics stores only.',
    })
  })

  test('an in-progress deletion is a success announcement', () => {
    expect(deleteStatusMessage('in_progress')).toEqual({
      tone: 'status',
      text: 'Deletion is under way. Analytics stores only.',
    })
  })

  test('a requested deletion is a success announcement', () => {
    expect(deleteStatusMessage('requested')).toEqual({
      tone: 'status',
      text: 'Deletion has been requested. Analytics stores only.',
    })
  })

  test('a failed deletion is an alert, not a success', () => {
    expect(deleteStatusMessage('failed')).toEqual({
      tone: 'alert',
      text: 'Deletion failed — your analytics data was not removed. Try again shortly.',
    })
  })
})

test('the rights-unavailable text blames the deployment and does not claim nothing is collected', () => {
  expect(RIGHTS_UNAVAILABLE_TEXT).toContain('operator')
  expect(RIGHTS_UNAVAILABLE_TEXT).toContain('Aggregate')
  expect(RIGHTS_UNAVAILABLE_TEXT).not.toContain('nothing is collected')
})
