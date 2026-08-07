// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildImprovePrompt, buildSelectPrompt } from '../../mutation-improve/src/prompt-templates.js'

describe('prompt-templates', () => {
  test('buildSelectPrompt names the output path, the done-set, and the rejection rules', () => {
    const prompt = buildSelectPrompt({
      doneSet: ['src/a.ts'],
      baselineSummary: '{"src/b.ts":0.2}',
      outputPath: '/run/iter/1/selection.json',
    })
    expect(prompt).toContain('/run/iter/1/selection.json')
    expect(prompt).toContain('src/a.ts')
    expect(prompt).toContain('Math.random')
    expect(prompt).toContain('baseline.json')
  })

  test('buildImprovePrompt states the no-src and no-baseline hard constraints and the exact-equality discipline', () => {
    const prompt = buildImprovePrompt({
      file: 'src/foo.ts',
      beforeScore: 0.3,
      threshold: 0.95,
      date: '2026-08-05',
      outputPath: '/run/iter/1/result.json',
    })
    expect(prompt).toContain('MUST NOT edit anything under src/')
    expect(prompt).toContain('MUST NOT edit scripts/mutation/baseline.json')
    expect(prompt).toContain('toBe(')
    expect(prompt).toContain('0.95')
    expect(prompt).toContain('/run/iter/1/result.json')
    expect(prompt).toContain('openspec/changes/mutation-coverage-2026-08-05-foo/design.md')
    expect(prompt).toContain('openspec/changes/mutation-coverage-2026-08-05-foo/tasks.md')
    expect(prompt).not.toContain('docs/superpowers')
  })
})
