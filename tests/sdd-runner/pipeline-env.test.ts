// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { AutonomyConfig } from '../../sdd-runner/src/config.js'
import type { EventInput } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { buildPipelineEnv, tailInputOf } from '../../sdd-runner/src/pipeline-env.js'
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

async function makeEnv(
  overrides: Partial<Parameters<typeof buildPipelineEnv>[3]> = {},
): Promise<{ env: PipelineEnv; emitted: EventInput[]; deps: OrchestratorDeps }> {
  const emitted: EventInput[] = []
  const repoRoot = makeDir()
  const deps: OrchestratorDeps = {
    config: { repoRoot, workDir: path.join(repoRoot, '.sdd-runner'), model: 'm', budget: 5 },
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
  return { env, emitted, deps }
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

describe('tailInputOf (pipeline-env)', () => {
  it('assembles the shared post-review tail input from the env', async () => {
    const { env } = await makeEnv()
    const reviewResult: ReviewLoopResult = {
      outcome: 'converged',
      rounds: 2,
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
  })
})
