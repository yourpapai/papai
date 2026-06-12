// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import { loadOverrides, resolveTestFiles } from '../../../scripts/mutation/test-overrides.js'

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..')

function expectSkipWithNoCompanionReason(result: ReturnType<typeof resolveTestFiles>): void {
  if (result.kind !== 'skip') {
    throw new Error(`Expected skip result, got ${result.kind}`)
  }
  expect(result.reason).toMatch(/no companion/iu)
}

describe('loadOverrides', () => {
  test('returns {} when the file does not exist', () => {
    const overrides = loadOverrides('/no/such/path.json')
    expect(overrides).toEqual({})
  })

  test('parses a valid overrides JSON object', () => {
    // Use the committed overrides.json (starts as {}).
    const overrides = loadOverrides(path.join(PROJECT_ROOT, 'scripts/mutation/overrides.json'))
    expect(typeof overrides).toBe('object')
    expect(overrides).not.toBeNull()
  })
})

describe('resolveTestFiles', () => {
  const stubFindTestFile = (impl: string): string | null => {
    if (impl.endsWith('config.ts')) return path.join(PROJECT_ROOT, 'tests/config.test.ts')
    return null
  }

  test('returns the companion test alone when no override is registered', () => {
    const result = resolveTestFiles({
      srcFile: 'src/config.ts',
      projectRoot: PROJECT_ROOT,
      overrides: {},
      findTestFile: stubFindTestFile,
    })
    expect(result).toEqual({ kind: 'ok', testFiles: ['tests/config.test.ts'] })
  })

  test('appends override tests after the companion, dedup-preserving order', () => {
    const result = resolveTestFiles({
      srcFile: 'src/config.ts',
      projectRoot: PROJECT_ROOT,
      overrides: {
        'src/config.ts': ['tests/integration/config-flow.test.ts', 'tests/config.test.ts'],
      },
      findTestFile: stubFindTestFile,
    })
    expect(result).toEqual({
      kind: 'ok',
      testFiles: ['tests/config.test.ts', 'tests/integration/config-flow.test.ts'],
    })
  })

  test('uses override tests only when no companion exists', () => {
    const result = resolveTestFiles({
      srcFile: 'src/no-companion.ts',
      projectRoot: PROJECT_ROOT,
      overrides: { 'src/no-companion.ts': ['tests/integration/covers.test.ts'] },
      findTestFile: stubFindTestFile,
    })
    expect(result).toEqual({
      kind: 'ok',
      testFiles: ['tests/integration/covers.test.ts'],
    })
  })

  test('returns kind:"skip" with a reason when no companion and no override', () => {
    const result = resolveTestFiles({
      srcFile: 'src/no-companion.ts',
      projectRoot: PROJECT_ROOT,
      overrides: {},
      findTestFile: stubFindTestFile,
    })
    expectSkipWithNoCompanionReason(result)
  })
})
