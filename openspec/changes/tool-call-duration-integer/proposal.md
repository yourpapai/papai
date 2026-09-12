<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

The `tool_call_events` usage table has accumulated REAL-typed fractional
`duration_ms` values since May (2132 rows on prod): `tool:execute_end` passes
the raw `performance.now()` delta through, while the analytics lane emitting
the same finish already defends it with `Math.max(0, Math.round(...))`
(src/llm-orchestrator-tool-events.ts:201 vs :228). Every such row is
permanently rejected by the analytics backfill classifier
(`invalid_value`, chronic daily rejects: 30 on 2026-08-20, dating back to
2026-05-20), undercounting tool success/failure aggregates. SQLite INTEGER
columns accept REALs silently, so nothing else catches it.

## What Changes

- The `tool:execute_end` emission (usage lane) applies the same defense as
  the analytics lane: `Math.max(0, Math.round(event.durationMs))`.
- A one-shot migration normalizes existing REAL `duration_ms` values in
  `tool_call_events` to rounded non-negative INTEGERs.
- Historical rejects stand as honest history (backfill provenance rows keep
  them from being re-decided); only rows not yet backfilled benefit from the
  repair. No counter back-restatement.

## Capabilities

### New Capabilities

- `usage-tool-call-recording`: the local usage/telemetry source tables
  (`tool_call_events`) SHALL store well-formed scalar values so downstream
  consumers (analytics backfill, usage stats) never see values their schemas
  did not produce.

  Without it: fractional durations keep accumulating (every
  `performance.now()`-measured call), each new day adds rejects, and the
  Stage C daily review keeps surfacing an `invalid_value` pattern that will
  eventually be mistaken for a regression.

### Modified Capabilities

(none — no OpenSpec capability covers usage recording today.)

## Impact

- Code: `src/llm-orchestrator-tool-events.ts` (one emission site); new
  migration `079_tool_call_duration_normalize.ts` (UPDATE with
  `CAST(round(duration_ms) AS INTEGER)` + negative clamp; idempotent).
- No API, schema-shape, or scope-model changes; no secrets.
- Docs: `docs/research/analytics-metrics/11-stage-c-evidence.md` — the
  2026-08-20 rejects note gets the root cause once shipped.
- Tests: unit test pinning the emission defense; migration test covering
  fractional, negative, and already-integer rows.

## Non-goals

- No repair of analytics aggregate counters for historically rejected rows —
  provenance pins them; reconciliation is already zero-delta with them.
- No change to the backfill classifier (`nonNegativeInt` is correct to
  reject non-integers) or to `llm_usage_events` (its durations are already
  integer-valued at the source).
- No renaming/retyping of the column (SQLite ALTER is not needed; the column
  is declared INTEGER — only the values are wrong).
