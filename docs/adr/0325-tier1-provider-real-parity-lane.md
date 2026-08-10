<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0325: Tier 1 Provider-Real Parity Lane — One Shared Expectation Module Proven Against Fake and Real Kaneo

## Status

Accepted

## Date

2026-07-23

## Context

The tier-aware scenario catalog ledger (ADR-0324) minted `provingTier` on every executable record, but all 101 executable records were `@0` — proven only in the hermetic in-process story lane. `LIVE_STORY_TIERS` was frozen at `['0']` and the tier-derivation contracts had a known open Minor: with every record at Tier 0, no test could distinguish real per-record tier derivation from a hardcoded constant. The tier-expansion roadmap (`docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`) defines Tier 1 as **provider-real**: the `MemoryTaskProvider` fake must be checked against the real task tracker so that fake drift is caught by a test, not by a production surprise.

Ledger truth before this decision: 128 total scenario ids, 101 executable (all `provingTier: '0'`), 27 pending. The Kaneo plugin (`plugins/task-provider-kaneo/provider.ts`) implements a subset of the `TaskProvider` interface; the fake implements more (watchers, votes, sprints, etc.), so parity can only be claimed for the intersection.

## Decision Drivers

- **One expectation, two bindings.** Parity only means something if the fake and the real provider run the *same* assertions. Duplicating expectations per lane guarantees drift between the lanes themselves.
- **One-way import direction (load-bearing).** The frozen Tier 0 expectation module must never import from `tests/e2e/`. The candidate-side Kaneo binding imports the frozen expectations **outward**. Reversing this would let Tier 0 behavior change without moving the frozen-tree `treeHash`, voiding the 0Q compat proof.
- **Parity means normalized-shape equivalence, not byte-identity.** Ids and timestamps legitimately differ between providers and are blanked to a `<volatile>` sentinel **after** their type is asserted; every other field's presence, type, and value is asserted. Array order is asserted where the provider contract promises it and made order-insensitive explicitly everywhere else.
- **No retries, measured budget (roadmap rules 4–5).** The lane is a PR gate with a measured wall-clock ceiling (baseline + 90s); a group that cannot hold green is quarantined to nightly in the same PR with a ledger note, never retried.
- **Frozen-tree exception, argued.** `tests/stories/**` is byte-hash-frozen for the 0Q compat proof; this change adds three frozen files and edits two frozen ledger files, so the `treeHash` moves **intentionally** — the same class of argued exception ADR-0324 established.
- **Honest exclusions.** Fake-only surfaces (no `KaneoProvider` counterpart) get a recorded `PARITY_EXCLUSIONS` reason instead of a fabricated `@1` claim.
- **Pinned infrastructure.** Kaneo image pinned at `ghcr.io/usekaneo/kaneo:2.7.2`; the fake binding must run green without Docker.

## Considered Options

### Option 1 — Frozen provider-agnostic expectation module + outward candidate binding (chosen)

Declare each parity group once under `tests/stories/harness/parity/` as operations-plus-assertions over the `TaskProvider` interface, comparing canonicalized outputs. A frozen fake-binding contract test runs it against `MemoryTaskProvider` in `bun test:stories:contracts`; a candidate-side binding under `tests/e2e/parity/` imports the same module and runs it against `KaneoProvider` behind the existing Docker harness. The ledger mints one `@1` id per group (16 planned, 12 landed after eligibility reclassification).

- **Pros:** single source of truth for parity; drift between fake and real surfaces as a test failure in either binding; the one-way import preserves the frozen-tree proof; minted `@1` ids give the tier-derivation contracts real teeth (the ADR-0324 Minor closes with data, not intent).
- **Cons:** edits/adds files in the frozen tree, so the `treeHash` re-baselines; the Kaneo lane adds Docker wall-clock to the PR gate within the declared ceiling.

### Option 2 — Independent E2E suite asserting Kaneo behavior directly (rejected)

Write separate `tests/e2e` tests against real Kaneo without sharing expectations with the fake.

- **Pros:** no frozen-tree exception; simpler to write.
- **Cons:** nothing proves the *fake* matches — the two suites drift independently, and "parity" becomes an unverifiable claim; the lane's entire purpose (fake-fidelity regression signal) is lost.

### Option 3 — Expand `MemoryTaskProvider` contract tests only (rejected)

Strengthen Tier 0 fake assertions and defer real-provider checks to manual verification.

- **Pros:** zero new infrastructure; no Docker in the PR gate.
- **Cons:** the fake's fidelity to real Kaneo is asserted against itself — circular; real drift (e.g. Kaneo's status normalization, date round-tripping) ships silently, which is exactly the regression class this tier exists to catch.

## Decision

Option 1, implemented as:

1. **Canonicalization utility (frozen).** `tests/stories/harness/parity/canonicalize.ts` exports `VOLATILE`, `VOLATILE_KEYS` (ids/timestamps: `id`, `taskId`, `createdAt`, …), and `canonicalize(value, keys)` — deep-clones, throws on absent-shaped volatile fields (drift is caught, not silently blanked), preserves array order.
2. **Parity expectation module (frozen).** `tests/stories/harness/parity/expectations.ts` exports `PARITY_GROUPS` (operations-plus-assertions per group, ids `SCN-parity-*`) and `PARITY_EXCLUSIONS` with per-group reasons naming the missing `KaneoProvider` counterpart. Order-sensitive groups assert positional sequence; order-insensitive groups sort by a stable non-volatile key before asserting.
3. **Fake binding (frozen contract test).** `expectations.fake.test.ts` runs every group against `MemoryTaskProvider` hermetically — green without Docker.
4. **Kaneo binding (candidate).** `tests/e2e/parity/provider-parity.test.ts` imports the frozen expectations outward, builds a `KaneoProvider` per group from the Dockerized container config (`getE2EConfigSync()` + `KaneoTestClient`), and shares the existing container lifecycle via the `e2e.test.ts` aggregator.
5. **Ledger mint.** `LIVE_STORY_TIERS` extends to `['0', '1']`; one executable record per surviving parity group lands with `provingTier: '1'` and a `storyIds` entry under `tests/e2e/parity/` (matching `TIER_SUITE_ROOTS['1']`); per-tier totals print a non-zero T1 tally. Groups the real provider cannot support are moved to `PARITY_EXCLUSIONS` with reasons (16 planned → 12 minted).

## Rationale

- The shared module is the only shape in which "parity" is falsifiable: one assertion set, two providers, divergence fails CI on whichever side drifted.
- The outward-only import direction keeps Tier 0 inside the frozen hash, so a candidate-side edit can never silently alter the compat proof.
- Normalized-shape comparison draws the assertion boundary exactly where the providers legitimately differ (ids, timestamps) and nowhere else — maximizing drift sensitivity per assertion.
- Reclassification of ineligible groups into recorded exclusions keeps the ledger honest: an `@1` id is only minted where real behavior was actually checked, satisfying the spec success metric "…or a recorded reason it cannot."

## Consequences

### Positive

- Fake-vs-real drift in the `TaskProvider` surface is now a CI failure, not a production discovery (e.g. Kaneo's status normalization and date handling were documented via divergence findings).
- The catalog carries its first non-`@0` records; the runner prints a live T1 tally, and the tier-derivation contracts verifiably fail under a mutated `@1`→`@0` tier — the deferred ADR-0324 Minor is closed with real data.
- A repeatable template for future tier lanes: frozen expectations + outward candidate binding + ledger mint.
- The fake binding stays hermetic and Docker-free, so Tier 0 signal is unchanged.

### Negative

- The PR gate gains Docker wall-clock; it must be re-measured against the declared ceiling and quarantined to nightly if exceeded.
- The frozen-tree `treeHash` re-baselines; refactor qualification and the manifest must be updated against the new hash.
- Maintenance burden: every new parity-relevant `TaskProvider` behavior needs a group, and eligibility reclassification (like the 16→12 reduction) must be applied consistently across ledger, totals, and exclusions.

### Risks

- Real Kaneo behavior changes on image bump could flip groups between eligible and excluded — mitigated by the pinned image (`2.7.2`, do-not-bump rule) and the no-retry quarantine path.
- Shared-workspace resource leakage across groups in the Kaneo lane — mitigated by per-group project creation and `KaneoTestClient` teardown tracking.

## Related Decisions

- ADR-0284: Scenario Catalog Hermetic Stories — the Tier 0 lane and frozen-tree discipline this change extends.
- ADR-0304: Story Catalog Audit — the ledger structure the `@1` records join.
- ADR-0324: Tier-Aware Scenario Catalog Ledger — minted the tier vocabulary; this decision lands the first non-`@0` tier and closes its deferred contract-teeth Minor.

## References

- Plan: `docs/superpowers/plans/2026-07-23-tier1-provider-real-parity.md`
- Spec: `docs/superpowers/specs/2026-07-23-tier1-provider-real-parity-design.md`
- Roadmap: `docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`
- Code: `tests/stories/harness/parity/`, `tests/e2e/parity/provider-parity.test.ts`, `tests/stories/catalog/coverage.ts`
