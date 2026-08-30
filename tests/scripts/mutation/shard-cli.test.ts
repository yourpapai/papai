// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseShardCliArgs } from '../../../scripts/mutation/shard-cli.js'

describe('parseShardCliArgs', () => {
  test('parses a plan invocation with its defaults', () => {
    const parsed = parseShardCliArgs(['plan'])
    expect(parsed).toMatchObject({ kind: 'plan', baseRef: 'origin/master', noScoreCache: false })
  })

  test('parses plan overrides', () => {
    expect(parseShardCliArgs(['plan', '--base=origin/main', '--cap=8', '--no-score-cache'])).toMatchObject({
      kind: 'plan',
      baseRef: 'origin/main',
      cap: 8,
      noScoreCache: true,
    })
  })

  test('parses a shard invocation', () => {
    expect(parseShardCliArgs(['shard', '--index=3'])).toMatchObject({ kind: 'shard', shardIndex: 3 })
  })

  test('parses a gate invocation with a results directory', () => {
    expect(parseShardCliArgs(['gate', '--results=reports/shards'])).toMatchObject({
      kind: 'gate',
      resultsDir: 'reports/shards',
      threshold: 0,
    })
  })

  test('parses a gate threshold', () => {
    expect(parseShardCliArgs(['gate', '--threshold=0.6'])).toMatchObject({ kind: 'gate', threshold: 0.6 })
  })

  describe('rejects malformed input rather than guessing', () => {
    test('a missing subcommand', () => {
      expect(parseShardCliArgs([])).toMatchObject({ kind: 'usageError' })
    })

    test('an unknown subcommand', () => {
      expect(parseShardCliArgs(['measure'])).toMatchObject({ kind: 'usageError' })
    })

    test('an unknown flag', () => {
      expect(parseShardCliArgs(['plan', '--nope'])).toMatchObject({ kind: 'usageError' })
    })

    test('a shard without an index', () => {
      expect(parseShardCliArgs(['shard'])).toMatchObject({ kind: 'usageError' })
    })

    test('a negative or non-numeric shard index', () => {
      expect(parseShardCliArgs(['shard', '--index=-1'])).toMatchObject({ kind: 'usageError' })
      expect(parseShardCliArgs(['shard', '--index=abc'])).toMatchObject({ kind: 'usageError' })
    })

    test('an out-of-range threshold', () => {
      expect(parseShardCliArgs(['gate', '--threshold=2'])).toMatchObject({ kind: 'usageError' })
    })

    test('a cap that is not a positive integer', () => {
      expect(parseShardCliArgs(['plan', '--cap=0'])).toMatchObject({ kind: 'usageError' })
      expect(parseShardCliArgs(['plan', '--cap=x'])).toMatchObject({ kind: 'usageError' })
    })

    // A mistyped boolean that is silently ignored is the worst outcome for a gate: the run goes
    // green while doing something other than what was asked. Same rule as changed-files.ts.
    test('a boolean flag matched by prefix rather than exactly', () => {
      expect(parseShardCliArgs(['plan', '--no-score-caches'])).toMatchObject({ kind: 'usageError' })
    })
  })
})
