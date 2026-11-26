<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See `proposal.md` — Why. `ToolCallFinishEvent.durationMs` is a raw
elapsed-time number (fractional from `performance.now()`, possibly negative
under skew). Two consumers branch off `handleToolCallFinishEvent`
(src/llm-orchestrator-tool-events.ts:215): the analytics emission already
normalizes (`Math.max(0, Math.round(...))`, line 201); the usage emission
(line 228) passes the raw value into `recordToolCall`, which stores it
verbatim (src/usage/tool-call-recorder.ts:67). SQLite INTEGER columns keep
REAL values with their type, so `nonNegativeInt` in the backfill classifier
correctly rejects them.

## Goals / Non-Goals

Goals: stop new REAL values at the emission site; normalize existing rows
once. Non-Goals beyond the proposal's: no defense added inside
`tool-call-recorder.ts` itself — fixing at the single emission keeps the
writer dumb and matches where the analytics lane already chose to defend.

## Decisions

### D1: Normalize at the emission site, not the recorder

Mirroring the analytics lane at llm-orchestrator-tool-events.ts:228 makes
the two lanes of the same finish event provably identical in shape. The
recorder stays a verbatim writer; other future emitters would need their own
defense, but there are none today (only one `recordToolCall` caller).

Alternative: clamp in `recordToolCall`. Rejected: it hides producer bugs and
diverges from where the codebase already decided this normalization belongs.

### D2: One-shot repair migration, no provenance restatement

Migration `079_tool_call_duration_normalize` runs
`UPDATE tool_call_events SET duration_ms = max(0, CAST(round(duration_ms) AS INTEGER)) WHERE duration_ms IS NOT NULL AND (typeof(duration_ms) != 'integer' OR duration_ms < 0)`.
Idempotent by the WHERE clause; `round()` is SQLite's built-in. Already
rejected rows keep their provenance (backfill skips them permanently), so
aggregate counters do not retroactively change — reconciliation stays
zero-delta because rejected rows were always counted as decisions
(`applyRejected` writes provenance).

### Scope model and gating impact

None: `tool_call_events` is thread-scoped by `storage_context_id`; no
per-user/group config, no tools, no tool_prefs surface touched.

### TDD / hook interactions

Tests first, both gated by the Write/Edit hook pipeline:

1. `tests/llm-orchestrator-tool-events` (or nearest existing suite): failing
   test that a finish event with fractional/negative duration emits a
   `tool:execute_end` carrying the rounded/clamped integer.
2. Migration test: seed mixed rows (fractional, negative, integer, NULL),
   run migration, assert values and idempotence. Migration tests follow the
   existing `src/db/migrations/` test pattern.

## Risks / Trade-offs

- [Lost sub-ms precision in usage stats] — irrelevant at ms granularity; the
  analytics lane already made this trade.
- [Migration over ~2k rows] — single UPDATE, instant on SQLite.

## Migration Plan

Deploy code + migration together; the writer fix prevents new REALs, the
migration cleans old ones. Rollback: revert code; the migration is
value-normalizing and safe to leave in place. No data path back to REAL is
needed.

## Open Questions

None.
