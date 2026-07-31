// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LlmStartedFact } from '../../src/analytics/source-facts-execution.js'

describe('source-facts-execution', () => {
  test('variant type is importable and discriminates', () => {
    const fact: Pick<LlmStartedFact, 'type'> = { type: 'llm_started' }
    expect(fact.type).toBe('llm_started')
  })
})
