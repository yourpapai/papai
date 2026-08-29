// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface SettleClaim {
  readonly claimed: boolean
  readonly winner: string | null
}

function holderOf(claimPath: string): string | null {
  try {
    return readFileSync(claimPath, 'utf8').trim()
  } catch {
    return null
  }
}

const WAITER_PID_CLAIM_RE = /^waiter-(\d+)$/u

/**
 * A crashed waiter leaves its claim behind with no release path — the pid is
 * the liveness signal. Only pid-shaped waiter claims are stealable; anything
 * else (legacy expiry-claim timestamps, foreign formats) is honored as held.
 * EPERM means the pid exists but is not ours: alive, not stealable.
 */
function namesDeadWaiter(winner: string): boolean {
  const match = winner.match(WAITER_PID_CLAIM_RE)
  if (match === null) return false
  try {
    process.kill(Number(match[1]), 0)
    return false
  } catch (error) {
    return (
      error !== null && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ESRCH'
    )
  }
}

/**
 * First-writer-wins settle claim (design D5/D10): cross-process arbitration
 * for concurrent settlers of one gate version — an exclusive-create
 * `gate-<n>.settle-claim` artifact whose content names the claimant. The
 * legacy `gate-<n>.expiry-claim` name counts as a held claim. Claims are
 * edge IPC, never truth: the appended settle events are.
 */
export function claimGateSettle(runDir: string, version: number, claimant: string): SettleClaim {
  const legacyWinner = holderOf(path.join(runDir, `gate-${version}.expiry-claim`))
  if (legacyWinner !== null) return { claimed: false, winner: legacyWinner }
  const claimPath = path.join(runDir, `gate-${version}.settle-claim`)
  const existing = holderOf(claimPath)
  if (existing !== null && namesDeadWaiter(existing)) {
    writeFileSync(claimPath, `${claimant}\n`, { flag: 'w' })
    return { claimed: true, winner: claimant }
  }
  if (existing !== null) return { claimed: false, winner: existing }
  try {
    writeFileSync(claimPath, `${claimant}\n`, { flag: 'wx' })
  } catch {
    return { claimed: false, winner: holderOf(claimPath) }
  }
  return { claimed: true, winner: claimant }
}
