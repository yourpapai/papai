// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  activitySummary,
  formatDuration,
  formatLiveLine,
  formatTokenCount,
  formatToolArg,
  truncate,
} from '../../review-loop/src/live-format.js'

describe('formatDuration', () => {
  test('formats seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(42000)).toBe('42s')
  })
  test('formats minutes and seconds', () => {
    expect(formatDuration(125000)).toBe('2m05s')
  })
  test('60s boundary uses minute format', () => {
    expect(formatDuration(60_000)).toBe('1m00s')
  })
})

describe('truncate', () => {
  test('non-positive max returns empty', () => {
    expect(truncate('abc', 0)).toBe('')
    expect(truncate('abc', -2)).toBe('')
  })
  test('value at exactly max length is returned unchanged', () => {
    expect(truncate('abcd', 4)).toBe('abcd')
    expect(truncate('abc', 3)).toBe('abc')
  })
})

describe('formatToolArg', () => {
  test('read/edit/write use basename of filePath', () => {
    expect(formatToolArg('read', { filePath: '/a/b/cli.ts' })).toBe('cli.ts')
    expect(formatToolArg('edit', { path: '/a/b/src/x.ts' })).toBe('x.ts')
  })
  test('write resolves filePath basename', () => {
    expect(formatToolArg('write', { filePath: '/a/b/x.ts' })).toBe('x.ts')
  })
  test('read returns empty when filePath resolves to empty', () => {
    expect(formatToolArg('read', { filePath: '' })).toBe('')
  })
  test('bash truncates command', () => {
    expect(formatToolArg('bash', { command: 'echo hi' })).toBe('echo hi')
    const long = 'x'.repeat(60)
    expect(formatToolArg('bash', { command: long })).toHaveLength(40)
  })
  test('bash ignores non-command string values', () => {
    expect(formatToolArg('bash', { a: 'firstval', command: 'echo hi' })).toBe('echo hi')
  })
  test('grep/glob use pattern', () => {
    expect(formatToolArg('grep', { pattern: 'TODO' })).toBe('TODO')
  })
  test('grep ignores non-pattern string values', () => {
    expect(formatToolArg('grep', { a: 'firstval', pattern: 'TODO' })).toBe('TODO')
  })
  test('glob ignores non-pattern string values', () => {
    expect(formatToolArg('glob', { a: 'firstval', pattern: '**/*.ts' })).toBe('**/*.ts')
  })
  test('task uses description then subagent_type', () => {
    expect(formatToolArg('task', { description: 'find files' })).toBe('find files')
    expect(formatToolArg('task', { subagent_type: 'explore' })).toBe('explore')
  })
  test('task prioritizes description over an earlier subagent_type', () => {
    expect(formatToolArg('task', { subagent_type: 'explore', description: 'find files' })).toBe('find files')
  })
  test('task skips empty description and falls back to subagent_type', () => {
    expect(formatToolArg('task', { description: '', subagent_type: 'explore' })).toBe('explore')
  })
  test('fallback uses first string value', () => {
    expect(formatToolArg('custom', { a: 'hello', b: 'world' })).toBe('hello')
  })
  test('fallback skips empty first value', () => {
    expect(formatToolArg('custom', { a: '', b: 'world' })).toBe('world')
  })
  test('fallback skips non-string first value', () => {
    expect(formatToolArg('custom', { a: [1], b: 'world' })).toBe('world')
  })
  test('non-record input falls back to empty', () => {
    expect(formatToolArg('custom', 'hello')).toBe('')
  })
  test('null input does not throw and falls back to empty', () => {
    expect(formatToolArg('custom', null)).toBe('')
  })
  test('empty input yields empty string', () => {
    expect(formatToolArg('read', {})).toBe('')
    expect(formatToolArg('mystery', {})).toBe('')
  })
})

describe('formatLiveLine', () => {
  test('renders label, tool, arg, elapsed, count', () => {
    const line = formatLiveLine('fixer', 'edit', 'cli.ts', 42000, 3, { input: 0, output: 0 })
    expect(line).toContain('fixer')
    expect(line).toContain('edit cli.ts')
    expect(line).toContain('42s')
    expect(line).toContain('3 tools')
  })
  test('no tool yet shows thinking', () => {
    expect(formatLiveLine('reviewer', '', '', 2000, 0, { input: 0, output: 0 })).toContain('thinking')
  })
  test('renders exact line with singular tool count', () => {
    expect(formatLiveLine('reviewer', 'read', 'a.ts', 1000, 1, { input: 0, output: 0 })).toBe(
      `  reviewer   \u25B6 read a.ts \u00B7 1s \u00B7 1 tool`,
    )
  })
  test('renders exact line when arg is empty', () => {
    expect(formatLiveLine('fixer', 'edit', '', 5000, 2, { input: 0, output: 0 })).toBe(
      `  fixer      \u25B6 edit \u00B7 5s \u00B7 2 tools`,
    )
  })
  test('appends cumulative tokens once non-zero', () => {
    expect(formatLiveLine('improve', 'bash', 'bun test', 5000, 41, { input: 850_000, output: 12_000 })).toBe(
      `  improve    \u25B6 bash bun test \u00B7 5s \u00B7 41 tools \u00B7 in 850.0k / out 12.0k`,
    )
  })
  test('hides the token segment while both counts are zero', () => {
    expect(formatLiveLine('improve', 'read', 'a.ts', 5000, 1, { input: 0, output: 0 })).not.toContain('in ')
  })
  test('shows the token segment when only output is zero', () => {
    expect(formatLiveLine('improve', 'read', 'a.ts', 5000, 1, { input: 5, output: 0 })).toContain('in 5 / out 0')
  })
  test('shows the token segment when only input is zero', () => {
    expect(formatLiveLine('improve', 'read', 'a.ts', 5000, 1, { input: 0, output: 2 })).toContain('in 0 / out 2')
  })
  test('done=true swaps the arrow for a check mark', () => {
    const line = formatLiveLine('improve', 'read', 'a.ts', 5000, 1, { input: 5, output: 2 }, true)
    expect(line).toBe(`  improve    \u2713 read a.ts \u00B7 5s \u00B7 1 tool \u00B7 in 5 / out 2`)
  })
})

describe('formatTokenCount', () => {
  test('formats compact token counts', () => {
    expect(formatTokenCount(999)).toBe('999')
    expect(formatTokenCount(1000)).toBe('1.0k')
    expect(formatTokenCount(9824)).toBe('9.8k')
    expect(formatTokenCount(228819)).toBe('228.8k')
    expect(formatTokenCount(1500000)).toBe('1.50M')
  })
  test('million boundary uses M suffix', () => {
    expect(formatTokenCount(1_000_000)).toBe('1.00M')
  })
})

describe('activitySummary', () => {
  test('empty input returns empty string', () => {
    expect(activitySummary([])).toBe('')
  })
  test('maps known role bases to verbs', () => {
    expect(activitySummary(['reviewer'])).toBe('review')
    expect(activitySummary(['matcher'])).toBe('match')
    expect(activitySummary(['fixer'])).toBe('fix')
    expect(activitySummary(['inspector'])).toBe('inspect')
    expect(activitySummary(['build'])).toBe('build')
  })
  test('multiple occurrences append a count', () => {
    expect(activitySummary(['reviewer', 'reviewer', 'fixer'])).toBe(`review\u00D72+fix`)
  })
  test('joins distinct verbs with plus', () => {
    expect(activitySummary(['reviewer', 'fixer'])).toBe('review+fix')
  })
  test('unknown base uses the base itself', () => {
    expect(activitySummary(['unknownrole'])).toBe('unknownrole')
  })
})
