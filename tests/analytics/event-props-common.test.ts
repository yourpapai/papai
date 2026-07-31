// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { CommonEventPropsSchemas } from '../../src/analytics/event-props-common.js'

describe('event-props-common schemas', () => {
  test('exposes closed edit_classified props keyed by event name', () => {
    const schema = CommonEventPropsSchemas.edit_classified
    expect(schema.safeParse({ window: 'w2' }).success).toBe(true)
    expect(schema.safeParse({ window: 'w4' }).success).toBe(false)
    expect(schema.safeParse({ window: 'w1', extra: 'x' }).success).toBe(false)
  })

  test('exposes closed edit_regen props with an optional non-negative duration', () => {
    const schema = CommonEventPropsSchemas.edit_regen
    expect(schema.safeParse({ phase: 'regen_completed' }).success).toBe(true)
    expect(schema.safeParse({ phase: 'regen_completed', duration_ms: 100 }).success).toBe(true)
    expect(schema.safeParse({ phase: 'regen_completed', duration_ms: -1 }).success).toBe(false)
    expect(schema.safeParse({ phase: 'regen_vibes' }).success).toBe(false)
    expect(schema.safeParse({ phase: 'prompt_shown', extra: 'x' }).success).toBe(false)
  })
})
