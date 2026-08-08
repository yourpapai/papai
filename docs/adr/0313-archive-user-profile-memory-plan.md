<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0313: Archive the User Profile Memory Plan — Defer Phase A of Per-User Profile Memory

## Status

Accepted

## Date

2026-08-07

## Context

`docs/superpowers/plans/2026-04-08-user-profile-memory.md` (~3,043 lines, 21
tasks) specifies "Phase A" of a per-user profile memory system: a single
markdown blob per user in a new `user_profile` SQLite table, populated by a
background extraction runner (`runProfileExtractionInBackground`) that fires
alongside the existing smart-trim runner, plus two hot-path LLM tools
(`remember_about_user`, `forget_user_profile`) for explicit edits. The blob is
injected into the system prompt as an `=== User profile ===` section in DM
contexts only; group contexts get no profile, fewer tools, and no extraction
trigger. The plan mirrors the existing `memory_summary` / `save_instruction`
patterns and is TDD-structured end to end.

The plan declares an authoritative design doc,
`docs/plans/2026-04-08-user-profile-memory-design.md`, stating "Decisions there
are final. Read this before starting any task."

A codebase verification against the current tree (2026-08-07) found the plan
**not implemented**:

- **0/21 on the Summary checklist.** All twenty-one task checkboxes remain
  unchecked (lines 3023–3043): migration, cache slot, profile module,
  `extractProfile` + validation, `applyRemember` / `applyForget`,
  `buildProfileContextMessage`, the `contextType` threading refactor,
  `buildMemoryContextMessage` extension, DM-only profile loading, the
  background runner, the trim-trigger wiring, `USER_PROFILE_RULES`, the two
  tools, tool gating, `/profile` + `/profile clear`, bot registration, help
  text, `/context` export, and the final integration pass.
- **None of the target files exist.** `src/db/migrations/019_user_profile.ts`,
  `src/profile.ts`, `src/tools/profile.ts`, `src/commands/profile.ts`, and the
  three matching test files are all absent.
- **No source markers landed.** Zero hits in `src/` for `userProfile`,
  `user_profile`, `USER_PROFILE_RULES`, `runProfileExtractionInBackground`,
  `syncProfileToDb`, `getCachedProfile`, `buildProfileContextMessage`,
  `remember_about_user`, `forget_user_profile`, or `registerProfileCommand`.
  `src/db/schema.ts` has no `user_profile` table; `src/commands/help.ts` has
  no `/profile` line.
- **The authoritative design doc does not exist.** No
  `docs/plans/*user-profile*` file is present anywhere under `docs/` (the only
  match is the plan itself), so the plan's declared-final decisions cannot be
  verified.
- **The plan is stale against current code.** Its Task 1 targets migration
  slot `019`, but `019_user_identity_mappings.ts` already occupies that slot —
  the plan fails as written without renumbering to `020` or later.
- **The plan is not marked superseded** and no related OpenSpec change folder
  exists.

The prerequisite the plan depends on — `ContextType = 'dm' | 'group'` and
`IncomingMessage.contextType` in `src/chat/types.ts` — is present, so a future
re-entry is not blocked by missing grounding code.

## Decision Drivers

- **The plan is not directly executable as written.** Its declared-authoritative
  design doc is missing ("Decisions there are final"), and Task 1's migration
  number collides with an already-shipped migration. Implementing it requires
  reconstruction of decisions the plan says are already settled.
- **The planning workflow has moved to OpenSpec.** Per `AGENTS.md` (Pi
  Workflow), code-behavior work now enters through `/opsx:explore` /
  `/opsx:propose` under `openspec/changes/<name>/`, and an OpenSpec proposal
  carries its own `design.md`. The standalone `docs/plans/` design-doc
  deliverable this plan depends on is a retired location.
- **High effort for speculative value.** Twenty-one cross-cutting tasks (DB +
  cache + conversation + orchestrator + tools + commands + system prompt),
  including a broad `contextType` threading refactor that touches many call
  sites and their tests, for a feature with no requesting user.
- **No demonstrated demand.** The plan is ~4 months old (2026-04-08) with zero
  checklist activity and no driving request.
- **The plan lives in a legacy corpus under triage.** `docs/superpowers/plans/`
  is already slated for migration per
  `docs/operations/legacy-migration-runbook.md`; leaving an un-actioned,
  stale plan on the active shelf invites future effort against a target that
  no longer matches the repo's planning model.
- **The underlying feature is sound.** User profile personalization is
  genuinely useful and the `memory_summary`-mirroring approach is proven, so
  this is a "not now, not this way" decision rather than a "never" decision.

## Considered Options

### Option 1 — Archive the plan; re-enter via OpenSpec if the feature is requested (chosen)

Mark the plan superseded and relocate it off the active plans shelf (e.g. to
`docs/archive/`) with a superseded marker and a pointer to this ADR. If
per-user profile memory is ever genuinely requested, re-enter through
`/opsx:explore` / `/opsx:propose` under `openspec/changes/<name>/`, where the
proposal's own `design.md` reconstructs the decisions the missing design doc
was meant to settle — grounded in the then-current `memory_summary` /
`small_model` / tool-assembly conventions and the next available migration
slot, rather than the retired `docs/plans/` location and the colliding `019`.

- **Pros:** stops effort flowing into a non-executable, stale plan; removes a
  misleading 0/21 shelf entry; avoids reconstructing a "final" design doc that
  was never written; the task descriptions are preserved in the archived plan
  as input for any future proposal.
- **Cons:** profile memory stays unbuilt and no design doc lands; if the
  feature is later requested, the design work restarts from scratch (though
  against a fresher codebase than this plan's 2026-Q1 snapshot).

### Option 2 — Implement the 21 tasks as written (rejected)

Execute Tasks 1–21 verbatim, producing `src/profile.ts`, the two tools, the
`/profile` command, and the `contextType` threading refactor.

- **Pros:** a complete, TDD-structured task list already exists; the feature is
  coherent and mirrors a proven pattern.
- **Cons:** blocked by the missing authoritative design doc; Task 1 fails on
  the migration-number collision; the cross-cutting `contextType` refactor
  (Task 9) churns many call sites and tests for an unrequested feature; the
  `docs/plans/` design-doc deliverable duplicates what an OpenSpec proposal's
  `design.md` would carry.

### Option 3 — Port to OpenSpec now and implement (rejected)

Re-enter the feature through `/opsx:propose` immediately, rewrite the missing
design doc as the proposal's `design.md`, renumber the migration, and build
Phase A.

- **Pros:** ships the feature on the correct planning track with a real design
  doc.
- **Cons:** builds a speculative, unrequested feature ahead of demand; the
  right time to port is when a concrete request arrives, so the design is
  grounded in an actual use case rather than a 4-month-old, never-started
  plan.

## Decision

**Archive the plan. Do not implement it — neither the migration, the module,
the tools, the command, nor the missing design doc.**

1. **Mark the plan superseded** and relocate it from the active
   `docs/superpowers/plans/` shelf (e.g. to `docs/archive/`), with a superseded
   marker and a pointer to this ADR, so it no longer presents as actionable
   backlog.
2. **Do not write `docs/plans/2026-04-08-user-profile-memory-design.md`.** The
   `docs/plans/` deliverable location is retired; design work belongs in an
   OpenSpec proposal's `design.md` if the feature is ever pursued.
3. **Do not add `user_profile`, `userProfile`, profile tools, or `/profile`
   now.** No migration, schema table, cache slot, `src/profile.ts` module,
   `remember_about_user` / `forget_user_profile` tools, `USER_PROFILE_RULES`,
   or `/profile` command is to be introduced on the basis of this plan.
4. **Re-route through OpenSpec if the feature is later requested.** Any future
   per-user profile memory work enters through `/opsx:explore` /
   `/opsx:propose` under `openspec/changes/<name>/`, treating this plan's task
   descriptions (extraction prompt, sanity ceiling, validation branches, DM-only
   gating, background-runner shape) as **input**, not as a contract — and
   grounded in the then-current migration slot and `memory_summary` pattern,
   not the colliding `019` or the retired `docs/plans/` location.

## Consequences

### Positive

- A high-effort, stale, non-executable plan is removed from the actionable
  backlog.
- The active plans shelf no longer carries a 4-month-old, 0/21 target whose
  authoritative design doc is missing.
- No time is spent reconstructing a "final" design doc that was never written
  or churning the broad `contextType` refactor (Task 9) for an unrequested
  feature.
- The plan's TDD scaffold (prompts, validation branches, tool schemas, test
  shapes) is preserved in the archived copy as input for any future OpenSpec
  proposal.

### Negative

- Per-user profile memory stays unbuilt, and no design document for it exists.
- If the feature is later requested, the design exploration restarts from
  scratch rather than building on a completed design doc.

### Risks

- **Future agents rediscover the stale plan and treat it as actionable.**
  Mitigation: the plan's relocated copy and this ADR both carry the superseded
  marker and a pointer here.
- **Profile memory becomes genuinely needed and the deferral cost looks
  unjustified.** Mitigation: re-entry through `/opsx:propose` is one step, the
  archived plan's task descriptions accelerate it, and the result lands on the
  correct planning track with a migration number that doesn't collide.
- **The plan's design intent is lost.** Mitigation: the plan is relocated, not
  deleted; its prompts, option tables, and test shapes remain available as
  OpenSpec input.

## Related Decisions

- **ADR-0309** — Archive the Phase 10 Notification Controls Plan;
  **ADR-0310** — Archive the Preprocessing Classifier Plan;
  **ADR-0311** — Archive the Layered Architecture Violations Fix Plan;
  **ADR-0312** — Archive the Deep-Thinking Tool Research Plan: the precedent
  for archiving a stale / superseded / low-worthiness plan with an ADR rather
  than executing it.
- **OpenSpec migration** (`AGENTS.md` Pi Workflow; see also the
  `legacy-corpus-porting-procedure` change under `openspec/changes/` and
  `docs/operations/legacy-migration-runbook.md`): establishes that
  code-behavior design now lives in OpenSpec proposals, which is what makes
  this plan's `docs/plans/` design-doc dependency redundant.

## References

- Plan: `docs/superpowers/plans/2026-04-08-user-profile-memory.md`
  (21-task TDD plan; declared-authoritative design doc
  `docs/plans/2026-04-08-user-profile-memory-design.md`).
- Triage basis: `docs/operations/legacy-migration-runbook.md`
  (`docs/superpowers/` → OpenSpec lanes).
- Workflow basis: `AGENTS.md` (Pi Workflow — code-behavior work enters via
  `/opsx:explore` / `/opsx:propose` under `openspec/changes/<name>/`).
- Codebase verification (2026-08-07): Summary checklist 0/21; no target files
  (`src/db/migrations/019_user_profile.ts`, `src/profile.ts`,
  `src/tools/profile.ts`, `src/commands/profile.ts`, or their tests); no
  `userProfile` / `user_profile` / `USER_PROFILE_RULES` /
  `runProfileExtractionInBackground` / `syncProfileToDb` /
  `getCachedProfile` / `buildProfileContextMessage` / `remember_about_user` /
  `forget_user_profile` / `registerProfileCommand` references in `src/`;
  migration slot `019` already occupied by
  `src/db/migrations/019_user_identity_mappings.ts`; design doc absent; plan
  not marked superseded.
