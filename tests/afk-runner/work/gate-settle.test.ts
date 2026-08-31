// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { EventInput, SddEvent } from '../../../afk-runner/src/events.js'
import { stampEvent } from '../../../afk-runner/src/events.js'
import { pipelineMachine } from '../../../afk-runner/src/graph/pipeline.js'
import { foldEvents } from '../../../afk-runner/src/kernel/fold.js'
import type { GateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { renderGateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { presentGate } from '../../../afk-runner/src/work/gate-files.js'
import type { ExpectedGateContent } from '../../../afk-runner/src/work/gate-model.js'
import { settleGateFile, settleGateWithAnswers } from '../../../afk-runner/src/work/gate-settle.js'
import type { SettleFileResult, SettleInput, SettleResult } from '../../../afk-runner/src/work/gate-settle.js'
import { expectedContentFor, readReviewResultFromSidecars } from '../../../afk-runner/src/work/gate-settle.js'

const NULL_DIGEST = { what: null, why: null, touches: null, hasTasks: false }

/** Narrow a settle result to its settled shape — throws (failing the test) on a rejection. */
function settledOf(result: SettleFileResult): SettleResult {
  if ('kind' in result) throw new Error(`expected a settled result, got rejection: ${result.reason}`)
  return result
}

/** Narrow a settle result to its rejected shape — throws (failing the test) on a settle. */
function rejectionOf(result: SettleFileResult): { readonly reason: string } {
  if (!('kind' in result)) throw new Error('expected a rejection, got a settled result')
  return result
}

const EXPECTED: ExpectedGateContent = {
  assumptions: [{ id: 'A1', text: 'guests stay read-only', blast_radius: 'group replies' }],
  blockers: [{ id: 'B1', gap: 'B1', evidence: 'searched design.md' }],
  gateMode: 'early',
}

interface Harness {
  readonly runDir: string
  readonly changeDir: string
  readonly appended: EventInput[]
  readonly settleWith: (answers: GateAnswers) => ReturnType<typeof settleGateWithAnswers>
  readonly settleFile: () => ReturnType<typeof settleGateFile>
  readonly log: () => SddEvent[]
}

async function makePresentedGate(): Promise<Harness> {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-settle-'))
  const changeDir = path.join(runDir, 'change')
  fs.mkdirSync(path.join(changeDir, 'specs'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), 'hello')
  const appended: EventInput[] = []
  const emit = (event: EventInput): void => {
    appended.push(event)
  }
  await presentGate(
    { emit, runDir, changeDir, driftCheck: () => Promise.resolve() },
    {
      version: 1,
      mode: 'early',
      changeName: 'add-thing',
      runId: 'run-1',
      assumptions: [{ id: 'A1', text: 'guests stay read-only', blast_radius: 'group replies' }],
      blockers: [{ id: 'B1', gap: 'B1', evidence: 'searched design.md' }],
      openMaterial: [],
      openNitpicks: [],
      trajectory: [],
      capHitFired: true,
      summary: 'add-thing',
      costUsd: 0,
      costKnown: false,
      durationMs: 0,
      changeDigest: NULL_DIGEST,
    },
  )
  const input: SettleInput = {
    gate: { emit, runDir, changeDir, driftCheck: (): Promise<void> => Promise.resolve() },
    version: 1,
    gateMode: 'early',
    expected: EXPECTED,
    round: { current: 4, cap: 4 },
  }
  const PRELUDE: readonly EventInput[] = [
    { altitude: 'L2', type: 'stage_enter', stage: 'intake' },
    { altitude: 'L2', type: 'stage_exit', stage: 'intake' },
    { altitude: 'L2', type: 'stage_enter', stage: 'draft' },
    { altitude: 'L2', type: 'stage_exit', stage: 'draft' },
    { altitude: 'L2', type: 'stage_enter', stage: 'review' },
    { altitude: 'L2', type: 'stage_exit', stage: 'review' },
  ]
  const stamp = (events: readonly EventInput[]): SddEvent[] =>
    [...PRELUDE, ...events].map((event, index) => stampEvent(event, index + 1, '2026-08-27T00:00:00.000Z'))
  return {
    runDir,
    changeDir,
    appended,
    settleWith: (answers) => settleGateWithAnswers(input, answers),
    settleFile: () => settleGateFile(input),
    log: () => stamp(appended),
  }
}

const APPROVE: GateAnswers = {
  items: [{ kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true }],
  blockerAnswers: [{ id: 'B1', gap: 'B1', answer: 'ship and track in a follow-up' }],
  acks: [],
  decision: 'approve',
}

describe('settle seam — answers render, parse back, verify, append', () => {
  it('approve answers append answered(outcome=approve) plus the stage_enter(decompose) mover', async () => {
    const h = await makePresentedGate()
    const result = await h.settleWith(APPROVE)
    expect(result.outcome).toBe('approve')
    const events = h.log()
    expect(events.at(-2)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'approve' })
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'decompose' })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('decompose')
    expect(folded.context.gate).toEqual({ mode: 'early', version: 1, answered: true })
  })

  it('extend answers append answered(outcome=extend) plus the round_open(n+1, cap+1) mover', async () => {
    const h = await makePresentedGate()
    const result = await h.settleWith({ items: [], blockerAnswers: [], acks: [], decision: 'extend' })
    expect(result.outcome).toBe('extend')
    const events = h.log()
    expect(events.at(-2)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'extend', mode: 'early' })
    expect(events.at(-1)).toMatchObject({ type: 'round_open', round: 5, cap: 5 })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('review')
    expect(folded.context.round).toEqual({ current: 5, cap: 5 })
  })

  it('veto answers append answered(outcome=veto) plus the stage_enter(draft) mover', async () => {
    const h = await makePresentedGate()
    const result = await h.settleWith({
      items: [{ kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: false, redirect: 'dm-only' }],
      blockerAnswers: [],
      acks: [],
      decision: 'veto',
    })
    expect(result.outcome).toBe('veto')
    expect(result.vetoes).toEqual([{ id: 'A1', redirect: 'dm-only' }])
    const events = h.log()
    expect(events.at(-2)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'veto', mode: 'final' })
    expect(events.at(-1)).toMatchObject({ type: 'stage_enter', stage: 'draft' })
    expect(foldEvents(pipelineMachine, events).snapshot.value).toBe('draft')
  })

  it('abort answers append answered(outcome=abort) with no mover and reach the aborted final', async () => {
    const h = await makePresentedGate()
    const result = await h.settleWith({ items: [], blockerAnswers: [], acks: [], decision: 'abort' })
    expect(result.outcome).toBe('abort')
    const events = h.log()
    expect(events.at(-1)).toMatchObject({ type: 'gate', action: 'answered', outcome: 'abort', mode: 'final' })
    const folded = foldEvents(pipelineMachine, events).snapshot
    expect(folded.value).toBe('aborted')
    expect(folded.status).toBe('done')
  })

  it('answers written by the seam parse back: the gate file records the rendered response', async () => {
    const h = await makePresentedGate()
    await h.settleWith(APPROVE)
    const md = fs.readFileSync(path.join(h.runDir, 'gate-1.md'), 'utf8')
    expect(md).toContain('## Gate response')
    expect(md).toContain('- [x] A1')
    expect(md).toContain('→ ship and track in a follow-up')
  })

  it('a hand-edited gate file settles through the same path (settleGateFile)', async () => {
    const h = await makePresentedGate()
    const answers: GateAnswers = {
      items: [{ kind: 'assumption', id: 'A1', text: 'guests stay read-only', accepted: true }],
      blockerAnswers: [{ id: 'B1', gap: 'B1', answer: 'OVERRIDE' }],
      acks: [],
      decision: 'approve',
    }
    fs.writeFileSync(path.join(h.runDir, 'gate-1.md'), renderGateAnswers(answers))
    const result = settledOf(await h.settleFile())
    expect(result.outcome).toBe('approve')
    expect(h.appended.length).toBeGreaterThan(0)
  })

  it('an unparseable response appends nothing and returns the contained rejection (D3)', async () => {
    const h = await makePresentedGate()
    const before = h.appended.length
    fs.writeFileSync(path.join(h.runDir, 'gate-1.md'), '## Gate response\n\n- [x] A9 never declared\n')
    const result = await h.settleFile()
    expect(result).toMatchObject({ kind: 'rejected' })
    expect(rejectionOf(result).reason).toMatch(/unknown assumption A9/u)
    expect(h.appended.length).toBe(before)
  })

  it('an artifact edit during awaiting is detected at settle (integrity emits human_edits)', async () => {
    const h = await makePresentedGate()
    fs.writeFileSync(path.join(h.changeDir, 'proposal.md'), 'hand edited')
    const result = await h.settleWith(APPROVE)
    expect(result.outcome).toBe('approve')
    expect(h.log().some((event) => event.type === 'human_edits')).toBe(true)
  })
})

describe('readReviewResultFromSidecars applies the openness predicate', () => {
  function seed(round: number, resolutions: unknown[], assumptions: unknown[] = []): string {
    const sidecarDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-settle-rd-'))
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(
      path.join(sidecarDir, `resolutions-${String(round)}.json`),
      JSON.stringify({ resolutions, assumptions }),
    )
    return sidecarDir
  }

  function seedDigests(sidecarDir: string, round: number, digests: Record<string, string>): void {
    fs.writeFileSync(path.join(sidecarDir, `round-hashes-${String(round)}.json`), JSON.stringify(digests))
  }

  const assumption = {
    id: 'A1',
    text: 'thing holds',
    basis: 'default',
    confidence: 'medium',
    blast_radius: 'one reply',
    status: 'open',
    evidence: { files: ['openspec/changes/thing/proposal.md'] },
  }

  it('closes an edited finding whose round moved the change folder', async () => {
    const sidecarDir = seed(2, [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed' }])
    seedDigests(sidecarDir, 1, { 'proposal.md': 'aaa' })
    seedDigests(sidecarDir, 2, { 'proposal.md': 'bbb' })
    const result = await readReviewResultFromSidecars(sidecarDir, 2, 'cap-hit')
    expect(result.openMaterial).toEqual([])
    expect(result.raised).toEqual({ blocker: 0, material: 1, nitpick: 0 })
  })

  it('keeps an edited finding open when the change folder did not move', async () => {
    const sidecarDir = seed(2, [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed' }])
    seedDigests(sidecarDir, 1, { 'proposal.md': 'aaa' })
    seedDigests(sidecarDir, 2, { 'proposal.md': 'aaa' })
    const result = await readReviewResultFromSidecars(sidecarDir, 2, 'cap-hit')
    expect(result.openMaterial.map((r) => r.id)).toEqual(['F1'])
  })

  it('keeps a dismissed finding open regardless of digests', async () => {
    const sidecarDir = seed(2, [
      { id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'out of scope' },
    ])
    seedDigests(sidecarDir, 1, { 'proposal.md': 'aaa' })
    seedDigests(sidecarDir, 2, { 'proposal.md': 'bbb' })
    const result = await readReviewResultFromSidecars(sidecarDir, 2, 'cap-hit')
    expect(result.openMaterial.map((r) => r.id)).toEqual(['F1'])
  })

  it('closes an assumed finding backed by a linked assumption and opens an unbacked one', async () => {
    const sidecarDir = seed(
      2,
      [
        { id: 'F1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' },
        { id: 'F2', class: 'MATERIAL', resolution: 'assumed', outcome: 'defaulted too' },
      ],
      [{ ...assumption, findingId: 'F1' }],
    )
    const result = await readReviewResultFromSidecars(sidecarDir, 2, 'cap-hit')
    expect(result.openBlockers).toEqual([])
    expect(result.openMaterial.map((r) => r.id)).toEqual(['F2'])
  })

  it('closes an assumed finding under the legacy fallback when the sidecar predates findingId', async () => {
    const sidecarDir = seed(
      2,
      [{ id: 'F1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' }],
      [assumption],
    )
    const result = await readReviewResultFromSidecars(sidecarDir, 2, 'converged')
    expect(result.openBlockers).toEqual([])
  })

  it('reads a pre-change run with no recorded digests exactly as before', async () => {
    // No round-hashes sidecars at all: the edited claim is taken at face value,
    // the same reading that run's own event log recorded.
    const sidecarDir = seed(2, [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed' }])
    const result = await readReviewResultFromSidecars(sidecarDir, 2, 'cap-hit')
    expect(result.openMaterial).toEqual([])
  })

  it('falls back to empty buckets when the sidecar file is missing', async () => {
    const sidecarDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-settle-absent-'))
    expect(await readReviewResultFromSidecars(sidecarDir, 4, 'cap-hit')).toEqual({
      outcome: 'cap-hit',
      rounds: 4,
      // The fallback deliberately keeps the pre-change reading rather than
      // becoming a new gating condition; the ladder's integrity cross-check is
      // what fails closed on an unreadable sidecar.
      verdict: 'converged',
      raised: { blocker: 0, material: 0, nitpick: 0 },
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    })
  })

  it('falls back to empty buckets when the sidecar is malformed JSON', async () => {
    const sidecarDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-settle-broken-'))
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(path.join(sidecarDir, 'resolutions-1.json'), '{not json')
    expect(await readReviewResultFromSidecars(sidecarDir, 1, 'converged')).toMatchObject({
      verdict: 'converged',
      raised: { blocker: 0, material: 0, nitpick: 0 },
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    })
  })

  it('buckets open resolutions by class, preserving round and outcome', async () => {
    const dismissed = (id: string, cls: string): unknown => ({
      id,
      class: cls,
      resolution: 'dismissed',
      justification: 'out of scope',
    })
    const sidecarDir = seed(
      2,
      [dismissed('F1', 'BLOCKER'), dismissed('F2', 'MATERIAL'), dismissed('N1', 'NITPICK')],
      [assumption],
    )
    expect(await readReviewResultFromSidecars(sidecarDir, 2, 'converged')).toMatchObject({
      outcome: 'converged',
      rounds: 2,
      verdict: 'open',
      raised: { blocker: 1, material: 1, nitpick: 1 },
      openBlockers: [{ id: 'F1' }],
      openMaterial: [{ id: 'F2' }],
      openNitpicks: [{ id: 'N1' }],
    })
  })
})

describe('expectedContentFor carries the sanitized joined gap', () => {
  function seed(sidecarDir: string, round: number, resolutions: readonly unknown[]): void {
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(
      path.join(sidecarDir, `resolutions-${String(round)}.json`),
      JSON.stringify({ resolutions, assumptions: [] }),
    )
    fs.writeFileSync(
      path.join(sidecarDir, `findings-${String(round)}.json`),
      JSON.stringify({
        findings: [
          {
            id: 'F1',
            class: 'BLOCKER',
            gap: 'no rollback path\nsecond line',
            question: 'q',
            code_evidence_attempted: 'e',
          },
          {
            id: 'F2',
            class: 'MATERIAL',
            gap: '→ typo everywhere and a very long explanation ' + 'a'.repeat(250),
            question: 'q',
            code_evidence_attempted: 'e',
          },
        ],
      }),
    )
  }

  it('renders blocker and finding rows with the joined gap, sanitized', async () => {
    const sidecarDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-settle-gap-'))
    seed(sidecarDir, 1, [
      { id: 'F1', class: 'BLOCKER', resolution: 'dismissed', justification: 'out of scope' },
      { id: 'F2', class: 'MATERIAL', resolution: 'dismissed', justification: 'out of scope' },
    ])
    const expected = await expectedContentFor(sidecarDir, 1, 'early')
    expect(expected.blockers[0]?.gap).toBe('no rollback path second line')
    expect(expected.findings?.[0]?.gap).toHaveLength(200)
    expect(expected.findings?.[0]?.gap?.endsWith('…')).toBe(true)
  })

  it('degrades to the identifier when the findings sidecar is absent', async () => {
    const sidecarDir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-settle-nogap-'))
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(
      path.join(sidecarDir, 'resolutions-1.json'),
      JSON.stringify({
        resolutions: [{ id: 'F1', class: 'BLOCKER', resolution: 'dismissed', justification: 'out of scope' }],
        assumptions: [],
      }),
    )
    const expected = await expectedContentFor(sidecarDir, 1, 'early')
    expect(expected.blockers[0]?.gap).toBe('F1')
  })
})
