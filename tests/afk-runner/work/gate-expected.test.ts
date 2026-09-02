// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { expectedContentFor, readReviewResultFromSidecars } from '../../../afk-runner/src/work/gate-expected.js'

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
