// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildExtractionPrompt, parseMemoryPatch } from '../../src/long-term-memory/extractor.js'
import { MemoryKindSchema } from '../../src/long-term-memory/types.js'

const validRecord = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'fact',
  content: 'A remembered fact.',
  summary: null,
  tags: [],
  confidence: 0.8,
  source: 'background',
  evidence: {},
  ...overrides,
})

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
    expect(patch.records[0]?.evidence.timestamps).toEqual(['2026-06-12T00:00:00.000Z'])
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

  test('drops records with an invalid kind but keeps valid ones', () => {
    const patch = parseMemoryPatch(
      JSON.stringify({
        profile: null,
        records: [
          validRecord({ kind: 'project context', content: 'Spaced kind from the model.' }),
          validRecord({ kind: 'goal', content: 'Synonym kind from the model.' }),
          validRecord({ kind: 'fact', content: 'A valid fact.' }),
        ],
        updates: [],
      }),
    )

    expect(patch.records).toHaveLength(1)
    expect(patch.records[0]?.kind).toBe('fact')
    expect(patch.records[0]?.content).toBe('A valid fact.')
  })

  test('drops records with confidence outside the valid range but keeps valid ones', () => {
    const patch = parseMemoryPatch(
      JSON.stringify({
        profile: null,
        records: [validRecord({ confidence: 1.2 }), validRecord({ content: 'A valid fact.' })],
        updates: [],
      }),
    )

    expect(patch.records).toHaveLength(1)
    expect(patch.records[0]?.content).toBe('A valid fact.')
  })

  test('drops records with a privileged source', () => {
    const patch = parseMemoryPatch(
      JSON.stringify({
        profile: null,
        records: [validRecord({ source: 'explicit' }), validRecord({ content: 'A valid fact.' })],
        updates: [],
      }),
    )

    expect(patch.records).toHaveLength(1)
    expect(patch.records[0]?.content).toBe('A valid fact.')
  })

  test('drops records with non-ISO timestamps', () => {
    const patch = parseMemoryPatch(
      JSON.stringify({
        profile: null,
        records: [validRecord({ expiresAt: 'tomorrow' }), validRecord({ content: 'A valid fact.' })],
        updates: [],
      }),
    )

    expect(patch.records).toHaveLength(1)
    expect(patch.records[0]?.content).toBe('A valid fact.')
  })

  test('drops an oversized profile but keeps records', () => {
    const patch = parseMemoryPatch(
      JSON.stringify({
        profile: 'x'.repeat(4_001),
        records: [validRecord({ content: 'A valid fact.' })],
        updates: [],
      }),
    )

    expect(patch.profile).toBeNull()
    expect(patch.records).toHaveLength(1)
  })

  test('caps records at the maximum instead of rejecting the patch', () => {
    const patch = parseMemoryPatch(
      JSON.stringify({
        profile: null,
        records: Array.from({ length: 21 }, () => validRecord()),
        updates: [],
      }),
    )

    expect(patch.records).toHaveLength(20)
  })

  test('drops invalid updates but keeps valid ones', () => {
    const patch = parseMemoryPatch(
      JSON.stringify({
        profile: null,
        records: [],
        updates: [
          { id: '', status: 'stale' },
          { id: 'mem-1', status: 'archived' },
        ],
      }),
    )

    expect(patch.updates).toEqual([{ id: 'mem-1', status: 'archived' }])
  })
})

describe('buildExtractionPrompt', () => {
  test('instructs the model with the exact memory kind enum values', () => {
    const prompt = buildExtractionPrompt({ history: [], profile: null, records: [] })

    for (const kind of MemoryKindSchema.options) {
      expect(prompt).toContain(kind)
    }
    expect(prompt).toContain('snake_case')
  })
})
