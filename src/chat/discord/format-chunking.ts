// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// Length of fence markers for chunk budget calculations
// FENCE_CLOSE_LEN represents the length of newline + three backticks
const FENCE_CLOSE_LEN = 4
// FENCE_OPEN_LEN represents the length of three backticks + newline
const FENCE_OPEN_LEN = 4

/**
 * Split a string into chunks no longer than `maxLen`, preferring to split
 * on paragraph breaks, then sentence breaks, then word breaks. If a fenced
 * code block would be split, emit a synthetic closing and reopening fence
 * so each chunk remains syntactically balanced.
 */
export function chunkForDiscord(input: string, maxLen: number): string[] {
  if (input.length <= maxLen) return [input]

  const chunks: string[] = []
  let remainder = input
  let carriedOpenFence = false
  let carriedLanguage: string | null = null

  while (remainder.length > maxLen) {
    // Reserve space for fence operations:
    // - Opening fence from previous chunk (if carriedOpenFence)
    // - Potential closing fence for this chunk (we must reserve for worst case)
    let budget = maxLen - FENCE_CLOSE_LEN
    if (carriedOpenFence) {
      budget = budget - FENCE_OPEN_LEN - (carriedLanguage?.length ?? 0)
    }
    const sliceEnd = findSplitPoint(remainder, budget)
    let chunk = remainder.slice(0, sliceEnd)
    remainder = remainder.slice(sliceEnd)

    if (carriedOpenFence) {
      chunk = (carriedLanguage === null ? '```\n' : '```' + carriedLanguage + '\n') + chunk
      carriedOpenFence = false
      carriedLanguage = null
    }

    const fenceMatch = chunk.match(/```(\w+)?/gu)
    const fenceCount = fenceMatch?.length ?? 0
    if (fenceCount % 2 === 1) {
      // Extract language tag from opening fence if present
      const lastFence = fenceMatch![fenceMatch!.length - 1]
      const langMatch = lastFence!.match(/```(\w+)/u)
      carriedLanguage = langMatch?.[1] ?? null
      chunk = chunk + '\n```'
      carriedOpenFence = true
    }

    chunks.push(chunk)
  }

  if (remainder.length > 0) {
    let tail = remainder
    if (carriedOpenFence) {
      tail = (carriedLanguage === null ? '```\n' : '```' + carriedLanguage + '\n') + tail
    }
    chunks.push(tail)
  }

  return chunks
}

function findSplitPoint(text: string, maxLen: number): number {
  if (text.length <= maxLen) return text.length

  const paragraph = text.lastIndexOf('\n\n', maxLen)
  if (paragraph > 0) return paragraph + 2

  const newline = text.lastIndexOf('\n', maxLen)
  if (newline > 0) return newline + 1

  for (let i = maxLen; i > maxLen / 2; i--) {
    const ch = text[i]
    if (ch === '.' || ch === '!' || ch === '?') return i + 1
  }

  const ws = text.lastIndexOf(' ', maxLen)
  if (ws > 0) return ws + 1

  return maxLen
}
