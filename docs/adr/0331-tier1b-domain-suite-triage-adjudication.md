<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0331: Tier 1b Domain-Suite Triage — Authoritative CORE/NEW/EXCLUDE/RESIDUE/META Classification and Controller Adjudication for the Parity Retrofit

## Status

Accepted

## Date

2026-07-24

## Context

ADR-0330 decided to fold the 77 Kaneo-only domain tests across the 11 `tests/e2e/` suites into
the shared Tier 1 parity lane (12 → 29 `PARITY_GROUPS`, 140 → 157 catalog ids) and retire the
duplicates. One of its decision drivers was **triage before conversion**: with 77 candidate
tests, every conversion and every deletion had to be traceable to an authoritative classification
table rather than ad-hoc judgment. Task 0 of the retrofit plan therefore produced
`docs/superpowers/plans/2026-07-24-tier1b-triage.md`, classifying every `test(...)` into
**CORE** (already covered by an existing parity group — delete), **NEW** (migrates to one of the
17 new target ids), **EXCLUDE** (documents a fake/Kaneo divergence — keep in suite), **RESIDUE**
(Kaneo-only raw-payload or non-deterministic behavior — keep, uncatalogued), and **META**
(test-harness self-tests — untouched).

The raw classification surfaced four tensions the executing controller had to adjudicate:

1. **Finding 1 — unbacked target ids.** `SCN-parity-task-dates` and `SCN-parity-task-long-title`
   had zero backing NEW rows in the 77-test corpus; 20 raw NEW rows mapped onto only 15 distinct
   target ids.
2. **Finding 2 — folded rows not literally covered.** Two label error tests were folded into
   `SCN-parity-project-label-errors` and one startDate-override test into
   `SCN-parity-task-preserve-startdate`, but the drafted group code did not assert those exact
   behaviors.
3. **Findings 3 & 4 — undocumented divergences.** The assignee round-trip/filter divergence and
   `createTask`-against-nonexistent-project divergence were exercised by domain tests but had no
   planned `PARITY_EXCLUSIONS` entries.
4. **Findings 5–7 — judgment calls** extending the brief's literal pre-seed wording (label
   listing folded into `label-crud`; `dueBefore`/`dueAfter` paging test kept RESIDUE to avoid
   silently losing unique coverage; soft try/catch comment-error test kept RESIDUE; all 5
   `user-workflows` tests deleted per the brief's override).

## Decision Drivers

- **Auditable deletions.** Task 7 deletes tests in bulk; every deletion must trace to a bucket
  assignment and, where it diverges from the raw table, to a recorded adjudication.
- **Verbatim group code stays frozen.** The retrofit plan's drafted parity-group code was already
  verified; broadening groups to absorb near-miss tests risks divergence-gate failures.
- **Honest exclusion surface.** Every fake/Kaneo divergence a kept test documents must have a
  `PARITY_EXCLUSIONS` entry with a `KaneoProvider`-naming reason, so the ledger reflects reality.
- **Deterministic ledger accounting.** Adjudications must not shift the ledger (12 → 29 groups,
  140 → 157 ids) unless explicitly reconciled.
- **No silent coverage loss.** A test that is the *only* proof of a behavior (e.g.
  `dueBefore`/`dueAfter` filtering) must not be bucketed into a category that deletes it.

## Considered Options

### Option 1 — Adjudicate by reclassification and additive exclusions, keep group code verbatim (chosen)

Accept the 2 unbacked ids as intended net-new coverage (Task 2 mints them outright); reclassify
the 3 folded NEW rows to RESIDUE and remove them from the retirement list; add 2
`PARITY_EXCLUSIONS` entries (`assignee`, `create-task-invalid-project`) with
`KaneoProvider`-naming reasons in Task 7; accept Findings 5–7 as sound judgment calls. Net Task 7
effect: retire 35 explicit CORE/NEW tests + all 5 `user-workflows` = 40 tests; final exclusion
count 23.

- **Pros:** drafted group code untouched (zero divergence-gate risk); folded behaviors stay
  proven in their slimmed suites instead of being deleted; divergences honestly recorded; ledger
  unchanged; every adjudication recorded in the triage document itself.
- **Cons:** 3 behaviors remain uncatalogued residue rather than parity-proven; exclusion count
  grows beyond the original plan (sanctioned by the retrofit's reconciliation rule).

### Option 2 — Broaden the drafted parity groups to literally cover the folded rows (rejected)

Rewrite Task 2/5 group code to assert workspace-label `updateLabel`/`removeLabel` against missing
ids and explicit startDate override, keeping the 3 rows NEW and retiring them.

- **Pros:** those behaviors gain two-binding parity proof; residue count shrinks by 3.
- **Cons:** diverges from the plan's verbatim group code, re-opening divergence-gate risk late in
  execution; behavior surface creep beyond what the brief confirmed; the adjudication explicitly
  declined this.

### Option 3 — Classify strictly per the brief's pre-seed with no judgment calls (rejected)

Treat the pre-seed wording as exhaustive: no folding, no extensions, no recorded deviations.

- **Pros:** zero controller discretion; simplest audit story.
- **Cons:** literally contradicts observed test bodies (soft try/catch cannot back a strict
  `.rejects.toThrow()` id); would have bucketed the unique `dueBefore`/`dueAfter` test as CORE and
  deleted it, silently losing that coverage; leaves the assignee and project-validation
  divergences undocumented.

## Decision

Adopt Option 1, recorded as the controller adjudication block in the triage document, which
overrides the raw table for the rows it names:

1. **Finding 1 — ACCEPT.** `SCN-parity-task-dates` and `SCN-parity-task-long-title` are minted
   net-new in Task 2. No ledger shift.
2. **Finding 2 — RECLASSIFY 3 folded rows NEW → RESIDUE (keep, uncatalogued):**
   `task-lifecycle.test.ts` "overrides startDate when updating it explicitly" (distinct from
   preservation-only `SCN-parity-task-preserve-startdate`); `label-operations.test.ts` "throws
   error when updating non-existent label" and "throws error when removing non-existent label"
   (workspace-label CRUD on missing id, distinct from `SCN-parity-project-label-errors`'s
   `removeTaskLabel` detach-missing case). Removed from the retirement list; target ids remain
   backed by their other rows. No ledger change.
3. **Findings 3 & 4 — ADD 2 `PARITY_EXCLUSIONS` entries** (`assignee`,
   `create-task-invalid-project`), each with a `KaneoProvider`-naming reason. Final exclusion
   count 21 + 2 = 23. The EXCLUDE domain tests they document stay in their suites.
4. **Findings 5–7 — ACCEPT** as recorded judgment calls, including deleting all 5
   `user-workflows` tests (none surfaces a unique atom).

Net effect on Task 7: retire 35 explicit CORE/NEW tests + 5 `user-workflows` = **40** tests;
`column-management.test.ts` and `task-list-compatibility.test.ts` untouched (zero CORE/NEW rows,
cross-validated against the retrofit plan's own Task 7 file list).

## Consequences

### Positive

- Every deletion in Task 7 traces to a bucket plus, where applicable, an explicit adjudication —
  bulk retirement is auditable row by row.
- The 3 reclassified tests keep their behavioral proof (startDate override, workspace-label
  missing-id errors) instead of being silently deleted.
- The exclusion ledger honestly covers all known divergences: 23 `PARITY_EXCLUSIONS` entries,
  every one naming `KaneoProvider`.
- The drafted parity-group code shipped verbatim; the per-wave Docker divergence gate faced no
  late scope changes.
- Classification tallies reconcile exactly (21 C + 20 N + 25 E + 8 R + 3 M = 77), matching the
  brief's per-suite counts with zero discrepancy.

### Negative

- 3 behaviors (startDate override, 2 workspace-label error paths) remain Kaneo-only residue —
  fake drift there would not be caught by the parity lane.
- Exclusion count grew beyond the plan's original 21, requiring the reconciliation rule to
  legitimate the arithmetic after the fact.
- The triage document itself is long-lived debt: it is the authoritative record for why the
  suites look the way they do and must be consulted before re-slimming.

### Risks

- Future contributors may read the raw tables without the adjudication block and mis-derive the
  intended end state. Mitigation: the adjudication block is placed first and marked as
  overriding; this ADR restates it.
- If the fake later grows workspace-label or assignee validation, the reclassified residue tests
  and the 2 new exclusions become stale. Mitigation: exclusions carry reasons naming the exact
  provider behavior; residue tests remain in suites where drift would surface as a failure.

## Implementation Notes

- Triage artifact: `docs/superpowers/plans/2026-07-24-tier1b-triage.md` (classification tables +
  findings + adjudication + retirement list).
- New exclusions landed in `tests/stories/harness/parity/expectations.ts` (`assignee`,
  `create-task-invalid-project`, alongside `search-invalid-workspace` and
  `relation-directionality`).
- 17 new ids minted across `tests/stories/harness/parity/expectations/{tasks,search,comments,errors,relations}.ts`.
- `tests/e2e/user-workflows.test.ts` deleted in full; 8 other suites slimmed per the adjudicated
  retirement list; `column-management.test.ts` and `task-list-compatibility.test.ts` untouched.

## Related Decisions

- ADR-0324: Tier-aware scenario catalog ledger — the ledger accounting this triage preserves.
- ADR-0325: Tier 1 provider-real parity lane — the lane and frozen-fake policy the buckets serve.
- ADR-0330: Tier 1b E2E parity retrofit — the parent retrofit; this triage is its Task 0.

## References

- `docs/superpowers/plans/2026-07-24-tier1b-triage.md` — the classification tables, findings, and
  controller adjudication recorded here as an architectural decision.
- `tests/stories/harness/parity/expectations.ts` — final `PARITY_EXCLUSIONS` surface.
