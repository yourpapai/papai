// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseCliArgs } from '../../review-loop/src/cli.js'

describe('parseCliArgs', () => {
  test('parses --config and --plan', () => {
    const args = parseCliArgs(['--config', '/path/to/config.json', '--plan', '/path/to/plan.md'])
    expect(args.configPath).toBe('/path/to/config.json')
    expect(args.planPath).toBe('/path/to/plan.md')
  })

  test('parses --resume-run', () => {
    const args = parseCliArgs([
      '--config',
      '/path/to/config.json',
      '--plan',
      '/path/to/plan.md',
      '--resume-run',
      '2026-07-15T10-30-00-000Z',
    ])
    expect(args.resumeRunId).toBe('2026-07-15T10-30-00-000Z')
  })

  test('throws on missing --plan', () => {
    expect(() => parseCliArgs(['--config', '/path/to/config.json'])).toThrow('Missing required --plan')
  })
})
