// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { canTransition } from '../../opencode-agent/src/transitions.js'
import { PHASES } from '../../opencode-agent/src/types.js'

/**
 * The state machine's acceptance sets, as one answer per signal over every
 * phase.
 *
 * The transition tests have lived beside the block channel they were split
 * from (`state-manager.test.ts` carried them before this file did); what this
 * suite adds is the *set* view — which phases accept a signal, read straight
 * off `canTransition` — so widening one is a visible diff in one list rather
 * than a row appearing somewhere inside another file's matrix.
 */
describe('CONTINUE acceptance', () => {
  test('is accepted in exactly the wall-clock park and the parked triage', () => {
    // INCOMPLETE is the park `/continue` resumes out of; INIT_OR_CLARIFY is
    // the forward path (issue #438) — the same command re-runs triage where
    // the issue stands instead of resuming anything. Every other phase
    // refuses it through `refuseCommand`, which names what the phase does
    // accept.
    const accepted = PHASES.filter((phase) => canTransition(phase, 'CONTINUE'))

    expect(accepted).toEqual(['INIT_OR_CLARIFY', 'INCOMPLETE'])
  })
})
