<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0330: Tier 1b E2E Parity Retrofit — Fold the Kaneo-Only Domain Suites into the Shared Parity Lane and Retire the Duplicates

## Status

Accepted

## Date

2026-07-24

## Context

ADR-0325 established the Tier 1 provider-real parity lane: 12 shared `PARITY_GROUPS` declared once under `tests/stories/harness/parity/expectations.ts` and executed against both `MemoryTaskProvider` (Tier 0, hermetic) and real Dockerized Kaneo (`@1`). But those 12 groups only covered the CRUD core. A large body of provider behavior — task field depth (dates, description, priority), search variants, comment depth/content edges, missing-entity errors, multiple relations — was still proven **only** by the Kaneo-only domain suites in `tests/e2e/` (77 tests across 11 files). Those suites assert against real Kaneo alone, so:

- The fake (`MemoryTaskProvider`) had no coverage for those behaviors — fake drift in a domain behavior would ship silently, exactly the regression class Tier 1 exists to catch.
- Behaviors were proven in Kaneo-specific style rather than in normalized-shape parity form, so there was no single source of truth: a behavior lived in one Kaneo-only test, and nothing tied it back to the fake.
- The tier-aware catalog ledger (ADR-0324) had only 12 `@1` records; the domain behaviors were uncatalogued, invisible to the coverage ledger.

The fake is frozen by policy (ADR-0325): a behavior the fake cannot echo must be an exclusion or Kaneo-only residue, never a reason to change the fake. Genuine divergences were already known — relation directionality (Kaneo materializes inverse relations; the fake stores a flat directed map), invalid-workspace search (Kaneo scopes to real workspaces; the fake has no workspace concept), column/label management, list filters, and assignee round-trips.

## Decision Drivers

- **Single source of truth.** A behavior converted to a parity group must be deleted from its Kaneo-only suite; only genuinely Kaneo-specific residue (raw `kaneoApiJsonParsed` payload assertions, invalid-API-key) stays behind, uncatalogued.
- **One expectation, two bindings (inherited).** The retrofit must flow through the existing generic machinery — both bindings and the `@1` cross-check already iterate `PARITY_GROUPS`, so each new group reaches fake execution, Kaneo execution, and catalog verification with no per-group machinery.
- **Triage before conversion.** With 77 candidate tests, classification (CORE / NEW / EXCLUDE / RESIDUE / META) must happen up front and be recorded, so every conversion and every deletion is traceable to an authoritative table rather than ad-hoc judgment.
- **The fake stays frozen.** Divergences become `PARITY_EXCLUSIONS` entries with honest `KaneoProvider` reasons, not fake enhancements.
- **Concat, not barrel.** The frozen single-file `expectations.ts` must split into per-domain modules as it grows, but `oxc/no-barrel-file` is an error — the aggregator must remain a value module that declares `PARITY_GROUPS` by concatenating the domain arrays.
- **Deterministic ledger accounting.** Each group is exactly one `@1` catalog record; every wave must bump the six literal assertion sites in lockstep, with an explicit reconciliation rule for groups that pass the fake but diverge on real Kaneo (reclassify to exclusion, subtract from the wave count, apply edits at the actual cumulative total).

## Considered Options

### Option 1 — Triage, then convert domain behaviors to parity groups in additive waves, then retire duplicates (chosen)

Produce an authoritative triage table classifying all 77 domain tests (CORE / NEW / EXCLUDE / RESIDUE / META), split `expectations.ts` into per-domain modules (`expectations/{tasks,search,comments,relations,projects,errors}.ts`) concatenated into one `PARITY_GROUPS`, add 17 new groups in five waves (task field-depth +6, search +3, comments +3, errors +4, relations +1) with a per-wave Docker divergence gate, then delete the migrated domain tests and slim the e2e suites to residue. Ledger moves from 12 to 29 `@1` records (catalog 140 → 157 ids, executable 113 → 130).

- **Pros:** every parity-able behavior gets one source of truth proven against both providers; the triage table makes every deletion auditable; additive waves keep each diff small with a mechanical ledger-bump recipe; the reconciliation rule handles Kaneo divergences deterministically without invalidating the plan; residue suites shrink but keep genuinely Kaneo-only checks.
- **Cons:** multi-step migration with per-wave ledger arithmetic that must be kept consistent; Docker gate can only run where Docker is available (waves may defer to the final full-lane run); the frozen tree grows again (argued exception, same class as ADR-0324/0325).

### Option 2 — Keep the Kaneo-only domain suites as-is (rejected)

Leave the 77 domain tests untouched and treat the 12 T1 groups as sufficient parity coverage.

- **Pros:** zero migration effort; no ledger churn.
- **Cons:** the majority of domain behaviors stay unproven against the fake — the lane's purpose (fake-fidelity regression signal) covers only the CRUD core; two overlapping test styles persist; the catalog ledger remains blind to domain coverage.

### Option 3 — Rewrite the domain suites as Kaneo-only catalogued `@1` records without parity groups (rejected)

Mint catalog ids for the domain tests but keep them asserting against Kaneo alone.

- **Pros:** ledger visibility without restructuring expectations.
- **Cons:** violates the one-expectation-two-bindings driver — cataloguing a Kaneo-only test proves nothing about the fake; the drift signal the tier exists for is still absent, now with a veneer of coverage.

## Decision

Option 1, implemented as:

1. **Task 0 — triage doc** (`docs/superpowers/plans/2026-07-24-tier1b-triage.md`): one row per domain test with bucket, target group id, and reason; reconciles to `CORE + NEW + EXCLUDE + RESIDUE + META == 77` and ends with a retirement list consumed by the final sweep.
2. **Task 1 — module split (no behavior change):** `group.ts` holds the shared contract (`ParityHarness`, `ParityGroup`, `required<T>`); the 12 existing groups move verbatim into six domain modules; `expectations.ts` becomes the concat aggregator (value module, not a barrel).
3. **Tasks 2–6 — five additive waves:** 17 new groups minted as `SCN-parity-*` ids with verbatim titles, each landing green on the fake binding first (count assertions intentionally RED until the ledger bump), then minted as `@1` records in `tests/stories/catalog/coverage.ts`, then the six literal sites bumped in lockstep, then a Kaneo Docker divergence gate. Two new `PARITY_EXCLUSIONS` entries recorded with `KaneoProvider` reasons: `search-invalid-workspace` and `relation-directionality`.
4. **Task 7 — retirement:** every CORE/NEW domain test deleted; `user-workflows.test.ts` removed entirely (redundant atoms); remaining suites slimmed to RESIDUE/META only; e2e aggregator registration cleaned up.
5. **Task 8 — reconciliation:** `CATALOG_SOURCE` provenance string records the retrofit; both tier-contract teeth (storyId title cross-check, tier-root guard) re-proven; whole-suite gate green.

Final landed state: 29 `PARITY_GROUPS`, 21 `PARITY_EXCLUSIONS`, catalog at 157 ids / 130 executable with `executableByTier['1'] == 29` (later extended further by the Tier 2 process-smoke lane, which appended its own `@2` records on top).

## Consequences

### Positive

- Domain behaviors (dates, description/priority, special chars, long inputs, search variants, comment edges, missing-entity errors, multiple relations) are now proven against **both** the fake and real Kaneo from one declaration — fake drift in any of them fails the hermetic lane before it ships.
- Every parity-able behavior has a single source of truth; the Kaneo-only suites shrank to genuine residue (raw-payload assertions, invalid-key, META target-detection tests), and `user-workflows.test.ts` is gone entirely.
- The `@1` ledger more than doubled (12 → 29 records), giving the tier-derivation contracts substantially more real data.
- The per-domain module split keeps each expectation file focused; new waves follow a mechanical recipe (append group → mint record → bump six sites → Docker gate).
- The triage doc remains as the audit trail for every deleted test.

### Negative

- The e2e Docker lane runs more parity groups, adding wall-clock within the declared PR-gate budget.
- The six literal-site ledger bump is manual arithmetic; a missed site fails loudly (by design) but adds per-wave toil.
- Kaneo-specific residue tests remain uncatalogued by construction — coverage of raw-payload shapes is invisible to the ledger.
- The frozen story tree absorbed new files again (argued exception), so the `treeHash` moved intentionally.

### Risks

- A group that passes the fake but diverges on Kaneo where Docker was unavailable at wave time could surface late; mitigated by the final Task 8 full-lane gate and the standing reconciliation rule.
- The `SCN-parity-task-full-property` priority assertions were flagged as the most likely divergence (Kaneo's known priority quirk); the plan carried an explicit fallback (drop priority assertions or reclassify) so the risk resolved deterministically.

## Implementation Notes

- Parity assertions use normalized-shape equivalence: `toMatchObject` for provider supersets, `toEqual` only for closed shapes, `canonicalize(x, VOLATILE_KEYS)` for volatile ids/timestamps; dates use presence+type assertions because real Kaneo may reformat date strings.
- No `if` in test bodies (`vitest/no-conditional-in-test` is error): optional-method results are unwrapped via `required<T>(value, label)`; unset-date checks loop `for...of` over both values.
- Optional provider methods are invoked with `?.` (never detached refs) to preserve `this` binding.
- The aggregator `expectations.ts` deliberately stays a value module to satisfy `oxc/no-barrel-file`.
- Plan: `docs/superpowers/plans/2026-07-24-tier1b-e2e-parity-retrofit.md`; design: `docs/superpowers/specs/2026-07-24-tier1b-e2e-parity-retrofit-design.md`; triage: `docs/superpowers/plans/2026-07-24-tier1b-triage.md`.

## Related Decisions

- ADR-0324: Tier-Aware Scenario Catalog Ledger — the ledger machinery this retrofit feeds.
- ADR-0325: Tier 1 Provider-Real Parity Lane — the lane and constraints (frozen fake, one-way import, exclusion honesty) this change extends; T1b landed on the same branch/PR #191.
- ADR-0282: Hermetic E2E Master Baseline — the Docker e2e harness the Kaneo binding runs under.

## References

- `tests/stories/harness/parity/expectations.ts` and `tests/stories/harness/parity/expectations/*.ts`
- `tests/e2e/parity/provider-parity.test.ts` (Kaneo binding, unchanged — iterates `PARITY_GROUPS`)
- `tests/stories/catalog/coverage.ts` (`CATALOG_SOURCE` provenance, `@1` records)
