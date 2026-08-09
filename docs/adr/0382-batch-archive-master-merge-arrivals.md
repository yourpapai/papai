<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0382: Batch Lane-0 archive of master-merge arrivals into the frozen superpowers tree

## Status

Implemented

## Date

2026-08-09

## Context

The `sdd-openspec` branch froze `docs/superpowers/` and drained its shipped
plans (Lane 0, commit `12dbd6713` — 71 plans + 58 paired specs archived with
MADR records ADR-0309…0379) as part of the superpowers → OpenSpec migration.
The freeze README declares the tree frozen with "no new files" under it.

`origin/master` has **not** adopted the migration (it changed nothing under
`openspec/`) and kept using the legacy `superpowers/plans` + `specs` workflow
for live work. Merging `origin/master` into `sdd-openspec` brought **74 new
files** that master had added under the frozen tree after the Lane-0 drain:

- **37 plans** under `docs/superpowers/plans/` — surfaced as rename/relocation
  conflicts because our branch had drained that directory, with git suggesting
  each relocate to `docs/archive/`.
- **37 paired design specs** under `docs/superpowers/specs/` — merged cleanly
  (our branch never drained `specs/`).

Content review shows these are master's shipped work-product: mutation-coverage
plans (whose Stryker baseline ratchets landed on master), UX review findings
(`transcript-*`, `admin-instances`, `admin-users`, `settingsapp-shell`,
`adminapp`, `coding-mcp`) merged via PRs, a progress/stats renderer, and the
`agent-check-loop` implementation plan for the opencode-agent spike.

## Decision Drivers

- **Keep the migration intact.** Letting 74 live docs sit in a tree we declare
  frozen-and-no-new-files would make the freeze a self-contradiction and undo
  the Lane-0 drain's discipline.
- **Honor Lane-0's shape.** Shipped plans archive **paired with their specs**
  — the established pattern.
- **Don't block the merge on per-file rigor.** Lane-0's per-plan MADR
  assessment (71 individual ADRs) was a one-time corpus drain with dedicated
  tooling (`scripts/plan-adr-workflow.ts`); replicating it for 74 more files
  mid-merge is infeasible at the same quality.
- **Conflicts must resolve now anyway.** The 37 plans had no home post-drain;
  a decision was forced.

## Considered Options

### Option 1 — Batch Lane-0 archive + single batch ADR (chosen)

Move all 74 (37 plans + 37 specs) to `docs/archive/` as paired pairs; record
this single batch ADR instead of 74 individual MADRs.

- **Pros:** consistent with Lane-0's archive-paired-with-spec shape; resolves
  the forced conflicts; one decision record captures the whole batch; tree
  returns to a coherent frozen state.
- **Cons:** lower per-file rigor than Lane-0's individual ADRs (accepted — the
  content is recent, mostly machine-named, and verifiable in master's PR
  history); one ADR covers heterogeneous content.

### Option 2 — 74 individual MADR assessments (rejected)

Run the per-plan workflow for each file.

- **Pros:** matches Lane-0's per-plan ADR count exactly.
- **Cons:** infeasible at merge quality; Lane-0 used dedicated tooling and
  multi-model assessment over a frozen corpus, not a live merge; the marginal
  value over a batch record is low for recent, PR-verifiable work.

### Option 3 — Defer / keep in place (rejected)

Leave the 37 specs in `docs/superpowers/specs/` and move the 37 plans back to
`docs/superpowers/plans/`; triage later.

- **Pros:** smallest merge.
- **Cons:** reverts the Lane-0 drain for these files; leaves the tree
  self-contradictory with its own freeze banner; the 37 plan conflicts still
  force a decision now.

## Decision

Adopt Option 1. All 74 files are archived to a flat `docs/archive/` as paired
plan+spec pairs (basenames unchanged), as a continuation of Lane-0. This ADR
is the single batch record covering them.

The 37 plans retained their git-detected relocation to `docs/archive/`
(`git add`); the 37 specs were `git mv`'d from `docs/superpowers/specs/` to
`docs/archive/` to sit beside their plans.

**Notable content.** `agent-check-loop` is the one item that reads as a spike
(opencode-agent GitHub Actions issue agent) rather than shipped behavior; it
is archived here as historical record. If that work is still active, it should
be re-proposed fresh under OpenSpec (`/opsx:propose`), not resurrected from the
archive.

## Consequences

### Positive

- The frozen tree is coherent again: no live master additions sit under
  `docs/superpowers/`.
- The merge is unblocked; master's feature work (the actual code, tests,
  mutation ratchets) lands cleanly.
- Lane-0's archive shape (paired plan+spec) is preserved.

### Negative

- 74 archived files lack individual ADR assessment (lower rigor than Lane-0's
  per-plan MADR). Mitigation: they are recent and verifiable in master's PR
  history; the batch ADR names the categories.
- Master's contributors may still reference the old `docs/superpowers/` paths
  (master hasn't migrated). Mitigation: `docs/archive/` keeps the basenames;
  the freeze README points readers there.

### Risks

- A future contributor mistakes an archived spike (`agent-check-loop`) for
  shipped behavior. **Mitigation:** this ADR flags it.
- Master keeps adding to `docs/superpowers/` post-merge, re-creating the
  tension. **Mitigation:** the migration needs to land on master itself; until
  then, repeat-merge arrivals follow this same batch-archive procedure.

## Related Decisions

- Lane-0 drain (`12dbd6713`, ADRs 0309…0379) — the precedent this batch
  continues.
- `migrate-brainstorming-to-openspec`, `legacy-corpus-porting-procedure` — the
  migration design and runbook defining Lane 0.
- ADR-0380 / ADR-0381 (`latent-queue-disposition`) — companion dispositions of
  other items caught in the same migration.

## References

- Runbook: `docs/operations/legacy-migration-runbook.md` (Lane 0)
- Lane-0 commit: `12dbd6713`
- Merge: `origin/master` → `sdd-openspec` (this commit)
- Disposition change: `openspec/changes/latent-queue-disposition/`
