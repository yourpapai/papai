// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The C6 declared-failure taxonomy (D1), one class per seam, extracted to
 * their own module so the co-location of class and seam does not fight
 * `max-classes-per-file` — the seams keep their behavior, the classifier
 * (`drive/failure-budget.ts`) keeps its closed set.
 */

/**
 * Declared failure kinds (C6 D1): `exhausted` — an objective validator
 * rejected the work after its in-work retries; `precondition` — a structural
 * dependency is missing and retry cannot help.
 */
export type StageHaltKind = 'exhausted' | 'precondition'

/** Halt carried by work modules when validation exhausts its attempts (legacy stage-machine copy; the bracket itself is loop mechanics). */
export class StageHaltError extends Error {
  constructor(
    message: string,
    readonly resumeHint?: string,
    readonly kind: StageHaltKind = 'exhausted',
  ) {
    super(message)
    this.name = 'StageHaltError'
  }
}

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

/**
 * Infra-kind transport failure (C6 D1): the agent could not be reached —
 * the child never launched. Everything else crossing the spawn seam stays
 * as it was: agent-level failures are results (the watchdogs decide), and
 * arbitrary errors from a custom spawn fn stay plain and crash-shaped.
 */
export class SpawnError extends Error {
  readonly kind = 'infra'

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SpawnError'
  }
}
