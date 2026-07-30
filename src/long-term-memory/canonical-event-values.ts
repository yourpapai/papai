// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { memoryCanonicalEvents } from '../db/schema.js'
import {
  CANONICAL_SCHEMA_VERSION,
  CAPTURE_VERSION,
  type CanonicalPayload,
  type CanonicalProvenance,
  contentIdentity,
} from './canonical-identity.js'
import type { MemoryRecordInput } from './types.js'

const parsed = (iso: string): number | undefined => {
  const millis = Date.parse(iso)
  return Number.isNaN(millis) ? undefined : millis
}

/** The later of two instants. An unparsable candidate never wins, so the stored value cannot regress. */
export const laterIso = (a: string, b: string): string => {
  const left = parsed(a)
  const right = parsed(b)
  if (right === undefined) return a
  if (left === undefined) return b
  return right > left ? b : a
}

/**
 * When the evidence occurred, not when it was ingested and not when the claim became valid.
 *
 * Deliberately not `validFrom`: validity is a claim about the fact, while event time is when
 * the evidence occurred, and only the latter makes "ingest order reversed relative to event
 * time" a meaningful condition to test.
 */
export const deriveEventTime = (input: MemoryRecordInput): string => {
  const timestamps = input.evidence.timestamps ?? []
  const latest = timestamps
    .filter((stamp) => parsed(stamp) !== undefined)
    .reduce<string | null>((best, stamp) => (best === null ? stamp : laterIso(best, stamp)), null)
  return latest ?? input.createdAt
}

const toProvenance = (input: MemoryRecordInput): CanonicalProvenance => ({
  messageIds: input.evidence.messageIds ?? [],
  threads: input.evidence.threads ?? [],
  contextId: input.evidence.contextId ?? null,
})

/** The identity-bearing view of one capture. Absent fields normalize to `[]` or `null`, never `undefined`. */
export const toCanonicalPayload = (input: MemoryRecordInput): CanonicalPayload => ({
  scopeType: input.scopeType,
  scopeId: input.scopeId,
  threadContextId: input.threadContextId ?? null,
  kind: input.kind,
  content: input.content,
  summary: input.summary,
  tags: input.tags,
  confidence: input.confidence,
  source: input.source,
  actorIds: input.evidence.actorIds ?? [],
  provenance: toProvenance(input),
  eventTime: deriveEventTime(input),
  validFrom: input.validFrom ?? null,
  validUntil: input.validUntil ?? null,
  expiresAt: input.expiresAt ?? null,
})

export const toEventValues = (
  args: Readonly<{
    eventId: string
    identity: string
    payload: CanonicalPayload
    input: MemoryRecordInput
    ingestTime: string
    recordId: string | null
  }>,
): typeof memoryCanonicalEvents.$inferInsert =>
  ({
    eventId: args.eventId,
    idempotencyIdentity: args.identity,
    contentIdentity: contentIdentity(args.payload),
    scopeId: args.payload.scopeId,
    scopeType: args.payload.scopeType,
    threadContextId: args.payload.threadContextId,
    kind: args.payload.kind,
    content: args.payload.content,
    summary: args.payload.summary,
    tags: JSON.stringify(args.payload.tags),
    confidence: args.payload.confidence,
    source: args.payload.source,
    actorIds: JSON.stringify(args.payload.actorIds),
    provenance: JSON.stringify(args.payload.provenance),
    eventTime: args.payload.eventTime,
    ingestTime: args.ingestTime,
    // A fresh event has been observed exactly once, at its own event time.
    lastObservedAt: args.payload.eventTime,
    validFrom: args.payload.validFrom,
    validUntil: args.payload.validUntil,
    expiresAt: args.payload.expiresAt,
    // Supersession is resolved by 1b's projection, not at capture time.
    supersedes: null,
    recordId: args.recordId,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    captureVersion: CAPTURE_VERSION,
  }) satisfies typeof memoryCanonicalEvents.$inferInsert
