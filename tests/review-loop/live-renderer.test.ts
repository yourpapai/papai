// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { formatDuration, formatLiveLine, formatStepFooter, formatToolArg } from '../../review-loop/src/live-renderer.js'

describe('formatDuration', () => {
  test('formats seconds under a minute', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(42000)).toBe('42s')
  })
  test('formats minutes and seconds', () => {
    expect(formatDuration(125000)).toBe('2m05s')
  })
})

describe('formatToolArg', () => {
  test('read/edit/write use basename of filePath', () => {
    expect(formatToolArg('read', { filePath: '/a/b/cli.ts' })).toBe('cli.ts')
    expect(formatToolArg('edit', { path: '/a/b/src/x.ts' })).toBe('x.ts')
  })
  test('bash truncates command', () => {
    expect(formatToolArg('bash', { command: 'echo hi' })).toBe('echo hi')
    const long = 'x'.repeat(60)
    expect(formatToolArg('bash', { command: long })).toHaveLength(40)
  })
  test('grep/glob use pattern', () => {
    expect(formatToolArg('grep', { pattern: 'TODO' })).toBe('TODO')
  })
  test('task uses description then subagent_type', () => {
    expect(formatToolArg('task', { description: 'find files' })).toBe('find files')
    expect(formatToolArg('task', { subagent_type: 'explore' })).toBe('explore')
  })
  test('fallback uses first string value', () => {
    expect(formatToolArg('custom', { a: 'hello', b: 'world' })).toBe('hello')
  })
  test('empty input yields empty string', () => {
    expect(formatToolArg('read', {})).toBe('')
    expect(formatToolArg('mystery', {})).toBe('')
  })
})

describe('formatLiveLine', () => {
  test('renders label, tool, arg, elapsed, count', () => {
    const line = formatLiveLine('fixer', 'edit', 'cli.ts', 42000, 3)
    expect(line).toContain('fixer')
    expect(line).toContain('edit cli.ts')
    expect(line).toContain('42s')
    expect(line).toContain('3 tools')
  })
  test('singular tool count', () => {
    expect(formatLiveLine('reviewer', 'read', 'a.ts', 1000, 1)).toContain('1 tool')
  })
  test('no tool yet shows thinking', () => {
    expect(formatLiveLine('reviewer', '', '', 2000, 0)).toContain('thinking')
  })
})

describe('formatStepFooter', () => {
  test('renders summary with tokens', () => {
    const footer = formatStepFooter('reviewer', 18000, 4, { input: 13373, output: 31 })
    expect(footer).toContain('reviewer')
    expect(footer).toContain('18s')
    expect(footer).toContain('4 tools')
    expect(footer).toContain('in 13373 / out 31')
  })
})
