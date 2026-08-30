// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import type { PolicyDecision } from './auto-policy.js'
import { appendEvent } from './events.js'
import { logPathFor } from './gate-digest.js'
import { loadRunState, saveRunState } from './run-state.js'
import type { RunState } from './run-state.js'

export type ExpiryClaimOutcome = 'claimed-and-settled' | 'claimed-rearmed' | 'claimed-stay-pending' | 'lost-claim'

export function digestOf(md: string): string {
  return createHash('sha256').update(md).digest('hex')
}

interface ExpiryDecisionRecord {
  readonly rule: PolicyDecision['rule']
  readonly decision: 'approve' | 'extend' | 'pending'
  readonly evidenceDigest: string
}

function emitExpiryDecision(state: RunState, version: number, record: ExpiryDecisionRecord): void {
  appendEvent(logPathFor(state), {
    altitude: 'L2',
    type: 'auto_decision',
    rule: record.rule,
    decision: record.decision,
    evidenceDigest: record.evidenceDigest,
    gateVersion: version,
  })
}

/**
 * Deadline expiry handling (D11 / 12.3): reload state immediately before any
 * write, claim the gate via exclusive-create `gate-<n>.expiry-claim` (loser
 * exits), and re-arm at most once (`gateDeadlineReArmed` persisted before the
 * re-armed deadline is written). Never auto-aborts: with no conservative
 * branch available the gate stays pending; after one re-arm it stays pending
 * indefinitely. The claim file remains as an append-only audit artifact.
 * Every claimed outcome appends the standard `auto_decision` L2 event after
 * its settle/state write — settle names the deciding rule, re-arm and
 * stay-pending record `none`/`pending` — so replay alone distinguishes
 * waiter-settled gates from human-settled ones (which emit nothing).
 */
export async function processExpiry(
  workDir: string,
  runId: string,
  reArmMinutes: number,
  trySettle: (state: RunState) => Promise<PolicyDecision | null>,
): Promise<ExpiryClaimOutcome> {
  const state = await loadRunState(workDir, runId)
  const version = state.gate?.version
  if (state.gate === null || version === undefined || state.gateDeadlineAt === null) {
    return 'lost-claim'
  }
  const claimPath = path.join(state.runDir, `gate-${version}.expiry-claim`)
  try {
    writeFileSync(claimPath, `${new Date().toISOString()}\n`, { flag: 'wx' })
  } catch {
    return 'lost-claim'
  }
  const decision = await trySettle(state)
  if (decision !== null) {
    emitExpiryDecision(state, version, {
      rule: decision.rule,
      decision: decision.action === 'extend' ? 'extend' : 'approve',
      evidenceDigest: decision.evidenceDigest,
    })
    return 'claimed-and-settled'
  }
  if (state.gateDeadlineReArmed) {
    emitExpiryDecision(state, version, pendingRecord(version))
    return 'claimed-stay-pending'
  }
  state.gateDeadlineReArmed = true
  state.gateDeadlineAt = new Date(Date.now() + reArmMinutes * 60_000).toISOString()
  await saveRunState(state)
  emitExpiryDecision(state, version, pendingRecord(version))
  return 'claimed-rearmed'
}

function pendingRecord(version: number): ExpiryDecisionRecord {
  return { rule: 'none', decision: 'pending', evidenceDigest: digestOf(`expiry-pending:${version}`) }
}
