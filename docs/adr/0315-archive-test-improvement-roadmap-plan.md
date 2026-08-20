<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0315: Archive the Test Improvement Roadmap Plan — Substantially Implemented, Remainder Not Worth Chasing

## Status

Accepted

## Date

2026-08-07

## Context

`docs/superpowers/plans/2026-03-22-test-improvement-roadmap.md` (~415 lines, 6
phases, ~100 checkboxes) is a systematic test-quality roadmap produced from a
full-suite audit of the then-74 test files. It defines six phases: Phase 1
(fix false-confidence tests — `bot-auth`, `comment-tools`, `label-operations`,
`logger`, `bot.test.ts`), Phase 2 (fill critical module gaps — scheduler,
`completionHook`, `processMessage` error routing, untested exports), Phase 3
(strengthen YouTrack schema and Kaneo client suites), Phase 4 (common-sense
scenario gaps), Phase 5 (E2E hardening), and Phase 6 (test infrastructure,
isolation, Stryker scope/threshold expansion).

A codebase verification against the current tree (2026-08-07) found the plan
**partially implemented — its critical goals done, its bookkeeping stale**:

- **Phase 1 done, in an evolved shape.** `tests/bot-auth.test.ts` is replaced
  by the `tests/auth/` suite (`guest-mode-auth.test.ts` calls
  `checkAuthorizationExtended` with field-level assertions); `tests/bot.test.ts`
  is now a real 90-test `bot.ts` suite instead of misplaced format tests;
  format tests live in `tests/utils/format.test.ts`;
  `tests/tools/comment-tools.test.ts` uses correct `{taskId, commentId}`
  params; no `expect(true).toBe(true)` remains in
  `tests/e2e/label-operations.test.ts`; `tests/logger.test.ts` covers
  `getLogLevel` (case-insensitivity, invalid/unset fallback) plus multistream
  filtering.
- **Phase 2 done.** `tests/scheduler.test.ts` has 21 tests plus split
  `scheduler-integration` / `scheduler-recurring` / `scheduler-instance` /
  `scheduler-chat-di` suites (exceeding the ≥10 definition of done);
  `tests/tools/completion-hook.test.ts` exists; `allOccurrencesBetween`,
  `appendHistory`, and the Kaneo workspace getters/setters are covered in
  `tests/cron.test.ts`, `tests/history.test.ts`, and
  `tests/providers/resolver.test.ts`.
- **Task 4.4.8 done.** `tests/errors.test.ts` tests all five previously missing
  provider error codes (`projectNotFound`, `commentNotFound`,
  `relationNotFound`, `statusNotFound`, `invalidResponse`).
- **Tasks 6.3.1–6.3.4 done.** `stryker.config.json` mutate scope includes
  `src/cron.ts`, `src/recurring.ts`, `src/history.ts`, `src/conversation.ts`.
- **All ~100 checkboxes remain unchecked (0%).** The plan's checkbox state
  was never synced with the work as it landed, so the document misreports a
  substantially-executed roadmap as untouched.
- **The remaining items are largely overtaken by restructuring.** Phase 3's
  target `tests/providers/youtrack/schemas/` no longer exists — providers
  moved to `plugins/task-provider-*`; the Kaneo client now lives at
  `plugins/task-provider-kaneo/client.ts` with no co-located test file at the
  plan's old paths. Most Phase 4–6 leftovers are "not individually verified"
  rather than "confirmed missing."
- **One concrete confirmed gap:** `stryker.config.json` `thresholds.break` is
  40, not the planned 50 (task 6.3.5).
- **The plan is not marked superseded**, has no Spec:/Design: reference, and
  sits in the legacy `docs/superpowers/` corpus slated for triage per
  `docs/operations/legacy-migration-runbook.md`.

## Decision Drivers

- **The plan's purpose is fulfilled.** The roadmap's headline goals —
  eliminating the five false-confidence test files and covering the critical
  autonomous/request-path modules — are met. What remains is Phases 4–6 polish
  that the plan itself rated Medium/Low priority.
- **The remaining checklist is stale against the current tree.** File paths,
  module names, and provider locations referenced by Phases 3–5 no longer
  exist, so executing those tasks "as written" requires re-deriving each
  target anyway — the checklist no longer functions as an executable spec.
- **Quality gates have superseded the plan's endgame.** The repo now enforces
  a per-file mutation-score ratchet (`test:mutate:changed` + baseline), a
  coverage floor (`coverage:ratchet`), and routes new test coverage through
  OpenSpec proposals (`/opsx:propose` before new E2E coverage, per
  `tests/AGENTS.md`). Incremental hardening now flows through those gates
  rather than a static 50–70h roadmap.
- **Chasing ~40 stale checkboxes costs more than it returns.** Auditing every
  Phase 4/5/6 item against restructured suites is a medium-effort,
  low-marginal-value exercise; the one concrete confirmed gap (break threshold
  40→50) is a trivial independent change, not a reason to keep a roadmap open.
- **The legacy corpus is under triage.** Per the legacy-migration runbook,
  `docs/superpowers/plans/` items are being archived, adopted, seeded, or
  retired one at a time; this plan fits "retire as substantially implemented."

## Considered Options

### Option 1 — Archive the plan as substantially implemented; route residuals through existing gates (chosen)

Mark the plan superseded/archived with a pointer to this ADR. Do not execute
the remaining Phase 3–6 checkboxes as a batch. Handle the break-threshold bump
(40→50) as a standalone change once a green `bun test:mutate` run confirms the
floor holds, and let any genuinely-missing coverage surface through the
mutation ratchet, coverage floor, or a targeted OpenSpec proposal.

- **Pros:** removes a misleading 0% shelf entry; matches effort to actual
  value; acknowledges the work that already landed; future hardening flows
  through the repo's current quality gates and planning workflow instead of a
  stale checklist; the plan is preserved as an audit artifact.
- **Cons:** some Phase 4–6 items may be genuinely missing and stay
  unaddressed until a gate or a reviewer notices; the historical checklist is
  never fully reconciled box-by-box.

### Option 2 — Execute the remaining phases to 100% checkbox completion (rejected)

Audit and implement every remaining item: YouTrack schema depth (3.1), Kaneo
header-value tests (3.2), `processMessage` error routing (2.3), Phase 4 edge
cases, Phase 5 E2E hardening, Phase 6 isolation/mock standardisation, break
threshold 50.

- **Pros:** checklist honesty; any genuinely-missing coverage gets found.
- **Cons:** medium-high effort (~20–30h of audit + implementation) for
  low-marginal-value polish; many targets no longer exist at the referenced
  paths, so each task needs re-derivation against the restructured tree;
  duplicates what the mutation ratchet and coverage floor already enforce
  incrementally; new E2E coverage is required to enter via `/opsx:propose`
  anyway, not via a legacy plan.

### Option 3 — Port the remainder into a fresh OpenSpec change now (rejected)

Create `openspec/changes/test-hardening-remainder/` carrying the surviving
gaps and execute it.

- **Pros:** residuals land on the correct planning track with current paths.
- **Cons:** builds a speculative batch of unrequested test polish ahead of any
  concrete signal; the right time to propose such a change is when a gate
  fails or a specific gap bites, so the work is scoped to a real need rather
  than a stale checklist.

## Decision

**Archive the plan as substantially implemented. Do not execute the remaining
Phase 3–6 checkboxes as a batch.**

1. **Mark the plan superseded** and relocate it off the active
   `docs/superpowers/plans/` shelf (e.g. to `docs/archive/`), with a
   superseded marker and a pointer to this ADR, so it no longer presents as
   0% actionable backlog.
2. **Record that Phases 1–2, task 4.4.8, and tasks 6.3.1–6.3.4 are done**,
   having landed in an evolved shape (auth suite, split scheduler suites,
   `plugins/task-provider-*` restructure) rather than the plan's literal file
   paths.
3. **Do not batch-execute Phases 3–6 leftovers.** Any genuinely-missing
   coverage is expected to surface through the mutation-score ratchet, the
   coverage floor, or code review, and to be addressed via a targeted
   `/opsx:propose` change — not via this legacy checklist.
4. **Handle task 6.3.5 (break threshold 40→50) independently**: bump
   `stryker.config.json` `thresholds.break` to 50 only after a green
   `bun test:mutate` run confirms the floor holds; this is a standalone config
   change, not a reason to keep the roadmap open.
5. **Preserve the plan as an audit artifact.** Its per-file scores and gap
   analysis remain useful historical input for any future targeted
   test-hardening proposal.

## Consequences

### Positive

- A substantially-executed roadmap stops misreporting as 0% actionable
  backlog.
- The legacy corpus triage advances: one more `docs/superpowers/plans/` item
  resolved.
- No effort is spent re-deriving and executing stale checkbox items whose
  file targets no longer exist.
- Completed work (auth suite, scheduler suites, completionHook, error-code
  coverage, Stryker scope) is acknowledged as fulfilling the plan's critical
  goals.
- Future test hardening flows through the repo's current gates (mutation
  ratchet, coverage floor, OpenSpec proposals) instead of a frozen checklist.

### Negative

- Some Phase 4–6 items may be genuinely missing coverage and remain so until
  a gate or reviewer surfaces them.
- The checkbox-level reconciliation is never completed; the archived plan's
  0% checkbox state requires this ADR as the interpretive key.
- The Stryker break threshold stays at 40 until the standalone bump lands.

### Risks

- **Future agents rediscover the plan and treat it as actionable.**
  Mitigation: the relocated copy carries a superseded marker and a pointer to
  this ADR.
- **A Phase 4–6 gap hides a real weakness.** Mitigation: the mutation ratchet
  and coverage floor gate the affected files on every change; a concrete
  failure would re-scope the work via `/opsx:propose` against current paths.
- **The threshold bump is forgotten.** Mitigation: it is recorded here as the
  single surviving concrete action item.

## Related Decisions

- **ADR-0309** — Archive the Phase 10 Notification Controls Plan;
  **ADR-0310** — Archive the Preprocessing Classifier Plan;
  **ADR-0311** — Archive the Layered Architecture Violations Fix Plan;
  **ADR-0312** — Archive the Deep-Thinking Tool Research Plan;
  **ADR-0313** — Archive the User Profile Memory Plan;
  **ADR-0314** — Archive the Phase 09 Event-Driven Suggestions Plan: the
  precedent for archiving a stale / low-worthiness legacy plan with an ADR
  rather than executing it.
- **OpenSpec migration** (`AGENTS.md` Pi Workflow;
  `docs/operations/legacy-migration-runbook.md`; the
  `legacy-corpus-porting-procedure` change under `openspec/changes/`):
  establishes that new code-behavior and test-coverage work enters through
  `/opsx:propose`, which is what makes batch-executing this legacy checklist
  redundant.

## References

- Plan: `docs/superpowers/plans/2026-03-22-test-improvement-roadmap.md`
  (6 phases, ~100 checkboxes, 50–70h estimate; Status: Draft; no
  Spec:/Design: reference; not marked superseded).
- Triage basis: `docs/operations/legacy-migration-runbook.md`
  (`docs/superpowers/` → OpenSpec lanes).
- Quality gates: `scripts/mutation/baseline.json`, `scripts/coverage/floor.json`,
  `stryker.config.json`, `tests/AGENTS.md`.
- Codebase verification (2026-08-07): Phase 1 files rewritten/replaced
  (`tests/auth/`, `tests/bot.test.ts`, `tests/utils/format.test.ts`,
  `tests/logger.test.ts`, `tests/tools/comment-tools.test.ts`,
  `tests/e2e/label-operations.test.ts`); `tests/scheduler.test.ts` at 21 tests
  plus split suites; `tests/tools/completion-hook.test.ts` present;
  `tests/errors.test.ts` covers all five provider error codes;
  `stryker.config.json` mutate scope includes `cron`/`recurring`/`history`/
  `conversation` but `thresholds.break` is 40 (task 6.3.5 open);
  `tests/providers/youtrack/schemas/` absent after the
  `plugins/task-provider-*` restructure; all plan checkboxes unchecked.
