// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Pseudonym } from '../controlled-types.js'

export const REPHARSE_SET_TTL_MS = 1_800_000
export const REPHARSE_COMPARE_WINDOW_MS = 600_000
export const REPHARSE_MAX_SETS_PER_CONVERSATION = 3

export type RephraseTurnOutcome = 'clarification' | 'failure' | 'no_action' | 'success' | 'discard'
export type RephrasePriorOutcome = 'clarification' | 'failure' | 'no_action'
export type RephraseSimilarityBucket = '080_089' | '090_094' | 'ge_095'
export type RephraseGapBucket = 'le_2m' | '2m_10m'
export type RephraseCoverageLossReason = 'eviction' | 'expiry' | 'shutdown'

export interface LexicalFeatureSet {
  readonly tokenCount: number
  readonly shingleHashes: ReadonlySet<number>
}

export interface RephrasePairDetection {
  readonly detector: 'lexical_v1'
  readonly similarity: RephraseSimilarityBucket
  readonly priorOutcome: RephrasePriorOutcome
  readonly gap: RephraseGapBucket
  readonly actorKey: Pseudonym
  readonly conversationKey: Pseudonym
  readonly priorTurnKey: Pseudonym
  readonly laterTurnKey: Pseudonym
}

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu
const SHINGLE_SIZE = 3
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

const fnv1a = (value: string): number => {
  let hash = FNV_OFFSET
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

const shingle = (tokens: readonly string[], start: number): string =>
  `${tokens[start] ?? ''} ${tokens[start + 1] ?? ''} ${tokens[start + 2] ?? ''}`

export const buildLexicalFeatures = (text: string): LexicalFeatureSet => {
  const tokens = text.toLowerCase().match(TOKEN_PATTERN) ?? []
  const hashes = new Set<number>()
  if (tokens.length > 0 && tokens.length <= SHINGLE_SIZE) {
    hashes.add(fnv1a(tokens.join(' ')))
  }
  for (let start = 0; start + SHINGLE_SIZE <= tokens.length; start += 1) {
    hashes.add(fnv1a(shingle(tokens, start)))
  }
  return { tokenCount: tokens.length, shingleHashes: hashes }
}

export const lexicalSimilarity = (left: LexicalFeatureSet, right: LexicalFeatureSet): number => {
  if (left.shingleHashes.size === 0 || right.shingleHashes.size === 0) {
    return 0
  }
  let intersection = 0
  for (const hash of left.shingleHashes) {
    if (right.shingleHashes.has(hash)) {
      intersection += 1
    }
  }
  const union = left.shingleHashes.size + right.shingleHashes.size - intersection
  return union === 0 ? 0 : intersection / union
}

export const similarityBucketFor = (similarity: number): RephraseSimilarityBucket | null => {
  if (similarity < 0.8) {
    return null
  }
  if (similarity < 0.9) {
    return '080_089'
  }
  if (similarity < 0.95) {
    return '090_094'
  }
  return 'ge_095'
}

export const gapBucketFor = (gapMs: number): RephraseGapBucket | null => {
  if (gapMs < 0 || gapMs > REPHARSE_COMPARE_WINDOW_MS) {
    return null
  }
  return gapMs < 120_000 ? 'le_2m' : '2m_10m'
}

export const isWithinCompareWindow = (gapMs: number): boolean => gapMs >= 0 && gapMs <= REPHARSE_COMPARE_WINDOW_MS
