<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# `tool_completed` durationMs float/int fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `tool_completed` analytics facts being rejected `invalid_value` by rounding `durationMs` at emission and closing the subscriber/normalizer contract gap (issue #209).

**Architecture:** Round `durationMs` at the analytics emission site (matching the sibling convention in `turn-observer.ts` / `provider-observer.ts`), and add a `DurationMs` zod schema with a rounding transform applied to `ToolCompletedDataSchema.durationMs` and `LlmErrorDataSchema.durationMs` so the subscriber output is int-guaranteed. The normalizer stays strict and unchanged.

**Tech Stack:** Bun, TypeScript (strict), Zod v4, bun:test.

**Spec:** `docs/superpowers/specs/2026-08-02-tool-completed-durationms-design.md`

## Global Constraints

- Runtime **Bun**; tests use `bun:test` (`describe` / `test` / `expect`). Run focused suites with `bun test <path>`.
- Strict TypeScript; use `.js` extension in import paths.
- Never add lint-disable or type-ignore comments.
- The pre-commit hook runs lint, typecheck, format:check, license-headers — commit only when all pass.
- Commit style: conventional commits, e.g. `fix(analytics): ...` (see `git log`).
- Deviation from spec, deliberate (mutation hygiene): the spec sketches `DurationMs` as `.transform(v => Math.max(0, Math.round(v)))`; the plan uses `.transform((value) => Math.round(value))` because `.nonnegative()` already guarantees `value >= 0`, so the `Math.max` branch would be an unkillable mutant. The emission site keeps the full `Math.max(0, Math.round(...))` because its input is unvalidated.

---

### Task 1: Round `durationMs` at analytics emission

**Files:**
- Modify: `src/llm-orchestrator-tool-events.ts:201` (`emitAnalyticsCompleted`)
- Test: `tests/llm-orchestrator-tool-events.test.ts` (append to the `describe('analytics terminal ordering')` block, after the `'start and terminal retain identical tool identity fields'` test, i.e. before the closing `})` at line 237)

**Interfaces:**
- Consumes: existing `ToolCallFinishEvent` (`durationMs: number`, float in practice) and the existing `lifecycle(...)` / `successEvent(...)` / `ofType(...)` helpers in the test file.
- Produces: `tool:analytics_completed` debug event whose `data.durationMs` is always a non-negative integer. `tool:execute_end` keeps the raw float (unchanged).

- [ ] **Step 1: Write the failing tests**

Append inside `describe('analytics terminal ordering')`, after the last test:

```ts
  test('analytics terminal rounds float durationMs; execute_end keeps the raw value', () => {
    const { collected } = lifecycle({ ...successEvent({ title: 'done' }), durationMs: 42.4 })
    const terminal = ofType(collected, 'tool:analytics_completed')[0]!
    expect(terminal.data['durationMs']).toBe(42)
    const executeEnd = ofType(collected, 'tool:execute_end')[0]!
    expect(executeEnd.data['durationMs']).toBe(42.4)
  })

  test('analytics terminal clamps negative durationMs to zero', () => {
    const { collected } = lifecycle({ ...successEvent({ title: 'done' }), durationMs: -3 })
    const terminal = ofType(collected, 'tool:analytics_completed')[0]!
    expect(terminal.data['durationMs']).toBe(0)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/llm-orchestrator-tool-events.test.ts`
Expected: FAIL — first test sees `terminal.data['durationMs']` === `42.4` (raw passthrough); second sees `-3`.

- [ ] **Step 3: Apply the emission-side rounding**

In `src/llm-orchestrator-tool-events.ts`, inside `emitAnalyticsCompleted`, change:

```ts
      analyticsSourceId: analyticsSourceIdOf(ctx, event.toolCall.toolCallId),
      durationMs: event.durationMs,
```

to:

```ts
      analyticsSourceId: analyticsSourceIdOf(ctx, event.toolCall.toolCallId),
      durationMs: Math.max(0, Math.round(event.durationMs)),
```

The line `durationMs: event.durationMs,` also appears in the `tool:execute_end` emit inside `handleToolCallFinishEvent` (line 228) — do **not** change that one; the `tool:execute_end` payload must keep the raw float (Task 1's first test asserts this).

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/llm-orchestrator-tool-events.test.ts`
Expected: PASS (all tests in the file, including the two new ones).

- [ ] **Step 5: Commit**

```bash
git add src/llm-orchestrator-tool-events.ts tests/llm-orchestrator-tool-events.test.ts
git commit -m "fix(analytics): round tool_completed durationMs at emission (#209)"
```

---

### Task 2: `DurationMs` rounding schema transform

**Files:**
- Modify: `src/analytics/subscriber-schemas.ts:80` (`LlmErrorDataSchema.durationMs`) and `:96` (`ToolCompletedDataSchema.durationMs`); add the `DurationMs` export next to `NonNegativeInt` at line 18.
- Test: `tests/analytics/subscriber-schemas.test.ts` (schema unit tests)
- Test: `tests/analytics/subscriber.test.ts` (bus-level regression test)
- Test: `tests/analytics/normalizer.test.ts` (strict-backstop characterization test)

**Interfaces:**
- Consumes: `z` (zod v4, already imported in `subscriber-schemas.ts`).
- Produces:
  ```ts
  export const DurationMs: ZodPipe<ZodNumber, ZodTransform<number, number>>
  ```
  Input: any finite number `>= 0`; output: `Math.round(input)` (always a safe integer). NaN and negatives fail `safeParse`.
  Used as the `durationMs` field type in `ToolCompletedDataSchema` and `LlmErrorDataSchema`. Downstream readers (`src/analytics/subscriber.ts:127` and `:178`) keep working unchanged — `data.data.durationMs` is still typed `number`.

- [ ] **Step 1: Write the failing schema tests**

In `tests/analytics/subscriber-schemas.test.ts`, first update the import to include `LlmErrorDataSchema`:

```ts
import {
  attemptIdentityOf,
  DisclosureFallbackDataSchema,
  LlmEndDataSchema,
  LlmErrorDataSchema,
  ToolCompletedDataSchema,
  ToolIdentitySchema,
} from '../../src/analytics/subscriber-schemas.js'
```

Then append these tests inside `describe('subscriber event data schemas')`, after the `'tool completed data requires the bounded terminal classification fields'` test:

```ts
  test('tool completed rounds float durationMs to the nearest integer (half up)', () => {
    const base = {
      toolName: 'create_task',
      toolCallId: 'tc1',
      argsBytes: 4,
      executionOutcome: 'semantic_success',
      resultBytes: 2,
      errorClass: null,
      statusClass: 'none',
      retryable: null,
      recoveredSameTurn: false,
    }
    const floor = ToolCompletedDataSchema.safeParse({ ...base, durationMs: 9.4 })
    expect(floor.success).toBe(true)
    expect(floor.data?.durationMs).toBe(9)
    const half = ToolCompletedDataSchema.safeParse({ ...base, durationMs: 12.5 })
    expect(half.success).toBe(true)
    expect(half.data?.durationMs).toBe(13)
  })

  test('tool completed still rejects negative and NaN durationMs', () => {
    const base = {
      toolName: 'create_task',
      toolCallId: 'tc1',
      argsBytes: 4,
      executionOutcome: 'semantic_success',
      resultBytes: 2,
      errorClass: null,
      statusClass: 'none',
      retryable: null,
      recoveredSameTurn: false,
    }
    expect(ToolCompletedDataSchema.safeParse({ ...base, durationMs: -1 }).success).toBe(false)
    expect(ToolCompletedDataSchema.safeParse({ ...base, durationMs: Number.NaN }).success).toBe(false)
  })

  test('llm:error rounds float durationMs and rejects negatives', () => {
    const parsed = LlmErrorDataSchema.safeParse({ model: 'gpt-x', durationMs: 100.4 })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.durationMs).toBe(100)
    expect(LlmErrorDataSchema.safeParse({ model: 'gpt-x', durationMs: -1 }).success).toBe(false)
  })
```

- [ ] **Step 2: Write the failing bus-level regression test (and one strict-backstop characterization test)**

In `tests/analytics/subscriber.test.ts`, append inside `describe('analytics subscriber')`, after the `'maps approved llm:end, llm:error, tool, and disclosure events'` test (line 217):

```ts
  test('rounds float llm:error and tool durations to integers at the boundary', () => {
    const { bus, observer, registry } = setup()
    registry.register({ turnId: 'turn-1', source: memberSource })
    bus.emit(busEvent('llm:error', { model: 'gpt-x', durationMs: 100.4 }, 'turn-1'))
    bus.emit(
      busEvent(
        'tool:analytics_completed',
        {
          toolName: 'core_task_create',
          toolCallId: 'tc-1',
          argsBytes: 42,
          durationMs: 55.6,
          executionOutcome: 'semantic_success',
          resultBytes: 120,
          errorClass: null,
          statusClass: '2xx',
          retryable: null,
          recoveredSameTurn: false,
          modelRole: 'main',
        },
        'turn-1',
      ),
    )
    expect(firstFactOfType(observer.facts, 'llm_failed').durationMs).toBe(100)
    expect(firstFactOfType(observer.facts, 'tool_completed').durationMs).toBe(56)
  })
```

In `tests/analytics/normalizer.test.ts`, append inside the main `describe('normalizer')` block, after the `'execution family: tool_completed emits semantic outcome and status class'` test (line 464), a characterization test pinning that the normalizer stays a strict backstop for facts that bypass the subscriber. This test passes **before** the implementation too — that is expected; it locks the contract boundary so a future "tolerant normalizer" change is a deliberate act:

```ts
  test('execution family: tool_completed with a float durationMs bypassing the subscriber is still rejected', () => {
    const result = normalize(
      {
        version: 1,
        type: 'tool_completed',
        sourceEventId: 'se-tc-float',
        occurredAtMs: 1_700_000_000_900,
        source: memberSource,
        toolSlug: 'core_task_create',
        toolOrigin: 'core',
        toolDomain: 'task',
        risk: 'write',
        modelRole: 'main',
        argsBytes: 300,
        durationMs: 450.5,
        executionOutcome: 'semantic_success',
        resultBytes: 120,
        errorClass: null,
        statusClass: '2xx',
        retryable: null,
        recoveredSameTurn: false,
      },
      env,
    )
    expect(result).toEqual({ status: 'rejected', sourceEventType: 'tool_completed', reason: 'invalid_value' })
  })
```

(Assertion shape mirrors the sibling `'fail-closed: negative duration yields a bounded rejection'` test at `tests/analytics/normalizer.test.ts:1047`.)

- [ ] **Step 3: Run tests to verify the new behavior tests fail**

Run: `bun test tests/analytics/subscriber-schemas.test.ts tests/analytics/subscriber.test.ts tests/analytics/normalizer.test.ts`
Expected: the schema rounding tests FAIL (raw floats `9.4` / `12.5` / `100.4` come back unrounded) and the bus-level regression test FAILS (`durationMs` `55.6` / `100.4` on the recorded facts). The normalizer characterization test PASSES already (strict backstop is existing behavior) — that is intentional.

- [ ] **Step 4: Add `DurationMs` and apply it to both schemas**

In `src/analytics/subscriber-schemas.ts`, immediately after the `NonNegativeInt` definition (line 18), add:

```ts
export const DurationMs = z
  .number()
  .nonnegative()
  .transform((value) => Math.round(value))
```

Then, in `LlmErrorDataSchema` (line 80), change:

```ts
  durationMs: z.number().nonnegative(),
```

to:

```ts
  durationMs: DurationMs,
```

And in `ToolCompletedDataSchema` (line 96), change:

```ts
  durationMs: z.number().nonnegative(),
```

to:

```ts
  durationMs: DurationMs,
```

Leave `LlmEndDataSchema.totalDuration` (line 68) as `z.number().nonnegative()` — out of scope per the spec (its only emitter produces integer `Date.now()` deltas).

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/analytics/subscriber-schemas.test.ts tests/analytics/subscriber.test.ts tests/analytics/normalizer.test.ts`
Expected: PASS (all tests in all three files).

- [ ] **Step 6: Commit**

```bash
git add src/analytics/subscriber-schemas.ts tests/analytics/subscriber-schemas.test.ts tests/analytics/subscriber.test.ts tests/analytics/normalizer.test.ts
git commit -m "fix(analytics): round durationMs via subscriber schema transform (#209)"
```

---

### Task 3: Full verification

**Files:** none modified.

- [ ] **Step 1: Run every test file touching the changed behavior**

Run: `bun test tests/llm-orchestrator-tool-events.test.ts tests/analytics/subscriber-schemas.test.ts tests/analytics/subscriber.test.ts tests/analytics/normalizer.test.ts tests/analytics/contracts.test.ts tests/analytics/provider-observer.test.ts tests/analytics/llm-tool-integration.test.ts`
Expected: PASS, 0 failures.

- [ ] **Step 2: Run the full in-process suite**

Run: `bun run test`
Expected: PASS, 0 failures (pre-commit hook already covers lint/typecheck/format on the committed files).

- [ ] **Step 3: Hand off the prod verification query**

Record the issue's post-deploy confirmation query for the PR description (do not execute it locally; pushing/PR creation happens only on explicit user request):

```sql
SELECT source_event_type, reason, count FROM analytics_normalization_rejections ORDER BY count DESC;
```

Expect `tool_completed` / `invalid_value` to stop growing after deploy.
