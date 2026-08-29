// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The C6 declared-failure taxonomy (D1), one home per class — the classifier
 * (`drive/failure-budget.ts`) consumes this closed set. The classes keep
 * their seam homes (`StageHaltError` in work/stage-halt, `SpawnError` in
 * agent-seam); `max-classes-per-file` is satisfied by extraction, and this
 * module is the one import surface for the taxonomy.
 */

export { StageHaltError, type StageHaltKind } from './work/stage-halt.js'
export { SpawnError } from './agent-seam.js'

/**
 * Schema-validation exhaustion (C6 D1): the objective output validator
 * rejected the agent's sidecar after its in-work retries — a declared
 * `exhausted` failure, not a crash (a StageHalt in disguise).
 */
export class AgentValidationError extends Error {
  readonly kind = 'exhausted'

  constructor(message: string) {
    super(message)
    this.name = 'AgentValidationError'
  }
}
