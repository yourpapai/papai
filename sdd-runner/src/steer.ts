// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFileSync } from 'node:fs'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { parseSteerDirectives, StagedSteerSchema } from './review-loop.js'

/**
 * Pre-settle steer precedence (D3 step 0): immediately before any
 * auto-settle, check both the raw `steer.md` and the persisted staged set —
 * a queued `abort` or `veto` that arrived (at the last round boundary or
 * directly) takes precedence over the pending auto-decision.
 */
export function pendingSteerOverride(runDir: string): boolean {
  const steerPath = path.join(runDir, 'steer.md')
  try {
    const staged = readFileSync(path.join(runDir, 'steer.staged.json'), 'utf8')
    const parsed = StagedSteerSchema.safeParse(JSON.parse(staged))
    if (parsed.success) {
      return parsed.data.directives.some((d) => d.kind === 'abort' || d.kind === 'veto')
    }
  } catch {
    /* no staged set */
  }
  try {
    const raw = readFileSync(steerPath, 'utf8')
    return parseSteerDirectives(raw).valid.some((d) => d.kind === 'abort' || d.kind === 'veto')
  } catch {
    return false
  }
}

/**
 * Clear the staged set when its target gate settles (or a veto is orphaned
 * by an earlier auto-decision) — D6. The file stays (append-only posture)
 * but carries an empty directive set.
 */
export function clearStagedSteer(runDir: string): void {
  writeFileSync(path.join(runDir, 'steer.staged.json'), `${JSON.stringify({ directives: [] })}\n`)
}
