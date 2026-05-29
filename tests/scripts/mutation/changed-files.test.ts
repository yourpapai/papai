// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { selectChangedMutationTargets, type ChangedFilesDeps } from '../../../scripts/mutation/changed-files.js'

const makeDeps = (gitOutput: string, isGateableImpl: ChangedFilesDeps['isGateableImpl']): ChangedFilesDeps => ({
  git: mock(() => gitOutput),
  isGateableImpl,
})

describe('selectChangedMutationTargets', () => {
  test('returns gateable .ts files changed vs base ref sorted and deduped', () => {
    const gateableFiles = new Set(['src/a.ts', 'src/m.ts', 'src/z.ts'])
    const deps = makeDeps(
      ['src/z.ts', 'src/a.ts', 'README.md', 'src/a.ts', 'tests/a.test.ts', '', '  src/m.ts  '].join('\n'),
      (relPath) => gateableFiles.has(relPath),
    )

    const result = selectChangedMutationTargets({
      baseRef: 'origin/main',
      projectRoot: '/repo',
      deps,
    })

    expect(result).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts'])
  })

  test('returns empty list for empty git output', () => {
    const deps = makeDeps('', () => true)

    const result = selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: '/repo',
      deps,
    })

    expect(result).toEqual([])
  })

  test('excludes test files and non-implementation assets using injected gateable predicate', () => {
    const isGateableImpl = mock((relPath: string) => relPath === 'src/impl.ts')
    const deps = makeDeps(['src/impl.ts', 'src/impl.test.ts', 'docs/guide.md'].join('\n'), isGateableImpl)

    const result = selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: '/repo',
      deps,
    })

    expect(result).toEqual(['src/impl.ts'])
    expect(isGateableImpl).toHaveBeenCalledWith('src/impl.test.ts', '/repo')
    expect(isGateableImpl).toHaveBeenCalledWith('docs/guide.md', '/repo')
  })

  test("passes git args ['diff', '--name-only', 'origin/master...HEAD']", () => {
    const git = mock(() => 'src/impl.ts\n')
    const deps: ChangedFilesDeps = {
      git,
      isGateableImpl: () => true,
    }

    selectChangedMutationTargets({
      baseRef: 'origin/master',
      projectRoot: '/repo',
      deps,
    })

    expect(git).toHaveBeenCalledWith(['diff', '--name-only', 'origin/master...HEAD'])
  })
})
