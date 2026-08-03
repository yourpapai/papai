// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { AggregateCounterV1Schema, EventNameV1Schema } from '../../src/analytics/controlled-types.js'

describe('controlled-types v1 enums', () => {
  test('EventNameV1 accepts the edit family event names', () => {
    expect(EventNameV1Schema.safeParse('edit_classified').success).toBe(true)
    expect(EventNameV1Schema.safeParse('edit_regen').success).toBe(true)
  })

  test('AggregateCounterV1 accepts the edit_classified per-window counters', () => {
    expect(AggregateCounterV1Schema.safeParse('edit_classified_w1').success).toBe(true)
    expect(AggregateCounterV1Schema.safeParse('edit_classified_w2').success).toBe(true)
    expect(AggregateCounterV1Schema.safeParse('edit_classified_w3').success).toBe(true)
  })

  test('AggregateCounterV1 accepts the edit_regen per-phase counters', () => {
    for (const metric of [
      'edit_prompt_shown',
      'edit_prompt_adjust',
      'edit_prompt_note',
      'edit_regen_started',
      'edit_regen_completed',
      'edit_regen_failed',
      'edit_history_only',
    ]) {
      expect(AggregateCounterV1Schema.safeParse(metric).success).toBe(true)
    }
  })
})
