// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseCliArgs, splitLines } from '../../review-loop/src/cli.js'

describe('parseCliArgs', () => {
  test('defaults configPath to review-loop/config.json and repoRoot to .', () => {
    const args = parseCliArgs(['--plan', '/path/to/plan.md'])
    expect(args.configPath.endsWith('review-loop/config.json')).toBe(true)
    expect(args.repoRoot).toBe('.')
  })

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

describe('splitLines', () => {
  const cases: ReadonlyArray<{
    name: string
    pending: string
    chunk: string
    lines: string[]
    remaining: string
  }> = [
    { name: 'single complete line', pending: '', chunk: '{"a":1}\n', lines: ['{"a":1}'], remaining: '' },
    {
      name: 'multiple lines in one chunk',
      pending: '',
      chunk: '{"a":1}\n{"b":2}\n',
      lines: ['{"a":1}', '{"b":2}'],
      remaining: '',
    },
    {
      name: 'line split across chunks: first half',
      pending: '',
      chunk: '{"a":',
      lines: [],
      remaining: '{"a":',
    },
    {
      name: 'line split across chunks: second half',
      pending: '{"a":',
      chunk: '1}\n',
      lines: ['{"a":1}'],
      remaining: '',
    },
    { name: 'skips empty lines', pending: '', chunk: '\n\n{"x":1}\n', lines: ['{"x":1}'], remaining: '' },
    {
      name: 'trailing partial without newline',
      pending: '',
      chunk: '{"a":1}\npartial',
      lines: ['{"a":1}'],
      remaining: 'partial',
    },
    { name: 'empty input', pending: '', chunk: '', lines: [], remaining: '' },
  ]

  for (const c of cases) {
    test(c.name, () => {
      expect(splitLines(c.pending, c.chunk)).toEqual({ lines: c.lines, remaining: c.remaining })
    })
  }
})
