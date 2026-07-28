// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { buildCoverageMap } from '../../../scripts/mutation/coverage-map.js'

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
