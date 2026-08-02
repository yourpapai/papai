// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The ordering rules the shadow projection folds by. Pure and I/O-free, so every ordering can
 * be asserted without a database — which matters because these rules are the whole content of
 * the `capture-idempotency` clause "supersession and validity resolve by event time, never by
 * ingest order".
 */

export type FoldCandidate = Readonly<{ eventTime: string; idempotencyIdentity: string }>

const instant = (iso: string): number | undefined => {
  const millis = Date.parse(iso)
  return Number.isNaN(millis) ? undefined : millis
}

/**
 * One shadow row per record. An event captured while the live save was suppressed has no
 * record id, so it projects under its own identity rather than being dropped — 1d must be able
 * to tell "correctly not projected" from "lost".
 */
export function projectionKeyFor(recordId: string | null, idempotencyIdentity: string): string {
  return recordId ?? idempotencyIdentity
}

/**
 * Whether `candidate` should replace `incumbent` as the shadow row for their shared key.
 *
 * Instants are compared numerically, not lexically, so `…T00:00:00Z` and `…T00:00:00.000Z` are
 * one instant rather than two. An unparsable candidate never wins, mirroring `laterIso`, so a
 * malformed timestamp cannot displace a good row.
 *
 * Identity equality means this is the same event being re-applied — it always wins, so a
 * re-drive refreshes `last_observed_at` instead of silently skipping. Only a genuine tie
 * between two distinct events reaches the identity tie-break, which is ascending because it
 * must be deterministic and content-derived: `event_id` is a fresh UUID per run and
 * `ingest_time` is the ordering the criterion forbids.
 */
export function winsAgainst(candidate: FoldCandidate, incumbent: FoldCandidate): boolean {
  if (candidate.idempotencyIdentity === incumbent.idempotencyIdentity) return true

  const left = instant(candidate.eventTime)
  const right = instant(incumbent.eventTime)
  if (left === undefined) return false
  if (right === undefined) return true
  if (left !== right) return left > right

  return candidate.idempotencyIdentity < incumbent.idempotencyIdentity
}
