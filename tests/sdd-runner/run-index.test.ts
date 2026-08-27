// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import { descendantGateOf, listPendingGates, readAllRunStates, resolveRunId } from '../../sdd-runner/src/run-index.js'
import { createRunState, loadRunState, saveRunState } from '../../sdd-runner/src/run-state.js'

const tmpDirs: string[] = []

function makeWorkDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-runindex-'))
  tmpDirs.push(dir)
  return dir
}

async function errorOf(promise: Promise<unknown>): Promise<Error> {
  const failure = await promise.catch((error: unknown) => error)
  if (!(failure instanceof Error)) throw new Error('expected the promise to reject with an Error')
  return failure
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

async function seedRun(
  workDir: string,
  runId: string,
  opts: {
    gate?: { mode: 'early' | 'final' | 'plan'; version: number } | null
    changeName?: string
    updatedAt?: string
    children?: Record<string, { status: 'pending' | 'running' | 'done' | 'failed' }>
    spawns?: { child: string; runId?: string }[]
  },
): Promise<void> {
  const created = await createRunState({
    workDir,
    repoRoot: '/repo',
    changeName: opts.changeName ?? 'add-thing',
    runId,
  })
  const gate = opts.gate === undefined ? { mode: 'early' as const, version: 1 } : opts.gate
  const stamp = opts.updatedAt ?? created.updatedAt
  await saveRunState(
    { ...created, ...(opts.children === undefined ? {} : { children: opts.children }), gate, updatedAt: stamp },
    new Date(stamp),
  )
  const log = path.join(created.runDir, 'events.ndjson')
  for (const spawn of opts.spawns ?? []) {
    appendEvent(log, {
      altitude: 'L2',
      type: 'child_spawned',
      child: spawn.child,
      ...(spawn.runId === undefined ? {} : { runId: spawn.runId }),
    })
  }
}

describe('readAllRunStates', () => {
  it('returns every readable run, most recently updated first', async () => {
    const workDir = makeWorkDir()
    const older = await createRunState({ workDir, repoRoot: '/repo', changeName: 'older-change' })
    await saveRunState({ ...older, status: 'stopped' }, new Date('2026-01-01T00:00:01Z'))
    const newer = await createRunState({ workDir, repoRoot: '/repo', changeName: 'newer-change' })
    await saveRunState(
      { ...newer, stage: 'gate', gate: { mode: 'early', version: 1 } },
      new Date('2026-01-01T00:00:02Z'),
    )

    const states = await readAllRunStates(workDir)

    expect(states.map((s) => s.runId)).toEqual([newer.runId, older.runId])
    expect(states[0]).toMatchObject({ runId: newer.runId, status: 'running', gate: { mode: 'early', version: 1 } })
    expect(states[1]).toMatchObject({ runId: older.runId, status: 'stopped', gate: null })
  })

  it('skips runs whose state.json is missing or malformed', async () => {
    const workDir = makeWorkDir()
    const good = await createRunState({ workDir, repoRoot: '/repo', changeName: 'good-change' })
    await saveRunState(good)
    fs.mkdirSync(path.join(workDir, 'runs', 'broken-run'), { recursive: true })
    fs.writeFileSync(path.join(workDir, 'runs', 'broken-run', 'state.json'), '{ not json')
    fs.mkdirSync(path.join(workDir, 'runs', 'empty-run'), { recursive: true })

    const states = await readAllRunStates(workDir)

    expect(states.map((s) => s.runId)).toEqual([good.runId])
  })

  it('returns an empty list when the workDir has no runs directory', async () => {
    expect(await readAllRunStates(makeWorkDir())).toEqual([])
  })
})

describe('listPendingGates', () => {
  it('scans runs/*/state.json, keeps only gate-pending runs, and returns change name, gate version, and wait time sorted by recency', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'run-old', {
      gate: { mode: 'early', version: 1 },
      changeName: 'old-change',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    await seedRun(workDir, 'run-new', {
      gate: { mode: 'final', version: 3 },
      changeName: 'new-change',
      updatedAt: '2026-02-01T00:00:00.000Z',
    })
    await seedRun(workDir, 'run-done', { gate: null, updatedAt: '2026-03-01T00:00:00.000Z' })

    const pending = await listPendingGates(workDir)
    expect(pending.map((entry) => entry.runId)).toEqual(['run-new', 'run-old'])
    expect(pending[0]).toMatchObject({ runId: 'run-new', changeName: 'new-change', gateVersion: 3 })
    expect(pending[1]).toMatchObject({ runId: 'run-old', changeName: 'old-change', gateVersion: 1 })
  })

  it('returns an empty list when no runs exist', async () => {
    expect(await listPendingGates(makeWorkDir())).toEqual([])
  })
})

describe('resolveRunId', () => {
  it('accepts an exact id', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, '2026-01-01T00-00-00-000Z-abcd1234', { gate: { mode: 'early', version: 1 } })
    expect(await resolveRunId(workDir, '2026-01-01T00-00-00-000Z-abcd1234')).toBe('2026-01-01T00-00-00-000Z-abcd1234')
  })

  it('accepts an unambiguous prefix among known runs (gate-pending or not)', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, '2026-01-01T00-00-00-000Z-abcd1234', { gate: { mode: 'early', version: 1 } })
    await seedRun(workDir, '2026-02-01T00-00-00-000Z-ffff0000', { gate: null })
    expect(await resolveRunId(workDir, '2026-01-01T00')).toBe('2026-01-01T00-00-00-000Z-abcd1234')
    expect(await resolveRunId(workDir, '2026-02')).toBe('2026-02-01T00-00-00-000Z-ffff0000')
  })

  it('accepts an exact id even when it is also a prefix of another run id', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'run-1', { gate: { mode: 'early', version: 1 } })
    await seedRun(workDir, 'run-1-extended', { gate: { mode: 'final', version: 1 } })
    expect(await resolveRunId(workDir, 'run-1')).toBe('run-1')
  })

  it('fails on an unknown id naming the input', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, '2026-01-01T00-00-00-000Z-abcd1234', { gate: { mode: 'early', version: 1 } })
    const resolution = resolveRunId(workDir, 'nope')
    await expect(resolution).rejects.toThrow(/unknown run id/iu)
    await expect(resolution).rejects.toThrow(/nope/u)
  })

  it('fails on an ambiguous prefix listing every matching candidate id', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, '2026-01-01T00-00-00-000Z-abcd1234', { gate: { mode: 'early', version: 1 } })
    await seedRun(workDir, '2026-01-01T00-00-00-000Z-ffff0000', { gate: { mode: 'final', version: 1 } })
    const message = (await errorOf(resolveRunId(workDir, '2026-01-01'))).message
    expect(message).toMatch(/ambiguous/iu)
    expect(message).toContain('abcd1234')
    expect(message).toContain('ffff0000')
    // one candidate per line, order-free: both candidate lines start with the shared timestamp prefix
    expect(message.match(/\n {2}2026-01-01/gu)).toHaveLength(2)
  })

  it('names the runs directory when no runs exist at all', async () => {
    const workDir = makeWorkDir()
    const message = (await errorOf(resolveRunId(workDir, 'anything'))).message
    expect(message).toContain(path.join(workDir, 'runs'))
    expect(message).toContain('anything')
  })
})

describe('listPendingGates robustness', () => {
  it('skips a run whose state.json is corrupt rather than failing the listing', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'run-broken', { gate: { mode: 'early', version: 1 } })
    fs.writeFileSync(path.join(workDir, 'runs', 'run-broken', 'state.json'), '{"runId": 42}')
    await seedRun(workDir, 'run-live', { gate: { mode: 'final', version: 1 } })
    const pending = await listPendingGates(workDir)
    expect(pending.map((entry) => entry.runId)).toEqual(['run-live'])
  })
})

describe('descendantGateOf (D1 tree discovery)', () => {
  it('resolves a running child from the parent log spawn lines and returns its gate-pending runId', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'parent-run', {
      gate: null,
      children: { 'auth-db': { status: 'running' } },
      spawns: [{ child: 'auth-db', runId: 'child-run-1' }],
    })
    await seedRun(workDir, 'child-run-1', { gate: { mode: 'early', version: 2 }, changeName: 'auth-db' })

    expect(await descendantGateOf(workDir, await loadRunState(workDir, 'parent-run'))).toBe('child-run-1')
  })

  it('recurses into grandchildren and returns the deepest gate-pending descendant', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'parent-run', {
      gate: null,
      children: { 'auth-db': { status: 'running' } },
      spawns: [{ child: 'auth-db', runId: 'child-run-1' }],
    })
    await seedRun(workDir, 'child-run-1', {
      gate: { mode: 'early', version: 1 },
      children: { 'api-layer': { status: 'running' } },
      spawns: [{ child: 'api-layer', runId: 'grand-run-1' }],
    })
    await seedRun(workDir, 'grand-run-1', { gate: { mode: 'plan', version: 1 } })

    expect(await descendantGateOf(workDir, await loadRunState(workDir, 'parent-run'))).toBe('grand-run-1')
  })

  it('counts an unloadable child state as no pending gate and keeps scanning later children', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'parent-run', {
      gate: null,
      children: { ghost: { status: 'running' }, 'auth-db': { status: 'running' } },
      spawns: [
        { child: 'ghost', runId: 'ghost-run' },
        { child: 'auth-db', runId: 'child-run-1' },
      ],
    })
    await seedRun(workDir, 'child-run-1', { gate: { mode: 'final', version: 1 } })

    expect(await descendantGateOf(workDir, await loadRunState(workDir, 'parent-run'))).toBe('child-run-1')
  })

  it('returns null for a non-parent state', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'plain-run', { gate: null })

    expect(await descendantGateOf(workDir, await loadRunState(workDir, 'plain-run'))).toBe(null)
  })

  it('returns null when no descendant is gate-pending', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'parent-run', {
      gate: null,
      children: { done: { status: 'done' }, queued: { status: 'pending' }, 'auth-db': { status: 'running' } },
      spawns: [{ child: 'auth-db', runId: 'child-run-1' }],
    })
    await seedRun(workDir, 'child-run-1', { gate: null })

    expect(await descendantGateOf(workDir, await loadRunState(workDir, 'parent-run'))).toBe(null)
  })

  it('skips a running child whose log carries no spawn runId', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'parent-run', {
      gate: null,
      children: { 'auth-db': { status: 'running' } },
      spawns: [{ child: 'auth-db' }],
    })

    expect(await descendantGateOf(workDir, await loadRunState(workDir, 'parent-run'))).toBe(null)
  })

  it('guards cyclic malformed state — a self-spawning child still yields its own gate', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'parent-run', {
      gate: null,
      children: { 'auth-db': { status: 'running' } },
      spawns: [{ child: 'auth-db', runId: 'child-run-1' }],
    })
    await seedRun(workDir, 'child-run-1', {
      gate: { mode: 'early', version: 1 },
      children: { loop: { status: 'running' } },
      spawns: [{ child: 'loop', runId: 'child-run-1' }],
    })

    expect(await descendantGateOf(workDir, await loadRunState(workDir, 'parent-run'))).toBe('child-run-1')
  })

  it('guards cyclic malformed state — a spawn pointing back at the parent is never descended into', async () => {
    const workDir = makeWorkDir()
    await seedRun(workDir, 'parent-run', {
      gate: { mode: 'plan', version: 1 },
      children: { 'auth-db': { status: 'running' } },
      spawns: [{ child: 'auth-db', runId: 'child-run-1' }],
    })
    await seedRun(workDir, 'child-run-1', {
      gate: null,
      children: { loop: { status: 'running' } },
      spawns: [{ child: 'loop', runId: 'parent-run' }],
    })

    expect(await descendantGateOf(workDir, await loadRunState(workDir, 'parent-run'))).toBe(null)
  })
})
