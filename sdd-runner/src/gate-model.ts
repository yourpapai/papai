// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChangeDigest } from './gate-digest-extract.js'
import type { DigestRecord } from './replay.js'

export { renderChangeDigest, writeGateDigest } from './gate-render.js'

export interface GateAssumption {
  readonly id: string
  readonly text: string
  readonly blast_radius: string
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
  readonly gateMode?: 'early' | 'final'
}

const OVERRIDE_TOKEN = 'OVERRIDE'
const RUN_DIRECTIVE_RE = /^\s*→\s*RUN 1 MORE\s*$/u
const RUN_LIKE_RE = /^\s*→\s*RUN\b/u

function classifyBox(mark: string): boolean | null {
  if (mark === '[x]' || mark === '[X]') return true
  if (mark === '[ ]') return false
  return null
}

interface ParseState {
  vetoes: { id: string; redirect?: string }[]
  answers: { id: string; answer: string }[]
  checked: Set<string>
  pendingRedirectFor: string | null
  override: boolean
  extend: boolean
}

function processVetoBox(
  state: ParseState,
  line: string,
  lineNo: number,
  regex: RegExp,
  ids: Set<string>,
  label: string,
): boolean {
  const match = line.match(regex)
  if (match === null) return false
  const checked = classifyBox(`[${match[1] ?? ''}]`)
  if (checked === null) throw new Error(`gate response line ${lineNo}: ambiguous checkbox mark`)
  const id = match[2] ?? ''
  if (!ids.has(id)) throw new Error(`gate response line ${lineNo}: unknown ${label} ${id}`)
  if (checked) state.checked.add(id)
  else state.vetoes.push({ id })
  state.pendingRedirectFor = checked ? null : id
  return true
}

function processArrowLine(
  state: ParseState,
  line: string,
  lineNo: number,
  prevLine: string,
  payload: string,
  blockerIds: Set<string>,
  gateMode: 'early' | 'final' | undefined,
): void {
  if (RUN_DIRECTIVE_RE.test(line)) {
    if (gateMode !== 'early') {
      throw new Error(`gate response line ${lineNo}: → RUN 1 MORE is not valid at a final gate (cap-hit only)`)
    }
    state.extend = true
    return
  }
  if (RUN_LIKE_RE.test(line)) {
    throw new Error(`gate response line ${lineNo}: → RUN directive not recognized (only "→ RUN 1 MORE" is accepted)`)
  }
  if (payload === OVERRIDE_TOKEN) {
    state.override = true
    return
  }
  if (state.pendingRedirectFor !== null) {
    const last = state.vetoes[state.vetoes.length - 1]
    if (last !== undefined && last.id === state.pendingRedirectFor) last.redirect = payload
    state.pendingRedirectFor = null
    return
  }
  const blockerId = prevLine.match(/^\s*(B\d+)\b/u)?.[1] ?? ''
  if (blockerIds.has(blockerId)) {
    state.answers.push({ id: blockerId, answer: payload })
    return
  }
  throw new Error(`gate response line ${lineNo}: → line with no preceding assumption or blocker`)
}

function processLine(
  state: ParseState,
  line: string,
  lineNo: number,
  prevLine: string,
  assumptionIds: Set<string>,
  blockerIds: Set<string>,
  findingIds: Set<string>,
  gateMode: 'early' | 'final' | undefined,
): void {
  if (processVetoBox(state, line, lineNo, /^\s*-\s*\[([^\]]+)\]\s*(A\d+)\b/u, assumptionIds, 'assumption')) return
  if (processVetoBox(state, line, lineNo, /^\s*-\s*\[([^\]]+)\]\s*(F\d+)\b/u, findingIds, 'finding')) return
  const ackMatch = line.match(/^\s*-\s*\[([^\]]+)\]\s*(T\d+)\b/u)
  if (ackMatch !== null) {
    const checked = classifyBox(`[${ackMatch[1] ?? ''}]`)
    if (checked === null) throw new Error(`gate response line ${lineNo}: ambiguous checkbox mark`)
    const id = ackMatch[2] ?? ''
    if (checked) state.checked.add(id)
    return
  }
  const arrowMatch = line.match(/^\s*→\s*(.+)$/u)
  if (arrowMatch !== null) {
    processArrowLine(state, line, lineNo, prevLine, (arrowMatch[1] ?? '').trim(), blockerIds, gateMode)
    return
  }
  state.pendingRedirectFor = null
}

function finalizeResponse(state: ParseState, expected: ExpectedGateContent): GateResponse {
  if (state.extend) {
    return { approved: false, abort: false, override: false, extend: true, vetoes: [], answers: [] }
  }
  if (expected.requiredAck !== undefined && !state.checked.has(expected.requiredAck)) {
    throw new Error(
      `gate response: required ack ${expected.requiredAck} not checked — check the trajectory-reviewed box to proceed`,
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
  const approved = checkedAll && unanswered.length === 0 && state.vetoes.length === 0
  return {
    approved,
    abort: false,
    override: state.override,
    extend: false,
    vetoes: state.vetoes,
    answers: state.answers,
  }
}

export function parseGateResponse(markdown: string, expected: ExpectedGateContent): GateResponse {
  if (/^\s*ABORT\s*$/mu.test(markdown)) {
    return { approved: false, abort: true, override: false, extend: false, vetoes: [], answers: [] }
  }
  const lines = markdown.split('\n')
  const assumptionIds = new Set(expected.assumptions.map((a) => a.id))
  const blockerIds = new Set(expected.blockers.map((b) => b.id))
  const findingIds = new Set((expected.findings ?? []).map((f) => f.id))
  const state: ParseState = {
    vetoes: [],
    answers: [],
    checked: new Set(),
    pendingRedirectFor: null,
    override: false,
    extend: false,
  }
  lines.forEach((line, index) => {
    processLine(
      state,
      line,
      index + 1,
      lines[index - 1] ?? '',
      assumptionIds,
      blockerIds,
      findingIds,
      expected.gateMode,
    )
  })
  return finalizeResponse(state, expected)
}
