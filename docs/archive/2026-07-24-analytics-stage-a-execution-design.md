<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics Stage A→B — execution design

**Date:** 2026-07-24
**Status:** Approved (execution decisions); implementation not started
**System design of record:** [`docs/research/analytics-metrics/02-metric-catalog.md`](../../research/analytics-metrics/02-metric-catalog.md),
[`03-privacy-consent-threat-model.md`](../../research/analytics-metrics/03-privacy-consent-threat-model.md)
**Task plan of record:** [`docs/research/analytics-metrics/06-implementation-plan.md`](../../research/analytics-metrics/06-implementation-plan.md) (Tasks 1–18)
**Sign-off:** [`docs/research/analytics-metrics/08-governance-signoff.md`](../../research/analytics-metrics/08-governance-signoff.md)

This spec pins **how** the signed research is built and rolled out. It does not
re-specify the system: metric definitions, the privacy contract, and the
task-level build plan live in the documents above and change only through
their own versioning and sign-off rules.

## Decisions

| Decision | Outcome |
|---|---|
| Scope | Full 18-task Stage A per 06 — no re-scoping; Stage B aggregate-local after merge |
| Landing | One branch (`claude/analytics-metrics-research-plan-0q1fqk`), one commit per task, one final PR |
| Build execution | Fresh subagent per task; orchestrator (main session) reviews every diff and runs every gate |
| Stage B evidence | Two consecutive complete UTC weeks of `local_aggregate` on the owner's production instance |

## 1. Task mapping & orchestration

Tasks 1–18 execute strictly in order; each builds on prior interfaces, and
06's "Public interfaces to hold stable" list is a frozen contract.

Per task:

1. Orchestrator writes a task brief containing: the task's section from 06,
   the relevant 02/03 excerpts, repo conventions (TDD write hooks, pino
   metadata-first logging, `p-limit` for bounded concurrency, Zod v4, `.js`
   import extensions, no lint-disable/type-ignore comments), the
   interface-stability list, and a **stop-and-report rule**: on any
   plan↔code conflict the subagent stops and reports instead of improvising.
2. A fresh subagent executes red→green per checkbox (2–5 minute granularity,
   no batching of red tests or implementation changes), runs the task's named
   tests, and reports gate evidence plus any deviations.
3. The orchestrator reviews the **full diff against every checkbox**, runs the
   task's named gates (named tests + `bun run typecheck` + `bun run lint`),
   verifies migration ordering when the task adds one, and creates the task's
   single commit (06 requires one commit per task, `git rev-parse HEAD`
   recorded).

If a subagent fails persistently on a task, the orchestrator takes that task
over in-session rather than retrying blindly.

## 2. Gates & evidence

Three gate layers:

- **Per-task gates.** The task's named tests plus typecheck/lint. When a task
  completes one of the 17 release-blocking privacy controls (e.g. Task 5
  normalizer → controls 1–3), that control's tests must pass and stay green;
  the orchestrator maintains a running control-status matrix from Task 1.
- **Stage A exit (merge gate).** All 18 tasks on the branch; 17 privacy
  controls green; a synthetic complete process epoch reconciles to zero;
  snapshot byte verification passes; deletion/rekey drills executed; Task
  18's binding commands all pass: `bun build:client`,
  `bun test tests/analytics tests/settings`, `bun test:client`,
  `bun run typecheck`, `bun run lint`, `bun security`, `bun run test`,
  `bun test:stories:contracts`, `bun test:stories`, plus
  `bun run format:check`, `bun security:ci`, `bun run knip`,
  `bun run duplicates`. The privacy/security owner then signs the Stage A
  evidence.
- **Evidence of record.** A committed
  `docs/research/analytics-metrics/09-stage-a-evidence.md` holding the control
  matrix, drill outputs, gate command results, and migration-order
  verification. The PR description summarizes and links it.

**Drift handling.** When the stop-and-report rule fires, the orchestrator
resolves the conflict before work continues — normally a small plan-sync
commit per the `syncing-plan-with-code` skill. If a task's plan section is
materially stale, the plan is synced *before* the subagent builds.

## 3. Branch & PR

- All work lands on the current worktree branch, one commit per task, plus
  small plan-sync commits when drift is found.
- **Rebase onto `origin/master` at three milestone boundaries** — after Tasks
  2, 8, and 13 — to bound the conflict surface. Rebases happen only at
  completed-task boundaries, never mid-task.
- **One PR at the end**, scoped to Stage A; description = summary + link to
  `09-stage-a-evidence.md` + the Stage A exit checklist. No merge until the
  exit evidence is complete and signed.
- Migrations are additive only; rollback is the runtime kill switch, never
  destructive migration reversal.

## 4. Stage B procedure (production)

After the PR merges:

1. **Deploy + enable.** `local_aggregate` is the stored default, so a normal
   deploy activates it. Verify at startup: purge barrier runs, process epoch
   opens, no analytics work on the reply hot path.
2. **Metabase.** Ad-hoc container, PoC-style: localhost-bound, read-only
   mount of the published snapshot, dashboards from Task 14's reviewed
   models. No compose changes to the production deployment.
3. **Evidence window.** Two consecutive complete UTC weeks. Any
   `unreconciled_restart_gap` day suppresses that day and restarts the
   window; deploys/restarts land before the window or are accepted as
   restarts.
4. **Weekly data-health checks** per 07: freshness, reconciliation delta,
   rejects, overflow, expiry.
5. **Exit review.** Stage B criteria (clean epochs, zero unexplained
   reconciliation delta, zero C3/raw-ID/guest-continuity findings, bounded
   overflow, 90-day expiry verified, snapshot/query SLO) recorded in the
   evidence doc with the owner's sign. A Stage C spec becomes discussable
   only after this.
6. **Rollback.** Kill switch to `off` → stop subscribers/workers → reconcile →
   system reverts to pre-analytics behavior with dormant additive tables.

## 5. Risks & scope discipline

- **Plan↔code drift** — 06 was written against the 2026-07-23 tree.
  Mitigations: stop-and-report rule, milestone rebases, sync-before-build.
- **Subagent quality variance** — mitigated by full-diff review and named
  gates; no task lands on the subagent's say-so.
- **Effort scale** — ~43 new modules, ~50 modified files, 60–80 test files
  across 18 tasks: a multi-session effort. Progress is durable (per-task
  commits); each session resumes at the next task with the control matrix and
  evidence doc as state.
- **Scope discipline** — the branch builds only what 06 specifies. New ideas
  found mid-build are parked as follow-ups in the evidence doc, not
  implemented. Stage C+ decisions wait for Stage B evidence.
- **Dormant-code hygiene** — with the kill switch off, most modules are
  unused at runtime; `knip`, `duplicates`, and lint must still pass at the
  final gate, so briefs require every module to be wired into
  registration/tests even when dormant.

## Out of scope

- Stage C (governed pseudonymous pilot), Stage D (external aggregate), Stage
  E (external pseudonymous — closed per 06 and 08).
- Any change to 02/03 definitions, the `intent.v1` taxonomy, collection-mode
  defaults, consent/retention/deletion contracts, or the 17 release-blocking
  controls — each reopens the 08 sign-off gate.
- SMALL_MODEL intent tagging (remains off per 04 and 08).
