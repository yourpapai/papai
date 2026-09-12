<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: `suggest_next_task` (on-demand next-task ranking, increment 1)

## Context

The tool layer assembles provider-backed tools scope-free in
`src/tools/core-tools.ts`, wraps them per-invocation, and gates exposure through
`src/tools/tool-metadata.ts` risk classes + `tool_prefs`. `src/tools/list-tasks.ts`
is the closest existing module — it already solves the three adjacent problems
(assignee `'me'` resolution via `resolveMeReference`, context-timezone due-date
rendering via the config-context strip, structured status results), so this change
clones its shape rather than inventing one. One gap: the normalized
`TaskListItem` (`src/providers/domain-types.ts:107`) carries no `createdAt`, and
Kaneo's list response already provides it but the mapper drops it
(`plugins/task-provider-kaneo/mappers.ts:69`). See proposal.md for motivation;
see `specs/suggest-next-task/spec.md` for the behavioral contract.

## Goals / Non-Goals

**Goals:**

- Deterministic, explainable ranking with zero persisted state and zero new
  remote call shapes beyond `listTasks`/`listProjects`.
- A ranking pure function testable without provider mocks.

**Non-Goals:**

- No LLM-in-the-loop scoring, no embedding/memory surface (proposal Non-goals).
- No per-project schema or provider contract changes beyond one optional
  passthrough field.

## Decisions

### D1: Tool placement and registration

One tool per file per `src/tools/CLAUDE.md`: new `src/tools/suggest-next-task.ts`
with `makeSuggestNextTaskTool(provider, userId?, storageContextId?)`, registered
in `makeCoreTools` beside `list_tasks`, classified `read('task')` in
`TOOL_METADATA`. No existing module covers ranking — `list_tasks` returns
unranked pages — so a new file is justified; the ranking function lives in the
same file as a pure export (`rankTasks(tasks, now)`), not a new module.

### D2: Pure `rankTasks` + formula

Scoring is a pure exported function of `(tasks, now)` so unit tests and the
Stryker per-file ratchet exercise it without mocks. Formula (ADR-0314 inputs,
not instructions): overdue days × 30; due ≤ 48h + 20; due ≤ 7d + 10; priority
token containment (+25 urgent/critical/blocker, +20 high, +15 major, +5
medium/normal, case-insensitive); no due/priority signal → +2 when `createdAt`
is the newest. Magnitudes are chosen so one overdue day (30) outranks the
strongest future due window (20) and priority stacks within a due tier without
crossing a full tier gap. `reason` is assembled from exactly the summands that
fired. Constants live in one block for tuning.

### D3: `TaskListItem.createdAt` passthrough

Add optional `createdAt?: string | null` to `TaskListItem` and pass it through in
the Kaneo mapper (the list schema already validates it as optional).
Alternatives rejected: per-candidate `get_task` fan-out (N+1 remote calls for a
read-only ranking); inferring recency from list order (unstable across pages).
A missing `createdAt` degrades the tiebreak to stable input order — still
deterministic. `projectId` on each suggestion comes from the fan-out loop
(explicit input or the project being iterated), not from the list type.

### D4: Candidate collection

Explicit `projectId` → single `listTasks` call. Otherwise `listProjects?.()`;
if the provider lacks project listing and no `projectId` was given, return
`{ status: 'project_required', message }` (guidance, not an error — matches the
structured-status convention). Per-project `listTasks(projectId, { limit: 50,
sortBy: 'dueDate', sortOrder: 'asc' })` under `p-limit(3)` (repo convention for
bounded remote concurrency). Tasks with `resolved` set are dropped before
scoring; `considered` counts the post-drop candidates.

### D5: Identity and timezone reuse

`assigneeId: 'me'` goes through the same `resolveMeReference` path as
`list-tasks.ts` (including `preferredUserIdentifier` selection), returning
`{ status: 'identity_required', message }` when unresolvable. Due dates render
through `provider.formatDueDateOutput` with the timezone resolved identically
to `list-tasks.ts:94-101`: `storageContextId ?? userId` → thread-strip to config
context → `getConfig('timezone')` → `'UTC'`. Empty state:
`{ suggestions: [], considered: 0 }`.

### D6: Gating, prefs, and scope-model impact

No new `Capability` string — the tool runs off core `listTasks` plus optional
`listProjects`, degrading per D4. `read('task')` metadata means: default
permission `allow` (read-risk tier), included in the guest-mode fixed read-only
toolset, `BUILTIN_TOOL_NAMES` picks it up automatically, and the standard
`tool_prefs` allow/ask/deny resolution applies (`ask` confirmation and
`permission_denied` flow inherited from `applyToolPreferences`, nothing new to
build). Available in DM and group, normal and proactive modes — it is
provider-backed read, so no context gating. No state is persisted anywhere:
no DB migration, no config keys; the only ids consulted are the existing
per-user id (`'me'` resolution) and the thread-scoped storage context id
(timezone lookup via the group-shared config context, unchanged semantics).

### D7: TDD / hook interactions

The Write/Edit TDD hook gates every touched `src/` file: new
`src/tools/suggest-next-task.ts`, `src/tools/core-tools.ts`,
`src/tools/tool-metadata.ts`, `src/providers/domain-types.ts`. Order of work:
failing `tests/tools/suggest-next-task.test.ts` first (ranking unit cases, then
tool-level fake-provider cases), then domain-type + mapper passthrough, then
`rankTasks`, then the tool, then registration + metadata, then the mechanical
inventory updates (`tests/llm-orchestrator-tools.test.ts`,
`tests/completion/verified-completion.test.ts`, any `EXPECTED_KEYS` sets).
`plugins/task-provider-kaneo/mappers.ts` sits outside the src/client hook scope
but is covered by the full suite. No new dependency: Zod schemas, `p-limit`, and
the existing provider interface cover everything.

## Risks / Trade-offs

- [Many-project fan-out latency / provider rate limits] → p-limit(3), 50-task
  cap per project, dueDate-ascending sort so the most relevant page is fetched.
- [Provider plugins that never populate `createdAt`] → tieback degrades to
  stable deterministic order; first-party Kaneo (and YouTrack, see open
  question) populate it.
- [Priority vocabulary mismatch across trackers] → token containment scores 0
  on no match and the reason simply omits priority; no behavioral failure.
- [Formula is a heuristic] → constants centralized; deterministic output keeps
  the LLM's relay step honest.
- [Inventory-test churn] → expected mechanical edits, listed in D7.

## Migration Plan

Code-only: no DB migration, no backfill, no config keys. Rollout is the next
release; every context with a configured task instance gains the tool at the
read-risk default (`allow`). Rollback = revert the commit; no state to clean up.

## Open Questions

- Whether the YouTrack list mapper can populate `createdAt` from its API in the
  same increment or shortly after; deferrable per-provider without touching the
  spec, formula, or task breakdown (the degradation path is defined).
