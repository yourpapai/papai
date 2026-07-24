<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# T1b triage: `tests/e2e/*` domain-suite classification for the parity retrofit

Task 0 of `docs/superpowers/plans/2026-07-24-tier1b-e2e-parity-retrofit.md`. Classifies every
`test(...)` in the 11 domain suites under `tests/e2e/` (excludes `docker-lifecycle.test.ts`,
infra, and `e2e.test.ts`, the 0-test aggregator) into **CORE** / **NEW** / **EXCLUDE** /
**RESIDUE** / **META**, per the buckets defined in `.superpowers/sdd/task-0-brief.md`.

**Reconciliation: 21 CORE + 20 NEW + 25 EXCLUDE + 8 RESIDUE + 3 META = 77 = the expected total.**
No discrepancy against the brief's per-suite counts (column-management 10, error-handling 7,
label-operations 7, project-lifecycle 4, project-management 3, task-comments 12,
task-lifecycle 9, task-list-compatibility 3, task-relations 10, task-search 7,
user-workflows 5).

**NEW-row count vs. distinct target-id count:** 20 raw NEW rows map onto only **15 of the 17**
target ids (several ids absorb more than one row — e.g. `SCN-parity-task-errors` absorbs 3,
`SCN-parity-project-label-errors` absorbs 3, `SCN-parity-task-preserve-startdate` absorbs 2).
The NEW *row* count therefore differs from 17, but the **distinct id** count does not — no NEW
row needs an 18th id, so the ledger (12 → 29 groups, 140 → 157 catalog ids) does **not** shift.
Two of the 17 target ids have **zero** backing NEW rows in the existing 77-test corpus; see
Finding 1.

## Controller adjudication (governs where it differs from the tables below)

Resolved 2026-07-24 by the executing controller; this block **overrides** the raw table
classifications for the rows it names.

- **Finding 1 — ACCEPT.** `SCN-parity-task-dates` and `SCN-parity-task-long-title` are intended
  net-new coverage (the retrofit plan's Task 2 mints them with full code). No ledger shift.
- **Finding 2 — RECLASSIFY the 3 folded rows NEW → RESIDUE (keep them; do NOT retire).** The
  drafted parity groups do not literally cover these behaviors, and broadening the groups was
  declined to keep the plan's verbatim group code and avoid divergence-gate risk. These 3 tests
  stay in their slimmed suites, uncatalogued; they are removed from the Retirement list:
  - `task-lifecycle.test.ts` — "overrides startDate when updating it explicitly" (distinct from
    `SCN-parity-task-preserve-startdate`, which tests preservation only).
  - `label-operations.test.ts` — "throws error when updating non-existent label" and "throws
    error when removing non-existent label" (workspace-label CRUD on a missing id; distinct from
    `SCN-parity-project-label-errors`'s `removeTaskLabel` detach-missing case).
  The target ids remain backed: `SCN-parity-task-preserve-startdate` by "preserves startDate when
  updating only the title"; `SCN-parity-project-label-errors` by project-lifecycle "throws error
  when updating non-existent project" + its drafted `removeTaskLabel`-missing case. **No ledger
  change** (distinct-id count unchanged).
- **Findings 3 & 4 — ADD 2 `PARITY_EXCLUSIONS` entries in Task 7** (`assignee`,
  `create-task-invalid-project`), each with a `KaneoProvider`-naming reason. Final exclusion count
  becomes **21 + 2 = 23** (19 existing + `search-invalid-workspace` + `relation-directionality` +
  these 2). The EXCLUDE domain tests they document stay in their suites (Task 7 deletes only
  CORE/NEW). Sanctioned by the retrofit plan's reconciliation rule ("counts you write are computed
  from what actually landed").
- **Findings 5–7 — ACCEPT** as sound judgment calls.

**Net effect on Task 7:** retire 41 − 3 = **38** explicit CORE/NEW tests + all 5 `user-workflows`
= **43** tests removed (not 46); keep the 3 reclassified RESIDUE tests; add 2 exclusion entries.

## Findings for the controller (read before Task 2/5/7)

1. **`SCN-parity-task-dates` and `SCN-parity-task-long-title` are unbacked.** No domain test in
   any of the 11 suites exercises a dedicated "task dates round-trip" or "very long title"
   scenario cleanly enough to back these two ids (task-lifecycle's assignee+dates test is the
   closest match but is itself EXCLUDE — see Finding 3). These 2 of the 17 ids are genuine
   net-new coverage Task 2 adds outright, not migrations of an existing test. Confirm this is
   intended before minting them.
2. **Two NEW rows were folded into ids whose current Task 2/5 draft code doesn't literally
   cover them:**
   - `label-operations.test.ts` — "throws error when updating non-existent label" and "throws
     error when removing non-existent label" were folded into `SCN-parity-project-label-errors`.
     That group's drafted code (Task 5) asserts `updateProject`/`removeTaskLabel` against a
     missing id but not workspace-level `updateLabel`/`removeLabel` against a missing label id.
     Recommend Task 5 broaden the group's assertions, or accept these two behaviors as coverage
     not migrated 1:1.
   - `task-lifecycle.test.ts` — "overrides startDate when updating it explicitly" was folded
     into `SCN-parity-task-preserve-startdate`. That group's drafted code (Task 2) tests startDate
     *preservation* when unrelated fields update, not *explicit override* when startDate itself
     is passed. Recommend Task 2 add an override assertion, or accept the gap.
3. **No `PARITY_EXCLUSIONS` entry is planned (Tasks 1-8) for the "assignee" divergence**, even
   though the brief pre-seeds "assignee round-trip / assignee-filter" as EXCLUDE and three
   domain tests hit it directly: `task-lifecycle.test.ts` "creates and retrieves a task with
   startDate, dueDate, and assignee", `task-search.test.ts` "filters locally by assigneeId
   without dropping the assigned task", and `task-list-compatibility.test.ts` "honors status and
   assignee filters". `KaneoProvider` requires the assignee to reference a real workspace-user
   id; `MemoryTaskProvider` accepts any string with no such validation. Recommend minting an
   explicit `assignee` `PARITY_EXCLUSIONS` entry (style-matched to the existing 19) before or in
   Task 7, alongside whatever happens to these three tests.
4. **No `PARITY_EXCLUSIONS` entry is planned for `createTask` against a non-existent project
   id either.** `error-handling.test.ts` "throws error when creating task in non-existent
   project" is a genuine divergence — verified directly against
   `tests/stories/harness/memory-task-provider.ts`: `createTask` never calls `requireProject`
   and accepts any `projectId` silently, while `KaneoProvider.createTask` rejects an unknown
   project. Same recommendation as Finding 3.
5. **Two judgment calls extend the brief's literal pre-seed wording (recorded per the brief's
   "do not invent classifications contradicting the confirmed lists without recording why"
   instruction):**
   - `label-operations.test.ts` "lists all labels in workspace" — the pre-seed literally names
     only "label create/update"; this test was folded into the same EXCLUDE (`label-crud`)
     bucket because it exercises the identical workspace-label surface and no NEW target id
     addresses generic label listing.
   - `task-list-compatibility.test.ts` "honors page, limit, sortBy, sortOrder, dueBefore, and
     dueAfter" — bucketed RESIDUE rather than CORE/EXCLUDE. It partially overlaps
     `SCN-parity-task-list-paging`/`-sort` (already CORE) but is the *only* test in the whole
     77-test corpus that proves `dueBefore`/`dueAfter` filtering. Bucketing it CORE would cause
     Task 7 to delete it and silently lose that coverage; RESIDUE keeps it in the slimmed suite.
   - `error-handling.test.ts` "throws error when getting comments for non-existent task" — read
     in full: it is a soft `try { … } catch { … }` that accepts *either* a thrown error or an
     empty array, not a deterministic two-sided assertion, so it cannot back
     `SCN-parity-comment-errors` (that id is instead backed by `task-comments.test.ts` "throws
     error when adding comment to non-existent task", which uses a strict
     `.rejects.toThrow()`). Bucketed RESIDUE, matching the pre-seed's "Kaneo-only,
     non-deterministic" spirit even though it isn't a literal `kaneoApiJsonParsed`/invalid-key
     example.
6. **Cross-validation against the plan's own Task 7 file list.** Task 7 in
   `2026-07-24-tier1b-e2e-parity-retrofit.md` lists exactly 9 files to edit (task-lifecycle,
   task-search, task-comments, task-relations, error-handling, label-operations,
   project-lifecycle, project-management, user-workflows) and omits `column-management.test.ts`
   and `task-list-compatibility.test.ts`. This triage independently finds those two suites have
   **zero** CORE/NEW rows — the only two suites where that holds — which is exactly why they
   need no edits. This agreement is strong evidence the classification below matches the plan
   author's intent.
7. **`user-workflows.test.ts`:** 3 of its 5 tests bucket CORE and 2 bucket EXCLUDE (no test in
   this suite is NEW). Per the brief's explicit override ("migrate any genuinely-unique atom the
   table surfaces; otherwise mark all 5 for deletion"), none of the 5 surfaces a unique atom
   beyond CORE/EXCLUDE coverage already present elsewhere, so Task 7 deletes **all 5**, including
   the 2 EXCLUDE-bucketed ones — noted explicitly in the Retirement list below.

## Suite tables

Bucket legend: **C**=CORE, **N**=NEW, **E**=EXCLUDE, **R**=RESIDUE, **M**=META.

### `tests/e2e/column-management.test.ts` (10) — tally C0 N0 E10 R0 M0

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| creates a column with all properties | E | `status-crud` — column/status shape has no fake analogue (order-free, `isFinal`-bearing) |
| creates a final column | E | `status-crud` |
| lists columns in project | E | `status-crud` |
| updates column name | E | `status-crud` |
| updates column color and icon | E | `status-crud` |
| reorders columns | E | `status-reorder` |
| deletes a column | E | `status-crud` |
| creates column without optional properties | E | `status-crud` |
| throws error when updating non-existent column | E | `status-crud` |
| throws error when deleting non-existent column | E | `status-crud` |

### `tests/e2e/error-handling.test.ts` (7) — tally C0 N4 E1 R2 M0

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| throws error for non-existent task | N | `SCN-parity-task-errors` |
| throws error when updating non-existent task | N | `SCN-parity-task-errors` |
| throws error when creating task in non-existent project | E | Project-validation divergence — `MemoryTaskProvider.createTask` never calls `requireProject`; `KaneoProvider` rejects unknown project ids. No `PARITY_EXCLUSIONS` entry planned yet (Finding 4) |
| throws error when deleting non-existent task | N | `SCN-parity-task-errors` |
| throws error with invalid API key | R | Pre-seeded RESIDUE: Kaneo-only auth-layer behavior, no fake equivalent |
| throws error when getting comments for non-existent task | R | Soft try/catch tolerant of either outcome — not a deterministic parity assertion (Finding 5) |
| handles special characters in task title | N | `SCN-parity-task-special-chars` |

### `tests/e2e/label-operations.test.ts` (7) — tally C0 N2 E4 R1 M0

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| creates a label with name and color | E | `label-crud` |
| updates label name and color | E | `label-crud` |
| lists all labels in workspace | E | `label-crud` (extended by judgment call — Finding 5) |
| shows attached labels through the dedicated task-label endpoint and removes them after detach | R | `kaneoApiJsonParsed` raw-payload assertions against `/label/task/:id` and `/label/workspace/:id` throughout |
| keeps unattached label deletion blocked and allows attached label deletion | E | `label-crud` — unattached-label-deletion restriction has no `MemoryTaskProvider.removeLabel` analogue |
| throws error when updating non-existent label | N | `SCN-parity-project-label-errors` (folded — Finding 2) |
| throws error when removing non-existent label | N | `SCN-parity-project-label-errors` (folded — Finding 2) |

### `tests/e2e/project-lifecycle.test.ts` (4) — tally C2 N1 E1 R0 M0

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| creates and lists projects | C | `SCN-parity-project-crud` |
| updates a project | C | `SCN-parity-project-crud` |
| lists columns in a project | E | `status-crud` — uses the raw `listColumns` plugin function, not the generic `TaskProvider.listStatuses` abstraction |
| throws error when updating non-existent project | N | `SCN-parity-project-label-errors` |

### `tests/e2e/project-management.test.ts` (3) — tally C3 N0 E0 R0 M0

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| deletes a project | C | `SCN-parity-project-crud` |
| updates project name and description | C | `SCN-parity-project-crud` |
| lists projects in workspace | C | `SCN-parity-project-crud` |

### `tests/e2e/task-comments.test.ts` (12) — tally C4 N4 E0 R1 M3

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| returns true when task-comments is the sole explicit test target | M | Test-target-detection meta-test, not provider behavior |
| returns false for the aggregated e2e entrypoint | M | Test-target-detection meta-test |
| returns false when multiple explicit test files are targeted | M | Test-target-detection meta-test |
| adds a comment to a task | C | `SCN-parity-comment-crud` |
| retrieves comments for a task | C | `SCN-parity-comment-crud` |
| updates a comment | C | `SCN-parity-comment-crud` |
| keeps comment IDs stable through provider update and delete flows | N | `SCN-parity-comment-id-stability` |
| removes a comment | C | `SCN-parity-comment-crud` |
| raw dedicated comment endpoints return the documented update and delete fields | R | `kaneoApiJsonParsed` raw-payload assertion on dedicated comment endpoint fields |
| throws error when adding comment to non-existent task | N | `SCN-parity-comment-errors` |
| handles long comments | N | `SCN-parity-comment-long` |
| handles special characters in comments | N | `SCN-parity-comment-special-chars` |

### `tests/e2e/task-lifecycle.test.ts` (9) — tally C4 N4 E1 R0 M0

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| creates and retrieves a task | C | `SCN-parity-task-create` / `SCN-parity-task-get` |
| updates a task | C | `SCN-parity-task-update` |
| lists tasks in a project | C | `SCN-parity-task-list-paging` / `SCN-parity-task-list-sort` |
| searches tasks by keyword | C | `SCN-parity-task-search` |
| creates task with all properties | N | `SCN-parity-task-full-property` |
| creates and retrieves a task with startDate, dueDate, and assignee | E | Assignee divergence — no `PARITY_EXCLUSIONS` entry planned yet (Finding 3) |
| preserves startDate when updating only the title | N | `SCN-parity-task-preserve-startdate` |
| overrides startDate when updating it explicitly | N | `SCN-parity-task-preserve-startdate` (folded — Finding 2) |
| returns null dates when a task is created without startDate and dueDate | N | `SCN-parity-task-null-dates` |

### `tests/e2e/task-list-compatibility.test.ts` (3) — tally C0 N0 E1 R2 M0

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| keeps null dueDate stable and exposes plannedTasks key in raw list payload | R | `kaneoApiJsonParsed`-style raw-payload assertion — `plannedTasks` is a Kaneo-specific raw list envelope key |
| honors status and assignee filters | E | Status/column-shape + assignee divergence (pre-seeded "assignee round-trip/assignee-filter") |
| honors page, limit, sortBy, sortOrder, dueBefore, and dueAfter | R | Judgment call (Finding 5) — only test proving `dueBefore`/`dueAfter` filtering; kept out of CORE to avoid losing that coverage in Task 7 |

### `tests/e2e/task-relations.test.ts` (10) — tally C4 N2 E3 R1 M0

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| adds blocks relation between tasks | C | `SCN-parity-relation` |
| maps blocks to blocked_by on the target task | E | Relation directionality (pre-seeded) |
| adds related relation | C | `SCN-parity-relation` |
| adds parent relation | E | Relation directionality — subtask/parent-child materialization (pre-seeded) |
| maps subtask relations back to parent and child in opposite directions | E | Relation directionality (pre-seeded) |
| updates relation type | C | `SCN-parity-relation` |
| relation update leaves exactly one live relation in the raw Kaneo payload | R | Raw Kaneo-storage-specific relation-count assertion, no fake equivalent |
| removes relation | C | `SCN-parity-relation` |
| handles multiple relations on same task | N | `SCN-parity-relation-multiple` |
| error when relating to non-existent task | N | `SCN-parity-relation-errors` |

### `tests/e2e/task-search.test.ts` (7) — tally C1 N3 E2 R1 M0

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| searches tasks by title keyword | C | `SCN-parity-task-search` |
| searches across all projects | N | `SCN-parity-search-all-projects` |
| returns empty results for non-matching search | N | `SCN-parity-search-empty` |
| adapts the live search envelope and still finds tasks with null dates | R | Kaneo-specific raw search-envelope/null-date adaptation, no fake equivalent |
| respects projectId and limit together | N | `SCN-parity-search-projectid-limit` |
| filters locally by assigneeId without dropping the assigned task | E | Assignee divergence (pre-seeded "assignee round-trip/assignee-filter") |
| search with invalid workspace returns empty or throws | E | Pre-seeded invalid-workspace EXCLUDE; becomes the new `search-invalid-workspace` `PARITY_EXCLUSIONS` entry (Task 3) |

### `tests/e2e/user-workflows.test.ts` (5) — tally C3 N0 E2 R0 M0

| Test name | Bucket | Target id / Reason |
| --- | --- | --- |
| full task lifecycle workflow | C | Redundant with `SCN-parity-task-update` coverage |
| project setup workflow | E | Column-shape divergence (`status-crud`); no unique atom beyond `column-management` coverage |
| task dependencies workflow | E | Relation directionality (`parent` relation); no unique atom beyond `task-relations` coverage |
| bulk operations workflow | C | Redundant with `SCN-parity-task-update`/list coverage |
| task handoff workflow | C | Redundant with `SCN-parity-task-update` coverage |

All 5 are deleted in Task 7 regardless of bucket, per the brief's explicit override (Finding 7).

## Target counts (restated ledger)

- Parity groups: **12 → 29** (17 new groups: 6 task, 3 search, 3 comment, 4 error, 1 relation).
- Catalog scenario ids: **140 → 157**.
- New `PARITY_EXCLUSIONS` entries added by the plan: 2 (`search-invalid-workspace` — Task 3,
  `relation-directionality` — Task 6), on top of the 19 existing entries — 21 total after Tasks
  1-8, **not counting** the 2 additional entries this triage recommends (`assignee`,
  project-validation — Findings 3 & 4), which the controller should decide whether to fold in
  before or alongside Task 7.
- Per-wave NEW targets (from the retrofit plan): tasks (6 ids: `SCN-parity-task-dates`,
  `-full-property`, `-preserve-startdate`, `-null-dates`, `-special-chars`, `-long-title`);
  search (3 ids: `-search-all-projects`, `-search-empty`, `-search-projectid-limit`); comments
  (3 ids: `-comment-id-stability`, `-comment-long`, `-comment-special-chars`); errors (4 ids:
  `-task-errors`, `-comment-errors`, `-relation-errors`, `-project-label-errors`); relations (1
  id: `-relation-multiple`) — 17 ids total, 15 backed by ≥1 NEW row in this triage, 2 unbacked
  (Finding 1).

## Retirement list (Task 7 deletes exactly these 41 tests, plus all 5 of `user-workflows`)

**`tests/e2e/project-lifecycle.test.ts`** (3): creates and lists projects; updates a project;
throws error when updating non-existent project.

**`tests/e2e/project-management.test.ts`** (3): deletes a project; updates project name and
description; lists projects in workspace.

**`tests/e2e/task-comments.test.ts`** (8): adds a comment to a task; retrieves comments for a
task; updates a comment; keeps comment IDs stable through provider update and delete flows;
removes a comment; throws error when adding comment to non-existent task; handles long comments;
handles special characters in comments.

**`tests/e2e/task-lifecycle.test.ts`** (8): creates and retrieves a task; updates a task; lists
tasks in a project; searches tasks by keyword; creates task with all properties; preserves
startDate when updating only the title; overrides startDate when updating it explicitly; returns
null dates when a task is created without startDate and dueDate.

**`tests/e2e/task-relations.test.ts`** (6): adds blocks relation between tasks; adds related
relation; updates relation type; removes relation; handles multiple relations on same task;
error when relating to non-existent task.

**`tests/e2e/task-search.test.ts`** (4): searches tasks by title keyword; searches across all
projects; returns empty results for non-matching search; respects projectId and limit together.

**`tests/e2e/error-handling.test.ts`** (4): throws error for non-existent task; throws error when
updating non-existent task; throws error when deleting non-existent task; handles special
characters in task title.

**`tests/e2e/label-operations.test.ts`** (2): throws error when updating non-existent label;
throws error when removing non-existent label.

**`tests/e2e/user-workflows.test.ts`** (5, all — per Finding 7, including the 2 EXCLUDE-bucketed
rows since neither surfaces a unique atom): full task lifecycle workflow; project setup workflow;
task dependencies workflow; bulk operations workflow; task handoff workflow.

Total explicit CORE/NEW rows: 41 (3+3+8+8+6+4+4+2), plus the 5 `user-workflows` rows deleted under
the brief's override = 46 tests removed from `tests/e2e/` by Task 7.

**Untouched by Task 7** (zero CORE/NEW rows, confirmed against the plan's own file list — Finding
6): `tests/e2e/column-management.test.ts`, `tests/e2e/task-list-compatibility.test.ts`.
