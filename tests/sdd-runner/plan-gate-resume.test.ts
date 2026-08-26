// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { EventInput, SddEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { runPlanGateResume } from '../../sdd-runner/src/plan-gate-resume.js'
import type { PlanGateResumeDeps } from '../../sdd-runner/src/plan-gate-resume.js'
import { materializeChildFiles, planDigest } from '../../sdd-runner/src/plan.js'
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
  state.plan = { childIds: ['db-schema', 'db-api'], digest: planDigest([...PLAN]) }
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

/** Presented-digest shape: every C-box unchecked, `→`/`ABORT` mentioned in prose only. */
const UNCHECKED_GATE = [
  '## Plan gate — change composite',
  '',
  'Check every child box to approve the plan. Leave a child box unchecked to veto that child (`→ <redirect>` beneath steers the replan; vetoing every child needs at least one `→` line or `ABORT` — an all-unchecked file reads as no decision).',
  'Write `ABORT` on its own line to abort.',
  '',
  '### Decisions',
  '',
  '- **approve** — executes the children sequentially as nested runs in plan order',
  '- **veto** (leave a box unchecked) — revises the plan once with the redirects, then re-gates',
  '- **abort** (`ABORT` on its own line) — aborts the parent before any child runs',
  '',
  '### Children (topo order)',
  '',
  '- [ ] C1 db-schema — Rename the schema columns.',
  '- [ ] C2 db-api — Rename the API route helpers. · deps: db-schema',
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

  it('a flagless resume of an untouched plan gate abandons instead of parsing an all-children veto', async () => {
    const { deps, state } = await seedParent(UNCHECKED_GATE)
    const stdoutLines: string[] = []
    const spawnCalls: string[] = []
    const tracking: OrchestratorDeps = {
      ...deps,
      stdout: (line: string) => {
        stdoutLines.push(line)
      },
      spawn: (command: string) => {
        spawnCalls.push(command)
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      },
    }

    const logPath = path.join(state.runDir, 'events.ndjson')
    fs.writeFileSync(logPath, '')
    const result = await runPlanGateResume(tracking, state, {}, makeEmit(state), { startChildRun: neverStartChild })

    expect(result).toMatchObject({ runId: state.runId, outcome: 'abandoned', version: 1 })
    expect(spawnCalls).toEqual([])
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })
    expect(gateAnsweredOf(readEvents(logPath))).toHaveLength(0)
    expect(stdoutLines.some((line) => line.includes('no decision yet'))).toBe(true)
  })

  it('a hand-written ABORT line settles through the flagless parse (not blocked by the unanswered guard)', async () => {
    const { deps, state } = await seedParent(`${UNCHECKED_GATE}\nABORT\n`)

    const result = await runPlanGateResume(deps, state, {}, makeEmit(state), { startChildRun: neverStartChild })

    expect(result).toMatchObject({ outcome: 'aborted', version: 1 })
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.status).toBe('aborted')
  })

  it('a hand-edited redirect under an unchecked child still parses into the replan (veto protocol intact)', async () => {
    const { deps, state } = await seedParent(
      [
        '- [ ] C1 db-schema — Rename the schema columns.',
        '→ split the schema child',
        '- [ ] C2 db-api — Rename the API route helpers. · deps: db-schema',
        '',
      ].join('\n'),
    )
    const plannerPrompts: string[] = []
    const tracking: OrchestratorDeps = {
      ...deps,
      spawn: (_command: string, args: readonly string[]) => {
        plannerPrompts.push(String(args[args.length - 1]))
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      },
    }

    const failure = await runPlanGateResume(tracking, state, {}, makeEmit(state), {
      startChildRun: neverStartChild,
    }).catch((error: unknown) => error)

    assert(failure instanceof Error)
    expect(plannerPrompts.some((prompt) => prompt.includes('split the schema child'))).toBe(true)
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

  it('a veto round whose replan exhausted the structural bound leaves the gate decidable, not wedged', async () => {
    const { deps, state } = await seedParent(CHECKED_GATE)
    // Every planner pass returns a draft that never passes structural
    // validation: a dependency cycle plus a child the pending gate never saw.
    const cyclicDraft = JSON.stringify({
      children: [
        { id: 'db-schema', instruction: 'Rename the schema columns.', deps: [] },
        { id: 'db-migrations', instruction: 'Add the migration files.', deps: ['db-api'] },
        { id: 'db-api', instruction: 'Rename the API route helpers.', deps: ['db-migrations'] },
      ],
    })
    const tracking: OrchestratorDeps = {
      ...deps,
      spawn: (_command, args, options) => {
        const target = promptScratchOf(args, options.cwd)
        fs.mkdirSync(path.dirname(target), { recursive: true })
        fs.writeFileSync(target, cyclicDraft)
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      },
    }

    const failure = await runPlanGateResume(
      tracking,
      state,
      { confirmAll: true, vetoes: [{ id: 'C1', redirect: 'split the schema child' }] },
      makeEmit(state),
      { startChildRun: neverStartChild },
    ).catch((error: unknown) => error)

    assert(failure instanceof Error)
    expect(failure.message).toMatch(/dependency cycle/u)

    // Operator recovery: the pending gate is still decidable — hand-edit it to
    // ABORT and rerun; the resume must reach the gate, not throw on the sidecar.
    fs.writeFileSync(path.join(state.runDir, 'gate-1.md'), `${UNCHECKED_GATE}\nABORT\n`)
    const result = await runPlanGateResume(deps, state, {}, makeEmit(state), { startChildRun: neverStartChild })

    expect(result).toMatchObject({ outcome: 'aborted', version: 1 })
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.status).toBe('aborted')
  })

  it('an interrupted replan (sidecar moved past the pending gate plan) is recovered by re-presenting, not stranded', async () => {
    const { deps, state } = await seedParent(CHECKED_GATE)
    // Crash aftermath of a settlePlanVeto: the planner spawn already overwrote
    // the sidecar with the revised plan (db-api replaced by db-migrations), but
    // the process died before state.plan was persisted — gate-1 still pending.
    fs.writeFileSync(
      path.join(state.runDir, 'sidecars', 'plan.json'),
      JSON.stringify({
        children: [
          { id: 'db-schema', instruction: 'Rename the schema columns.', deps: [] },
          { id: 'db-migrations', instruction: 'Add the migration files.', deps: ['db-schema'] },
        ],
      }),
    )
    const stdoutLines: string[] = []
    const tracking: OrchestratorDeps = {
      ...deps,
      stdout: (line) => {
        stdoutLines.push(line)
      },
    }

    const result = await runPlanGateResume(tracking, state, {}, makeEmit(state), { startChildRun: neverStartChild })

    expect(result).toMatchObject({ runId: state.runId, outcome: 'veto', version: 2 })
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.plan?.childIds).toEqual(['db-schema', 'db-migrations'])
    expect(persisted.children).toEqual({
      'db-schema': { status: 'pending' },
      'db-migrations': { status: 'pending' },
    })
    expect(persisted.gate).toEqual({ mode: 'plan', version: 2 })
    const gate2 = fs.readFileSync(path.join(state.runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('- [ ] C1 db-schema — Rename the schema columns.')
    expect(gate2).toContain('- [ ] C2 db-migrations — Add the migration files.')
    expect(fs.existsSync(path.join(state.runDir, 'children', '2-db-migrations.md'))).toBe(true)
    expect(fs.existsSync(path.join(state.runDir, 'children', '2-db-api.md'))).toBe(false)
    const planEvents = readEvents(path.join(state.runDir, 'events.ndjson')).filter((e) => e.type === 'plan')
    expect(planEvents).toHaveLength(1)
    expect(planEvents[0]).toMatchObject({ childCount: 2 })
    expect(stdoutLines.some((line) => line.includes('interrupted replan'))).toBe(true)
  })

  it('a replan that persisted state.plan but crashed before the re-presentation is recovered, not parsed against stale veto marks', async () => {
    const vetoedOldPlan = [
      '- [x] C1 db-schema — Rename the schema columns.',
      '- [ ] C2 db-api — Rename the API route helpers. · deps: db-schema',
      '→ split the API child',
      '',
    ].join('\n')
    const { deps, state } = await seedParent(vetoedOldPlan)
    // Crash aftermath of a settlePlanVeto past its `saveRunState`: sidecar and
    // state.plan both hold the revised plan (digest agrees), but the
    // re-present never ran — state.gate still points at gate-1, whose veto
    // mark was made about db-api, not db-migrations.
    const revised: readonly PlanChild[] = [
      { id: 'db-schema', instruction: 'Rename the schema columns.', deps: [] },
      { id: 'db-migrations', instruction: 'Add the migration files.', deps: ['db-schema'] },
    ]
    fs.writeFileSync(path.join(state.runDir, 'sidecars', 'plan.json'), JSON.stringify({ children: revised }))
    state.plan = { childIds: revised.map((child) => child.id), digest: planDigest([...revised]) }
    state.children = { 'db-schema': { status: 'pending' }, 'db-migrations': { status: 'pending' } }
    await saveRunState(state, new Date('2026-08-12T08:00:00.000Z'))
    const emit = makeEmit(state)
    const log = path.join(state.runDir, 'events.ndjson')
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'plan', version: 1 })
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'answered', mode: 'plan', version: 1 })
    appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 2, digest: planDigest([...revised]) })
    const spawnCalls: string[] = []
    const tracking: OrchestratorDeps = {
      ...deps,
      spawn: (command: string) => {
        spawnCalls.push(command)
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      },
    }

    const result = await runPlanGateResume(tracking, state, {}, emit, { startChildRun: neverStartChild })

    expect(result).toMatchObject({ runId: state.runId, outcome: 'veto', version: 2 })
    expect(spawnCalls).toEqual([])
    const gate2 = fs.readFileSync(path.join(state.runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('- [ ] C2 db-migrations — Add the migration files.')
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 2 })
  })

  it('an instruction-only replan that crashed before the emit/persist is recovered by the digest check', async () => {
    const { deps, state } = await seedParent(CHECKED_GATE)
    // Crash aftermath between the planner's sidecar overwrite and
    // presentReplannedGate's emit/persist: same child ids, a revised db-api
    // instruction in the sidecar, while state.plan still describes the
    // pre-replan plan — digest included.
    const revised: readonly PlanChild[] = [
      { id: 'db-schema', instruction: 'Rename the schema columns.', deps: [] },
      { id: 'db-api', instruction: 'Rename the API route helpers and add tests.', deps: ['db-schema'] },
    ]
    fs.writeFileSync(path.join(state.runDir, 'sidecars', 'plan.json'), JSON.stringify({ children: revised }))
    const emit = makeEmit(state)
    const log = path.join(state.runDir, 'events.ndjson')
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'plan', version: 1 })
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'answered', mode: 'plan', version: 1 })
    const spawnCalls: string[] = []
    const tracking: OrchestratorDeps = {
      ...deps,
      spawn: (command: string) => {
        spawnCalls.push(command)
        return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
      },
    }

    const result = await runPlanGateResume(tracking, state, {}, emit, { startChildRun: neverStartChild })

    expect(result).toMatchObject({ runId: state.runId, outcome: 'veto', version: 2 })
    expect(spawnCalls).toEqual([])
    const gate2 = fs.readFileSync(path.join(state.runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('- [ ] C2 db-api — Rename the API route helpers and add tests.')
  })

  it('a plan-gate presentation newer than the persisted gate version (crash before the gate persist) is recovered', async () => {
    const { deps, state } = await seedParent(UNCHECKED_GATE)
    // Crash aftermath inside presentGateAt: gate-2 was presented (event
    // appended) but state.gate never persisted the bump — the stale gate-1
    // would otherwise abandon instead of adopting the presented revision.
    const emit = makeEmit(state)
    const log = path.join(state.runDir, 'events.ndjson')
    appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 2, digest: planDigest([...PLAN]) })
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'plan', version: 1 })
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'answered', mode: 'plan', version: 1 })
    appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 2, digest: planDigest([...PLAN]) })
    appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'plan', version: 2 })

    const result = await runPlanGateResume(deps, state, {}, emit, { startChildRun: neverStartChild })

    expect(result).toMatchObject({ runId: state.runId, outcome: 'veto', version: 2 })
    const gate2 = fs.readFileSync(path.join(state.runDir, 'gate-2.md'), 'utf8')
    expect(gate2).toContain('- [ ] C1 db-schema — Rename the schema columns.')
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.gate).toEqual({ mode: 'plan', version: 2 })
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

/** Scratch path the spawn prompt's `.review-loop/<name>.json` target resolves to. */
function promptScratchOf(args: readonly string[], cwd: string): string {
  const match = String(args[args.length - 1]).match(/\.review-loop\/([\w-]+\.json)/u)
  return agentWritePath(cwd, match?.[1] ?? 'plan.json')
}
