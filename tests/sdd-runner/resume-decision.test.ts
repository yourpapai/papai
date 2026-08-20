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
import { readEvents } from '../../sdd-runner/src/events.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { runResume } from '../../sdd-runner/src/orchestrator.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/orchestrator.js'
import type { ReplayState } from '../../sdd-runner/src/replay.js'
import { resolveResumeDecision } from '../../sdd-runner/src/resume-decision.js'
import { PersistedRunStateSchema } from '../../sdd-runner/src/run-state.js'
import type { PersistedRunState } from '../../sdd-runner/src/run-state.js'
import type { SessionLedgerLine } from '../../sdd-runner/src/session-ledger.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-resume-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

const emptyReplay: ReplayState = {
  stages: {
    intake: 'pending',
    draft: 'pending',
    review: 'pending',
    decompose: 'pending',
    atomicity: 'pending',
    gate: 'pending',
  },
  depth: null,
  round: null,
  perRound: [],
  lastVerdict: null,
  gate: null,
  autoDecisions: [],
}

function stateOf(overrides: Record<string, unknown> = {}): PersistedRunState {
  return PersistedRunStateSchema.parse({
    runId: 'run-1',
    repoRoot: '/repo',
    workDir: '/repo/.sdd-runner',
    changeName: 'add-thing',
    stage: 'review',
    depth: 'S',
    round: 2,
    gate: null,
    status: 'running',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  })
}

function artifactsOf(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    proposal: 'done',
    specs: 'done',
    design: 'blocked',
    assumptions: 'blocked',
    review: 'blocked',
    tasks: 'blocked',
    ...overrides,
  }
}

function ledgerLine(overrides: Partial<SessionLedgerLine>): SessionLedgerLine {
  return {
    label: 'resolver',
    role: 'resolver',
    round: 2,
    attempt: 1,
    model: 'm',
    opencodeSessionId: 'ses_x',
    status: 'killed',
    ts: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('resolveResumeDecision — artifact-first, session-second, rebuild-last (D2)', () => {
  it('a gate-pending run reports artifact-skip: no agent is spawned, the decision flow opens', () => {
    const decision = resolveResumeDecision(
      stateOf({ gate: { mode: 'early', version: 1 } }),
      artifactsOf(),
      emptyReplay,
      [],
    )
    expect(decision.path).toBe('artifact-skip')
    expect(decision.stage).toBe('gate')
    expect(decision.reason).toBe('gate-pending')
  })

  it('an interrupted draft with complete artifacts skips the drafter agents (artifact-skip)', () => {
    const decision = resolveResumeDecision(
      stateOf({ stage: 'draft', round: 0 }),
      artifactsOf({ design: 'ready' }),
      emptyReplay,
      [],
    )
    expect(decision.stage).toBe('review')
    expect(decision.path).toBe('artifact-skip')
  })

  it('an in-flight session for the interrupted review round reports session-continuation with the id', () => {
    const decision = resolveResumeDecision(
      stateOf({ stage: 'review', round: 2 }),
      artifactsOf(),
      { ...emptyReplay, round: { current: 2, cap: 2 } },
      [ledgerLine({ label: 'resolver', round: 2, status: 'killed', opencodeSessionId: 'ses_dead' })],
    )
    expect(decision.path).toBe('session-continuation')
    expect(decision.stage).toBe('review')
    expect(decision.round).toBe(2)
    expect(decision.session).toMatchObject({ label: 'resolver', opencodeSessionId: 'ses_dead' })
  })

  it('a pre-change run (no ledger) reports the stage-boundary rebuild fallback', () => {
    const decision = resolveResumeDecision(
      stateOf({ stage: 'review', round: 2 }),
      artifactsOf(),
      { ...emptyReplay, round: { current: 2, cap: 2 } },
      [],
    )
    expect(decision.path).toBe('stage-rebuild')
    expect(decision.stage).toBe('review')
  })

  it('sessions of another round or a settled status are not in-flight (stage-rebuild)', () => {
    const otherRound = resolveResumeDecision(
      stateOf({ stage: 'review', round: 2 }),
      artifactsOf(),
      { ...emptyReplay, round: { current: 2, cap: 2 } },
      [ledgerLine({ round: 1 })],
    )
    expect(otherRound.path).toBe('stage-rebuild')

    const settled = resolveResumeDecision(
      stateOf({ stage: 'review', round: 2 }),
      artifactsOf(),
      { ...emptyReplay, round: { current: 2, cap: 2 } },
      [ledgerLine({ round: 2, status: 'done' })],
    )
    expect(settled.path).toBe('stage-rebuild')

    const noId = resolveResumeDecision(
      stateOf({ stage: 'review', round: 2 }),
      artifactsOf(),
      { ...emptyReplay, round: { current: 2, cap: 2 } },
      [ledgerLine({ round: 2, status: 'killed', opencodeSessionId: null })],
    )
    expect(noId.path).toBe('stage-rebuild')
  })

  it('the latest in-flight session wins when several are recorded', () => {
    const decision = resolveResumeDecision(
      stateOf({ stage: 'review', round: 2 }),
      artifactsOf(),
      { ...emptyReplay, round: { current: 2, cap: 2 } },
      [
        ledgerLine({ label: 'reviewer', role: 'reviewer', status: 'spawned', opencodeSessionId: 'ses_a' }),
        ledgerLine({ status: 'killed', opencodeSessionId: 'ses_b' }),
      ],
    )
    expect(decision.session?.opencodeSessionId).toBe('ses_b')
  })
})

const VALID_FINDINGS = JSON.stringify({
  findings: [
    {
      id: 'F1',
      class: 'BLOCKER',
      gap: 'g',
      question: 'q',
      code_evidence_attempted: 'read x',
    },
  ],
})

interface SpawnCall {
  readonly args: readonly string[]
  readonly prompt: string
}

function makeAgent(
  dir: string,
  calls: SpawnCall[],
  plans: ReadonlyArray<{ write?: string; exit?: number; stderr?: string }>,
): AgentLayerDeps {
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'm',
    budget: 5,
  }
  let index = 0
  const spawn: SpawnFn = (_command, args, options) => {
    calls.push({ args, prompt: String(args[args.length - 1]) })
    const plan = plans[Math.min(index, plans.length - 1)] ?? {}
    index += 1
    if (plan.write !== undefined) {
      const target = agentWritePath(options.cwd, 'findings-1.json')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, plan.write)
    }
    return Promise.resolve({ exitCode: plan.exit ?? 0, stdout: '', stderr: plan.stderr ?? '' })
  }
  return {
    spawn,
    config,
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    emit: () => {},
  }
}

function makeOptions(
  dir: string,
  runDir: string,
  continueSessionId?: string,
): RunStageAgentOptions<{ findings: Finding[] }> {
  return {
    role: 'reviewer',
    changeName: 'add-thing',
    cwd: dir,
    prompt: 'Review the artifacts.',
    outputPath: 'findings-1.json',
    outputSchema: FindingsSidecarSchema,
    label: 'reviewer',
    runDir,
    round: 2,
    sidecarDir: path.join(runDir, 'sidecars'),
    ...(continueSessionId === undefined ? {} : { continueSessionId }),
  }
}

describe('agent seam continuation spawn', () => {
  it('spawns opencode run --session <id> with a continuation prompt that restates the output target', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const calls: SpawnCall[] = []
    await runStageAgent(makeAgent(dir, calls, [{ write: VALID_FINDINGS }]), makeOptions(dir, runDir, 'ses_x'))
    expect(calls).toHaveLength(1)
    const first = calls[0]!
    expect(first.args).toContain('--session')
    expect(first.args[first.args.indexOf('--session') + 1]).toBe('ses_x')
    const prompt = calls[0]!.prompt
    expect(prompt).toContain('Continue')
    expect(prompt).toContain(agentWritePath(dir, 'findings-1.json'))
    expect(prompt).not.toContain('Review the artifacts.')
  })

  it('a fresh spawn never carries --session', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const calls: SpawnCall[] = []
    await runStageAgent(makeAgent(dir, calls, [{ write: VALID_FINDINGS }]), makeOptions(dir, runDir))
    expect(calls[0]?.args).not.toContain('--session')
  })

  it('falls back to the prompt-rebuild spawn when the continuation fails (no output written)', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const calls: SpawnCall[] = []
    const info = await runStageAgent(
      makeAgent(dir, calls, [{}, { write: VALID_FINDINGS }]),
      makeOptions(dir, runDir, 'ses_pruned'),
    )
    expect(info.value.findings[0]?.id).toBe('F1')
    // call 0: continuation (runAgent may internally stall-retry it as call 1);
    // the final call is the prompt-rebuild fallback
    expect(calls[0]?.args).toContain('--session')
    const fallback = calls[calls.length - 1]!
    expect(fallback.args).not.toContain('--session')
    expect(fallback.prompt).toContain('Review the artifacts.')
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('falls back when the continuation produces an invalid sidecar', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const calls: SpawnCall[] = []
    await runStageAgent(
      makeAgent(dir, calls, [{ write: '{"findings":[{"id":"F1"}]}' }, { write: VALID_FINDINGS }]),
      makeOptions(dir, runDir, 'ses_x'),
    )
    expect(calls).toHaveLength(2)
    expect(calls[1]?.args).not.toContain('--session')
    expect(calls[1]?.prompt).toContain('Review the artifacts.')
  })
})

describe('runResume consults the session ledger (orchestrator wiring)', () => {
  interface ResumeFixture {
    readonly deps: OrchestratorDeps
    readonly workDir: string
    readonly runDir: string
    readonly stdoutLines: string[]
    readonly spawnArgs: Array<readonly string[]>
    readonly repoRoot: string
  }

  function makeResumeFixture(options: { readonly ledger?: readonly string[] }): ResumeFixture {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const runId = 'seeded-review'
    const runDir = path.join(workDir, 'runs', runId)
    fs.mkdirSync(path.join(runDir, 'sidecars'), { recursive: true })
    const changeDir = path.join(repoRoot, 'openspec', 'changes', 'add-thing')
    fs.mkdirSync(path.join(changeDir, 'specs', 'thing'), { recursive: true })
    fs.writeFileSync(path.join(changeDir, 'proposal.md'), '## Why\nseeded\n')
    fs.writeFileSync(path.join(changeDir, 'specs', 'thing', 'spec.md'), '## ADDED Requirements\n')
    const now = '2026-01-01T00:00:00.000Z'
    const events = [
      { altitude: 'L2', type: 'stage_enter', stage: 'intake', seq: 1, ts: now },
      { altitude: 'L2', type: 'depth', profile: 'S', rationale: 'override', source: 'override', seq: 2, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'intake', seq: 3, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'draft', seq: 4, ts: now },
      { altitude: 'L2', type: 'stage_exit', stage: 'draft', seq: 5, ts: now },
      { altitude: 'L2', type: 'stage_enter', stage: 'review', seq: 6, ts: now },
      { altitude: 'L2', type: 'round_open', round: 2, cap: 2, seq: 7, ts: now },
    ]
    fs.writeFileSync(path.join(runDir, 'events.ndjson'), events.map((e) => JSON.stringify(e)).join('\n') + '\n')
    fs.writeFileSync(
      path.join(runDir, 'state.json'),
      `${JSON.stringify(
        {
          runId,
          repoRoot,
          workDir,
          changeName: 'add-thing',
          stage: 'review',
          depth: 'S',
          round: 2,
          gate: null,
          status: 'running',
          createdAt: now,
          updatedAt: now,
        },
        null,
        2,
      )}\n`,
    )
    if (options.ledger !== undefined && options.ledger.length > 0) {
      fs.writeFileSync(path.join(runDir, 'sessions.jsonl'), options.ledger.join('\n') + '\n')
    }
    const stdoutLines: string[] = []
    const spawnArgs: Array<readonly string[]> = []
    const resolutions1 = JSON.stringify({ resolutions: [], assumptions: [] })
    const sidecars: Record<string, string> = {
      'findings-1.json': JSON.stringify({ findings: [] }),
      'resolutions-1.json': resolutions1,
      'findings-2.json': JSON.stringify({ findings: [] }),
      'resolutions-2.json': resolutions1,
      'decompose-tasks.json': JSON.stringify({ tasks_file: 'openspec/changes/add-thing/tasks.md' }),
    }
    const spawn: SpawnFn = (_command, args, spawnOptions) => {
      spawnArgs.push(args)
      const prompt = String(args[args.length - 1])
      const match = prompt.match(/\.review-loop\/([\w-]+\.json)/u)
      const basename = match?.[1] ?? 'unknown.json'
      if (basename === 'decompose-tasks.json') {
        fs.mkdirSync(path.join(changeDir), { recursive: true })
        fs.writeFileSync(path.join(changeDir, 'tasks.md'), '## 1. Section\n')
      }
      const content = sidecars[basename] ?? '{}'
      const target = agentWritePath(spawnOptions.cwd, basename)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, content)
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    }
    const driverExec = (args: readonly string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> => {
      const subcommand = args[1]
      if (subcommand === 'status') {
        return Promise.resolve({
          stdout: JSON.stringify({
            schemaName: 'auto-sdd',
            artifacts: [
              { id: 'proposal', status: 'done' },
              { id: 'specs', status: 'done' },
            ],
          }),
          stderr: '',
          exitCode: 0,
        })
      }
      if (subcommand === 'validate') {
        return Promise.resolve({ stdout: 'is valid', stderr: '', exitCode: 0 })
      }
      if (subcommand === 'instructions') {
        return Promise.resolve({
          stdout: JSON.stringify({
            instruction: 'write tasks',
            resolvedOutputPath: path.join(changeDir, 'tasks.md'),
          }),
          stderr: '',
          exitCode: 0,
        })
      }
      return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
    }
    const deps: OrchestratorDeps = {
      config: {
        repoRoot,
        workDir,
        model: 'm',
        budget: 5,
      },
      spawn,
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      driver: createOpenSpecDriver({ exec: driverExec, cwd: repoRoot }),
      stdout: (line) => {
        stdoutLines.push(line)
      },
      resolveCost: () => null,
    }
    return { deps, workDir, runDir, stdoutLines, spawnArgs, repoRoot }
  }

  const killedLedgerLine = JSON.stringify({
    label: 'resolver-r2',
    role: 'resolver',
    round: 2,
    attempt: 1,
    model: 'm',
    opencodeSessionId: 'ses_dead',
    status: 'killed',
    ts: '2026-01-01T00:00:00.000Z',
  })

  it('continues the in-flight session, reports the path on stdout, and records it in events.ndjson (L2)', async () => {
    const fixture = makeResumeFixture({ ledger: [killedLedgerLine] })
    const result = await runResume(fixture.deps, 'seeded-review')
    expect(result.halted).toBe('gate')
    const sessionSpawnCount = fixture.spawnArgs.filter((args) => args.includes('--session')).length
    expect(sessionSpawnCount).toBeGreaterThanOrEqual(1)
    expect(fixture.spawnArgs.some((args) => args.includes('ses_dead'))).toBe(true)
    expect(fixture.stdoutLines.some((line) => line.includes('session-continuation'))).toBe(true)
    const events = readEvents(path.join(fixture.runDir, 'events.ndjson'))
    const resumeEvents = events.filter(
      (e): e is Extract<(typeof events)[number], { type: 'resume' }> => e.type === 'resume',
    )
    expect(resumeEvents.length).toBeGreaterThanOrEqual(1)
    expect(resumeEvents[0]).toMatchObject({ path: 'session-continuation', session: 'ses_dead' })
  })

  it('a pre-change run (no ledger) resumes via the stage-boundary rebuild and records the fallback path', async () => {
    const fixture = makeResumeFixture({})
    const result = await runResume(fixture.deps, 'seeded-review')
    expect(result.halted).toBe('gate')
    expect(fixture.spawnArgs.every((args) => !args.includes('--session'))).toBe(true)
    const events = readEvents(path.join(fixture.runDir, 'events.ndjson'))
    const resumeEvents = events.filter(
      (e): e is Extract<(typeof events)[number], { type: 'resume' }> => e.type === 'resume',
    )
    expect(resumeEvents[0]).toMatchObject({ path: 'stage-rebuild' })
    expect(fixture.stdoutLines.some((line) => line.includes('stage-rebuild'))).toBe(true)
  })
})
