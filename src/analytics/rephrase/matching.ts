// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Pseudonym } from '../controlled-types.js'
import { gapBucketFor, lexicalSimilarity, REPHARSE_COMPARE_WINDOW_MS, similarityBucketFor } from '../intent/rephrase.js'
import type { LexicalFeatureSet, RephrasePairDetection, RephrasePriorOutcome } from '../intent/rephrase.js'

export interface MatchableEntry {
  readonly turnKey: Pseudonym
  readonly capturedAtMs: number
  readonly features: LexicalFeatureSet
  status: 'pending' | 'unresolved'
  outcome: RephrasePriorOutcome | null
  matchedPriorTurnKey: Pseudonym | null
}

export interface MatchableBucket {
  readonly actorKey: Pseudonym
  readonly conversationKey: Pseudonym
  readonly sets: MatchableEntry[]
}

export type RephrasePairSink = (pair: RephrasePairDetection) => void

const emitPairIfQualifies = (
  onPair: RephrasePairSink,
  bucket: MatchableBucket,
  prior: MatchableEntry,
  later: MatchableEntry,
): boolean => {
  if (prior.outcome === null || later.matchedPriorTurnKey !== null) {
    return false
  }
  const gap = gapBucketFor(later.capturedAtMs - prior.capturedAtMs)
  if (gap === null) {
    return false
  }
  const similarity = similarityBucketFor(lexicalSimilarity(prior.features, later.features))
  if (similarity === null) {
    return false
  }
  later.matchedPriorTurnKey = prior.turnKey
  onPair({
    detector: 'lexical_v1',
    similarity,
    priorOutcome: prior.outcome,
    gap,
    actorKey: bucket.actorKey,
    conversationKey: bucket.conversationKey,
    priorTurnKey: prior.turnKey,
    laterTurnKey: later.turnKey,
  })
  return true
}

export const matchNewEntryAgainstPriors = (
  onPair: RephrasePairSink,
  bucket: MatchableBucket,
  entry: MatchableEntry,
): void => {
  for (let index = bucket.sets.length - 1; index >= 0; index -= 1) {
    const prior = bucket.sets[index]
    if (prior === undefined || prior.turnKey === entry.turnKey) {
      continue
    }
    if (prior.status !== 'unresolved') {
      continue
    }
    const gapMs = entry.capturedAtMs - prior.capturedAtMs
    if (gapMs > REPHARSE_COMPARE_WINDOW_MS) {
      return
    }
    if (gapMs < 0) {
      continue
    }
    if (emitPairIfQualifies(onPair, bucket, prior, entry)) {
      return
    }
  }
}

export const attachPriorToLaterSets = (
  onPair: RephrasePairSink,
  bucket: MatchableBucket,
  prior: MatchableEntry,
): void => {
  for (let index = bucket.sets.length - 1; index >= 0; index -= 1) {
    const later = bucket.sets[index]
    if (later === undefined || later.capturedAtMs <= prior.capturedAtMs) {
      continue
    }
    if (emitPairIfQualifies(onPair, bucket, prior, later)) {
      return
    }
  }
}
