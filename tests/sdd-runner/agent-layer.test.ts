// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { agentWritePath } from '../../review-loop/src/agent-runner.js'
import type { SpawnFn, SpawnResult } from '../../review-loop/src/agent-runner.js'
import {
  AssumptionsSidecarSchema,
  DepthClassificationSchema,
  FindingsSidecarSchema,
  ResolutionsSidecarSchema,
  runStageAgent,
} from '../../sdd-runner/src/agent-layer.js'
import type { AgentLayerDeps, Finding, RunStageAgentOptions } from '../../sdd-runner/src/agent-layer.js'
import type { RunnerConfig } from '../../sdd-runner/src/config.js'
import { EventInputSchema } from '../../sdd-runner/src/events.js'
import type { EventInput } from '../../sdd-runner/src/events.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-agent-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeConfig(dir: string): RunnerConfig {
  return {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'default-model',
    models: { reviewer: 'reviewer-model' },
    timeouts: { wallClockMs: 60_000, inactivityMs: 5_000 },
  }
}

const VALID_FINDINGS = JSON.stringify({
  findings: [
    {
      id: 'F1',
      class: 'BLOCKER',
      gap: 'the proposal never names the scope id',
      question: 'which scope id keys this state?',
      code_evidence_attempted: 'searched src/chat/context-scope.ts for the declaration',
    },
  ],
})

interface FakeSpawn {
  readonly spawn: SpawnFn
  readonly prompts: string[]
  readonly models: string[]
  readonly inactivity: Array<number | undefined>
  readonly calls: { count: number }
}

function makeFakeSpawn(
  basename: string,
  outcomes: Array<{ write?: string; result?: Partial<SpawnResult> }>,
): FakeSpawn {
  const prompts: string[] = []
  const models: string[] = []
  const inactivity: Array<number | undefined> = []
  const calls = { count: 0 }
  const spawn: SpawnFn = (_command, args, options) => {
    const outcome = outcomes[Math.min(calls.count, outcomes.length - 1)] ?? {}
    calls.count += 1
    prompts.push(String(args[args.length - 1]))
    const modelIndex = args.indexOf('--model')
    models.push(String(args[modelIndex + 1]))
    inactivity.push(options.inactivityTimeoutMs)
    const write = outcome.write
    if (write !== undefined) {
      const target = agentWritePath(options.cwd, basename)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, write)
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '', ...outcome.result })
  }
  return { spawn, prompts, models, inactivity, calls }
}

function makeGitExec(
  porcelain: string,
): (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }> {
  return (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: porcelain, stderr: '' })
}

interface AgentHandle {
  readonly agent: AgentLayerDeps
  readonly emitted: EventInput[]
}

function makeAgent(dir: string, fake: FakeSpawn, porcelain = ''): AgentHandle {
  const emitted: EventInput[] = []
  const agent: AgentLayerDeps = {
    spawn: fake.spawn,
    config: makeConfig(dir),
    execGit: makeGitExec(porcelain),
    emit: (event) => {
      emitted.push(EventInputSchema.parse(event))
    },
  }
  return { agent, emitted }
}

function retryings(emitted: readonly EventInput[]): Array<{ reason: 'stall' | 'validation'; attempt: number }> {
  return emitted
    .filter((e): e is Extract<EventInput, { type: 'retrying' }> => e.type === 'retrying')
    .map((e) => ({ reason: e.reason, attempt: e.attempt }))
}

function makeOptions(dir: string, basename: string): RunStageAgentOptions<{ findings: Finding[] }> {
  return {
    role: 'reviewer' as const,
    changeName: 'add-thing',
    cwd: dir,
    prompt: 'Review the artifacts.',
    outputPath: basename,
    outputSchema: FindingsSidecarSchema,
    label: 'reviewer-r1',
    logPath: path.join(dir, 'logs', 'reviewer-r1.log'),
    sidecarDir: path.join(dir, 'sidecars'),
  }
}

describe('sidecar schemas', () => {
  it('accepts well-formed findings and rejects a finding without a gap quote', () => {
    const good = FindingsSidecarSchema.safeParse(JSON.parse(VALID_FINDINGS))
    expect(good.success).toBe(true)
    const missingGap = { findings: [{ id: 'F1', class: 'BLOCKER', question: 'q', code_evidence_attempted: 'read x' }] }
    expect(FindingsSidecarSchema.safeParse(missingGap).success).toBe(false)
  })

  it('requires a justification when a resolution dismisses', () => {
    const dismissed = {
      resolutions: [
        { id: 'F1', class: 'NITPICK', resolution: 'dismissed', justification: 'answered verbatim in design D2' },
      ],
    }
    expect(ResolutionsSidecarSchema.safeParse(dismissed).success).toBe(true)
    const unjustified = { resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'dismissed' }] }
    expect(ResolutionsSidecarSchema.safeParse(unjustified).success).toBe(false)
  })

  it('validates assumption records with basis and status enums', () => {
    const record = {
      assumptions: [
        {
          id: 'A1',
          text: 'guests stay read-only',
          basis: 'convention',
          confidence: 'medium',
          blast_radius: 'group replies',
          status: 'open',
        },
      ],
    }
    expect(AssumptionsSidecarSchema.safeParse(record).success).toBe(true)
    const badBasis = {
      assumptions: [{ id: 'A1', text: 'x', basis: 'guesswork', confidence: 'low', blast_radius: 'y', status: 'open' }],
    }
    expect(AssumptionsSidecarSchema.safeParse(badBasis).success).toBe(false)
  })

  it('validates the depth classification sidecar with structured signals', () => {
    const classification = {
      implicated_files: ['src/chat/router.ts', 'drizzle/0001_x.sql'],
      signals: {
        cross_module: true,
        db_migration: true,
        provider_surface: false,
        credentials: false,
        novelty: 'existing-modules',
      },
      rationale: 'touches the chat router and adds a migration',
    }
    expect(DepthClassificationSchema.safeParse(classification).success).toBe(true)
    const bad = { implicated_files: [], signals: { cross_module: 'yes' }, rationale: 'x' }
    expect(DepthClassificationSchema.safeParse(bad).success).toBe(false)
  })
})

describe('runStageAgent', () => {
  it('runs one attempt, emits spawned and done+usage around the run, and persists the sidecar', async () => {
    const dir = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS }])
    const { agent, emitted } = makeAgent(dir, fake)
    const info = await runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    expect(info.attempts).toBe(1)
    expect(info.value.findings[0]?.id).toBe('F1')
    expect(fake.models[0]).toBe('reviewer-model')
    expect(fake.inactivity[0]).toBe(5_000)
    const persisted: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'sidecars', 'findings-1.json'), 'utf8'))
    expect(FindingsSidecarSchema.safeParse(persisted).success).toBe(true)
    expect(emitted[0]).toMatchObject({
      type: 'spawned',
      agent: 'reviewer-r1',
      role: 'reviewer',
      model: 'reviewer-model',
    })
    const doneEvents = emitted.filter((e): e is Extract<EventInput, { type: 'done' }> => e.type === 'done')
    expect(doneEvents).toHaveLength(1)
    expect(doneEvents[0]).toMatchObject({ agent: 'reviewer-r1' })
    expect(doneEvents[0]?.usage).toBeDefined()
    expect(retryings(emitted)).toEqual([])
  })

  it('retries a validation failure with the validator error appended to the prompt', async () => {
    const dir = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [{ write: '{"findings":[{"id":"F1"}]}' }, { write: VALID_FINDINGS }])
    const { agent, emitted } = makeAgent(dir, fake)
    const info = await runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    expect(info.attempts).toBe(2)
    expect(retryings(emitted)).toEqual([{ reason: 'validation', attempt: 2 }])
    expect(fake.prompts[0]).not.toContain('Previous attempt failed')
    expect(fake.prompts[1]).toContain('Previous attempt failed')
  })

  it('halts after the second invalid sidecar instead of retrying forever', async () => {
    const dir = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [
      { write: '{"findings":[{"id":"F1"}]}' },
      { write: '{"findings":[{"id":"F1"}]}' },
    ])
    const { agent } = makeAgent(dir, fake)
    const run = runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    await expect(run).rejects.toThrow(/validation/u)
    expect(fake.calls.count).toBe(2)
  })

  it('does not retry a wall-clock timeout', async () => {
    const dir = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [{ result: { exitCode: 1, timedOut: true } }])
    const { agent } = makeAgent(dir, fake)
    const run = runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    await expect(run).rejects.toThrow()
    expect(fake.calls.count).toBe(1)
  })

  it('reports the internal stall retry without consuming the validation budget', async () => {
    const dir = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [
      { result: { exitCode: 1, timedOut: true, stalled: true } },
      { write: VALID_FINDINGS },
    ])
    const { agent, emitted } = makeAgent(dir, fake)
    const info = await runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    expect(info.attempts).toBe(1)
    expect(retryings(emitted)).toEqual([{ reason: 'stall', attempt: 1 }])
    expect(fake.calls.count).toBe(2)
  })

  it('halts resumable when the diff guard flags edits outside the change folder', async () => {
    const dir = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS }])
    const { agent } = makeAgent(dir, fake, ' M src/chat/router.ts\n')
    const run = runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    await expect(run).rejects.toThrow(/src\/chat\/router\.ts/u)
    expect(fake.calls.count).toBe(1)
  })

  it('passes the diff guard when only the change folder changed', async () => {
    const dir = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS }])
    const { agent } = makeAgent(
      dir,
      fake,
      ' M openspec/changes/add-thing/specs/x/spec.md\n?? openspec/changes/add-thing/review.md\n',
    )
    const info = await runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    expect(info.attempts).toBe(1)
  })

  it('writes the sidecar into sidecarDir and leaves no stray copy at the process cwd (F1 seam)', async () => {
    const agentCwd = makeDir()
    const processCwd = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS }])
    const { agent } = makeAgent(agentCwd, fake)
    const options = makeOptions(agentCwd, 'findings-1.json')
    const originalCwd = process.cwd()
    process.chdir(processCwd)
    try {
      const info = await runStageAgent(agent, options)
      expect(info.attempts).toBe(1)
      expect(fs.existsSync(path.join(options.sidecarDir, 'findings-1.json'))).toBe(true)
      expect(fs.existsSync(path.join(processCwd, 'findings-1.json'))).toBe(false)
    } finally {
      process.chdir(originalCwd)
    }
  })
})
