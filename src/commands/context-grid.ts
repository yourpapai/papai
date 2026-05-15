// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextSection, ContextSnapshot } from '../chat/types.js'

export const GRID_COLS = 20
export const GRID_ROWS = 10
const TOTAL_CELLS = GRID_COLS * GRID_ROWS

const FREE_CELL = '⬜'

/** Section emoji mapping - exported for use by renderers to avoid duplication. */
export const SECTION_EMOJIS: Readonly<Record<string, string>> = {
  'System prompt': '🟦',
  'Memory context': '🟩',
  'Conversation history': '🟨',
  Tools: '🟪',
}

const FALLBACK_EMOJI = '🟫'

const emojiForLabel = (label: string): string => SECTION_EMOJIS[label] ?? FALLBACK_EMOJI

type Allocation = { emoji: string; cells: number }

const allocateCells = (
  sections: readonly ContextSection[],
  cellBudget: number,
  tokensPerCell: number,
): Allocation[] => {
  if (tokensPerCell <= 0) return []

  const allocations: Allocation[] = []
  let assigned = 0
  for (const section of sections) {
    if (section.tokens <= 0) continue
    const rawCells = section.tokens / tokensPerCell
    const cells = Math.max(1, Math.round(rawCells))
    allocations.push({ emoji: emojiForLabel(section.label), cells })
    assigned += cells
  }

  while (assigned > cellBudget) {
    let largestIndex = -1
    let largestCells = 1
    for (let i = 0; i < allocations.length; i++) {
      const entry = allocations[i]
      if (entry !== undefined && entry.cells > largestCells) {
        largestCells = entry.cells
        largestIndex = i
      }
    }
    if (largestIndex === -1) break
    const entry = allocations[largestIndex]
    if (entry !== undefined) {
      entry.cells -= 1
      assigned -= 1
    }
  }

  return allocations
}

const assembleCells = (allocations: readonly Allocation[], totalCells: number, fillFree: boolean): string[] => {
  const cells: string[] = []
  for (const entry of allocations) {
    for (let i = 0; i < entry.cells; i++) cells.push(entry.emoji)
  }
  if (fillFree) {
    while (cells.length < totalCells) cells.push(FREE_CELL)
  }
  return cells.slice(0, totalCells)
}

const gridToString = (cells: readonly string[], cols: number): string => {
  const rows: string[] = []
  for (let i = 0; i < cells.length; i += cols) {
    rows.push(cells.slice(i, i + cols).join(''))
  }
  return rows.join('\n')
}

export const buildContextGrid = (snapshot: ContextSnapshot): string => {
  if (snapshot.maxTokens === null) {
    const used = Math.max(snapshot.totalTokens, 1)
    const tokensPerCell = used / GRID_COLS
    const allocations = allocateCells(snapshot.sections, GRID_COLS, tokensPerCell)
    const cells = assembleCells(allocations, GRID_COLS, false)
    while (cells.length < GRID_COLS) cells.push(FALLBACK_EMOJI)
    return gridToString(cells, GRID_COLS)
  }

  const tokensPerCell = snapshot.maxTokens / TOTAL_CELLS
  const usedCells = Math.min(TOTAL_CELLS, Math.round(snapshot.totalTokens / tokensPerCell))
  const allocations = allocateCells(snapshot.sections, usedCells, tokensPerCell)
  const cells = assembleCells(allocations, TOTAL_CELLS, true)
  return gridToString(cells, GRID_COLS)
}
