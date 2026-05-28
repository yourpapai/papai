// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildDocReviewPrompt } from '../../../.hooks/docs/build-doc-review-prompt.mjs'

describe('buildDocReviewPrompt', () => {
  test('builds prompt with changed files and doc paths', () => {
    const changedFiles = ['src/tools/create-task.ts', 'src/chat/router.ts']
    const docPaths = ['CLAUDE.md', 'README.md', 'src/tools/CLAUDE.md']

    const result = buildDocReviewPrompt(changedFiles, docPaths)

    expect(result).toContain('source files were changed')
    expect(result).toContain('src/tools/create-task.ts')
    expect(result).toContain('src/chat/router.ts')
    expect(result).toContain('CLAUDE.md')
    expect(result).toContain('README.md')
    expect(result).toContain('src/tools/CLAUDE.md')
    expect(result).toContain('review and update')
  })

  test('lists changed files in bullet format', () => {
    const result = buildDocReviewPrompt(['src/a.ts'], ['CLAUDE.md'])
    expect(result).toContain('- src/a.ts')
  })

  test('lists doc paths in bullet format', () => {
    const result = buildDocReviewPrompt(['src/a.ts'], ['CLAUDE.md', 'README.md'])
    expect(result).toContain('- CLAUDE.md')
    expect(result).toContain('- README.md')
  })

  test('includes skip instruction', () => {
    const result = buildDocReviewPrompt(['src/a.ts'], ['CLAUDE.md'])
    expect(result).toContain('ignore this')
  })
})
