// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { mapFilesToDocs } from '../../../.hooks/docs/map-files-to-docs.mjs'

describe('mapFilesToDocs', () => {
  test('returns empty array for empty input', () => {
    expect(mapFilesToDocs([])).toEqual([])
  })

  test('always includes root CLAUDE.md and README.md when files exist', () => {
    const result = mapFilesToDocs(['src/index.ts'])
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
  })

  test('maps src/tools/ file to src/tools/CLAUDE.md', () => {
    const result = mapFilesToDocs(['src/tools/create-task.ts'])
    expect(result).toContain('src/tools/CLAUDE.md')
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
  })

  test('maps src/chat/ file to src/chat/CLAUDE.md', () => {
    const result = mapFilesToDocs(['src/chat/router.ts'])
    expect(result).toContain('src/chat/CLAUDE.md')
  })

  test('maps src/providers/ file to src/providers/CLAUDE.md', () => {
    const result = mapFilesToDocs(['src/providers/kaneo.ts'])
    expect(result).toContain('src/providers/CLAUDE.md')
  })

  test('maps src/commands/ file to src/commands/CLAUDE.md', () => {
    const result = mapFilesToDocs(['src/commands/help.ts'])
    expect(result).toContain('src/commands/CLAUDE.md')
  })

  test('deduplicates docs when multiple files map to same doc', () => {
    const result = mapFilesToDocs(['src/tools/a.ts', 'src/tools/b.ts'])
    const toolClaudeCount = result.filter((d) => d === 'src/tools/CLAUDE.md').length
    expect(toolClaudeCount).toBe(1)
  })

  test('walks up directory tree when no CLAUDE.md in immediate parent', () => {
    const result = mapFilesToDocs(['src/index.ts'])
    expect(result).toContain('CLAUDE.md')
    expect(result).not.toContain('src/CLAUDE.md')
  })

  test('handles client/ files (no nested CLAUDE.md)', () => {
    const result = mapFilesToDocs(['client/debug/components/sidebar.tsx'])
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
    expect(result.filter((d) => d.includes('CLAUDE.md')).length).toBe(1)
  })

  test('handles plugins/ files', () => {
    const result = mapFilesToDocs(['plugins/hello-world/index.ts'])
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
  })

  test('handles scripts/ files', () => {
    const result = mapFilesToDocs(['scripts/check.sh'])
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
  })

  test('deduplicates across multiple directories', () => {
    const result = mapFilesToDocs(['src/tools/a.ts', 'client/debug/b.tsx'])
    const rootClaudeCount = result.filter((d) => d === 'CLAUDE.md').length
    expect(rootClaudeCount).toBe(1)
  })
})
