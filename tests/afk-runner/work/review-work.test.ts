// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { startRun } from '../../../afk-runner/src/run.js'
import { BLOCKER_ROUND, makeFakePipeline, TASK_TEXT } from '../fixtures/fake-pipeline.js'

function gateEvents(runDir: string): Extract<SddEvent, { type: 'gate' }>[] {
  return readEvents(path.join(runDir, 'events.ndjson')).filter(
    (event): event is Extract<SddEvent, { type: 'gate' }> => event.type === 'gate',
  )
}

function presentedEvents(runDir: string): Extract<SddEvent, { type: 'gate' }>[] {
  return gateEvents(runDir).filter((event) => event.action === 'presented')
}

function readHashes(runDir: string): Record<string, string> {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(runDir, 'gate-hashes-1.json'), 'utf8'))
  const out: Record<string, string> = {}
  if (parsed !== null && typeof parsed === 'object') {
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') out[key] = value
    }
  }
  return out
}

describe('review work presents the full early gate (C4 seam face)', () => {
  it('a blocking cap-hit writes gate-<n>.md + gate-hashes-<n>.json before the presented event', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun(pipeline.deps, { taskFile })
    expect(halted.halted).toBe('gate-pending')
    const runDir = pipeline.runDirOf(halted.runId)

    const gateMd = fs.readFileSync(path.join(runDir, 'gate-1.md'), 'utf8')
    expect(gateMd).toContain('Early gate')
    expect(gateMd).toContain('### Cap-hit blockers (answer or override)')
    expect(gateMd).toContain('F1')
    expect(gateMd).toContain('→ <answer or OVERRIDE>')
    expect(gateMd).toContain('→ RUN 1 MORE')
    expect(gateMd).toContain(`afk-runner resume ${halted.runId}`)

    const hashes = readHashes(runDir)
    expect(hashes['proposal.md']).toMatch(/^[0-9a-f]{64}$/u)

    expect(presentedEvents(runDir)).toHaveLength(1)
    expect(presentedEvents(runDir)[0]).toMatchObject({ mode: 'early', version: 1 })
  })

  it('a converged review presents no early gate files — the tail presents the final gate instead', async () => {
    const pipeline = makeFakePipeline()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun(pipeline.deps, { taskFile })
    const runDir = pipeline.runDirOf(halted.runId)
    expect(halted.halted).toBe('final')
    const presented = presentedEvents(runDir)
    expect(presented).toHaveLength(1)
    expect(presented[0]).toMatchObject({ mode: 'final', version: 1 })
  })
})

/**
 * An onSpawn hook that moves the change folder just before the round-2 lens
 * runs, so a round-2 `edited` claim has real movement behind it. The root is
 * read lazily — the pipeline that will own it does not exist yet at wiring.
 */
function moveFolderBeforeRound2(rootOf: () => string): (basename: string) => void {
  return (basename: string): void => {
    if (basename !== 'findings-2.json') return
    fs.writeFileSync(path.join(rootOf(), 'openspec', 'changes', 'add-thing', 'proposal.md'), '<!-- revision 2 -->\n')
  }
}

/** The version of the first presented gate, or -1 when none presented. */
function firstGateVersion(presented: readonly Extract<SddEvent, { type: 'gate' }>[]): number {
  return presented[0]?.version ?? -1
}

/** Whether every auto_decision in the log belongs to the given gate version. */
function allDecisionsBelongTo(events: readonly SddEvent[], version: number): boolean {
  return events
    .filter((event): event is Extract<SddEvent, { type: 'auto_decision' }> => event.type === 'auto_decision')
    .every((decision) => decision.gateVersion === version)
}

describe('cap-hit routing by three verdicts (open-vs-raised 5.1/5.2)', () => {
  /** Depth-S round 1: the resolver edits the material, so nothing is open but the edit is unreviewed. */
  const NEEDS_REVIEW_ROUND = {
    'findings-1.json': JSON.stringify({
      findings: [
        {
          id: 'F1',
          class: 'MATERIAL',
          gap: 'proposal lacks a rollback story',
          question: 'how do we roll back?',
          code_evidence_attempted: 'searched the repo, none found',
        },
      ],
    }),
    'resolutions-1.json': JSON.stringify({
      resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'added a rollback section' }],
      assumptions: [],
    }),
  }

  function roundTokens(runDir: string): string[] {
    return readEvents(path.join(runDir, 'events.ndjson')).flatMap((event) => {
      if (event.type === 'round_open') return [`round_open:${event.round}:${event.cap}`]
      if (event.type === 'convergence') return [`convergence:${event.round}:${event.verdict}`]
      return []
    })
  }

  it('a needs-review cap-hit buys exactly one verification round that then converges into the tail', async () => {
    const pipeline = makeFakePipeline({
      sidecarOverrides: {
        ...NEEDS_REVIEW_ROUND,
        'findings-2.json': JSON.stringify({ findings: [] }),
        'resolutions-2.json': JSON.stringify({ resolutions: [], assumptions: [] }),
      },
    })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun(pipeline.deps, { taskFile })
    const runDir = pipeline.runDirOf(halted.runId)
    expect(halted.halted).toBe('final')
    expect(pipeline.spawnOrder).toContain('findings-2.json')
    expect(pipeline.spawnOrder).toContain('resolutions-2.json')
    const tokens = roundTokens(runDir)
    expect(tokens.filter((token) => token === 'round_open:2:2')).toHaveLength(1)
    expect(tokens).toContain('convergence:2:converged')
    expect(pipeline.spawnOrder).not.toContain('findings-3.json')
    const presented = presentedEvents(runDir)
    expect(presented).toHaveLength(1)
    expect(presented[0]).toMatchObject({ mode: 'final' })
  })

  it('an open material recorded by the verification round still presents the early gate', async () => {
    const pipeline = makeFakePipeline({
      sidecarOverrides: {
        ...NEEDS_REVIEW_ROUND,
        'findings-2.json': JSON.stringify({
          findings: [
            {
              id: 'F1',
              class: 'MATERIAL',
              gap: 'still no rollback story',
              question: 'how do we roll back?',
              code_evidence_attempted: 'searched the repo, none found',
            },
          ],
        }),
        'resolutions-2.json': JSON.stringify({
          resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'out of scope' }],
          assumptions: [],
        }),
      },
    })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun(pipeline.deps, { taskFile })
    const runDir = pipeline.runDirOf(halted.runId)
    expect(halted.halted).toBe('gate-pending')
    const presented = presentedEvents(runDir)
    expect(presented[0]).toMatchObject({ mode: 'early', version: 1 })
    expect(roundTokens(runDir).filter((token) => token === 'round_open:2:2')).toHaveLength(1)
  })

  it('a second needs-review from the verification round buys nothing — review settles into the tail', async () => {
    let repoRoot = ''
    const pipeline = makeFakePipeline({
      sidecarOverrides: {
        ...NEEDS_REVIEW_ROUND,
        'findings-2.json': JSON.stringify({
          findings: [
            {
              id: 'F1',
              class: 'MATERIAL',
              gap: 'still no rollback story',
              question: 'how do we roll back?',
              code_evidence_attempted: 'searched the repo, none found',
            },
          ],
        }),
        'resolutions-2.json': JSON.stringify({
          resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'narrowed again' }],
          assumptions: [],
        }),
      },
      // The round-2 `edited` claim must have real movement behind it (round 2
      // compares snapshots), so the folder moves before the round-2 lens runs.
      onSpawn: moveFolderBeforeRound2(() => repoRoot),
    })
    repoRoot = pipeline.repoRoot
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun(pipeline.deps, { taskFile })
    const runDir = pipeline.runDirOf(halted.runId)
    expect(halted.halted).toBe('final')
    expect(pipeline.spawnOrder).not.toContain('findings-3.json')
    expect(roundTokens(runDir).filter((token) => token.startsWith('round_open:'))).toEqual([
      'round_open:1:1',
      'round_open:2:2',
    ])
    expect(roundTokens(runDir)).toContain('convergence:2:needs-review')
  })

  it('an over-ceiling needs-review cap-hit declines the round: no round 2, no refusal auto_decision', async () => {
    const pipeline = makeFakePipeline({
      sidecarOverrides: {
        ...NEEDS_REVIEW_ROUND,
        'findings-2.json': JSON.stringify({ findings: [] }),
        'resolutions-2.json': JSON.stringify({ resolutions: [], assumptions: [] }),
      },
    })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    // budget 0 is a non-null ceiling; any projected spend reaches it. The
    // refusal flows to the tail; the final gate's own R4 then parks it — the
    // human sees the unreviewed edits either way.
    const halted = await startRun({ ...pipeline.deps, config: { ...pipeline.deps.config, budget: 0 } }, { taskFile })
    const runDir = pipeline.runDirOf(halted.runId)
    expect(halted.halted).toBe('gate-pending')
    expect(pipeline.spawnOrder).not.toContain('findings-2.json')
    expect(roundTokens(runDir)).not.toContain('round_open:2:2')
    const presented = presentedEvents(runDir)
    expect(presented).toHaveLength(1)
    expect(presented[0]).toMatchObject({ mode: 'final' })
    const events = readEvents(path.join(runDir, 'events.ndjson'))
    // the only auto_decisions are the final gate's own ladder events — none
    // for the refusal: every recorded decision belongs to that gate version.
    expect(allDecisionsBelongTo(events, firstGateVersion(presented))).toBe(true)
  })

  it('a null ceiling (unmetered) never refuses the verification round', async () => {
    const pipeline = makeFakePipeline({
      sidecarOverrides: {
        ...NEEDS_REVIEW_ROUND,
        'findings-2.json': JSON.stringify({ findings: [] }),
        'resolutions-2.json': JSON.stringify({ resolutions: [], assumptions: [] }),
      },
      usageOf: (): { input: number; cost: number } => ({ input: 100, cost: 0 }),
    })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun({ ...pipeline.deps, config: { ...pipeline.deps.config, budget: null } }, { taskFile })
    const runDir = pipeline.runDirOf(halted.runId)
    expect(halted.halted).toBe('final')
    expect(pipeline.spawnOrder).toContain('findings-2.json')
    expect(roundTokens(runDir)).toContain('round_open:2:2')
  })

  it('a metered run with unknown cost declines the verification round', async () => {
    const pipeline = makeFakePipeline({
      sidecarOverrides: {
        ...NEEDS_REVIEW_ROUND,
        'findings-2.json': JSON.stringify({ findings: [] }),
        'resolutions-2.json': JSON.stringify({ resolutions: [], assumptions: [] }),
      },
      usageOf: (): { input: number; cost: number } => ({ input: 100, cost: 0 }),
    })
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const halted = await startRun(pipeline.deps, { taskFile })
    const runDir = pipeline.runDirOf(halted.runId)
    // unknown cost on a metered run declines the round; the tail's final gate
    // then parks via its own R4 (cost-unknown on a metered run).
    expect(halted.halted).toBe('gate-pending')
    expect(pipeline.spawnOrder).not.toContain('findings-2.json')
    expect(roundTokens(runDir)).not.toContain('round_open:2:2')
    expect(presentedEvents(runDir)[0]).toMatchObject({ mode: 'final' })
  })
})
