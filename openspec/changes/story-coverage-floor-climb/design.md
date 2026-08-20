<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Climbing the Tier 0 floor

## D1 — The metric makes this a file-counting problem

`meanMetric` is an unweighted mean of per-file ratios over the scoped set, so a
file contributes 1/N regardless of size and a 1-function file is worth exactly
as much as a 20-function one. Two consequences drive the plan:

- **Budget in file-units, not percentages.** Restoring 0.71/0.70 costs 23.5
  line-units and 43.3 function-units. Functions is the binding constraint
  throughout; a plan that clears functions clears lines.
- **Prefer many small files over a few large ones** when the contract value is
  equal. This is a property of the metric, not a reason to write shallow tests —
  where the two conflict, the two-oracle requirement wins and the file is
  skipped rather than tested badly.

## D2 — Target order

220 scoped files have zero covered functions. Work them in this order, because
it front-loads the files reachable through seams the harness already has:

1. `plugins/task-provider-kaneo/` and `plugins/task-provider-youtrack/`
   (22 files) — provider operations are driven end-to-end by existing task
   stories; most need a scenario that exercises the operation, not new harness.
2. `src/analytics/governance/` and `src/analytics/derive/` (17 of the 59
   analytics files) — store and job modules behind the analytics runtime seam.
3. `src/chat/` (52 files) — adapter helpers; several are reachable from the
   existing Telegram and Discord story lanes.
4. `src/debug/` (22 files) — settings routes, reachable through the settings
   story surface.

Stop as soon as the gate reports at or above both floors; the remaining files
stay available headroom for the next ratchet.

## D3 — What is deliberately not targeted

`src/analytics/rekey/**` and the operator CLI entrypoints (19 zero-function
files) are excluded. They are reachable only by invoking a CLI the story lane
has no seam for, and a story written to load one would assert nothing a user or
operator can observe — exactly the load-only coverage the predecessor's spec
forbids. With 201 files of headroom outside them, nothing forces the issue.

## D4 — The eligibility gap still blocks canonical-event stories

`decideEligibility` (`src/analytics/governance/eligibility.ts:143`) denies with
`governance_incomplete` when `collectionEligibility` is null, and
`setEligibilityState` has zero production callers, so no production path grants
a ref. Analytics targets are therefore limited to surfaces reachable without a
granted ref — including the denial branches themselves, which are real
behavior. Seeding `setEligibilityState` from a story is rejected: it would prove
a path production cannot reach. `analytics-collection-eligibility-grant` closes
the gap; if it lands first, the canonical-event surfaces open up and the
analytics group gets cheaper.

## D5 — Ordering against the baseline

The story additions touch frozen inputs, so the baseline recorded by
`story-coverage-floor-qualification` dies the moment the first story lands. The
floor raise on its own does not: `scripts/story/coverage-floor.json` is absent
from the manifest's 163 frozen files, because the compatibility proof is
behavioral and measures a refactor against the frozen suite rather than against
whatever floor was in force. Order: add stories → gate green → ratchet the floor → commit
the frozen input set → read `treeHash` from `reports/stories/manifest.json` →
record the new literals in a follow-up commit that touches no frozen input →
run both compat commands against it.

## D6 — Scope model, DB, capability gating, dependencies

None. No production code changes, no migration, no new dependency, no new tool
surface.
