// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toPendingReason, type PendingReason } from './coverage.js'

/**
 * Stories that legitimately prove no cataloged behavior.
 *
 * The census treats an entry here as accounted-for without claiming coverage,
 * so this is the only escape hatch from the ledger. It is deliberately empty:
 * every story in the tree at the time the census landed proved real behavior
 * and earned a catalog record. Add an entry only when a scenario genuinely has
 * no catalogable behavior behind it, and say why — a rationale that could be
 * read as "I did not want to write a catalog record" belongs in a record
 * instead.
 */
const RATIONALES: Readonly<Record<string, string>> = Object.freeze({})

export const SUPPORTING_STORIES: Readonly<Record<string, PendingReason>> = Object.freeze(
  Object.fromEntries(Object.entries(RATIONALES).map(([storyId, rationale]) => [storyId, toPendingReason(rationale)])),
)

/**
 * Exemption and coverage claim are mutually exclusive: a story cannot both prove a
 * cataloged behavior and be excused from proving one. Taking both sides as parameters
 * keeps this falsifiable while the list is empty.
 */
export function doubleBookedExemptions(
  supporting: Readonly<Record<string, PendingReason>>,
  claimed: ReadonlySet<string>,
): readonly string[] {
  return Object.keys(supporting)
    .filter((storyId) => claimed.has(storyId))
    .sort()
}
