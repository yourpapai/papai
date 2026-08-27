// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runContinue } from '../../sdd-runner/src/continue.js'
import { appendEvent } from '../../sdd-runner/src/events.js'
import type { OrchestratorDeps } from '../../sdd-runner/src/gate-digest.js'
import { createOpenSpecDriver } from '../../sdd-runner/src/openspec-driver.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'
import type { RunState } from '../../sdd-runner/src/run-state.js'

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

  it("several gate-pending runs print the candidate list with each run's mode beside its version and route nowhere", async () => {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const first = await createRunState({ workDir, repoRoot, changeName: 'add-thing' })
    await saveRunState({ ...first, gate: { mode: 'early', version: 1 } }, new Date('2026-01-01T00:00:01.000Z'))
    const second = await createRunState({ workDir, repoRoot, changeName: 'other-thing' })
    await saveRunState({ ...second, gate: { mode: 'final', version: 3 } }, new Date('2026-01-01T00:00:02.000Z'))
    const lines: string[] = []
    const deps = { ...makeDeps(repoRoot, workDir), stdout: (line: string): void => void lines.push(line) }
    expect(await runContinue(deps, null)).toEqual({ runId: null, routed: 'list' })
    expect(lines).toEqual([
      'several runs await gate decisions:',
      `  sdd ${second.runId}  (other-thing, gate final v3)`,
      `  sdd ${first.runId}  (add-thing, gate early v1)`,
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

/** An approved plan parent whose `db-schema` child is in flight as `child-run-1`. */
async function seedPlanParent(
  repoRoot: string,
  opts: { readonly childRunning?: boolean; readonly allDone?: boolean; readonly childGateFile?: string } = {},
): Promise<{ workDir: string; parent: RunState }> {
  const workDir = path.join(repoRoot, '.sdd-runner')
  const parent = await createRunState({ workDir, repoRoot, changeName: 'composite', runId: 'parent-run' })
  const log = path.join(parent.runDir, 'events.ndjson')
  appendEvent(log, { altitude: 'L2', type: 'stage_enter', stage: 'intake' })
  parent.plan = { childIds: ['db-schema'], digest: 'd'.repeat(16) }
  parent.children = { 'db-schema': { status: opts.allDone === true ? 'done' : 'running' } }
  appendEvent(log, { altitude: 'L2', type: 'plan', childCount: 1, digest: 'd'.repeat(16) })
  appendEvent(log, { altitude: 'L2', type: 'gate', action: 'presented', mode: 'plan', version: 1 })
  appendEvent(log, { altitude: 'L2', type: 'gate', action: 'answered', mode: 'plan', version: 1 })
  fs.mkdirSync(path.join(parent.runDir, 'sidecars'), { recursive: true })
  fs.writeFileSync(
    path.join(parent.runDir, 'sidecars', 'plan.json'),
    JSON.stringify({ children: [{ id: 'db-schema', instruction: 'Rename the schema columns.', deps: [] }] }),
  )
  if (opts.childRunning !== false) {
    appendEvent(log, { altitude: 'L2', type: 'child_spawned', child: 'db-schema', runId: 'child-run-1' })
    const child = await createRunState({ workDir, repoRoot, changeName: 'db-schema', runId: 'child-run-1' })
    if (opts.childGateFile !== undefined) {
      child.gate = { mode: 'early', version: 1 }
      fs.writeFileSync(path.join(child.runDir, 'gate-1.md'), opts.childGateFile)
    }
    await saveRunState(child)
  }
  await saveRunState(parent)
  return { workDir, parent }
}

describe('runContinue tree-aware descent (D2)', () => {
  it("routes a plan parent with a gate-pending child into that child's gate flow, printing the child's sdd line", async () => {
    const repoRoot = makeDir()
    const { workDir } = await seedPlanParent(repoRoot, { childGateFile: 'ABORT\n' })
    const lines: string[] = []
    const deps = { ...makeDeps(repoRoot, workDir), stdout: (line: string): void => void lines.push(line) }

    const result = await runContinue(deps, 'parent-run')

    expect(result).toEqual({ runId: 'child-run-1', routed: 'gate' })
    expect(lines[0]).toBe('run parent-run continues in child run child-run-1 — its pending gate is the next action')
    expect(lines[1]).toBe('sdd child-run-1')
    const child = await loadRunState(workDir, 'child-run-1')
    expect(child.status).toBe('aborted')
    expect(child.gate).toBe(null)
  })

  it('with no gate-pending descendant, resumes the parent through the unchanged runChildren skip-forward', async () => {
    const repoRoot = makeDir()
    const { workDir } = await seedPlanParent(repoRoot, { allDone: true, childRunning: false })
    const deps = makeDeps(repoRoot, workDir)

    const result = await runContinue(deps, 'parent-run')

    expect(result).toEqual({ runId: 'parent-run', routed: 'resume' })
    const persisted = await loadRunState(workDir, 'parent-run')
    expect(persisted.status).toBe('completed')
  })

  it('keeps non-parent routing unchanged — a running single run still falls through to the plain resume decision', async () => {
    const repoRoot = makeDir()
    const workDir = path.join(repoRoot, '.sdd-runner')
    const single = await createRunState({ workDir, repoRoot, changeName: 'plain-run' })
    await saveRunState(single)
    fs.writeFileSync(path.join(single.runDir, 'events.ndjson'), '')

    await expect(runContinue(makeDeps(repoRoot, workDir), single.runId)).rejects.toThrow(/not supported yet/u)
  })
})
