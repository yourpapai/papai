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
import { main, parseSddArgs } from '../../sdd-runner/src/cli.js'
import type { CliHarness } from '../../sdd-runner/src/cli.js'
import { appendEvent } from '../../sdd-runner/src/events.js'

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
  mutate: (state: {
    gate: { mode: 'final' | 'early'; version: number } | null
    status: string
    stage?: 'intake' | 'draft' | 'review' | 'decompose' | 'atomicity' | 'gate'
    updatedAt?: string
    children?: Record<string, { status: 'pending' | 'running' | 'done' | 'failed' }>
  }) => void,
  spawns: { child: string; runId: string }[] = [],
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
    children: undefined as Record<string, { status: 'pending' | 'running' | 'done' | 'failed' }> | undefined,
  }
  mutate(state)
  mkdirSync(runDir, { recursive: true })
  writeFileSync(path.join(runDir, 'state.json'), JSON.stringify(state, null, 2))
  for (const spawn of spawns) {
    appendEvent(path.join(runDir, 'events.ndjson'), {
      altitude: 'L2',
      type: 'child_spawned',
      child: spawn.child,
      runId: spawn.runId,
    })
  }
  return runId
}

function selectCandidates(action: RouteAction): { readonly runId: string; readonly hint: string }[] {
  if (action.kind === 'select') return [...action.candidates]
  throw new Error(`expected a select action, got '${action.kind}'`)
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

  it('a calm-stopped run with a pending gate routes to the gate flow, not the resume dead-end', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'stopped-at-gate', (state) => {
      state.gate = { mode: 'final', version: 1 }
      state.status = 'stopped'
    })
    expect(await resolveTarget({ workDir, target: 'stopped-at-gate' })).toMatchObject({
      kind: 'gate',
      runId: 'stopped-at-gate',
    })
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

  it('on a terminal, a sole completed run opens the session screen instead of dumping its report', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'sole-done', (state) => {
      state.status = 'completed'
      // Newest-first is the listing contract; a distinct stamp makes the order
      // assertion deterministic instead of riding readdir order (creation
      // order on macOS, hash order on the CI runner's ext4).
      state.updatedAt = '2026-01-02T00:00:00.000Z'
    })
    seedRun(workDir, 'dead-husk', (state) => {
      state.status = 'aborted'
    })
    const action = await resolveTarget({ workDir, target: undefined, tty: true })
    expect(action.kind).toBe('select')
    expect(selectCandidates(action).map((c) => c.runId)).toEqual(['sole-done', 'dead-husk'])
    expect(await resolveTarget({ workDir, target: undefined, tty: false })).toMatchObject({
      kind: 'report',
      runId: 'sole-done',
    })
  })

  it('on a terminal, no target with no runs routes to the creation entry', async () => {
    const dir = makeDir()
    const action = await resolveTarget({ workDir: path.join(dir, '.sdd'), target: undefined, tty: true })
    expect(action).toEqual({ kind: 'create' })
  })

  it('off-terminal, a sole interrupted run with no pending gate resumes it', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'sole-halt', (state) => {
      state.status = 'stopped'
    })
    expect(await resolveTarget({ workDir, target: undefined })).toEqual({ kind: 'resume', runId: 'sole-halt' })
  })

  it('on a terminal, a sole interrupted run with no pending gate resumes it too', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'tty-halt', (state) => {
      state.status = 'stopped'
    })
    expect(await resolveTarget({ workDir, target: undefined, tty: true })).toEqual({
      kind: 'resume',
      runId: 'tty-halt',
    })
  })

  it('on a terminal, ambiguous no-target opens the session screen with every candidate', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'multi-1', (state) => {
      state.gate = { mode: 'final', version: 1 }
    })
    seedRun(workDir, 'multi-2', (state) => {
      state.gate = { mode: 'final', version: 1 }
    })
    seedRun(workDir, 'done-1', (state) => {
      state.status = 'completed'
      state.stage = 'gate'
    })
    const action = await resolveTarget({ workDir, target: undefined, tty: true })
    const ids = selectCandidates(action)
      .map((candidate) => candidate.runId)
      .sort()
    expect(ids).toEqual(['done-1', 'multi-1', 'multi-2'])
  })

  it('aborted-only runs are selectable on a terminal instead of failing as unroutable', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'dead-1', (state) => {
      state.status = 'aborted'
    })
    const action = await resolveTarget({ workDir, target: undefined, tty: true })
    expect(action.kind).toBe('select')
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

describe('sdd <parent-id> tree-aware routing (D3)', () => {
  it("a gate-null parent with a gate-pending child routes to the child's gate, not a blind resume", async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'child-run-1', (state) => {
      state.gate = { mode: 'early', version: 2 }
    })
    seedRun(
      workDir,
      'parent-run',
      (state) => {
        state.status = 'stopped'
        state.children = { 'auth-db': { status: 'running' } }
      },
      [{ child: 'auth-db', runId: 'child-run-1' }],
    )
    expect(await resolveTarget({ workDir, target: 'parent-run' })).toEqual({ kind: 'gate', runId: 'child-run-1' })
  })

  it('a running parent descends the same way — the child gate wins over the resume branch', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'child-run-1', (state) => {
      state.gate = { mode: 'early', version: 1 }
    })
    seedRun(
      workDir,
      'parent-run',
      (state) => {
        state.children = { 'auth-db': { status: 'running' } }
      },
      [{ child: 'auth-db', runId: 'child-run-1' }],
    )
    expect(await resolveTarget({ workDir, target: 'parent-run' })).toEqual({ kind: 'gate', runId: 'child-run-1' })
  })

  it('a parent whose in-flight child is mid-stage (no pending gate) still routes to the plain resume', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'child-run-1', (state) => {
      state.gate = null
    })
    seedRun(
      workDir,
      'parent-run',
      (state) => {
        state.children = { 'auth-db': { status: 'running' } }
      },
      [{ child: 'auth-db', runId: 'child-run-1' }],
    )
    expect(await resolveTarget({ workDir, target: 'parent-run' })).toEqual({ kind: 'resume', runId: 'parent-run' })
  })

  it('non-parent routing stays unchanged — a stopped single run routes to resume', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'single-halt', (state) => {
      state.status = 'stopped'
    })
    expect(await resolveTarget({ workDir, target: 'single-halt' })).toEqual({ kind: 'resume', runId: 'single-halt' })
  })

  it('tree-member prefix ambiguity keeps failing loudly listing every candidate', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'tree-run-sub', (state) => {
      state.gate = { mode: 'final', version: 1 }
    })
    seedRun(
      workDir,
      'tree-run',
      (state) => {
        state.children = { 'auth-db': { status: 'running' } }
      },
      [{ child: 'auth-db', runId: 'tree-run-sub' }],
    )
    const listing = await failureMessageOf(resolveTarget({ workDir, target: 'tree-ru' }))
    expect(listing).toMatch(/ambiguous/u)
    expect(listing).toContain('tree-run')
    expect(listing).toContain('tree-run-sub')
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

describe('--plan routing override (sdd-oversize-estimator-signals 4.x)', () => {
  it('parses --plan and keeps --depth parsing unchanged', () => {
    expect(parseSddArgs(['task.md', '--plan'])).toMatchObject({ target: 'task.md', plan: true })
    expect(parseSddArgs(['task.md', '--depth', 'S'])).toMatchObject({ target: 'task.md', depth: 'S' })
    expect(parseSddArgs(['task.md'])).toMatchObject({ target: 'task.md' })
  })

  it('--plan together with --depth fails loudly naming the conflict in either order', () => {
    expect(() => parseSddArgs(['task.md', '--plan', '--depth', 'S'])).toThrow(/--plan.*--depth|--depth.*--plan/u)
    expect(() => parseSddArgs(['task.md', '--depth', 'S', '--plan'])).toThrow(/--plan.*--depth|--depth.*--plan/u)
  })

  it('a task-file start with --plan threads forcePlan to runStart; --depth alone does not', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    const started: string[] = []
    const harness: CliHarness = {
      workDir,
      runStart: (options) => {
        started.push(`plan:${options.forcePlan === true}`)
        return Promise.resolve({ runId: 'run-1', halted: 'gate', gateMdPath: '/x/gate-1.md', version: 1 })
      },
      runResume: () => Promise.reject(new Error('unreachable')),
      runGateResume: () => Promise.reject(new Error('unreachable')),
      runContinue: () => Promise.reject(new Error('unreachable')),
      buildReport: () => Promise.reject(new Error('unreachable')),
      requestCalmStop: () => Promise.reject(new Error('unreachable')),
      runGateReopen: () => Promise.reject(new Error('unreachable')),
      runAnalysis: () => Promise.reject(new Error('unreachable')),
      stdout: () => undefined,
    }
    const startTask = path.join(dir, 'task.md')
    writeFileSync(startTask, '# Plan me\n')
    await main([startTask, '--plan'], harness)
    await main([startTask], harness)
    expect(started).toEqual(['plan:true', 'plan:false'])
  })
})

describe('analyze verb routing (4.2)', () => {
  function analyzeHarness(workDir: string, into: { calls: string[][] }): CliHarness {
    return {
      workDir,
      runStart: () => Promise.reject(new Error('analyze must not start runs')),
      runResume: () => Promise.reject(new Error('analyze must not resume runs')),
      runGateResume: () => Promise.reject(new Error('analyze must not touch gates')),
      runContinue: () => Promise.reject(new Error('analyze must not continue runs')),
      buildReport: () => Promise.reject(new Error('analyze must not build run reports')),
      requestCalmStop: () => Promise.reject(new Error('analyze must not stop runs')),
      runGateReopen: () => Promise.reject(new Error('analyze must not reopen gates')),
      runAnalysis: (workdirs, json) => {
        into.calls.push([workdirs.join(','), `${json}`])
        return Promise.resolve()
      },
      stdout: () => undefined,
    }
  }

  it('parseSddArgs routes analyze with workdir positionals and --json', () => {
    expect(parseSddArgs(['analyze'])).toMatchObject({ verb: 'analyze', analyze: { workdirs: [], json: false } })
    expect(parseSddArgs(['analyze', '/w1', '/w2', '--json'])).toMatchObject({
      verb: 'analyze',
      analyze: { workdirs: ['/w1', '/w2'], json: true },
    })
    expect(parseSddArgs(['analyze', '--config', '/cfg.json'])).toMatchObject({
      verb: 'analyze',
      configPath: '/cfg.json',
    })
  })

  it('analyze flags are only --json and --config', () => {
    expect(() => parseSddArgs(['analyze', '--depth', 'S'])).toThrow(/unknown flag: --depth/u)
    expect(() => parseSddArgs(['analyze', '--pr'])).toThrow(/unknown flag: --pr/u)
  })

  it('main routes analyze to the analysis surface with the config default workdir', async () => {
    const calls: string[][] = []
    await main(['analyze'], analyzeHarness('/default/.sdd-runner', { calls }))
    expect(calls).toEqual([['', 'false']])
  })

  it('analyze passes explicit workdirs and --json, and never touches runs or pending gates', async () => {
    const dir = makeDir()
    const workDir = path.join(dir, '.sdd')
    seedRun(workDir, 'gate-run', (state) => {
      state.gate = { mode: 'final', version: 1 }
    })
    const calls: string[][] = []
    await main(['analyze', '/other/.sdd-runner', workDir, '--json'], analyzeHarness(workDir, { calls }))
    expect(calls).toEqual([['/other/.sdd-runner,' + workDir, 'true']])
  })
})
