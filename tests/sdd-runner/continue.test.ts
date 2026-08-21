// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runContinue } from '../../sdd-runner/src/continue.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { createRunState, saveRunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-cont-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

function makeDeps(repoRoot: string, workDir: string): OrchestratorDeps {
  return {
    config: {
      repoRoot,
      workDir,
      model: 'test-model',
      budget: 5,
    },
    spawn: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    execGit: () => Promise.resolve({ stdout: '', stderr: '' }),
    driver: createOpenSpecDriver({
      exec: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      cwd: repoRoot,
    }),
  }
}

describe('runContinue discovery errors', () => {
  it('fails loudly when no runs exist at all', async () => {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    await expect(runContinue(makeDeps(repoRoot, workDir), null)).rejects.toThrow(/no gate-pending runs/u)
  })

  it('with no id, a single gate-pending run routes to the gate flow', async () => {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const state = await createRunState({ workDir, repoRoot, changeName: 'add-thing' })
    await saveRunState({ ...state, gate: { mode: 'final', version: 1 } })
    const deps = makeDeps(repoRoot, workDir)
    await expect(runContinue(deps, null)).rejects.toThrow(/is not gate-pending|gate/u)
  })
})

describe('runContinue routing surfaces (mutation kills)', () => {
  it('a completed run prints the report pointer on stdout and routes to report without a stdout dep crash', async () => {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const state = await createRunState({ workDir, repoRoot, changeName: 'add-thing' })
    await saveRunState({ ...state, status: 'completed' })
    const lines: string[] = []
    const deps = { ...makeDeps(repoRoot, workDir), stdout: (line: string): void => void lines.push(line) }
    expect(await runContinue(deps, state.runId)).toEqual({ runId: state.runId, routed: 'report' })
    expect(lines).toEqual([`run ${state.runId} is completed — report via: sdd ${state.runId}`])
  })

  it('several gate-pending runs print the candidate list and route nowhere', async () => {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const first = await createRunState({ workDir, repoRoot, changeName: 'add-thing' })
    await saveRunState({ ...first, gate: { mode: 'final', version: 1 } }, new Date('2026-01-01T00:00:01.000Z'))
    const second = await createRunState({ workDir, repoRoot, changeName: 'other-thing' })
    await saveRunState({ ...second, gate: { mode: 'early', version: 3 } }, new Date('2026-01-01T00:00:02.000Z'))
    const lines: string[] = []
    const deps = { ...makeDeps(repoRoot, workDir), stdout: (line: string): void => void lines.push(line) }
    expect(await runContinue(deps, null)).toEqual({ runId: null, routed: 'list' })
    expect(lines).toEqual([
      'several runs await gate decisions:',
      `  sdd ${second.runId}  (other-thing, gate v3)`,
      `  sdd ${first.runId}  (add-thing, gate v1)`,
    ])
  })

  it('the candidate listing survives a deps without stdout', async () => {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    for (const name of ['add-thing', 'other-thing']) {
      const state = await createRunState({ workDir, repoRoot, changeName: name })
      await saveRunState({ ...state, gate: { mode: 'final', version: 2 } })
    }
    expect(await runContinue(makeDeps(repoRoot, workDir), null)).toEqual({ runId: null, routed: 'list' })
  })
})
