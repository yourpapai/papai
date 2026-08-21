<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Tests (fail first)

- [x] 1.1 Add failing test: `handleToolCallFinishEvent` with a fractional
  `durationMs` emits `tool:execute_end` with the rounded integer, and a
  negative `durationMs` emits `0` (mirroring the analytics lane's defense).
  Verify: `bun test tests/llm-orchestrator-tool-events.test.ts` (red)
- [x] 1.2 Add failing migration test: seed `tool_call_events` rows with
  `465.23`, `-3`, `321`, and NULL `duration_ms`; run migration `079`; assert
  `465`, `0`, `321`, NULL; run again, assert no change (idempotent). Verify:
  `bun test tests/db/migrations` (red)

## 2. Implementation

- [x] 2.1 In `src/llm-orchestrator-tool-events.ts` `handleToolCallFinishEvent`
  usage emission: `durationMs: Math.max(0, Math.round(event.durationMs))`.
  Verify: `bun test tests/llm-orchestrator-tool-events.test.ts` (green)
- [x] 2.2 Add `src/db/migrations/079_tool_call_duration_normalize.ts` per
  design D2 and register it in `src/db/index.ts`. Verify:
  `bun test tests/db/migrations` (green)

## 3. Gates and docs

- [x] 3.1 Full gates: `bun run test`, `bun run typecheck`, `bun run lint`;
  inspect failures via `bun run test:failures` / `test:show`.
- [x] 3.2 Append the root-cause resolution to the 2026-08-20 rejects note in
  `docs/research/analytics-metrics/11-stage-c-evidence.md` (fix shipped;
  historical rejects stand as honest history).
