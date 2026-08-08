<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# T1b — tests/e2e parity retrofit design

**Status:** design approved, pre-plan
**Predecessor:** `docs/superpowers/specs/2026-07-23-tier1-provider-real-parity-design.md` (T1)
**Branch:** `codex/tier1-provider-real` (extends the T1 parity lane; PR #191)

## Goal

Convert the behaviors currently proven only by the Kaneo-only `tests/e2e`
domain suites into the T1 fake-vs-Kaneo parity model — one shared expectation
set run against **both** `MemoryTaskProvider` (fake, Tier 0) and real Dockerized
Kaneo (`@1`) — migrating each convertible behavior into `PARITY_GROUPS` and
retiring it from its domain suite, so every parity-able behavior has a single
source of truth and counts toward Tier-1 coverage.

## Context: why this is a retrofit, not a fresh build

The 11 `tests/e2e` domain suites (~77 tests, excluding the docker-lifecycle
infra test, the `e2e.test.ts` aggregator, and T1's `parity/`) predate the parity
lane. They:

- call the Kaneo provider primitives directly (`createTask`, `getTask`, … from
  `plugins/task-provider-kaneo/`), not a shared abstraction;
- assert raw Kaneo storage shapes via `kaneoApiJsonParsed('/task/${id}', schema)`;
- encode Kaneo-specific quirks (e.g. `task-lifecycle.test.ts:98` — priority
  update is broken in the Kaneo API; three tests pin Kaneo's `startDate`
  storage behavior);
- are **not in the story catalog** — the catalog references `tests/e2e/` only
  through T1's parity lane (`TIER_SUITE_ROOTS['1']`, the 12 `SCN-parity-*` ids).
  The ~77 domain tests are entirely uncounted in the 140/113/27 totals.

T1 already covers 12 behavior groups. T1b extends that set with the domain
suites' **additional** behaviors, without re-covering what T1 already proves.

## Decisions (locked during brainstorming)

1. **Scope = convert to parity** (not catalog-as-is): domain behaviors become
   fake+Kaneo parity groups.
2. **Migrate & retire, single source**: a converted behavior is deleted from
   its Kaneo-only suite; only genuinely Kaneo-specific residue stays behind in
   slimmed suites, **uncatalogued**.
3. **Fake stays frozen** (T1 rule carried forward): `MemoryTaskProvider` is not
   modified. Behaviors the fake cannot echo become RESIDUE/EXCLUDE, never a
   reason to change the fake. (The fake's `createTask`/`updateTask` are
   permissive echo stores, so most field-level behaviors convert for free.)
4. **Approach C**: a triage table classifying every domain test is produced and
   reviewed **before** any group is written (Task 0), then feeds a single
   extended `PARITY_GROUPS` array (approach A's infra reuse).
5. **user-workflows (5 composite tests) dropped as redundant** — their atomic
   steps are already covered by CORE + NEW groups; migrate any genuinely-unique
   atom, otherwise delete.
6. **Error-parity consolidated by domain** (~3–4 groups), not one group per
   entity.

## Architecture: the four-stage pipeline

```
1. TRIAGE   → classify all ~77 domain tests into 4 buckets (the spec backbone)
2. EXTEND   → each NEW-bucket behavior becomes a group appended to the single
              frozen PARITY_GROUPS array
3. MIGRATE  → delete the migrated test from its Kaneo-only suite; leave only
              RESIDUE tests behind in slimmed suites
4. ACCOUNT  → mint one @1 id per new group in coverage.ts; bump ledger totals;
              the Task-7 catalog cross-check auto-covers new groups
```

Both bindings (`expectations.fake.test.ts`, `tests/e2e/parity/provider-parity.test.ts`)
and the catalog cross-check iterate `PARITY_GROUPS` generically, so every new
group flows to both fake+Kaneo execution and catalog verification with no
per-group machinery.

## Triage taxonomy

Every domain test lands in exactly one bucket:

| Bucket | Meaning | Fate |
| --- | --- | --- |
| **CORE** | already proven by one of T1's 12 groups | delete from suite; no new group |
| **NEW** | fake echoes it + Kaneo matches normalized shape | new `PARITY_GROUPS` entry + `@1` id |
| **EXCLUDE** | genuine fake↔Kaneo divergence | documented exclusion, not a group |
| **RESIDUE** | Kaneo-only (raw shape, invalid-key, envelope) | stays in slimmed suite, uncatalogued |
| **META** | not a provider-behavior test | untouched, out of scope |

### NEW families (the spec's new parity groups)

- **error-parity** (consolidated, ~3–4 groups) — both providers throw on a
  missing entity: non-existent task get/update/delete, comment-on-missing-task,
  relate-to-missing, update/remove missing label/column/project. Grouped by
  domain (task-errors, comment-errors, label/column/project-errors,
  relation-errors). A category T1 did not cover.
- **field-depth** (~5) — full-property create; startDate/dueDate/assignee
  round-trip; preserve-startDate-on-title-update; override-startDate; null-dates.
  Fake echoes all; Kaneo round-trips them (T1 confirmed the update path).
- **content-edge** (~3) — long comments; special characters in titles and
  comments.
- **search-variant** (~4) — across-all-projects; empty results; projectId+limit
  together; assignee-filter. The fake's `searchTasks` supports every filter.
- **comment-depth** (~1) — comment id-stability through update/delete flow.
- **relation-basic** (~1) — multiple relations on one task (beyond T1's single
  `relation` group).

Estimated total: **~17–18 NEW groups**. Exact count is an output of the Task-0
triage table, not a guess baked into the plan.

### Confirmed EXCLUDE / RESIDUE / META

- **EXCLUDE** (genuine divergence, matches T1's existing exclusion rationale):
  - column/status CRUD + reorder (T1 already excluded `status-crud` /
    `status-reorder`);
  - label create/update (T1 excluded `label-crud`);
  - list status/assignee/date filters (T1 excluded `task-list-filter`);
  - **relation directionality** — blocks→blocked_by and subtask↔parent/child.
    The fake stores a flat directed map and does not materialize inverses;
    Kaneo does. Verified against `memory-task-provider.ts`.
  - invalid-workspace search (the fake has no workspace concept).
- **RESIDUE** (Kaneo-only, no fake side): every `kaneoApiJsonParsed`
  raw-payload assertion (plannedTasks key, raw comment fields, raw relation
  payload, raw date storage), invalid-API-key. These stay as slimmed Kaneo
  integration checks.
- **META**: the 3 `task-comments` test-target-detection tests
  (`returns true when task-comments is the sole explicit test target`, and its
  two siblings). Untouched.

## Files touched (all reuse T1's structure)

- `tests/stories/harness/parity/expectations.ts` (frozen) — append NEW groups;
  add exclusion notes to the exclusion ledger. **Design signal:** this file is
  already ~352 lines; +17 groups will breach `max-lines`. The plan therefore
  **splits expectations into per-domain modules** (`expectations/tasks.ts`,
  `expectations/comments.ts`, `expectations/search.ts`, `expectations/errors.ts`,
  …) re-exported into one `PARITY_GROUPS` — a sanctioned structural split, not
  limit-gaming.
- `tests/stories/catalog/coverage.ts` — mint ~17 `SCN-parity-*` `@1` ids +
  mappings (`provingTier:'1'`, storyId
  `tests/e2e/parity/provider-parity.test.ts#<title>`).
- `tests/stories/harness/catalog-coverage.test.ts` — bump the count assertions
  (140 → ~157, 113 → ~130).
- `scripts/story/coverage-totals` literals — executable count,
  `executableByTier['1']`, and the `NNN/NNN … T1 N` runner line (same 4-literal
  pattern as T1 Task 6).
- The 8–10 domain suites — delete migrated tests, slim to RESIDUE; delete
  user-workflows migrated atoms.
- `treeHash` re-baselines (sanctioned frozen-tree edit, recorded with the PR).

## Data flow for one NEW group

1. Triage row marks a domain test NEW with a target group title.
2. A group `{ title, run(provider) }` is appended to a per-domain expectations
   module and re-exported into `PARITY_GROUPS`.
3. `expectations.fake.test.ts` runs it against `MemoryTaskProvider` (Tier 0).
4. `tests/e2e/parity/provider-parity.test.ts` runs it against real Kaneo (`@1`),
   fresh provider + project per group.
5. `coverage.ts` mints its `@1` id (storyId = the real Kaneo test title).
6. The catalog cross-check asserts the minted storyId equals `provider-parity`'s
   title for that group — the only hermetic guard against a coverage.ts typo.
7. The domain suite's original test is deleted.

## Phasing — one reviewable wave per domain

**Task 0 (triage):** produce and review the full ~77-row triage table before any
group is written. This is the backbone; it prevents double-counting CORE as NEW
and mis-converting a divergence.

Then, low-risk-first:

1. task-lifecycle field-depth
2. search-variant
3. comment-depth + content-edge
4. error-parity (consolidated)
5. relation-basic
6. final sweep — delete user-workflows, confirm every RESIDUE suite still runs,
   reconcile totals

Each wave: triage rows → new groups → slim suite → mint ids → bump ledger →
verify.

## Verification (per wave and at end)

- fake binding green; Kaneo Docker lane green (new groups × both bindings);
- contracts pass; catalog cross-check ties every new `@1` id to its group title;
- the two T1 teeth-proofs (storyId-title corruption; `@1`→`@0` tier flip) still
  fail-on-mutation and revert clean;
- lint / typecheck / format / license 4/4;
- runner line `NNN/NNN … T1 N` reflects the new totals.

## Risks

| Risk | Mitigation |
| --- | --- |
| Double-counting a CORE behavior as NEW | Task-0 triage table, reviewed up front |
| A presumed-NEW behavior diverges on real Kaneo (as relation directionality did) | Caught at the wave's Docker run; reclassify to EXCLUDE |
| Docker lane wall-clock grows ~2× with ~17 new groups | Still one container; flag if it breaches T1's measured budget |
| `expectations.ts` breaches `max-lines` | Per-domain module split (planned, not reactive) |

## Out of scope

- Cataloguing RESIDUE suites as `@1` (decided against — single-source, residue
  stays uncatalogued Kaneo integration tests).
- Modifying `MemoryTaskProvider` to close fidelity gaps.
- YouTrack parity; the Tier-0 internal-fidelity drift follow-up (separate cycle,
  see `.superpowers/sdd/tier0-drift-audit.md`).
