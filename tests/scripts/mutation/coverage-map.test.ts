// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openCoverageCache } from '../../../scripts/mutation/coverage-cache.js'
import {
  buildCoverageMap,
  createDefaultCoverageMapDeps,
  _runCoverageForTest as runCoverageFor,
  _samePackageTestDirForTest as samePackageTestDir,
} from '../../../scripts/mutation/coverage-map.js'

describe('samePackageTestDir — src↔tests package mapping (all roots)', () => {
  // Mirrors `.hooks/tdd/test-resolver.mjs` findTestPath/suggestTestPath. Locks every branch so a
  // future change to either side can't silently drift the candidate-narrowing universe.
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['src/chat/mattermost/file-helpers.ts', 'tests/chat/mattermost'],
    ['src/history.ts', 'tests'],
    ['src/tools/create-task.ts', 'tests/tools'],
    ['client/admin/handlers.ts', 'tests/client/admin'],
    ['client/a/b/c.ts', 'tests/client/a/b'],
    ['plugins/task-provider-kaneo/client.ts', 'tests/plugins/task-provider-kaneo'],
    ['review-loop/src/index.ts', 'tests/review-loop'],
    ['review-loop/src/lib/util.ts', 'tests/review-loop/lib'],
    ['scripts/foo.ts', 'tests'],
  ]
  for (const [input, expected] of cases) {
    it(`maps ${input} -> ${expected}`, () => {
      expect(samePackageTestDir(input)).toBe(expected)
    })
  }
})

describe('buildCoverageMap', () => {
  it('inverts per-test coverage into sourceFile -> testFiles, filtered to requested sources', () => {
    const coverageByTest = new Map<string, ReadonlyMap<string, number>>([
      [
        'tests/a/index.test.ts',
        new Map([
          ['src/a.ts', 5],
          ['src/a-helpers.ts', 2],
        ]),
      ],
      ['tests/other.test.ts', new Map([['src/unrelated.ts', 9]])],
    ])
    const map = buildCoverageMap({
      sourceFiles: ['src/a.ts', 'src/a-helpers.ts'],
      projectRoot: '/proj',
      deps: {
        listCandidateTests: (_src) => ['tests/a/index.test.ts', 'tests/other.test.ts'],
        runCoverage: (testFile) => coverageByTest.get(testFile)!,
      },
    })
    expect(map).toEqual({
      'src/a.ts': ['tests/a/index.test.ts'],
      'src/a-helpers.ts': ['tests/a/index.test.ts'],
    })
  })

  it('omits sources with no covering test, and says so through the injected sink', () => {
    const warnings: string[] = []
    const map = buildCoverageMap({
      sourceFiles: ['src/lonely.ts'],
      projectRoot: '/proj',
      deps: {
        listCandidateTests: () => ['tests/x.test.ts'],
        runCoverage: () => new Map([['src/other.ts', 1]]),
        warn: (message) => {
          warnings.push(message)
        },
      },
    })
    expect(map).toEqual({})
    expect(warnings).toEqual(['coverage-map: no covering test found for src/lonely.ts (checked 1 candidates)'])
  })

  it('calls flush exactly once after the batch completes', () => {
    let flushCalls = 0
    buildCoverageMap({
      sourceFiles: ['src/a.ts', 'src/b.ts'],
      projectRoot: '/proj',
      deps: {
        listCandidateTests: () => ['tests/a.test.ts'],
        runCoverage: () => new Map([['src/a.ts', 1]]),
        flush: () => {
          flushCalls += 1
        },
        warn: () => {},
      },
    })
    expect(flushCalls).toBe(1)
  })

  it('calls flush even when a source has no candidates (still completes the batch)', () => {
    let flushCalls = 0
    buildCoverageMap({
      sourceFiles: ['src/none.ts'],
      projectRoot: '/proj',
      deps: {
        listCandidateTests: () => [],
        runCoverage: () => new Map(),
        flush: () => {
          flushCalls += 1
        },
        warn: () => {},
      },
    })
    expect(flushCalls).toBe(1)
  })
})

describe('createDefaultCoverageMapDeps — listCandidateTests widening', () => {
  const makeTmpRoot = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-map-widen-'))
    fs.mkdirSync(path.join(root, 'src', 'chat', 'mattermost'), { recursive: true })
    fs.mkdirSync(path.join(root, 'tests', 'chat', 'mattermost'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'chat', 'mattermost', 'file-helpers.ts'), 'export const x = 1\n')
    fs.writeFileSync(path.join(root, 'src', 'chat', 'mattermost', 'index.ts'), `export * from './file-helpers.js'\n`)
    // Transitive case: index.test.ts imports index.ts (NOT file-helpers directly).
    fs.writeFileSync(path.join(root, 'tests', 'chat', 'mattermost', 'index.test.ts'), `import './index-impl-stub.js'\n`)
    // Direct-import case: file-helpers.test.ts imports file-helpers directly.
    fs.writeFileSync(
      path.join(root, 'tests', 'chat', 'mattermost', 'file-helpers.test.ts'),
      `import '../../../src/chat/mattermost/file-helpers.js'\n`,
    )
    // Unrelated package: must not be included.
    fs.mkdirSync(path.join(root, 'tests', 'chat', 'telegram'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'tests', 'chat', 'telegram', 'index.test.ts'),
      `import '../../../src/chat/telegram/whatever.js'\n`,
    )
    return root
  }

  it('includes same-package tests that do NOT directly import the source', () => {
    const root = makeTmpRoot()
    const deps = createDefaultCoverageMapDeps(root)
    const candidates = [...deps.listCandidateTests('src/chat/mattermost/file-helpers.ts')].sort()
    expect(candidates).toEqual(
      ['tests/chat/mattermost/file-helpers.test.ts', 'tests/chat/mattermost/index.test.ts'].sort(),
    )
  })

  it('excludes tests outside the same package', () => {
    const root = makeTmpRoot()
    const deps = createDefaultCoverageMapDeps(root)
    const candidates = deps.listCandidateTests('src/chat/mattermost/file-helpers.ts')
    expect(candidates).not.toContain('tests/chat/telegram/index.test.ts')
  })

  it('same-package widening derives tests-root scope for top-level src files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-map-widen-root-'))
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'history.ts'), 'export const h = 1\n')
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true })
    fs.writeFileSync(path.join(root, 'tests', 'history.test.ts'), `import '../src/history.js'\n`)
    fs.writeFileSync(
      path.join(root, 'tests', 'history-edit.test.ts'),
      `// does not import history.ts directly, but lives at tests root\n`,
    )
    const deps = createDefaultCoverageMapDeps(root)
    const candidates = [...deps.listCandidateTests('src/history.ts')].sort()
    expect(candidates).toEqual(['tests/history-edit.test.ts', 'tests/history.test.ts'].sort())
  })
})

describe('createDefaultCoverageMapDeps — external lanes are never candidates', () => {
  it('excludes tests/e2e and tests/stories even when they import the source directly', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-map-lanes-'))
    fs.mkdirSync(path.join(root, 'src', 'analytics'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'analytics', 'thing.ts'), 'export const t = 1\n')
    fs.mkdirSync(path.join(root, 'tests', 'analytics'), { recursive: true })
    fs.writeFileSync(path.join(root, 'tests', 'analytics', 'thing.test.ts'), `import '../../src/analytics/thing.js'\n`)
    fs.mkdirSync(path.join(root, 'tests', 'e2e'), { recursive: true })
    fs.writeFileSync(path.join(root, 'tests', 'e2e', 'thing.test.ts'), `import '../../src/analytics/thing.js'\n`)
    fs.mkdirSync(path.join(root, 'tests', 'stories', 'analytics'), { recursive: true })
    fs.writeFileSync(
      path.join(root, 'tests', 'stories', 'analytics', 'thing.story.test.ts'),
      `import '../../../src/analytics/thing.js'\n`,
    )
    const deps = createDefaultCoverageMapDeps(root)
    expect(deps.listCandidateTests('src/analytics/thing.ts')).toEqual(['tests/analytics/thing.test.ts'])
  })
})

describe('runCoverageFor — failure handling', () => {
  const makeOpts = (
    cachePath: string,
    spawn: () => Map<string, number> | null,
  ): {
    readonly coverageDir: string
    readonly lcovName: string
    readonly timeoutMs: number
    readonly cache: ReturnType<typeof openCoverageCache>
    readonly cacheTtlMs: number
    readonly readTestContent: () => string
    readonly spawnAndParse: () => Map<string, number> | null
  } => ({
    coverageDir: 'reports/coverage',
    lcovName: 'lcov.info',
    timeoutMs: 1000,
    cache: openCoverageCache(cachePath),
    cacheTtlMs: 60_000,
    readTestContent: (): string => 'test file content',
    spawnAndParse: spawn,
  })

  // Sequencer kept outside the test callbacks: oxlint's no-conditional-in-test forbids
  // branching inside it() bodies.
  const spawnSequence = (
    results: ReadonlyArray<Map<string, number> | null>,
  ): { readonly spawn: () => Map<string, number> | null; readonly calls: () => number } => {
    let calls = 0
    return {
      spawn: () => {
        calls += 1
        return results[calls - 1] ?? null
      },
      calls: () => calls,
    }
  }

  it('fails open to an empty map without caching the failure (transient errors stay retryable)', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-run-fail-')), 'cache.json')
    const success = new Map([['src/a.ts', 3]])
    // Third entry is defensive: the third call must be served from cache, never reaching spawn
    // (the calls() assertion below pins that).
    const seq = spawnSequence([null, success, success])
    const opts = makeOpts(cachePath, seq.spawn)
    expect([...runCoverageFor('tests/a.test.ts', '/proj', opts).entries()]).toEqual([])
    // Second call must re-spawn (failure was not cached) and now succeeds...
    expect(runCoverageFor('tests/a.test.ts', '/proj', opts).get('src/a.ts')).toBe(3)
    // ...and the third call is served from the cache.
    expect(runCoverageFor('tests/a.test.ts', '/proj', opts).get('src/a.ts')).toBe(3)
    expect(seq.calls()).toBe(2)
  })

  it('caches successful runs (including legitimately empty coverage)', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-run-ok-')), 'cache.json')
    const seq = spawnSequence([new Map()])
    const opts = makeOpts(cachePath, seq.spawn)
    expect([...runCoverageFor('tests/a.test.ts', '/proj', opts).entries()]).toEqual([])
    expect([...runCoverageFor('tests/a.test.ts', '/proj', opts).entries()]).toEqual([])
    expect(seq.calls()).toBe(1)
  })
})

describe('openCoverageCache — malformed entries are treated as a miss (never throws)', () => {
  // Exercises the cache layer directly (safeGetEntry / isCoverageCacheEntry / isCachePair /
  // isCoverageCacheFile). Hermetic: no `createDefaultCoverageMapDeps`, no `runCoverage`, and
  // therefore NO `bun test` spawn. The cache keys are arbitrary strings — the key derivation
  // lives in coverage-map.ts and is not under test here.
  const key = 'tests/x.test.ts:deadbeefdeadbeef'
  const ttl = 60_000

  const writeCache = (cachePath: string, payload: unknown): void => {
    fs.writeFileSync(cachePath, typeof payload === 'string' ? payload : JSON.stringify(payload))
  }

  it('returns undefined for an entry whose value is not an array of pairs', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-cache-value-')), 'cache.json')
    writeCache(cachePath, {
      entries: {
        [key]: { value: 'not-an-iterable-of-pairs', ts: Date.now() },
      },
    })
    expect(openCoverageCache(cachePath).get(key, ttl)).toBeUndefined()
  })

  it('returns undefined when value holds a non-pair element (isCachePair rejects)', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-cache-pairs-')), 'cache.json')
    writeCache(cachePath, {
      entries: {
        [key]: { value: [['src/a.ts', 1], 'not-a-pair'], ts: Date.now() },
      },
    })
    expect(openCoverageCache(cachePath).get(key, ttl)).toBeUndefined()
  })

  it('returns undefined for an entry with a non-finite timestamp', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-cache-ts-')), 'cache.json')
    writeCache(cachePath, {
      entries: {
        [key]: { value: [['src/a.ts', 1]], ts: Number.POSITIVE_INFINITY },
      },
    })
    expect(openCoverageCache(cachePath).get(key, ttl)).toBeUndefined()
  })

  it('returns undefined for a structurally wrong top-level cache file', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-cache-top-')), 'cache.json')
    writeCache(cachePath, 'not-a-cache-object')
    expect(openCoverageCache(cachePath).get(key, ttl)).toBeUndefined()
  })

  it('returns undefined when the cache file is unparseable JSON', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-cache-json-')), 'cache.json')
    writeCache(cachePath, '{broken')
    expect(openCoverageCache(cachePath).get(key, ttl)).toBeUndefined()
  })

  it('returns undefined for a stale (expired) entry', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-cache-ttl-')), 'cache.json')
    writeCache(cachePath, {
      entries: {
        [key]: { value: [['src/a.ts', 3]], ts: Date.now() - 10_000 },
      },
    })
    expect(openCoverageCache(cachePath).get(key, 1)).toBeUndefined()
  })

  it('round-trips a well-formed entry after flush (positive control proving misses are not vacuous)', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-cache-ok-')), 'cache.json')
    const cache = openCoverageCache(cachePath)
    cache.set(key, new Map([['src/a.ts', 7]]))
    cache.flush()
    const got = openCoverageCache(cachePath).get(key, ttl)
    expect(got).toBeInstanceOf(Map)
    expect(got?.get('src/a.ts')).toBe(7)
  })

  it('does NOT persist a set to disk until flush (batched writes)', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-cache-batch-')), 'cache.json')
    openCoverageCache(cachePath).set(key, new Map([['src/a.ts', 9]]))
    // A fresh instance reads the file, which was never written -> miss.
    expect(openCoverageCache(cachePath).get(key, ttl)).toBeUndefined()
  })

  it('flush is a no-op when nothing was set (not dirty)', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-cache-noop-')), 'cache.json')
    expect(() => openCoverageCache(cachePath).flush()).not.toThrow()
    expect(fs.existsSync(cachePath)).toBe(false)
  })
})
