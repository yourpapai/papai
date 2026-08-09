<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0420: Roll out the OpenSpec migration to master via strangler drain-on-arrival

## Status

Accepted

## Date

2026-08-10

## Context

The superpowers → OpenSpec migration is **complete on the `sdd-openspec`
branch**: the routing layer (`migrate-brainstorming-to-openspec`, 15/15), the
porting runbook (`legacy-corpus-porting-procedure`, 5/5), the freeze tidy
(`superpowers-residue-cleanup`, 6/6), and the queue-item dispositions
(`latent-queue-disposition`, 6/6) are all done. `docs/superpowers/` is frozen
and drained (0 plans, 0 remaining); `CLAUDE.md`/`AGENTS.md` route new
code-behavior work through `/opsx:explore` / `/opsx:propose`; `mutation-improve`
and the benchmark script are retargeted to `openspec/changes/`.

`origin/master` has **not** adopted the migration. It changed nothing under
`openspec/` and keeps producing plans + specs under `docs/superpowers/` via the
legacy flow. Merging `origin/master` into `sdd-openspec` (this week) brought 74
such arrivals, drained per Lane 0 with per-plan ADRs (0383–0419). The freeze
README's "Late arrivals" section already states this recurs on every master
merge "until master itself migrates."

The migration is therefore not yet **real**: it lives on a branch, and a
recurring drain tax accrues on every merge until master adopts OpenSpec. No
prior artifact addresses landing the migration on master or transitioning its
contributors — that gap is what this ADR closes.

The rollout's central constraint is in-flight branches. As of this writing,
**~19 active branches touch `docs/superpowers/`**, several heavily:
`adr-opencode-model` (103 superpowers commits), `memory-vector-graph-research`
(71), `agents/implementation-status-analysis` (60, two variants),
`hermetic-stories-continue` (48), `docs/papai-nerv-plugin-design` (43),
`acp-review-automation` (43), `plugin-core-separation` (17), and ~12 more with
1–8 commits. All produce content in the exact tree the migration froze/drained.

The rollout merge itself is mechanically trivial: after this week's merge,
`sdd-openspec` is a superset of `master`, so `master ← sdd-openspec` is a clean
(fast-forward-able) merge landing the freeze + rewiring + ADRs. The hard part
is the branches and the contributor-behavior switch, not git.

A pre-flight check cleared the obvious blocker: `src/instances/bootstrap.ts:97`
references `docs/superpowers/specs/…` only in a **comment** (a stale spec
citation), not a runtime read of the frozen tree.

## Decision Drivers

- **Do not block ~19 in-flight branches.** Several carry 40–100+ commits of
  old-style work; forcing each to rebase + migrate its content is large
  distributed labor and several will stall.
- **Match the charter's own model.** The migration was designed as a strangler
  ("no backfill, lazy via `/opsx:propose` when adopted"). The rollout should
  apply the same model to in-flight work, not contradict it with a big-bang.
- **End the recurring drain.** The drain tax accrues until master migrates;
  the rollout is what stops it. Any procedure that leaves master producing
  legacy content indefinitely fails this driver.
- **Minimize distributed labor.** Prefer a procedure where branch owners do
  nothing different; centralize the migration cost in an owned drain step.
- **Reversibility.** The freeze + rewiring are docs/convention changes,
  revertible if the cutover breaks something.

## Considered Options

### Option A — Strangler drain-on-arrival (chosen)

Merge `sdd-openspec → master`; declare cutover for **new** work (routing table
authoritative); in-flight branches finish old-style and merge as-is; an **owned
drain** step archives their `docs/superpowers/` arrivals (Lane 0 + per-plan
ADR) at merge time, exactly as done this week. New branches use OpenSpec. The
drain tax ends when the last pre-cutover branch merges.

- **Pros:** branches unblocked (no per-branch migrate); minimal distributed
  labor; consistent with the charter; the drain procedure is already proven;
  the rollout merge is trivial.
- **Cons:** an ongoing drain tax until sunset; two workflows coexist on master
  during limbo (OpenSpec for new, draining for old).

### Option B — Big-bang migrate-every-branch (rejected)

Every in-flight branch rebases onto migrated master and moves its
plan/spec → `openspec/changes/<name>/`, rewriting references.

- **Pros:** clean end state; no drain tax.
- **Cons:** ~19 branches × large per-branch labor (some with 100 commits);
  several will stall or be abandoned; contradicts the charter's lazy model;
  infeasible at the exposure scale observed.

### Option C — Wait for branches to land first, then merge (rejected)

Let the 19 branches merge to master (finishing old-style), then merge
`sdd-openspec → master` onto a quieter tree.

- **Pros:** minimizes branch disruption and arrivals at cutover.
- **Cons:** some branches are long-lived (research/architecture tracks); could
  wait weeks; the migration stays in limbo and the drain tax keeps accruing in
  the meantime. Defers the problem rather than deciding.

### Option D — Soft / phased rollout (rejected)

Land the CLAUDE.md/tooling rewiring first without a hard freeze, let
contributors switch gradually, then freeze + drain.

- **Cons:** the freeze already shipped on `sdd-openspec`; a phased unwind is
  more work than committing to it. Two workflows coexist by design for an
  unbounded period — strictly worse limbo than Option A's bounded one.

## Decision

Adopt Option A. The rollout procedure:

1. **Pre-flight (on `sdd-openspec`, before merge)** — re-verify the
   `CLAUDE.md`/`AGENTS.md` routing table, the `mutation-improve` and
   `tool-surface-benchmark` retargets; `bun check:full` + `openspec validate`
   green; fix the stale comment at `src/instances/bootstrap.ts:97`.
2. **The merge** — `git checkout master && git merge sdd-openspec --no-ff`.
   Clean (superset). Lands the freeze, rewiring, tooling retargets, ADRs.
3. **Cutover declaration** — the routing table becomes authoritative: new
   code-behavior work enters via `/opsx:explore` / `/opsx:propose`. Communicate
   that in-flight branches may finish in the old style. No enforcement code —
   the routing + freeze README carry it.
4. **Owned drain** — each merge-to-master of a pre-cutover branch brings
   `docs/superpowers/` arrivals; drain them per Lane 0 (archive + per-plan
   ADR), as done this week. **This must be an owned step**, not tribal
   knowledge: either a scripted helper
   (`scripts/drain-master-arrivals.ts` — packaging the ad-hoc procedure used
   this week) or a defined merge-reviewer responsibility in the runbook.
5. **In-flight branches** — finish old-style; the drain catches them at merge.
   No rebase/migrate required.
6. **Sunset** — the drain tax ends when the last pre-cutover branch merges.
   The freeze is then "real" (no new arrivals); the drain procedure retires.

## Consequences

### Positive

- The migration becomes real (lands on master); the structural gap closes.
- ~19 in-flight branches are unblocked — they finish without per-branch
  migration labor.
- The recurring drain tax has a defined end (sunset), not an indefinite accrual.
- Consistent with the charter's strangler model — no contradiction at rollout.

### Negative

- During limbo, master carries two planning workflows (OpenSpec for new work,
  draining for old). Contributors must know which applies to whom.
- The drain must be owned; if left tribal, arrivals accumulate silently (the
  original failure mode this migration was meant to end).

### Risks

- **Long-lived pre-cutover branches extend the drain.** If
  `memory-vector-graph-research`, `acp-review-automation`, or similar don't
  merge for weeks, the limbo runs long and the drain handles 40–100+ arrivals
  per branch. **Mitigation:** set a sunset date; after it, un-merged old-style
  branches must migrate (flip to Option B for those specific branches) or be
  retired.
- **Drain ownership drift.** **Mitigation:** choose the script form (deterministic)
  over the runbook form (relies on a reviewer remembering) at execution time.
- **A contributor misses the cutover and opens new superpowers work post-cutover.**
  **Mitigation:** the freeze README + CLAUDE.md routing surface it on first
  read; the drain catches accidental arrivals without data loss.

## Open Questions

- **Cutover date** — not set; pick when the pre-flight passes and key
  stakeholders are notified. Does not change the procedure.
- **Sunset mechanism** — date-based vs. "last pre-cutover branch merged."
  Date-based is firmer (forces the flip-to-Option-B decision for stragglers).
- **Drain ownership form** — `scripts/drain-master-arrivals.ts` vs. a
  merge-reviewer runbook step. Decide at execution; the script is more
  reliable, the runbook step is lower-tech.
- **Long-lived branch triage** — before cutover, confirm which of the ~19
  branches are active vs. abandoned. Abandoned branches drop out of the drain
  calculus entirely; long-lived active ones are candidates for per-branch
  Option B if their arrival count would exceed migrate cost.

## Implementation Status

Not yet executed — the cutover merge is pending (date TBD per Open Questions).
This ADR records the decision and procedure so it can be executed against when
the pre-flight passes.

## Related Decisions

- `migrate-brainstorming-to-openspec` (charter, 15/15) — the migration this
  rolls out; its strangler/lazy design is the basis for Option A.
- `legacy-corpus-porting-procedure` (runbook, 5/5) — defines Lane 0, which the
  owned-drain step (4) applies to post-cutover arrivals.
- ADR-0382 (deleted) and ADRs 0383–0419 — the drain precedent: this week's
  74 arrivals drained per Lane 0 with per-plan ADRs. The owned-drain step
  packages that procedure.
- ADR-0380 / ADR-0381 (`latent-queue-disposition`) — companion dispositions.

## References

- Migration charter: `openspec/changes/migrate-brainstorming-to-openspec/proposal.md`
- Porting runbook: `docs/operations/legacy-migration-runbook.md`
- Freeze + late-arrivals note: `docs/superpowers/README.md`
- Drain precedent: `openspec/changes/latent-queue-disposition/`, ADRs 0383–0419
- Pre-flight finding: `src/instances/bootstrap.ts:97` (comment-only, non-blocking)
