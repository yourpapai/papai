// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Pseudonym } from '../controlled-types.js'
import { buildLexicalFeatures, REPHARSE_MAX_SETS_PER_CONVERSATION, REPHARSE_SET_TTL_MS } from '../intent/rephrase.js'
import type {
  RephraseCoverageLossReason,
  RephrasePairDetection,
  RephrasePriorOutcome,
  RephraseTurnOutcome,
} from '../intent/rephrase.js'
import { attachPriorToLaterSets, matchNewEntryAgainstPriors } from './matching.js'
import type { MatchableBucket, MatchableEntry } from './matching.js'

export interface RephraseCaptureInput {
  readonly actorKey: Pseudonym
  readonly conversationKey: Pseudonym
  readonly turnKey: Pseudonym
  readonly capturedAtMs: number
  readonly text: string
}

export interface RephraseTerminalInput {
  readonly turnKey: Pseudonym
  readonly completedAtMs: number
  readonly outcome: RephraseTurnOutcome
}

export interface RephraseWithdrawInput {
  readonly actorKey: Pseudonym
}

export interface RephraseSetInspection {
  readonly turnKey: Pseudonym
  readonly shingleCount: number
  readonly status: 'pending' | 'unresolved'
  readonly matchedPriorTurnKey: Pseudonym | null
}

export interface RephraseConversationInspection {
  readonly actorKey: Pseudonym
  readonly conversationKey: Pseudonym
  readonly sets: readonly RephraseSetInspection[]
}

export interface RephraseInspection {
  readonly conversations: readonly RephraseConversationInspection[]
  readonly pendingTerminals: readonly Pseudonym[]
}

export interface RephraseStoreDeps {
  readonly nowMs: () => number
  readonly onPairDetected: (pair: RephrasePairDetection) => void
  readonly onCoverageLoss: (reason: RephraseCoverageLossReason) => void
}

export interface HandoffState {
  readonly buckets: Map<string, ConversationBucket>
  readonly turnIndex: Map<Pseudonym, string>
  readonly pendingTerminals: Map<Pseudonym, PendingTerminal>
  readonly deps: RephraseStoreDeps
}

type SetEntry = MatchableEntry

interface ConversationBucket extends MatchableBucket {
  sets: SetEntry[]
}

interface PendingTerminal {
  readonly completedAtMs: number
  readonly outcome: RephraseTurnOutcome
}

const MAX_CONVERSATIONS = 256
const MAX_PENDING_TERMINALS = 256

const bucketKeyOf = (actorKey: Pseudonym, conversationKey: Pseudonym): string => `${actorKey}::${conversationKey}`

const removeEntry = (state: HandoffState, bucket: ConversationBucket, entry: SetEntry): void => {
  bucket.sets = bucket.sets.filter((candidate) => candidate.turnKey !== entry.turnKey)
  state.turnIndex.delete(entry.turnKey)
}

const sweepEmptyBuckets = (state: HandoffState): void => {
  for (const [key, bucket] of state.buckets) {
    if (bucket.sets.length === 0) {
      state.buckets.delete(key)
    }
  }
}

const purgeExpiredSets = (state: HandoffState, bucket: ConversationBucket, nowMs: number): void => {
  const expired = bucket.sets.filter((entry) => nowMs - entry.capturedAtMs >= REPHARSE_SET_TTL_MS)
  for (const entry of expired) {
    removeEntry(state, bucket, entry)
    state.deps.onCoverageLoss('expiry')
  }
}

const purgeExpiredTerminals = (state: HandoffState, nowMs: number): void => {
  for (const [turnKey, terminal] of state.pendingTerminals) {
    if (nowMs - terminal.completedAtMs >= REPHARSE_SET_TTL_MS) {
      state.pendingTerminals.delete(turnKey)
    }
  }
}

const evictOldestBucket = (state: HandoffState): void => {
  const oldestKey = state.buckets.keys().next().value
  if (oldestKey === undefined) {
    return
  }
  const oldest = state.buckets.get(oldestKey)
  if (oldest !== undefined) {
    for (const entry of oldest.sets) {
      state.turnIndex.delete(entry.turnKey)
    }
  }
  state.buckets.delete(oldestKey)
  state.deps.onCoverageLoss('eviction')
}

const getOrCreateBucket = (
  state: HandoffState,
  actorKey: Pseudonym,
  conversationKey: Pseudonym,
): ConversationBucket => {
  const key = bucketKeyOf(actorKey, conversationKey)
  const existing = state.buckets.get(key)
  if (existing !== undefined) {
    state.buckets.delete(key)
    state.buckets.set(key, existing)
    return existing
  }
  const bucket: ConversationBucket = { actorKey, conversationKey, sets: [] }
  state.buckets.set(key, bucket)
  while (state.buckets.size > MAX_CONVERSATIONS) {
    evictOldestBucket(state)
  }
  return bucket
}

const rememberTerminal = (state: HandoffState, input: RephraseTerminalInput): void => {
  if (state.pendingTerminals.has(input.turnKey)) {
    return
  }
  state.pendingTerminals.set(input.turnKey, { completedAtMs: input.completedAtMs, outcome: input.outcome })
  while (state.pendingTerminals.size > MAX_PENDING_TERMINALS) {
    const oldestKey = state.pendingTerminals.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    state.pendingTerminals.delete(oldestKey)
  }
}

const consumeMarker = (state: HandoffState, turnKey: Pseudonym): RephrasePriorOutcome | null | 'resolved' => {
  const marker = state.pendingTerminals.get(turnKey)
  if (marker === undefined) {
    return null
  }
  state.pendingTerminals.delete(turnKey)
  if (marker.outcome === 'discard' || marker.outcome === 'success') {
    return 'resolved'
  }
  return marker.outcome
}

export const captureTextImpl = (state: HandoffState, input: RephraseCaptureInput): void => {
  const features = buildLexicalFeatures(input.text)
  const nowMs = state.deps.nowMs()
  purgeExpiredTerminals(state, nowMs)
  const bucket = getOrCreateBucket(state, input.actorKey, input.conversationKey)
  purgeExpiredSets(state, bucket, nowMs)
  const markerOutcome = consumeMarker(state, input.turnKey)
  if (markerOutcome === 'resolved') {
    sweepEmptyBuckets(state)
    return
  }
  const oldest = bucket.sets[0]
  if (bucket.sets.length >= REPHARSE_MAX_SETS_PER_CONVERSATION && oldest !== undefined) {
    removeEntry(state, bucket, oldest)
    state.deps.onCoverageLoss('eviction')
  }
  const entry: SetEntry = {
    turnKey: input.turnKey,
    capturedAtMs: input.capturedAtMs,
    features,
    status: markerOutcome === null ? 'pending' : 'unresolved',
    outcome: markerOutcome,
    matchedPriorTurnKey: null,
  }
  bucket.sets.push(entry)
  state.turnIndex.set(entry.turnKey, bucketKeyOf(input.actorKey, input.conversationKey))
  matchNewEntryAgainstPriors(state.deps.onPairDetected, bucket, entry)
}

const findEntry = (state: HandoffState, turnKey: Pseudonym): { bucket: ConversationBucket; entry: SetEntry } | null => {
  const key = state.turnIndex.get(turnKey)
  const bucket = key === undefined ? undefined : state.buckets.get(key)
  const entry = bucket === undefined ? undefined : bucket.sets.find((candidate) => candidate.turnKey === turnKey)
  if (bucket === undefined || entry === undefined) {
    return null
  }
  return { bucket, entry }
}

const resolveSuccess = (state: HandoffState, bucket: ConversationBucket, entry: SetEntry): void => {
  const matchedPrior = entry.matchedPriorTurnKey
  removeEntry(state, bucket, entry)
  if (matchedPrior === null) {
    return
  }
  const prior = bucket.sets.find((candidate) => candidate.turnKey === matchedPrior)
  if (prior !== undefined) {
    removeEntry(state, bucket, prior)
  }
}

export const completeTurnImpl = (state: HandoffState, input: RephraseTerminalInput): void => {
  purgeExpiredTerminals(state, state.deps.nowMs())
  if (state.pendingTerminals.has(input.turnKey)) {
    return
  }
  const located = findEntry(state, input.turnKey)
  rememberTerminal(state, input)
  if (located === null) {
    return
  }
  const { bucket, entry } = located
  if (input.outcome === 'success') {
    resolveSuccess(state, bucket, entry)
    sweepEmptyBuckets(state)
    return
  }
  if (input.outcome === 'discard') {
    removeEntry(state, bucket, entry)
    sweepEmptyBuckets(state)
    return
  }
  entry.status = 'unresolved'
  entry.outcome = input.outcome
  attachPriorToLaterSets(state.deps.onPairDetected, bucket, entry)
}

export const withdrawImpl = (state: HandoffState, input: RephraseWithdrawInput): void => {
  for (const [key, bucket] of state.buckets) {
    if (bucket.actorKey !== input.actorKey) {
      continue
    }
    for (const entry of bucket.sets) {
      state.turnIndex.delete(entry.turnKey)
    }
    state.buckets.delete(key)
  }
}

export const inspectImpl = (state: HandoffState): RephraseInspection => ({
  conversations: [...state.buckets.values()].map((bucket) => ({
    actorKey: bucket.actorKey,
    conversationKey: bucket.conversationKey,
    sets: bucket.sets.map((entry) => ({
      turnKey: entry.turnKey,
      shingleCount: entry.features.shingleHashes.size,
      status: entry.status,
      matchedPriorTurnKey: entry.matchedPriorTurnKey,
    })),
  })),
  pendingTerminals: [...state.pendingTerminals.keys()],
})

export const disposeImpl = (state: HandoffState): void => {
  let remaining = 0
  for (const bucket of state.buckets.values()) {
    remaining += bucket.sets.length
  }
  if (remaining > 0) {
    state.deps.onCoverageLoss('shutdown')
  }
  state.buckets.clear()
  state.turnIndex.clear()
  state.pendingTerminals.clear()
}

export const createHandoffState = (deps: RephraseStoreDeps): HandoffState => ({
  buckets: new Map(),
  turnIndex: new Map(),
  pendingTerminals: new Map(),
  deps,
})
