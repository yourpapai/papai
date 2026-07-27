// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { parseLcovTotals } from '../../scripts/coverage/ratchet-lib.js'
import { formatStoryCoverageScope, isScopedSourceFile, scopeLcov } from '../../scripts/coverage/story-scope.js'

function record(file: string, found: number, hit: number): string {
  return [`SF:${file}`, `FNF:${found}`, `FNH:${hit}`, `LF:${found}`, `LH:${hit}`, 'end_of_record'].join('\n')
}

// One in-scope record plus the three kinds of noise the story lcov actually
// carries: test-harness files, enforcement scripts, and a leaked temp fixture.
const MIXED_LCOV = [
  record('src/a.ts', 4, 2),
  record('tests/stories/harness/chat.ts', 4, 4),
  record('scripts/story/cli.ts', 4, 4),
  record('../tmp/papai-scenario-settings-plugin-UPLZMT/index.mjs', 1, 1),
  '',
].join('\n')

describe('isScopedSourceFile', () => {
  it('accepts .ts files under the scope roots', () => {
    expect(isScopedSourceFile('src/a.ts')).toBe(true)
    expect(isScopedSourceFile('plugins/acp/index.ts')).toBe(true)
  })

  it('rejects files outside the scope roots', () => {
    expect(isScopedSourceFile('tests/stories/harness/chat.ts')).toBe(false)
    expect(isScopedSourceFile('scripts/coverage/ratchet.ts')).toBe(false)
    expect(isScopedSourceFile('../tmp/papai-scenario-settings-plugin-UPLZMT/index.mjs')).toBe(false)
  })

  it('rejects .testing.ts doubles, which are test support that lives under src/', () => {
    expect(isScopedSourceFile('src/cache.testing.ts')).toBe(false)
    expect(isScopedSourceFile('plugins/acp/client.testing.ts')).toBe(false)
  })

  it('rejects non-TypeScript files under a scope root', () => {
    expect(isScopedSourceFile('src/a.json')).toBe(false)
  })
})

describe('scopeLcov', () => {
  it('drops every record outside the scope roots', () => {
    const scoped = scopeLcov(MIXED_LCOV, [])

    expect(scoped.lcov).toContain('SF:src/a.ts')
    expect(scoped.lcov).not.toContain('tests/stories/harness/chat.ts')
    expect(scoped.lcov).not.toContain('scripts/story/cli.ts')
    expect(scoped.lcov).not.toContain('papai-scenario-settings-plugin')
    expect(scoped.measured).toEqual(['src/a.ts'])
  })

  it('seeds unloaded files as zero records so they count against the mean', () => {
    const scoped = scopeLcov(MIXED_LCOV, ['src/a.ts', 'src/b.ts', 'plugins/demo/index.ts'])

    expect(scoped.seeded).toEqual(['plugins/demo/index.ts', 'src/b.ts'])
    // src/a.ts is 2/4; the two seeds contribute 0 each. Mean = 0.5 / 3.
    expect(parseLcovTotals(scoped.lcov).lines.pct).toBeCloseTo(0.5 / 3, 10)
  })

  it('does not seed a file that already has a record', () => {
    const scoped = scopeLcov(MIXED_LCOV, ['src/a.ts'])

    expect(scoped.seeded).toEqual([])
    expect(scoped.lcov.match(/^SF:src\/a\.ts$/gmu)).toHaveLength(1)
  })

  it('ignores out-of-scope entries in the source list', () => {
    const scoped = scopeLcov(MIXED_LCOV, ['tests/helper.ts', 'src/b.testing.ts'])

    expect(scoped.seeded).toEqual([])
  })

  it('orders seeded files deterministically regardless of input order', () => {
    const forward = scopeLcov(MIXED_LCOV, ['src/b.ts', 'src/c.ts'])
    const reversed = scopeLcov(MIXED_LCOV, ['src/c.ts', 'src/b.ts'])

    expect(forward.seeded).toEqual(['src/b.ts', 'src/c.ts'])
    expect(reversed.seeded).toEqual(forward.seeded)
  })

  it('keeps an in-scope record whose file is no longer on disk', () => {
    // The run that produced the lcov executed it, so it is evidence. The
    // source list is the seeding input, not a whitelist for kept records.
    const scoped = scopeLcov(MIXED_LCOV, ['src/b.ts'])

    expect(scoped.measured).toEqual(['src/a.ts'])
  })

  it('reports 0% when nothing was loaded', () => {
    const scoped = scopeLcov('', ['src/a.ts', 'src/b.ts'])

    expect(scoped.measured).toEqual([])
    expect(scoped.seeded).toEqual(['src/a.ts', 'src/b.ts'])
    expect(parseLcovTotals(scoped.lcov).lines.pct).toBe(0)
  })
})

describe('formatStoryCoverageScope', () => {
  it('reports the denominator so a falling figure is explainable', () => {
    const text = formatStoryCoverageScope(scopeLcov(MIXED_LCOV, ['src/a.ts', 'src/b.ts']))

    expect(text).toBe('  scope: 1 measured, 1 unloaded seeded as 0%, 2 files')
  })
})
