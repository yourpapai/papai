<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0324: Tier-Aware Scenario Catalog Ledger — Machine-Checked Proving Tiers on Every Catalog Record

## Status

Accepted — tier-canon note (2026-08-09): with the owning spec archived by
the Lane 0 drain, the canonical Realism Tiers table moved to
`docs/operations/e2e-planning-workflow.md`
(`superpowers-residue-cleanup`, design D2). This ADR's "spec owns the
table" statement is historical; enforcement in
`tests/stories/catalog/coverage.ts` is unchanged.

## Date

2026-07-23

## Context

The tier-expansion roadmap (`docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`) defines proving tiers 0–4 for test realism — from the hermetic in-process story lane (Tier 0, ADR-0284) up to operational lanes (Tier 4). Before any new tier lane could be built, the scenario-catalog ledger in `tests/stories/catalog/coverage.ts` described coverage only as executable vs. pending (ADR-0304): no record stated **which tier proves it**, and no record stated **which tier would unblock a pending one**. Tier planning was therefore done against prose, not data, and the docs that described tiers disagreed about the taxonomy — notably the old Tier 2 "runtime E2E" charter, which Tier 0 already covers in-process and hermetically.

Rule 2 of the roadmap spec requires this ledger work to land **first and alone** as Deliverable 1: no tier lane is built in the same change. Ledger numbers at plan time: **128 total, 101 executable, 27 pending** (5 `needs-seam`, 22 `blocked`).

## Decision Drivers

- **Machine-checkable tier placement.** Tiers 1–4 must be plannable against ledger data, with contracts enforcing placement, not prose that drifts.
- **Zero-touch migration of existing records.** All 101 executable records were proven in the hermetic Tier 0 lane; forcing 101 edits would be pure churn, so the mapping table must default to Tier 0.
- **No speculative liveness.** An executable record may only claim a tier whose lane actually runs today, so a planned tier can never be mistaken for existing coverage. A tier joins the live list only in its own spec's PR.
- **Honest pending records.** Seam-pending scenarios name the tier that unblocks them; `blocked:missing-implementation` scenarios name none, because no tier reaches them through test work alone — a tier assignment would misrepresent them as reachable.
- **Single canonical taxonomy.** One tier table owned by the spec; `e2e-planning-workflow.md` mirrors it and defers to it on disagreement.
- **Frozen-tree discipline (spec rule 6).** `tests/stories/**` and `scripts/story/**` are frozen compat inputs; this plan edits three of them (`coverage.ts`, `catalog-coverage.test.ts`, `coverage-totals.ts`), so the manifest `treeHash` changes **intentionally** — the one exception rule 6 anticipates. Runner and sandbox files stay untouched.

## Considered Options

### Option 1 — Tier vocabulary on the existing ledger, enforced by Tier 0.1 contracts (chosen)

Add `STORY_TIERS` / `StoryTier` / `LIVE_STORY_TIERS` / `TIER_SUITE_ROOTS` to the ledger; add `provingTier` to executable records via an optional defaulted field on the mapping table; add `unblockedByTier` to seam-pending audit records; add four contracts (live-tier stamp, distinct suite roots, story placement under tier root, unblocking tier on seam-pending); grow the runner coverage line with per-tier tallies; reconcile the docs.

- **Pros:** single source of truth in code; contracts enforce the invariants on every Tier 0.1 run; the defaulted optional `provingTier` leaves all 101 existing mapping entries untouched; per-tier totals print on every runner run for free; the taxonomy becomes single-sourced.
- **Cons:** edits three frozen files, so the manifest `treeHash` changes and the next refactor qualification must re-baseline against this commit — intended, but a real operational cost.

### Option 2 — Tier assignments in a separate sidecar table (rejected)

Keep the ledger unchanged and map scenario ids to tiers in a new file.

- **Pros:** frozen tree untouched; no `treeHash` change.
- **Cons:** two sources of truth that can drift; contracts must join across files; contradicts the spec, which already anticipates and argues this one ledger edit as the rule-6 exception.

### Option 3 — Keep tiers in prose docs only (rejected)

Document tier intent per scenario family in the roadmap spec and planning docs, with no code change.

- **Pros:** zero code churn.
- **Cons:** nothing is machine-checked; tier claims drift from reality; defeats the roadmap's purpose, which is to build lanes against data.

## Decision

Option 1 shipped across five tasks plus a verification task:

1. **Tier vocabulary and proving tier on executable records.** `STORY_TIERS = ['0','1','2','3','4']`, `type StoryTier`, and `LIVE_STORY_TIERS` (frozen `['0']` at landing) in `tests/stories/catalog/coverage.ts`; executable `CatalogCoverage` records gain `provingTier: StoryTier`; `ExecutableStoryMapping` gains optional `provingTier?: StoryTier` defaulting to `'0'` in the `catalogCoverage` builder — all 101 existing entries untouched.
2. **Tier suite roots and the placement contract.** `TIER_SUITE_ROOTS: Readonly<Record<StoryTier, string>>` (`tests/stories/`, `tests/e2e/`, `tests/smoke/`, `tests/platform/`, `tests/operational/`), with contracts asserting distinct roots and that every executable story id starts with its tier's root.
3. **Unblocking tier on seam-pending records.** The `needs-seam` variant of `AuditReadiness` gains `unblockedByTier: StoryTier`; the `needs` helper takes the tier as its third argument; all five seam-pending call sites pass `'3'` (real chat-adapter code must execute for any of them); `blocked` deliberately carries no tier.
4. **Per-tier totals in the runner line.** `StoryCoverageTotals` gains `executableByTier` and `pendingByUnblockingTier`; `formatStoryCoverageTotals()` emits one line with three semicolon-separated clauses (`story catalog: 101/128 executable (T0 101, …); pending 27 (…); pending unblocked by tier (…)`).
5. **Docs reconciliation.** `e2e-planning-workflow.md`'s Realism Tiers section replaced with a mirror table pointing at the canonical spec; Tier 2 re-chartered around the process boundary (the built artifact boots and serves — migrations, env validation, plugin lifecycle, route binding, shutdown), retiring the former "runtime E2E" charter; 0Q documented as a Tier 0 instrument only — tiers 1–4 are regression lanes, never qualification gates; `tests/CLAUDE.md` gains the proving-tier and 0Q convention lines.
6. **Verification.** `bun test:stories:contracts`, `bun test:stories` (Docker), default suite + typecheck + lint, and `bun test:stories:manifest` to record the intended `treeHash` change.

## Consequences

### Positive

- Tiers 1–4 are plannable against **ledger data**: each tier spec consumes `TIER_SUITE_ROOTS` and joins `LIVE_STORY_TIERS` in its own PR, never speculatively.
- Placement and liveness invariants are machine-checked on every Tier 0.1 run — a story filed under the wrong tier root, or an executable record claiming a non-live tier, fails CI.
- The runner prints per-tier tallies on every run, keeping roadmap progress visible at zero cost.
- One canonical tier table; the docs can no longer fork the taxonomy silently.
- The design proved out: subsequent lanes (T1 provider-real, T2 process-real smoke, T3 platform-integrated) landed by extending `LIVE_STORY_TIERS` and stamping `provingTier` on their mappings, exactly as the plan intended (see Implementation Notes).

### Negative

- The frozen manifest `treeHash` changed (three frozen files edited); the next refactor qualification must re-baseline against this commit rather than an older one — intended and argued, but an operational step that must not be skipped.
- The ledger file is now load-bearing for every future tier spec; changes to its tier vocabulary ripple into every lane's contracts.
- Contract-test totals (128/101/27 at landing) are literals that every later catalog or tier change must reconcile.

### Risks

- **Premature liveness.** A tier could be added to `LIVE_STORY_TIERS` before its lane is truly green — mitigated by the contract suite plus the documented rule that a tier joins the live list only in its own spec's PR.
- **Vacuous totals.** Per-tier tallies could drift from the contracts — mitigated by the unit test over `storyCoverageTotals()` asserting the exact per-tier shape and the formatted line byte-for-byte.

## Related Decisions

- [ADR-0304](0304-story-catalog-audit.md) — Story Catalog Audit: established the `EXECUTABLE_STORY_MAPPINGS` / `AUDIT_RECORDS` / readiness-state machinery this decision extends with tier data.
- [ADR-0284](0284-scenario-catalog-hermetic-stories.md) — Scenario Catalog Hermetic Stories: the Tier 0 lane whose mappings all defaulted to `provingTier: '0'`.
- [ADR-0282](0282-hermetic-e2e-master-baseline.md) — Hermetic E2E Master Baseline: the frozen-tree/manifest discipline under which the intended `treeHash` change is argued.
- [ADR-0225](0225-hermetic-story-execution-docker-sandbox.md) — Hermetic Story Execution Docker Sandbox: the sandbox that runs `bun test:stories` verification.
- [ADR-0323](0323-f8-interaction-story-family.md) — F8 Interaction Story Family: closed the coverage-expansion program at 101/27, the ledger state this decision stamps with tiers.

## Implementation Notes

Verified present against the shipped tree via `grep`/`glob`/`read`.

| File                                                                 | Role                                                                                                         | Evidence                                      |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| `tests/stories/catalog/coverage.ts:8-9`                              | `STORY_TIERS` / `StoryTier`                                                                                  | `grep` confirms.                              |
| `tests/stories/catalog/coverage.ts:16`                               | `LIVE_STORY_TIERS`                                                                                           | Present; now `['0','1','2','3']` (see below). |
| `tests/stories/catalog/coverage.ts:23`                               | `TIER_SUITE_ROOTS`                                                                                           | `grep` confirms.                              |
| `tests/stories/catalog/coverage.ts:61`                               | `unblockedByTier` on the `needs-seam` readiness variant                                                      | `grep` confirms.                              |
| `tests/stories/catalog/coverage.ts:93,312,1289`                      | `provingTier` on the executable record, optional on the mapping, defaulted `?? '0'` in the builder           | `grep` confirms.                              |
| `tests/stories/harness/catalog-coverage.test.ts:219,248,256,331`     | All four new contracts (live proving tier, distinct suite roots, placement under tier root, unblocking tier) | `grep` confirms.                              |
| `scripts/story/coverage-totals.ts:15-16,54,56`                       | `executableByTier` / `pendingByUnblockingTier` tallies and the three-clause format line                      | `grep` confirms.                              |
| `docs/superpowers/e2e-planning-workflow.md:40-58`                    | Canonical Realism Tiers mirror table; "0Q is a Tier 0 instrument only"                                       | `grep` confirms.                              |
| `tests/CLAUDE.md:128-129`                                            | Proving-tier and 0Q convention bullets                                                                       | `grep` confirms.                              |
| `docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md` | The spec whose rule 2 required this deliverable to land first                                                | `glob` confirms.                              |

Plan-vs-implementation notes:

- **The plan's task checkboxes remain unchecked** in the plan file — the tracking syntax was not updated during execution, but every task's artifact is present in the codebase.
- **The ledger has evolved past the landing state (cumulative, not divergence).** `LIVE_STORY_TIERS` now lists tiers 0–3 (`coverage.ts:16`), and many mappings carry explicit `provingTier: '1'` / `'2'` / `'3'` (`coverage.ts:899-1155`) — the T1/T2/T3 lanes landed afterwards exactly as this decision designed (extend the live list, stamp the tier). The plan's era literals (128/101/27, `LIVE_STORY_TIERS = ['0']`) are superseded by later tier specs, per the roadmap queue the plan names.

The source plan `docs/superpowers/plans/2026-07-23-tier-aware-ledger.md` remains in the legacy tree pending archival alongside this ADR to `docs/archive/`.
