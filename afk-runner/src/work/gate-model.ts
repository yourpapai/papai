// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { DigestRecord } from '../legacy-fold.js'
import type { ChangeDigest } from './gate-digest-extract.js'
import { emptyParseState, expectedBlockerIds, expectedItemIds, processLine } from './gate-parse-lines.js'
import type { ParseState } from './gate-parse-lines.js'
import { stripPreviewSection } from './gate-preview.js'

export { renderChangeDigest, writeGateDigest } from './gate-render.js'

/** Own-line decision directives (D1) — shared by parse, render, and the waiter's answered-look probe so the grammar cannot drift. */
export const APPROVE_DIRECTIVE = 'APPROVE'
export const VETO_DIRECTIVE = 'VETO'
export const APPROVE_DIRECTIVE_RE = /^\s*APPROVE\s*$/u
export const VETO_DIRECTIVE_RE = /^\s*VETO\s*$/u
export const VETO_REDIRECT_DIRECTIVE_RE = /^\s*VETO:\s*(\S.*?)\s*$/u

export interface GateAssumption {
  readonly id: string
  readonly text: string
  readonly blast_radius: string
  /** Recorded per-assumption file evidence from the resolver sidecar (R3). */
  readonly evidence?: { readonly files: readonly string[] }
}

export interface GateBlocker {
  readonly id: string
  readonly gap: string
  readonly evidence: string
}

export type GateFinding = GateBlocker

export interface GateDigestInput {
  readonly version: number
  readonly mode: 'early' | 'final'
  readonly changeName: string
  readonly runId: string
  readonly assumptions: readonly GateAssumption[]
  readonly blockers: readonly GateBlocker[]
  readonly openMaterial: readonly GateFinding[]
  readonly openNitpicks: readonly GateFinding[]
  readonly trajectory: readonly DigestRecord[]
  readonly capHitFired: boolean
  readonly summary: string
  readonly costUsd: number
  readonly costKnown: boolean
  readonly durationMs: number
  readonly changeDigest: ChangeDigest
}

export interface GateVeto {
  readonly id: string
  readonly redirect?: string
}

export interface GateAnswer {
  readonly id: string
  readonly answer: string
}

export interface GateResponse {
  readonly approved: boolean
  readonly abort: boolean
  readonly override: boolean
  readonly extend: boolean
  readonly vetoes: readonly GateVeto[]
  readonly answers: readonly GateAnswer[]
  /**
   * Whole-gate veto redirect (D1): `null` — no gate-level veto; `''` — a
   * bare `VETO` (the revision round runs with an explicit no-redirect
   * instruction); any other string — the `VETO: <redirect>` payload kept
   * for the revision round.
   */
  readonly gateVetoRedirect: string | null
}

export interface ExpectedGateContent {
  readonly assumptions: readonly GateAssumption[]
  readonly blockers: readonly GateBlocker[]
  readonly findings?: readonly GateFinding[]
  readonly requiredAck?: string
  /**
   * Gate presentation mode. The `→ RUN 1 MORE` extend directive is accepted
   * only at an early (cap-hit) gate; at a final gate (or when unspecified) it
   * is rejected with a clear error.
   */
  readonly gateMode?: 'early' | 'final' | 'escalation'
}

/** The gate-level veto branch (D1 precedence): wholesale rejection owes no ack and no per-item accounting. */
function gateVetoResponse(state: ParseState, expected: ExpectedGateContent): GateResponse {
  // Veto is not expressible at an escalation gate, whose only outcomes are
  // retry, extend, and abort.
  if (expected.gateMode === 'escalation') {
    throw new Error(
      'gate response: veto is not valid at an escalation gate — approve retries, extend clears the ledger, abort ends',
    )
  }
  return {
    approved: false,
    abort: false,
    override: false,
    extend: false,
    vetoes: [],
    answers: [],
    gateVetoRedirect: state.gateVetoRedirect ?? '',
  }
}

/** Zero-signal trap (D1): an item-less gate must never settle prose as approve — the vacuous all-checked computation is exactly what this guard turns into a rejection. Unreachable at item-carrying gates by construction: the presentation's own boxes are the signal. */
function assertDecisionSignal(state: ParseState): void {
  if (
    !state.approve &&
    state.checked.size === 0 &&
    state.vetoes.length === 0 &&
    state.answers.length === 0 &&
    !state.override
  ) {
    throw new Error(
      'gate response: no decision signal — write APPROVE or VETO: <redirect> on its own line (ABORT and → RUN 1 MORE also apply), or answer the presented items',
    )
  }
}

function finalizeResponse(state: ParseState, expected: ExpectedGateContent): GateResponse {
  if (state.gateVeto) return gateVetoResponse(state, expected)
  if (state.extend) {
    return {
      approved: false,
      abort: false,
      override: false,
      extend: true,
      vetoes: [],
      answers: [],
      gateVetoRedirect: null,
    }
  }
  if (expected.requiredAck !== undefined && !state.checked.has(expected.requiredAck)) {
    throw new Error(
      `gate response: required ack ${expected.requiredAck} not checked — check the trajectory-reviewed box to proceed`,
    )
  }
  if (state.approve && state.vetoes.length > 0) {
    // APPROVE contradicted by an explicitly unchecked box (D1): boxes stay
    // authoritative at item-carrying gates — the contradiction is rejected
    // rather than silently resolved either way.
    throw new Error(
      `gate response: APPROVE with unchecked items ${state.vetoes.map((veto) => veto.id).join(', ')} — check each box or veto instead`,
    )
  }
  const checkedAll = expected.assumptions.every((a) => state.checked.has(a.id))
  const answered = new Set(state.answers.map((a) => a.id))
  const unanswered = expected.blockers.filter((b) => !answered.has(b.id) && !state.override)
  if (checkedAll && unanswered.length > 0) {
    throw new Error(
      `gate response: approved with open blockers ${unanswered.map((b) => b.id).join(', ')} — answer each with → <answer> or → OVERRIDE`,
    )
  }
  assertDecisionSignal(state)
  const approved = checkedAll && unanswered.length === 0 && state.vetoes.length === 0
  return {
    approved,
    abort: false,
    override: state.override,
    extend: false,
    vetoes: state.vetoes,
    answers: state.answers,
    gateVetoRedirect: null,
  }
}

export function parseGateResponse(markdown: string, expected: ExpectedGateContent): GateResponse {
  const stripped = stripPreviewSection(markdown)
  if (/^\s*ABORT\s*$/mu.test(stripped)) {
    return {
      approved: false,
      abort: true,
      override: false,
      extend: false,
      vetoes: [],
      answers: [],
      gateVetoRedirect: null,
    }
  }
  const lines = stripped.split('\n')
  const state = emptyParseState()
  lines.forEach((line, index) => {
    processLine(
      state,
      line,
      index + 1,
      lines[index - 1] ?? '',
      expectedItemIds(expected),
      expectedBlockerIds(expected),
      expected.gateMode,
    )
  })
  return finalizeResponse(state, expected)
}
