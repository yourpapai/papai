// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps, StageContext } from '../../sdd-runner/src/gate-digest.js'
import { gatherGateSignals } from '../../sdd-runner/src/gate-signals.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { createRunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('gatherGateSignals', () => {
  it('assembles events, cost, assumptions, and trajectory from a real run dir', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-signals-'))
    tmpDirs.push(dir)
    const workDir = path.join(dir, '.sdd-runner')
    const state = await createRunState({ workDir, repoRoot: dir, changeName: 'thing' })
    fs.mkdirSync(path.join(state.runDir, 'sidecars'), { recursive: true })
    const logPath = path.join(state.runDir, 'events.ndjson')
    appendEvent(logPath, { altitude: 'L2', type: 'stage_enter', stage: 'review' })
    const deps: OrchestratorDeps = {
      config: { repoRoot: dir, workDir, model: 'm', budget: 5 },
      spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
      execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
      resolveCost: () => null,
      driver: createOpenSpecDriver({
        exec: () => Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0 }),
        cwd: dir,
      }),
    }
    const ctx: StageContext = {
      cwd: dir,
      changeDir: path.join(dir, 'openspec', 'changes', 'thing'),
      sidecarDir: path.join(state.runDir, 'sidecars'),
      emit: (event) => {
        appendEvent(logPath, event)
      },
    }
    const signals = await gatherGateSignals(deps, state, ctx, {
      outcome: 'converged',
      rounds: 1,
      openBlockers: [],
      openMaterial: [],
      openNitpicks: [],
    })
    expect(signals.events.length).toBeGreaterThan(0)
    expect(signals.assumptions).toEqual([])
    expect(signals.trajectory).toEqual([])
    expect(signals.costKnown).toBe(true)
  })
})
