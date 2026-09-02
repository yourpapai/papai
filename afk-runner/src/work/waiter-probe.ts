// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { APPROVE_DIRECTIVE_RE, VETO_DIRECTIVE_RE, VETO_REDIRECT_DIRECTIVE_RE } from './gate-model.js'

export function digestOf(md: string): string {
  return createHash('sha256').update(md).digest('hex')
}

/**
 * Hand-edit stability guard (deadline-waiter copy): a gate file settles
 * through the waiter only when its content hash is unchanged for 3
 * consecutive ticks, guarding against non-atomic editor writes and
 * two-step edits being settled mid-edit.
 */
export function isStableEdit(digests: readonly string[]): boolean {
  if (digests.length < 3) return false
  const last = digests.slice(-3)
  return last.every((digest) => digest === last[0])
}

/** Whether a polled gate file parses as human-answered: a checked box, an answer section, or a decision directive (D1). */
export function looksAnswered(md: string): boolean {
  return (
    /-\s\[x\]\s*[AFT]\d+/u.test(md) ||
    md.includes('## Gate response') ||
    md
      .split('\n')
      .some(
        (line) =>
          APPROVE_DIRECTIVE_RE.test(line) || VETO_DIRECTIVE_RE.test(line) || VETO_REDIRECT_DIRECTIVE_RE.test(line),
      )
  )
}

/** The production tick: one second between polls. */
export function oneSecondTick(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 1_000)
  })
}
