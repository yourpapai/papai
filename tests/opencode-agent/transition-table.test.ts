// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { TRANSITIONS } from '../../opencode-agent/src/transition-table.js'
import { PHASES } from '../../opencode-agent/src/types.js'

/**
 * The table's own audit, asserted as data.
 *
 * The row-by-row behaviour is pinned where the machine is exercised
 * (`state-manager.test.ts`, `transitions.test.ts`); what this suite adds is the
 * structural contract of the table as a hand-maintained artefact — that every
 * destination is a declared phase, and that the audited signals appear in
 * exactly the rows their audit names.
 */
describe('the transition table', () => {
  test('names only declared phases as destinations — a typo cannot move the machine to nowhere', () => {
    // The `Record` keys are compile-checked, but the *values* are not: a
    // mistyped destination would sit in the table until a run moved a state
    // there and the schema refused the block at the next post. Walked so the
    // table stays truthful as data, not only as types.
    for (const row of Object.values(TRANSITIONS)) {
      for (const next of Object.values(row)) {
        expect(PHASES).toContain(next)
      }
    }
  })

  test('CI_FAILED appears in exactly the two rows the audit names', () => {
    // COMPLETE is the ordinary red run; PR_DELIVERY is the genuine race where a
    // refusal would be silent. Everywhere else a red run is either unactionable
    // (nothing pushed) or dangerous to honour (a hand-edited block).
    const admitting = PHASES.filter((phase) => TRANSITIONS[phase]['CI_FAILED'] !== undefined)

    expect(admitting).toEqual(['PR_DELIVERY', 'COMPLETE'])
  })

  test('REVIEW_REQUESTED appears in exactly the one row the audit names', () => {
    // Only a delivered issue has a diff to review; the other absences are the
    // same audit with one answer changed.
    const admitting = PHASES.filter((phase) => TRANSITIONS[phase]['REVIEW_REQUESTED'] !== undefined)

    expect(admitting).toEqual(['COMPLETE'])
  })
})
