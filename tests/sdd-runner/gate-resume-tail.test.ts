// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { GateResumeContext } from '../../sdd-runner/src/extend-round.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { settleApprovedGate, settleVeto } from '../../sdd-runner/src/gate-resume-tail.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-gate-resume-tail-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeDeps(dir: string): OrchestratorDeps {
  return {
    config: {
      repoRoot: dir,
      workDir: path.join(dir, '.sdd-runner'),
      model: 'm',
      budget: 5,
    },
    spawn: (_command, _args, options) => {
      const target = path.join(options.cwd, '.review-loop', 'veto-updater.json')
      fs.mkdirSync(path.dirname(target), { recursive: true })
      fs.writeFileSync(target, JSON.stringify({ files_updated: [] }))
      return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
    },
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: {
      newChange: () => Promise.resolve({ changeName: 'add-thing' }),
      instructions: () =>
        Promise.resolve({
          instruction: '',
          template: undefined,
          rules: [],
          resolvedOutputPath: '',
          existingOutputPaths: [],
          dependencies: [],
        }),
      validateStrict: () => Promise.resolve({ ok: true, output: '' }),
      status: () => Promise.resolve({ schemaName: 'auto-sdd', artifacts: {}, isPlanningComplete: false }),
    },
    resolveCost: () => null,
    stdout: () => {},
  }
}

function makeCtx(state: RunState, deps: OrchestratorDeps, emit: (e: unknown) => void = () => {}): GateResumeContext {
  const changeDir = path.join(state.repoRoot, 'openspec', 'changes', state.changeName)
  return {
    deps,
    state,
    emit,
    version: 1,
    changeDir,
    sidecarDir: path.join(state.runDir, 'sidecars'),
    agent: { spawn: deps.spawn, config: deps.config, execGit: deps.execGit, emit } as GateResumeContext['agent'],
  }
}

const CONVERGED = {
  outcome: 'converged',
  rounds: 1,
  openBlockers: [],
  openMaterial: [],
  openNitpicks: [],
} as const

describe('gate-resume-tail settle flows', () => {
  it('settles a final-mode approved gate to completed', async () => {
    const dir = makeDir()
    const state = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'add-thing' })
    state.depth = 'S'
    state.gate = { mode: 'final', version: 1 }
    const deps = makeDeps(dir)
    const result = await settleApprovedGate(makeCtx(state, deps), { ...CONVERGED })
    expect(result.outcome).toBe('approved')
    expect(result.version).toBe(1)
    // Awaited via .resolves on purpose: a bare expect(promise).toBeDefined() is
    // vacuously true and leaves the read racing this test's afterEach rmSync —
    // under threadpool load the read lost that race, and the floating ENOENT
    // rejection was attributed to the *next* test (the recurring settleVeto flake).
    await expect(
      (await import('../../sdd-runner/src/run-state.js')).loadRunState(dir, state.runId),
    ).resolves.toBeDefined()
  })

  it('settleVeto re-presents the next gate version after applying vetoes', async () => {
    const dir = makeDir()
    const state = await createRunState({ workDir: dir, repoRoot: dir, changeName: 'add-thing' })
    state.depth = 'S'
    state.round = 1
    // seed an events log (gate signals replay it) and an assumptions sidecar
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    fs.writeFileSync(path.join(state.runDir, 'events.ndjson'), '')
    fs.writeFileSync(
      path.join(state.runDir, 'sidecars', 'resolutions-1.json'),
      JSON.stringify({ resolutions: [], assumptions: [] }),
    )
    const deps = makeDeps(dir)
    await expect(
      settleVeto(makeCtx(state, deps), { ...CONVERGED }, [{ id: 'A1', redirect: 'narrow it' }]),
    ).resolves.toMatchObject({ outcome: 'veto', version: 2 })
  })
})
