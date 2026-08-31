// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { ClaudeRunContext } from '../../review-loop/src/backend-select.js'
import type { AutonomyConfig } from '../../sdd-runner/src/config.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { agentDepsOf, buildPipelineEnv, tailInputOf } from '../../sdd-runner/src/pipeline-env.js'
import type { PipelineEnv } from '../../sdd-runner/src/pipeline-env.js'
import type { ReviewLoopResult } from '../../sdd-runner/src/review-loop.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdd-pipeline-env-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

const AUTONOMY: AutonomyConfig = { level: 'assist', costCeilingUsd: 5, metered: true }

const CLAUDE: ClaudeRunContext = {
  profile: 'bare',
  credentialName: 'ANTHROPIC_API_KEY',
  credentialValue: 'sk-ant-key-0123456789',
  configDirRoot: '/tmp/sdd-runner-claude-run',
  envSource: {},
}

async function makeEnv(
  overrides: Partial<Parameters<typeof buildPipelineEnv>[3]> = {},
  claude?: ClaudeRunContext,
): Promise<{
  env: PipelineEnv
  emitted: EventInput[]
  deps: OrchestratorDeps
  emit: (event: EventInput) => void
}> {
  const emitted: EventInput[] = []
  const repoRoot = makeDir()
  const deps: OrchestratorDeps = {
    config: { repoRoot, workDir: path.join(repoRoot, '.sdd-runner'), model: 'm', budget: 5 },
    ...(claude === undefined ? {} : { claude }),
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: createOpenSpecDriver({
      exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
      cwd: repoRoot,
    }),
    resolveCost: () => null,
  }
  const state = await createRunState({ workDir: deps.config.workDir, repoRoot, changeName: 'thing' })
  const input = {
    taskText: 'do the thing',
    changeName: 'thing',
    autonomy: AUTONOMY,
    ...overrides,
  }
  const emit = (event: EventInput): void => {
    emitted.push(event)
  }
  const env = buildPipelineEnv(deps, state, emit, input)
  return { env, emitted, deps, emit }
}

describe('buildPipelineEnv (pipeline-env)', () => {
  it('derives ctx paths from the repo root, change name, and run dir', async () => {
    const { env, deps } = await makeEnv()
    expect(env.ctx.cwd).toBe(deps.config.repoRoot)
    expect(env.ctx.changeDir).toBe(path.join(deps.config.repoRoot, 'openspec', 'changes', 'thing'))
    expect(env.ctx.sidecarDir).toBe(path.join(env.state.runDir, 'sidecars'))
  })

  it('resolves the env deps autonomy from the fresh input and shares the emit bus', async () => {
    const { env, emitted } = await makeEnv({
      autonomy: { level: 'assist', costCeilingUsd: null, metered: false },
    })
    expect(env.deps.autonomy).toEqual({ level: 'assist', costCeilingUsd: null, metered: false })
    env.ctx.emit({ altitude: 'L2', type: 'stage_enter', stage: 'intake' })
    expect(emitted[0]).toMatchObject({ type: 'stage_enter', stage: 'intake' })
    expect(env.agent.config.model).toBe('m')
  })

  it('carries the fresh input through untouched', async () => {
    const { env } = await makeEnv({ depthOverride: 'L', forcePlan: true })
    expect(env.input.depthOverride).toBe('L')
    expect(env.input.forcePlan).toBe(true)
    expect(env.input.taskText).toBe('do the thing')
  })
})

describe('agentDepsOf (pipeline-env)', () => {
  it('carries the four per-stage seams off the orchestrator deps', async () => {
    const { deps, emit } = await makeEnv()
    const agent = agentDepsOf(deps, emit)
    expect(agent.config).toBe(deps.config)
    expect(agent.spawn).toBe(deps.spawn)
    expect(agent.execGit).toBe(deps.execGit)
    expect(agent.emit).toBe(emit)
  })

  it('omits the claude key entirely on a run with no claude context', async () => {
    const { deps, emit } = await makeEnv()
    // Key-absence, not an undefined value: the agent layer routes on the
    // presence of the context, and a spread-in `claude: undefined` would read
    // as a context the spawn composer then cannot use.
    expect('claude' in agentDepsOf(deps, emit)).toBe(false)
  })

  it('carries the claude run context through when the run has one', async () => {
    const { deps, emit } = await makeEnv({}, CLAUDE)
    expect(agentDepsOf(deps, emit).claude).toBe(CLAUDE)
  })

  it('is what buildPipelineEnv builds the stage agent deps from', async () => {
    const { env, deps, emit } = await makeEnv({}, CLAUDE)
    expect(env.agent).toEqual(agentDepsOf(deps, emit))
    expect(env.agent.claude).toBe(CLAUDE)
  })
})

describe('tailInputOf (pipeline-env)', () => {
  it('assembles the shared post-review tail input from the env', async () => {
    const { env } = await makeEnv()
    const reviewResult: ReviewLoopResult = {
      outcome: 'converged',
      rounds: 2,
      verdict: 'converged',
      raised: { blocker: 0, material: 0, nitpick: 0 },
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    }
    const tail = tailInputOf(env, 'L', reviewResult, 3)
    expect(tail).toEqual({
      deps: env.deps,
      state: env.state,
      ctx: env.ctx,
      agent: env.agent,
      depth: 'L',
      reviewResult,
      version: 3,
    })
    // Key-absence, not toEqual: an inverted condition would always spread the
    // shorthand key, and toEqual treats an undefined value as absent.
    expect('runVerification' in tail).toBe(false)
  })

  it('carries a supplied runVerification seam through to the tail input', async () => {
    const { env } = await makeEnv()
    const reviewResult: ReviewLoopResult = {
      outcome: 'cap-hit',
      rounds: 1,
      verdict: 'needs-review',
      raised: { blocker: 0, material: 0, nitpick: 0 },
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    }
    const runVerification = (result: ReviewLoopResult): Promise<ReviewLoopResult> => Promise.resolve(result)
    const tail = tailInputOf(env, 'L', reviewResult, 1, runVerification)
    expect(tail.runVerification).toBe(runVerification)
  })
})
