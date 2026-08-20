// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * TUI signal handling (calm-stop keys, deadline countdown, settle-claim
 * race): pure logic, no Ink — the screens render what these compute.
 */

export interface StopKeyState {
  readonly interruptions: number
}

export type StopKeyAction = { readonly kind: 'none' } | { readonly kind: 'calm-stop' } | { readonly kind: 'exit-130' }

const CTRL_C = '\u0003'

/**
 * `q` and the first Ctrl-C request a calm stop honored at the next stage or
 * round boundary; a second Ctrl-C before that boundary exits with 130.
 * `exitOnCtrlC` is false at the Ink render site — this reducer owns the key.
 */
export function reduceStopKey(
  state: StopKeyState,
  input: string,
): { readonly state: StopKeyState; readonly action: StopKeyAction } {
  if (input === CTRL_C) {
    const interruptions = state.interruptions + 1
    if (interruptions >= 2) return { state: { interruptions }, action: { kind: 'exit-130' } }
    return { state: { interruptions }, action: { kind: 'calm-stop' } }
  }
  if (input === 'q') return { state, action: { kind: 'calm-stop' } }
  return { state, action: { kind: 'none' } }
}

/** Remaining-time display for an armed gate deadline; null when unarmed. */
export function formatDeadlineRemaining(deadlineAt: string | null, now: number): string | null {
  if (deadlineAt === null) return null
  const remaining = Math.floor((Date.parse(deadlineAt) - now) / 1000)
  if (remaining <= 0) return 'deadline expired'
  const minutes = Math.floor(remaining / 60)
  if (minutes <= 0) return `${remaining}s to deadline`
  return `${minutes}m${remaining % 60}s to deadline`
}

export type SettleClaim = { readonly kind: 'claimed' } | { readonly kind: 'lost'; readonly writer: string }

function writerOfClaim(content: string): string {
  const first = content.split(/\s/u)[0] ?? ''
  return first.length === 0 ? 'unknown' : first
}

/**
 * First-writer-wins gate settlement claim (D10): the TUI write and the
 * deadline waiter's expiry both claim through this one exclusive-create
 * file per gate version; the loser is rejected as already-settled with the
 * winner named. The waiter's legacy `gate-<n>.expiry-claim` name counts as
 * the expiry writer's claim.
 */
export function claimGateSettlement(runDir: string, version: number, writer: string): SettleClaim {
  const claimPath = path.join(runDir, `gate-${version}.settle-claim`)
  const legacyPath = path.join(runDir, `gate-${version}.expiry-claim`)
  if (existsSync(claimPath)) return { kind: 'lost', writer: writerOfClaim(readFileSync(claimPath, 'utf8')) }
  if (existsSync(legacyPath)) return { kind: 'lost', writer: 'expiry' }
  try {
    writeFileSync(claimPath, `${writer} ${new Date().toISOString()}\n`, { flag: 'wx' })
  } catch {
    return { kind: 'lost', writer: writerOfClaim(readFileSync(claimPath, 'utf8')) }
  }
  return { kind: 'claimed' }
}
