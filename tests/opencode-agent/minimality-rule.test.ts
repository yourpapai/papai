// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MINIMALITY_RULE } from '../../opencode-agent/src/prompts.js'
import { MINIMALITY_LADDER } from '../../review-loop/src/prompt-templates.js'

/**
 * Two workspaces, one rule. `opencode-agent` drives `review-loop/` as a
 * subprocess and imports nothing from it, so the constant is duplicated rather
 * than shared — and this file is where that duplication is made safe.
 *
 * The coupling lives in a test on purpose (design D1): a runtime import for one
 * paragraph would be a boundary to defend at every later refactor, and the
 * equality check needs both texts in one place anyway. `diff-stats.test.ts`
 * pins `.hooks/tdd`'s test-path pattern the same way.
 */
describe('the minimality rule has one definition', () => {
  test('both workspaces state it identically', () => {
    expect(MINIMALITY_RULE).toBe(MINIMALITY_LADDER)
  })

  test('it names what is never cut to reach a smaller diff', () => {
    // Without this clause the rule reads as licence to drop a safeguard, which
    // is the one way a minimality instruction does real damage. A carrier that
    // keeps the ladder and loses the brake must fail.
    expect(MINIMALITY_RULE).toMatch(/not the goal/iu)
    for (const safeguard of ['validation', 'error', 'security', 'test']) {
      expect(MINIMALITY_RULE).toContain(safeguard)
    }
  })

  test('it does not advise minimising file count', () => {
    // The upstream phrasing this rule descends from says "fewest files
    // possible". Here a max-lines failure means *split the file*, so adopting
    // that phrase would put the rule in conflict with an enforced convention.
    expect(MINIMALITY_RULE).not.toMatch(/fewest files/iu)
    expect(MINIMALITY_RULE).not.toMatch(/file count/iu)
  })
})
