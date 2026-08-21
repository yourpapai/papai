// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { resolveTarget } from '../../sdd-runner/src/cli-routing.js'
import type { RouteAction } from '../../sdd-runner/src/cli-routing.js'

const dirs: string[] = []
function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sdd-routing-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

function seedRun(
  workDir: string,
  runId: string,
  mutate: (state: { gate: { mode: 'final' | 'early'; version: number } | null; status: string }) => void,
): string {
  const runDir = path.join(workDir, 'runs', runId)

  const now = '2026-01-01T00:00:00.000Z'
  const state = {
    runId,
    repoRoot: workDir,
    workDir,
    changeName: 'thing',
    stage: 'review' as const,
    depth: 'S' as const,
    round: 1,
    gate: null as { mode: 'final' | 'early'; version: number } | null,
    status: 'running',
    createdAt: now,
    updatedAt: now,
    autoExtendsUsed: 0,
    gateDeadlineAt: null,
    gateDeadlineReArmed: false,
  }
  mutate(state)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(state, null, 2))
  return runId
}

function failureMessageOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    (): string | null => null,
    (error: unknown): string => (error instanceof Error ? error.message : String(error)),
  )
}

function taskFile(dir: string): string {
  const p = path.join(dir, 'task.md')
  writeFileSync(p, '# Add thing\n')
  return p
}

describe('sdd [<target>] routing table (6.1/6.2)', () => {
  it('an existing task-file path starts a new run', async () => {
    const dir = makeDir()
    const task = taskFile(dir)
    const action = await resolveTarget({ workDir: path.join(dir, '.sdd'), target: task })
    expect(action).toEqual({ kind: 'start', taskFile: task } satisfies RouteAction)
  })

  it('an exact run id routes by its state', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'run-gate', (state) => {
      state.gate = { mode: 'final', version: 1 }
    })
    seedRun(workDir, 'run-done', (state) => {
      state.status = 'completed'
    })
    seedRun(workDir, 'run-halt', (state) => {
      state.status = 'stopped'
    })
    expect(await resolveTarget({ workDir, target: 'run-gate' })).toMatchObject({ kind: 'gate' })
    expect(await resolveTarget({ workDir, target: 'run-done' })).toMatchObject({ kind: 'report', runId: 'run-done' })
    expect(await resolveTarget({ workDir, target: 'run-halt' })).toMatchObject({ kind: 'resume', runId: 'run-halt' })
  })

  it('an unambiguous prefix routes; an ambiguous prefix lists candidates without side effects', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'abc-1', (state) => {
      state.status = 'completed'
    })
    seedRun(workDir, 'abc-2', (state) => {
      state.status = 'completed'
    })
    expect(await resolveTarget({ workDir, target: 'abc-1' })).toMatchObject({ kind: 'report', runId: 'abc-1' })
    await expect(resolveTarget({ workDir, target: 'abc' })).rejects.toThrow(/abc-1/u)
    await expect(resolveTarget({ workDir, target: 'abc' })).rejects.toThrow(/abc-2/u)
  })

  it('no target routes to the sole gate-pending run, then interrupted, then completed', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'pending-gate', (state) => {
      state.gate = { mode: 'final', version: 1 }
    })
    expect(await resolveTarget({ workDir, target: undefined })).toMatchObject({ kind: 'gate', runId: 'pending-gate' })
  })

  it('no target with several routable runs lists each candidate with its command', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'multi-1', (state) => {
      state.gate = { mode: 'final', version: 1 }
    })
    seedRun(workDir, 'multi-2', (state) => {
      state.gate = { mode: 'final', version: 1 }
    })
    const listing = await failureMessageOf(resolveTarget({ workDir, target: undefined }))
    expect(listing).toMatch(/multi-1/u)
    expect(listing).toMatch(/multi-2/u)
    expect(listing).toMatch(/sdd multi-1/u)
  })

  it('no target with no runs at all requires a task file', async () => {
    const dir = makeDir()
    await expect(resolveTarget({ workDir: path.join(dir, '.sdd'), target: undefined })).rejects.toThrow(
      /task file|target/u,
    )
  })

  it('legacy subcommand shapes fail naming the replacement routing usage', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    for (const legacy of ['start', 'resume', 'gate', 'continue', 'report', 'audit', 'watch']) {
      await expect(resolveTarget({ workDir, target: legacy })).rejects.toThrow(
        new RegExp(`sdd <run-id>|sdd <task-file>|removed|replace`, 'u'),
      )
    }
  })

  it('an unknown non-file target resolves as a run id and fails loudly', async () => {
    const dir = makeDir()
    await expect(resolveTarget({ workDir: path.join(dir, '.sdd'), target: 'nope-42' })).rejects.toThrow(/nope-42/u)
  })
})

describe('sdd stop routing (6.2)', () => {
  it('stop with no id targets the sole active run; several active runs fail listing them', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'active-1', (state) => {
      state.status = 'running'
    })
    expect(await resolveTarget({ workDir, target: undefined, verb: 'stop' })).toMatchObject({
      kind: 'stop',
      runId: 'active-1',
    })
    seedRun(workDir, 'active-2', (state) => {
      state.status = 'running'
    })
    const listing = await failureMessageOf(resolveTarget({ workDir, target: undefined, verb: 'stop' }))
    expect(listing).toMatch(/active-1/u)
    expect(listing).toMatch(/active-2/u)
  })

  it('stop with an explicit id resolves prefixes exactly like the routing verb', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'stop-me', (state) => {
      state.status = 'running'
    })
    expect(await resolveTarget({ workDir, target: 'stop-me', verb: 'stop' })).toMatchObject({
      kind: 'stop',
      runId: 'stop-me',
    })
  })
})
