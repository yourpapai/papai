// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toPendingReason, type PendingReason } from './coverage.js'

/**
 * Stories that legitimately prove no cataloged behavior.
 *
 * The census treats an entry here as accounted-for without claiming coverage,
 * so this is the only escape hatch from the ledger. It is deliberately narrow:
 * every story in the tree at the time the census landed proved real behavior
 * and earned a catalog record. Add an entry only when a scenario genuinely has
 * no catalogable behavior behind it, and say why — a rationale that could be
 * read as "I did not want to write a catalog record" belongs in a record
 * instead.
 *
 * The Kaneo conformance sweep re-runs the 29 shared PARITY_GROUPS (already
 * cataloged as @1 Docker-Kaneo parity) through the real Kaneo plugin inside the
 * hermetic T0 lane against a stateful fake API. Each domain scenario proves
 * provider wiring — manifest approval, runtime transport propagation, request
 * building, and response mapping — not a new behavior claim, so it is supported
 * here rather than minting a redundant catalog record. The tier-suite-root rule
 * (coverage.ts keeps every executable story under its provingTier root) also
 * forbids attaching these `tests/stories/` ids to the @1 records whose root is
 * `tests/e2e/`.
 *
 * The real-Kaneo chat-loop stories (create/fields/error) attach to the existing
 * YouTrack real-provider records because they prove the same abstract behaviors
 * (real-plugin activation + create, field mapping, error translation) for a
 * second provider. The gating story is the complementary case — it proves the
 * POSITIVE members.provision path (capability advertised + a workspace-member
 * row persisted) where the YouTrack gating record proves only the negative
 * (capability absent → no row). That is a distinct proof, not the same behavior,
 * and it does not fit an existing record, so it is supported here rather than
 * overloading the YouTrack negative-gating record or the in-memory
 * SCN-task-identity provisioning record.
 */
const RATIONALES: Readonly<Record<string, string>> = Object.freeze({
  'tests/stories/tasks/kaneo-real.story.test.ts#SCN-task-kaneo-real-gating: provisions a workspace member for a provider with members.provision':
    'Provider-wiring coverage: proves the positive members.provision capability path through the real Kaneo plugin (capability advertised, fire-and-forget backstop persists an active kaneoWorkspaceMembers row). Complementary to the YouTrack real-gating record, which proves only the negative (capability absent) side, so it does not attach there.',
  'tests/stories/tasks/kaneo-conformance.story.test.ts#SCN-kaneo-conformance-tasks: real Kaneo provider satisfies the shared task groups':
    'Provider-wiring coverage: re-runs the shared task parity groups through the real Kaneo plugin against a stateful fake API, proving transport propagation and response mapping rather than a new behavior.',
  'tests/stories/tasks/kaneo-conformance.story.test.ts#SCN-kaneo-conformance-search: real Kaneo provider satisfies the shared search groups':
    'Provider-wiring coverage: re-runs the shared search parity groups through the real Kaneo plugin against a stateful fake API, not a new behavior claim.',
  'tests/stories/tasks/kaneo-conformance.story.test.ts#SCN-kaneo-conformance-comments: real Kaneo provider satisfies the shared comment groups':
    'Provider-wiring coverage: re-runs the shared comment parity groups through the real Kaneo plugin against a stateful fake API, not a new behavior claim.',
  'tests/stories/tasks/kaneo-conformance.story.test.ts#SCN-kaneo-conformance-relations: real Kaneo provider satisfies the shared relation groups':
    'Provider-wiring coverage: re-runs the shared relation parity groups through the real Kaneo plugin against a stateful fake API, not a new behavior claim.',
  'tests/stories/tasks/kaneo-conformance.story.test.ts#SCN-kaneo-conformance-projects: real Kaneo provider satisfies the shared project groups':
    'Provider-wiring coverage: re-runs the shared project/label/identity parity groups through the real Kaneo plugin against a stateful fake API, not a new behavior claim.',
  'tests/stories/tasks/kaneo-conformance.story.test.ts#SCN-kaneo-conformance-errors: real Kaneo provider satisfies the shared error groups':
    'Provider-wiring coverage: re-runs the shared error parity groups through the real Kaneo plugin against a stateful fake API, not a new behavior claim.',
})

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
