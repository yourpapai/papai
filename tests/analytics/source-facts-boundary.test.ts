// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TurnSteeredFact } from '../../src/analytics/source-facts-boundary.js'

describe('source-facts-boundary', () => {
  test('variant type is importable and discriminates', () => {
    const fact: Pick<TurnSteeredFact, 'type'> = { type: 'turn_steered' }
    expect(fact.type).toBe('turn_steered')
  })
})
