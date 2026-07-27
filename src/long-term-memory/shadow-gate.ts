// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The two **mechanical** preconditions of the pre-registered P1 decision gate, plus the
 * descriptive markers the operator report renders beside the values they judge.
 *
 * Pre-registered on 2026-07-25 and frozen: the gate requires N = 1000 sampled
 * memory-bearing turns across M >= 50 distinct scopes, **per reader model**, before its
 * under-trigger rate may be trusted (see
 * `docs/superpowers/specs/2026-07-24-memory-recall-shadow-logging-design.md`). Both are
 * plain `>=` comparisons, which is why automating them is safe.
 *
 * **The bucket-3 stop threshold (< 5%) is deliberately absent from this module and must
 * not be added.** The spec is explicit that P1 *screens* for the gap while a human
 * *adjudicates* it against the recorded threats to validity. A 5% constant living in code
 * would both hand that judgment to a script and make a later edit indistinguishable from
 * post-hoc goalpost-moving.
 *
 * Markers are descriptive by design -- "meets"/"below", never "PASS"/"FAIL" or any word
 * that reads as a verdict.
 */

/** N -- the pre-registered per-reader-model collection target in memory-bearing turns. */
export const SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS = 1000

/** M -- the pre-registered per-reader-model floor on distinct scopes. */
export const SHADOW_GATE_MIN_DISTINCT_SCOPES = 50

/**
 * Renders a value's standing against a pre-registered threshold. Both gate preconditions
 * are `>=`, so a value exactly equal to its threshold reads `meets`.
 *
 * `criterion` is the human-readable form of the precondition (e.g. `'M >= 50'`), rendered
 * verbatim into the marker.
 */
export function formatPreconditionMarker(value: number, threshold: number, criterion: string): string {
  const standing = value >= threshold ? 'meets' : 'below'
  return `(${standing} the pre-registered ${criterion})`
}

/** Marker for a reader model's memory-bearing turn count against N. */
export function formatTurnsMarker(memoryBearingTurns: number): string {
  return formatPreconditionMarker(
    memoryBearingTurns,
    SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS,
    `N = ${SHADOW_GATE_TARGET_MEMORY_BEARING_TURNS}`,
  )
}

/** Marker for a reader model's distinct-scope count (M) against the scope floor. */
export function formatScopesMarker(distinctScopes: number): string {
  return formatPreconditionMarker(
    distinctScopes,
    SHADOW_GATE_MIN_DISTINCT_SCOPES,
    `M >= ${SHADOW_GATE_MIN_DISTINCT_SCOPES}`,
  )
}
