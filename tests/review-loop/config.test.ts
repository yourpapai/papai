// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ReviewLoopConfigSchema } from '../../review-loop/src/config.js'

describe('ReviewLoopConfigSchema', () => {
  test('parses a valid config with defaults', () => {
    const parsed = ReviewLoopConfigSchema.parse({
      repoRoot: '.',
      workDir: '.review-loop',
      reviewer: { model: 'm1' },
      fixer: { model: 'm2' },
      matcher: { model: 'm3' },
    })

    expect(parsed.maxRounds).toBe(10)
    expect(parsed.maxNoProgressRounds).toBe(2)
    expect(parsed.checkCommand).toBe('bun check:full')
    expect(parsed.reviewer.extraArgs).toEqual([])
  })
})
