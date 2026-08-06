// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import { ratchetVerifiedSkip } from '../../mutation-improve/src/skip-ratchet.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('ratchetVerifiedSkip', () => {
  test('stale floor: writes bumped baseline to repoRoot and commits baseline.json in repoRoot', async () => {
    const repoRoot = makeTempDir('sr-')
    const writes: Array<{ root: string; map: Record<string, number> }> = []
    const gitCalls: string[] = []
    const deps = {
      config: { repoRoot },
      writeBaseline: (root: string, map: Record<string, number>): Promise<void> => {
        writes.push({ root, map })
        return Promise.resolve()
      },
      execGit: (cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> => {
        gitCalls.push(`${cwd} ${args.join(' ')}`)
        return Promise.resolve({ stdout: '', stderr: '' })
      },
    }
    const baseline = { 'src/foo.ts': 0.5 }
    await ratchetVerifiedSkip(deps, baseline, 'src/foo.ts', 0.9)
    expect(writes).toHaveLength(1)
    expect(writes[0]?.root).toBe(repoRoot)
    expect(writes[0]?.map['src/foo.ts']).toBe(0.9)
    expect(gitCalls).toContain(`${repoRoot} add scripts/mutation/baseline.json`)
    expect(
      gitCalls.some((c) => c.startsWith(`${repoRoot} commit -m chore(mutation): ratchet src/foo.ts baseline to 0.9`)),
    ).toBe(true)
  })

  test('accurate floor: baseline[file] already >= score → no writes, no git calls', async () => {
    const repoRoot = makeTempDir('sr-')
    let writes = 0
    const gitCalls: string[] = []
    const deps = {
      config: { repoRoot },
      writeBaseline: (): Promise<void> => {
        writes += 1
        return Promise.resolve()
      },
      execGit: (_cwd: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> => {
        gitCalls.push(args.join(' '))
        return Promise.resolve({ stdout: '', stderr: '' })
      },
    }
    const baseline = { 'src/foo.ts': 0.97 }
    await ratchetVerifiedSkip(deps, baseline, 'src/foo.ts', 0.96)
    expect(writes).toBe(0)
    expect(gitCalls).toHaveLength(0)
  })
})
