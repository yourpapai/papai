<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics `tool_completed` durationMs float/int fix

**Date:** 2026-08-02
**Status:** Design approved, pending spec review
**Issue:** https://github.com/yourpapai/papai/issues/209

## Problem

`tool_completed` analytics facts are rejected by the normalizer with reason
`invalid_value`, undercounting tool metrics (`tool_semantic_success` /
`tool_failed`) and inflating the Stage B rejects counter (~20–30/day on
production).

Root cause: a contract disagreement between the subscriber schema and the
normalizer on `durationMs`:

- Subscriber accepts a float: `durationMs: z.number().nonnegative()` —
  `src/analytics/subscriber-schemas.ts:96`
- Normalizer requires a safe integer: `nonNegativeInt` checks
  `Number.isSafeInteger` — `src/analytics/normalizer-shared.ts:38-39`, applied
  at `src/analytics/normalizer-props-execution.ts:190` (`buildToolCompleted`)
- The tool-call emitter passes `durationMs` raw (a float):
  `src/llm-orchestrator-tool-events.ts:201` reads `event.durationMs`, sourced
  from the AI SDK's `toolExecutionMs` (a `performance.now()` delta) via
  `adaptToolExecutionEnd` at `src/llm-orchestrator-tool-events.ts:138`. No
  rounding is applied.

Sibling duration paths round explicitly at emission (`turn-observer.ts:74`,
`provider-observer.ts:117`, `message-edit/w2-regen.ts:107,111`); the tool-call
path omits this rounding, so a float passes the subscriber but fails the
normalizer.

Two sibling fields share the loose-schema pattern but are safe in practice
today:

- `LlmErrorDataSchema.durationMs` (`subscriber-schemas.ts:80`) →
  `llm_failed.durationMs` → `nonNegativeInt` — protected only because
  `provider-observer.ts:117` rounds upstream (latent gap).
- `LlmEndDataSchema.totalDuration` (`subscriber-schemas.ts:68`) →
  `llm_completed.durationMs` → `nonNegativeInt` — `Date.now()` delta at
  `llm-orchestrator-events.ts:165` is always an integer.

## Goal

Stop `tool_completed` rejections and close the subscriber/normalizer contract
gap so no duration field can silently drift into the same failure again.

## Design

### 1. Emission-side rounding

`src/llm-orchestrator-tool-events.ts:201` (`emitAnalyticsCompleted`):

```ts
durationMs: Math.max(0, Math.round(event.durationMs)),
```

Matches the established sibling convention. The debug-only `tool:execute_end`
event (`llm-orchestrator-tool-events.ts:228`) keeps the raw float — it is not
consumed by the analytics subscriber and sub-millisecond precision is harmless
there.

### 2. Rounding schema transform (contract closure)

`src/analytics/subscriber-schemas.ts`: add

```ts
export const DurationMs = z
  .number()
  .nonnegative()
  .transform(v => Math.max(0, Math.round(v)))
```

and use it for:

- `ToolCompletedDataSchema.durationMs` (`subscriber-schemas.ts:96`)
- `LlmErrorDataSchema.durationMs` (`subscriber-schemas.ts:80`)

The schema stays tolerant at the boundary (accepts floats, rounds them) but its
output is int-guaranteed, so the normalizer's `nonNegativeInt` always passes.
Unlike tightening to plain `NonNegativeInt`, a future non-rounding emitter can
never cause a *silent* fact drop at the subscriber (`safeParse` failure →
`return null`, no rejection metric) — worst-case it rounds.

`LlmEndDataSchema.totalDuration` is deliberately left as-is: its only emitter
produces integer `Date.now()` deltas, and changing it is a no-risk follow-up,
not part of this fix.

### 3. Normalizer — unchanged

`nonNegativeInt` stays strict as the backstop. NaN and negative values still
fail `safeParse` at the subscriber schema (zod rejects NaN on `z.number()`;
`nonnegative()` rejects negatives) via the existing path. No new failure modes.

### Data flow after fix

AI SDK `toolExecutionMs` (float) → `adaptToolExecutionEnd` (raw) →
`emitAnalyticsCompleted` (rounded int) → `ToolCompletedDataSchema` (tolerant,
rounds any residual float) → normalizer `nonNegativeInt` (passes).

## Testing

TDD; failing tests first:

1. `tests/llm-orchestrator-tool-events.test.ts` — a tool finish event with a
   float `toolExecutionMs` emits `tool:analytics_completed` with a rounded
   integer `durationMs` (`Math.max(0, Math.round(...))` semantics).
2. `tests/analytics/subscriber-schemas.test.ts` — `ToolCompletedDataSchema`
   and `LlmErrorDataSchema` parse a float `durationMs` to the rounded integer;
   negative and NaN inputs still fail.
3. `tests/analytics/normalizer.test.ts` — explicit regression case: a
   `tool_completed` fact whose `durationMs` passed through the subscriber as a
   float is accepted (rounded), not rejected `invalid_value`.

Verification on prod after deploy (from the issue):

```sql
SELECT source_event_type, reason, count FROM analytics_normalization_rejections ORDER BY count DESC;
```

Expect `tool_completed` / `invalid_value` to stop growing.

## Out of scope

- `LlmEndDataSchema.totalDuration` schema tightening (integer in practice).
- Making the normalizer's duration reads tolerant-and-rounding (defense in
  depth at a third layer; rejected for now — the subscriber transform already
  guarantees the contract).
- `tool:execute_end` debug event payload.
