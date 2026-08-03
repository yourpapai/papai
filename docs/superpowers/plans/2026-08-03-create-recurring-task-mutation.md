<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage for `src/tools/create-recurring-task.ts` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill ~36 of the 54 surviving Stryker mutants in `src/tools/create-recurring-task.ts` by adding focused tests, raising the paired mutation score from 0.481 to ~0.83.

**Architecture:** Test-only change. All work lands in the existing companion `tests/tools/create-recurring-task.test.ts`, using the file's established DI-first pattern (`CreateRecurringTaskDeps` injection, `setCachedConfig` for timezone, `mockLogger()`). No source files are modified; `scripts/mutation/baseline.json` is not edited (the CI master seed ratchets the floor).

**Tech Stack:** Bun test runner (`bun:test`), zod v4 (input schema), Vercel AI SDK `tool()`, Stryker via `bun test:mutate:file`.

**Spec:** `docs/superpowers/specs/2026-08-03-create-recurring-task-mutation-design.md`

## Global Constraints

- **Do NOT modify any file under `src/` or `plugins/`.** The only modified file is `tests/tools/create-recurring-task.test.ts`.
- **Do NOT edit `scripts/mutation/baseline.json` or `scripts/mutation/overrides.json`.**
- These tests assert **existing, correct behavior** — they are expected to PASS on first run. The failure signal that proves they work is the Stryker run in Task 4: each test names the mutant cluster it kills.
- Strict TypeScript; relative imports keep the `.js` extension. No new runtime imports beyond what the plan shows.
- No comments in test code; test names carry the intent.
- Tests must be isolation-clean (no cross-file state; each new describe has its own `beforeEach`).
- Commit style follows the repo: `test(tools): <what>`.
- Lint/typecheck: `bun run lint`, `bun run typecheck` (pre-commit hooks also run them).

## File Structure

- Modify: `tests/tools/create-recurring-task.test.ts` — add one type import and four describe blocks (one per task). Existing imports, `toolCtx`, `makeRecord`, and the 3 DTSTART tests stay untouched.

---

### Task 1: Input-validation describe block

Kills the superRefine cluster (src/tools/create-recurring-task.ts L49/L56: 6 ConditionalExpression + 2 LogicalOperator + 2 ObjectLiteral + 2 ArrayDeclaration + 6 StringLiteral) and the enum cluster (L36/L41: 2 ArrayDeclaration + 7 StringLiteral).

**Files:**
- Modify: `tests/tools/create-recurring-task.test.ts`

**Interfaces:**
- Consumes: `makeCreateRecurringTaskTool`, `CreateRecurringTaskDeps`, `RecurringTaskInput`, `RecurringTaskRecord` (already imported in the file); `toolCtx`, `makeRecord`, `mockLogger()`, `setCachedConfig()` (already in the file).
- Produces: describe block `'create-recurring-task — input validation'`; no exports.

- [ ] **Step 1: Append the safeParse helper at the end of the file**

In `tests/tools/create-recurring-task.test.ts`, append after the existing describe block (this mirrors `isSafeParseable` in tests/utils/test-helpers.ts; the repo lint rules forbid type assertions, so a type guard is required instead of casting `tool.inputSchema`):

```typescript
interface SafeParseIssue {
  code: string
  message: string
  path: PropertyKey[]
}

type SafeParseOutcome = { success: true } | { success: false; error: { issues: SafeParseIssue[] } }

interface SafeParseable {
  safeParse: (data: unknown) => SafeParseOutcome
}

function isSafeParseable(val: unknown): val is SafeParseable {
  return typeof val === 'object' && val !== null && 'safeParse' in val && typeof val.safeParse === 'function'
}
```

- [ ] **Step 2: Append the validation describe block after the helper**

```typescript
describe('create-recurring-task — input validation', () => {
  let deps: CreateRecurringTaskDeps

  beforeEach(() => {
    mockLogger()
    setCachedConfig('user-1', 'timezone', 'UTC')
    deps = {
      createRecurringTask: (input: RecurringTaskInput): RecurringTaskRecord => makeRecord(input),
    }
  })

  const parseInput = (data: unknown): SafeParseOutcome => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    if (!isSafeParseable(tool.inputSchema)) {
      throw new Error('Tool inputSchema does not have safeParse')
    }
    return tool.inputSchema.safeParse(data)
  }

  test('rejects cron without schedule with a path-scoped custom issue', () => {
    const result = parseInput({ title: 'Task', projectId: 'p1', triggerType: 'cron' })
    expect(result.success).toBe(false)
    assert(!result.success)
    expect(result.error.issues[0]?.code).toBe('custom')
    expect(result.error.issues[0]?.message).toBe("schedule is required when triggerType is 'cron'")
    expect(result.error.issues[0]?.path).toEqual(['schedule'])
  })

  test('accepts cron with schedule', () => {
    expect(
      parseInput({ title: 'Task', projectId: 'p1', triggerType: 'cron', schedule: { freq: 'DAILY' } }).success,
    ).toBe(true)
  })

  test('rejects on_complete with schedule with a path-scoped custom issue', () => {
    const result = parseInput({
      title: 'Task',
      projectId: 'p1',
      triggerType: 'on_complete',
      schedule: { freq: 'DAILY' },
    })
    expect(result.success).toBe(false)
    assert(!result.success)
    expect(result.error.issues[0]?.code).toBe('custom')
    expect(result.error.issues[0]?.message).toBe("schedule must not be provided when triggerType is 'on_complete'")
    expect(result.error.issues[0]?.path).toEqual(['schedule'])
  })

  test('accepts on_complete without schedule', () => {
    expect(parseInput({ title: 'Task', projectId: 'p1', triggerType: 'on_complete' }).success).toBe(true)
  })

  test('accepts every priority enum value', () => {
    for (const priority of ['no-priority', 'low', 'medium', 'high', 'urgent'] as const) {
      expect(
        parseInput({ title: 'Task', projectId: 'p1', triggerType: 'on_complete', priority }).success,
      ).toBe(true)
    }
  })

  test('rejects an invalid priority', () => {
    expect(
      parseInput({ title: 'Task', projectId: 'p1', triggerType: 'on_complete', priority: 'critical' }).success,
    ).toBe(false)
  })

  test('rejects an invalid triggerType', () => {
    expect(parseInput({ title: 'Task', projectId: 'p1', triggerType: 'weekly' }).success).toBe(false)
  })
})
```

- [ ] **Step 3: Run the test file**

Run: `bun test tests/tools/create-recurring-task.test.ts`
Expected: PASS — 10 tests (3 existing + 7 new). These assert existing behavior; a failure here means a typo in the plan's expected strings, not a source bug. If `'rejects cron without schedule…'` fails on `issues[0]?.code`, check the source `superRefine` at src/tools/create-recurring-task.ts:48-63 and align the expectation with the actual issue.

- [ ] **Step 4: Lint and typecheck**

Run: `bun run lint && bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add tests/tools/create-recurring-task.test.ts
git commit -m "test(tools): cover create_recurring_task input validation"
```

---

### Task 2: Compile-branch describe block

Kills the L73 cluster (2 ConditionalExpression + 1 LogicalOperator) in `executeCreate`.

**Files:**
- Modify: `tests/tools/create-recurring-task.test.ts`

**Interfaces:**
- Consumes: everything from Task 1's file state (imports, `toolCtx`, `makeRecord`).
- Produces: describe block `'create-recurring-task — compile branch'`; no exports.

- [ ] **Step 1: Append the compile-branch describe block**

```typescript
describe('create-recurring-task — compile branch', () => {
  let capturedInput: RecurringTaskInput | null
  let deps: CreateRecurringTaskDeps

  beforeEach(() => {
    mockLogger()
    capturedInput = null
    setCachedConfig('user-1', 'timezone', 'UTC')
    deps = {
      createRecurringTask: (input: RecurringTaskInput): RecurringTaskRecord => {
        capturedInput = input
        return makeRecord(input)
      },
    }
  })

  test('passes no rrule or dtstartUtc for on_complete', async () => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute({ title: 'Task', projectId: 'p1', triggerType: 'on_complete' }, toolCtx)
    expect(capturedInput?.rrule).toBeUndefined()
    expect(capturedInput?.dtstartUtc).toBeUndefined()
  })

  test('does not compile when a schedule is passed with on_complete', async () => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      { title: 'Task', projectId: 'p1', triggerType: 'on_complete', schedule: { freq: 'DAILY' } },
      toolCtx,
    )
    expect(capturedInput?.rrule).toBeUndefined()
    expect(capturedInput?.dtstartUtc).toBeUndefined()
  })

  test('passes the compiled rrule and dtstartUtc for cron', async () => {
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      {
        title: 'Task',
        projectId: 'p1',
        triggerType: 'cron',
        schedule: { freq: 'DAILY', byHour: [9], byMinute: [0], timezone: 'UTC' },
      },
      toolCtx,
    )
    expect(capturedInput?.rrule).toContain('FREQ=DAILY')
    expect(capturedInput?.rrule).toContain('BYHOUR=9')
    expect(capturedInput?.dtstartUtc).toMatch(/T00:00:00\.000Z$/u)
  })
})
```

Note: the second test deliberately bypasses schema validation by calling `execute` directly with an on_complete + schedule combination the schema would reject; it pins the `triggerType === 'cron'` guard so the `&&`→`||` mutant at L73 cannot survive.

- [ ] **Step 2: Run the test file**

Run: `bun test tests/tools/create-recurring-task.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 3: Lint, typecheck, commit**

Run: `bun run lint && bun run typecheck`
Expected: no errors.

```bash
git add tests/tools/create-recurring-task.test.ts
git commit -m "test(tools): cover create_recurring_task compile branch"
```

---

### Task 3: Result-mapping describe block

Kills the L113 cluster (4 ConditionalExpression + 2 LogicalOperator) in `buildRecurringTaskResult` and pins the result shape.

**Files:**
- Modify: `tests/tools/create-recurring-task.test.ts`

**Interfaces:**
- Consumes: everything from Task 2's file state; `RecurringTaskRecord` (already imported).
- Produces: describe block `'create-recurring-task — result mapping'`; no exports.

Background for the expected strings (do not copy into code): `describeCompiledRecurrence({ rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0', dtstartUtc: '2026-06-01T09:00:00.000Z', timezone: 'UTC' })` returns `'daily at 09:00 UTC'`; `utcToLocal('2026-06-01T12:00:00.000Z', 'Europe/Berlin')` returns `'2026-06-01T14:00:00'` (naive local, CEST); with timezone `'UTC'` it returns `'2026-06-01T12:00:00'`.

- [ ] **Step 1: Append the result-mapping describe block**

```typescript
describe('create-recurring-task — result mapping', () => {
  type ToolInput = Parameters<NonNullable<ReturnType<typeof makeCreateRecurringTaskTool>['execute']>>[0]

  const cronInput: ToolInput = {
    title: 'Task',
    projectId: 'p1',
    triggerType: 'cron',
    schedule: { freq: 'DAILY' },
  }

  beforeEach(() => {
    mockLogger()
    setCachedConfig('user-1', 'timezone', 'UTC')
  })

  function makeResultRecord(overrides: Partial<RecurringTaskRecord>): RecurringTaskRecord {
    return {
      id: 'rec-1',
      userId: 'user-1',
      projectId: 'p1',
      title: 'Task',
      description: null,
      priority: null,
      status: null,
      assignee: null,
      labels: [],
      triggerType: 'cron',
      rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-06-01T09:00:00.000Z',
      timezone: 'UTC',
      enabled: true,
      catchUp: false,
      lastRun: null,
      nextRun: '2026-06-01T12:00:00.000Z',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
      ...overrides,
    }
  }

  async function executeWithRecord(record: RecurringTaskRecord, input: ToolInput = cronInput): Promise<unknown> {
    const deps: CreateRecurringTaskDeps = { createRecurringTask: () => record }
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    return tool.execute(input, toolCtx)
  }

  test('describes the compiled schedule for a cron record with rrule and dtstartUtc', async () => {
    const result = await executeWithRecord(makeResultRecord({}))
    expect(result).toEqual({
      id: 'rec-1',
      title: 'Task',
      projectId: 'p1',
      triggerType: 'cron',
      schedule: 'daily at 09:00 UTC',
      nextRun: '2026-06-01T12:00:00',
      enabled: true,
    })
  })

  test('falls back when rrule is null', async () => {
    const result = (await executeWithRecord(makeResultRecord({ rrule: null }))) as { schedule: string }
    expect(result.schedule).toBe('after completion of current instance')
  })

  test('falls back when dtstartUtc is null', async () => {
    const result = (await executeWithRecord(makeResultRecord({ dtstartUtc: null }))) as { schedule: string }
    expect(result.schedule).toBe('after completion of current instance')
  })

  test('falls back for on_complete records', async () => {
    const result = (await executeWithRecord(makeResultRecord({ triggerType: 'on_complete', rrule: null, dtstartUtc: null }), {
      title: 'Task',
      projectId: 'p1',
      triggerType: 'on_complete',
    })) as { schedule: string }
    expect(result.schedule).toBe('after completion of current instance')
  })

  test('converts nextRun into the record timezone as naive local time', async () => {
    const result = (await executeWithRecord(makeResultRecord({ timezone: 'Europe/Berlin' }))) as {
      nextRun: string
    }
    expect(result.nextRun).toBe('2026-06-01T14:00:00')
  })

  test('passes null nextRun through', async () => {
    const result = (await executeWithRecord(makeResultRecord({ nextRun: null }))) as { nextRun: string | null }
    expect(result.nextRun).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test file**

Run: `bun test tests/tools/create-recurring-task.test.ts`
Expected: PASS — 19 tests. If `'describes the compiled schedule…'` fails on the `schedule` string, print the actual value with a temporary `console.log(result)` and align (it comes from `describeCompiledRecurrence` in src/recurrence.ts — do not change the source).

- [ ] **Step 3: Lint, typecheck, commit**

Run: `bun run lint && bun run typecheck`
Expected: no errors.

```bash
git add tests/tools/create-recurring-task.test.ts
git commit -m "test(tools): cover create_recurring_task result mapping"
```

---

### Task 4: Failure-path test + full mutation verification

Adds the error-propagation lock, then runs the paired mutation analysis as the wholesale proof that the planned mutants died.

**Files:**
- Modify: `tests/tools/create-recurring-task.test.ts`

**Interfaces:**
- Consumes: everything from Task 3's file state.
- Produces: describe block `'create-recurring-task — failure propagation'`; no exports.

- [ ] **Step 1: Append the failure-path describe block**

```typescript
describe('create-recurring-task — failure propagation', () => {
  beforeEach(() => {
    mockLogger()
    setCachedConfig('user-1', 'timezone', 'UTC')
  })

  test('rethrows when the store fails', () => {
    const deps: CreateRecurringTaskDeps = {
      createRecurringTask: (): RecurringTaskRecord => {
        throw new Error('db down')
      },
    }
    const tool = makeCreateRecurringTaskTool('user-1', deps)
    assert(tool.execute, 'Tool execute is undefined')
    expect(() => tool.execute({ title: 'Task', projectId: 'p1', triggerType: 'on_complete' }, toolCtx)).toThrow(
      'db down',
    )
  })
})
```

- [ ] **Step 2: Run the test file**

Run: `bun test tests/tools/create-recurring-task.test.ts`
Expected: PASS — 20 tests.

- [ ] **Step 3: Run the paired mutation analysis**

Run: `bun test:mutate:file src/tools/create-recurring-task.ts`
Expected: `killed≈86 survived≈18`, score **≥ 0.78** (pre-change: `killed=50 survived=54 score=0.481`). The ~18 accepted survivors are `.describe()` prose, the logger scope string, and log message/metadata strings/objects (src/tools/create-recurring-task.ts L29, L33–L46, L68, L99, L144).

If any survivor is a ConditionalExpression, LogicalOperator, ArrayDeclaration, or an enum/validation-message string, it was supposed to die: inspect the report with

```bash
bun -e "
const r = await Bun.file('reports/paired/src__tools__create-recurring-task.ts.stryker-report.json').json();
const f = r.files['src/tools/create-recurring-task.ts'];
for (const m of f.mutants.filter((x) => x.status === 'Survived')) console.log(m.mutatorName, 'L' + m.location.start.line, JSON.stringify(m.replacement));
"
```

then strengthen the corresponding test (each block maps to a line cluster per Tasks 1–3) and re-run. Do not edit the source to kill a mutant.

- [ ] **Step 4: Lint, typecheck, commit**

Run: `bun run lint && bun run typecheck`
Expected: no errors.

```bash
git add tests/tools/create-recurring-task.test.ts
git commit -m "test(tools): cover create_recurring_task failure path"
```
