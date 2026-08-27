// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
    const actual = await import('../../sdd-runner/src/usage-aggregate.js')
    await mock.module('../../sdd-runner/src/usage-aggregate.js', () => ({
      ...actual,
      buildResolveCost: (): Promise<() => null> => {
        builds += 1
        return Promise.resolve(() => null)
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
    fs.writeFileSync(path.join(workDir, 'runs', state.runId, 'events.ndjson'), '')

    const { runEntry } = await import('../../sdd-runner/src/index.js')
    process.env['SDD_RUNNER_CONFIG'] = path.join(tmp, 'config.json')
    process.argv = ['bun', 'sdd', state.runId]
    await expect(runEntry()).rejects.toThrow(/intercepted process\.exit\(0\)/u)
    expect(writes.join('')).toContain(`run: ${state.runId}`)
    // Exactly one build — the harness renderer's (index.ts buildHarness).
    // A second means the report path went eager again and every single-run
    // report pays a models.dev loadDb it never consumes.
    expect(builds).toBe(1)
  })
})
