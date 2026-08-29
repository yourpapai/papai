// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { appendEvent } from '../../sdd-runner/src/events.js'
import { createRunState, saveRunState } from '../../sdd-runner/src/run-state.js'

/**
 * `buildRunReport` is module-private in sdd-runner/src/index.ts with no DI
 * seam, so the module boundary is the narrowest observable point: this suite
 * counts `buildResolveCost` calls, then imports `runEntry` only after the
 * mock is installed. It cannot live in index.test.ts — that file imports
 * index.js statically, and a mock installed after that load never reaches
 * its already-bound import.
 */
describe('report pricing laziness', () => {
  const tmpDirs: string[] = []
  let builds = 0
  let writes: string[] = []
  let writeSpy: { mockRestore(): void }
  let exitSpy: { mockRestore(): void }
  const saved: { argv: string[]; config: string | undefined } = { argv: [], config: undefined }

  function makeDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-lazy-pricing-'))
    tmpDirs.push(dir)
    return dir
  }

  beforeEach(async () => {
    writes = []
    builds = 0
    const actual = await import('../../sdd-runner/src/usage-aggregate.js')
    await mock.module('../../sdd-runner/src/usage-aggregate.js', () => ({
      ...actual,
      buildResolveCost: (): Promise<
        () => { source: 'models.dev'; input: number; output: number; cache_read: number; cache_write: number } | null
      > => {
        builds += 1
        return Promise.resolve(() => ({ source: 'models.dev', input: 1, output: 2, cache_read: 0, cache_write: 0 }))
      },
    }))
    writeSpy = spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writes.push(Buffer.from(chunk).toString())
      return true
    })
    exitSpy = spyOn(process, 'exit').mockImplementation((code?: number): never => {
      throw new Error(`intercepted process.exit(${code ?? 0})`)
    })
    saved.argv = process.argv
    saved.config = process.env['SDD_RUNNER_CONFIG']
  })

  afterEach(() => {
    while (tmpDirs.length > 0) {
      const dir = tmpDirs.pop()
      if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
    }
    process.argv = saved.argv
    if (saved.config === undefined) delete process.env['SDD_RUNNER_CONFIG']
    else process.env['SDD_RUNNER_CONFIG'] = saved.config
    writeSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it('a single-run report builds the pricing resolver once (the harness renderer build), never a second time on the report path', async () => {
    const tmp = makeDir()
    const workDir = path.join(tmp, '.sdd-runner')
    fs.writeFileSync(
      path.join(tmp, 'config.json'),
      JSON.stringify({ repoRoot: tmp, workDir, model: 'test-model', budget: 5 }),
    )
    execFileSync('git', ['init', '-b', 'sdd-test-branch', tmp], { stdio: 'ignore' })
    const state = await createRunState({ workDir, repoRoot: tmp, changeName: 'add-thing' })
    await saveRunState({ ...state, status: 'completed' })
    const logPath = path.join(workDir, 'runs', state.runId, 'events.ndjson')
    fs.writeFileSync(logPath, '')
    // Unpriced agent usage: the report path must pass a callable resolver (or
    // none at all) into treeSpend — a truthy non-function crashes repriceEvents,
    // and a plan section must never appear on a single-run report.
    appendEvent(logPath, { altitude: 'L1', type: 'spawned', agent: 'draft', role: 'draft', model: 'test-model' })
    appendEvent(logPath, {
      altitude: 'L1',
      type: 'done',
      agent: 'draft',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd: 0,
        wallMs: 5,
      },
    })

    const { runEntry } = await import('../../sdd-runner/src/index.js')
    process.env['SDD_RUNNER_CONFIG'] = path.join(tmp, 'config.json')
    process.argv = ['bun', 'sdd', state.runId]
    await expect(runEntry()).rejects.toThrow(/intercepted process\.exit\(0\)/u)
    const out = writes.join('')
    expect(out).toContain(`run: ${state.runId}`)
    expect(out).not.toContain('### Children')
    // Exactly one build — the harness renderer's (index.ts buildHarness).
    // A second means the report path went eager again and every single-run
    // report pays a models.dev loadDb it never consumes.
    expect(builds).toBe(1)
  })

  it('a plan-parent report prices its subtree through the resolver and renders the children section, not tasks', async () => {
    const tmp = makeDir()
    const workDir = path.join(tmp, '.sdd-runner')
    fs.writeFileSync(
      path.join(tmp, 'config.json'),
      JSON.stringify({ repoRoot: tmp, workDir, model: 'test-model', budget: 5 }),
    )
    execFileSync('git', ['init', '-b', 'sdd-test-branch', tmp], { stdio: 'ignore' })
    const parent = await createRunState({ workDir, repoRoot: tmp, changeName: 'composite' })
    const child = await createRunState({ workDir, repoRoot: tmp, changeName: 'db-schema', runId: 'child-run-1' })
    child.status = 'stopped'
    await saveRunState(child)
    const childLog = path.join(workDir, 'runs', 'child-run-1', 'events.ndjson')
    fs.writeFileSync(childLog, '')
    appendEvent(childLog, { altitude: 'L1', type: 'spawned', agent: 'draft', role: 'draft', model: 'test-model' })
    appendEvent(childLog, {
      altitude: 'L1',
      type: 'done',
      agent: 'draft',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd: 0,
        wallMs: 5,
      },
    })
    parent.plan = { childIds: ['db-schema'], digest: 'd'.repeat(16) }
    parent.children = { 'db-schema': { status: 'running' } }
    await saveRunState({ ...parent, status: 'completed' })
    const parentLog = path.join(workDir, 'runs', parent.runId, 'events.ndjson')
    fs.writeFileSync(parentLog, '')
    appendEvent(parentLog, { altitude: 'L2', type: 'stage_enter', stage: 'intake' })
    appendEvent(parentLog, { altitude: 'L2', type: 'plan', childCount: 1, digest: 'd'.repeat(16) })
    appendEvent(parentLog, { altitude: 'L2', type: 'child_spawned', child: 'db-schema', runId: 'child-run-1' })
    appendEvent(parentLog, { altitude: 'L1', type: 'spawned', agent: 'review', role: 'review', model: 'test-model' })
    appendEvent(parentLog, {
      altitude: 'L1',
      type: 'done',
      agent: 'review',
      usage: {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        reasoningTokens: 0,
        cachedReadTokens: 0,
        cachedWriteTokens: 0,
        costUsd: 0,
        wallMs: 5,
      },
    })

    const { runEntry } = await import('../../sdd-runner/src/index.js')
    process.env['SDD_RUNNER_CONFIG'] = path.join(tmp, 'config.json')
    process.argv = ['bun', 'sdd', parent.runId]
    await expect(runEntry()).rejects.toThrow(/intercepted process\.exit\(0\)/u)
    const out = writes.join('')
    expect(out).toContain('### Children')
    expect(out).not.toContain('### Tasks')
    // Live child state ('stopped') wins over the parent's stale record ('running'),
    // and the child's own priced usage rides the row.
    expect(out).toContain('- db-schema · run child-run-1 · stopped · $3.00')
    expect(out).toContain('subtree total: $3.00')
  })
})
