// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  FINGERPRINT_FILES,
  FINGERPRINT_ROOTS,
  computeFingerprint,
  defaultFingerprintDeps,
} from '../../../scripts/test/fingerprint.js'
import type { FingerprintDeps } from '../../../scripts/test/fingerprint.js'

interface FakeEntry {
  size: number
  mtimeMs: number
}

/**
 * Builds injected deps over an in-memory `path -> stat` map. `scan` returns
 * every known path for the first pattern and nothing for the rest, so a test
 * controls the exact entry set regardless of how many roots the module walks.
 */
function makeDeps(
  files: Record<string, FakeEntry | null | undefined>,
  options: { order?: string[] } = {},
): FingerprintDeps {
  const paths = options.order ?? Object.keys(files)
  let served = false
  return {
    scan: (_pattern: string): Iterable<string> => {
      if (served) return []
      served = true
      return paths
    },
    stat: (relPath: string): { size: number; mtimeMs: number } | null => files[relPath] ?? null,
  }
}

const BASE: Record<string, FakeEntry> = {
  'src/a.ts': { size: 10, mtimeMs: 1000 },
  'src/b.ts': { size: 20, mtimeMs: 2000 },
  'tests/c.test.ts': { size: 30, mtimeMs: 3000 },
}

const HEX_16 = /^[\da-f]{16}$/u

/** Deps whose first `repeats` scans all yield the same `BASE` paths. */
function makeRepeatingDeps(repeats: number): FingerprintDeps {
  let calls = 0
  const all = Object.keys(BASE)
  return {
    scan: (): Iterable<string> => {
      calls += 1
      return calls <= repeats ? all : []
    },
    stat: (relPath: string): { size: number; mtimeMs: number } | null => BASE[relPath] ?? null,
  }
}

/** Reads a stat through a zero placeholder so the assertion stays branch-free. */
function statOrZero(deps: FingerprintDeps, relPath: string): { size: number; mtimeMs: number } {
  return deps.stat(relPath) ?? { size: 0, mtimeMs: 0 }
}

describe('fingerprint constants', () => {
  test('roots cover src, client, plugins, tests and scripts', () => {
    expect([...FINGERPRINT_ROOTS]).toEqual([
      'src/**/*.ts',
      'client/**/*.{ts,svelte}',
      'plugins/**/*.ts',
      'tests/**/*.ts',
      'scripts/**/*.ts',
    ])
  })

  test('standalone files cover the runtime and dependency manifests', () => {
    expect([...FINGERPRINT_FILES]).toEqual(['bunfig.toml', 'package.json', 'bun.lock'])
  })
})

describe('computeFingerprint', () => {
  test('returns a 16-char lowercase hex digest', () => {
    const digest = computeFingerprint(makeDeps(BASE))
    expect(digest).toMatch(HEX_16)
  })

  test('is stable across two calls on identical input', () => {
    expect(computeFingerprint(makeDeps(BASE))).toBe(computeFingerprint(makeDeps(BASE)))
  })

  test('changes when a file size changes', () => {
    const changed = { ...BASE, 'src/b.ts': { size: 21, mtimeMs: 2000 } }
    expect(computeFingerprint(makeDeps(changed))).not.toBe(computeFingerprint(makeDeps(BASE)))
  })

  test('changes when a file mtimeMs changes', () => {
    const changed = { ...BASE, 'src/b.ts': { size: 20, mtimeMs: 2001 } }
    expect(computeFingerprint(makeDeps(changed))).not.toBe(computeFingerprint(makeDeps(BASE)))
  })

  test('changes when a path is added', () => {
    const added = { ...BASE, 'src/d.ts': { size: 5, mtimeMs: 500 } }
    expect(computeFingerprint(makeDeps(added))).not.toBe(computeFingerprint(makeDeps(BASE)))
  })

  test('changes when a path is removed', () => {
    const removed = { 'src/a.ts': BASE['src/a.ts'], 'src/b.ts': BASE['src/b.ts'] }
    expect(computeFingerprint(makeDeps(removed))).not.toBe(computeFingerprint(makeDeps(BASE)))
  })

  test('is order-independent: shuffled scan output yields the same digest', () => {
    const forward = computeFingerprint(makeDeps(BASE, { order: ['src/a.ts', 'src/b.ts', 'tests/c.test.ts'] }))
    const shuffled = computeFingerprint(makeDeps(BASE, { order: ['tests/c.test.ts', 'src/a.ts', 'src/b.ts'] }))
    expect(shuffled).toBe(forward)
  })

  test('renaming a path changes the digest even when size and mtime match', () => {
    const renamed = {
      'src/a.ts': BASE['src/a.ts'],
      'src/b.ts': BASE['src/b.ts'],
      'tests/renamed.test.ts': BASE['tests/c.test.ts'],
    }
    expect(computeFingerprint(makeDeps(renamed))).not.toBe(computeFingerprint(makeDeps(BASE)))
  })

  test('deduplicates a path yielded by more than one pattern', () => {
    expect(computeFingerprint(makeRepeatingDeps(2))).toBe(computeFingerprint(makeDeps(BASE)))
  })

  test('skips a path whose stat returns null instead of throwing', () => {
    const vanished = makeDeps(
      { ...BASE, 'src/gone.ts': null },
      { order: ['src/a.ts', 'src/b.ts', 'tests/c.test.ts', 'src/gone.ts'] },
    )
    expect(computeFingerprint(vanished)).toBe(computeFingerprint(makeDeps(BASE)))
  })

  test('an empty entry set still produces a digest', () => {
    expect(computeFingerprint(makeDeps({}))).toMatch(HEX_16)
  })

  test('scans every root plus every standalone file', () => {
    const patterns: string[] = []
    const stats: string[] = []
    const deps: FingerprintDeps = {
      scan: (pattern: string): Iterable<string> => {
        patterns.push(pattern)
        return []
      },
      stat: (relPath: string) => {
        stats.push(relPath)
        return null
      },
    }
    computeFingerprint(deps)
    expect(patterns).toEqual([...FINGERPRINT_ROOTS])
    expect(stats).toEqual([...FINGERPRINT_FILES])
  })
})

describe('defaultFingerprintDeps', () => {
  test('stats a real file relative to the given cwd', () => {
    const deps = defaultFingerprintDeps(process.cwd())
    const stat = statOrZero(deps, 'package.json')
    expect(stat.size).toBeGreaterThan(0)
    expect(stat.mtimeMs).toBeGreaterThan(0)
  })

  test('returns null for a path that does not exist', () => {
    const deps = defaultFingerprintDeps(process.cwd())
    expect(deps.stat('this/path/definitely/does/not/exist.ts')).toBeNull()
  })

  test('scan yields repo-relative paths for a root pattern', () => {
    const deps = defaultFingerprintDeps(process.cwd())
    const found = [...deps.scan('scripts/**/*.ts')]
    expect(found.length).toBeGreaterThan(0)
    expect(found).toContain('scripts/test/fingerprint.ts')
    expect(found.every((p) => !p.startsWith('/'))).toBe(true)
  })

  test('computes a stable 16-hex digest over the real repo', () => {
    const first = computeFingerprint(defaultFingerprintDeps(process.cwd()))
    const second = computeFingerprint(defaultFingerprintDeps(process.cwd()))
    expect(first).toMatch(HEX_16)
    expect(second).toBe(first)
  })
})
