<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Per-dimension proving tiers

## Context

See `proposal.md` — Why. The shape that matters here is the current record type
in `tests/stories/catalog/behaviors.ts`:

```
BehaviorCoverage
  behaviorId    DocumentedBehaviorId
  state         implemented | partial | blocked:… | retired
  required      readonly CoverageDimension[]      ── what must be proven
  provingTier   StoryTier | null                  ── ONE tier for the record
  scenarioIds   readonly CatalogScenarioId[]      ── an unattributed bag
  missing       readonly CoverageDimension[]      ── what is not proven
  rationale     string
```

`scenarioReferenceGaps()` checks every id in the bag against
`catalogCoverage`, requiring `record.provingTier === catalog.provingTier`.

Two constraints shape everything below. `tests/stories/**` is a frozen compat
input (`scripts/story/inputs.ts` — `isCapturedStoryInputPath`), so this change
retires the current baseline `2e1630c06` and must re-record. And `max-lines` is
off under `tests/**`, so the record file may grow without a forced split.

## Goals / Non-Goals

**Goals:**

- A tier claim that can differ per dimension, with the tier-equality invariant
  preserved rather than weakened.
- Make `live-status` and `reply-to-bot-routing` closable by a successor change.
- Record where each successor change is expected to prove each open dimension,
  without that expectation ever counting as evidence.

**Non-Goals:**

- Deriving `state` from the record's contents. The discriminated union already
  makes `implemented` with a non-empty `missing` unrepresentable; going further
  buys nothing.
- Any change to `catalogCoverage`, the manifest, the coverage gate, or the
  compat runner.

## Decisions

### D1 — Scenarios are keyed by the dimension they prove

`required` / `provingTier` / `scenarioIds` collapse into one map:

```
type DimensionProof = { provingTier: StoryTier; scenarioIds: [Id, ...Id[]] }

implemented       proven:  Record<CoverageDimension, DimensionProof>   (non-empty)
                  missing: {}
partial           proven:  Partial<Record<…, DimensionProof>>
                  missing: Partial<Record<…, StoryTier>>               (non-empty)
blocked|retired   proven:  {}          missing: {}

required  ≡  keys(proven) ∪ keys(missing)     ── derived, never declared
```

`scenarioReferenceGaps()` then validates tier equality *per entry*, so a record
still cannot claim a tier its evidence does not run at — the invariant moves
down a level instead of relaxing.

Deriving `required` removes a class of skew the current type permits, where
`required`, `scenarioIds`, and `missing` are three independent fields nothing
reconciles.

**Alternative considered:** keep the three fields and add
`provingTiers: Partial<Record<CoverageDimension, StoryTier>>` alongside
`provingTier`. Smaller diff, and rejected: it leaves the scenario bag
unattributed, which is the second half of the same defect (see D2).

### D2 — Attribution exposes two vacuous citations, and that is the point

Today nothing connects a cited scenario to a dimension; `coverageGaps()` only
requires the bag to be non-empty. Two `partial` records satisfy that
vacuously — every required dimension is in `missing`, yet a scenario is cited:

| Record | Cites | Required | Missing |
| --- | --- | --- | --- |
| `reply-to-bot-routing` | `SCN-chat-message-normalization` | primary, authz-routing | **both** |
| `chat-participant-resolution` | `SCN-context-group-identity` | primary, authz-routing | **both** |

Under D1 these have no dimension to attach to, so both records become
`proven: {}`. The substrate relationship each citation described (a mention
boundary; a member roster) stays in `rationale`, where it is prose rather than
a structural claim. The model should make "cites evidence that proves nothing
required" unstateable.

### D3 — An open dimension carries a planned tier, not a proven one

`missing` becomes `dimension → StoryTier`: the tier a successor change is
expected to prove it at. This is what makes the `reply-to-bot-routing` split
meaningful — both its dimensions are open today, so without a planned tier the
record would be structurally identical before and after this change.

Re-declarations:

```
live-status              proven   external-boundary  → T2   SCN-chat-turn-tool-loop
                                  primary            → T2   SCN-chat-turn-tool-loop
                         missing  failure-recovery   → T0

reply-to-bot-routing     proven   —
                         missing  primary            → T0   (router reply handling)
                                  authorization-routing → T3 (adapter equivalence /
                                                              Mattermost-Kontur exclusion)
```

The remaining eleven records restate their single tier once per proven
dimension, unchanged in meaning.

**Alternative considered:** leave `missing` a bare dimension list and record
the intended tier only when the story lands. Honest, but it defers the tier
decision to whoever writes the story — which is exactly the decision this
change exists to make, and the successor changes need it up front to know
which lane they are authoring into.

### D4 — A planned tier is never evidence

`unqualifiedBehaviors()` keeps filtering on `state === 'partial'` and is not
told about `missing` tiers. The planned tier is inert: it is read by humans
planning successor changes, never by the qualification gate.

## Risks / Trade-offs

- **A planned tier is mistaken for coverage** → `missing` is keyed by tier but
  holds no scenario ids, and the type makes a scenario list impossible there;
  `unqualifiedBehaviors()` is unchanged. The contract test asserts a `partial`
  record with a non-empty `missing` is still returned as unqualified.
- **Attribution is judgement, and a wrong attribution is invisible** → the
  contract can prove a scenario runs at the claimed tier, never that it proves
  the claimed *dimension*. Mitigated only by review; the rationale field must
  say why each attribution holds. This limit exists today at record
  granularity and is not made worse.
- **The baseline is retired the moment this lands** → the re-record is a task
  in this change, not a follow-up, and `--manifest-only` preflight plus the
  full compat run are its verification.
- **The record file grows ~40%** → `max-lines` is off under `tests/**`. If
  review finds it unwieldy, records and validators split cleanly along the
  existing boundary; not done pre-emptively.

## Migration Plan

Test-first, one commit per step:

1. Extend `tests/stories/harness/behavior-coverage.test.ts` with the
   per-dimension assertions — red against today's type.
2. Introduce `DimensionProof`, the union rewrite, and derived `required`;
   port `coverageGaps()` and `scenarioReferenceGaps()`. Green.
3. Port all 13 records mechanically (eleven unchanged in meaning, two
   re-declared per D3; the two vacuous citations move to prose per D2).
4. Add the per-dimension tier requirement to the
   `story-coverage-floor-qualification` spec delta.
5. Re-record the qualification baseline; run
   `BASE_REF=<new> bun test:stories:compat --manifest-only` then the full
   compat run, and update the roadmap design's Foundation baseline section.

No rollback plan is needed: nothing ships to production, and reverting the
commit restores the previous ledger and baseline together.

## Open Questions

None. The `reply-to-bot-routing` tier split is decided in D3 rather than
deferred, because it changes the task breakdown of the successor changes.
