// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { runResume } from '../../sdd-runner/src/orchestrator.js'
import type { ResumeDecision } from '../../sdd-runner/src/resume-decision.js'
import {
  pendingDescendantGateOf,
  deriveResumeDecision,
  nextGateVersion,
  resumeFromPoint,
} from '../../sdd-runner/src/resume-flow.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-resume-flow-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeDeps(dir: string): OrchestratorDeps {
  return {
    config: {
      repoRoot: dir,
      workDir: path.join(dir, '.sdd-runner'),
      model: 'm',
      budget: 5,
    },
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: createOpenSpecDriverLike(),
    resolveCost: () => null,
  }
}

function createOpenSpecDriverLike(): OrchestratorDeps['driver'] {
  return {
    newChange: () => Promise.resolve({ changeName: 'add-thing' }),
    instructions: () =>
      Promise.resolve({
        instruction: '',
        template: undefined,
        rules: [],
        resolvedOutputPath: '',
        existingOutputPaths: [],
        dependencies: [],
      }),
    validateStrict: () => Promise.resolve({ ok: true, output: '' }),
    status: () => Promise.resolve({ schemaName: 'auto-sdd', artifacts: {}, isPlanningComplete: false }),
  }
}

function makeCtx(state: RunState): Parameters<typeof resumeFromPoint>[0]['ctx'] {
  return {
    cwd: state.repoRoot,
    changeDir: state.repoRoot,
    sidecarDir: path.join(state.runDir, 'sidecars'),
    emit: () => {},
  }
}

function makeAgent(): Parameters<typeof resumeFromPoint>[0]['agent'] {
  return {
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    config: { repoRoot: '', workDir: '', model: 'm', budget: 5 },
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    emit: () => {},
  }
}

const CONVERGED: ReviewLoopResult = {
  outcome: 'converged',
  rounds: 2,
  openBlockers: [],
  openMaterial: [],
  openNitpicks: [],
}

describe('resumeFromPoint', () => {
  it('continues a review-stage decision through the review runners and the post-review gate', async () => {
    const dir = makeDir()
    const state = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'add-thing' })
    state.depth = 'S'
    state.round = 2
    const calls: string[] = []
    const result = await resumeFromPoint(
      { deps: makeDeps(dir), state, ctx: makeCtx(state), agent: makeAgent() },
      {
        runReviewStage: (_depth, entry) => {
          calls.push(`review:round=${JSON.stringify(entry.startRound)}`)
          return Promise.resolve(CONVERGED)
        },
        runPostReviewToGate: () => {
          calls.push('gate')
          return Promise.resolve({
            runId: state.runId,
            halted: 'gate',
            gateMdPath: path.join(state.runDir, 'gate-1.md'),
            version: 1,
          })
        },
      },
      { path: 'stage-rebuild', stage: 'review', round: 2, reason: 'review loop not converged' },
      'S',
    )
    expect(calls).toEqual(['review:round=1', 'gate'])
    expect(result.halted).toBe('gate')
    expect(result.version).toBe(1)
  })

  it('hands a session-continuation review decision to the review runner with the resumed round', async () => {
    const dir = makeDir()
    const state = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'add-thing' })
    state.depth = 'S'
    state.round = 2
    const decisions: ResumeDecision[] = [
      {
        path: 'session-continuation',
        stage: 'review',
        round: 2,
        reason: 'review loop not converged',
        session: { label: 'resolver-r2', role: 'resolver', round: 2, attempt: 1, opencodeSessionId: 'ses_x' },
      },
    ]
    let seen: { startRound?: number; resumeSession?: unknown } = {}
    await resumeFromPoint(
      { deps: makeDeps(dir), state, ctx: makeCtx(state), agent: makeAgent() },
      {
        runReviewStage: (_depth, entry) => {
          seen = entry
          return Promise.resolve(CONVERGED)
        },
        runPostReviewToGate: () =>
          Promise.resolve({
            runId: state.runId,
            halted: 'gate',
            gateMdPath: path.join(state.runDir, 'gate-1.md'),
            version: 1,
          }),
      },
      decisions[0]!,
      'S',
    )
    expect(seen.startRound).toBe(2)
    expect(seen.resumeSession).toMatchObject({ opencodeSessionId: 'ses_x' })
  })

  it('refuses stages the post-review branches do not cover', async () => {
    const dir = makeDir()
    const state: RunState = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'add-thing' })
    const attempt = resumeFromPoint(
      { deps: makeDeps(dir), state, ctx: makeCtx(state), agent: makeAgent() },
      {
        runReviewStage: () => Promise.resolve(CONVERGED),
        runPostReviewToGate: () => Promise.resolve({ runId: state.runId, halted: 'gate', gateMdPath: '', version: 1 }),
      },
      { path: 'artifact-skip', stage: 'intake', round: 0, reason: 'depth not classified' },
      'S',
    )
    await expect(attempt).rejects.toThrow(/not supported yet/u)
  })
})

describe('deriveResumeDecision', () => {
  function rejectingStatusDeps(dir: string): OrchestratorDeps {
    return {
      ...makeDeps(dir),
      driver: {
        ...createOpenSpecDriverLike(),
        status: () => Promise.reject(new Error('openspec status failed (exit 1): change not found')),
      },
    }
  }

  it('skips driver.status for a plan parent, whose absent change folder cannot fail the resume (D9)', async () => {
    const dir = makeDir()
    const state = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'folderless-parent' })
    state.plan = { childIds: ['db-schema'], digest: 'digest' }
    fs.writeFileSync(path.join(state.runDir, 'events.ndjson'), '')

    const decision = await deriveResumeDecision(rejectingStatusDeps(dir), state)

    expect(decision.stage).toBe('decompose')
    expect(decision.reason).toContain('children pending')
  })

  it('resolves the intake re-run point for a folder-less intake run whose estimator or planner failed before newChange (2.1)', async () => {
    const dir = makeDir()
    const state = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'never-scaffolded' })
    fs.writeFileSync(path.join(state.runDir, 'events.ndjson'), '')

    const decision = await deriveResumeDecision(rejectingStatusDeps(dir), state)

    expect(decision.stage).toBe('intake')
    expect(decision.reason).toBe('depth not classified')
  })

  it("rejects loudly when a single run's driver.status fails instead of routing on empty artifacts", async () => {
    const dir = makeDir()
    const state = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'add-thing' })
    state.depth = 'S'
    fs.writeFileSync(path.join(state.runDir, 'events.ndjson'), '')

    await expect(deriveResumeDecision(rejectingStatusDeps(dir), state)).rejects.toThrow(/openspec status failed/u)
  })
})

describe('nextGateVersion', () => {
  it('derives the next version from existing gate-*.md files, ignoring lookalikes', async () => {
    const dir = makeDir()
    const state = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'add-thing' })
    for (const name of ['gate-1.md', 'gate-10.md', 'gate-50.md.bak', 'notgate-99.md', 'gate-x.md']) {
      fs.writeFileSync(path.join(state.runDir, name), 'stale\n')
    }
    expect(nextGateVersion(state)).toBe(11)
  })
})

interface TreeSeed {
  readonly deps: OrchestratorDeps
  readonly workDir: string
}

/** An approved plan parent whose `db-schema` child is in flight as `child-run-1`. */
async function seedTree(
  dir: string,
  opts: { readonly grandchild?: boolean; readonly childGate?: 'early' | 'plan' | null } = {},
): Promise<TreeSeed> {
  const workDir = path.join(dir, '.sdd-runner')
  const parent = await createRunState({ workDir, repoRoot: dir, changeName: 'composite', runId: 'parent-run' })
  const log = path.join(parent.runDir, 'events.ndjson')
  appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' })
  parent.plan = { childIds: ['db-schema'], digest: 'd'.repeat(16) }
  parent.children = { 'db-schema': { status: 'running' } }
  appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 1, digest: 'd'.repeat(16) })
  appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'plan', version: 1 })
  appendEvent(log, { altitude: 'L2', type: 'gate', action: 'answered', mode: 'plan', version: 1 })
  appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'db-schema', runId: 'child-run-1' })
  await saveRunState(parent)
  fs.mkdirSync(path.join(parent.runDir, 'sidecars'), { recursive: true })
  fs.writeFileSync(
    path.join(parent.runDir, 'sidecars', 'plan.json'),
    JSON.stringify({ children: [{ id: 'db-schema', instruction: 'Rename the schema columns.', deps: [] }] }),
  )
  const child = await createRunState({ workDir, repoRoot: dir, changeName: 'db-schema', runId: 'child-run-1' })
  if (opts.grandchild === true) {
    child.plan = { childIds: ['db-api'], digest: 'e'.repeat(16) }
    child.children = { 'db-api': { status: 'running' } }
    appendEvent(path.join(child.runDir, 'events.ndjson'), {
      altitude: 'L2',
      type: 'child_spawned',
      child: 'db-api',
      runId: 'grand-run-1',
    })
    await saveRunState(child)
    const grand = await createRunState({ workDir, repoRoot: dir, changeName: 'db-api', runId: 'grand-run-1' })
    grand.gate = { mode: 'plan', version: 1 }
    await saveRunState(grand)
  } else if (opts.childGate !== null && opts.childGate !== undefined) {
    child.gate = { mode: opts.childGate, version: 2 }
    await saveRunState(child)
  } else {
    await saveRunState(child)
  }
  return { deps: makeDeps(dir), workDir }
}

describe('pendingDescendantGateOf (D2 descent resolver)', () => {
  it('returns the gate-pending child runId for a one-level tree', async () => {
    const dir = makeDir()
    const { deps } = await seedTree(dir, { childGate: 'early' })
    const state = await loadRunState(deps.config.workDir, 'parent-run')
    expect(await pendingDescendantGateOf(deps, state)).toBe('child-run-1')
  })

  it('returns the deepest gate-pending descendant runId, recursing into grandchildren', async () => {
    const dir = makeDir()
    const { deps } = await seedTree(dir, { grandchild: true })
    const state = await loadRunState(deps.config.workDir, 'parent-run')
    expect(await pendingDescendantGateOf(deps, state)).toBe('grand-run-1')
  })

  it('returns null for a non-parent state — no descent, plain resume', async () => {
    const dir = makeDir()
    const deps = makeDeps(dir)
    const single = await createRunState({ workDir: deps.config.workDir, repoRoot: dir, changeName: 'plain-run' })
    await saveRunState(single)
    expect(await pendingDescendantGateOf(deps, single)).toBe(null)
  })

  it('returns null when no descendant is gate-pending — the parent falls back to plain resume', async () => {
    const dir = makeDir()
    const { deps } = await seedTree(dir, { childGate: null })
    const state = await loadRunState(deps.config.workDir, 'parent-run')
    expect(await pendingDescendantGateOf(deps, state)).toBe(null)
  })
})

describe('runResume plan-parent gate-pending threading (D2)', () => {
  it('threads the gate-pending child runId through the plan-parent resume result', async () => {
    const dir = makeDir()
    const { deps } = await seedTree(dir, { childGate: 'early' })

    const result = await runResume(deps, 'parent-run')

    expect(result).toEqual({ runId: 'parent-run', halted: 'gate-pending', childRunId: 'child-run-1' })
  })
})
