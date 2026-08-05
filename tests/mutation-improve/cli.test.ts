// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseCliArgs } from '../../mutation-improve/src/cli.js'

describe('cli parseCliArgs', () => {
  test('parses --config and requires --config (default exists)', () => {
    const args = parseCliArgs(['--config', '/c.json'])
    expect(args.configPath).toBe('/c.json')
    expect(args.count).toBeUndefined()
    expect(args.noPr).toBe(false)
  })

  test('parses --count, --threshold, --base, --no-pr', () => {
    const args = parseCliArgs(['--count', '3', '--threshold=0.9', '--base', 'develop', '--no-pr'])
    expect(args.count).toBe(3)
    expect(args.threshold).toBe(0.9)
    expect(args.base).toBe('develop')
    expect(args.noPr).toBe(true)
  })

  test('rejects non-positive --count', () => {
    expect(() => parseCliArgs(['--count', '0'])).toThrow()
  })

  test('parses --resume-run and --reset-worktree', () => {
    const args = parseCliArgs(['--resume-run', 'r1', '--reset-worktree'])
    expect(args.resumeRunId).toBe('r1')
    expect(args.resetWorktree).toBe(true)
  })
})
