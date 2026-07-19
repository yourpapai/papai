// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseConsolidationResult } from '../../../scripts/behavior-audit/consolidate-agent.js'

describe('ConsolidationItemSchema', () => {
  test('accepts item without entryPointHints (defaults to empty)', () => {
    const item = {
      featureName: 'f',
      isUserFacing: true,
      behavior: 'b',
      userStory: 'u',
      context: 'c',
      sourceBehaviorIds: [],
      sourceTestKeys: [],
      supportingInternalRefs: [],
    }
    const result = parseConsolidationResult({ consolidations: [item] })
    expect(result.consolidations[0]!.entryPointHints).toEqual([])
  })

  test('accepts item with entryPointHints', () => {
    const item = {
      featureName: 'f',
      isUserFacing: true,
      behavior: 'b',
      userStory: 'u',
      context: 'c',
      sourceBehaviorIds: [],
      sourceTestKeys: [],
      supportingInternalRefs: [],
      entryPointHints: [{ kind: 'command', identifier: '/config' }],
    }
    const result = parseConsolidationResult({ consolidations: [item] })
    expect(result.consolidations[0]!.entryPointHints).toEqual([{ kind: 'command', identifier: '/config' }])
  })
})
