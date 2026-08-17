# Proposal: `suggest_next_task` — on-demand "what should I work on next?" (event-driven suggestions, increment 1)

## Why this pick

Maintainer direction: drop `user-profile-memory` (overlaps the in-flight `memory-vector-graph-research` branch) and take a different unimplemented feature with the best UX value. Survey of the not-implemented shelf:

- `openspec/changes/` survivors are all agent/test/DB infra (`db-foreign-keys-orphan-prevention`, `telemetry-metrics`, `hermetic-e2e-core-separation-proof`, `plugin-core-separation-toolgate`, …) — zero end-user UX; `agent-single-reply-comment` is 20/21 tasks done.
- Archived-but-valuable product features: ADR-0318 calendar sync (archived "no demonstrated demand"), ADR-0310 preprocessing classifier (memory-adjacent — collides with the same branch), **ADR-0314 event-driven suggestions** — archived as "feature value is real but the path is stale", with an explicit re-entry trigger: re-propose via OpenSpec against the current architecture, using the old plan's ranking formula/thresholds as *inputs, not instructions*. Its user stories (missing-field nudges, completion follow-ups, weekly rituals, next-task ranking) are the bot's biggest missing UX surface: today the tracker is purely reactive.

This change is increment 1 of that re-entry: **US8, the on-demand `suggest_next_task` ranking tool** — the most self-contained, highest-frequency slice ("what should I work on next?" is a daily question; the other stories need payload hooks, schedulers, and config keys). No memory/embedding/vector surface anywhere → no overlap with `memory-vector-graph-research`.

## Goal

A read-only `suggest_next_task` tool that ranks open tasks across the context's projects by deterministic due-date/priority scoring and returns the top N with one-line human-readable reasons, which the LLM relays as a numbered recommendation.

## What changes

1. **New `src/tools/suggest-next-task.ts`** (one tool per file, factory `makeSuggestNextTaskTool(provider, userId?, storageContextId?)`):
   - Input schema (all fields `.describe()`d): `projectId?: string` (scope to one project; default: all projects), `assigneeId?: string` (supports `'me'` via the existing `resolveMeReference` path, mirroring `list-tasks.ts`), `limit?: number` (int 1–5, default 3).
   - Flow: resolve project list — explicit `projectId` → just it; else `provider.listProjects?.()`; if `listProjects` is unavailable and no `projectId` given, return `{ status: 'project_required', message }` guidance. Fetch open tasks per project via `provider.listTasks(projectId, { limit: 50, sortBy: 'dueDate', sortOrder: 'asc' })` under `p-limit(3)`. Drop tasks with `resolved` set (`TaskListItem.resolved`). Score and rank.
   - Deterministic scoring (pure exported `rankTasks(tasks, now)` for direct testing; adapted from the archived plan's formula): overdue days ×30; due within 48h +20; due within 7 days +10; priority token match on the normalized string (+25 urgent/critical/blocker, +20 high, +15 major, +5 medium/normal; case-insensitive containment); no due/priority signal → `createdAt` recency tiebreak (+2 newest). `reason` is assembled from exactly the facts that scored (e.g. `"overdue by 2 days, high priority"`).
   - Output: `{ suggestions: Array<{ id, title, number?, url, projectId, dueDate?, priority?, score, reason }>, considered: number }`; `dueDate` rendered through `provider.formatDueDateOutput` with the context timezone resolved exactly like `list-tasks.ts:94-101` (config-context strip → `getConfig('timezone')` → `'UTC'`). Empty result returns `{ suggestions: [], considered: 0 }`.
2. **Registration**: `src/tools/core-tools.ts` — add `suggest_next_task: makeSuggestNextTaskTool(provider, userId, storageContextId)` beside `list_tasks` (line ~21). `src/tools/tool-metadata.ts` — `suggest_next_task: read('task')` so it inherits the read-risk default (`allow`) and joins `tool_prefs`; `BUILTIN_TOOL_NAMES` derives automatically. Available in DM and group, normal and proactive modes (read-only, no special gating).
3. **Tests**: new `tests/tools/suggest-next-task.test.ts` — ranking unit cases (overdue beats due-soon beats unscheduled; priority stacking; `resolved` excluded; stable tiebreak), tool happy path with a fake provider (multi-project, p-limit fan-out), `assigneeId: 'me'` resolution + `identity_required` branch, `project_required` when `listProjects` absent, empty-state shape. Update tool-inventory assertions that enumerate the always-on task set: `tests/llm-orchestrator-tools.test.ts:362`, `tests/completion/verified-completion.test.ts:50`, and any `EXPECTED_KEYS` sets in `tests/tools/` that enumerate core tools.
4. **Docs**: one line in `src/tools/CLAUDE.md` (tool list context) + `docs/architecture/behaviors.md` task-tool section noting the on-demand suggestion tool.

## Non-goals

- Suggestion payloads after `create_task`/`update_task`/completion (US1–US3) — increment 2.
- Weekly summary/kickoff rituals, scheduler work, `weekly_state`, new config keys (US5–US6) — increment 3.
- No LLM call inside the tool (ranking is deterministic), no DB changes, no new capability flags, no memory/embedding surface.

## Verification

TDD per repo hooks: failing `tests/tools/suggest-next-task.test.ts` first, then implement. Gates: `bun run test` (then `test:failures`/`test:show` off the persisted report), `bun check:full` (typecheck, lint, knip, format, duplicates), `bun run test:mutate:changed` for the per-file ratchet on touched files.
