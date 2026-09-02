// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { DigestRecord } from '../../../afk-runner/src/legacy-fold.js'
import { guardedReviewResult, integrityOf } from '../../../afk-runner/src/work/gate-integrity.js'
import type { ReviewLoopResult } from '../../../afk-runner/src/work/review-loop.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-integrity-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function seedSidecar(sidecarDir: string, round: number, payload: unknown): void {
  fs.mkdirSync(sidecarDir, { recursive: true })
  fs.writeFileSync(path.join(sidecarDir, `resolutions-${String(round)}.json`), JSON.stringify(payload))
}

function seedDigests(sidecarDir: string, round: number, digests: Record<string, string>): void {
  fs.writeFileSync(path.join(sidecarDir, `round-hashes-${String(round)}.json`), JSON.stringify(digests))
}

/** Round 2: one dismissed material (open), one edited blocker with a moved folder (closed). */
const ROUND_2_SIDECAR = {
  resolutions: [
    { id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'out of scope' },
    { id: 'F2', class: 'BLOCKER', resolution: 'edited', outcome: 'added rollback' },
  ],
  assumptions: [],
}

const MATCHING_RECORD: DigestRecord = {
  round: 2,
  counts: { blocker: 1, material: 1, nitpick: 0 },
  open: { blocker: 0, material: 1, nitpick: 0 },
  resolved: 1,
  dismissed: 1,
  verdict: 'open',
}

function recordOf(overrides: Partial<DigestRecord> = {}): DigestRecord {
  return { ...MATCHING_RECORD, ...overrides }
}

describe('integrityOf — both count sets recomputed from the sidecars', () => {
  it('returns clear when both recomputed sets agree with the convergence record', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    seedSidecar(sidecarDir, 2, ROUND_2_SIDECAR)
    seedDigests(sidecarDir, 1, { 'proposal.md': 'aaa' })
    seedDigests(sidecarDir, 2, { 'proposal.md': 'bbb' })
    expect(await integrityOf(sidecarDir, recordOf())).toBe('clear')
  })

  it('returns mismatch when the raised set drifted', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    seedSidecar(sidecarDir, 2, ROUND_2_SIDECAR)
    seedDigests(sidecarDir, 1, { 'proposal.md': 'aaa' })
    seedDigests(sidecarDir, 2, { 'proposal.md': 'bbb' })
    expect(await integrityOf(sidecarDir, recordOf({ counts: { blocker: 0, material: 1, nitpick: 0 } }))).toBe(
      'mismatch',
    )
  })

  it('returns mismatch when the open set drifted', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    seedSidecar(sidecarDir, 2, ROUND_2_SIDECAR)
    seedDigests(sidecarDir, 1, { 'proposal.md': 'aaa' })
    seedDigests(sidecarDir, 2, { 'proposal.md': 'bbb' })
    expect(await integrityOf(sidecarDir, recordOf({ open: { blocker: 0, material: 0, nitpick: 0 } }))).toBe('mismatch')
  })

  it('folds a pre-split record (no open set) against its raised set', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    // A pre-split run counted everything as open, so its record carries no
    // open set and folds it equal to its raised counts. A dismissed material
    // recomputes open under the new predicate too — the sets coincide, and
    // the pre-split record reads clear exactly when the raised counts agree.
    seedSidecar(sidecarDir, 2, {
      resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'out of scope' }],
      assumptions: [],
    })
    const preSplit: DigestRecord = {
      round: 2,
      counts: { blocker: 0, material: 1, nitpick: 0 },
      resolved: 0,
      dismissed: 1,
      verdict: 'open',
    }
    expect(await integrityOf(sidecarDir, preSplit)).toBe('clear')
    const driftedRaised: DigestRecord = {
      round: 2,
      counts: { blocker: 0, material: 2, nitpick: 0 },
      resolved: 0,
      dismissed: 1,
      verdict: 'open',
    }
    expect(await integrityOf(sidecarDir, driftedRaised)).toBe('mismatch')
  })

  it('returns unparseable for a malformed resolver sidecar', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(path.join(sidecarDir, 'resolutions-2.json'), '{not json')
    expect(await integrityOf(sidecarDir, recordOf())).toBe('unparseable')
  })

  it('returns unparseable for a missing resolver sidecar', async () => {
    const sidecarDir = path.join(makeDir(), 'absent')
    expect(await integrityOf(sidecarDir, recordOf())).toBe('unparseable')
  })
})

describe('guardedReviewResult — the fail-closed substitution', () => {
  function convergedResult(): ReviewLoopResult {
    return {
      outcome: 'converged',
      rounds: 2,
      verdict: 'converged',
      raised: { blocker: 0, material: 1, nitpick: 0 },
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    }
  }

  it('passes the review result through on agreement', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    seedSidecar(sidecarDir, 2, ROUND_2_SIDECAR)
    seedDigests(sidecarDir, 1, { 'proposal.md': 'aaa' })
    seedDigests(sidecarDir, 2, { 'proposal.md': 'bbb' })
    const result = await guardedReviewResult(convergedResult(), [MATCHING_RECORD], sidecarDir)
    expect(result.openBlockers).toEqual([])
  })

  it('substitutes an open POLICY-INTEGRITY blocker on a count mismatch', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    seedSidecar(sidecarDir, 2, ROUND_2_SIDECAR)
    seedDigests(sidecarDir, 1, { 'proposal.md': 'aaa' })
    seedDigests(sidecarDir, 2, { 'proposal.md': 'bbb' })
    const drifted = recordOf({ open: { blocker: 0, material: 0, nitpick: 0 } })
    const result = await guardedReviewResult(convergedResult(), [drifted], sidecarDir)
    expect(result.openBlockers).toHaveLength(1)
    expect(result.openBlockers[0]).toMatchObject({ id: 'POLICY-INTEGRITY', class: 'BLOCKER' })
    expect(result.openBlockers[0]?.outcome).toContain('mismatch')
  })

  it('substitutes an open POLICY-INTEGRITY blocker on an unparseable sidecar', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(path.join(sidecarDir, 'resolutions-2.json'), '{not json')
    const result = await guardedReviewResult(convergedResult(), [MATCHING_RECORD], sidecarDir)
    expect(result.openBlockers[0]).toMatchObject({ id: 'POLICY-INTEGRITY', class: 'BLOCKER' })
  })

  it('stays clear when the gate round has no recorded convergence record', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    seedSidecar(sidecarDir, 2, ROUND_2_SIDECAR)
    const result = await guardedReviewResult(convergedResult(), [], sidecarDir)
    expect(result.openBlockers).toEqual([])
  })
})
