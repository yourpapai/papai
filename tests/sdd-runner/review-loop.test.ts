// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import type { Finding, Resolution } from '../../sdd-runner/src/agent-layer.js'
import type { RunnerConfig } from '../../sdd-runner/src/config.js'
import { EventInputSchema } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import { runReviewLoop } from '../../sdd-runner/src/review-loop.js'
import type { ReviewLoopDeps } from '../../sdd-runner/src/review-loop.js'
import { evaluateConvergence, lensesForRound, mergeLensFindings } from '../../sdd-runner/src/review-model.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-review-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function resolution(overrides: Partial<Resolution> = {}): Resolution {
  return { id: 'F1', class: 'NITPICK', resolution: 'edited', outcome: 'fixed in specs', ...overrides }
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'F1',
    class: 'MATERIAL',
    gap: 'the proposal never names the scope id',
    question: 'which scope id keys this state?',
    code_evidence_attempted: 'read context-scope.ts',
    ...overrides,
  }
}

describe('evaluateConvergence', () => {
  it('converges with zero blockers, zero materials, and at most three nitpicks', () => {
    const verdict = evaluateConvergence([resolution(), resolution({ id: 'F2' }), resolution({ id: 'F3' })])
    expect(verdict).toEqual({ verdict: 'converged', counts: { blocker: 0, material: 0, nitpick: 3 } })
  })

  it('stays open with any blocker or material, or more than three nitpicks', () => {
    expect(evaluateConvergence([resolution({ class: 'BLOCKER' })]).verdict).toBe('open')
    expect(evaluateConvergence([resolution({ class: 'MATERIAL' })]).verdict).toBe('open')
    const nitpicks = [resolution(), resolution({ id: 'F2' }), resolution({ id: 'F3' }), resolution({ id: 'F4' })]
    expect(evaluateConvergence(nitpicks).verdict).toBe('open')
  })
})

describe('mergeLensFindings', () => {
  it('dedupes findings both lenses raised, keeping reviewer order first', () => {
    const shared = finding()
    const reviewerOnly = finding({ id: 'F2', gap: 'design omits rollback', question: 'how do we roll back?' })
    const skepticOnly = finding({
      id: 'F3',
      class: 'BLOCKER',
      gap: 'no migration path',
      question: 'what breaks on downgrade?',
    })
    const merged = mergeLensFindings([shared, reviewerOnly], [finding({ id: 'F9' }), skepticOnly])
    expect(merged.map((f) => f.id)).toEqual(['F1', 'F2', 'F3'])
  })
})

describe('lensesForRound', () => {
  it('runs a single implementer lens at S and M before escalation', () => {
    expect(lensesForRound('S', 1, 0)).toEqual(['reviewer'])
    expect(lensesForRound('M', 2, 1)).toEqual(['reviewer'])
  })

  it('adds the skeptic lens at L, and at M after round 2 with open blockers', () => {
    expect(lensesForRound('L', 1, 0)).toEqual(['reviewer', 'skeptic'])
    expect(lensesForRound('M', 3, 2)).toEqual(['reviewer', 'skeptic'])
    expect(lensesForRound('M', 3, 0)).toEqual(['reviewer'])
  })
})

interface LoopFixture {
  readonly deps: ReviewLoopDeps
  readonly changeDir: string
  readonly emitted: EventInput[]
  readonly prompts: Map<string, string>
  readonly spawnCounts: Map<string, number>
  readonly materialized: number[]
}

function makeLoopFixture(dir: string, script: Record<string, string[]>): LoopFixture {
  const changeDir = path.join(dir, 'openspec', 'changes', 'add-thing')
  fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
  fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nimprove things\n')
  fs.writeFileSync(path.join(changeDir, 'design.md'), '## Context\nhow\n')
  fs.writeFileSync(
    path.join(changeDir, 'specs', 'thing', 'spec.md'),
    '## ADDED Requirements\n### Requirement: X\n\nIt SHALL x.\n',
  )
  fs.writeFileSync(path.join(changeDir, 'assumptions.md'), 'ASSUMPTION SENTINEL - must never reach the reviewer\n')
  const emitted: EventInput[] = []
  const prompts = new Map<string, string>()
  const spawnCounts = new Map<string, number>()
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'test-model',
    models: {},
    timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
  }
  const spawn: SpawnFn = (_command, args, options) => {
    const prompt = String(args[args.length - 1])
    const targetMatch = prompt.match(/\.review-loop\/[\w-]+\.json/u)
    const basename = path.basename(targetMatch?.[0] ?? 'unknown.json')
    const role = basename.startsWith('resolutions')
      ? 'resolver'
      : basename.startsWith('findings-skeptic')
        ? 'skeptic'
        : 'reviewer'
    const count = spawnCounts.get(role) ?? 0
    spawnCounts.set(role, count + 1)
    prompts.set(`${role}-${count + 1}`, prompt)
    const queue = script[role] ?? []
    const content = queue[Math.min(count, queue.length - 1)] ?? '{"findings":[]}'
    const target = path.join(options.cwd, '.review-loop', basename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  const execGit = (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: '', stderr: '' })
  const materialized: number[] = []
  const deps: ReviewLoopDeps = {
    agent: { spawn, config, execGit, emit: () => undefined },
    emit: (event) => {
      emitted.push(EventInputSchema.parse(event))
    },
    sidecarDir: path.join(dir, 'sidecars'),
    cwd: dir,
    materialize: (round) => {
      materialized.push(round)
      return Promise.resolve()
    },
  }
  return { deps, changeDir, emitted, prompts, spawnCounts, materialized }
}

function promptOf(fixture: LoopFixture, key: string): string {
  return fixture.prompts.get(key) ?? ''
}

const NO_BLOCKERS_RESOLUTIONS = JSON.stringify({
  resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'edited', outcome: 'specs clarified' }],
  assumptions: [],
})

describe('runReviewLoop', () => {
  it('converges in round 1 and isolates the reviewer from task text and assumptions', async () => {
    const dir = makeDir()
    const fixture = makeLoopFixture(dir, {
      reviewer: [JSON.stringify({ findings: [finding()] })],
      resolver: [NO_BLOCKERS_RESOLUTIONS],
    })
    const result = await runReviewLoop(fixture.deps, {
      changeName: 'add-thing',
      changeDir: fixture.changeDir,
      depth: 'M',
      taskText: 'TASK TEXT SENTINEL - must never reach the reviewer',
      conventions: 'project conventions here',
    })
    expect(result.outcome).toBe('converged')
    expect(result.rounds).toBe(1)
    expect(result.openBlockers).toEqual([])
    expect(result.openMaterial).toEqual([])
    const reviewerPrompt = promptOf(fixture, 'reviewer-1')
    expect(reviewerPrompt).toContain('improve things')
    expect(reviewerPrompt).toContain('project conventions here')
    expect(reviewerPrompt).not.toContain('TASK TEXT SENTINEL')
    expect(reviewerPrompt).not.toContain('ASSUMPTION SENTINEL')
    expect(fixture.materialized).toEqual([1])
    const types = fixture.emitted.map((e) => e.type)
    expect(types).toContain('round_open')
    expect(types).toContain('convergence')
    expect(types).toContain('round_close')
  })

  it('halts to the early gate with the open blockers when the cap is hit (S)', async () => {
    const dir = makeDir()
    const blocker = resolution({ id: 'F1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' })
    const material = resolution({ id: 'F2', class: 'MATERIAL', resolution: 'edited', outcome: 'gap narrowed' })
    const fixture = makeLoopFixture(dir, {
      reviewer: [JSON.stringify({ findings: [finding({ id: 'F1', class: 'BLOCKER' }), finding({ id: 'F2' })] })],
      resolver: [JSON.stringify({ resolutions: [blocker, material], assumptions: [] })],
    })
    const result = await runReviewLoop(fixture.deps, {
      changeName: 'add-thing',
      changeDir: fixture.changeDir,
      depth: 'S',
      taskText: 'x',
      conventions: 'y',
    })
    expect(result.outcome).toBe('cap-hit')
    expect(result.openBlockers).toEqual([blocker])
    expect(result.openMaterial).toEqual([material])
  })

  it('feeds the resolutions ledger to the next round reviewer', async () => {
    const dir = makeDir()
    const openFirst = JSON.stringify({
      resolutions: [
        { id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'answered verbatim in design D2' },
      ],
      assumptions: [],
    })
    const fixture = makeLoopFixture(dir, {
      reviewer: [JSON.stringify({ findings: [finding()] }), JSON.stringify({ findings: [] })],
      resolver: [openFirst, JSON.stringify({ resolutions: [], assumptions: [] })],
    })
    const result = await runReviewLoop(fixture.deps, {
      changeName: 'add-thing',
      changeDir: fixture.changeDir,
      depth: 'M',
      taskText: 'x',
      conventions: 'y',
    })
    expect(result.rounds).toBe(2)
    const round2Prompt = promptOf(fixture, 'reviewer-2')
    expect(round2Prompt).toContain('answered verbatim in design D2')
  })

  it('adds the skeptic lens at M after round 2 closes with open blockers', async () => {
    const dir = makeDir()
    const openBlocker = JSON.stringify({
      resolutions: [{ id: 'F1', class: 'BLOCKER', resolution: 'assumed', outcome: 'defaulted' }],
      assumptions: [],
    })
    const fixture = makeLoopFixture(dir, {
      reviewer: [
        JSON.stringify({ findings: [finding({ class: 'BLOCKER' })] }),
        JSON.stringify({ findings: [finding({ class: 'BLOCKER' })] }),
        JSON.stringify({ findings: [] }),
      ],
      skeptic: [JSON.stringify({ findings: [] })],
      resolver: [openBlocker, openBlocker, JSON.stringify({ resolutions: [], assumptions: [] })],
    })
    const result = await runReviewLoop(fixture.deps, {
      changeName: 'add-thing',
      changeDir: fixture.changeDir,
      depth: 'M',
      taskText: 'x',
      conventions: 'y',
    })
    expect(result.rounds).toBe(3)
    expect(fixture.spawnCounts.get('skeptic')).toBe(1)
    expect(fixture.spawnCounts.get('reviewer')).toBe(3)
  })

  it('merges duplicate findings across concurrent lenses at L before resolving', async () => {
    const dir = makeDir()
    const fixture = makeLoopFixture(dir, {
      reviewer: [JSON.stringify({ findings: [finding()] })],
      skeptic: [JSON.stringify({ findings: [finding({ id: 'F9' })] })],
      resolver: [NO_BLOCKERS_RESOLUTIONS],
    })
    const result = await runReviewLoop(fixture.deps, {
      changeName: 'add-thing',
      changeDir: fixture.changeDir,
      depth: 'L',
      taskText: 'x',
      conventions: 'y',
    })
    expect(result.outcome).toBe('converged')
    const resolverPrompt = promptOf(fixture, 'resolver-1')
    const gapOccurrences = resolverPrompt.split('the proposal never names the scope id').length - 1
    expect(gapOccurrences).toBe(1)
  })

  it('honors { startRound, cap } to re-enter at a bumped cap, emitting only that round_open and threading the prior cap-hit ledger', async () => {
    const dir = makeDir()
    fs.mkdirSync(path.join(dir, 'sidecars'), { recursive: true })
    const priorLedgerMarker = 'PRIOR-LEDGER-MARKER-FROM-ROUND-3'
    const priorResolution = {
      id: 'F1',
      class: 'BLOCKER',
      resolution: 'assumed',
      outcome: priorLedgerMarker,
    }
    fs.writeFileSync(
      path.join(dir, 'sidecars', 'resolutions-3.json'),
      JSON.stringify({ resolutions: [priorResolution], assumptions: [] }),
    )
    const fixture = makeLoopFixture(dir, {
      reviewer: [JSON.stringify({ findings: [] })],
      resolver: [NO_BLOCKERS_RESOLUTIONS],
    })
    const result = await runReviewLoop(
      fixture.deps,
      {
        changeName: 'add-thing',
        changeDir: fixture.changeDir,
        depth: 'M',
        taskText: 'x',
        conventions: 'y',
      },
      { startRound: 4, cap: 4 },
    )
    expect(result.outcome).toBe('converged')
    expect(result.rounds).toBe(4)
    const roundOpens = fixture.emitted.filter((e) => e.type === 'round_open')
    expect(roundOpens).toHaveLength(1)
    expect(roundOpens[0]).toMatchObject({ type: 'round_open', round: 4, cap: 4 })
    const reviewerPrompt = promptOf(fixture, 'reviewer-1')
    expect(reviewerPrompt).toContain(priorLedgerMarker)
  })
})
