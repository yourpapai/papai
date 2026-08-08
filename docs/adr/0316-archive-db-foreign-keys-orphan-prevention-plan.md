<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0316: Archive the DB Foreign Keys & Orphan Prevention Plan — Keep the Narrowed Recurring-Table Cascade Scope

## Status

Accepted

## Date

2026-08-07

## Context

`docs/superpowers/plans/2026-04-04-db-foreign-keys-orphan-prevention.md` (~970
lines) proposes adding database-level foreign key constraints with
`ON DELETE CASCADE` across **all** user-referencing tables so that
`removeUser(identifier)` automatically removes every dependent record. The plan
targets 10 user-referencing tables (`user_config`, `conversation_history`,
`memory_summary`, `memory_facts`, `group_members`, `recurring_tasks`,
`scheduled_prompts`, `alert_prompts`, `task_snapshots`, `memos`) plus
`recurring_task_occurrences.template_id → recurring_tasks.id`, a Drizzle
schema-wide `.references()` retrofit (Task 3), cache eviction in `removeUser`
(Task 4), a broad integration test (Task 6), and orphan cleanup before FK
enforcement (Task 7).

A codebase verification against the current tree (2026-08-07) found the plan
**partially implemented**, with the implementation deliberately narrowed to the
recurring-task slice:

**Implemented (renumbered 019 → 023):**

- `src/db/migrations/023_add_foreign_keys.ts` recreates `recurring_tasks`
  (FK → `users(platform_user_id) ON DELETE CASCADE`) and
  `recurring_task_occurrences` (FK → `recurring_tasks(id) ON DELETE CASCADE`),
  with orphan cleanup and a `PRAGMA foreign_key_check` assertion (Tasks 1, 7 —
  recurring scope only); registered in `src/db/index.ts:36` (Task 2).
- Migration tests at `tests/db/migrations/023_add_foreign_keys.test.ts` cover
  the recurring-table cascades.
- `removeUser` evicts the in-memory cache via `evictUser` at `src/users.ts:148`
  (Task 4); `evictUser` lives in `src/cache-eviction.ts:32`.
- Cascade test at `tests/recurring.test.ts:365` (Task 5); integration test
  `tests/user-cascade.test.ts` verifies `removeUser` cascades recurring
  templates and occurrences (Task 6 — recurring scope only).
- Drizzle schema declares the FK for `recurringTaskOccurrences.templateId` at
  `src/db/schema.ts:152`.

**Not implemented:**

- FK constraints on the other 10 user-referencing tables were never migrated;
  migration 023 recreates only the 2 recurring tables.
- `src/db/schema.ts` declares no `.references(() => users.platformUserId, ...)`
  on any user-referencing table (Task 3 largely missing).
- `tests/user-cascade.test.ts` covers recurring tables only, not the plan's
  full per-table cascade matrix and two-user isolation test (Task 6 incomplete).
- Orphan cleanup covers recurring tables only (Task 7 partial).

The plan has no checkboxes, no Spec/Design frontmatter reference, and is not
marked superseded.

Critically, **the schema has moved on since the plan was written**. Migrations
041/044 introduced platform instances and a composite `users` primary key
(`platform_instance_id`, `platform_user_id`); scoped context ids
(`src/chat/scoped-context.ts`, migration 043) re-keyed live conversation state
by context id rather than bare user id; and the scope model
(`src/chat/context-scope.ts`) separates thread-scoped live state from
group-shared durable assets. A blanket `REFERENCES users(platform_user_id)` is
no longer valid — or even meaningful — for much of the plan's target set.

## Decision Drivers

- **The plan's core premise is outdated.** It assumes a single-column
  `users(platform_user_id)` parent and bare `user_id` columns everywhere. The
  current schema uses a composite `users` PK and context-scoped keys, so the
  plan's SQL cannot be executed as written against today's tables.
- **The high-value slice already landed.** Recurring-task template/occurrence
  cascades (the only delete path with a demonstrated orphan problem), cache
  eviction on `removeUser`, orphan cleanup, and regression tests are all in
  place and green.
- **The remaining work is high-effort, high-risk, low-value.** Completing the
  plan means recreating 10+ live tables — including a `memos` FTS5 rebuild and
  a `memo_links` re-parenting — against migrated production shapes, to guard
  against orphan rows from a rare admin operation (`removeUser`). No
  correctness incident has been attributed to the missing cascades.
- **Several remaining tables should not cascade on user delete at all.**
  Durable, group-shared assets (memos, group_members rows tying users into
  groups, config scoped to contexts) outlive individual user removal under the
  current scope model; a user-FK cascade would actively destroy shared data.
- **The planning workflow has moved to OpenSpec.** Per `AGENTS.md` (Pi
  Workflow), any genuinely needed cascade work should re-enter through
  `/opsx:explore` / `/opsx:propose` under `openspec/changes/<name>/`, designed
  against the current scoped-context schema rather than this plan's
  early-2026 assumptions.
- **Stale plans mislead.** An open plan whose remaining tasks contradict the
  current schema presents as actionable backlog and invites harmful execution.
- **The plan lives in a legacy corpus under triage.** `docs/superpowers/plans/`
  is slated for migration per `docs/operations/legacy-migration-runbook.md`.

## Considered Options

### Option 1 — Archive the plan; document the narrowed scope in this ADR (chosen)

Mark the plan superseded and relocate it off the active plans shelf (e.g. to
`docs/archive/`) with a pointer to this ADR. Record that the FK-cascade work
was deliberately scoped to the recurring-task tables (migration 023), that the
remaining 10-table cascade sweep was assessed and rejected as outdated and
partially undesirable under the current scope model, and that any future
cascade need re-enters through OpenSpec.

- **Pros:** stops effort bleeding into a stale, schema-incompatible plan;
  removes a misleading shelf entry; preserves the shipped recurring-table
  cascades; preserves the plan's risk analysis and migration pattern as
  reference material.
- **Cons:** the 10 remaining tables still lack DB-level FK cascades to `users`;
  orphan rows from `removeUser` remain theoretically possible on those tables.

### Option 2 — Complete the plan as written (rejected)

Write a new migration recreating all 10 remaining tables with
`REFERENCES users(platform_user_id) ON DELETE CASCADE`, retrofit
`.references()` across `schema.ts` / `deferred-schema.ts` / `memos-schema.ts`,
and extend the integration test to the full per-table matrix.

- **Pros:** matches the plan's stated goal; full DB-level orphan prevention.
- **Cons:** the plan's SQL is invalid against the composite `users` PK and
  context-scoped keys, so "as written" is not even executable; recreating
  10+ live tables (including FTS5 rebuild) is high migration risk for a rare
  admin delete path; cascading deletes on group-shared durable assets (memos,
  group membership) would destroy data the scope model says must survive user
  removal. High effort, low worthiness, actively wrong in places.

### Option 3 — Re-propose the remaining cascades via OpenSpec now (rejected)

Immediately open an `/opsx:propose` change reassessing per-table cascade needs
under the scoped-context schema.

- **Pros:** produces a correct, current-schema design.
- **Cons:** there is no demonstrated demand or incident driving the work;
  opening a speculative proposal now spends design effort on an unrequested
  hardening sweep. The reassessment should happen when a concrete orphan or
  integrity problem appears, not preemptively.

## Decision

**Archive the plan. Do not implement the remaining work. Keep the shipped
recurring-table cascade scope as the final state.**

1. **Mark the plan superseded** and relocate it from the active
   `docs/superpowers/plans/` shelf (e.g. to `docs/archive/`), with a superseded
   marker and a pointer to this ADR, so it no longer presents as actionable
   backlog.
2. **Keep migration 023 as-is.** The recurring-task FK cascades
   (`recurring_tasks` → `users`, `recurring_task_occurrences` →
   `recurring_tasks`), orphan cleanup, cache eviction in `removeUser`, and
   their tests are the accepted final scope of this work.
3. **Do not add FK cascades on the remaining 10 user-referencing tables** on
   the basis of this plan. Under the current scope model, several of them are
   group-shared durable assets that must survive user removal, and the rest are
   keyed by context ids rather than a bare user FK.
4. **Re-route through OpenSpec if a concrete need appears.** Any future FK /
   cascade / orphan-cleanup work enters through `/opsx:explore` /
   `/opsx:propose` under `openspec/changes/<name>/`, designed per-table against
   the then-current scoped-context schema — treating this plan's migration
   pattern (rename/recreate/copy/drop + orphan cleanup + `foreign_key_check`)
   as reference technique, not as a contract.

## Consequences

### Positive

- A high-effort, high-risk, low-worthiness migration sweep is removed from the
  actionable backlog.
- The active plans shelf no longer carries a 4-month-old plan whose remaining
  tasks contradict the current schema.
- The shipped recurring-table cascades (the only demonstrated orphan problem)
  remain in place and tested.
- The narrowed-scope decision is recorded, so future agents do not
  "rediscover" the missing 10-table cascades as unfinished work.

### Negative

- The 10 remaining tables still lack DB-level FK cascades to `users`; orphan
  rows from `removeUser` remain theoretically possible (e.g. stale
  `user_config`, `conversation_history`, `memory_*` rows for a removed user).
- If a concrete orphan/integrity incident later surfaces, the per-table
  reassessment restarts from scratch through OpenSpec.

### Risks

- **Orphan rows accumulate silently on the non-cascading tables.** Mitigation:
  these tables are small per-user bot data; `removeUser` is a rare admin
  operation; if accumulation ever matters, an OpenSpec change can add targeted
  cleanup or cascades per table.
- **Future agents treat the stale plan as actionable.** Mitigation: the
  relocated copy and this ADR both carry the superseded marker and a pointer
  here.
- **The plan's migration technique is lost.** Mitigation: the plan is
  relocated, not deleted; and the same rename/recreate/copy/drop pattern is
  already embodied in migration 023 and other migrations (e.g. 041, 044).

## Related Decisions

- **ADR-0309** — Archive the Phase 10 Notification Controls Plan;
  **ADR-0310** — Archive the Preprocessing Classifier Plan;
  **ADR-0311** — Archive the Layered Architecture Violations Fix Plan;
  **ADR-0312** — Archive the Deep-Thinking Tool Research Plan;
  **ADR-0313** — Archive the User Profile Memory Plan;
  **ADR-0314** — Archive the Phase 09 Event-Driven Suggestions Plan;
  **ADR-0315** — Archive the Test Improvement Roadmap Plan:
  the precedent for archiving a stale / superseded / low-worthiness plan with
  an ADR rather than executing it.
- **Scoped context ids and platform instances** (migrations 040, 041, 043, 044;
  `src/chat/context-scope.ts`, `src/chat/scoped-context.ts`): the schema
  evolution that invalidates this plan's blanket `users(platform_user_id)`
  cascade assumption.

## References

- Plan: `docs/superpowers/plans/2026-04-04-db-foreign-keys-orphan-prevention.md`.
- Shipped implementation: `src/db/migrations/023_add_foreign_keys.ts`;
  registration at `src/db/index.ts:36`; tests at
  `tests/db/migrations/023_add_foreign_keys.test.ts`,
  `tests/recurring.test.ts:365`, `tests/user-cascade.test.ts`; cache eviction
  at `src/users.ts:148` / `src/cache-eviction.ts:32`; schema FK at
  `src/db/schema.ts:152`.
- Triage basis: `docs/operations/legacy-migration-runbook.md`
  (`docs/superpowers/` → OpenSpec lanes).
- Workflow basis: `AGENTS.md` (Pi Workflow — code-behavior work enters via
  `/opsx:explore` / `/opsx:propose` under `openspec/changes/<name>/`).
- Codebase verification (2026-08-07): migration 023 covers recurring tables
  only; no `.references(() => users.platformUserId)` in `src/db/schema.ts`;
  user-cascade integration test limited to recurring tables; plan not marked
  superseded.
