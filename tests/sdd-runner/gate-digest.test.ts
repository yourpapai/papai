// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { SddEvent } from '../../sdd-runner/src/events.js'
import {
  applyConfirmAll,
  blockersOf,
  buildDriftPrompt,
  costAndDuration,
  findingsOf,
} from '../../sdd-runner/src/gate-digest.js'
import { writeGateDigest } from '../../sdd-runner/src/gate-model.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gd-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('blockersOf', () => {
  it('maps open blockers to gate blocker entries', () => {
    const result: ReviewLoopResult = {
      outcome: 'cap-hit',
      rounds: 2,
      openBlockers: [
        { id: 'F1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' },
        { id: 'F2', class: 'BLOCKER', resolution: 'dismissed', justification: 'nope' },
      ],
      openMaterial: [],
      openNitpicks: [],
    }
    expect(blockersOf(result)).toEqual([
      { id: 'F1', gap: 'F1', evidence: 'defaulted' },
      { id: 'F2', gap: 'F2', evidence: 'nope' },
    ])
  })
})

describe('findingsOf', () => {
  it('maps open blockers and open material to gate finding entries', () => {
    const result: ReviewLoopResult = {
      outcome: 'cap-hit',
      rounds: 3,
      openBlockers: [{ id: 'F1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' }],
      openMaterial: [
        { id: 'F2', class: 'MATERIAL', resolution: 'edited', outcome: 'gap narrowed' },
        { id: 'F3', class: 'MATERIAL', resolution: 'dismissed', justification: 'answered in design' },
      ],
      openNitpicks: [],
    }
    expect(findingsOf(result)).toEqual({
      blockers: [{ id: 'F1', gap: 'F1', evidence: 'defaulted' }],
      material: [
        { id: 'F2', gap: 'F2', evidence: 'edited — gap narrowed' },
        { id: 'F3', gap: 'F3', evidence: 'dismissed — answered in design' },
      ],
      nitpicks: [],
    })
  })
})

describe('costAndDuration', () => {
  it('sums done-event cost and measures elapsed time', () => {
    const events: readonly SddEvent[] = [
      {
        altitude: 'L1',
        type: 'done',
        agent: 'a',
        usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0.25, wallMs: 0 },
        seq: 1,
        ts: 'x',
      },
    ]
    const { costUsd, durationMs } = costAndDuration(
      events,
      '2026-01-01T00:00:00.000Z',
      new Date('2026-01-01T00:00:01.000Z'),
    )
    expect(costUsd).toBe(0.25)
    expect(durationMs).toBe(1000)
  })
})

describe('applyConfirmAll', () => {
  it('checks every assumption, finding, and ack box in the gate file', async () => {
    const dir = makeDir()
    const file = path.join(dir, 'gate-1.md')
    fs.writeFileSync(file, '- [ ] A1 first\n- [ ] F1 gap\n- [ ] T1 ack\n')
    await applyConfirmAll(file)
    const md = fs.readFileSync(file, 'utf8')
    expect(md).toContain('- [x] A1 first')
    expect(md).toContain('- [x] F1 gap')
    expect(md).toContain('- [x] T1 ack')
  })
})

describe('buildDriftPrompt', () => {
  it('names the edited files and the report write target', () => {
    const prompt = buildDriftPrompt(['specs/thing/spec.md', 'design.md'], '/abs/tasks.md', '/abs')
    expect(prompt).toContain('specs/thing/spec.md')
    expect(prompt).toContain('design.md')
    expect(prompt).toContain('/abs/tasks.md')
    expect(prompt).toContain('.review-loop/drift.json')
  })
})

describe('writeGateDigest cost marker', () => {
  const base = {
    version: 1,
    mode: 'final' as const,
    changeName: 'add-thing',
    runId: 'run-1',
    assumptions: [],
    blockers: [],
    openMaterial: [],
    openNitpicks: [],
    trajectory: [],
    capHitFired: true,
    summary: 'add a thing',
    durationMs: 2607_000,
  }

  it('renders metered when costKnown is true', () => {
    const md = writeGateDigest({ ...base, costUsd: 1.23, costKnown: true })
    expect(md).toContain(`### Cost / duration · $1.23 · 2607s · metered`)
  })

  it('renders estimated when costKnown is false but cost is non-zero', () => {
    const md = writeGateDigest({ ...base, costUsd: 1.23, costKnown: false })
    expect(md).toContain(`### Cost / duration · $1.23 · 2607s · estimated`)
  })

  it('renders unknown when costKnown is false and cost is zero', () => {
    const md = writeGateDigest({ ...base, costUsd: 0, costKnown: false })
    expect(md).toContain(`### Cost / duration · $0.00 · 2607s · unknown`)
  })
})
