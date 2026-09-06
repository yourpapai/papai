// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { telegramTraits } from './metadata.js'

function findSplitPoint(text: string, maxLen: number): number {
  // A boundary sitting exactly at the budget edge would push the split past
  // maxLen once its terminator is included, so the searches stop one and two
  // characters short respectively.
  const paragraph = text.lastIndexOf('\n\n', maxLen - 2)
  if (paragraph > 0) return paragraph + 2

  const newline = text.lastIndexOf('\n', maxLen - 1)
  if (newline > 0) return newline + 1

  return maxLen
}

/**
 * Split a string into chunks no longer than `maxLen` (default: the Telegram
 * `maxMessageLength` trait), preferring paragraph boundaries (blank lines),
 * then single newlines, then a hard cut. The split always advances — the hard
 * cut is the floor — so an oversize single line cannot loop. Chunks join back
 * to the exact input (no trimming, no fence healing): per-chunk entity offsets
 * index the chunk text verbatim.
 */
export function chunkForTelegram(text: string, maxLen: number = telegramTraits.maxMessageLength!): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remainder = text
  while (remainder.length > maxLen) {
    const sliceEnd = findSplitPoint(remainder, maxLen)
    chunks.push(remainder.slice(0, sliceEnd))
    remainder = remainder.slice(sliceEnd)
  }
  if (remainder.length > 0) chunks.push(remainder)
  return chunks
}
