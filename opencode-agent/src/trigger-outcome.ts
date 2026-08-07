// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentState, RunResult } from './types.js'

/**
 * What the trigger layer concluded, shared by `triggers.ts` and `ci-trigger.ts`.
 *
 * In its own module for the reason `MachineInput` is: two modules now decide
 * trigger outcomes, and a shape owned by the file one of them lives in is how an
 * import cycle starts.
 */
export interface TriggerOutcome {
  state: AgentState
  halt: RunResult | null
  /** Set when the trigger should be handled as a question rather than a phase. */
  answer: boolean
}

/**
 * A trigger that moved nothing.
 *
 * `reported` defaults to false because nearly every skip in the trigger layer is
 * deliberately silent — a red run on a settled pull request, a red run in a
 * phase with no branch to fix, an empty comment, a classification of `none`, an
 * already-reported CI budget. `refuseCommand` in `triggers.ts` is the one that
 * answers on the issue first, and passes `true`.
 *
 * That distinction is worth carrying even though a skipped run exits 0 and so
 * never reaches the workflow's fallback step. The flag means "this run posted",
 * full stop; a path where a comment exists and the flag says otherwise is
 * exactly the shape of the bug it was added to fix, and the next reader of the
 * flag will not know to check whether the status happened to make it moot.
 */
export const skip = (state: AgentState, reason: string, reported = false): RunResult => ({
  status: 'skipped',
  reason,
  state,
  reported,
})
