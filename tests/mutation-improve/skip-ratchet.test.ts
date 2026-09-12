// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'

import type { MeasuredScore } from '../../mutation-improve/src/score-reader.js'
import { ratchetVerifiedSkip } from '../../mutation-improve/src/skip-ratchet.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

/** A measurement consistent with the score formula: score === (killed + timeout) / scored. */
const measurement = (score: number, killed: number, timeout: number, scored: number): MeasuredScore => ({
  score,
  killed,
  timeout,
  scored,
  survivingMutantIds: [],
})

const collectingDeps = (
  repoRoot: string,
): {
  deps: {
    config: { repoRoot: string }
    writeBaseline: (root: string, map: Record<string, unknown>) => Promise<void>
    execGit: (cwd: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>
  }
  writes: Array<{ root: string; map: Record<string, unknown> }>
  gitCalls: string[]
} => {
  const writes: Array<{ root: string; map: Record<string, unknown> }> = []
  const gitCalls: string[] = []
  return {
    deps: {
      config: { repoRoot },
      writeBaseline: (root, map) => {
        writes.push({ root, map })
        return Promise.resolve()
      },
      execGit: (cwd, args) => {
        gitCalls.push(`${cwd} ${args.join(' ')}`)
        return Promise.resolve({ stdout: '', stderr: '' })
      },
    },
    writes,
    gitCalls,
  }
}

describe('ratchetVerifiedSkip', () => {
  test('stale floor: passes the full measurement to the bump, writes the record, and commits in repoRoot', async () => {
    const repoRoot = makeTempDir('sr-')
    const { deps, writes, gitCalls } = collectingDeps(repoRoot)
    const baseline = { 'src/foo.ts': 0.5 }
    await ratchetVerifiedSkip(deps, baseline, 'src/foo.ts', measurement(0.9, 8, 1, 10))
    expect(writes).toHaveLength(1)
    expect(writes[0]?.root).toBe(repoRoot)
    expect(writes[0]?.map['src/foo.ts']).toEqual({ score: 0.9, killed: 8, timeout: 1, scored: 10 })
    expect(gitCalls).toContain(`${repoRoot} add scripts/mutation/baseline.json`)
    expect(
      gitCalls.some((c) => c.startsWith(`${repoRoot} commit -m chore(mutation): ratchet src/foo.ts baseline to 0.9`)),
    ).toBe(true)
  })

  // The bump's same-map return on a no-op preserves reference identity, so the
  // early-return keeps suppressing the no-op commit it guards.
  test('rich no-op: an equal-or-lower measurement over a rich record writes nothing and commits nothing', async () => {
    const repoRoot = makeTempDir('sr-')
    const { deps, writes, gitCalls } = collectingDeps(repoRoot)
    const baseline = { 'src/foo.ts': { score: 0.97, killed: 97, timeout: 0, scored: 100 } }
    await ratchetVerifiedSkip(deps, baseline, 'src/foo.ts', measurement(0.96, 96, 0, 100))
    expect(writes).toHaveLength(0)
    expect(gitCalls).toHaveLength(0)
  })

  // The one-time shape upgrade changes the map (bare entry → rich record at the
  // unchanged floor), so the early-return correctly lets it commit.
  test('legacy shape-upgrade: a measurement at exactly a bare floor converts the entry and commits', async () => {
    const repoRoot = makeTempDir('sr-')
    const { deps, writes, gitCalls } = collectingDeps(repoRoot)
    await ratchetVerifiedSkip(deps, { 'src/foo.ts': 0.9 }, 'src/foo.ts', measurement(0.9, 8, 1, 10))
    expect(writes).toHaveLength(1)
    expect(writes[0]?.map['src/foo.ts']).toEqual({ score: 0.9, killed: 8, timeout: 1, scored: 10 })
    expect(gitCalls.some((c) => c.includes('commit'))).toBe(true)
  })

  test('accurate bare floor: a below-floor measurement still suppresses the commit', async () => {
    const repoRoot = makeTempDir('sr-')
    const { deps, writes, gitCalls } = collectingDeps(repoRoot)
    await ratchetVerifiedSkip(deps, { 'src/foo.ts': 0.97 }, 'src/foo.ts', measurement(0.96, 96, 0, 100))
    expect(writes).toHaveLength(0)
    expect(gitCalls).toHaveLength(0)
  })
})
