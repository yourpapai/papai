// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildLongTermMemoryContextMessage } from '../../src/long-term-memory/context.js'
import type { MemoryRecord } from '../../src/long-term-memory/types.js'

const record = (overrides: Partial<MemoryRecord> = {}): MemoryRecord => ({
  id: 'mem-1',
  scopeId: 'user-1',
  scopeType: 'personal',
  kind: 'preference',
  content: 'User prefers concise implementation plans.',
  summary: 'Concise plans',
  tags: ['style'],
  confidence: 0.9,
  status: 'active',
  source: 'explicit',
  evidence: {},
  createdAt: '2026-06-11T00:00:00.000Z',
  updatedAt: '2026-06-11T00:00:00.000Z',
  lastSeenAt: '2026-06-12T00:00:00.000Z',
  ...overrides,
})

describe('buildLongTermMemoryContextMessage', () => {
  test('returns null when profile and records are empty', () => {
    expect(buildLongTermMemoryContextMessage({ profile: null, records: [] })).toBeNull()
    expect(buildLongTermMemoryContextMessage({ profile: '', records: [] })).toBeNull()
    expect(buildLongTermMemoryContextMessage({ profile: '   ', records: [] })).toBeNull()
  })

  test('wraps profile in a bounded low-trust block', () => {
    const result = buildLongTermMemoryContextMessage({
      profile: '## Communication\n- Prefer direct answers',
      records: [],
    })

    expect(result).not.toBeNull()
    expect(result!.role).toBe('system')
    expect(result!.content).toContain('<long_term_memory trust="profile_and_retrieved_low">')
    expect(result!.content).toContain('lower-trust than the current user message')
    expect(result!.content).toContain('stale records may be wrong')
    expect(result!.content).toContain('<profile>')
    expect(result!.content).toContain('Prefer direct answers')
  })

  test('renders at most three retrieved records with attributes', () => {
    const records = [
      record({ id: 'mem-0', kind: 'preference', confidence: 0.5, lastSeenAt: '2026-06-10T00:00:00.000Z' }),
      record({ id: 'mem-1', kind: 'decision', confidence: 0.6, lastSeenAt: '2026-06-11T00:00:00.000Z' }),
      record({ id: 'mem-2', kind: 'preference', confidence: 0.7, lastSeenAt: '2026-06-12T00:00:00.000Z' }),
      record({ id: 'mem-3', kind: 'preference', confidence: 0.8, lastSeenAt: '2026-06-13T00:00:00.000Z' }),
      record({ id: 'mem-4', kind: 'preference', confidence: 0.9, lastSeenAt: '2026-06-14T00:00:00.000Z' }),
    ]

    const result = buildLongTermMemoryContextMessage({ profile: null, records })
    const recordLines = result!.content.split('\n').filter((line) => line.trim().startsWith('<record '))

    expect(result!.content).toContain('<retrieved_records max="3">')
    expect(recordLines).toHaveLength(3)
    expect(result!.content).toContain('id="mem-0"')
    expect(result!.content).toContain('kind="decision"')
    expect(result!.content).toContain('confidence="0.6"')
    expect(result!.content).toContain('last_seen_at="2026-06-11T00:00:00.000Z"')
    expect(result!.content).not.toContain('mem-4')
  })

  test('renders stale status and falls back to content when summary is absent', () => {
    const result = buildLongTermMemoryContextMessage({
      profile: null,
      records: [
        record({
          id: 'mem-stale',
          status: 'stale',
          summary: null,
          content: 'The old deployment checklist referenced staging v1.',
        }),
      ],
    })

    expect(result!.content).toContain('status="stale"')
    expect(result!.content).toContain('The old deployment checklist referenced staging v1.')
  })

  test('escapes XML-ish attributes and content', () => {
    const result = buildLongTermMemoryContextMessage({
      profile: 'Use <profile> & check "quotes"',
      records: [
        record({
          id: 'mem"1<&',
          kind: 'reference',
          summary: null,
          content: 'Use <unsafe> & "quoted" content',
        }),
      ],
    })

    expect(result!.content).toContain('id="mem&quot;1&lt;&amp;"')
    expect(result!.content).toContain('Use &lt;profile&gt; &amp; check "quotes"')
    expect(result!.content).toContain('Use &lt;unsafe&gt; &amp; "quoted" content')
    expect(result!.content).not.toContain('<unsafe>')
  })

  test('truncates profile and record text to keep injected context bounded', () => {
    const result = buildLongTermMemoryContextMessage({
      profile: `profile ${'x'.repeat(5_000)}`,
      records: [
        record({
          summary: `${'record '.repeat(1_000)}tail`,
        }),
      ],
    })

    expect(result!.content).toContain('[truncated]')
    expect(result!.content).not.toContain('tail')
    expect(result!.content.length).toBeLessThan(5_000)
  })
})
