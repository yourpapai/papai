// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseMemoryPatch } from '../../src/long-term-memory/extractor.js'

describe('parseMemoryPatch', () => {
  test('parses a valid JSON patch', () => {
    const patch = parseMemoryPatch(
      JSON.stringify({
        profile: '## Work style\n- Prefers concise status updates',
        records: [
          {
            kind: 'preference',
            content: 'User prefers concise status updates.',
            summary: 'Concise status updates',
            tags: ['communication'],
            confidence: 0.9,
            source: 'background',
            evidence: {
              messageIds: ['m-1'],
              timestamps: ['2026-06-12T00:00:00.000Z'],
              contextId: 'ctx-1',
            },
          },
        ],
        updates: [{ id: 'mem-1', status: 'stale', confidence: 0.4 }],
      }),
    )

    expect(patch.profile).toContain('Prefers concise')
    expect(patch.records[0]?.kind).toBe('preference')
    expect(patch.records[0]?.expiresAt).toBeUndefined()
    expect(patch.updates).toEqual([{ id: 'mem-1', status: 'stale', confidence: 0.4 }])
  })

  test('extracts a JSON object surrounded by non-JSON text', () => {
    const patch = parseMemoryPatch('Here is the patch:\n{"profile":null,"records":[],"updates":[]}\nNo other changes.')

    expect(patch).toEqual({ profile: null, records: [], updates: [] })
  })

  test('rejects malformed output with a memory patch error', () => {
    expect(() => parseMemoryPatch('not json')).toThrow(/^invalid memory patch:/u)
  })

  test('rejects confidence outside the valid range', () => {
    expect(() =>
      parseMemoryPatch(
        JSON.stringify({
          profile: null,
          records: [
            {
              kind: 'fact',
              content: 'A remembered fact.',
              summary: null,
              tags: [],
              confidence: 1.2,
              source: 'background',
              evidence: {},
            },
          ],
          updates: [],
        }),
      ),
    ).toThrow(/^invalid memory patch:/u)
  })
})
