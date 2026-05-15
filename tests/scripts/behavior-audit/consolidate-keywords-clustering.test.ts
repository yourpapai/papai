// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

describe('consolidate-keywords-clustering module surface', () => {
  test('does not expose buildClusters from the production module surface', async () => {
    const module = await import('../../../scripts/behavior-audit/consolidate-keywords-clustering.js')

    expect(module.buildClustersNormalized).toBeDefined()
    expect(module.toNormalizedFloat64Arrays).toBeDefined()
    expect('buildClusters' in module).toBe(false)
  })
})
