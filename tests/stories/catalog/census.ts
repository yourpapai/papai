// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StoryTier } from './coverage.js'

/**
 * Both directions of the catalog↔lane relationship in one result.
 *
 * `dangling` covers what the per-tier forward gates already assert (a record
 * pointing at a story that does not exist); folding it in here means a lane
 * wires up one call and cannot be left half-blind.
 */
export type StoryCensus = Readonly<{
  tier: StoryTier
  /** Observed in the lane, claimed by no record and declared by no exemption. */
  orphans: readonly string[]
  /** Claimed or exempted, but the lane declares no such story. */
  dangling: readonly string[]
  claimed: number
  supporting: number
}>

export type StoryCensusInput = Readonly<{
  tier: StoryTier
  observed: readonly string[]
  claimed: readonly string[]
  supporting: readonly string[]
}>

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

export function censusStories(input: StoryCensusInput): StoryCensus {
  const claimed = new Set(input.claimed)
  const supporting = new Set(input.supporting)
  const observed = new Set(input.observed)

  return Object.freeze({
    tier: input.tier,
    orphans: sortedUnique(input.observed.filter((id) => !claimed.has(id) && !supporting.has(id))),
    dangling: sortedUnique([...claimed, ...supporting].filter((id) => !observed.has(id))),
    claimed: claimed.size,
    supporting: supporting.size,
  })
}
