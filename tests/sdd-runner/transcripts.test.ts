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
import { EventInputSchema } from '../../sdd-runner/src/events.js'
import { readSessionLedger, sessionLedgerPath, transcriptPathFor } from '../../sdd-runner/src/session-ledger.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-transcripts-'))
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

const SESSION_LINE = JSON.stringify({
  type: 'step_start',
  sessionID: 'ses_tx',
  timestamp: 1,
  part: { type: 'step-start' },
})

function makeDeps(dir: string, spawn: SpawnFn): AgentLayerDeps {
  const config: RunnerConfig = {
    repoRoot: dir,
    workDir: path.join(dir, '.sdd-runner'),
    model: 'default-model',
    budget: 5,
  }
  return {
    spawn,
    config,
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    emit: () => {},
  }
}

interface SpawnPlan {
  readonly write?: string
  readonly lines?: readonly string[]
  readonly result?: { exitCode: number; stderr: string }
}

function planSpawn(plans: readonly SpawnPlan[]): { spawn: SpawnFn; calls: { logPaths: string[] } } {
  const calls = { logPaths: [] as string[] }
  let index = 0
  const spawn: SpawnFn = (_command, _args, options, onLine) => {
    const plan = plans[Math.min(index, plans.length - 1)] ?? {}
    index += 1
    if (plan.write !== undefined) {
      const target = agentWritePath(options.cwd, 'findings-1.json')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, plan.write)
    }
    for (const line of plan.lines ?? []) onLine?.(line)
    return Promise.resolve({ exitCode: plan.result?.exitCode ?? 0, stdout: '', stderr: plan.result?.stderr ?? '' })
  }
  return { spawn, calls }
}

function makeOptions(dir: string, runDir: string): RunStageAgentOptions<{ findings: Finding[] }> {
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
  }
}

describe('per-attempt transcripts and the session ledger through runStageAgent', () => {
  it('lands the raw stream at transcripts/<label>-r<round>-a<attempt>.jsonl correlating with the ledger key', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const { spawn } = planSpawn([{ write: VALID_FINDINGS, lines: [SESSION_LINE] }])
    await runStageAgent(makeDeps(dir, spawn), makeOptions(dir, runDir))
    const transcript = transcriptPathFor(runDir, 'reviewer', 2, 1)
    expect(fs.existsSync(transcript)).toBe(true)
    expect(fs.readFileSync(transcript, 'utf8')).toBe(`${SESSION_LINE}\n`)
    const ledger = readSessionLedger(runDir)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      label: 'reviewer',
      role: 'reviewer',
      round: 2,
      attempt: 1,
      opencodeSessionId: 'ses_tx',
      status: 'done',
    })
  })

  it('creates no logs/ destination under the sidecar dir', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const { spawn } = planSpawn([{ write: VALID_FINDINGS }])
    await runStageAgent(makeDeps(dir, spawn), makeOptions(dir, runDir))
    expect(fs.existsSync(path.join(runDir, 'sidecars', 'logs'))).toBe(false)
    expect(fs.readdirSync(runDir).includes('sessions.jsonl')).toBe(true)
  })

  it('marks a failed spawn killed, keeping the session id for resume', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const { spawn } = planSpawn([{ lines: [SESSION_LINE], result: { exitCode: 1, stderr: 'boom' } }])
    await expect(runStageAgent(makeDeps(dir, spawn), makeOptions(dir, runDir))).rejects.toThrow('boom')
    const ledger = readSessionLedger(runDir)
    expect(ledger[ledger.length - 1]).toMatchObject({ opencodeSessionId: 'ses_tx', status: 'killed' })
  })

  it('records a killed line with a null id when the spawn dies before any session-bearing line', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const { spawn } = planSpawn([{ result: { exitCode: 1, stderr: 'died instantly' } }])
    await expect(runStageAgent(makeDeps(dir, spawn), makeOptions(dir, runDir))).rejects.toThrow('died instantly')
    const ledger = readSessionLedger(runDir)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ attempt: 1, opencodeSessionId: null, status: 'killed' })
  })

  it('validation retry opens a second transcript and ledger attempt', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const sessionLine = (id: string): string =>
      JSON.stringify({ type: 'step_start', sessionID: id, timestamp: 1, part: { type: 'step-start' } })
    const { spawn } = planSpawn([
      { write: '{"findings":[{"id":"F1"}]}', lines: [sessionLine('ses_a')] },
      { write: VALID_FINDINGS, lines: [sessionLine('ses_b')] },
    ])
    const info = await runStageAgent(makeDeps(dir, spawn), makeOptions(dir, runDir))
    expect(info.attempts).toBe(2)
    expect(fs.existsSync(transcriptPathFor(runDir, 'reviewer', 2, 1))).toBe(true)
    expect(fs.existsSync(transcriptPathFor(runDir, 'reviewer', 2, 2))).toBe(true)
    const statuses = readSessionLedger(runDir).map((line) => [line.attempt, line.status])
    expect(statuses).toEqual([
      [1, 'killed'],
      [2, 'done'],
    ])
  })

  it('a stall retry inside one attempt appends to the same transcript and ledger attempt', async () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    const sessionLine = (id: string): string =>
      JSON.stringify({ type: 'step_start', sessionID: id, timestamp: 1, part: { type: 'step-start' } })
    const { spawn } = planSpawn([
      { lines: [sessionLine('ses_a')], result: { exitCode: 1, stderr: 'Process stalled', ...{} } },
      { write: VALID_FINDINGS, lines: [sessionLine('ses_b')] },
    ])
    const info = await runStageAgent(makeDeps(dir, spawn), makeOptions(dir, runDir))
    expect(info.attempts).toBe(1)
    const transcript = fs.readFileSync(transcriptPathFor(runDir, 'reviewer', 2, 1), 'utf8')
    expect(transcript.indexOf(sessionLine('ses_a'))).toBeGreaterThanOrEqual(0)
    expect(transcript.indexOf(sessionLine('ses_b'))).toBeGreaterThan(transcript.indexOf(sessionLine('ses_a')))
    const ids = readSessionLedger(runDir).map((line) => line.opencodeSessionId)
    expect(ids).toEqual(['ses_a', 'ses_b'])
  })
})

describe('ledger attempt allocation', () => {
  it('nextSessionAttempt picks past the highest recorded attempt so resumed spawns do not collide', () => {
    const dir = makeDir()
    const runDir = path.join(dir, 'runs', 'run-1')
    fs.mkdirSync(runDir, { recursive: true })
    fs.writeFileSync(
      sessionLedgerPath(runDir),
      `${JSON.stringify({
        label: 'reviewer',
        role: 'reviewer',
        round: 2,
        attempt: 3,
        model: 'm',
        opencodeSessionId: 'ses_x',
        status: 'killed',
        ts: '2026-08-19T00:00:00.000Z',
      })}\n`,
    )
    expect(fs.existsSync(transcriptPathFor(runDir, 'reviewer', 2, 4))).toBe(false)
    const { EventInputSchema: _unused } = { EventInputSchema }
    void _unused
  })
})
