// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it, mock } from 'bun:test'
import type { Mock } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent, readEvents } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps, StageContext } from '../../sdd-runner/src/gate-digest.js'
import { readReviewResultFromSidecars } from '../../sdd-runner/src/gate-sidecars.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { PlanSchema } from '../../sdd-runner/src/plan.js'
import {
  buildSplitReentryTaskText,
  isSeverityConverged,
  routeCapHit,
  runPostConvergenceTail,
  runPostReviewToGate,
} from '../../sdd-runner/src/post-review-tail.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'
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
  verdict: 'converged' as const,
  raised: { blocker: 0, material: 0, nitpick: 0 },
  rounds: 1,
  openBlockers: [],
  openMaterial: [],
  openNitpicks: [],
}

async function setup(
  setupOptions: {
    readonly decomposeSidecar?: string
    readonly planDraft?: unknown
    readonly noDecomposeArtifact?: boolean
  } = {},
): Promise<{
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
  const artifacts: Record<string, string> =
    setupOptions.noDecomposeArtifact === true ? {} : { 'decompose-tasks.json': path.join(changeDir, 'tasks.md') }
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

describe('cap-hit routing by verdict', () => {
  const EMPTY = { blocker: 0, material: 0, nitpick: 0 }

  function capHit(verdict: ReviewLoopResult['verdict'], open: Partial<ReviewLoopResult> = {}): ReviewLoopResult {
    return {
      outcome: 'cap-hit',
      rounds: 2,
      verdict,
      raised: EMPTY,
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
      ...open,
    }
  }

  it('routes a converged cap-hit into the tail with no early gate', () => {
    expect(routeCapHit(capHit('converged'))).toEqual({ kind: 'tail' })
  })

  it('routes a cap-hit with an open material finding to the early gate', () => {
    const open = capHit('open', {
      openMaterial: [{ id: 'F1', class: 'MATERIAL', resolution: 'dismissed', justification: 'j' }],
    })
    expect(routeCapHit(open)).toEqual({ kind: 'early-gate' })
  })

  it('does not gate a nitpick-only cap-hit, however many nitpicks survived', () => {
    // Severity convergence never had a nitpick ceiling; the verdict's
    // three-nitpick bar governs looping, not gating.
    const nitpicky = capHit('open', {
      openNitpicks: Array.from({ length: 5 }, (_, i) => ({
        id: `N${String(i)}`,
        class: 'NITPICK' as const,
        resolution: 'dismissed' as const,
        justification: 'cosmetic',
      })),
    })
    expect(routeCapHit(nitpicky)).toEqual({ kind: 'tail' })
  })

  it('buys exactly one verification round for a needs-review cap-hit', () => {
    expect(routeCapHit(capHit('needs-review'))).toEqual({ kind: 'verify' })
  })

  it('never buys a verification round when a thrashing concern stopped the loop', () => {
    // loop-memory D5: a recurring concern is why the loop stopped, so it can
    // never be spent on a further round — routing goes straight to the tail.
    const recurring = capHit('needs-review', {
      recurringConcerns: [
        {
          fingerprint: 'scope id resurfaces',
          firstRound: 1,
          lastRound: 2,
          entries: [{ round: 1, id: 'F1', class: 'MATERIAL', resolution: 'dismissed' }],
        },
      ],
    })
    expect(routeCapHit(recurring)).toEqual({ kind: 'tail' })
  })

  it('does not buy a second verification round once one has been spent', () => {
    expect(routeCapHit(capHit('needs-review'), { verified: true })).toEqual({ kind: 'tail' })
  })

  it('declines the verification round when the budget guard refuses the spend', () => {
    expect(routeCapHit(capHit('needs-review'), { overBudget: true })).toEqual({ kind: 'tail' })
  })

  it('still gates an open cap-hit even when a verification round was already spent', () => {
    // The verification round can surface a dismissal of its own; that is the
    // human's call, not something the spent round waives.
    const open = capHit('open', {
      openBlockers: [{ id: 'B1', class: 'BLOCKER', resolution: 'dismissed', justification: 'j' }],
    })
    expect(routeCapHit(open, { verified: true })).toEqual({ kind: 'early-gate' })
  })

  it('leaves a converged loop outcome untouched', () => {
    const converged: ReviewLoopResult = { ...capHit('converged'), outcome: 'converged' }
    expect(routeCapHit(converged)).toEqual({ kind: 'tail' })
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
    expect(prompts).toHaveLength(2)
    expect(prompts[0]).toContain('openspec/changes/add-thing/tasks.md')
    expect(prompts[1]).toContain('The original task body.')
    expect(prompts[1]).toContain('add-thing')
    expect(prompts[1]).toContain('The rename must land safely.')
    expect(prompts[1]).toContain('drizzle schema')
    expect(prompts[1]).toContain('<!-- content for decompose-tasks.json -->')
    // The digest bullets ride the composed task text verbatim — prefix-scoped
    // so they cannot be satisfied by the proposal body re-embedded elsewhere.
    expect(prompts[1]).toContain('Drafted artifacts:')
    expect(prompts[1]).toContain('- what: The rename must land safely.')
    expect(prompts[1]).toContain('- why: The rename must land safely.')
    expect(prompts[1]).toContain('- touches: drizzle schema')
    expect(prompts[1]).toContain('- touches: api routes')
    const stages = readEvents(logPath)
      .filter((e) => e.type === 'stage_enter')
      .map((e) => (e as { stage: string }).stage)
    expect(stages).toEqual(['decompose'])
    const persisted = await loadRunState(deps.config.workDir, state.runId)
    expect(persisted.plan).toMatchObject({ childIds: ['auth-db', 'auth-api'] })
    expect(persisted.children).toEqual({ 'auth-db': { status: 'pending' }, 'auth-api': { status: 'pending' } })
    expect(persisted.gate).toEqual({ mode: 'plan', version: 3 })
    expect(readEvents(logPath).some((e) => e.type === 'plan')).toBe(true)
    expect(result.halted).toBe('gate')
    expect(result.version).toBe(3)
    expect(path.basename(result.gateMdPath)).toBe('gate-3.md')
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).toContain('Plan gate')
    expect(fs.existsSync(path.join(state.runDir, 'gate-1.md'))).toBe(false)
    const sidecar = PlanSchema.parse(
      JSON.parse(fs.readFileSync(path.join(state.runDir, 'sidecars', 'plan.json'), 'utf8')),
    )
    expect(sidecar.children[0]).toMatchObject({ id: 'auth-db', changeName: 'add-thing' })
    expect(sidecar.children[1]?.changeName).toBeUndefined()
    expect(fs.existsSync(path.join(state.runDir, 'children', '1-auth-db.md'))).toBe(true)
  })

  it("a false needs_split runs today's tail — atomicity spawns and the final gate presents at the given version", async () => {
    const { deps, state, spawnOrder, prompts, logPath, spawn } = await setup({
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
    expect(prompts[0]).toContain('openspec/changes/add-thing/tasks.md')
    expect(result.version).toBe(2)
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).toContain('Final gate')
    expect((await loadRunState(deps.config.workDir, state.runId)).plan).toBeUndefined()
  })

  it('diverts with nothing on disk — no task.md, no tasks.md, no digest: absent sections stay absent, nothing leaks undefined', async () => {
    const { deps, state, spawnOrder, prompts, logPath, spawn } = await setup({
      decomposeSidecar: JSON.stringify({ tasks_file: 'openspec/changes/add-thing/tasks.md', needs_split: true }),
      planDraft: { children: [{ id: 'auth-db', instruction: 'Ship the drafted slice.', deps: [] }] },
      noDecomposeArtifact: true,
    })
    const ctx = makeCtx(deps, state, logPath)

    const result = await runPostConvergenceTail({
      deps,
      state,
      ctx,
      agent: { spawn, config: deps.config, execGit: deps.execGit, emit: ctx.emit },
      depth: 'M',
      reviewResult: REVIEW_RESULT,
      version: 1,
    })

    expect(result.halted).toBe('gate')
    expect(spawnOrder).toEqual(['decompose-tasks.json', 'plan-draft.json'])
    const reentry = prompts[1]
    expect(reentry).toContain('Re-scoped tasks.md (child #1 slice only):')
    expect(reentry).toContain('Existing change: add-thing — child #1 of the split')
    expect(reentry).not.toContain('Original task:')
    expect(reentry).not.toContain('Drafted artifacts:')
    expect(reentry).not.toContain('- what:')
    expect(reentry).not.toContain('- why:')
    expect(reentry).not.toContain('- touches:')
    expect(reentry).not.toContain('undefined')
    expect(reentry).not.toContain('Stryker was here!')
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

  // Pinned byte-for-byte: the composed text is the planner's entire input, so
  // every section marker is behavior. Loose containment above lets string
  // mutants survive; this pins each header, separator, and payload exactly.
  it('composes the exact split-re-entry text for a fully-populated input', () => {
    const composed = buildSplitReentryTaskText({
      originalTask: '# Add thing\n\nThe original task body.',
      changeName: 'add-thing',
      artifactSummary: ['what: ship the slice', 'why: land it safely'],
      tasksMd: '## 1. Slice\n\n- [ ] step',
    })
    expect(composed).toBe(
      [
        'A decompose verdict marked this change needs_split: it cannot land as one atomic-shippable change.',
        'Plan the child-run family that ships it: child #1 is the existing change itself (its slice is',
        'already drafted and reviewed); the siblings partition the remainder of the work.',
        '',
        'Original task:',
        '# Add thing\n\nThe original task body.',
        '',
        'Existing change: add-thing — child #1 of the split',
        '',
        'Drafted artifacts:',
        '- what: ship the slice',
        '- why: land it safely',
        '',
        'Re-scoped tasks.md (child #1 slice only):',
        '## 1. Slice\n\n- [ ] step',
      ].join('\n'),
    )
  })

  it('composes the exact split-re-entry text with every optional section absent', () => {
    const composed = buildSplitReentryTaskText({
      originalTask: null,
      changeName: 'add-thing',
      artifactSummary: [],
      tasksMd: '',
    })
    expect(composed).toBe(
      [
        'A decompose verdict marked this change needs_split: it cannot land as one atomic-shippable change.',
        'Plan the child-run family that ships it: child #1 is the existing change itself (its slice is',
        'already drafted and reviewed); the siblings partition the remainder of the work.',
        '',
        'Existing change: add-thing — child #1 of the split',
        '',
        'Re-scoped tasks.md (child #1 slice only):',
        '',
      ].join('\n'),
    )
  })
})

describe('isSeverityConverged', () => {
  it('requires the cap-hit outcome — a converged round with nothing open is not severity-converged', () => {
    const rounds = 1
    const raised = { blocker: 0, material: 0, nitpick: 0 }
    const blocker = { id: 'F1', class: 'BLOCKER', resolution: 'dismissed' } as const
    const material = { id: 'F2', class: 'MATERIAL', resolution: 'dismissed' } as const
    const nitpick = { id: 'F3', class: 'NITPICK', resolution: 'dismissed' } as const
    expect(
      isSeverityConverged({
        outcome: 'converged',
        rounds,
        verdict: 'converged',
        raised,
        openBlockers: [],
        openMaterial: [],
        openNitpicks: [],
      }),
    ).toBe(false)
    expect(
      isSeverityConverged({
        outcome: 'cap-hit',
        rounds,
        verdict: 'open',
        raised,
        openBlockers: [],
        openMaterial: [],
        openNitpicks: [nitpick],
      }),
    ).toBe(true)
    expect(
      isSeverityConverged({
        outcome: 'cap-hit',
        rounds,
        verdict: 'open',
        raised,
        openBlockers: [blocker],
        openMaterial: [],
        openNitpicks: [],
      }),
    ).toBe(false)
    expect(
      isSeverityConverged({
        outcome: 'cap-hit',
        rounds,
        verdict: 'open',
        raised,
        openBlockers: [],
        openMaterial: [material],
        openNitpicks: [],
      }),
    ).toBe(false)
  })
})

describe('runPostReviewToGate budget routing', () => {
  /**
   * The routing conditions are computed from real gate signals, so the
   * verification round is bought only when the conservative projection says
   * one more round is affordable. Each case pins one term of the projection —
   * ceiling source, unknown-cost fail-closed, per-round division, sign
   * arithmetic, and the persisted spend baseline — through the one observable
   * that matters: whether the verification seam ran.
   */
  function needsReviewCapHit(rounds: number): ReviewLoopResult {
    return {
      outcome: 'cap-hit',
      rounds,
      verdict: 'needs-review',
      raised: { blocker: 0, material: 0, nitpick: 0 },
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    }
  }

  /** Unpriceable spend (tokens, no model, no resolver) → costKnown false. */
  function appendUnpriceableSpend(logPath: string): void {
    appendEvent(logPath, {
      altitude: 'L1',
      type: 'done',
      agent: 'reviewer-r1',
      usage: { inputTokens: 100, outputTokens: 10, reasoningTokens: 0, costUsd: 0, wallMs: 5 },
    })
  }

  /** A priced done event → costKnown true at exactly `costUsd`. */
  function appendPricedSpend(logPath: string, costUsd: number): void {
    appendEvent(logPath, {
      altitude: 'L1',
      type: 'done',
      agent: 'reviewer-r1',
      usage: { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd, wallMs: 5 },
    })
  }

  function verificationMock(): Mock<(result: ReviewLoopResult) => Promise<ReviewLoopResult>> {
    return mock((result: ReviewLoopResult) => Promise.resolve({ ...result, verdict: 'converged' as const }))
  }

  it('buys the verification round when the projection is under the ceiling — and its result routes to the tail', async () => {
    const { deps, state, logPath, spawn } = await setup()
    const ctx = makeCtx(deps, state, logPath)
    const verify = verificationMock()
    const result = await runPostReviewToGate({
      deps,
      state,
      ctx,
      agent: { spawn, config: deps.config, execGit: deps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(1),
      version: 1,
      runVerification: verify,
    })
    expect(verify).toHaveBeenCalledTimes(1)
    expect(verify.mock.calls[0]?.[0]).toMatchObject({ verdict: 'needs-review' })
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).toContain('Final gate')
  })

  it('declines the round when the projection reaches the config ceiling exactly', async () => {
    const { deps, state, logPath, spawn } = await setup()
    const noBudgetDeps: OrchestratorDeps = { ...deps, config: { ...deps.config, budget: 0 } }
    const ctx = makeCtx(noBudgetDeps, state, logPath)
    const verify = verificationMock()
    await runPostReviewToGate({
      deps: noBudgetDeps,
      state,
      ctx,
      agent: { spawn, config: noBudgetDeps.config, execGit: noBudgetDeps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(1),
      version: 1,
      runVerification: verify,
    })
    expect(verify).not.toHaveBeenCalled()
  })

  it('fails closed on unknown cost — an unmeterable run buys no round', async () => {
    const { deps, state, logPath, spawn } = await setup()
    appendUnpriceableSpend(logPath)
    const ctx = makeCtx(deps, state, logPath)
    const verify = verificationMock()
    await runPostReviewToGate({
      deps,
      state,
      ctx,
      agent: { spawn, config: deps.config, execGit: deps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(1),
      version: 1,
      runVerification: verify,
    })
    expect(verify).not.toHaveBeenCalled()
  })

  it('a zero-round loop projects the default per-round cost, not a division by zero', async () => {
    const { deps, state, logPath } = await setup()
    appendPricedSpend(logPath, 1)
    const autonomyDeps: OrchestratorDeps = {
      ...deps,
      autonomy: { level: 'assist', costCeilingUsd: 2, metered: true },
    }
    const ctx = makeCtx(autonomyDeps, state, logPath)
    const verify = verificationMock()
    await runPostReviewToGate({
      deps: autonomyDeps,
      state,
      ctx,
      agent: { spawn: autonomyDeps.spawn, config: autonomyDeps.config, execGit: autonomyDeps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(0),
      version: 1,
      runVerification: verify,
    })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('a multi-round loop projects its own average, which is what crosses the ceiling', async () => {
    const { deps, state, logPath } = await setup()
    appendPricedSpend(logPath, 3)
    const autonomyDeps: OrchestratorDeps = {
      ...deps,
      autonomy: { level: 'assist', costCeilingUsd: 4, metered: true },
    }
    const ctx = makeCtx(autonomyDeps, state, logPath)
    const verify = verificationMock()
    await runPostReviewToGate({
      deps: autonomyDeps,
      state,
      ctx,
      agent: { spawn: autonomyDeps.spawn, config: autonomyDeps.config, execGit: autonomyDeps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(2),
      version: 1,
      runVerification: verify,
    })
    expect(verify).not.toHaveBeenCalled()
  })

  it('the projection adds the observed cost and one more round at the observed average', async () => {
    const { deps, state, logPath } = await setup()
    appendPricedSpend(logPath, 2)
    const autonomyDeps: OrchestratorDeps = {
      ...deps,
      autonomy: { level: 'assist', costCeilingUsd: 2.5, metered: true },
    }
    const ctx = makeCtx(autonomyDeps, state, logPath)
    const verify = verificationMock()
    await runPostReviewToGate({
      deps: autonomyDeps,
      state,
      ctx,
      agent: { spawn: autonomyDeps.spawn, config: autonomyDeps.config, execGit: autonomyDeps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(1),
      version: 1,
      runVerification: verify,
    })
    expect(verify).not.toHaveBeenCalled()
  })

  it('the persisted spend baseline counts toward the projection', async () => {
    const { deps, state, logPath } = await setup()
    state.spendBaselineUsd = 4.9
    const autonomyDeps: OrchestratorDeps = {
      ...deps,
      autonomy: { level: 'assist', costCeilingUsd: 4.5, metered: true },
    }
    const ctx = makeCtx(autonomyDeps, state, logPath)
    const verify = verificationMock()
    await runPostReviewToGate({
      deps: autonomyDeps,
      state,
      ctx,
      agent: { spawn: autonomyDeps.spawn, config: autonomyDeps.config, execGit: autonomyDeps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(1),
      version: 1,
      runVerification: verify,
    })
    expect(verify).not.toHaveBeenCalled()
  })

  it('a caller without the verification seam continues to the final gate with the unreviewed edits', async () => {
    const { deps, state, logPath, spawn } = await setup()
    const ctx = makeCtx(deps, state, logPath)
    const result = await runPostReviewToGate({
      deps,
      state,
      ctx,
      agent: { spawn, config: deps.config, execGit: deps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(1),
      version: 1,
    })
    expect(result.halted).toBe('gate')
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).toContain('Final gate')
  })

  it('an explicitly unmetered config does not override the autonomy metered flag on unknown cost', async () => {
    const { deps, state, logPath } = await setup()
    appendUnpriceableSpend(logPath)
    const autonomyDeps: OrchestratorDeps = {
      ...deps,
      config: { ...deps.config, metered: false },
      autonomy: { level: 'assist', costCeilingUsd: 5, metered: true },
    }
    const ctx = makeCtx(autonomyDeps, state, logPath)
    const verify = verificationMock()
    await runPostReviewToGate({
      deps: autonomyDeps,
      state,
      ctx,
      agent: { spawn: autonomyDeps.spawn, config: autonomyDeps.config, execGit: autonomyDeps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(1),
      version: 1,
      runVerification: verify,
    })
    expect(verify).not.toHaveBeenCalled()
  })

  it('an unmetered run with no ceiling buys the round even when the cost is unknown', async () => {
    const { deps, state, logPath } = await setup()
    appendUnpriceableSpend(logPath)
    const noBudgetDeps: OrchestratorDeps = { ...deps, config: { ...deps.config, budget: null, metered: false } }
    const ctx = makeCtx(noBudgetDeps, state, logPath)
    const verify = verificationMock()
    await runPostReviewToGate({
      deps: noBudgetDeps,
      state,
      ctx,
      agent: { spawn: noBudgetDeps.spawn, config: noBudgetDeps.config, execGit: noBudgetDeps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(1),
      version: 1,
      runVerification: verify,
    })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('a priced run with no ceiling never projects a budget breach', async () => {
    const { deps, state, logPath } = await setup()
    appendPricedSpend(logPath, 0)
    const noBudgetDeps: OrchestratorDeps = { ...deps, config: { ...deps.config, budget: null, metered: false } }
    const ctx = makeCtx(noBudgetDeps, state, logPath)
    const verify = verificationMock()
    await runPostReviewToGate({
      deps: noBudgetDeps,
      state,
      ctx,
      agent: { spawn: noBudgetDeps.spawn, config: noBudgetDeps.config, execGit: noBudgetDeps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(1),
      version: 1,
      runVerification: verify,
    })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('the projection divides the observed cost across rounds, it does not multiply it', async () => {
    // cost 4 over 2 rounds projects 4 + 2 = 6, under the 7 ceiling; a product
    // would project 4 * 2 = 8 and wrongly decline the round.
    const { deps, state, logPath } = await setup()
    appendPricedSpend(logPath, 4)
    const autonomyDeps: OrchestratorDeps = {
      ...deps,
      autonomy: { level: 'assist', costCeilingUsd: 7, metered: true },
    }
    const ctx = makeCtx(autonomyDeps, state, logPath)
    const verify = verificationMock()
    await runPostReviewToGate({
      deps: autonomyDeps,
      state,
      ctx,
      agent: { spawn: autonomyDeps.spawn, config: autonomyDeps.config, execGit: autonomyDeps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: needsReviewCapHit(2),
      version: 1,
      runVerification: verify,
    })
    expect(verify).toHaveBeenCalledTimes(1)
  })

  it('routes a non-needs-review cap-hit without touching gate signals — no events log needed', async () => {
    const { deps, state, logPath, spawn } = await setup()
    fs.rmSync(logPath)
    const ctx = makeCtx(deps, state, logPath)
    const result = await runPostReviewToGate({
      deps,
      state,
      ctx,
      agent: { spawn, config: deps.config, execGit: deps.execGit, emit: ctx.emit },
      depth: 'S',
      reviewResult: { ...needsReviewCapHit(1), verdict: 'converged' as const },
      version: 1,
    })
    expect(result.halted).toBe('gate')
    expect(fs.readFileSync(result.gateMdPath, 'utf8')).toContain('Final gate')
  })
})
