<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Restore the Tier 0 floor and record its baseline

## D1 — Why the gate went red without anyone lowering a floor

`meanMetric` in `scripts/coverage/ratchet-lib.ts` is the unweighted mean of
per-file ratios over the scoped file set, and unloaded files are seeded at 0%
(the last gate run reports `1020 measured, 28 unloaded seeded as 0%, 1048
files`). File *count* therefore moves the number directly: merging master added
production files the frozen lane never loads, and the mean fell to 68.76% /
65.87%. This is a real coverage loss, not a metric artifact — the seeded files
genuinely have no Tier 0 proof — so the fix is coverage, not reweighting.

## D2 — Target selection

Work the diagnostic report top-down; it is already ordered deterministically.
The twelve worst files cluster into two groups:

- `src/analytics/**` (nine files, 0 covered functions in eight of them) —
  snapshot copy/consumer, preference store, derive job and write path, event
  store, snapshot, backfill, collection store.
- Chat entrypoints — `src/chat/discord/index.ts`,
  `src/chat/telegram/index.ts`, `src/chat/mattermost/link-resolver.ts`.

Analytics is the larger and cheaper win: these are pure-ish job and store
modules driven from the story harness's existing analytics runtime seam.

## D3 — Routing around the eligibility gap

Canonical-event analytics stories are blocked: `decideEligibility`
(`src/analytics/governance/eligibility.ts:143`) denies with
`governance_incomplete` when `collectionEligibility` is null, and no production
code path writes an `allow` row — `setEligibilityState` has zero production
callers. That gap is its own change
(`analytics-collection-eligibility-grant`). This change therefore targets
analytics surfaces reachable without a granted ref: aggregate-lane snapshot and
copy jobs, preference-store reads and writes, event-store retention, and the
denial paths themselves. Seeding `setEligibilityState` from a story to unblock
the rest is explicitly rejected — it would prove a path production cannot
reach.

## D4 — No new modules

The behavior ledger (`tests/stories/catalog/behaviors.ts`), the inventory, the
coverage report formatter, and the diagnostics all shipped with Tasks 1, 3, and
4 of the foundation plan. This change adds records to them; it introduces no
new harness module.

## D5 — Baseline ordering

The baseline can only be recorded once the gate is green, and it must name a
commit whose frozen inputs are final. Order: add stories → gate green →
commit the frozen input set → read `treeHash` from
`reports/stories/manifest.json` → render literals into the roadmap spec in a
follow-up commit → run both compat commands with that `BASE_REF`. The recording
commit must not itself touch frozen inputs, or it invalidates the SHA it
records.

## D6 — Scope model, DB, capability gating, dependencies

None. No production code changes, no migration, no new dependency, no new tool
surface.

## D7 — Hook / TDD interaction

Every new file is a `*.story.test.ts` under `tests/stories/`, which the
Write/Edit TDD hook treats as the test side; each story is written to fail
first against the current runtime, then satisfied by existing production
behavior (no production change is expected — a story that cannot pass without
one is a finding, not a fix).
