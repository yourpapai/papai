// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import assert from 'node:assert'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  AgentValidationError,
  AssumptionRecordSchema,
  AssumptionsSidecarSchema,
  DepthClassificationSchema,
  FindingsSidecarSchema,
  ResolutionsSidecarSchema,
  runStageAgent,
} from '../../../afk-runner/src/agent-layer.js'
import type { AgentLayerDeps, Finding, RunStageAgentOptions } from '../../../afk-runner/src/agent-layer.js'
import { INACTIVITY_TIMEOUT_MS } from '../../../afk-runner/src/config.js'
import type { RunnerConfig } from '../../../afk-runner/src/config.js'
import { EventInputSchema } from '../../../afk-runner/src/events.js'
import type { EventInput } from '../../../afk-runner/src/events.js'
import { readSessionLedger, recordSessionId, updateSessionStatus } from '../../../afk-runner/src/session-ledger.js'
import { ResolverOutputSchema } from '../../../afk-runner/src/work/review-loop.js'
import type { ResolverOutput } from '../../../afk-runner/src/work/review-loop.js'
import { agentWritePath } from '../../../review-loop/src/agent-runner.js'
import type { LineSink, SpawnFn, SpawnResult } from '../../../review-loop/src/agent-runner.js'

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
    budget: 5,
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
  readonly argsList: string[][]
  readonly inactivity: Array<number | undefined>
  readonly calls: { count: number }
}

function makeFakeSpawn(
  basename: string,
  outcomes: Array<{
    write?: string
    result?: Partial<SpawnResult>
    lines?: readonly string[]
  }>,
): FakeSpawn {
  const prompts: string[] = []
  const models: string[] = []
  const argsList: string[][] = []
  const inactivity: Array<number | undefined> = []
  const calls = { count: 0 }
  const spawn: SpawnFn = (_command, args, options, onLine) => {
    const outcome = outcomes[Math.min(calls.count, outcomes.length - 1)] ?? {}
    calls.count += 1
    prompts.push(String(args[args.length - 1]))
    argsList.push([...args])
    const modelIndex = args.indexOf('--model')
    models.push(String(args[modelIndex + 1]))
    inactivity.push(options.inactivityTimeoutMs)
    const write = outcome.write
    if (write !== undefined) {
      const target = agentWritePath(options.cwd, basename)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, write)
    }
    if (outcome.lines !== undefined && onLine !== undefined) {
      const sink: LineSink = onLine
      for (const line of outcome.lines) sink(line)
    }
    return Promise.resolve({
      exitCode: 0,
      stdout: '',
      stderr: '',
      ...outcome.result,
    })
  }
  return { spawn, prompts, models, argsList, inactivity, calls }
}

function makeGitExec(
  porcelain: string,
): (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }> {
  return (): Promise<{ stdout: string; stderr: string }> => Promise.resolve({ stdout: porcelain, stderr: '' })
}

function sequencedExecGit(
  outputs: readonly string[],
): (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }> {
  let i = 0
  return (): Promise<{ stdout: string; stderr: string }> => {
    const stdout = outputs[Math.min(i, outputs.length - 1)] ?? ''
    i += 1
    return Promise.resolve({ stdout, stderr: '' })
  }
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
    runDir: dir,
    round: 1,
    sidecarDir: path.join(dir, 'sidecars'),
  }
}

describe('sidecar schemas', () => {
  it('accepts well-formed findings and rejects a finding without a gap quote', () => {
    const good = FindingsSidecarSchema.safeParse(JSON.parse(VALID_FINDINGS))
    expect(good.success).toBe(true)
    const missingGap = {
      findings: [
        {
          id: 'F1',
          class: 'BLOCKER',
          question: 'q',
          code_evidence_attempted: 'read x',
        },
      ],
    }
    expect(FindingsSidecarSchema.safeParse(missingGap).success).toBe(false)
  })

  it('requires a justification when a resolution dismisses', () => {
    const dismissed = {
      resolutions: [
        {
          id: 'F1',
          class: 'NITPICK',
          resolution: 'dismissed',
          justification: 'answered verbatim in design D2',
        },
      ],
    }
    expect(ResolutionsSidecarSchema.safeParse(dismissed).success).toBe(true)
    const unjustified = {
      resolutions: [{ id: 'F1', class: 'NITPICK', resolution: 'dismissed' }],
    }
    const parsed = ResolutionsSidecarSchema.safeParse(unjustified)
    expect(parsed.success).toBe(false)
    assert(!parsed.success)
    expect(parsed.error.issues[0]?.message).toBe('dismissed resolutions require a justification')
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
          evidence: { files: ['openspec/changes/foo/design.md'] },
        },
      ],
    }
    expect(AssumptionsSidecarSchema.safeParse(record).success).toBe(true)
    const badBasis = {
      assumptions: [
        {
          id: 'A1',
          text: 'x',
          basis: 'guesswork',
          confidence: 'low',
          blast_radius: 'y',
          status: 'open',
          evidence: { files: ['a.md'] },
        },
      ],
    }
    expect(AssumptionsSidecarSchema.safeParse(badBasis).success).toBe(false)
  })

  it('rejects resolver assumptions that reuse a finding-style id instead of the A-prefix convention', () => {
    const recordWithId = (id: string): ResolverOutput => ({
      resolutions: [],
      assumptions: [
        {
          id,
          text: 'Plan-gate veto rounds are unbounded',
          basis: 'default',
          confidence: 'medium',
          blast_radius: 'plan-gate loop',
          status: 'open',
          evidence: { files: ['openspec/changes/foo/design.md'] },
        },
      ],
    })
    const result = ResolverOutputSchema.safeParse(recordWithId('F4'))
    expect(result.success).toBe(false)
    expect(() => ResolverOutputSchema.parse(recordWithId('F4'))).toThrow(/A-prefix convention/u)
    expect(ResolverOutputSchema.safeParse(recordWithId('A12')).success).toBe(true)
    for (const malformed of ['A1x', 'AA1']) {
      expect(ResolverOutputSchema.safeParse(recordWithId(malformed)).success).toBe(false)
    }
  })

  it('requires per-assumption evidence.files and rejects missing or empty lists', () => {
    const withEvidence = {
      assumptions: [
        {
          id: 'A1',
          text: 't',
          basis: 'default',
          confidence: 'high',
          blast_radius: 'b',
          status: 'open',
          evidence: { files: ['openspec/changes/foo/design.md'] },
        },
      ],
    }
    expect(AssumptionsSidecarSchema.safeParse(withEvidence).success).toBe(true)
    const missing = {
      assumptions: [
        {
          id: 'A1',
          text: 't',
          basis: 'default',
          confidence: 'high',
          blast_radius: 'b',
          status: 'open',
        },
      ],
    }
    expect(AssumptionsSidecarSchema.safeParse(missing).success).toBe(false)
    const emptyFiles = {
      assumptions: [
        {
          id: 'A1',
          text: 't',
          basis: 'default',
          confidence: 'high',
          blast_radius: 'b',
          status: 'open',
          evidence: { files: [] },
        },
      ],
    }
    expect(AssumptionsSidecarSchema.safeParse(emptyFiles).success).toBe(false)
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
    const newSubsystem = DepthClassificationSchema.safeParse({
      ...classification,
      signals: { ...classification.signals, novelty: 'new-subsystem' },
    })
    expect(newSubsystem.success).toBe(true)
    const bad = {
      implicated_files: [],
      signals: { cross_module: 'yes' },
      rationale: 'x',
    }
    expect(DepthClassificationSchema.safeParse(bad).success).toBe(false)
  })

  it('validates the depth classification sidecar with and without capabilities', () => {
    const base = {
      implicated_files: ['src/chat/router.ts'],
      signals: {
        cross_module: false,
        db_migration: false,
        provider_surface: false,
        credentials: false,
        novelty: 'existing-modules',
      },
      rationale: 'single-module chat change',
    }
    const withCapabilities = DepthClassificationSchema.parse({
      ...base,
      capabilities: ['codeindex', 'web-fetch'],
    })
    expect(withCapabilities.capabilities).toEqual(['codeindex', 'web-fetch'])

    const withoutCapabilities = DepthClassificationSchema.parse(base)
    expect(withoutCapabilities.capabilities).toBeUndefined()

    const emptyString = DepthClassificationSchema.safeParse({
      ...base,
      capabilities: [''],
    })
    expect(emptyString.success).toBe(false)
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
    expect(fake.models[0]).toBe('default-model')
    expect(fake.inactivity[0]).toBe(INACTIVITY_TIMEOUT_MS)
    const persisted: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'sidecars', 'findings-1.json'), 'utf8'))
    expect(FindingsSidecarSchema.safeParse(persisted).success).toBe(true)
    expect(emitted[0]).toMatchObject({
      type: 'spawned',
      agent: 'reviewer-r1',
      role: 'reviewer',
      model: 'default-model',
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
    // D3 exclusion: the intra-bracket schema-validation retry (attempt 2) is a
    // fresh spawn — validator error appended, never a --session continuation.
    expect(fake.argsList[0]!.includes('--session')).toBe(false)
    expect(fake.argsList[1]!.includes('--session')).toBe(false)
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

  it('types schema-validation exhaustion as AgentValidationError with the byte-identical message (C6 D1)', async () => {
    const dir = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [
      { write: '{"findings":[{"id":"F1"}]}' },
      { write: '{"findings":[{"id":"F1"}]}' },
    ])
    const { agent } = makeAgent(dir, fake)
    const failure = await runStageAgent(agent, makeOptions(dir, 'findings-1.json')).then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(AgentValidationError)
    expect(failure).toBeInstanceOf(Error)
    assert(failure instanceof AgentValidationError)
    expect(failure.name).toBe('AgentValidationError')
    expect(failure.kind).toBe('exhausted')
    expect(failure.message.startsWith('stage agent reviewer-r1 failed validation after 2 attempts: ')).toBe(true)
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
    const emitted: EventInput[] = []
    const execGit = sequencedExecGit(['', ' M src/chat/router.ts\n'])
    const agent: AgentLayerDeps = {
      spawn: fake.spawn,
      config: makeConfig(dir),
      execGit,
      emit: (event) => {
        emitted.push(EventInputSchema.parse(event))
      },
    }
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

  it('does not flag pre-existing dirty paths the agent did not touch (snapshot diff)', async () => {
    const dir = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS }])
    const preExisting = ' M package.json\n?? task.md\n M openspec/changes/add-thing/specs/x/spec.md\n'
    const { agent } = makeAgent(dir, fake, preExisting)
    const info = await runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    expect(info.attempts).toBe(1)
  })

  it('still flags a path the agent newly dirties outside the change folder', async () => {
    const dir = makeDir()
    const execGit = sequencedExecGit(['', ' M src/chat/router.ts\n?? task.md\n'])
    const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS }])
    const emitted: EventInput[] = []
    const agent: AgentLayerDeps = {
      spawn: fake.spawn,
      config: makeConfig(dir),
      execGit,
      emit: (event) => {
        emitted.push(EventInputSchema.parse(event))
      },
    }
    const run = runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    await expect(run).rejects.toThrow(
      'agent edited files outside the change folder openspec/changes/add-thing/: src/chat/router.ts, task.md',
    )
  })

  it('fails the guard when the agent dirties a sibling change folder, naming the offending path and the allowed folder', async () => {
    const dir = makeDir()
    const execGit = sequencedExecGit(['', '?? openspec/changes/other-change/x.md\n'])
    const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS }])
    const agent: AgentLayerDeps = {
      spawn: fake.spawn,
      config: makeConfig(dir),
      execGit,
      emit: () => undefined,
    }
    const run = runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    await expect(run).rejects.toThrow(
      'agent edited files outside the change folder openspec/changes/add-thing/: openspec/changes/other-change/x.md',
    )
  })

  it('fails the guard on a prefix-sharing sibling — a shared name prefix does not widen the allowed folder', async () => {
    const dir = makeDir()
    const execGit = sequencedExecGit(['', '?? openspec/changes/add-thing-extra/spec.md\n'])
    const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS }])
    const agent: AgentLayerDeps = {
      spawn: fake.spawn,
      config: makeConfig(dir),
      execGit,
      emit: () => undefined,
    }
    const run = runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    await expect(run).rejects.toThrow(
      'agent edited files outside the change folder openspec/changes/add-thing/: openspec/changes/add-thing-extra/spec.md',
    )
  })

  it('falls back to a fresh prompt-rebuild spawn when the continuation fails', async () => {
    const dir = makeDir()
    const fake = makeFakeSpawn('findings-1.json', [{ result: { exitCode: 1 } }, { write: VALID_FINDINGS }])
    const { agent, emitted } = makeAgent(dir, fake)
    const options: RunStageAgentOptions<{ findings: Finding[] }> = {
      ...makeOptions(dir, 'findings-1.json'),
      continueSessionId: 'sess-1',
    }
    const info = await runStageAgent(agent, options)
    expect(info.attempts).toBe(1)
    expect(fake.prompts[0]).toContain('Continue the interrupted task in this session.')
    expect(fake.prompts[0]).toContain(`Write your JSON result to ${agentWritePath(dir, 'findings-1.json')}`)
    expect(fake.prompts[0]).toContain('now.')
    expect(fake.prompts[1]).toBe('Review the artifacts.')
    expect(retryings(emitted)).toEqual([{ reason: 'validation', attempt: 2 }])
  })

  describe('stage re-entry continuation seam (escalation-retry-session-continuation D1/D2)', () => {
    const ledgerInput = { label: 'reviewer-r1', role: 'reviewer', round: 1, model: 'default-model' }

    function seedKilled(dir: string, sessionId: string): void {
      recordSessionId(dir, ledgerInput, sessionId)
      updateSessionStatus(dir, 'reviewer-r1', 1, 'killed')
    }

    function sessionIndexOf(argv: readonly string[]): number {
      return argv.indexOf('--session')
    }

    it('continues a killed (label, round) entry: continuation prompt, --session arg, same id on a new ledger line', async () => {
      const dir = makeDir()
      seedKilled(dir, 'ses-killed')
      const sessionLine = JSON.stringify({ sessionID: 'ses-killed' })
      const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS, lines: [sessionLine] }])
      const { agent } = makeAgent(dir, fake)
      const info = await runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
      expect(info.attempts).toBe(1)
      expect(fake.prompts[0]).toContain('Continue the interrupted task in this session.')
      expect(fake.prompts[0]).not.toBe('Review the artifacts.')
      const argIndex = sessionIndexOf(fake.argsList[0]!)
      expect(argIndex).toBeGreaterThan(-1)
      expect(fake.argsList[0]![argIndex + 1]).toBe('ses-killed')
      // ledger honesty (D6): one new attempt line carrying the SAME opencode session id
      const lines = readSessionLedger(dir).filter((line) => line.label === 'reviewer-r1')
      expect(lines).toHaveLength(2)
      expect(lines[0]).toMatchObject({ attempt: 1, opencodeSessionId: 'ses-killed', status: 'killed' })
      expect(lines[1]).toMatchObject({ attempt: 2, opencodeSessionId: 'ses-killed', status: 'done' })
    })

    it('spawns fresh with no ledger entry — today argv, no --session', async () => {
      const dir = makeDir()
      const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS }])
      const { agent } = makeAgent(dir, fake)
      await runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
      expect(fake.prompts[0]).toBe('Review the artifacts.')
      expect(sessionIndexOf(fake.argsList[0]!)).toBe(-1)
    })

    it('a seam continuation failure falls back to the fresh prompt-rebuild spawn with the existing retrying event', async () => {
      const dir = makeDir()
      seedKilled(dir, 'ses-killed')
      const fake = makeFakeSpawn('findings-1.json', [{ result: { exitCode: 1 } }, { write: VALID_FINDINGS }])
      const { agent, emitted } = makeAgent(dir, fake)
      const info = await runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
      expect(info.attempts).toBe(1)
      expect(fake.prompts[0]).toContain('Continue the interrupted task in this session.')
      expect(fake.prompts[1]).toBe('Review the artifacts.')
      expect(sessionIndexOf(fake.argsList[0]!)).toBeGreaterThan(-1)
      expect(sessionIndexOf(fake.argsList[1]!)).toBe(-1)
      expect(retryings(emitted)).toEqual([{ reason: 'validation', attempt: 2 }])
    })

    it('a dangling spawned entry spawns fresh — crashes keep the fresh rebuild for non-review stages', async () => {
      const dir = makeDir()
      recordSessionId(dir, ledgerInput, 'ses-dangling')
      const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS }])
      const { agent } = makeAgent(dir, fake)
      await runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
      expect(fake.prompts[0]).toBe('Review the artifacts.')
      expect(sessionIndexOf(fake.argsList[0]!)).toBe(-1)
    })
  })

  it('forwards an L0 tool_use event to the bus when the spawned agent emits an opencode tool_use line', async () => {
    const dir = makeDir()
    const toolUseLine = JSON.stringify({
      type: 'tool_use',
      part: {
        tool: 'read',
        callID: 'call-1',
        state: { status: 'running', input: { filePath: 'foo.ts' } },
      },
    })
    const fake = makeFakeSpawn('findings-1.json', [{ write: VALID_FINDINGS, lines: [toolUseLine] }])
    const { agent, emitted } = makeAgent(dir, fake)
    await runStageAgent(agent, makeOptions(dir, 'findings-1.json'))
    const toolUseEvents = emitted.filter((e): e is Extract<EventInput, { type: 'tool_use' }> => e.type === 'tool_use')
    expect(toolUseEvents.length).toBeGreaterThanOrEqual(1)
    expect(toolUseEvents[0]).toMatchObject({
      agent: 'reviewer-r1',
      tool: 'read',
      arg: 'foo.ts',
    })
  })
})

describe('AssumptionRecordSchema findingId link', () => {
  function assumption(extra: Record<string, unknown> = {}): unknown {
    return {
      id: 'A1',
      text: 'guests stay read-only',
      basis: 'default',
      confidence: 'high',
      blast_radius: 'b',
      status: 'open',
      evidence: { files: ['openspec/changes/foo/proposal.md'] },
      ...extra,
    }
  }

  it('accepts an assumption carrying the finding it was assumed against', () => {
    expect(AssumptionRecordSchema.safeParse(assumption({ findingId: 'F3' })).success).toBe(true)
  })

  it('still accepts a pre-change assumption with no findingId', () => {
    expect(AssumptionRecordSchema.safeParse(assumption()).success).toBe(true)
  })

  it('rejects an empty findingId rather than treating it as absent', () => {
    expect(AssumptionRecordSchema.safeParse(assumption({ findingId: '' })).success).toBe(false)
  })

  it('leaves the A-prefix id convention unchanged', () => {
    expect(AssumptionRecordSchema.safeParse(assumption({ id: 'F1', findingId: 'F1' })).success).toBe(false)
  })
})
