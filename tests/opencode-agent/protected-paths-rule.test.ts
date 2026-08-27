// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { PROTECTED_PATHS_RULE } from '../../opencode-agent/src/protected-paths.js'
import { PROTECTED_PATHS_RULE as LOOP_PROTECTED_PATHS_RULE } from '../../review-loop/src/prompt-templates.js'

/**
 * The minimality precedent, one rule over: two workspaces, one definition.
 * `opencode-agent` drives `review-loop/` as a subprocess and imports nothing
 * from it, so the protected-paths rule is duplicated rather than shared — and
 * this file is where that duplication is made safe. See
 * `minimality-rule.test.ts` for the same argument about a different paragraph.
 *
 * The pin is containment rather than equality (design D1): the review-loop
 * constant carries the agent-side text verbatim plus one mapping line that
 * lands the rule's "say in your reply" half on the fixer's result schema.
 * Equality would forbid that line; containment lets it exist while keeping the
 * shared core from forking.
 */
describe('the protected-paths rule has one definition', () => {
  test('the review-loop constant carries the agent-side rule verbatim', () => {
    expect(LOOP_PROTECTED_PATHS_RULE).toContain(PROTECTED_PATHS_RULE)
  })

  test('the agent-side rule names the path and what to do instead', () => {
    // Mirrors instructions.test.ts's own assertion of the same constant: the
    // pin only keeps the copies equal, so what the text must contain is
    // asserted here too — against the copy this workspace owns.
    expect(PROTECTED_PATHS_RULE).toContain('.github/workflows/')
    expect(PROTECTED_PATHS_RULE).toContain('by hand')
  })
})
