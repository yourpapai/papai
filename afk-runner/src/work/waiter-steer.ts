// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { GateAnswers } from './gate-answers.js'

export interface SteerLanding {
  readonly kind: 'abort' | 'veto' | 'extend'
  readonly id?: string
  readonly redirect?: string
}

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
  const veto = first.match(/^veto\s+(\S+)=(.*)$/u)
  if (veto !== null) {
    return { kind: 'veto', id: veto[1], redirect: veto[2] }
  }
  return null
}

/** Steer taxonomy (deadline-waiter copy): extend-at-final is invalid and skipped with a warning; veto is invalid at escalation gates (C6 D6). */
export function translateSteer(
  directive: SteerLanding,
  gateMode: 'early' | 'final' | 'escalation',
): { readonly outcome: SteerLanding; readonly warn: string | null } {
  if (directive.kind === 'extend' && gateMode === 'final') {
    return { outcome: directive, warn: 'steer: extend is not valid at a final gate — skipped' }
  }
  if (directive.kind === 'veto' && gateMode === 'escalation') {
    return { outcome: directive, warn: 'steer: veto is not valid at an escalation gate — skipped' }
  }
  return { outcome: directive, warn: null }
}

export function steerAnswers(steer: SteerLanding): GateAnswers {
  if (steer.kind === 'abort') return { items: [], blockerAnswers: [], acks: [], decision: 'abort' }
  if (steer.kind === 'extend') return { items: [], blockerAnswers: [], acks: [], decision: 'extend' }
  return {
    items: [
      {
        kind: 'assumption',
        id: steer.id ?? '',
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
