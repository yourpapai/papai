## Context

Issue #209's primary (live-lane) fix is already merged (29eb112b1, ADR-0358): `emitAnalyticsCompleted` rounds `durationMs` at emission (`src/llm-orchestrator-tool-events.ts:201`) and the `DurationMs` zod transform rounds at the subscriber boundary. That lane is done; this change covers the remaining gap the maintainer flagged in the Stage B wrap-up comment.

The backfill lane still undercounts tool metrics: `tool:execute_end` intentionally keeps the raw float duration (ADR-0358: debug surface, traces stay precise), `recordToolCall` persists it verbatim into `tool_call_events.duration_ms` (`src/usage/tool-call-recorder.ts:67`), and the backfill decision `decideToolBackfillRow` validates it with `nullableNonNegative` → `nonNegativeInt` (`src/analytics/jobs/backfill-decisions.ts:99,137`), which requires a safe integer. Every float-duration row is rejected `invalid_value`, so backfill-lane `tool_semantic_success` / `tool_failed` counters systematically undercount — the same integrity bug class as #209, one lane over.

## Goal

Backfill-lane parity: rows written by the tool-call recorder must pass `decideToolBackfillRow`, so backfill-derived tool counters match the live lane. Assumption (from the maintainer's suggestion): parity matters; fix at the persistence chokepoint, not by loosening the strict backfill decision.

## Intended behaviour change

- `recordToolCall` (`src/usage/tool-call-recorder.ts:67`) rounds `durationMs` at insert: `null` stays `null`, otherwise `Math.max(0, Math.round(event.durationMs))` — matching the sibling rounding convention (`turn-observer.ts:74`, `provider-observer.ts:117`).
- The `tool:execute_end` debug event payload is **unchanged** — it keeps the raw float, preserving ADR-0358's "raw float preserved for debugging" driver. Only the persisted row is rounded. Rounding at the recorder (not in `buildToolCallFromExecuteEnd` in `src/usage/index.ts`) keeps it at the single persistence chokepoint.
- `decideToolBackfillRow` stays strict and unchanged — the backfill decision is the fail-closed backstop (same posture as the normalizer in ADR-0358).
- No DB migration. Pre-existing float `duration_ms` rows in production remain `invalid_value` on backfill; that historical residue is explicitly out of scope (the Stage B window is already wrapped; if reconciliation of historical rows is later wanted, it is a separate one-off decision).

## Files to touch

- `src/usage/tool-call-recorder.ts` — round `durationMs` in the insert (line 67).
- `tests/usage/tool-call-subscriber.test.ts` — extend the `tool:execute_end` row test: emit a float `durationMs` (e.g. `42.4`) and assert the stored row is the rounded int (`42`); assert `null` stays `null`; assert negative floats clamp to `0` only if the clamp branch is reachable through this path (otherwise keep the assertion set minimal for mutation hygiene).
- `tests/analytics/backfill.test.ts` — regression: a `tool_call_events` row as written by the recorder (rounded int duration) is accepted by `decideToolBackfillRow` and counted; the existing float-rejection test (strict backstop) stays.
- `docs/adr/0358-analytics-durationms-rounding-at-emission-and-subscriber.md` — short addendum noting the recorder-side rounding for backfill parity (or a new small ADR if preferred by convention).

## Verification

- New/updated unit tests above pass; the existing test pinning the raw float on the `tool:execute_end` event payload (`tests/llm-orchestrator-tool-events.test.ts:246`) must still pass unchanged, proving the debug surface is untouched.
- `bun run test:affected` in the loop; full `bun run test` before completion, plus `bun check:full` (lint/typecheck). Mutation gate for the touched file: `bun test:mutate:changed`.
- Manual reasoning check: `recordToolCall` output domain for `durationMs` is now `null | non-negative integer`, which is exactly the domain `nullableNonNegative` accepts.
