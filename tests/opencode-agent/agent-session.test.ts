// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { countedTokens } from '../../opencode-agent/src/agent-session.js'

/**
 * One definition of the figure `AGENT_MAX_TOKENS` is enforced on, sitting beside
 * the `tokensUsed()` declaration both adapters implement.
 *
 * The question every case here asks is the one the two backends used to answer
 * differently: which buckets count. Cache reads are the conversation re-sent on
 * each step of a turn, so counting them makes the figure grow with the number of
 * steps rather than with the work — the whole reason this function exists.
 */
describe('countedTokens', () => {
  test('sums uncached input, output, reasoning and cache writes', () => {
    expect(countedTokens({ input: 100, output: 20, reasoning: 5, cacheWrite: 300, cacheRead: 0 })).toBe(425)
  })

  test('excludes cache reads entirely', () => {
    // The recorded `native-success-turn.ndjson` turn: its 61,460 cache reads are
    // the same context re-read across the turn's API calls, and buy no ceiling.
    expect(countedTokens({ input: 4, output: 155, reasoning: 0, cacheWrite: 28_005, cacheRead: 61_460 })).toBe(28_164)
  })

  test('a cache-read-only turn spends nothing against the ceiling', () => {
    expect(countedTokens({ input: 0, output: 0, cacheRead: 5_000_000 })).toBe(0)
  })

  test('an absent optional bucket contributes zero rather than NaN', () => {
    // "Did not say" and "said none" are different answers to the *price*; the
    // ceiling must still return a number, so here they are the same answer.
    expect(countedTokens({ input: 10, output: 2 })).toBe(12)
    expect(countedTokens({ input: 10, output: 2, cacheWrite: undefined, cacheRead: undefined })).toBe(12)
    expect(Number.isNaN(countedTokens({ input: 10, output: 2 }))).toBe(false)
  })

  test('answers a non-negative integer for fractional counts', () => {
    const answer = countedTokens({ input: 10.4, output: 2.3, reasoning: 0.4, cacheWrite: 0.4 })
    expect(Number.isInteger(answer)).toBe(true)
    expect(answer).toBe(14)
  })

  test('an empty session counts nothing', () => {
    expect(countedTokens({ input: 0, output: 0 })).toBe(0)
  })
})
