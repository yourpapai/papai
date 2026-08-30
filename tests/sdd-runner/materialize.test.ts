// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import { consistencyFindings } from '../../sdd-runner/src/artifact-consistency.js'
import {
  createMaterializer,
  materializeAssumptions,
  materializeReview,
  readRoundDigests,
  recordRoundDigests,
} from '../../sdd-runner/src/materialize.js'

const DigestsShape = z.record(z.string(), z.string())

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-mat-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function writeJson(dir: string, name: string, data: unknown): void {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, name), JSON.stringify(data))
}

const FINDINGS_R1 = {
  findings: [
    {
      id: 'F1',
      class: 'BLOCKER',
      gap: 'no rollback path',
      question: 'how do we roll back?',
      code_evidence_attempted: 'read design.md',
    },
  ],
}
const RESOLUTIONS_R1 = {
  resolutions: [
    { id: 'F1', class: 'NITPICK', resolution: 'dismissed', justification: 'answered verbatim in design D2' },
  ],
  assumptions: [
    {
      id: 'A1',
      text: 'guests stay read-only',
      basis: 'convention',
      confidence: 'medium',
      blast_radius: 'group replies',
      status: 'open',
      evidence: { files: ['openspec/changes/thing/proposal.md'] },
    },
  ],
}

describe('materializeReview', () => {
  it('writes review.md with a GENERATED header and one section per round including the verdict', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    await materializeReview(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(md).toContain('GENERATED')
    expect(md).toContain('### Round 1')
    expect(md).toContain('no rollback path')
    expect(md).toContain('NITPICK')
    expect(md).toContain('1 dismissed')
  })

  it('renders the round verdict body in the canonical burndown field set', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    await materializeReview(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(md).toContain('**Verdict**: 0b 0m 1n \u00b7 0 resolved \u00b7 1 dismissed \u00b7 converged')
  })

  it('regenerates wholesale: a second call replaces, never merges', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    await materializeReview(changeDir, sidecarDir, 1)
    const first = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    writeJson(sidecarDir, 'findings-1.json', { findings: [] })
    writeJson(sidecarDir, 'resolutions-1.json', { resolutions: [], assumptions: [] })
    await materializeReview(changeDir, sidecarDir, 1)
    const second = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(second).not.toContain('no rollback path')
    expect(second.length).toBeLessThan(first.length)
  })

  it('treats a missing sidecar file as an empty round, not an error', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    await materializeReview(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(md).toContain('No findings recorded this round.')
  })

  it('treats a schema-invalid sidecar file as an empty round', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(path.join(sidecarDir, 'findings-1.json'), 'not json')
    await materializeReview(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(md).toContain('No findings recorded this round.')
  })

  it('renders each finding block: heading with final class, quote of the gap, question, evidence, resolution', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', {
      resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'edited', outcome: 'narrowed gap' }],
      assumptions: [],
    })
    await materializeReview(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(md).toContain('#### NITPICK — F1')
    expect(md).toContain('> no rollback path')
    expect(md).toContain('- **Question**: how do we roll back?')
    expect(md).toContain('- **Code evidence**: read design.md')
    expect(md).toContain('- **Resolution**: edited — narrowed gap')
  })

  it('renders unresolved as the resolution line and keeps the finding class when no resolution matches', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', { resolutions: [], assumptions: [] })
    await materializeReview(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(md).toContain('- **Resolution**: unresolved')
    expect(md).toContain('#### BLOCKER — F1')
  })

  it('falls back to the justification in the resolution note when no outcome is given', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', {
      resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'dismissed', justification: 'answered in D2' }],
      assumptions: [],
    })
    await materializeReview(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(md).toContain('- **Resolution**: dismissed — answered in D2')
  })

  it('omits the note separator when the resolution has neither outcome nor justification', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', {
      resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'edited' }],
      assumptions: [],
    })
    await materializeReview(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    expect(md).toContain('- **Resolution**: edited\n')
    expect(md).not.toContain('edited —')
  })

  it('pins the full document skeleton around the round sections', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    await materializeReview(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'review.md'), 'utf8')
    const lines = md.split('\n')
    expect(lines[0]).toContain('GENERATED by sdd-runner')
    expect(lines).toContain('## Review')
    expect(lines[lines.length - 1]).toBe('')
  })
})

describe('materializeAssumptions', () => {
  it('aggregates assumptions across rounds blast-ranked with a GENERATED header', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'resolutions-1.json', {
      resolutions: [],
      assumptions: [
        {
          id: 'A1',
          text: 'small assumption',
          basis: 'default',
          confidence: 'low',
          blast_radius: 'one reply',
          status: 'open',
          evidence: { files: ['openspec/changes/thing/a.md'] },
        },
      ],
    })
    writeJson(sidecarDir, 'resolutions-2.json', {
      resolutions: [],
      assumptions: [
        {
          id: 'A2',
          text: 'big assumption',
          basis: 'default',
          confidence: 'high',
          blast_radius: 'whole bot',
          status: 'open',
          evidence: { files: ['openspec/changes/thing/b.md'] },
        },
      ],
    })
    await materializeAssumptions(changeDir, sidecarDir, 2)
    const md = fs.readFileSync(path.join(changeDir, 'assumptions.md'), 'utf8')
    expect(md).toContain('GENERATED')
    expect(md).toContain('A1')
    expect(md).toContain('A2')
    expect(md.indexOf('whole bot')).toBeLessThan(md.indexOf('one reply'))
  })

  it('pins the per-assumption field lines and document skeleton', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    await materializeAssumptions(changeDir, sidecarDir, 1)
    const md = fs.readFileSync(path.join(changeDir, 'assumptions.md'), 'utf8')
    const lines = md.split('\n')
    expect(lines[0]).toContain('GENERATED by sdd-runner')
    expect(lines).toContain('## Assumptions')
    expect(md).toContain('### A1: guests stay read-only')
    expect(md).toContain('- **Basis**: convention')
    expect(md).toContain('- **Confidence**: medium')
    expect(md).toContain('- **Blast radius**: group replies')
    expect(md).toContain('- **Status**: open')
    expect(lines[lines.length - 1]).toBe('')
  })

  it('later rounds win when the same assumption id reappears', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'resolutions-1.json', {
      resolutions: [],
      assumptions: [
        {
          id: 'A1',
          text: 'stale text',
          basis: 'default',
          confidence: 'low',
          blast_radius: 'x',
          status: 'open',
          evidence: { files: ['openspec/changes/thing/a.md'] },
        },
      ],
    })
    writeJson(sidecarDir, 'resolutions-2.json', {
      resolutions: [],
      assumptions: [
        {
          id: 'A1',
          text: 'fresh text',
          basis: 'default',
          confidence: 'high',
          blast_radius: 'x',
          status: 'confirmed',
          evidence: { files: ['openspec/changes/thing/a.md'] },
        },
      ],
    })
    await materializeAssumptions(changeDir, sidecarDir, 2)
    const md = fs.readFileSync(path.join(changeDir, 'assumptions.md'), 'utf8')
    expect(md).toContain('### A1: fresh text')
    expect(md).not.toContain('stale text')
    expect(md).toContain('- **Status**: confirmed')
  })
})

describe('createMaterializer', () => {
  it('returns a function that materializes review.md and assumptions.md through the given round', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    const materialize = createMaterializer(sidecarDir, changeDir)
    await materialize(1)
    expect(fs.existsSync(path.join(changeDir, 'review.md'))).toBe(true)
    expect(fs.existsSync(path.join(changeDir, 'assumptions.md'))).toBe(true)
  })

  it('emits an L2 artifact event per file when repoRoot and emit are both provided', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    const events: { altitude: string; type: string; action: string; path: string }[] = []
    const materialize = createMaterializer(
      sidecarDir,
      changeDir,
      (event) => {
        events.push(event)
      },
      dir,
    )
    await materialize(1)
    expect(events).toEqual([
      {
        altitude: 'L2',
        type: 'artifact',
        action: 'materialized',
        path: path.join('change', 'review.md'),
      },
      {
        altitude: 'L2',
        type: 'artifact',
        action: 'materialized',
        path: path.join('change', 'assumptions.md'),
      },
    ])
  })

  it('emits nothing when only one of repoRoot and emit is provided', async () => {
    const dir = makeDir()
    const changeDir = path.join(dir, 'change')
    const sidecarDir = path.join(dir, 'sidecars')
    fs.mkdirSync(changeDir, { recursive: true })
    writeJson(sidecarDir, 'findings-1.json', FINDINGS_R1)
    writeJson(sidecarDir, 'resolutions-1.json', RESOLUTIONS_R1)
    const events: unknown[] = []
    const emitOnly = createMaterializer(
      sidecarDir,
      changeDir,
      (event) => {
        events.push(event)
      },
      undefined,
    )
    await emitOnly(1)
    const repoOnly = createMaterializer(sidecarDir, changeDir, undefined, dir)
    await repoOnly(1)
    expect(events).toHaveLength(0)
  })
})

describe('recordRoundDigests', () => {
  function changeFolder(): { changeDir: string; sidecarDir: string } {
    const root = makeDir()
    const changeDir = path.join(root, 'change')
    fs.mkdirSync(path.join(changeDir, 'specs', 'cap'), { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# why\n')
    fs.writeFileSync(path.join(changeDir, 'specs', 'cap', 'spec.md'), '# spec\n')
    return { changeDir, sidecarDir: path.join(root, 'sidecars') }
  }

  function readSnapshot(sidecarDir: string, round: number): Record<string, string> {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(sidecarDir, `round-hashes-${String(round)}.json`), 'utf8'),
    )
    return DigestsShape.parse(raw)
  }

  it('writes a snapshot of the agent-authored artifacts for the round', async () => {
    const { changeDir, sidecarDir } = changeFolder()
    await recordRoundDigests(sidecarDir, changeDir, 1)
    expect(Object.keys(readSnapshot(sidecarDir, 1)).sort()).toEqual(['proposal.md', 'specs/cap/spec.md'])
  })

  it('excludes the runner-generated views, which change every round by construction', async () => {
    const { changeDir, sidecarDir } = changeFolder()
    fs.writeFileSync(path.join(changeDir, 'review.md'), '# round 1\n')
    fs.writeFileSync(path.join(changeDir, 'assumptions.md'), '# a\n')
    await recordRoundDigests(sidecarDir, changeDir, 1)
    const keys = Object.keys(readSnapshot(sidecarDir, 1))
    // Including these would make every round look "moved" and the edited-claim
    // guard would never fire.
    expect(keys).not.toContain('review.md')
    expect(keys).not.toContain('assumptions.md')
  })

  it('produces an identical snapshot when the change folder did not move', async () => {
    const { changeDir, sidecarDir } = changeFolder()
    await recordRoundDigests(sidecarDir, changeDir, 1)
    await recordRoundDigests(sidecarDir, changeDir, 2)
    expect(readSnapshot(sidecarDir, 2)).toEqual(readSnapshot(sidecarDir, 1))
  })

  it('produces a different snapshot once an artifact changes', async () => {
    const { changeDir, sidecarDir } = changeFolder()
    await recordRoundDigests(sidecarDir, changeDir, 1)
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# why, revised\n')
    await recordRoundDigests(sidecarDir, changeDir, 2)
    expect(readSnapshot(sidecarDir, 2)).not.toEqual(readSnapshot(sidecarDir, 1))
  })
})

describe('readRoundDigests', () => {
  it('reads back a snapshot the round recorded', async () => {
    const root = makeDir()
    const changeDir = path.join(root, 'change')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '# why\n')
    const sidecarDir = path.join(root, 'sidecars')
    await recordRoundDigests(sidecarDir, changeDir, 1)
    const digests = await readRoundDigests(sidecarDir, 1)
    assert(digests !== null)
    expect(Object.keys(digests)).toEqual(['proposal.md'])
    expect(typeof digests['proposal.md']).toBe('string')
  })

  it('answers null for a round with no snapshot rather than throwing', async () => {
    expect(await readRoundDigests(makeDir(), 7)).toBeNull()
  })
})

describe('consistencyFindings (loop-memory D6)', () => {
  const files = (entries: Record<string, string>): readonly { path: string; content: string }[] =>
    Object.entries(entries).map(([filePath, content]) => ({ path: filePath, content }))

  it('flags migration-strategy disagreement as MATERIAL naming both files and renderings', () => {
    const findings = consistencyFindings(
      files({
        'proposal.md': 'Storage lands via a drizzle migration under drizzle/.\n',
        'specs/thing/spec.md': '### Requirement: Migrations\n\nThe schema SHALL ship as a hand-written migration.\n',
      }),
    )
    expect(findings).toHaveLength(1)
    const finding = findings[0]!
    expect(finding.class).toBe('MATERIAL')
    expect(finding.gap).toContain('proposal.md')
    expect(finding.gap).toContain('specs/thing/spec.md')
    expect(finding.gap).toContain('drizzle')
    expect(finding.gap).toContain('hand-written')
  })

  it('flags interval-ms disagreement between artifacts', () => {
    const findings = consistencyFindings(
      files({
        'design.md': 'The recompute loop ticks every 15*60*1000 ms.\n',
        'specs/thing/spec.md': 'The loop SHALL tick every 30*60*1000 ms.\n',
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]!.gap).toContain('15*60*1000')
    expect(findings[0]!.gap).toContain('30*60*1000')
  })

  it('flags table-name spelling disagreement between artifacts', () => {
    const findings = consistencyFindings(
      files({
        'proposal.md': 'Rows live in the `message_cache` table.\n',
        'design.md': 'Writes target `messageCache` rows.\n',
      }),
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]!.gap).toContain('message_cache')
    expect(findings[0]!.gap).toContain('messageCache')
  })

  it('agreement across proposal, design, and specs yields no findings', () => {
    const findings = consistencyFindings(
      files({
        'proposal.md': 'Storage lands via a drizzle migration; rows live in `message_cache`; ticks 15*60*1000 ms.\n',
        'design.md': 'A drizzle migration creates `message_cache`; the loop ticks every 15*60*1000 ms.\n',
        'specs/thing/spec.md': 'The drizzle migration SHALL create `message_cache` each 15*60*1000 ms.\n',
      }),
    )
    expect(findings).toHaveLength(0)
  })
})
