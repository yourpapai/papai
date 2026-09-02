// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { APPROVE_DIRECTIVE_RE, VETO_DIRECTIVE_RE, VETO_REDIRECT_DIRECTIVE_RE } from './gate-model.js'
import type { ExpectedGateContent } from './gate-model.js'

const OVERRIDE_TOKEN = 'OVERRIDE'
const RUN_DIRECTIVE_RE = /^\s*→\s*RUN 1 MORE\s*$/u
const RUN_LIKE_RE = /^\s*→\s*RUN\b/u
const DECIDED_BY_SUFFIX_RE = /\s*·\s*decided-by:\s*.+$/u
const DECIDED_BY_LINE_RE = /^\s*decided-by:\s*\S.*$/u
const VETO_BOX_RE = /^\s*-\s*\[([^\]]+)\]\s*([AF]\d+)\b/u

/** The mutable line-accumulation state one response parse folds over. */
export interface ParseState {
  vetoes: { id: string; redirect?: string }[]
  answers: { id: string; answer: string }[]
  checked: Set<string>
  pendingRedirectFor: string | null
  override: boolean
  extend: boolean
  approve: boolean
  gateVeto: boolean
  gateVetoRedirect: string | null
}

export function emptyParseState(): ParseState {
  return {
    vetoes: [],
    answers: [],
    checked: new Set(),
    pendingRedirectFor: null,
    override: false,
    extend: false,
    approve: false,
    gateVeto: false,
    gateVetoRedirect: null,
  }
}

function classifyBox(mark: string): boolean | null {
  if (mark === '[x]' || mark === '[X]') return true
  if (mark === '[ ]') return false
  return null
}

function processVetoBox(state: ParseState, rawLine: string, lineNo: number, ids: Set<string>): boolean {
  const line = rawLine.replace(DECIDED_BY_SUFFIX_RE, '')
  const match = line.match(VETO_BOX_RE)
  if (match === null) return false
  const checked = classifyBox(`[${match[1] ?? ''}]`)
  if (checked === null) throw new Error(`gate response line ${lineNo}: ambiguous checkbox mark`)
  const id = match[2] ?? ''
  if (!ids.has(id)) {
    throw new Error(`gate response line ${lineNo}: unknown ${id.startsWith('A') ? 'assumption' : 'finding'} ${id}`)
  }
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
): void {
  if (RUN_DIRECTIVE_RE.test(line)) {
    // C5: the extend directive is valid at a final gate too — a human asking
    // for another round re-opens review and re-runs the tail (D3); the steer
    // surface keeps its own final-gate extend guard (waiter-level).
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
  // Blocker answers associate by membership (F-C2/D3): the candidate is the
  // previous line's first token and `blockerIds` decides — the same
  // membership gate boxes validate by, so a substituted row id
  // (POLICY-INTEGRITY) acknowledges exactly like a B-prefixed one when the
  // arrow sits beneath its id line.
  const candidate = prevLine.match(/^\s*(\S+)/u)?.[1] ?? ''
  if (blockerIds.has(candidate)) {
    state.answers.push({ id: candidate, answer: payload })
    return
  }
  throw new Error(`gate response line ${lineNo}: → line with no preceding assumption or blocker`)
}

export function processLine(
  state: ParseState,
  line: string,
  lineNo: number,
  prevLine: string,
  itemIds: Set<string>,
  blockerIds: Set<string>,
  _gateMode: 'early' | 'final' | 'escalation' | undefined,
): void {
  if (DECIDED_BY_LINE_RE.test(line)) return
  if (APPROVE_DIRECTIVE_RE.test(line)) {
    state.approve = true
    state.pendingRedirectFor = null
    return
  }
  const vetoRedirect = line.match(VETO_REDIRECT_DIRECTIVE_RE)
  if (vetoRedirect !== null || VETO_DIRECTIVE_RE.test(line)) {
    state.gateVeto = true
    state.gateVetoRedirect ??= vetoRedirect?.[1] ?? null
    state.pendingRedirectFor = null
    return
  }
  // Membership routing: a box belongs to this gate when its id was declared in
  // the expected content — never by id prefix, which a kind/id-mismatched item
  // (e.g. an F-prefixed id carried in the assumptions list) would misroute.
  if (processVetoBox(state, line, lineNo, itemIds)) return
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
    processArrowLine(state, line, lineNo, prevLine, (arrowMatch[1] ?? '').trim(), blockerIds)
    return
  }
  state.pendingRedirectFor = null
}

export function expectedItemIds(expected: ExpectedGateContent): Set<string> {
  return new Set([...expected.assumptions.map((a) => a.id), ...(expected.findings ?? []).map((f) => f.id)])
}

export function expectedBlockerIds(expected: ExpectedGateContent): Set<string> {
  return new Set(expected.blockers.map((b) => b.id))
}
