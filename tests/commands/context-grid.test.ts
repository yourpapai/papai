// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ContextSnapshot } from '../../src/chat/types.js'
import { buildContextGrid, GRID_COLS, GRID_ROWS, SECTION_EMOJIS } from '../../src/commands/context-grid.js'

const baseSnapshot = (overrides: Partial<ContextSnapshot> = {}): ContextSnapshot => ({
  modelName: 'gpt-4o',
  totalTokens: 0,
  maxTokens: 128_000,
  approximate: false,
  sections: [],
  ...overrides,
})

describe('buildContextGrid', () => {
  test('returns a string with GRID_ROWS lines of GRID_COLS cells when maxTokens is known', () => {
    const snapshot = baseSnapshot({
      totalTokens: 1_000,
      sections: [{ label: 'System prompt', tokens: 1_000 }],
    })
    const grid = buildContextGrid(snapshot)
    const lines = grid.split('\n')
    expect(lines).toHaveLength(GRID_ROWS)
    for (const line of lines) {
      expect(Array.from(line)).toHaveLength(GRID_COLS)
    }
  })

  test('assigns one cell per section when tokens are tiny', () => {
    const snapshot = baseSnapshot({
      totalTokens: 4,
      maxTokens: 128_000,
      sections: [
        { label: 'System prompt', tokens: 1 },
        { label: 'Memory context', tokens: 1 },
        { label: 'Conversation history', tokens: 1 },
        { label: 'Tools', tokens: 1 },
      ],
    })
    const grid = buildContextGrid(snapshot)
    expect(grid).toContain('🟦')
    expect(grid).toContain('🟩')
    expect(grid).toContain('🟨')
    expect(grid).toContain('🟪')
    expect(grid).toContain('⬜')
  })

  test('fills the grid proportionally when usage is substantial', () => {
    const snapshot = baseSnapshot({
      totalTokens: 64_000,
      sections: [{ label: 'System prompt', tokens: 64_000 }],
    })
    const grid = buildContextGrid(snapshot)
    const usedCells = Array.from(grid).filter((c) => c === '🟦').length
    expect(usedCells).toBeGreaterThanOrEqual(99)
    expect(usedCells).toBeLessThanOrEqual(101)
  })

  test('renders a single 20-cell row when maxTokens is null', () => {
    const snapshot = baseSnapshot({
      maxTokens: null,
      totalTokens: 400,
      sections: [
        { label: 'System prompt', tokens: 200 },
        { label: 'Tools', tokens: 200 },
      ],
    })
    const grid = buildContextGrid(snapshot)
    expect(grid.split('\n')).toHaveLength(1)
    expect(Array.from(grid)).toHaveLength(GRID_COLS)
    expect(grid).not.toContain('⬜')
  })

  test('produces an all-free grid when there are no sections', () => {
    const snapshot = baseSnapshot({
      totalTokens: 0,
      sections: [],
    })
    const grid = buildContextGrid(snapshot)
    const cells = Array.from(grid.replace(/\n/gu, ''))
    expect(cells.every((c) => c === '⬜')).toBe(true)
  })

  test('caps oversized usage at full grid', () => {
    const snapshot = baseSnapshot({
      totalTokens: 200_000,
      sections: [{ label: 'System prompt', tokens: 200_000 }],
    })
    const grid = buildContextGrid(snapshot)
    const cells = Array.from(grid.replace(/\n/gu, ''))
    expect(cells.every((c) => c === '🟦')).toBe(true)
  })
})

describe('SECTION_EMOJIS', () => {
  test('contains expected section labels', () => {
    expect(SECTION_EMOJIS['System prompt']).toBe('🟦')
    expect(SECTION_EMOJIS['Memory context']).toBe('🟩')
    expect(SECTION_EMOJIS['Conversation history']).toBe('🟨')
    expect(SECTION_EMOJIS['Tools']).toBe('🟪')
  })

  test('returns undefined for unknown labels', () => {
    expect(SECTION_EMOJIS['Unknown section']).toBeUndefined()
  })
})
