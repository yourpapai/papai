// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ResultSchema } from '../../mutation-improve/src/result-schema.js'
import { SelectionSchema } from '../../mutation-improve/src/selection-schema.js'

describe('contracts', () => {
  test('SelectionSchema accepts a well-formed selection and rejects missing runnerUps', () => {
    const valid = {
      file: 'src/live-status/tool-status-labels.ts',
      beforeScore: 0.46,
      rationale: 'Pure, dependency-free, user-facing.',
      runnerUps: [{ file: 'src/tools/tool-metadata.ts', score: 0.29, why: 'declarative table' }],
    }
    expect(() => SelectionSchema.parse(valid)).not.toThrow()
    expect(() => SelectionSchema.parse({ ...valid, runnerUps: undefined })).toThrow()
  })

  test('SelectionSchema rejects beforeScore out of [0,1]', () => {
    const base = {
      file: 'a.ts',
      beforeScore: 0.5,
      rationale: 'x',
      runnerUps: [],
    }
    expect(() => SelectionSchema.parse({ ...base, beforeScore: 1.2 })).toThrow()
  })

  test('ResultSchema accepts empty residuals and defaults notes to empty string', () => {
    const parsed = ResultSchema.parse({
      specPath: 'docs/superpowers/specs/x-design.md',
      planPath: 'docs/superpowers/plans/x.md',
      testPaths: ['tests/live-status/x.test.ts'],
      residuals: [],
    })
    expect(parsed.notes).toBe('')
  })

  test('ResultSchema requires at least one testPath', () => {
    const base = {
      specPath: 'd.md',
      planPath: 'p.md',
      testPaths: [],
      residuals: [],
    }
    expect(() => ResultSchema.parse(base)).toThrow()
    expect(() => ResultSchema.parse({ ...base, testPaths: ['tests/x.test.ts'] })).not.toThrow()
  })
})
