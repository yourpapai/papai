// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { GateAnswers } from './gate-answers.js'

export type SteerLanding =
  | { readonly kind: 'abort' | 'extend' }
  | { readonly kind: 'veto'; readonly id?: string; readonly redirect?: string }
  | { readonly kind: 'unknown'; readonly line: string }

export function peekSteer(runDir: string): SteerLanding | null {
  const steerPath = path.join(runDir, 'steer.md')
  if (!existsSync(steerPath)) return null
  const first = readFileSync(steerPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
  if (first === undefined) return null
  if (first === 'abort') return { kind: 'abort' }
  if (first === 'extend') return { kind: 'extend' }
  const itemVeto = first.match(/^veto\s+(\S+)=(.*)$/u)
  if (itemVeto !== null) {
    return { kind: 'veto', id: itemVeto[1], redirect: itemVeto[2] }
  }
  // D7: `veto` alone or `veto <text>` (no id= assignment) is the gate-level
  // veto; only `veto <id>=<redirect>` addresses an item.
  if (first === 'veto') return { kind: 'veto' }
  const gateVeto = first.match(/^veto(?::|\s)+(.*)$/u)
  if (gateVeto !== null) {
    const redirect = (gateVeto[1] ?? '').trim()
    return redirect === '' ? { kind: 'veto' } : { kind: 'veto', redirect }
  }
  return { kind: 'unknown', line: first }
}

/**
 * Steer taxonomy (deadline-waiter copy): extend-at-final is invalid and
 * skipped with a warning; veto is invalid at escalation gates (C6 D6); an
 * unparseable first line is consumed with a warning rather than left in
 * place unexamined (D7).
 */
export function translateSteer(
  directive: SteerLanding,
  gateMode: 'early' | 'final' | 'escalation',
): { readonly outcome: SteerLanding; readonly warn: string | null } {
  if (directive.kind === 'unknown') {
    return {
      outcome: directive,
      warn: `steer: unrecognized steer directive "${directive.line}" — consumed; expected abort, extend, or veto [<id>=]<redirect>`,
    }
  }
  if (directive.kind === 'extend' && gateMode === 'final') {
    return { outcome: directive, warn: 'steer: extend is not valid at a final gate — skipped' }
  }
  if (directive.kind === 'veto' && gateMode === 'escalation') {
    return { outcome: directive, warn: 'steer: veto is not valid at an escalation gate — skipped' }
  }
  return { outcome: directive, warn: null }
}

export function steerAnswers(steer: SteerLanding): GateAnswers {
  if (steer.kind === 'unknown') {
    // translateSteer always warns on unknown and the waiter consumes without
    // settling — reaching here is a caller bug, crash-shaped on purpose.
    throw new Error(`steerAnswers: unrecognized steer directive "${steer.line}"`)
  }
  if (steer.kind !== 'veto') {
    return { items: [], blockerAnswers: [], acks: [], decision: steer.kind === 'abort' ? 'abort' : 'extend' }
  }
  if (steer.id === undefined) {
    // Gate-level veto (D7): no item box, no synthetic id — the VETO directive
    // carries the redirect, and D1's precedence makes the trajectory ack moot.
    return {
      items: [],
      blockerAnswers: [],
      acks: [],
      decision: 'veto',
      ...(steer.redirect === undefined ? {} : { gateVetoRedirect: steer.redirect }),
    }
  }
  return {
    items: [
      {
        kind: 'assumption',
        id: steer.id,
        text: '',
        accepted: false,
        ...(steer.redirect === undefined ? {} : { redirect: steer.redirect }),
      },
    ],
    blockerAnswers: [],
    // The trajectory ack rides along checked — the parser accepts T-ids
    // unconditionally and a cap-hit gate requires it (desugarFlags parity).
    acks: [{ id: 'T1', text: 'I reviewed the trajectory and the open findings above' }],
    decision: 'veto',
  }
}
