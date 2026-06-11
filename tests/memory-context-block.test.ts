// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildMemoryContextMessage } from '../src/memory-context-block.js'
import type { MemoryFact } from '../src/types/memory.js'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-06-11T00:00:00Z')
const daysAgo = (n: number): string => new Date(NOW - n * DAY).toISOString()

const fact = (overrides: Partial<MemoryFact> = {}): MemoryFact => ({
  identifier: '#42',
  title: 'Ship password reset',
  url: '',
  last_seen: daysAgo(1),
  ...overrides,
})

describe('buildMemoryContextMessage', () => {
  test('returns null when both summary and facts are empty', () => {
    expect(buildMemoryContextMessage(null, [], NOW)).toBeNull()
    expect(buildMemoryContextMessage('', [], NOW)).toBeNull()
  })

  test('wraps the block in a low-trust memory label with guidance', () => {
    const result = buildMemoryContextMessage('A recap', [], NOW)
    expect(result).not.toBeNull()
    expect(result!.role).toBe('system')
    expect(result!.content).toContain('<memory trust="compacted_low">')
    expect(result!.content).toContain('lower-trust than the current user message')
    expect(result!.content).toContain('<summary>\nA recap\n</summary>')
  })

  test('renders fresh entities without a stale marker', () => {
    const result = buildMemoryContextMessage(null, [fact({ last_seen: daysAgo(2) })], NOW)
    expect(result!.content).toContain('<recent_entities>')
    expect(result!.content).toContain('#42')
    expect(result!.content).toContain('Ship password reset')
    expect(result!.content).not.toContain(', stale)')
  })

  test('flags entities older than 14 days as stale', () => {
    const result = buildMemoryContextMessage(null, [fact({ last_seen: daysAgo(20) })], NOW)
    expect(result!.content).toContain(', stale)')
  })

  test('evicts entities older than 45 days entirely', () => {
    const result = buildMemoryContextMessage(null, [fact({ identifier: '#old', last_seen: daysAgo(60) })], NOW)
    expect(result).toBeNull()
  })

  test('renders at most 10 entities, most recent first', () => {
    const facts = Array.from({ length: 15 }, (_, i) => fact({ identifier: `#${i}`, last_seen: daysAgo(i + 1) }))
    const result = buildMemoryContextMessage(null, facts, NOW)
    const lines = result!.content.split('\n').filter((l) => l.startsWith('- '))
    expect(lines).toHaveLength(10)
    expect(lines[0]).toContain('#0')
    expect(result!.content).not.toContain('#12')
  })

  test('formats last_seen as YYYY-MM-DD', () => {
    const result = buildMemoryContextMessage(null, [fact({ last_seen: '2026-06-09T14:30:00.000Z' })], NOW)
    expect(result!.content).toContain('2026-06-09')
    expect(result!.content).not.toContain('T14:30')
  })
})
