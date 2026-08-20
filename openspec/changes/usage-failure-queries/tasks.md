<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## 1. Tests (TDD — write first, failing)

- [x] 1.1 Create `tests/usage/failures.test.ts` on the pattern of `tests/usage/recent-requests.test.ts` (`setupTestDb()` + direct Drizzle inserts), covering: only failed rows returned from each source (successful LLM turns and `success = 1` tool calls excluded); merged newest-first ordering across both tables; limit clamping (0 → `[]`, clamped to 200, fractional floors, default 25); `windowMs` filtering vs all-time (`null`/omitted); nullable-field normalization (`finishReason`, `errorType`, `errorCode`, `retryable`, `recovered`, `durationMs` → `null`). Verify it fails (module missing): `bun test tests/usage/failures.test.ts`

## 2. Implementation

- [x] 2.1 Create `src/usage/failures.ts` with `listRecentFailures(options: { windowMs?: number | null; limit?: number }): FailureRow[]` per `specs/usage-failure-queries/spec.md`: two Drizzle selects over `llm_usage_events` (`error IS NOT NULL`) and `tool_call_events` (`success = 0`), each filtered by `computeSince`-style window and capped at the clamped limit, mapped to the `kind: 'llm' | 'tool'` discriminated union with nulls normalized, merged and sorted `occurred_at DESC` (stable, fixed source order), clamped limit applied last (`Math.max(0, Math.min(200, Math.floor(limit)))`, default 25). Verify: `bun test tests/usage/failures.test.ts`

## 3. Verification

- [x] 3.1 Run full suite and read failures from the persisted report: `bun run test` then `bun run test:failures`
- [x] 3.2 Run all static checks: `bun check:full` (lint + typecheck + knip + format + duplicates)
- [ ] 3.3 Confirm no docs/architecture/*.md pages are affected (read-only helper, no runtime wiring); update any that are
