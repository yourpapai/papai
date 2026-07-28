// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { openCoverageCache } from '../../../scripts/mutation/coverage-cache.js'
import { buildCoverageMap, createDefaultCoverageMapDeps } from '../../../scripts/mutation/coverage-map.js'

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

  it('omits sources with no covering test', () => {
    const map = buildCoverageMap({
      sourceFiles: ['src/lonely.ts'],
      projectRoot: '/proj',
      deps: {
        listCandidateTests: () => ['tests/x.test.ts'],
        runCoverage: () => new Map([['src/other.ts', 1]]),
      },
    })
    expect(map).toEqual({})
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

  it('round-trips a well-formed entry (positive control proving misses are not vacuous)', () => {
    const cachePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cov-cache-ok-')), 'cache.json')
    openCoverageCache(cachePath).set(key, new Map([['src/a.ts', 7]]))
    const got = openCoverageCache(cachePath).get(key, ttl)
    expect(got).toBeInstanceOf(Map)
    expect(got?.get('src/a.ts')).toBe(7)
  })
})
