// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import { readEvents } from '../../../afk-runner/src/events.js'
import { appendEvent } from '../../../afk-runner/src/events.js'
import type { SddEvent } from '../../../afk-runner/src/events.js'
import { resumeRun } from '../../../afk-runner/src/run-resume.js'
import { startRun } from '../../../afk-runner/src/run.js'
import { renderGateAnswers } from '../../../afk-runner/src/work/gate-answers.js'
import { BLOCKER_ROUND, M_MULTI_ROUND, TASK_TEXT, makeFakePipeline } from '../fixtures/fake-pipeline.js'

/** A crash predicate that fires exactly once on the given output basename, then lets the resume proceed. */
function killOnceOn(basename: string): (candidate: string) => boolean {
  let fired = false
  return (candidate: string): boolean => {
    if (fired || candidate !== basename) return false
    fired = true
    return true
  }
}

/** The first run id under a fake pipeline's work dir. */
function firstRunOf(pipeline: ReturnType<typeof makeFakePipeline>): string {
  const entries = fs.readdirSync(path.join(pipeline.workDir, 'runs'))
  return entries[0] ?? ''
}

/** Fake clock: each tick resolves only when the test releases it. */
function fakeClock(): { readonly tick: () => Promise<void>; readonly release: () => void } {
  const queue: Array<() => void> = []
  return {
    tick: () =>
      new Promise<void>((resolve) => {
        queue.push(resolve)
      }),
    release: () => {
      const resolve = queue.shift()
      if (resolve !== undefined) resolve()
    },
  }
}

/** Release one tick and let the waiter's continuation run before the next. */
async function releaseTick(clock: { readonly release: () => void }): Promise<void> {
  clock.release()
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function endsAtTailPark(logPath: string): boolean {
  const tokens = skeletonTokens(logPath)
  const presentedFinal = tokens.includes('gate:presented:final')
  return presentedFinal && tokens.at(-1) === 'stage_exit:decompose'
}

/** True once the re-presented final gate has parked (two final presentations, tail closed). */
function atSecondPresentationPark(logPath: string): boolean {
  const tokens = skeletonTokens(logPath)
  const presentations = tokens.filter((token) => token === 'gate:presented:final').length
  return presentations >= 2 && tokens.at(-1) === 'stage_exit:atomicity'
}

/** Release ticks (bounded) until the predicate holds on the log. */
async function ticksUntil(
  clock: { readonly release: () => void },
  logPath: string,
  done: (logPath: string) => boolean,
  budget = 30,
): Promise<void> {
  for (let i = 0; i < budget; i += 1) {
    await releaseTick(clock)
    if (done(logPath)) break
  }
}

/** Release ticks (bounded) until the parked-gate resume settles and returns. */
async function settleViaTicks<T>(
  pending: Promise<T>,
  clock: { readonly release: () => void },
  budget = 10,
): Promise<T> {
  for (let i = 0; i < budget; i += 1) {
    await releaseTick(clock)
    const done = await Promise.race([pending.then((): boolean => true), Promise.resolve(false)])
    if (done) break
  }
  return pending
}

async function waitFor(predicate: () => boolean, budgetMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => {
      setTimeout(resolve, 25)
    })
  }
  return predicate()
}

/** Release ticks (bounded) until the healed settle re-drives into the tail and parks at the final gate. */
async function ticksUntilTailPark(clock: { readonly release: () => void }, logPath: string): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    await releaseTick(clock)
    if (endsAtTailPark(logPath)) break
  }
}

function answeredGateEvents(events: readonly SddEvent[]): SddEvent[] {
  return events.filter((event) => event.type === 'gate' && event.action === 'answered')
}

type Token = string

function skeletonTokens(logPath: string): Token[] {
  return readEvents(logPath).flatMap((event: SddEvent): Token[] => {
    if (event.type === 'stage_enter' || event.type === 'stage_exit') return [`${event.type}:${event.stage}`]
    if (event.type === 'stage_failed') return [`stage_failed:${event.stage}`]
    if (event.type === 'round_open' || event.type === 'round_close') return [`${event.type}:${event.round}`]
    if (event.type === 'convergence') return [`convergence:${event.round}:${event.verdict}`]
    if (event.type === 'gate')
      return [`gate:${event.action}:${event.mode}${event.outcome === undefined ? '' : `:${event.outcome}`}`]
    if (event.type === 'auto_decision') return [`auto_decision:${event.decision}`]
    if (event.type === 'artifact') return ['artifact']
    if (event.type === 'depth') return [`depth:${event.profile}`]
    if (event.type === 'finding') return [`finding:${event.action}:${event.id}`]
    return []
  })
}

describe('live-shaped think-half integration (stubbed agents)', () => {
  it('start → intake → draft → review → S tail presents the final gate from decompose and parks gate-pending', async () => {
    const pipeline = makeFakePipeline()
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('final')
    expect(result.position).toBe('completed')
    const tokens = skeletonTokens(path.join(pipeline.runDirOf(result.runId), 'events.ndjson'))
    expect(tokens).toEqual([
      'stage_enter:intake',
      'depth:S',
      'stage_exit:intake',
      'stage_enter:draft',
      'artifact',
      'artifact',
      'stage_exit:draft',
      'stage_enter:review',
      'round_open:1',
      'convergence:1:converged',
      'artifact',
      'artifact',
      'round_close:1',
      'stage_exit:review',
      'stage_enter:decompose',
      'stage_enter:gate',
      'gate:presented:final',
      'auto_decision:approve',
      'stage_exit:gate',
      'gate:answered:final:approve',
      'stage_exit:decompose',
    ])
    expect(tokens.filter((token) => token.includes('atomicity'))).toEqual([])
    const runDir = pipeline.runDirOf(result.runId)
    expect(fs.existsSync(path.join(runDir, 'gate-1.md'))).toBe(true)
    expect(fs.existsSync(path.join(runDir, 'gate-hashes-1.json'))).toBe(true)
    expect(pipeline.spawnOrder).toContain('decompose-tasks.json')
    expect(pipeline.spawnOrder).not.toContain('atomicity.json')
  })

  it('M run drives the full tail: decompose bracket, atomicity bracket, final presentation, R1 completes', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: M_MULTI_ROUND })
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('final')
    const tokens = skeletonTokens(path.join(pipeline.runDirOf(result.runId), 'events.ndjson'))
    const tailStart = tokens.indexOf('stage_enter:decompose')
    expect(tailStart).toBeGreaterThan(tokens.indexOf('stage_exit:review'))
    expect(tokens.slice(tailStart)).toEqual([
      'stage_enter:decompose',
      'stage_exit:decompose',
      'stage_enter:atomicity',
      'stage_enter:gate',
      'gate:presented:final',
      'auto_decision:approve',
      'stage_exit:gate',
      'gate:answered:final:approve',
      'stage_exit:atomicity',
    ])
    expect(pipeline.spawnOrder).toContain('decompose-tasks.json')
    expect(pipeline.spawnOrder).toContain('atomicity.json')
  })

  it('extend-at-final full cycle: settle extends, the M tail re-runs, v2 approves, the run completes', async () => {
    const highBlastAssumption = {
      id: 'A1',
      text: 'the rollout stays behind a flag',
      basis: 'code-evidence',
      confidence: 'high',
      blast_radius: 'group replies',
      status: 'open',
      evidence: { files: ['src/a.ts'] },
    }
    const pipeline = makeFakePipeline({
      sidecarOverrides: {
        'depth.json': JSON.stringify({
          implicated_files: ['src/a.ts', 'src/b.ts'],
          signals: {
            cross_module: true,
            db_migration: false,
            provider_surface: false,
            credentials: false,
            novelty: 'existing-modules',
          },
          rationale: 'two modules',
        }),
        'draft-design.json': JSON.stringify({ files_written: ['openspec/changes/add-thing/design.md'] }),
        'resolutions-1.json': JSON.stringify({ resolutions: [], assumptions: [highBlastAssumption] }),
        'findings-2.json': JSON.stringify({ findings: [] }),
        'resolutions-2.json': JSON.stringify({ resolutions: [], assumptions: [] }),
      },
    })
    const clock = fakeClock()
    const taskFile = path.join(pipeline.repoRoot, 'task.md')
    fs.writeFileSync(taskFile, TASK_TEXT)
    const runPromise = startRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, { taskFile })

    await waitFor((): boolean => pipeline.stdoutLines.some((line) => line.includes('gate-pending')))
    const runDir = pipeline.runDirOf(firstRunOf(pipeline))
    const logPath = path.join(runDir, 'events.ndjson')
    // v1 parks at the human gate: the high-blast assumption blocks R1.
    expect(skeletonTokens(logPath).slice(-3)).toEqual([
      'gate:presented:final',
      'auto_decision:gate',
      'stage_exit:atomicity',
    ])

    fs.writeFileSync(path.join(runDir, 'gate-1.md'), '## Gate response\n\n→ RUN 1 MORE\n')
    await ticksUntil(clock, logPath, atSecondPresentationPark)

    // v2 parks at the human gate too (the high-blast assumption persists);
    // the human approves it by checking the box.
    const approveMd = renderGateAnswers({
      items: [{ kind: 'assumption', id: 'A1', text: 'the rollout stays behind a flag', accepted: true }],
      blockerAnswers: [],
      acks: [],
      decision: 'approve',
    })
    fs.writeFileSync(path.join(runDir, 'gate-2.md'), approveMd)
    const halted = await settleViaTicks(runPromise, clock, 30)

    expect(halted).toMatchObject({ halted: 'final', position: 'completed' })
    const tokens = skeletonTokens(logPath)
    // the tail re-ran as fresh brackets and re-presented at v2
    expect(tokens.filter((token) => token === 'stage_enter:decompose')).toHaveLength(2)
    expect(tokens.filter((token) => token === 'stage_enter:atomicity')).toHaveLength(2)
    const presentations = tokens.filter((token) => token === 'gate:presented:final')
    expect(presentations).toHaveLength(2)
    // the extend settle: answered first, then the exit, then the raised-cap round
    const extendAnswer = tokens.indexOf('gate:answered:final:extend')
    expect(tokens[extendAnswer + 1]).toBe('stage_exit:gate')
    expect(tokens[extendAnswer + 2]).toBe('round_open:2')
    // the v2 approve settles exit-first and completes on the answer
    const approveAnswer = tokens.indexOf('gate:answered:final:approve')
    expect(tokens[approveAnswer - 1]).toBe('stage_exit:gate')
    expect(tokens.at(-1)).toBe('gate:answered:final:approve')
  })

  it('cap-hit with open blockers appends gate presented and parks gate-pending', async () => {
    const pipeline = makeFakePipeline({ sidecarOverrides: BLOCKER_ROUND })
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('gate-pending')
    const tokens = skeletonTokens(path.join(pipeline.runDirOf(result.runId), 'events.ndjson'))
    expect(tokens).toContain('finding:classified:F1')
    expect(tokens).toContain('finding:resolved:F1')
    expect(tokens).toContain('convergence:1:open')
    expect(tokens.indexOf('gate:presented:early')).toBeGreaterThan(tokens.indexOf('round_close:1'))
    expect(tokens.filter((token) => token.startsWith('stage_enter:'))).toEqual([
      'stage_enter:intake',
      'stage_enter:draft',
      'stage_enter:review',
    ])
  })

  it('kill between rounds: resume re-enters review through the corpus-real self-loop', async () => {
    const crashed = makeFakePipeline({ sidecarOverrides: M_MULTI_ROUND, crashOn: killOnceOn('findings-2.json') })
    await expect(startRun(crashed.deps, { taskText: TASK_TEXT })).rejects.toThrow('simulated kill')
    const runId = firstRunOf(crashed)
    const logPath = path.join(crashed.runDirOf(runId), 'events.ndjson')
    const truncated = skeletonTokens(logPath)
    expect(truncated).toContain('round_open:2')
    expect(truncated).not.toContain('convergence:2:converged')

    // the process died; the holder is gone and the memo is stale garbage
    fs.rmSync(path.join(crashed.runDirOf(runId), 'state.json'))

    const resumed = await resumeRun(crashed.deps, runId)
    expect(resumed.halted).toBe('final')
    expect(resumed.drove).toBe(true)

    const tokens = skeletonTokens(logPath)
    const reviewEnters = tokens.filter((token) => token === 'stage_enter:review')
    expect(reviewEnters).toHaveLength(2)
    const firstEnter = tokens.indexOf('stage_enter:review')
    const secondEnter = tokens.indexOf('stage_enter:review', firstEnter + 1)
    expect(tokens.slice(firstEnter, secondEnter)).toEqual([
      'stage_enter:review',
      'round_open:1',
      'finding:classified:F1',
      'finding:resolved:F1',
      'convergence:1:open',
      'artifact',
      'artifact',
      'round_close:1',
      'round_open:2',
    ])
    // the resume re-enters the already-open round 2 — no second round_open
    // (the log-fidelity owedness invariant); its work-shaped events still land
    expect(tokens.slice(secondEnter, secondEnter + 5)).toEqual([
      'stage_enter:review',
      'convergence:2:converged',
      'artifact',
      'artifact',
      'round_close:2',
    ])
    // The converged M run continues into the tail and presents its final gate.
    expect(tokens.slice(-10)).toEqual([
      'stage_exit:review',
      'stage_enter:decompose',
      'stage_exit:decompose',
      'stage_enter:atomicity',
      'stage_enter:gate',
      'gate:presented:final',
      'auto_decision:approve',
      'stage_exit:gate',
      'gate:answered:final:approve',
      'stage_exit:atomicity',
    ])
  })

  it('under-budget retry: a review failure declared once is retried in-process and the run completes (C6 D3)', async () => {
    const pipeline = makeFakePipeline({
      sidecarSequences: {
        // two invalid findings sidecars exhaust the agent layer's in-work
        // attempts -> AgentValidationError -> one declared stage_failed; the
        // third write converges round 1
        'findings-1.json': [
          JSON.stringify({ findings: [{ id: 'F1' }] }),
          JSON.stringify({ findings: [{ id: 'F1' }] }),
          JSON.stringify({ findings: [] }),
        ],
      },
    })
    const result = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    expect(result.halted).toBe('final')
    expect(result.position).toBe('completed')
    const events = readEvents(path.join(pipeline.runDirOf(result.runId), 'events.ndjson'))
    const declared = events.filter((event) => event.type === 'stage_failed')
    expect(declared).toHaveLength(1)
    expect(declared[0]).toMatchObject({ stage: 'review', kind: 'exhausted' })
    // the failed bracket stayed open: no stage exit between the failure and the re-run's round;
    // the in-place re-run owes no second round_open (the owedness invariant)
    const tokens = skeletonTokens(path.join(pipeline.runDirOf(result.runId), 'events.ndjson'))
    const failedAt = tokens.indexOf('stage_failed:review')
    expect(tokens.slice(failedAt - 1, failedAt + 2)).toEqual([
      'round_open:1',
      'stage_failed:review',
      'convergence:1:converged',
    ])
  })

  it('heal-on-settle: a historical answered-no-outcome run heals via a file-edit settle and continues per outcome', async () => {
    const materialRound = {
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
        resolutions: [{ id: 'F1', class: 'MATERIAL', resolution: 'evidence-answered', outcome: 'kept as documented' }],
        assumptions: [],
      }),
    }
    const pipeline = makeFakePipeline({ sidecarOverrides: materialRound })
    const started = await startRun(pipeline.deps, { taskText: TASK_TEXT })
    const runDir = pipeline.runDirOf(started.runId)
    const logPath = path.join(runDir, 'events.ndjson')
    // A historical settle: answered with no outcome field, no mover after it.
    appendEvent(logPath, { altitude: 'L2', type: 'gate', action: 'answered', mode: 'early', version: 1 })

    const parked = await resumeRun(pipeline.deps, started.runId)
    expect(parked).toMatchObject({ halted: 'gate-pending', drove: false })

    // The next settlement — a hand-edited gate file — appends an
    // explicit-outcome answered event; history heals forward.
    const gateMd = path.join(runDir, 'gate-1.md')
    const checked = fs
      .readFileSync(gateMd, 'utf8')
      .split('\n')
      .map((line) => line.replace(/^(\s*-\s*\[) (\])/u, '$1x$2'))
      .join('\n')
    fs.writeFileSync(gateMd, checked)

    const clock = fakeClock()
    const resumedPromise = resumeRun({ ...pipeline.deps, gateWait: { tick: clock.tick } }, started.runId)
    // The waiter then holds for the human answer — the outcome ordering that
    // completes an approved final gate is C5 §4.
    await ticksUntilTailPark(clock, logPath)
    const events = readEvents(logPath)
    const answers = answeredGateEvents(events)
    expect(answers.length).toBe(2)
    expect(answers[1]).toMatchObject({ outcome: 'approve' })
    // The approve-early mover entered decompose; the drive re-entered through
    // the self-loop and the S tail presented the final gate (open material
    // finding F1 keeps the ladder at the human gate).
    expect(skeletonTokens(logPath).slice(-7)).toEqual([
      'gate:answered:final:approve',
      'stage_enter:decompose',
      'stage_enter:decompose',
      'stage_enter:gate',
      'gate:presented:final',
      'auto_decision:gate',
      'stage_exit:decompose',
    ])
    void resumedPromise
  })
})
