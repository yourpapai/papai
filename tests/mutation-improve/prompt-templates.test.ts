// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildFixPrompt, buildImprovePrompt, buildSelectPrompt } from '../../mutation-improve/src/prompt-templates.js'

describe('prompt-templates', () => {
  test('buildSelectPrompt names the output path, the done-set, and the rejection rules', () => {
    const prompt = buildSelectPrompt({
      doneSet: ['src/a.ts'],
      failedFiles: [],
      cappedFiles: [],
      baselineSummary: '{"src/b.ts":0.2}',
      outputPath: '/run/iter/1/selection.json',
    })
    expect(prompt).toContain('/run/iter/1/selection.json')
    expect(prompt).toContain('src/a.ts')
    expect(prompt).toContain('Math.random')
    expect(prompt).toContain('baseline.json')
  })

  test('buildSelectPrompt lists failed-this-run and capped files as do-not-pick, with ceilings', () => {
    const prompt = buildSelectPrompt({
      doneSet: [],
      failedFiles: ['src/failed.ts'],
      cappedFiles: [{ file: 'src/capped.ts', score: 0.857, cappedAt: '2026-08-06T00:00:00.000Z', runId: 'r0' }],
      baselineSummary: '{"src/failed.ts":0.2,"src/capped.ts":0.8}',
      outputPath: '/run/iter/1/selection.json',
    })
    expect(prompt).toContain('src/failed.ts')
    expect(prompt).toContain('attempted and FAILED this run')
    expect(prompt).toContain('src/capped.ts')
    expect(prompt).toContain('0.857')
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
    expect(prompt).toContain('docs/superpowers/specs/2026-08-05-mutation-coverage-foo-design.md')
  })

  // The improve agent once wrote a stray copy of its result to `review-loop/result.json`
  // (dropping the leading dot from `.review-loop/`), which the diff gate rejected. The
  // prompt must confine writes to the allowed prefixes plus the single result path.
  test('buildImprovePrompt confines writes to the allowed prefixes plus the single result path', () => {
    const prompt = buildImprovePrompt({
      file: 'src/foo.ts',
      beforeScore: 0.3,
      threshold: 0.95,
      date: '2026-08-05',
      outputPath: '/run/iter/1/result.json',
    })
    expect(prompt).toContain('ONLY under tests/ and docs/superpowers/')
    expect(prompt).toContain('do not create copies')
  })

  test('buildFixPrompt embeds the failed check output, the attempt budget, and the hard constraints', () => {
    const prompt = buildFixPrompt({
      file: 'src/foo.ts',
      attempt: 1,
      maxAttempts: 2,
      buildOutput: '✗ format:check failed (exit code 1)\ntests/foo.test.ts',
      outputPath: '/wt/.review-loop/result.json',
    })
    expect(prompt).toContain('src/foo.ts')
    expect(prompt).toContain('✗ format:check failed (exit code 1)')
    expect(prompt).toContain('tests/foo.test.ts')
    expect(prompt).toContain('1 of 2')
    expect(prompt).toContain('MUST NOT edit anything under src/')
    expect(prompt).toContain('ONLY under tests/ and docs/superpowers/')
    expect(prompt).toContain('/wt/.review-loop/result.json')
  })

  // Without mutantIds the runner cannot set-match declared residuals against
  // its own measured survivors, so a structurally-capped file keeps failing
  // the score gate and being re-picked (the 2026-08-06 mappers.ts loop).
  test('buildImprovePrompt requires residual mutantIds and explains the capped path', () => {
    const prompt = buildImprovePrompt({
      file: 'src/foo.ts',
      beforeScore: 0.3,
      threshold: 0.95,
      date: '2026-08-05',
      outputPath: '/run/iter/1/result.json',
    })
    expect(prompt).toContain('mutantIds')
    expect(prompt).toContain('capped')
  })

  test('buildFixPrompt result schema line includes mutantIds', () => {
    const prompt = buildFixPrompt({
      file: 'src/foo.ts',
      attempt: 1,
      maxAttempts: 2,
      buildOutput: '✗ test failed',
      outputPath: '/wt/.review-loop/result.json',
    })
    expect(prompt).toContain('mutantIds')
  })

  // The 2026-08-06 iter-8 work was discarded at the ratchet commit because the
  // agent's spec/plan .md files lacked the HTML-comment header — the prompt
  // only said "SPDX headers" and the agent guessed the // style.
  test('buildImprovePrompt spells out the HTML-comment license header for .md files', () => {
    const prompt = buildImprovePrompt({
      file: 'src/foo.ts',
      beforeScore: 0.3,
      threshold: 0.95,
      date: '2026-08-05',
      outputPath: '/run/iter/1/result.json',
    })
    expect(prompt).toContain('<!--')
    expect(prompt).toContain('SPDX-License-Identifier: BUSL-1.1')
    expect(prompt).toContain('-->')
  })
})
