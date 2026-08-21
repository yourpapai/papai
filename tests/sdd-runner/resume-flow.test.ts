// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import type { ResumeDecision } from '../../sdd-runner/src/resume-decision.js'
import { nextGateVersion, resumeFromPoint } from '../../sdd-runner/src/resume-flow.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'
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
