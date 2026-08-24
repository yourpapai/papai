// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { EventInput, SddEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { runPlanGateResume } from '../../sdd-runner/src/plan-gate-resume.js'
import type { PlanGateResumeDeps } from '../../sdd-runner/src/plan-gate-resume.js'
import { materializeChildFiles } from '../../sdd-runner/src/plan.js'
import type { PlanChild } from '../../sdd-runner/src/plan.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-plangate-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const PLAN: readonly PlanChild[] = [
  { id: 'db-schema', instruction: 'Rename the schema columns.', deps: [] },
  { id: 'db-api', instruction: 'Rename the API route helpers.', deps: ['db-schema'] },
]

async function seedParent(gateMd: string): Promise<{ repoRoot: string; deps: OrchestratorDeps; state: RunState }> {
  const repoRoot = makeDir()
  const workDir = path.join(repoRoot, '.sdd-runner')
  const state = await createRunState({ workDir, repoRoot, changeName: 'composite' })
  fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
  fs.writeFileSync(path.join(state.runDir, 'sidecars', 'plan.json'), JSON.stringify({ children: PLAN }))
  await materializeChildFiles({ children: PLAN }, state.runDir)
  state.gate = { mode: 'plan', version: 1 }
  state.plan = { childIds: ['db-schema', 'db-api'], digest: 'd'.repeat(16) }
  state.children = { 'db-schema': { status: 'pending' }, 'db-api': { status: 'pending' } }
  await saveRunState(state, new Date('2026-08-12T08:00:00.000Z'))
  fs.writeFileSync(path.join(state.runDir, 'gate-1.md'), gateMd)
  fs.writeFileSync(path.join(state.runDir, 'gate-hashes-1.json'), '{}\n')
  const deps: OrchestratorDeps = {
    config: { repoRoot, workDir, model: 'test-model', budget: 5 },
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: createOpenSpecDriver({
      exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
      cwd: repoRoot,
    }),
    resolveCost: () => null,
    now: () => new Date('2026-08-12T08:00:00.000Z'),
  }
  return { repoRoot, deps, state }
}

function makeEmit(state: RunState): (event: EventInput) => void {
  return (event) => {
    appendEvent(path.join(state.runDir, 'events.ndjson'), event)
  }
}

const CHECKED_GATE = [
  '## Plan gate — change composite',
  '',
  '- [x] C1 db-schema — Rename the schema columns.',
  '- [x] C2 db-api — Rename the API route helpers. · deps: db-schema',
  '',
].join('\n')

/** Starter double for paths that must never spawn a child (aborts, rejections). */
const neverStartChild: PlanGateResumeDeps['startChildRun'] = () => {
  throw new Error('startChildRun must not be called on this path')
}

describe('runPlanGateResume (D12)', () => {
  it('an approved plan gate emits answered mode plan and drives runChildren through the injected starter', async () => {
    const { repoRoot, deps, state } = await seedParent(CHECKED_GATE)
    const started: string[] = []
    const planDeps: PlanGateResumeDeps = {
      startChildRun: async (child, taskFile) => {
        started.push(`${child.id}:${path.basename(taskFile)}`)
        const childState = await createRunState({
          workDir: deps.config.workDir,
          repoRoot,
          changeName: child.id,
        })
        childState.gate = { mode: 'final', version: 1 }
        await saveRunState(childState, new Date('2026-08-12T08:00:00.000Z'))
        return { runId: childState.runId }
      },
    }

    const result = await runPlanGateResume(deps, state, {}, makeEmit(state), planDeps)

    expect(result).toMatchObject({ runId: state.runId, outcome: 'approved', version: 1 })
    expect(started).toEqual(['db-schema:1-db-schema.md'])
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.gate).toBe(null)
    expect(persisted.children?.['db-schema']).toEqual({ status: 'running' })
    const events = readEvents(path.join(state.runDir, 'events.ndjson'))
    const answered = gateAnsweredOf(events)
    expect(answered).toHaveLength(1)
    expect(answered[0]).toMatchObject({ mode: 'plan', version: 1 })
    expect(events.filter((e) => e.type === 'child_spawned')).toHaveLength(1)
  })

  it('an abort flag finalizes the gate aborted before any child exists', async () => {
    const { deps, state } = await seedParent(CHECKED_GATE)

    const result = await runPlanGateResume(deps, state, { abort: true }, makeEmit(state), {
      startChildRun: neverStartChild,
    })

    expect(result).toMatchObject({ outcome: 'aborted', version: 1 })
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.status).toBe('aborted')
    expect(persisted.gate).toBe(null)
    const events = readEvents(path.join(state.runDir, 'events.ndjson'))
    expect(events.filter((e) => e.type === 'child_spawned')).toHaveLength(0)
    expect(gateAnsweredOf(events)).toHaveLength(1)
  })

  it('vetoes desugar through the render-then-parse grammar, then route into the replan planner', async () => {
    const { repoRoot, deps, state } = await seedParent(CHECKED_GATE)
    const plannerPrompts: string[] = []
    const spawnTracking: OrchestratorDeps = {
      ...deps,
      spawn: (_command, args) => {
        plannerPrompts.push(String(args[args.length - 1]))
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      },
    }

    const failure = await runPlanGateResume(
      spawnTracking,
      state,
      { confirmAll: true, vetoes: [{ id: 'C1', redirect: 'split the schema child' }] },
      makeEmit(state),
      { startChildRun: neverStartChild },
    ).catch((error: unknown) => error)

    // The fake spawn writes no sidecar, so the routed replan fails loudly —
    // but only after the redirect reached the planner prompt.
    assert(failure instanceof Error)
    expect(plannerPrompts.some((prompt) => prompt.includes('split the schema child'))).toBe(true)
    expect(plannerPrompts.some((prompt) => prompt.includes('db-schema'))).toBe(true)
    expect(repoRoot.length).toBeGreaterThan(0)
    const md = fs.readFileSync(path.join(state.runDir, 'gate-1.md'), 'utf8')
    expect(md).toContain('- [ ] C1 db-schema — Rename the schema columns.')
    expect(md).toContain('→ split the schema child')
    expect(md).toContain('- [x] C2 db-api — Rename the API route helpers. · deps: db-schema')
  })

  it('an extend flag is rejected by the parser at plan mode (cap-hit only)', async () => {
    const { deps, state } = await seedParent(CHECKED_GATE)

    const failure = await runPlanGateResume(deps, state, { extend: true }, makeEmit(state), {
      startChildRun: neverStartChild,
    }).catch((error: unknown) => error)

    assert(failure instanceof Error)
    expect(failure.message).toMatch(/RUN 1 MORE.*plan gate.*cap-hit/u)
  })

  it('an unknown veto id fails before anything is written', async () => {
    const { deps, state } = await seedParent(CHECKED_GATE)
    const before = fs.readFileSync(path.join(state.runDir, 'gate-1.md'), 'utf8')

    const failure = await runPlanGateResume(
      deps,
      state,
      { confirmAll: true, vetoes: [{ id: 'C9' }] },
      makeEmit(state),
      { startChildRun: neverStartChild },
    ).catch((error: unknown) => error)

    assert(failure instanceof Error)
    expect(failure.message).toMatch(/unknown veto id: C9/u)
    expect(fs.readFileSync(path.join(state.runDir, 'gate-1.md'), 'utf8')).toBe(before)
  })
})

function gateAnsweredOf(events: readonly SddEvent[]): Extract<SddEvent, { type: 'gate' }>[] {
  return events.filter((e): e is Extract<SddEvent, { type: 'gate' }> => e.type === 'gate' && e.action === 'answered')
}
