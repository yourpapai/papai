// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Resolution } from '../../../afk-runner/src/agent-layer.js'
import { ResolverOutputSchema } from '../../../afk-runner/src/work/review-loop.js'
import { readResolutionsLedger } from '../../../afk-runner/src/work/review-model.js'
import { buildResolverPrompt, buildReviewerPrompt } from '../../../afk-runner/src/work/review-prompt.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-review-prompt-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function writeRound(
  sidecarDir: string,
  round: number,
  resolutions: readonly Resolution[],
  gaps: readonly { id: string; gap: string }[],
  skeptic = false,
): void {
  fs.mkdirSync(sidecarDir, { recursive: true })
  const payload = ResolverOutputSchema.parse({ resolutions, assumptions: [] })
  fs.writeFileSync(path.join(sidecarDir, `resolutions-${round}.json`), JSON.stringify(payload))
  const findingsName = skeptic ? `findings-skeptic-${round}.json` : `findings-${round}.json`
  fs.writeFileSync(
    path.join(sidecarDir, findingsName),
    JSON.stringify({
      findings: gaps.map((entry) => ({
        id: entry.id,
        class: 'MATERIAL',
        gap: entry.gap,
        question: 'q',
        code_evidence_attempted: 'e',
      })),
    }),
  )
}

describe('readResolutionsLedger — round-tagged entries (loop-memory D4)', () => {
  it('returns round-tagged entries joined to their finding gap text', async () => {
    const dir = makeDir()
    const sidecarDir = path.join(dir, 'sidecars')
    writeRound(
      sidecarDir,
      1,
      [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }],
      [{ id: 'F1', gap: 'the proposal never names the scope id' }],
    )
    writeRound(
      sidecarDir,
      2,
      [{ id: 'S1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed gap' }],
      [{ id: 'S1', gap: 'THE PROPOSAL never names the scope id' }],
      true,
    )
    const ledger = await readResolutionsLedger(sidecarDir, 3)
    expect(ledger).toHaveLength(2)
    expect(ledger[0]).toMatchObject({ round: 1, gap: 'the proposal never names the scope id' })
    expect(ledger[1]).toMatchObject({ round: 2, gap: 'THE PROPOSAL never names the scope id' })
  })

  it('reads a pre-concerns sidecar dir as an empty ledger', async () => {
    const dir = makeDir()
    const ledger = await readResolutionsLedger(path.join(dir, 'sidecars'), 2)
    expect(ledger).toEqual([])
  })
})

describe('buildReviewerPrompt — known-concerns digest (loop-memory D4)', () => {
  const ledger = [
    { round: 1, gap: 'the proposal never names the scope id', resolution: resolutionOf('F2', 1) },
    { round: 3, gap: 'THE PROPOSAL never names the scope id', resolution: resolutionOf('S1', 3) },
    { round: 3, gap: 'a different concern', resolution: resolutionOf('F9', 3) },
  ]

  it('renders one round-tagged digest line per concern in place of the flat ledger', () => {
    const prompt = buildReviewerPrompt({
      lens: 'reviewer',
      artifacts: 'ARTIFACTS',
      conventions: 'CONV',
      ledger,
      outputTarget: '/tmp/out.json',
    })
    expect(prompt).toContain('## Known concerns')
    expect(prompt).toContain('r3 [S1] MATERIAL edited — narrowed gap (seen r1..r3)')
    expect(prompt).toContain('r3 [F9] MATERIAL edited — narrowed gap (seen r3..r3)')
    expect(prompt).not.toContain('(do not re-raise without new evidence)')
  })

  it('names F<n> ids for the reviewer lens and S<n> for the skeptic lens', () => {
    const reviewer = buildReviewerPrompt({
      lens: 'reviewer',
      artifacts: 'A',
      conventions: 'C',
      ledger: [],
      outputTarget: '/tmp/out.json',
    })
    const skeptic = buildReviewerPrompt({
      lens: 'skeptic',
      artifacts: 'A',
      conventions: 'C',
      ledger: [],
      outputTarget: '/tmp/out.json',
    })
    expect(reviewer).toContain('"id": "F<n>"')
    expect(skeptic).toContain('"id": "S<n>"')
  })
})

describe('buildResolverPrompt (extraction smoke)', () => {
  it('carries the findings JSON and the resolution grammar', () => {
    const prompt = buildResolverPrompt({
      artifacts: 'ARTIFACTS',
      findings: [{ id: 'F1', class: 'MATERIAL', gap: 'g', question: 'q', code_evidence_attempted: 'e' }],
      conventions: 'CONV',
      taskText: 'TASK',
      outputTarget: '/tmp/out.json',
    })
    expect(prompt).toContain('## Findings')
    expect(prompt).toContain('"F1"')
    expect(prompt).toContain('TASK')
  })
})

function resolutionOf(id: string, round: number): Resolution {
  return { id, class: 'MATERIAL', resolution: 'edited', outcome: round === 1 ? 'narrowed gap' : 'narrowed gap' }
}
