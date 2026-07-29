// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  CURATED_EVENT_PROP_COLUMNS,
  extractTypedProps,
  PROP_EXTRACTIONS,
} from '../../../src/analytics/jobs/snapshot-props.js'

describe('extractTypedProps', () => {
  test('maps allowlisted text, integer, real, and json props onto typed columns', () => {
    const extracted = extractTypedProps({
      outcome: 'granted',
      recovered_same_turn: true,
      duration_ms: 12.5,
      goals: ['G1', 'G2'],
      primary: 'task_create',
    })
    expect(extracted).toEqual({
      prop_outcome: 'granted',
      prop_recovered_same_turn: 1,
      prop_duration_ms: 12.5,
      prop_goals_json: '["G1","G2"]',
      prop_primary_intent: 'task_create',
    })
  })

  test('drops non-allowlisted keys entirely', () => {
    const extracted = extractTypedProps({ free_text: 'secret', message: 'raw content', outcome: 'ok' })
    expect(Object.keys(extracted)).toEqual(['prop_outcome'])
  })

  test('drops values whose type does not match the allowlist kind', () => {
    const extracted = extractTypedProps({ outcome: 42, duration_ms: 'fast', abstained: 'yes' })
    expect(extracted).toEqual({})
  })

  test('every allowlisted column is unique and prop_-prefixed', () => {
    const columns = PROP_EXTRACTIONS.map((entry) => entry.column)
    expect(new Set(columns).size).toBe(columns.length)
    for (const column of CURATED_EVENT_PROP_COLUMNS) {
      expect(column.startsWith('prop_')).toBe(true)
    }
  })

  test('extracts the edit family window and phase props onto typed text columns', () => {
    const extracted = extractTypedProps({ window: 'w2', phase: 'regen_completed' })
    expect(extracted).toEqual({ prop_window: 'w2', prop_phase: 'regen_completed' })
    expect(CURATED_EVENT_PROP_COLUMNS).toContain('prop_window')
    expect(CURATED_EVENT_PROP_COLUMNS).toContain('prop_phase')
  })
})
