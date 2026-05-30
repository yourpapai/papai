// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { trackSourceWrite, TRACKED_PREFIXES } from '../../../.hooks/docs/track-source-write.mjs'

describe('trackSourceWrite', () => {
  test('exports TRACKED_PREFIXES', () => {
    expect(TRACKED_PREFIXES).toContain('src/')
    expect(TRACKED_PREFIXES).toContain('client/')
    expect(TRACKED_PREFIXES).toContain('plugins/')
    expect(TRACKED_PREFIXES).toContain('scripts/')
  })

  test('returns true for files in tracked directories', () => {
    expect(trackSourceWrite('src/tools/foo.ts')).toBe(true)
    expect(trackSourceWrite('client/debug/bar.tsx')).toBe(true)
    expect(trackSourceWrite('plugins/hello/index.ts')).toBe(true)
    expect(trackSourceWrite('scripts/check.sh')).toBe(true)
  })

  test('returns false for files outside tracked directories', () => {
    expect(trackSourceWrite('tests/foo.test.ts')).toBe(false)
    expect(trackSourceWrite('.claude/settings.json')).toBe(false)
    expect(trackSourceWrite('README.md')).toBe(false)
    expect(trackSourceWrite('.hooks/tdd/session-state.mjs')).toBe(false)
    expect(trackSourceWrite('docs/adr/0001.md')).toBe(false)
  })

  test('returns false for empty or null paths', () => {
    expect(trackSourceWrite('')).toBe(false)
    expect(trackSourceWrite(null)).toBe(false)
    expect(trackSourceWrite(undefined)).toBe(false)
  })

  test('normalizes absolute paths when cwd is provided', () => {
    const cwd = '/Users/ki/Projects/papai'
    expect(trackSourceWrite('/Users/ki/Projects/papai/src/tools/foo.ts', cwd)).toBe(true)
    expect(trackSourceWrite('/Users/ki/Projects/papai/client/debug/bar.tsx', cwd)).toBe(true)
    expect(trackSourceWrite('/Users/ki/Projects/papai/tests/foo.test.ts', cwd)).toBe(false)
  })

  test('absolute path without cwd falls back to prefix check (false)', () => {
    expect(trackSourceWrite('/Users/ki/Projects/papai/src/tools/foo.ts')).toBe(false)
  })
})
