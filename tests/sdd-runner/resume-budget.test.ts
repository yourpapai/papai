// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import type { SpawnFn } from '../../review-loop/src/agent-runner.js'
import { FindingsSidecarSchema, runStageAgent } from '../../sdd-runner/src/agent-layer.js'
import type { AgentLayerDeps, Finding, RunStageAgentOptions } from '../../sdd-runner/src/agent-layer.js'
import type { RunnerConfig } from '../../sdd-runner/src/config.js'
import { appendEvent, readEvents, type EventInput } from '../../sdd-runner/src/events.js'
import { costAndDuration } from '../../sdd-runner/src/gate-digest.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { runPolicyLadder } from '../../sdd-runner/src/gate-prelude.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'
import { aggregateUsage } from '../../sdd-runner/src/usage-aggregate.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-resume-budget-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const VALID_FINDINGS = JSON.stringify({
  findings: [{ id: 'F1', class: 'BLOCKER', gap: 'g', question: 'q', code_evidence_attempted: 'read x' }],
})

const STEP_FINISH = JSON.stringify({
  type: 'step_finish',
  part: { reason: 'stop', tokens: { input: 1000, output: 200, reasoning: 10 }, cost: 0.02 },
})

function makeAgent(dir: string, emitted: EventInput[]): { agent: AgentLayerDeps; spawns: number[] } {
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'm',
    budget: 5,
  }
  const spawns: number[] = []
  let call = 0
  const spawn: SpawnFn = (_command, _args, options, onLine) => {
    call += 1
    spawns.push(call)
    onLine?.(STEP_FINISH)
    const target = agentWritePath(options.cwd, 'findings-2.json')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, VALID_FINDINGS)
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }
  return {
    agent: {
      spawn,
      config,
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      emit: (event) => {
        emitted.push(event)
      },
    },
    spawns,
  }
}

function stageOptions(
  dir: string,
  runDir: string,
  continueSessionId?: string,
): RunStageAgentOptions<{ findings: Finding[] }> {
  return {
    role: 'reviewer',
    changeName: 'add-thing',
    cwd: dir,
    prompt: 'Review.',
    outputPath: 'findings-2.json',
    outputSchema: FindingsSidecarSchema,
    label: 'reviewer-r2',
    runDir,
    round: 2,
    sidecarDir: path.join(runDir, 'sidecars'),
    ...(continueSessionId === undefined ? {} : { continueSessionId }),
  }
}

describe('continued-session usage flows through accounting and the budget guard identically (D2)', () => {
  it('a continued spawn emits the same done+usage event shape as a fresh spawn', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const fresh: EventInput[] = []
    const continued: EventInput[] = []
    await runStageAgent(makeAgent(dir, fresh).agent, stageOptions(dir, runDir))
    await runStageAgent(makeAgent(dir, continued).agent, stageOptions(dir, runDir, 'ses_x'))

    const freshDone = fresh.find((e): e is Extract<EventInput, { type: 'done' }> => e.type === 'done')
    const continuedDone = continued.find((e): e is Extract<EventInput, { type: 'done' }> => e.type === 'done')
    expect(freshDone).toBeDefined()
    expect(continuedDone).toBeDefined()
    expect(continuedDone?.usage).toEqual(freshDone?.usage)
  })

  it('aggregateUsage and costAndDuration sum a resumed round done event exactly like a fresh one', () => {
    const dir = makeDir()
    const logPath = path.join(dir, 'events.ndjson')
    const spawned = { altitude: 'L1', type: 'spawned', agent: 'reviewer-r2', role: 'reviewer', model: 'm' } as const
    const done = {
      altitude: 'L1',
      type: 'done',
      agent: 'reviewer-r2',
      model: 'm',
      usage: {
        inputTokens: 1000,
        outputTokens: 200,
        reasoningTokens: 10,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd: 0.02,
        wallMs: 5000,
      },
    } as const
    const resume = {
      altitude: 'L2',
      type: 'resume',
      path: 'session-continuation',
      stage: 'review',
      session: 'ses_x',
    } as const
    appendEvent(logPath, spawned)
    appendEvent(logPath, resume)
    appendEvent(logPath, done)

    const raw = readEvents(logPath)
    const usage = aggregateUsage(raw)
    expect(usage.costUsd).toBeCloseTo(0.02)
    expect(usage.inputTokens).toBe(1000)
    const { costUsd, costKnown } = costAndDuration(raw, '2026-01-01T00:00:00.000Z', new Date('2026-01-01T00:00:05Z'))
    expect(costUsd).toBeCloseTo(0.02)
    expect(costKnown).toBe(true)
  })

  it('an over-budget continued round gates exactly as an over-budget fresh round (R4 shape)', () => {
    const dir = makeDir()
    const fakeDriver = createOpenSpecDriver({
      exec: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      cwd: dir,
    })
    const buildDeps = (): OrchestratorDeps => ({
      config: {
        repoRoot: dir,
        workDir: path.join(dir, '.sdd-runner'),
        model: 'm',
        budget: 5,
      },
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: fakeDriver,
      resolveCost: () => null,
    })
    const seedRunDir = (runDir: string): void => {
      fs.mkdirSync(runDir, { recursive: true })
      const now = '2026-01-01T00:00:00.000Z'
      const events = [
        { altitude: 'L1', type: 'spawned', agent: 'reviewer-r1', role: 'reviewer', model: 'm', seq: 1, ts: now },
        {
          altitude: 'L1',
          type: 'done',
          agent: 'reviewer-r1',
          model: 'm',
          usage: {
            inputTokens: 1000,
            outputTokens: 200,
            reasoningTokens: 10,
            cachedReadTokens: 0,
            cachedWriteTokens: 0,
            costUsd: 5.2,
            wallMs: 5000,
          },
          seq: 2,
          ts: now,
        },
      ]
      fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    }
    const reviewResult: ReviewLoopResult = {
      outcome: 'cap-hit',
      rounds: 2,
      openBlockers: [],
      openMaterial: [{ id: 'F1', class: 'MATERIAL', resolution: 'edited', outcome: 'x' }],
      openNitpicks: [],
    }
    const signals = {
      openBlockers: 0,
      openMaterial: 1,
      trajectoryStrictlyDecreasing: true,
      costUsd: 5.2,
      costKnown: true,
      durationMs: 1000,
      assumptions: [],
      blockers: [],
      material: [],
      nitpicks: [],
      trajectory: [],
    }
    seedRunDir(path.join(dir, 'runs', 'fresh'))
    seedRunDir(path.join(dir, 'runs', 'resumed'))
    const freshLadder = runPolicyLadder(
      buildDeps(),
      { ...freshState(dir), runDir: path.join(dir, 'runs', 'fresh') },
      { emit: () => {}, cwd: dir, changeDir: dir, sidecarDir: dir },
      reviewResult,
      { mode: 'early', version: 1, events: [], ...signals },
    )
    const resumedLadder = runPolicyLadder(
      buildDeps(),
      { ...freshState(dir), runDir: path.join(dir, 'runs', 'resumed') },
      { emit: () => {}, cwd: dir, changeDir: dir, sidecarDir: dir },
      reviewResult,
      { mode: 'early', version: 1, events: [], ...signals },
    )
    expect(resumedLadder).toEqual(freshLadder)
    expect(resumedLadder.decision.rule).toBeDefined()
  })
})

function freshState(repoRoot: string): Parameters<typeof runPolicyLadder>[1] {
  return {
    runId: 'run-1',
    repoRoot,
    workDir: path.join(repoRoot, '.sdd-runner'),
    changeName: 'add-thing',
    stage: 'review',
    depth: 'S',
    round: 2,
    roundCap: 2,
    gate: null,
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    autoExtendsUsed: 0,
    gateDeadlineAt: null,
    gateDeadlineReArmed: false,
    runDir: path.join(repoRoot, '.sdd-runner', 'runs', 'run-1'),
    statePath: path.join(repoRoot, '.sdd-runner', 'runs', 'run-1', 'state.json'),
  }
}
