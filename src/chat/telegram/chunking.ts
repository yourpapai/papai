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
 * index the chunk text verbatim. A `maxLen` below 1 is clamped to 1.
 */
export function chunkForTelegram(text: string, maxLen: number = telegramTraits.maxMessageLength!): string[] {
  const limit = Math.max(1, maxLen)
  if (text.length <= limit) return [text]

  const chunks: string[] = []
  let remainder = text
  while (remainder.length > limit) {
    const sliceEnd = findSplitPoint(remainder, limit)
    chunks.push(remainder.slice(0, sliceEnd))
    remainder = remainder.slice(sliceEnd)
  }
  if (remainder.length > 0) chunks.push(remainder)
  return chunks
}

/**
 * Window the entities of a formatted text onto one chunk: entities fully inside
 * the `[chunkStart, chunkEnd)` window shift by the window start; entities
 * spanning the cut are dropped (Telegram cannot represent an entity across two
 * messages). Entity offsets are relative to the chunk text afterwards.
 */
export function sliceTelegramEntities<TEntity extends { offset: number; length: number }>(
  entities: readonly TEntity[],
  chunkStart: number,
  chunkEnd: number,
): TEntity[] {
  return entities
    .filter((entity) => entity.offset >= chunkStart && entity.offset + entity.length <= chunkEnd)
    .map((entity) => ({ ...entity, offset: entity.offset - chunkStart }))
}
