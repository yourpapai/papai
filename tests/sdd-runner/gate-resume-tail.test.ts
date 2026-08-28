// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { GateResumeContext } from '../../sdd-runner/src/extend-round.js'
import type { OrchestratorDeps, StageContext } from '../../sdd-runner/src/gate-digest.js'
import { settleApprovedGate, settlePlanVeto, settleVeto } from '../../sdd-runner/src/gate-resume-tail.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { PlanSchema, planDigest } from '../../sdd-runner/src/plan.js'
import type { PlanChild } from '../../sdd-runner/src/plan.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-resume-tail-'))
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
    spawn: (_command, _args, options) => {
      const target = path.join(options.cwd, '.review-loop', 'veto-updater.json')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, JSON.stringify({ files_updated: [] }))
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    },
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: {
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
    },
    resolveCost: () => null,
    stdout: () => {},
  }
}

function makeCtx(state: RunState, deps: OrchestratorDeps, emit: (e: unknown) => void = () => {}): GateResumeContext {
  const changeDir = path.join(state.repoRoot, 'openspec', 'changes', state.changeName)
  return {
    deps,
    state,
    emit,
    version: 1,
    changeDir,
    sidecarDir: path.join(state.runDir, 'sidecars'),
    agent: { spawn: deps.spawn, config: deps.config, execGit: deps.execGit, emit } as GateResumeContext['agent'],
  }
}

const CONVERGED = {
  outcome: 'converged',
  rounds: 1,
  openBlockers: [],
  openMaterial: [],
  openNitpicks: [],
} as const

describe('gate-resume-tail settle flows', () => {
  it('settles a final-mode approved gate to completed', async () => {
    const dir = makeDir()
    const state = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'add-thing' })
    state.depth = 'S'
    state.gate = { mode: 'final', version: 1 }
    const deps = makeDeps(dir)
    const result = await settleApprovedGate(makeCtx(state, deps), { ...CONVERGED })
    expect(result.outcome).toBe('approved')
    expect(result.version).toBe(1)
    // Awaited via .resolves on purpose: a bare expect(promise).toBeDefined() is
    // vacuously true and leaves the read racing this test's afterEach rmSync —
    // under threadpool load the read lost that race, and the floating ENOENT
    // rejection was attributed to the *next* test (the recurring settleVeto flake).
    await expect(
      (await import('../../sdd-runner/src/run-state.js')).loadRunState(dir, state.runId),
    ).resolves.toBeDefined()
  })

  it('settleVeto re-presents the next gate version after applying vetoes', async () => {
    const dir = makeDir()
    const state = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'add-thing' })
    state.depth = 'S'
    state.round = 1
    // seed an events log (gate signals replay it) and an assumptions sidecar
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(path.join(state.runDir, 'events.ndjson'), '')
    fs.writeFileSync(
      path.join(state.runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({ resolutions: [], assumptions: [] }),
    )
    const deps = makeDeps(dir)
    await expect(
      settleVeto(makeCtx(state, deps), { ...CONVERGED }, [{ id: 'A1', redirect: 'narrow it' }]),
    ).resolves.toMatchObject({ outcome: 'veto', version: 2 })
  })
})

/** deps good for a full settlePlanVeto flight: the spawn writes a fresh planner draft. */
function makePlannerDeps(dir: string, draft: unknown): OrchestratorDeps & { prompts: string[] } {
  const prompts: string[] = []
  return {
    prompts,
    config: { repoRoot: dir, workDir: path.join(dir, '.sdd-runner'), model: 'test-model', budget: 5 },
    spawn: (_command, args, options) => {
      prompts.push(String(args[args.length - 1]))
      const target = path.join(options.cwd, '.review-loop', 'plan-draft.json')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, JSON.stringify(draft))
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    },
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: createOpenSpecDriver({ exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }), cwd: dir }),
    resolveCost: () => null,
    stdout: () => {},
    now: () => new Date('2026-08-12T08:00:00.000Z'),
  }
}

async function seedPlanParent(
  dir: string,
  children: readonly PlanChild[],
): Promise<{ state: RunState; ctx: StageContext }> {
  const state = await createRunState({
    workDir: path.join(dir, '.sdd-runner'),
    repoRoot: dir,
    changeName: 'composite',
  })
  fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
  fs.writeFileSync(path.join(state.runDir, 'sidecars', 'plan.json'), JSON.stringify({ children }))
  fs.writeFileSync(path.join(state.runDir, 'events.ndjson'), '')
  state.gate = { mode: 'plan', version: 1 }
  state.plan = { childIds: children.map((child) => child.id), digest: planDigest([...children]) }
  const ctx: StageContext = {
    cwd: dir,
    changeDir: path.join(dir, 'openspec', 'changes', 'composite'),
    sidecarDir: path.join(state.runDir, 'sidecars'),
    emit: () => {},
  }
  return { state, ctx }
}

const PINNED_PLAN: readonly PlanChild[] = [
  { id: 'db-schema', instruction: 'Ship the drafted schema slice.', deps: [], changeName: 'composite' },
  { id: 'db-api', instruction: 'Rename the API route helpers.', deps: ['db-schema'] },
]

/** What a real replan emits: same children, no `changeName` (the planner prompt's shape never mentions it). */
const REPLANNED_WITHOUT_PIN = {
  children: [
    { id: 'db-schema', instruction: 'Ship the drafted schema slice.', deps: [] },
    { id: 'db-api', instruction: 'Rename the API route helpers.', deps: ['db-schema'] },
  ],
}

describe('settlePlanVeto replans', () => {
  it('re-pins the adopted change the replan dropped, durably in the sidecar the child walk reads', async () => {
    const dir = makeDir()
    const { state, ctx } = await seedPlanParent(dir, PINNED_PLAN)
    const deps = makePlannerDeps(dir, REPLANNED_WITHOUT_PIN)

    const result = await settlePlanVeto(deps, state, ctx, [{ id: 'C2', redirect: 'narrow the api child' }], 1)

    expect(result).toMatchObject({ runId: state.runId, outcome: 'veto', version: 2 })
    const sidecar = PlanSchema.parse(JSON.parse(fs.readFileSync(path.join(ctx.sidecarDir, 'plan.json'), 'utf8')))
    expect(sidecar.children[0]).toMatchObject({ id: 'db-schema', changeName: 'composite' })
    expect(sidecar.children[1]).not.toHaveProperty('changeName')
  })

  it('tells the replan planner which child adopts the existing change folder', async () => {
    const dir = makeDir()
    const { state, ctx } = await seedPlanParent(dir, PINNED_PLAN)
    const deps = makePlannerDeps(dir, REPLANNED_WITHOUT_PIN)

    await settlePlanVeto(deps, state, ctx, [{ id: 'C2', redirect: 'narrow the api child' }], 1)

    const prompt = deps.prompts.find((entry) => entry.includes('Revise this plan'))
    expect(prompt).toContain('(adopts change: composite)')
  })

  it('leaves an ordinary replanned plan untouched (no spurious pin)', async () => {
    const dir = makeDir()
    const ordinary = PINNED_PLAN.map(({ id, instruction, deps: childDeps }) => ({
      id,
      instruction,
      deps: childDeps,
    }))
    const { state, ctx } = await seedPlanParent(dir, ordinary)
    const deps = makePlannerDeps(dir, REPLANNED_WITHOUT_PIN)

    const result = await settlePlanVeto(deps, state, ctx, [{ id: 'C2', redirect: 'narrow the api child' }], 1)

    expect(result).toMatchObject({ outcome: 'veto', version: 2 })
    const sidecar = PlanSchema.parse(JSON.parse(fs.readFileSync(path.join(ctx.sidecarDir, 'plan.json'), 'utf8')))
    expect(sidecar.children.some((child) => child.changeName !== undefined)).toBe(false)
  })
})
