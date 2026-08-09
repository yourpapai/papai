// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseWrapperArgs, selectMode } from '../../../scripts/test/mode.js'

interface ModeCase {
  readonly label: string
  readonly explicit: 'parallel' | 'serial' | null
  readonly env: Record<string, string | undefined>
  readonly cores: number
  readonly expected: 'parallel' | 'serial'
}

const MODE_CASES: readonly ModeCase[] = [
  // explicit override wins over every other signal
  { label: 'explicit serial beats a 16-core box', explicit: 'serial', env: {}, cores: 16, expected: 'serial' },
  {
    label: 'explicit parallel beats CI',
    explicit: 'parallel',
    env: { CI: 'true' },
    cores: 2,
    expected: 'parallel',
  },
  {
    label: 'explicit parallel beats a low core count',
    explicit: 'parallel',
    env: {},
    cores: 1,
    expected: 'parallel',
  },
  { label: 'explicit serial beats CI=false', explicit: 'serial', env: { CI: 'false' }, cores: 32, expected: 'serial' },

  // CI truthy forces serial regardless of cores
  { label: "CI='true' forces serial", explicit: null, env: { CI: 'true' }, cores: 32, expected: 'serial' },
  { label: "CI='1' forces serial", explicit: null, env: { CI: '1' }, cores: 8, expected: 'serial' },
  { label: "CI='0' is still truthy-present", explicit: null, env: { CI: '0' }, cores: 16, expected: 'serial' },

  // CI present but not truthy falls through to the core count
  { label: "CI='' falls through, 16 cores", explicit: null, env: { CI: '' }, cores: 16, expected: 'parallel' },
  { label: "CI='' falls through, 4 cores", explicit: null, env: { CI: '' }, cores: 4, expected: 'serial' },
  {
    label: "CI='false' falls through, 12 cores",
    explicit: null,
    env: { CI: 'false' },
    cores: 12,
    expected: 'parallel',
  },
  { label: "CI='false' falls through, 2 cores", explicit: null, env: { CI: 'false' }, cores: 2, expected: 'serial' },
  {
    label: 'CI undefined falls through, 8 cores',
    explicit: null,
    env: { CI: undefined },
    cores: 8,
    expected: 'parallel',
  },

  // core threshold is >= 8
  { label: '7 cores is serial', explicit: null, env: {}, cores: 7, expected: 'serial' },
  { label: '8 cores is parallel', explicit: null, env: {}, cores: 8, expected: 'parallel' },
  { label: '9 cores is parallel', explicit: null, env: {}, cores: 9, expected: 'parallel' },
  { label: '4 vCPU container is serial', explicit: null, env: {}, cores: 4, expected: 'serial' },
  { label: '0 cores (unknown) is serial', explicit: null, env: {}, cores: 0, expected: 'serial' },
]

describe('selectMode', () => {
  for (const testCase of MODE_CASES) {
    test(testCase.label, () => {
      expect(selectMode(testCase.explicit, testCase.env, testCase.cores)).toBe(testCase.expected)
    })
  }

  test('ignores unrelated environment variables', () => {
    expect(selectMode(null, { CI_NAME: 'github', NODE_ENV: 'test' }, 16)).toBe('parallel')
    expect(selectMode(null, { CI_NAME: 'github', NODE_ENV: 'test' }, 4)).toBe('serial')
  })
})

describe('parseWrapperArgs', () => {
  test('an empty argv yields defaults', () => {
    expect(parseWrapperArgs([])).toEqual({
      mode: null,
      bypass: false,
      stream: false,
      passthrough: [],
      paths: [],
    })
  })

  test('--serial sets the mode and is stripped from passthrough', () => {
    const args = parseWrapperArgs(['--serial', 'tests/utils'])
    expect(args.mode).toBe('serial')
    expect(args.passthrough).toEqual(['tests/utils'])
    expect(args.paths).toEqual(['tests/utils'])
  })

  test('--parallel sets the mode and is stripped from passthrough', () => {
    const args = parseWrapperArgs(['--parallel'])
    expect(args.mode).toBe('parallel')
    expect(args.passthrough).toEqual([])
  })

  test('the last explicit mode flag wins', () => {
    expect(parseWrapperArgs(['--parallel', '--serial']).mode).toBe('serial')
    expect(parseWrapperArgs(['--serial', '--parallel']).mode).toBe('parallel')
  })

  test('--stream sets stream and is stripped from passthrough', () => {
    const args = parseWrapperArgs(['--stream', '--coverage'])
    expect(args.stream).toBe(true)
    expect(args.mode).toBe(null)
    expect(args.passthrough).toEqual(['--coverage'])
  })

  for (const flag of ['--watch', '-u', '--update-snapshots']) {
    test(`${flag} sets bypass and survives in passthrough`, () => {
      const args = parseWrapperArgs([flag, 'tests/utils'])
      expect(args.bypass).toBe(true)
      expect(args.passthrough).toEqual([flag, 'tests/utils'])
      expect(args.paths).toEqual(['tests/utils'])
    })
  }

  test('bypass is false when no bypass flag is present', () => {
    expect(parseWrapperArgs(['--serial', '--coverage']).bypass).toBe(false)
  })

  test('non-wrapper flags survive in order', () => {
    const args = parseWrapperArgs([
      '-t',
      'baz',
      '--bail',
      '--bail=3',
      '--rerun-each=2',
      '--coverage',
      '--timeout',
      '30000',
    ])
    expect(args.passthrough).toEqual([
      '-t',
      'baz',
      '--bail',
      '--bail=3',
      '--rerun-each=2',
      '--coverage',
      '--timeout',
      '30000',
    ])
    expect(args.paths).toEqual([])
    expect(args.mode).toBe(null)
    expect(args.stream).toBe(false)
    expect(args.bypass).toBe(false)
  })

  test('wrapper-only flags are removed while surrounding order is preserved', () => {
    const args = parseWrapperArgs([
      'tests/a',
      '--serial',
      '-t',
      'pattern',
      '--stream',
      '--coverage',
      '--parallel',
      'tests/b/c.test.ts',
    ])
    expect(args.passthrough).toEqual(['tests/a', '-t', 'pattern', '--coverage', 'tests/b/c.test.ts'])
    expect(args.paths).toEqual(['tests/a', 'tests/b/c.test.ts'])
    expect(args.mode).toBe('parallel')
    expect(args.stream).toBe(true)
  })

  test('positional paths are collected while remaining in passthrough', () => {
    const args = parseWrapperArgs(['tests/utils', 'tests/chat/router.test.ts'])
    expect(args.paths).toEqual(['tests/utils', 'tests/chat/router.test.ts'])
    expect(args.passthrough).toEqual(['tests/utils', 'tests/chat/router.test.ts'])
  })

  const VALUE_FLAGS: readonly string[] = [
    '-t',
    '--test-name-pattern',
    '--timeout',
    '--bail',
    '--rerun-each',
    '--retry',
    '--seed',
    '--max-concurrency',
    '--reporter',
    '--reporter-outfile',
    '--coverage-reporter',
    '--coverage-dir',
    '--path-ignore-patterns',
    '--config',
  ]

  for (const flag of VALUE_FLAGS) {
    test(`the value after ${flag} is not treated as a path`, () => {
      const args = parseWrapperArgs([flag, 'value', 'tests/real-path'])
      expect(args.paths).toEqual(['tests/real-path'])
      expect(args.passthrough).toEqual([flag, 'value', 'tests/real-path'])
    })
  }

  test('an inline =value does not swallow the next positional', () => {
    const args = parseWrapperArgs(['--timeout=30000', 'tests/utils'])
    expect(args.paths).toEqual(['tests/utils'])
    expect(args.passthrough).toEqual(['--timeout=30000', 'tests/utils'])
  })

  test('a value-taking flag followed by another flag consumes nothing', () => {
    const args = parseWrapperArgs(['--bail', '--coverage', 'tests/utils'])
    expect(args.paths).toEqual(['tests/utils'])
    expect(args.passthrough).toEqual(['--bail', '--coverage', 'tests/utils'])
  })

  test('a trailing value-taking flag with no value is harmless', () => {
    const args = parseWrapperArgs(['tests/utils', '-t'])
    expect(args.paths).toEqual(['tests/utils'])
    expect(args.passthrough).toEqual(['tests/utils', '-t'])
  })

  test('a value that itself looks like a path is still not a path', () => {
    const args = parseWrapperArgs(['-t', 'tests/utils'])
    expect(args.paths).toEqual([])
    expect(args.passthrough).toEqual(['-t', 'tests/utils'])
  })

  test('wrapper-only flags do not consume a following value', () => {
    const args = parseWrapperArgs(['--serial', 'tests/utils', '--stream', 'tests/other'])
    expect(args.paths).toEqual(['tests/utils', 'tests/other'])
    expect(args.passthrough).toEqual(['tests/utils', 'tests/other'])
  })

  test('the input argv is not mutated', () => {
    const argv = ['--serial', 'tests/utils']
    parseWrapperArgs(argv)
    expect(argv).toEqual(['--serial', 'tests/utils'])
  })
})
