// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import { readReviewResultFromSidecars } from '../../sdd-runner/src/gate-digest.js'
import type { OrchestratorDeps, StageContext } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { PlanSchema } from '../../sdd-runner/src/plan.js'
import { buildSplitReentryTaskText, runPostConvergenceTail } from '../../sdd-runner/src/post-review-tail.js'
import { createRunState, loadRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-tail-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const REVIEW_RESULT = {
  outcome: 'converged' as const,
  rounds: 1,
  openBlockers: [],
  openMaterial: [],
  openNitpicks: [],
}

async function setup(setupOptions: { readonly decomposeSidecar?: string; readonly planDraft?: unknown } = {}): Promise<{
  deps: OrchestratorDeps
  state: RunState
  spawnOrder: string[]
  prompts: string[]
  logPath: string
  spawn: Parameters<OrchestratorDeps['spawn']>[0] extends never ? never : OrchestratorDeps['spawn']
}> {
  const repoRoot = makeDir()
  const changeName = 'add-thing'
  const changeDir = path.join(repoRoot, 'openspec', 'changes', changeName)
  const spawnOrder: string[] = []
  const prompts: string[] = []
  const artifacts: Record<string, string> = {
    'decompose-tasks.json': path.join(changeDir, 'tasks.md'),
  }
  const sidecars: Record<string, string> = {
    'decompose-tasks.json':
      setupOptions.decomposeSidecar ?? JSON.stringify({ tasks_file: 'openspec/changes/add-thing/tasks.md' }),
    'atomicity.json': JSON.stringify({ split: 0, merged: 0 }),
    ...(setupOptions.planDraft === undefined ? {} : { 'plan-draft.json': JSON.stringify(setupOptions.planDraft) }),
  }
  const spawn = (
    _command: unknown,
    args: readonly string[],
    options: { cwd?: string },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> => {
    const prompt = String(args[args.length - 1])
    const match = prompt.match(/\.review-loop\/([\w-]+\.json)/u)
    const basename = match?.[1] ?? 'unknown.json'
    spawnOrder.push(basename)
    prompts.push(prompt)
    if (artifacts[basename] !== undefined) {
      fs.mkdirSync(path.dirname(artifacts[basename]), { recursive: true })
      fs.writeFileSync(artifacts[basename], `<!-- content for ${basename} -->\n`)
    }
    const target = path.join(options.cwd ?? repoRoot, '.review-loop', basename)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, sidecars[basename] ?? '{}')
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  const driver = createOpenSpecDriver({
    exec: (args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      const [bin, subcommand, ...rest] = args
      void bin
      if (subcommand === 'instructions') {
        return Promise.resolve({
          stdout: JSON.stringify({
            instruction: `write the ${rest[0]}`,
            resolvedOutputPath: path.join(changeDir, 'tasks.md'),
          }),
          stderr: '',
          exitCode: 0,
        })
      }
      return Promise.resolve({ stdout: 'is valid', stderr: '', exitCode: 0 })
    },
    cwd: repoRoot,
  })
  const deps: OrchestratorDeps = {
    config: {
      repoRoot,
      workDir: path.join(repoRoot, '.sdd-runner'),
      model: 'test-model',
      budget: 5,
    },
    spawn,
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver,
    resolveCost: () => null,
  }
  const state = await createRunState({
    workDir: deps.config.workDir,
    repoRoot,
    changeName,
  })
  fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
  const logPath = path.join(state.runDir, 'events.ndjson')
  fs.writeFileSync(logPath, '')
  return { deps, state, spawnOrder, prompts, logPath, spawn }
}

function makeCtx(deps: OrchestratorDeps, state: RunState, logPath: string): StageContext {
  return {
    cwd: deps.config.repoRoot,
    changeDir: path.join(deps.config.repoRoot, 'openspec', 'changes', state.changeName),
    sidecarDir: path.join(state.runDir, 'sidecars'),
    emit: (event: EventInput): void => {
      appendEvent(logPath, event)
    },
  }
}

describe('runPostConvergenceTail', () => {
  it('runs decompose then atomicity then presents the final gate at the given version (M)', async () => {
    const { deps, state, spawnOrder, logPath } = await setup()
    const ctx = makeCtx(deps, state, logPath)
    const result = await runPostConvergenceTail({
      deps,
      state,
      ctx,
      agent: {
        spawn: deps.spawn,
        config: deps.config,
        execGit: deps.execGit,
        emit: ctx.emit,
      },
      depth: 'M',
      reviewResult: REVIEW_RESULT,
      version: 2,
    })
    expect(result.version).toBe(2)
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).toContain('Final gate')
    expect(spawnOrder.indexOf('decompose-tasks.json')).toBeLessThan(spawnOrder.indexOf('atomicity.json'))
    const events = readEvents(logPath)
    const stages = events.filter((e) => e.type === 'stage_enter').map((e) => (e as { stage: string }).stage)
    expect(stages).toEqual(['decompose', 'atomicity', 'gate'])
    expect(state.gate).toEqual({ mode: 'final', version: 2 })
  })

  it('skips atomicity at S but still presents the final gate', async () => {
    const { deps, state, spawnOrder, logPath } = await setup()
    const ctx = makeCtx(deps, state, logPath)
    const result = await runPostConvergenceTail({
      deps,
      state,
      ctx,
      agent: {
        spawn: deps.spawn,
        config: deps.config,
        execGit: deps.execGit,
        emit: ctx.emit,
      },
      depth: 'S',
      reviewResult: REVIEW_RESULT,
      version: 1,
    })
    expect(result.version).toBe(1)
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).toContain('Final gate')
    expect(spawnOrder).toContain('decompose-tasks.json')
    expect(spawnOrder).not.toContain('atomicity.json')
  })

  it('preserves the review result source outcome for gate rendering', async () => {
    const sidecarDir = path.join(makeDir(), 'sidecars')
    fs.mkdirSync(sidecarDir, { recursive: true })
    fs.writeFileSync(path.join(sidecarDir, 'resolutions-3.json'), JSON.stringify({ resolutions: [], assumptions: [] }))
    const capHit = await readReviewResultFromSidecars(sidecarDir, 3, 'cap-hit')
    expect(capHit.outcome).toBe('cap-hit')
    expect(capHit.rounds).toBe(3)
  })
})

describe('policy prelude at the final-gate seam', () => {
  it('runPostConvergenceTail presents the gate with an audit record (sidecar + event)', async () => {
    const setupResult = await setup()
    const { deps, state, logPath } = setupResult
    const ctx = makeCtx(deps, state, logPath)
    await runPostConvergenceTail({
      deps,
      state,
      ctx,
      agent: { spawn: setupResult.spawn, config: deps.config, execGit: deps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: REVIEW_RESULT,
      version: 1,
    })
    const gateMd = fs.readFileSync(path.join(state.runDir, 'gate-1.md'), 'utf8')
    expect(gateMd).toContain('### Auto-decision preview')
    expect(fs.existsSync(path.join(state.runDir, 'auto-policy.jsonl'))).toBe(true)
    const autoDecisions = readEvents(logPath).filter((e) => e.type === 'auto_decision')
    expect(autoDecisions).toHaveLength(1)
    expect(autoDecisions[0]).toMatchObject({ decision: 'gate', gateVersion: 1 })
  })
})

describe('runPostConvergenceTail needs_split diversion (D5)', () => {
  it('diverts between decompose and atomicity — no atomicity spawn, no final gate, planner re-entry, plan-gate conversion', async () => {
    const { deps, state, spawnOrder, prompts, logPath, spawn } = await setup({
      decomposeSidecar: JSON.stringify({ tasks_file: 'openspec/changes/add-thing/tasks.md', needs_split: true }),
      planDraft: {
        children: [
          { id: 'auth-db', instruction: 'Ship the drafted slice.', deps: [] },
          { id: 'auth-api', instruction: 'Partition the remainder.', deps: ['auth-db'] },
        ],
      },
    })
    fs.writeFileSync(path.join(state.runDir, 'task.md'), '# Add thing\n\nThe original task body.\n')
    const changeDir = path.join(deps.config.repoRoot, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(changeDir, { recursive: true })
    fs.writeFileSync(
      path.join(changeDir, 'proposal.md'),
      '## Why\n\nThe rename must land safely.\n\n## Impact\n\n- drizzle schema\n- api routes\n',
    )
    const ctx = makeCtx(deps, state, logPath)

    const result = await runPostConvergenceTail({
      deps,
      state,
      ctx,
      agent: { spawn, config: deps.config, execGit: deps.execGit, emit: ctx.emit },
      depth: 'M',
      reviewResult: REVIEW_RESULT,
      version: 3,
    })

    expect(spawnOrder).toEqual(['decompose-tasks.json', 'plan-draft.json'])
    expect(fs.existsSync(path.join(state.runDir, 'gate-3.md'))).toBe(false)
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('The original task body.')
    expect(prompts[1]).toContain('add-thing')
    expect(prompts[1]).toContain('The rename must land safely.')
    expect(prompts[1]).toContain('drizzle schema')
    expect(prompts[1]).toContain('<!-- content for decompose-tasks.json -->')
    const stages = readEvents(logPath)
      .filter((e) => e.type === 'stage_enter')
      .map((e) => (e as { stage: string }).stage)
    expect(stages).toEqual(['decompose'])
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.plan).toMatchObject({ childIds: ['auth-db', 'auth-api'] })
    expect(persisted.children).toEqual({ 'auth-db': { status: 'pending' }, 'auth-api': { status: 'pending' } })
    expect(persisted.gate).toEqual({ mode: 'plan', version: 1 })
    expect(readEvents(logPath).some((e) => e.type === 'plan')).toBe(true)
    expect(result.halted).toBe('gate')
    expect(result.version).toBe(1)
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).toContain('Plan gate')
    const sidecar = PlanSchema.parse(
      JSON.parse(fs.readFileSync(path.join(state.runDir, 'sidecars', 'plan.json'), 'utf8')),
    )
    expect(sidecar.children[0]).toMatchObject({ id: 'auth-db', changeName: 'add-thing' })
    expect(sidecar.children[1]?.changeName).toBeUndefined()
    expect(fs.existsSync(path.join(state.runDir, 'children', '1-auth-db.md'))).toBe(true)
  })

  it("a false needs_split runs today's tail — atomicity spawns and the final gate presents at the given version", async () => {
    const { deps, state, spawnOrder, logPath, spawn } = await setup({
      decomposeSidecar: JSON.stringify({ tasks_file: 'openspec/changes/add-thing/tasks.md', needs_split: false }),
    })
    const ctx = makeCtx(deps, state, logPath)

    const result = await runPostConvergenceTail({
      deps,
      state,
      ctx,
      agent: { spawn, config: deps.config, execGit: deps.execGit, emit: ctx.emit },
      depth: 'M',
      reviewResult: REVIEW_RESULT,
      version: 2,
    })

    expect(spawnOrder.indexOf('decompose-tasks.json')).toBeLessThan(spawnOrder.indexOf('atomicity.json'))
    expect(result.version).toBe(2)
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).toContain('Final gate')
    expect((await loadRunState(deps.config.workDir, state.runId)).plan).toBeUndefined()
  })
})

describe('buildSplitReentryTaskText (D5)', () => {
  it('composes the original task, change name, artifact summary, and re-scoped tasks.md; omits absent sections', () => {
    const composed = buildSplitReentryTaskText({
      originalTask: '# Add thing',
      changeName: 'add-thing',
      artifactSummary: ['what: ship the slice'],
      tasksMd: '## 1. Slice',
    })
    expect(composed).toContain('# Add thing')
    expect(composed).toContain('add-thing')
    expect(composed).toContain('- what: ship the slice')
    expect(composed).toContain('## 1. Slice')
    const bare = buildSplitReentryTaskText({
      originalTask: null,
      changeName: 'add-thing',
      artifactSummary: [],
      tasksMd: '',
    })
    expect(bare).not.toContain('Original task:')
    expect(bare).not.toContain('Drafted artifacts:')
    expect(bare).toContain('add-thing')
  })
})
