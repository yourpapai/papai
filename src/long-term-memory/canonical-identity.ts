// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import { contentHash } from './tombstone.js'
import type { MemoryScope, MemoryScopeType } from './types.js'

/**
 * Which derivation rule produced an identity. Bump this whenever `normalizeForHash`, the
 * field list, or the join changes, so an identity written under the old rule stays
 * attributable instead of being silently reinterpreted.
 */
export const CAPTURE_VERSION = 'v1'

/** Shape version of a canonical event row. */
export const CANONICAL_SCHEMA_VERSION = 1

export type CanonicalProvenance = Readonly<{
  messageIds: readonly string[]
  threads: readonly string[]
  contextId: string | null
}>

/** The identity-bearing view of a capture. Everything here participates in `contentIdentity`. */
export type CanonicalPayload = Readonly<{
  scopeType: MemoryScopeType
  scopeId: string
  threadContextId: string | null
  kind: string
  content: string
  summary: string | null
  tags: readonly string[]
  confidence: number
  source: string
  actorIds: readonly string[]
  provenance: CanonicalProvenance
  eventTime: string
  validFrom: string | null
  validUntil: string | null
  expiresAt: string | null
}>

const sha256 = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex')

/**
 * U+0000 separator: it cannot occur in a scope id or a hex hash, so no two distinct field
 * tuples can join to the same string.
 */
const join = (...parts: readonly string[]): string => parts.join('\u0000')

/**
 * Decides whether two capture attempts are the same attempt.
 *
 * `contentHash` is imported from the tombstone module rather than reimplemented: a
 * tombstone's stored hash is literally a component of this key, so "is this content
 * tombstoned?" and "is this content a duplicate?" cannot disagree about what content means.
 */
export const idempotencyIdentity = (scope: MemoryScope, content: string): string =>
  sha256(join(scope.scopeType, scope.scopeId, contentHash(content)))

/** Sorted keys, sorted tags, explicit nulls — so encoding order can never change an identity. */
export const canonicalJson = (payload: CanonicalPayload): string => {
  const ordered = {
    confidence: payload.confidence,
    content: payload.content,
    eventTime: payload.eventTime,
    expiresAt: payload.expiresAt,
    kind: payload.kind,
    provenance: {
      contextId: payload.provenance.contextId,
      messageIds: [...payload.provenance.messageIds].sort(),
      threads: [...payload.provenance.threads].sort(),
    },
    actorIds: [...payload.actorIds].sort(),
    scopeId: payload.scopeId,
    scopeType: payload.scopeType,
    source: payload.source,
    summary: payload.summary,
    tags: [...payload.tags].sort(),
    threadContextId: payload.threadContextId,
    validFrom: payload.validFrom,
    validUntil: payload.validUntil,
  }
  return JSON.stringify(ordered, Object.keys(ordered).sort())
}

/**
 * Distinguishes two attempts that share an idempotency identity but differ in metadata —
 * what later reconciliation logic compares when checking payload identities against the
 * current path.
 */
export const contentIdentity = (payload: CanonicalPayload): string => sha256(canonicalJson(payload))
