<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Per-dimension proving tiers in the behavior ledger

## Why

The behavior ledger is the last unmet completion criterion of
`docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md`:
8 of its 13 records are `partial`, and a `partial` record cannot qualify a
global refactor. Two of those eight cannot be closed at all under the current
model. `BehaviorCoverage` declares one `provingTier` per behavior, and
`scenarioReferenceGaps()` requires every cited scenario to run at exactly that
tier — but the roadmap requires each behavior to be proven "at the cheapest
tier that can exercise its regression boundary", which is a property of a
*dimension*, not of a behavior.

`live-status` proves its external boundary at Tier 2 against a real Mattermost
post lifecycle, while its unproven `failure-recovery` dimension (placeholder
freeze/dismiss ordering, `minLabelMs` hold, error-path dismiss) is hermetic
Tier 0 work — citing a T0 scenario from a T2 record fails the contract.
`reply-to-bot-routing` inverts it: `primary` is Tier 0 router behavior, while
`authorization-routing` is the Telegram/Discord equivalence and
Mattermost/Kontur exclusion only the existing Tier 3 lane can prove.

## What Changes

- `BehaviorCoverage` carries a proving tier and scenario list **per required
  dimension** instead of one tier for the whole record.
- `scenarioReferenceGaps()` validates tier equality per dimension, preserving
  the invariant that a record can never claim a tier its evidence does not run
  at.
- `live-status` and `reply-to-bot-routing` are re-declared with split tiers;
  the other eleven records restate their single tier per dimension, unchanged
  in meaning.
- The qualification baseline is re-recorded — `tests/stories/**` is a frozen
  compat input, so editing the ledger retires the current baseline.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `story-coverage-floor-qualification` — its "Ledger entries are
  evidence-bearing" requirement governs what an entry may claim but never
  specifies the tier claim `scenarioReferenceGaps()` already enforces. Without
  the per-dimension rule there, the two records above stay permanently
  `partial` and criterion #1 is unreachable. A separate capability is
  unwarranted: this is the same evidence contract, one level finer.

## Non-goals

- Writing the stories that close the 14 missing dimensions — tracked as
  successor changes; this change only makes two of them writable.
- Auditing per-dimension tiers across the other six `partial` records —
  declined. Only records with a demonstrated conflict are re-declared;
  speculative re-tiering is what the roadmap's "no speculative test seams"
  constraint forbids.
- A `supportingScenarioIds` field exempt from the tier check — declined; it
  buys a smaller diff by deleting the invariant that makes the ledger
  trustworthy as evidence.
- Splitting `live-status` into two behavior IDs — declined. IDs are
  `<!-- behavior: -->` anchors in `docs/architecture/behaviors.md`, one per
  independently observable behavior; inventing a second bullet corrupts the
  inventory to fit the schema.
- The Phase 5 refactor-impact lane map (criterion #4).
- Any production behavior change. No platform or task instance is touched and
  no state is persisted, so the scope model is unaffected — nothing new is
  keyed by storage context, config context, platform instance, or user.

## Impact

- `tests/stories/catalog/behaviors.ts` — record type, both validators, all 13
  records.
- `tests/stories/harness/behavior-coverage.test.ts` — contract assertions.
- Re-recorded baseline SHA in the roadmap design's Foundation baseline section.
