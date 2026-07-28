// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

describe('createDefaultCoverageMapDeps — cache never-throws', () => {
  it('treats a malformed cache entry as a miss and runs coverage fresh', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cov-map-cache-'))
    const cachePath = path.join(root, 'cache.json')
    // The implementation looks up cache entries by `<testAbs>:<sha256(content)[0:16]>`.
    // tests/anything.test.ts does not exist on disk -> content is '' -> hash is the
    // well-known empty-string sha256 prefix. We inject a malformed entry under that
    // exact key so the cache hit path is exercised (and must not throw).
    const testAbs = path.resolve(root, 'tests/anything.test.ts')
    const key = `${testAbs}:e3b0c44298fc1c14`
    fs.writeFileSync(
      cachePath,
      JSON.stringify({
        entries: {
          [key]: { value: 'not-an-iterable-of-pairs', ts: Date.now() },
        },
      }),
    )
    const deps = createDefaultCoverageMapDeps(root, { cachePath, cacheTtlMs: 60_000 })
    // Lookup of a malformed entry must not throw; it returns undefined (cache miss),
    // then runCoverage spawns bun and fails open to an empty Map.
    expect(() => deps.runCoverage('tests/anything.test.ts', root)).not.toThrow()
  })
})
