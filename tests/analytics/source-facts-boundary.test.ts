// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { EditClassifiedFact, EditRegenFact, TurnSteeredFact } from '../../src/analytics/source-facts-boundary.js'

describe('source-facts-boundary', () => {
  test('variant type is importable and discriminates', () => {
    const fact: Pick<TurnSteeredFact, 'type'> = { type: 'turn_steered' }
    expect(fact.type).toBe('turn_steered')
  })

  test('EditClassifiedFact discriminates and carries the closed window field', () => {
    const fact: Pick<EditClassifiedFact, 'type' | 'window'> = { type: 'edit_classified', window: 'w2' }
    expect(fact.type).toBe('edit_classified')
    expect(fact.window).toBe('w2')
  })

  test('EditRegenFact discriminates and exposes an optional durationMs', () => {
    const withoutDuration: Pick<EditRegenFact, 'type' | 'phase'> = { type: 'edit_regen', phase: 'prompt_shown' }
    const withDuration: Pick<EditRegenFact, 'type' | 'phase' | 'durationMs'> = {
      type: 'edit_regen',
      phase: 'regen_completed',
      durationMs: 4200,
    }
    expect(withoutDuration.type).toBe('edit_regen')
    expect(withDuration.phase).toBe('regen_completed')
    expect(withDuration.durationMs).toBe(4200)
  })
})
