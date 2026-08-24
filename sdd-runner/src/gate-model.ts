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
const DECIDED_BY_SUFFIX_RE = /\s*·\s*decided-by:\s*.+$/u
const DECIDED_BY_LINE_RE = /^\s*decided-by:\s*\S.*$/u
const PREVIEW_HEADER_RE = /^\s*###\s*Auto-decision preview\s*$/u
const HEADER_RE = /^\s*(?:##|###)\s+/u
const VETO_BOX_RE = /^\s*-\s*\[([^\]]+)\]\s*([AF]\d+)\b/u

/**
 * Strip the `### Auto-decision preview` section (from its header to the next
 * `## `/`### ` header or EOF) before processing, so a hand-mangled preview
 * can never become gate input — the parse-inert guarantee's second layer.
 */
function stripPreviewSection(markdown: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((line) => PREVIEW_HEADER_RE.test(line))
  if (start === -1) return markdown
  const end = lines.findIndex((line, index) => index > start && HEADER_RE.test(line))
  const kept = end === -1 ? lines.slice(0, start) : [...lines.slice(0, start), ...lines.slice(end)]
  return kept.join('\n')
}

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
  itemIds: Set<string>,
  blockerIds: Set<string>,
  gateMode: 'early' | 'final' | undefined,
): void {
  if (DECIDED_BY_LINE_RE.test(line)) return
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
  const stripped = stripPreviewSection(markdown)
  if (/^\s*ABORT\s*$/mu.test(stripped)) {
    return { approved: false, abort: true, override: false, extend: false, vetoes: [], answers: [] }
  }
  const lines = stripped.split('\n')
  const itemIds = new Set([...expected.assumptions.map((a) => a.id), ...(expected.findings ?? []).map((f) => f.id)])
  const blockerIds = new Set(expected.blockers.map((b) => b.id))
  const state: ParseState = {
    vetoes: [],
    answers: [],
    checked: new Set(),
    pendingRedirectFor: null,
    override: false,
    extend: false,
  }
  lines.forEach((line, index) => {
    processLine(state, line, index + 1, lines[index - 1] ?? '', itemIds, blockerIds, expected.gateMode)
  })
  return finalizeResponse(state, expected)
}
