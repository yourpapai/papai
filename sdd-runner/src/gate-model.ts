// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { formatTrajectoryBlock } from './renderer.js'
import type { DigestRecord } from './replay.js'

export type ArtifactHashes = Record<string, string>

export async function recordArtifactHashes(changeDir: string, relPaths: readonly string[]): Promise<ArtifactHashes> {
  const entries = await Promise.all(
    relPaths.map(async (rel): Promise<[string, string | null]> => {
      try {
        const content = await readFile(path.join(changeDir, rel), 'utf8')
        return [rel, createHash('sha256').update(content).digest('hex')]
      } catch {
        return [rel, null]
      }
    }),
  )
  const hashes: ArtifactHashes = {}
  for (const [rel, hash] of entries) {
    if (hash !== null) hashes[rel] = hash
  }
  return hashes
}

export function detectHandEdits(before: ArtifactHashes, after: ArtifactHashes): string[] {
  return Object.keys(after).filter((rel) => before[rel] !== after[rel])
}

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
  readonly trajectory: readonly DigestRecord[]
  readonly capHitFired: boolean
  readonly summary: string
  readonly costUsd: number
  readonly durationMs: number
}

export function writeGateDigest(input: GateDigestInput): string {
  const ranked = [...input.assumptions].sort((a, b) => b.blast_radius.localeCompare(a.blast_radius))
  const lines: string[] = [
    `<!-- gate-${input.version}.md -->`,
    '',
    input.mode === 'early'
      ? `## Early gate (cap hit) — change ${input.changeName}`
      : `## Final gate — change ${input.changeName}`,
    '',
    'Check every assumption box to approve. Leave a box unchecked to veto (optional `→ <redirect>` beneath).',
    'Answer a cap-hit blocker with `→ <answer>` beneath it, or `→ OVERRIDE` to override.',
    'Write `ABORT` on its own line to abort.',
    '',
    '### Summary',
    input.summary,
    '',
    `### Cost / duration · $${input.costUsd.toFixed(2)} · ${Math.round(input.durationMs / 1000)}s`,
  ]
  if (input.blockers.length > 0) {
    lines.push('', '### Cap-hit blockers (answer or override)')
    for (const blocker of input.blockers) {
      lines.push('', `${blocker.id} ${blocker.gap}`, `evidence: ${blocker.evidence}`, '→ <answer or OVERRIDE>')
    }
  }
  if (input.mode === 'early' && input.openMaterial.length > 0) {
    const trajectoryBlock = formatTrajectoryBlock(input.trajectory)
    if (trajectoryBlock !== '') {
      lines.push('', trajectoryBlock)
    }
    lines.push('', '### Open MATERIAL findings at cap (reviewed)')
    for (const finding of input.openMaterial) {
      lines.push('', `- [ ] ${finding.id} ${finding.gap}`, `  resolver: ${finding.evidence}`)
    }
  }
  if (input.mode === 'early' && input.blockers.length === 0 && input.capHitFired) {
    lines.push('', '### Trajectory reviewed', '', '- [ ] T1 I reviewed the trajectory and the open findings above')
  }
  lines.push('', '### Assumptions (blast-ranked)')
  for (const assumption of ranked) {
    lines.push('', `- [ ] ${assumption.id} ${assumption.text}`, `  blast radius: ${assumption.blast_radius}`)
  }
  lines.push('', '### Resume', `gate resume ${input.runId}`)
  return lines.join('\n')
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
  readonly vetoes: readonly GateVeto[]
  readonly answers: readonly GateAnswer[]
}

export interface ExpectedGateContent {
  readonly assumptions: readonly GateAssumption[]
  readonly blockers: readonly GateBlocker[]
  readonly requiredAck?: string
}

const OVERRIDE_TOKEN = 'OVERRIDE'

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
}

function processLine(
  state: ParseState,
  line: string,
  lineNo: number,
  prevLine: string,
  assumptionIds: Set<string>,
  blockerIds: Set<string>,
): void {
  const boxMatch = line.match(/^\s*-\s*\[([^\]]+)\]\s*(A\d+)\b/u)
  if (boxMatch !== null) {
    const checked = classifyBox(`[${boxMatch[1] ?? ''}]`)
    if (checked === null) throw new Error(`gate response line ${lineNo}: ambiguous checkbox mark`)
    const id = boxMatch[2] ?? ''
    if (!assumptionIds.has(id)) throw new Error(`gate response line ${lineNo}: unknown assumption ${id}`)
    if (checked) state.checked.add(id)
    else state.vetoes.push({ id })
    state.pendingRedirectFor = checked ? null : id
    return
  }
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
    const payload = (arrowMatch[1] ?? '').trim()
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
  state.pendingRedirectFor = null
}

function finalizeResponse(state: ParseState, expected: ExpectedGateContent): GateResponse {
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
  return { approved, abort: false, override: state.override, vetoes: state.vetoes, answers: state.answers }
}

export function parseGateResponse(markdown: string, expected: ExpectedGateContent): GateResponse {
  if (/^\s*ABORT\s*$/mu.test(markdown)) {
    return { approved: false, abort: true, override: false, vetoes: [], answers: [] }
  }
  const lines = markdown.split('\n')
  const assumptionIds = new Set(expected.assumptions.map((a) => a.id))
  const blockerIds = new Set(expected.blockers.map((b) => b.id))
  const state: ParseState = { vetoes: [], answers: [], checked: new Set(), pendingRedirectFor: null, override: false }
  lines.forEach((line, index) => {
    processLine(state, line, index + 1, lines[index - 1] ?? '', assumptionIds, blockerIds)
  })
  return finalizeResponse(state, expected)
}
