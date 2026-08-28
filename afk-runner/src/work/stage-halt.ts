// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

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
