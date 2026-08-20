// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { IMPLEMENT_INSTRUCTIONS } from '../../opencode-agent/src/implement-prompts.js'
import { CI_FIX_INSTRUCTIONS } from '../../opencode-agent/src/phases/ci-fix.js'
import { PROPOSE_FILES_INSTRUCTIONS, PROPOSE_INSTRUCTIONS } from '../../opencode-agent/src/phases/plan-draft.js'
import { MINIMALITY_RULE } from '../../opencode-agent/src/prompts.js'
import { PROTECTED_PATHS_RULE } from '../../opencode-agent/src/protected-paths.js'

/**
 * The prompts are the courtesy; `stageAllowed` is the mechanism. This pins the
 * courtesy being offered by every phase that can write a file, which it was not.
 *
 * Run 31779566286 is the cost of the gap. `CI_FIX` — the phase most likely to
 * want a workflow edit, since a red job's root cause often *is* the workflow —
 * was the one phase never told the rule. It wrote `agent-pipeline.yml`, had it
 * dropped at staging, pushed nothing, and did it again the next round, until
 * `ciAttempts` was spent.
 *
 * Asserted against the shared constant rather than against a phrase, so the
 * wording lives in one place: four copies of a rule are four chances to soften
 * one of them, and a softened copy still passes a `toContain('workflows')`.
 */
describe('every phase that can write a file states the protected-paths rule', () => {
  const PHASES: ReadonlyArray<readonly [string, string]> = [
    ['implement', IMPLEMENT_INSTRUCTIONS],
    ['ci-fix', CI_FIX_INSTRUCTIONS],
    ['propose', PROPOSE_INSTRUCTIONS],
    ['propose-files', PROPOSE_FILES_INSTRUCTIONS],
  ]

  test.each(PHASES)('%s carries it verbatim', (_phase, instructions) => {
    expect(instructions).toContain(PROTECTED_PATHS_RULE)
  })

  test('the rule names the path and what to do instead', () => {
    // Naming the path is what makes it actionable; "say what a maintainer
    // should apply by hand" is the only move left when the fix *is* a workflow
    // edit, which is the case that cost three CI-fix rounds.
    expect(PROTECTED_PATHS_RULE).toContain('.github/workflows/')
    expect(PROTECTED_PATHS_RULE).toContain('by hand')
  })
})

/**
 * The minimality rule splits the same four blocks along a different seam:
 * writing production code versus drafting an OpenSpec artifact. Both halves are
 * asserted, because the boundary is a decision rather than an oversight — a
 * later edit that hands the rule to a drafter should fail a test, not pass
 * quietly. Artifact scope is governed by `openspec/config.yaml`'s `rules`, which
 * reach those two blocks already; a second rule about stdlib and one-liners
 * would be noise in a prompt that writes no code.
 */
describe('the minimality rule reaches the code-writing phases only', () => {
  const WRITES_CODE: ReadonlyArray<readonly [string, string]> = [
    ['implement', IMPLEMENT_INSTRUCTIONS],
    ['ci-fix', CI_FIX_INSTRUCTIONS],
  ]

  const DRAFTS_ARTIFACTS: ReadonlyArray<readonly [string, string]> = [
    ['propose', PROPOSE_INSTRUCTIONS],
    ['propose-files', PROPOSE_FILES_INSTRUCTIONS],
  ]

  test.each(WRITES_CODE)('%s carries it verbatim', (_phase, instructions) => {
    expect(instructions).toContain(MINIMALITY_RULE)
  })

  test.each(DRAFTS_ARTIFACTS)('%s deliberately does not carry it', (_phase, instructions) => {
    expect(instructions).not.toContain(MINIMALITY_RULE)
  })
})
