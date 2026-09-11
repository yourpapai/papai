// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { FALLBACK_EFFORT_LEVELS, effortLevelsFor, isEffortLevel } from '../../src/models-dev/effort-levels.js'
import type { ModelMetadata } from '../../src/models-dev/resolve.js'
import { assertEach, type Row } from '../utils/grouped-assertions.js'

const fallbackUnion = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const metadataWith = (overrides: Partial<ModelMetadata>): ModelMetadata => ({
  providerId: null,
  modelId: null,
  contextWindow: null,
  maxOutputTokens: null,
  source: 'none',
  via: null,
  ...overrides,
})

describe('effort-levels', () => {
  test('the fallback union lists every known level in effort-ascending order', () => {
    expect(FALLBACK_EFFORT_LEVELS).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  test('derives the level set from the model metadata', async () => {
    const rows: readonly Row<{ readonly metadata: ModelMetadata; readonly expected: readonly string[] }>[] = [
      {
        label: 'catalogue levels win verbatim in catalogue order',
        metadata: metadataWith({ effortLevels: ['high', 'low'] }),
        expected: ['high', 'low'],
      },
      {
        label: 'catalogue levels win even when the flag says non-reasoning',
        metadata: metadataWith({ reasoning: false, effortLevels: ['low'] }),
        expected: ['low'],
      },
      {
        label: 'a non-reasoning model offers the empty set',
        metadata: metadataWith({ reasoning: false }),
        expected: [],
      },
      {
        label: 'a present-but-empty catalogue list falls through to the union',
        metadata: metadataWith({ reasoning: true, effortLevels: [] }),
        expected: fallbackUnion,
      },
      {
        label: 'a null catalogue list falls through to the union',
        metadata: metadataWith({ effortLevels: null }),
        expected: fallbackUnion,
      },
      {
        label: 'metadata without reasoning data falls through to the union',
        metadata: metadataWith({}),
        expected: fallbackUnion,
      },
      {
        label: 'a null reasoning flag does not force the empty set',
        metadata: metadataWith({ reasoning: null }),
        expected: fallbackUnion,
      },
    ]
    await assertEach(rows, (row) => {
      expect(effortLevelsFor(row.metadata)).toEqual(row.expected)
    })
  })

  test('membership checks the derived set', async () => {
    const rows: readonly Row<{
      readonly metadata: ModelMetadata
      readonly value: string
      readonly expected: boolean
    }>[] = [
      {
        label: 'a catalogue level is a member',
        metadata: metadataWith({ effortLevels: ['low', 'high'] }),
        value: 'low',
        expected: true,
      },
      {
        label: 'a union level is a member for unknown models',
        metadata: metadataWith({}),
        value: 'xhigh',
        expected: true,
      },
      {
        label: 'an unknown string is not a member',
        metadata: metadataWith({}),
        value: 'bogus',
        expected: false,
      },
      {
        label: 'no level is a member of the empty set',
        metadata: metadataWith({ reasoning: false }),
        value: 'high',
        expected: false,
      },
    ]
    await assertEach(rows, (row) => {
      expect(isEffortLevel(row.metadata, row.value)).toBe(row.expected)
    })
  })
})
