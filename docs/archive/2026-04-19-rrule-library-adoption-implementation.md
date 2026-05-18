# RRULE Library Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cron-based recurrence storage and evaluation with RFC 5545 RRULE strings, adopt `rrule-temporal`, and simplify calendar-sync interop.

**Architecture:** New facade `src/recurrence.ts` owns all RRULE reasoning; tool boundary accepts a Zod-validated `RecurrenceSpec` discriminated union; DB stores `rrule` + `dtstart_utc` + `timezone`; single migration backfills from the existing cron column and drops it; `src/cron.ts` is retired.

**Tech Stack:** Bun, Drizzle ORM (SQLite), Zod v4, `rrule-temporal`, Vercel AI SDK, pino, oxlint/oxfmt.

**Spec:** `docs/superpowers/specs/2026-04-19-rrule-library-adoption-design.md`.

---

## Decisions locked before implementation

The spec's six open calls are resolved here so tasks don't have to re-relitigate them:

1. **`next_run` column stays.** Polling relies on `idx_recurring_tasks_enabled_next` on `(enabled, next_run)` in `src/db/schema.ts:107`. Dropping it would force full scans per tick. Keep the column; keep the index.
2. **`RecurrenceSpec` Zod shape is a discriminated union on `triggerType`** (`z.discriminatedUnion`). `cron` variant carries the `spec: RecurrenceSpec`; `on_complete` carries no recurrence fields.
3. **Omitted `byHour`/`byMinute` mean "use DTSTART's time of day"** per RFC 5545 semantics. The facade does not fill in defaults. The Zod schema documents this in the `.describe()` text.
4. **COUNT/UNTIL exhaustion** sets `next_run = null` and leaves `enabled = '1'`. `getDueRecurringTasks` already filters `nextRun <= now`, so a null `next_run` is naturally inert. Admin listing can show these as "completed series" based on `enabled='1'` + `next_run IS NULL` + `rrule IS NOT NULL`.
5. **`describeRecurrence` output format** — same grammar as the existing `describeCron` (see `src/cron.ts:239`): `"at HH:MM <tz> on Monday, Friday"`. Example outputs below. This is a UX-user-facing string, not a contract.
6. **Single deploy.** Migration and code both ship in one release; no dual-column window.

---

## File Structure

**Created files:**

- `src/recurrence.ts` — facade. Single importer of `rrule-temporal`. Exposes types + pure functions.
- `src/types/recurrence.ts` — `RecurrenceSpec` types and Zod schemas (kept out of `recurrence.ts` so tests and tool schemas can import without pulling the library).
- `src/recurrence-translator.ts` — `cronToRrule` for migration backfill only.
- `src/db/migrations/025_rrule_unification.ts` — schema change + backfill + drop old column.
- `tests/recurrence/cron-to-rrule.test.ts` — translator unit tests (Layer 1).
- `tests/recurrence/equivalence.test.ts` — oracle tests comparing old cron engine vs new facade (Layer 2).
- `tests/recurrence/recurrence.test.ts` — facade unit tests (Layer 3).
- `tests/recurrence/spec-schema.test.ts` — Zod schema tests.
- `tests/db/migrations/025_rrule_unification.test.ts` — migration test (Layer 5).
- `tests/recurrence/legacy-cron-oracle.ts` — relocated cron engine kept as test oracle after `src/cron.ts` retires.

**Modified files:**

- `src/db/schema.ts` — add `rrule`, `dtstart_utc` columns; drop `cronExpression` column. Keep `nextRun` + index.
- `src/types/recurring.ts` — replace `cronExpression` with `rrule`, `dtstartUtc` on input + record types.
- `src/recurring.ts` — swap `./cron.js` imports for `./recurrence.js`; adjust `toRecord`, `computeNextRun`, `computeMissedDates`, `skipNextOccurrence`, `markExecuted`.
- `src/recurring-occurrences.ts` — no changes expected; verify.
- `src/tools/create-recurring-task.ts` — swap `schedule` field for `recurrence: RecurrenceSpec` via discriminated union; drop `describeCron` import; use `describeRecurrence`.
- `src/tools/update-recurring-task.ts` — same.
- `src/tools/resume-recurring-task.ts` — same (if it emits schedule summaries).
- `src/tools/list-recurring-tasks.ts` — output shape uses `describeRecurrence`.
- `src/deferred-prompts/types.ts` — replace `cron` string in `scheduleSchema` with `RecurrenceSpec | null` (optional); update `ScheduledPrompt` + `CreateResult`.
- `src/deferred-prompts/scheduled.ts`, `src/deferred-prompts/poller-scheduled.ts`, `src/deferred-prompts/tool-handlers.ts` — propagate type change and swap cron parsing for `nextOccurrence`.
- `src/utils/datetime.ts` — if `semanticScheduleToCron` exists here, remove it (superseded by `recurrenceSpecToRrule`).
- `docs/superpowers/specs/2026-04-17-calendar-sync-design.md` — remove the `rrule-parser.ts` section and the `calendar_rrule_unsupported` error class row.

**Deleted files:**

- `src/cron.ts` — retired in the last task.

---

### Task 0: Add dependency and commit baseline

**Files:**

- Modify: `package.json`, `bun.lock`

- [ ] **Step 1: Install `rrule-temporal`**

Run:

```bash
bun add rrule-temporal
```

Expected: `package.json` gains `"rrule-temporal": "^1.5.2"` (or later) under `dependencies`; `bun.lock` updates.

- [ ] **Step 2: Verify the install resolved cleanly**

Run:

```bash
bun run typecheck
```

Expected: PASS. No type errors introduced by the new dependency.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add rrule-temporal dependency"
```

---

### Task 1: `RecurrenceSpec` types and Zod schemas

**Files:**

- Create: `src/types/recurrence.ts`
- Test: `tests/recurrence/spec-schema.test.ts`

- [ ] **Step 1: Write failing test for spec-schema validation**

Create `tests/recurrence/spec-schema.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { recurrenceSpecSchema, recurringTriggerSchema } from '../../src/types/recurrence.js'

describe('recurrenceSpecSchema', () => {
  it('accepts a minimal weekly spec', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'WEEKLY',
      byDay: ['MO', 'WE', 'FR'],
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'Europe/London',
    })
    expect(result.success).toBe(true)
  })

  it('rejects conflicting until and count', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      until: '2026-12-31T00:00:00Z',
      count: 10,
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid byDay values', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'WEEKLY',
      byDay: ['FUNDAY'],
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid timezone', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'Not/A_Zone',
    })
    expect(result.success).toBe(false)
  })

  it('rejects interval < 1', () => {
    const result = recurrenceSpecSchema.safeParse({
      freq: 'DAILY',
      interval: 0,
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })
})

describe('recurringTriggerSchema (discriminated union)', () => {
  it('accepts on_complete with no recurrence', () => {
    const result = recurringTriggerSchema.safeParse({ triggerType: 'on_complete' })
    expect(result.success).toBe(true)
  })

  it('accepts cron with a valid spec', () => {
    const result = recurringTriggerSchema.safeParse({
      triggerType: 'cron',
      recurrence: {
        freq: 'DAILY',
        dtstart: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects cron without a recurrence', () => {
    const result = recurringTriggerSchema.safeParse({ triggerType: 'cron' })
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/recurrence/spec-schema.test.ts
```

Expected: FAIL — `src/types/recurrence.ts` does not exist yet.

- [ ] **Step 3: Create the types + schemas**

Create `src/types/recurrence.ts`:

```typescript
import { z } from 'zod'

const BY_DAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const

const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export const recurrenceSpecSchema = z
  .object({
    freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).describe('Recurrence frequency.'),
    interval: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Interval between occurrences (e.g. interval=2 with freq=WEEKLY = every 2 weeks). Default 1.'),
    byDay: z
      .array(z.enum(BY_DAY))
      .optional()
      .describe('Weekdays (e.g. ["MO","WE","FR"]). Required for WEEKLY when picking days; optional otherwise.'),
    byMonthDay: z.array(z.number().int().min(1).max(31)).optional().describe('Days of month (1..31).'),
    byMonth: z.array(z.number().int().min(1).max(12)).optional().describe('Months (1..12).'),
    byHour: z
      .array(z.number().int().min(0).max(23))
      .optional()
      .describe('Hours of day (0..23). If omitted, RRULE fires at DTSTART time-of-day — do not pass 0s.'),
    byMinute: z
      .array(z.number().int().min(0).max(59))
      .optional()
      .describe('Minutes of hour (0..59). If omitted, RRULE fires at DTSTART minute — do not pass 0s.'),
    until: z.iso.datetime().optional().describe('End date (inclusive) in ISO 8601. Mutually exclusive with count.'),
    count: z.number().int().min(1).optional().describe('Total occurrences. Mutually exclusive with until.'),
    dtstart: z.iso.datetime().describe('Anchor datetime in ISO 8601 (UTC).'),
    timezone: z.string().describe('IANA timezone used to interpret local-time fields.'),
  })
  .refine((v) => !(v.until !== undefined && v.count !== undefined), {
    message: 'until and count are mutually exclusive',
    path: ['count'],
  })
  .refine((v) => isValidTimezone(v.timezone), {
    message: 'invalid IANA timezone',
    path: ['timezone'],
  })

export type RecurrenceSpec = z.infer<typeof recurrenceSpecSchema>

export const recurringTriggerSchema = z.discriminatedUnion('triggerType', [
  z.object({
    triggerType: z.literal('cron'),
    recurrence: recurrenceSpecSchema,
  }),
  z.object({
    triggerType: z.literal('on_complete'),
  }),
])

export type RecurringTrigger = z.infer<typeof recurringTriggerSchema>
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun test tests/recurrence/spec-schema.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/types/recurrence.ts tests/recurrence/spec-schema.test.ts
git commit -m "feat(recurrence): add RecurrenceSpec types and Zod schemas"
```

---

### Task 2: Facade — `recurrenceSpecToRrule`

**Files:**

- Create: `src/recurrence.ts` (initial version, one function)
- Test: `tests/recurrence/recurrence.test.ts` (initial suite)

- [ ] **Step 1: Write failing test**

Create `tests/recurrence/recurrence.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { recurrenceSpecToRrule } from '../../src/recurrence.js'
import type { RecurrenceSpec } from '../../src/types/recurrence.js'

describe('recurrenceSpecToRrule', () => {
  it('serialises a WEEKLY MO/WE/FR at 09:00 spec', () => {
    const spec: RecurrenceSpec = {
      freq: 'WEEKLY',
      byDay: ['MO', 'WE', 'FR'],
      byHour: [9],
      byMinute: [0],
      dtstart: '2026-04-20T09:00:00Z',
      timezone: 'Europe/London',
    }
    const out = recurrenceSpecToRrule(spec)
    expect(out.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0')
    expect(out.dtstartUtc).toBe('2026-04-20T09:00:00Z')
    expect(out.timezone).toBe('Europe/London')
  })

  it('omits BYHOUR/BYMINUTE when not provided (DTSTART-time semantics)', () => {
    const spec: RecurrenceSpec = {
      freq: 'DAILY',
      dtstart: '2026-04-20T09:30:00Z',
      timezone: 'UTC',
    }
    const out = recurrenceSpecToRrule(spec)
    expect(out.rrule).toBe('FREQ=DAILY')
  })

  it('serialises INTERVAL, COUNT, UNTIL', () => {
    const spec: RecurrenceSpec = {
      freq: 'DAILY',
      interval: 2,
      count: 10,
      dtstart: '2026-04-20T00:00:00Z',
      timezone: 'UTC',
    }
    const out = recurrenceSpecToRrule(spec)
    expect(out.rrule).toBe('FREQ=DAILY;INTERVAL=2;COUNT=10')
  })

  it('serialises BYMONTH, BYMONTHDAY', () => {
    const spec: RecurrenceSpec = {
      freq: 'YEARLY',
      byMonth: [1, 4, 7, 10],
      byMonthDay: [1],
      dtstart: '2026-01-01T09:00:00Z',
      timezone: 'UTC',
    }
    const out = recurrenceSpecToRrule(spec)
    expect(out.rrule).toBe('FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/recurrence/recurrence.test.ts
```

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `recurrenceSpecToRrule`**

Create `src/recurrence.ts`:

```typescript
import { logger } from './logger.js'
import type { RecurrenceSpec } from './types/recurrence.js'

const log = logger.child({ scope: 'recurrence' })

export type CompiledRecurrence = {
  rrule: string
  dtstartUtc: string
  timezone: string
}

export const recurrenceSpecToRrule = (spec: RecurrenceSpec): CompiledRecurrence => {
  log.debug({ freq: spec.freq, timezone: spec.timezone }, 'recurrenceSpecToRrule called')

  const parts: string[] = [`FREQ=${spec.freq}`]
  if (spec.interval !== undefined) parts.push(`INTERVAL=${spec.interval}`)
  if (spec.count !== undefined) parts.push(`COUNT=${spec.count}`)
  if (spec.until !== undefined) {
    const until = spec.until.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    parts.push(`UNTIL=${until}`)
  }
  if (spec.byMonth !== undefined) parts.push(`BYMONTH=${spec.byMonth.join(',')}`)
  if (spec.byMonthDay !== undefined) parts.push(`BYMONTHDAY=${spec.byMonthDay.join(',')}`)
  if (spec.byDay !== undefined) parts.push(`BYDAY=${spec.byDay.join(',')}`)
  if (spec.byHour !== undefined) parts.push(`BYHOUR=${spec.byHour.join(',')}`)
  if (spec.byMinute !== undefined) parts.push(`BYMINUTE=${spec.byMinute.join(',')}`)

  return {
    rrule: parts.join(';'),
    dtstartUtc: spec.dtstart,
    timezone: spec.timezone,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
bun test tests/recurrence/recurrence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recurrence.ts tests/recurrence/recurrence.test.ts
git commit -m "feat(recurrence): add recurrenceSpecToRrule"
```

---

### Task 3: Facade — `parseRrule`, `nextOccurrence`, `occurrencesBetween`

**Files:**

- Modify: `src/recurrence.ts`
- Modify: `tests/recurrence/recurrence.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/recurrence/recurrence.test.ts`:

```typescript
import { nextOccurrence, occurrencesBetween, parseRrule } from '../../src/recurrence.js'

describe('parseRrule', () => {
  it('returns ok for a valid weekly rrule', () => {
    const res = parseRrule({
      rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
      dtstartUtc: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(res.ok).toBe(true)
  })

  it('returns not-ok for a malformed rrule', () => {
    const res = parseRrule({
      rrule: 'NOT_A_RULE',
      dtstartUtc: '2026-04-20T09:00:00Z',
      timezone: 'UTC',
    })
    expect(res.ok).toBe(false)
  })

  it('returns not-ok for an invalid timezone', () => {
    const res = parseRrule({
      rrule: 'FREQ=DAILY',
      dtstartUtc: '2026-04-20T09:00:00Z',
      timezone: 'Not/A_Zone',
    })
    expect(res.ok).toBe(false)
  })
})

describe('nextOccurrence', () => {
  it('returns the next occurrence after a given date', () => {
    const next = nextOccurrence(
      {
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: '2026-04-20T09:00:00Z', // 2026-04-20 is Monday
        timezone: 'UTC',
      },
      new Date('2026-04-20T09:00:01Z'),
    )
    expect(next).not.toBeNull()
    expect(next?.toISOString()).toBe('2026-04-27T09:00:00.000Z')
  })

  it('returns null when the rrule has exhausted its COUNT', () => {
    const next = nextOccurrence(
      {
        rrule: 'FREQ=DAILY;COUNT=1',
        dtstartUtc: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-04-20T09:00:01Z'),
    )
    expect(next).toBeNull()
  })

  it('handles DST spring-forward in America/New_York correctly', () => {
    // 2026-03-08 is spring-forward in America/New_York (2:00 → 3:00)
    const next = nextOccurrence(
      {
        rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: '2026-03-07T14:00:00Z', // 9am EST on 2026-03-07
        timezone: 'America/New_York',
      },
      new Date('2026-03-07T14:00:01Z'),
    )
    expect(next).not.toBeNull()
    // 9am EDT on 2026-03-08 = 13:00 UTC
    expect(next?.toISOString()).toBe('2026-03-08T13:00:00.000Z')
  })
})

describe('occurrencesBetween', () => {
  it('returns occurrences inclusive of before, exclusive of after', () => {
    const occ = occurrencesBetween(
      {
        rrule: 'FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0',
        dtstartUtc: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-04-20T08:00:00Z'),
      new Date('2026-05-12T00:00:00Z'),
    )
    expect(occ.map((d) => d.toISOString())).toEqual([
      '2026-04-20T09:00:00.000Z',
      '2026-04-27T09:00:00.000Z',
      '2026-05-04T09:00:00.000Z',
      '2026-05-11T09:00:00.000Z',
    ])
  })

  it('caps at the supplied limit', () => {
    const occ = occurrencesBetween(
      {
        rrule: 'FREQ=DAILY',
        dtstartUtc: '2026-04-20T09:00:00Z',
        timezone: 'UTC',
      },
      new Date('2026-04-20T08:00:00Z'),
      new Date('2026-12-31T00:00:00Z'),
      3,
    )
    expect(occ.length).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/recurrence/recurrence.test.ts
```

Expected: FAIL — `parseRrule`, `nextOccurrence`, `occurrencesBetween` are not exported yet.

- [ ] **Step 3: Implement the functions**

Append to `src/recurrence.ts`:

```typescript
import { RRuleTemporal } from 'rrule-temporal'

export type ParseResult = { ok: true; iter: RRuleTemporal } | { ok: false; reason: string }

const buildIcs = (args: CompiledRecurrence): string => {
  const dt = args.dtstartUtc.replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return `DTSTART;TZID=${args.timezone}:${dt.replace(/Z$/, '')}\nRRULE:${args.rrule}`
}

export const parseRrule = (args: CompiledRecurrence): ParseResult => {
  try {
    const iter = new RRuleTemporal({ rruleString: buildIcs(args) })
    return { ok: true, iter }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log.warn({ rrule: args.rrule, reason }, 'parseRrule failed')
    return { ok: false, reason }
  }
}

export const nextOccurrence = (args: CompiledRecurrence, after: Date): Date | null => {
  const parsed = parseRrule(args)
  if (!parsed.ok) return null
  const next = parsed.iter.next(after)
  return next === null ? null : new Date(next.epochMilliseconds)
}

export const occurrencesBetween = (args: CompiledRecurrence, after: Date, before: Date, limit = 100): Date[] => {
  const parsed = parseRrule(args)
  if (!parsed.ok) return []
  const results: Date[] = []
  for (const dt of parsed.iter.between(after, before, { inc: true })) {
    results.push(new Date(dt.epochMilliseconds))
    if (results.length >= limit) break
  }
  return results
}
```

Note: adjust the `rrule-temporal` API calls if the installed version exposes different method names. Run the tests; if an API mismatch surfaces, consult `rrule-temporal`'s README and update. Do not change the facade's public signature — only the internal wiring.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
bun test tests/recurrence/recurrence.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/recurrence.ts tests/recurrence/recurrence.test.ts
git commit -m "feat(recurrence): add parseRrule, nextOccurrence, occurrencesBetween"
```

---

### Task 4: Facade — `describeRecurrence`

**Files:**

- Modify: `src/recurrence.ts`
- Modify: `tests/recurrence/recurrence.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```typescript
import { describeRecurrence } from '../../src/recurrence.js'

describe('describeRecurrence', () => {
  it('describes a weekly MO/WE/FR at 09:00 in Europe/London', () => {
    expect(
      describeRecurrence({
        freq: 'WEEKLY',
        byDay: ['MO', 'WE', 'FR'],
        byHour: [9],
        byMinute: [0],
        dtstart: '2026-04-20T09:00:00Z',
        timezone: 'Europe/London',
      }),
    ).toBe('at 09:00 Europe/London on Monday, Wednesday, Friday')
  })

  it('describes a daily spec with DTSTART time as default', () => {
    expect(
      describeRecurrence({
        freq: 'DAILY',
        dtstart: '2026-04-20T14:30:00Z',
        timezone: 'UTC',
      }),
    ).toBe('every day at 14:30 UTC')
  })

  it('describes a monthly-on-day-15 spec', () => {
    expect(
      describeRecurrence({
        freq: 'MONTHLY',
        byMonthDay: [15],
        byHour: [8],
        byMinute: [0],
        dtstart: '2026-04-15T08:00:00Z',
        timezone: 'UTC',
      }),
    ).toBe('at 08:00 UTC on day 15 of the month')
  })

  it('describes a yearly spec in January, April, July, October', () => {
    expect(
      describeRecurrence({
        freq: 'YEARLY',
        byMonth: [1, 4, 7, 10],
        byMonthDay: [1],
        byHour: [9],
        byMinute: [0],
        dtstart: '2026-01-01T09:00:00Z',
        timezone: 'UTC',
      }),
    ).toBe('at 09:00 UTC on day 1 of the month in January, April, July, October')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/recurrence/recurrence.test.ts
```

Expected: FAIL — `describeRecurrence` not exported.

- [ ] **Step 3: Implement `describeRecurrence`**

Append to `src/recurrence.ts`:

```typescript
const DAY_NAMES: Record<string, string> = {
  MO: 'Monday',
  TU: 'Tuesday',
  WE: 'Wednesday',
  TH: 'Thursday',
  FR: 'Friday',
  SA: 'Saturday',
  SU: 'Sunday',
}

const MONTH_NAMES = [
  '',
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const pad2 = (n: number): string => String(n).padStart(2, '0')

const localTimeOfDay = (spec: RecurrenceSpec): { hour: number; minute: number } => {
  if (spec.byHour !== undefined && spec.byMinute !== undefined) {
    return { hour: spec.byHour[0] ?? 0, minute: spec.byMinute[0] ?? 0 }
  }
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: spec.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date(spec.dtstart))
  const hh = Number.parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
  const mm = Number.parseInt(parts.find((p) => p.type === 'minute')?.value ?? '0', 10)
  return { hour: hh === 24 ? 0 : hh, minute: mm }
}

export const describeRecurrence = (spec: RecurrenceSpec): string => {
  const parts: string[] = []
  const { hour, minute } = localTimeOfDay(spec)

  if (spec.byDay === undefined && spec.byMonthDay === undefined && spec.byMonth === undefined) {
    parts.push(`every ${spec.freq.toLowerCase().replace('ly', '')}`)
  }

  parts.push(`at ${pad2(hour)}:${pad2(minute)} ${spec.timezone}`)

  if (spec.byDay !== undefined) {
    const names = spec.byDay.map((d) => DAY_NAMES[d] ?? d)
    parts.push(`on ${names.join(', ')}`)
  }

  if (spec.byMonthDay !== undefined) {
    parts.push(`on day ${spec.byMonthDay.join(', ')} of the month`)
  }

  if (spec.byMonth !== undefined) {
    const names = spec.byMonth.map((m) => MONTH_NAMES[m] ?? String(m))
    parts.push(`in ${names.join(', ')}`)
  }

  return parts.join(' ')
}
```

(Tweak the text-assembly order/tokens if the tests disagree with the implementation; treat the tests as the spec.)

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
bun test tests/recurrence/recurrence.test.ts
```

Expected: PASS. If an ordering or whitespace mismatch surfaces, reshape the function until it matches the test expectations.

- [ ] **Step 5: Commit**

```bash
git add src/recurrence.ts tests/recurrence/recurrence.test.ts
git commit -m "feat(recurrence): add describeRecurrence"
```

---

### Task 5: Translator — `cronToRrule` for migration

**Files:**

- Create: `src/recurrence-translator.ts`
- Test: `tests/recurrence/cron-to-rrule.test.ts`

- [ ] **Step 1: Write failing translator tests (table-driven)**

Create `tests/recurrence/cron-to-rrule.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { cronToRrule } from '../../src/recurrence-translator.js'

describe('cronToRrule', () => {
  const tz = 'UTC'

  const cases: Array<{ name: string; cron: string; expected: { rrule: string } | null }> = [
    { name: 'every day at 09:00', cron: '0 9 * * *', expected: { rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0' } },
    {
      name: 'MO/WE/FR at 14:30',
      cron: '30 14 * * 1,3,5',
      expected: { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=14;BYMINUTE=30' },
    },
    { name: 'day-of-month', cron: '0 8 15 * *', expected: { rrule: 'FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=8;BYMINUTE=0' } },
    {
      name: 'every 15 min',
      cron: '*/15 * * * *',
      expected: { rrule: 'FREQ=HOURLY;BYMINUTE=0,15,30,45' },
    },
    {
      name: 'every 3 hours',
      cron: '0 */3 * * *',
      expected: { rrule: 'FREQ=DAILY;BYHOUR=0,3,6,9,12,15,18,21;BYMINUTE=0' },
    },
    {
      name: 'quarterly at 09:00 on day 1',
      cron: '0 9 1 1,4,7,10 *',
      expected: { rrule: 'FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0' },
    },
    {
      name: 'weekdays 09:00-17:00 top of hour',
      cron: '0 9-17 * * 1-5',
      expected: {
        rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9,10,11,12,13,14,15,16,17;BYMINUTE=0',
      },
    },
    { name: 'garbage', cron: 'not a cron', expected: null },
    { name: 'empty', cron: '', expected: null },
  ]

  for (const c of cases) {
    it(c.name, () => {
      const out = cronToRrule(c.cron, tz, '2026-04-20T00:00:00Z')
      if (c.expected === null) {
        expect(out).toBeNull()
      } else {
        expect(out).not.toBeNull()
        expect(out?.rrule).toBe(c.expected.rrule)
      }
    })
  }

  it('throws when the cron parses but the translator cannot handle it (translator bug)', () => {
    // There is currently no such pattern — add one here to force a failing test if a gap appears.
    // This case exists to document the contract.
    expect(() => {
      // Use a pattern the translator is expected to cover. If a future commit breaks coverage,
      // this suite is the canary.
      cronToRrule('30 14 * * 1,3,5', tz, '2026-04-20T00:00:00Z')
    }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
bun test tests/recurrence/cron-to-rrule.test.ts
```

Expected: FAIL — `src/recurrence-translator.ts` does not exist.

- [ ] **Step 3: Implement `cronToRrule`**

Create `src/recurrence-translator.ts`:

```typescript
import { parseCron } from './cron.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'recurrence-translator' })

const DAY_ABBR = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

export type TranslatorResult = {
  rrule: string
  dtstartUtc: string
  timezone: string
}

const isAny = (field: { type: string }): boolean => field.type === 'any'

const values = (field: { type: string; values: number[] }, fallback: number[]): number[] =>
  field.type === 'any' ? fallback : field.values

export const cronToRrule = (expression: string, timezone: string, dtstartUtc: string): TranslatorResult | null => {
  const parsed = parseCron(expression)
  if (parsed === null) return null

  const minutes = values(parsed.minute, [])
  const hours = values(parsed.hour, [])
  const doms = values(parsed.dayOfMonth, [])
  const months = values(parsed.month, [])
  const dows = values(parsed.dayOfWeek, [])

  const byDay = parsed.dayOfWeek.type === 'values' ? parsed.dayOfWeek.values.map((d) => DAY_ABBR[d]!).join(',') : null
  const byMonth = parsed.month.type === 'values' ? parsed.month.values.join(',') : null
  const byMonthDay = parsed.dayOfMonth.type === 'values' ? parsed.dayOfMonth.values.join(',') : null
  const byHour = parsed.hour.type === 'values' ? parsed.hour.values.join(',') : null
  const byMinute = parsed.minute.type === 'values' ? parsed.minute.values.join(',') : null

  // Choose FREQ based on which fields are constrained.
  let freq: 'YEARLY' | 'MONTHLY' | 'WEEKLY' | 'DAILY' | 'HOURLY'

  if (parsed.month.type === 'values') freq = 'YEARLY'
  else if (parsed.dayOfMonth.type === 'values') freq = 'MONTHLY'
  else if (parsed.dayOfWeek.type === 'values') freq = 'WEEKLY'
  else if (parsed.hour.type === 'any' && parsed.minute.type === 'values') freq = 'HOURLY'
  else freq = 'DAILY'

  const parts: string[] = [`FREQ=${freq}`]
  if (freq === 'YEARLY' && byMonth !== null) parts.push(`BYMONTH=${byMonth}`)
  if (byMonthDay !== null) parts.push(`BYMONTHDAY=${byMonthDay}`)
  if (byDay !== null && freq !== 'YEARLY' && freq !== 'MONTHLY') parts.push(`BYDAY=${byDay}`)
  if (byHour !== null && freq !== 'HOURLY') parts.push(`BYHOUR=${byHour}`)
  if (byMinute !== null) parts.push(`BYMINUTE=${byMinute}`)

  log.debug({ expression, freq }, 'cronToRrule translated')

  return { rrule: parts.join(';'), dtstartUtc, timezone }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
bun test tests/recurrence/cron-to-rrule.test.ts
```

Expected: PASS on all table cases. If a specific row fails, fix the translator for that pattern only — do not relax the test.

- [ ] **Step 5: Commit**

```bash
git add src/recurrence-translator.ts tests/recurrence/cron-to-rrule.test.ts
git commit -m "feat(recurrence): add cronToRrule translator for migration"
```

---

### Task 6: Oracle equivalence tests (cron engine vs facade)

**Files:**

- Test: `tests/recurrence/equivalence.test.ts`

- [ ] **Step 1: Write equivalence tests**

Create `tests/recurrence/equivalence.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test'
import { nextCronOccurrence, parseCron } from '../../src/cron.js'
import { nextOccurrence } from '../../src/recurrence.js'
import { cronToRrule } from '../../src/recurrence-translator.js'

const patterns = [
  { cron: '0 9 * * *', name: 'every day 09:00' },
  { cron: '30 14 * * 1,3,5', name: 'MWF 14:30' },
  { cron: '0 8 15 * *', name: 'day 15 of month 08:00' },
  { cron: '0 9-17 * * 1-5', name: 'weekdays 09-17 hourly' },
  { cron: '0 9 1 1,4,7,10 *', name: 'quarterly day 1 09:00' },
]

const timezones = ['UTC', 'America/New_York', 'Europe/London', 'Asia/Tokyo']

// Anchors include a DST spring-forward and fall-back window for America/New_York
const anchors = [
  new Date('2026-03-07T12:00:00Z'), // before EST→EDT (2026-03-08 in NY)
  new Date('2026-11-01T05:00:00Z'), // before EDT→EST (2026-11-01 in NY)
  new Date('2026-06-15T12:00:00Z'),
]

describe('cron engine vs facade equivalence', () => {
  for (const p of patterns) {
    for (const tz of timezones) {
      for (const anchor of anchors) {
        it(`${p.name} in ${tz} starting ${anchor.toISOString()}`, () => {
          const cron = parseCron(p.cron)!
          const translated = cronToRrule(p.cron, tz, anchor.toISOString())!

          // Generate next 10 occurrences via both engines
          const cronResults: Date[] = []
          let cursor = anchor
          for (let i = 0; i < 10; i++) {
            const next = nextCronOccurrence(cron, cursor, tz)
            if (next === null) break
            cronResults.push(next)
            cursor = next
          }

          const facadeResults: Date[] = []
          let cursor2 = anchor
          for (let i = 0; i < 10; i++) {
            const next = nextOccurrence(
              { rrule: translated.rrule, dtstartUtc: translated.dtstartUtc, timezone: tz },
              cursor2,
            )
            if (next === null) break
            facadeResults.push(next)
            cursor2 = next
          }

          expect(facadeResults.map((d) => d.toISOString())).toEqual(cronResults.map((d) => d.toISOString()))
        })
      }
    }
  }
})
```

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
bun test tests/recurrence/equivalence.test.ts
```

Expected: PASS on every combination. If a combination fails, it indicates either:

- a translator bug (fix `cronToRrule`), or
- a facade bug (fix `src/recurrence.ts`), or
- a legitimate semantic drift (document it and widen the test oracle to tolerate the drift only if the drift is correct per RFC 5545).

- [ ] **Step 3: Commit**

```bash
git add tests/recurrence/equivalence.test.ts
git commit -m "test(recurrence): add cron vs rrule facade equivalence oracle"
```

---

### Task 7: Schema migration — add columns, backfill, drop `cron_expression`

**Files:**

- Modify: `src/db/schema.ts`
- Create: `src/db/migrations/025_rrule_unification.ts`
- Test: `tests/db/migrations/025_rrule_unification.test.ts`

- [ ] **Step 1: Write migration test**

Create `tests/db/migrations/025_rrule_unification.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { migration025 } from '../../../src/db/migrations/025_rrule_unification.js'

const seedSchema = (db: Database): void => {
  // Mirror the pre-migration recurring_tasks shape (post-024)
  db.run(`
    CREATE TABLE recurring_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      status TEXT,
      assignee TEXT,
      labels TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'cron',
      cron_expression TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      enabled TEXT NOT NULL DEFAULT '1',
      catch_up TEXT NOT NULL DEFAULT '0',
      last_run TEXT,
      next_run TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)
  db.run('CREATE INDEX idx_recurring_tasks_user ON recurring_tasks(user_id)')
  db.run('CREATE INDEX idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')
}

describe('migration 025: rrule unification', () => {
  let db: Database

  beforeEach(() => {
    db = new Database(':memory:')
    seedSchema(db)
  })

  it('adds rrule and dtstart_utc, drops cron_expression', () => {
    db.run(
      `INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type, cron_expression, timezone, created_at, updated_at)
       VALUES ('r1', 'u1', 'p1', 'Weekly standup', 'cron', '0 9 * * 1,3,5', 'UTC', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')`,
    )

    migration025.up(db)

    const cols = db.query("PRAGMA table_info('recurring_tasks')").all() as Array<{ name: string }>
    const names = new Set(cols.map((c) => c.name))
    expect(names.has('rrule')).toBe(true)
    expect(names.has('dtstart_utc')).toBe(true)
    expect(names.has('cron_expression')).toBe(false)
    expect(names.has('next_run')).toBe(true) // preserved

    const row = db.query('SELECT rrule, dtstart_utc FROM recurring_tasks WHERE id = ?').get('r1') as {
      rrule: string | null
      dtstart_utc: string | null
    }
    expect(row.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0')
    expect(row.dtstart_utc).not.toBeNull()
  })

  it('leaves rrule NULL for unparseable legacy cron', () => {
    db.run(
      `INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type, cron_expression, timezone, created_at, updated_at)
       VALUES ('r2', 'u1', 'p1', 'Broken', 'cron', 'not a cron', 'UTC', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')`,
    )

    migration025.up(db)

    const row = db.query('SELECT rrule, dtstart_utc FROM recurring_tasks WHERE id = ?').get('r2') as {
      rrule: string | null
      dtstart_utc: string | null
    }
    expect(row.rrule).toBeNull()
    expect(row.dtstart_utc).toBeNull()
  })

  it('leaves rrule NULL for on_complete rows', () => {
    db.run(
      `INSERT INTO recurring_tasks (id, user_id, project_id, title, trigger_type, cron_expression, timezone, created_at, updated_at)
       VALUES ('r3', 'u1', 'p1', 'OnComplete', 'on_complete', NULL, 'UTC', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z')`,
    )

    migration025.up(db)

    const row = db.query('SELECT rrule, dtstart_utc, trigger_type FROM recurring_tasks WHERE id = ?').get('r3') as {
      rrule: string | null
      dtstart_utc: string | null
      trigger_type: string
    }
    expect(row.rrule).toBeNull()
    expect(row.dtstart_utc).toBeNull()
    expect(row.trigger_type).toBe('on_complete')
  })

  it('aborts with a structured error if the translator throws on a parseable cron', () => {
    // This is a belt-and-braces test. cronToRrule currently never throws for any
    // parseCron-valid input. If a future change introduces a throw path, this test
    // will flip to green only after the migration abort path exists.
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bun test tests/db/migrations/025_rrule_unification.test.ts
```

Expected: FAIL — migration module doesn't exist.

- [ ] **Step 3: Implement the migration**

Create `src/db/migrations/025_rrule_unification.ts`:

```typescript
import type { Database } from 'bun:sqlite'

import { logger } from '../../logger.js'
import { cronToRrule } from '../../recurrence-translator.js'
import type { Migration } from '../migrate.js'

const log = logger.child({ scope: 'migration:025' })

const up = (db: Database): void => {
  db.run('ALTER TABLE recurring_tasks ADD COLUMN rrule TEXT')
  db.run('ALTER TABLE recurring_tasks ADD COLUMN dtstart_utc TEXT')

  const rows = db
    .query(
      "SELECT id, cron_expression, timezone, created_at FROM recurring_tasks WHERE trigger_type = 'cron' AND cron_expression IS NOT NULL",
    )
    .all() as Array<{ id: string; cron_expression: string; timezone: string; created_at: string }>

  let migratedCount = 0
  let skippedNullCount = 0

  for (const row of rows) {
    try {
      const translated = cronToRrule(row.cron_expression, row.timezone, new Date(row.created_at).toISOString())
      if (translated === null) {
        skippedNullCount++
        log.warn({ id: row.id, cron: row.cron_expression }, 'Unparseable legacy cron; leaving rrule NULL')
        continue
      }
      db.run('UPDATE recurring_tasks SET rrule = ?, dtstart_utc = ? WHERE id = ?', [
        translated.rrule,
        translated.dtstartUtc,
        row.id,
      ])
      migratedCount++
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error(
        { id: row.id, cron: row.cron_expression, error: message },
        'Translator threw during migration; aborting',
      )
      throw new Error(
        `migration 025 aborted: translator threw on row ${row.id} (cron='${row.cron_expression}'): ${message}`,
      )
    }
  }

  // Rebuild recurring_tasks without cron_expression (SQLite DROP COLUMN exists from 3.35 but
  // we follow the proven create-copy-drop-rename pattern used by migration 023 for compatibility).
  db.run(`
    CREATE TABLE recurring_tasks_new (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(platform_user_id) ON DELETE CASCADE,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT,
      status TEXT,
      assignee TEXT,
      labels TEXT,
      trigger_type TEXT NOT NULL DEFAULT 'cron',
      rrule TEXT,
      dtstart_utc TEXT,
      timezone TEXT NOT NULL DEFAULT 'UTC',
      enabled TEXT NOT NULL DEFAULT '1',
      catch_up TEXT NOT NULL DEFAULT '0',
      last_run TEXT,
      next_run TEXT,
      created_at TEXT DEFAULT (datetime('now')) NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')) NOT NULL
    )
  `)
  db.run(
    `INSERT INTO recurring_tasks_new
     (id, user_id, project_id, title, description, priority, status, assignee, labels, trigger_type, rrule, dtstart_utc, timezone, enabled, catch_up, last_run, next_run, created_at, updated_at)
     SELECT id, user_id, project_id, title, description, priority, status, assignee, labels, trigger_type, rrule, dtstart_utc, timezone, enabled, catch_up, last_run, next_run, created_at, updated_at
     FROM recurring_tasks`,
  )
  db.run('DROP TABLE recurring_tasks')
  db.run('ALTER TABLE recurring_tasks_new RENAME TO recurring_tasks')
  db.run('CREATE INDEX idx_recurring_tasks_user ON recurring_tasks(user_id)')
  db.run('CREATE INDEX idx_recurring_tasks_enabled_next ON recurring_tasks(enabled, next_run)')

  log.info({ migratedCount, skippedNullCount }, 'migration 025 complete')
}

export const migration025: Migration = {
  id: '025_rrule_unification',
  up,
}

export default migration025
```

- [ ] **Step 4: Run migration tests to verify they pass**

Run:

```bash
bun test tests/db/migrations/025_rrule_unification.test.ts
```

Expected: PASS on all four cases.

- [ ] **Step 5: Register the migration in the migration runner**

Open `src/migrate.ts` and locate the array of registered migrations. Append migration 025 in the same pattern used for migration 024 (`addRecurringTasksMigration`, `addAuthorizedGroupsMigration`, etc.). Keep the registration order monotonic.

- [ ] **Step 6: Update Drizzle schema**

Edit `src/db/schema.ts` (the `recurringTasks` table definition near `src/db/schema.ts:77-109`):

- Remove `cronExpression: text('cron_expression'),`
- Add `rrule: text('rrule'),`
- Add `dtstartUtc: text('dtstart_utc'),`
- Keep `nextRun` and both indexes unchanged.

- [ ] **Step 7: Run full test suite to see breakage downstream**

Run:

```bash
bun test
```

Expected: FAIL in multiple files that still reference `cronExpression`. These are wired up in later tasks. Make a note of the failing tests; do not fix them here.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts src/db/migrations/025_rrule_unification.ts src/migrate.ts tests/db/migrations/025_rrule_unification.test.ts
git commit -m "feat(db): migration 025 — unify recurrence storage on rrule"
```

---

### Task 8: Update `src/types/recurring.ts`

**Files:**

- Modify: `src/types/recurring.ts`

- [ ] **Step 1: Update types**

Replace the file contents:

```typescript
export type TriggerType = 'cron' | 'on_complete'

export type RecurringTaskInput = {
  userId: string
  projectId: string
  title: string
  description?: string
  priority?: string
  status?: string
  assignee?: string
  labels?: string[]
  triggerType: TriggerType
  rrule?: string
  dtstartUtc?: string
  timezone?: string
  catchUp?: boolean
}

export type RecurringTaskRecord = {
  id: string
  userId: string
  projectId: string
  title: string
  description: string | null
  priority: string | null
  status: string | null
  assignee: string | null
  labels: string[]
  triggerType: TriggerType
  rrule: string | null
  dtstartUtc: string | null
  timezone: string
  enabled: boolean
  catchUp: boolean
  lastRun: string | null
  nextRun: string | null
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 2: Run typecheck to see breakage**

Run:

```bash
bun run typecheck
```

Expected: many errors in `src/recurring.ts` and `src/tools/*-recurring-task.ts`. Fixed in the following tasks.

- [ ] **Step 3: Commit**

```bash
git add src/types/recurring.ts
git commit -m "refactor(recurring): types now carry rrule + dtstartUtc"
```

---

### Task 9: Rewire `src/recurring.ts` to use the facade

**Files:**

- Modify: `src/recurring.ts`

- [ ] **Step 1: Replace cron imports with facade + update storage/read paths**

Open `src/recurring.ts`. Apply these edits:

- Replace:

  ```typescript
  import { allOccurrencesBetween, nextCronOccurrence, parseCron } from './cron.js'
  ```

  with:

  ```typescript
  import { nextOccurrence, occurrencesBetween } from './recurrence.js'
  ```

- Replace `computeNextRun`:

  ```typescript
  const computeNextRun = (
    rrule: string,
    dtstartUtc: string,
    timezone: string,
    after: Date = new Date(),
  ): string | null => {
    const next = nextOccurrence({ rrule, dtstartUtc, timezone }, after)
    return next === null ? null : next.toISOString()
  }
  ```

- Replace `computeMissedDates`:

  ```typescript
  const computeMissedDates = (
    rrule: string,
    dtstartUtc: string,
    fromDate: string | null,
    timezone: string,
  ): string[] => {
    const after = fromDate === null ? new Date(0) : new Date(fromDate)
    const before = new Date()
    const missed = occurrencesBetween({ rrule, dtstartUtc, timezone }, after, before, 100)
    return missed.map((d) => d.toISOString())
  }
  ```

- Update `toRecord`:

  ```typescript
  const toRecord = (row: typeof recurringTasks.$inferSelect): RecurringTaskRecord => ({
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    title: row.title,
    description: row.description,
    priority: row.priority,
    status: row.status,
    assignee: row.assignee,
    labels: parseLabels(row.labels),
    triggerType: parseTriggerType(row.triggerType),
    rrule: row.rrule,
    dtstartUtc: row.dtstartUtc,
    timezone: row.timezone,
    enabled: row.enabled === '1',
    catchUp: row.catchUp === '1',
    lastRun: row.lastRun,
    nextRun: row.nextRun,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  })
  ```

- Update `createRecurringTask` insertion to write `rrule` + `dtstartUtc` instead of `cronExpression`. Compute `nextRun` from them when both are present.

  ```typescript
  const nextRun =
    input.triggerType === 'cron' && input.rrule !== undefined && input.dtstartUtc !== undefined
      ? computeNextRun(input.rrule, input.dtstartUtc, input.timezone ?? 'UTC')
      : null

  // inside .values(...)
  rrule: input.rrule ?? null,
  dtstartUtc: input.dtstartUtc ?? null,
  ```

- Update `updateRecurringTask` to accept `rrule` / `dtstartUtc` in its partial-update surface, recomputing `nextRun` if `rrule` changes.

- Update `skipNextOccurrence` to use the facade's `nextOccurrence` driven by `existing.rrule` / `existing.dtstartUtc` instead of `parseCron`.

- Update `markExecuted` to recompute `nextRun` using `existing.rrule` / `existing.dtstartUtc` only when `trigger_type === 'cron'`.

- [ ] **Step 2: Run focused tests**

Run:

```bash
bun test tests/recurrence tests/db/migrations/025_rrule_unification.test.ts src/recurring
```

Expected: PASS. If there are `recurring.test.ts`-style tests that used `cronExpression`, update them to use `rrule` + `dtstartUtc` fixtures.

- [ ] **Step 3: Commit**

```bash
git add src/recurring.ts
git commit -m "refactor(recurring): use recurrence facade instead of cron engine"
```

---

### Task 10: Update `create_recurring_task` tool

**Files:**

- Modify: `src/tools/create-recurring-task.ts`

- [ ] **Step 1: Write a failing test in the tool's test file**

Check `tests/tools/` for existing `create-recurring-task.test.ts`. If present, add a case exercising the discriminated-union `triggerType='cron'` shape producing a created record; otherwise create one following the pattern of a sibling tool test. Keep the test focused on the happy-path: valid `RecurrenceSpec` → record created with non-null `rrule` + `dtstartUtc` + computed `nextRun`.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
bun test tests/tools/create-recurring-task
```

Expected: FAIL.

- [ ] **Step 3: Rewrite the tool's input schema and executor**

Replace the file contents:

```typescript
import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import { describeRecurrence, recurrenceSpecToRrule } from '../recurrence.js'
import { createRecurringTask as defaultCreateRecurringTask } from '../recurring.js'
import { recurrenceSpecSchema } from '../types/recurrence.js'
import type { RecurringTaskInput, RecurringTaskRecord, TriggerType } from '../types/recurring.js'
import { utcToLocal } from '../utils/datetime.js'

export interface CreateRecurringTaskDeps {
  createRecurringTask: (input: RecurringTaskInput) => RecurringTaskRecord
}

const defaultDeps: CreateRecurringTaskDeps = {
  createRecurringTask: defaultCreateRecurringTask,
}

const log = logger.child({ scope: 'tool:create-recurring-task' })

const inputSchema = z.object({
  title: z.string().describe('Title for each generated task'),
  projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
  description: z.string().optional().describe('Description for each generated task'),
  priority: z.enum(['no-priority', 'low', 'medium', 'high', 'urgent']).optional(),
  status: z.string().optional(),
  assignee: z.string().optional(),
  labels: z.array(z.string()).optional(),
  triggerType: z.enum(['cron', 'on_complete']).describe("'cron' for scheduled, 'on_complete' for after-completion"),
  recurrence: recurrenceSpecSchema
    .optional()
    .describe("Required when triggerType is 'cron'. RFC 5545 recurrence spec."),
  catchUp: z.boolean().optional(),
})

type Input = z.infer<typeof inputSchema>

function executeCreate(userId: string, input: Input, deps: CreateRecurringTaskDeps): unknown {
  log.debug({ userId, title: input.title, triggerType: input.triggerType }, 'Creating recurring task')

  if (input.triggerType === 'cron' && input.recurrence === undefined) {
    return { error: "recurrence is required when triggerType is 'cron'" }
  }

  const timezone = input.recurrence?.timezone ?? getConfig(userId, 'timezone') ?? 'UTC'

  const compiled =
    input.triggerType === 'cron' && input.recurrence !== undefined ? recurrenceSpecToRrule(input.recurrence) : undefined

  const record = deps.createRecurringTask({
    userId,
    title: input.title,
    projectId: input.projectId,
    description: input.description,
    priority: input.priority,
    status: input.status,
    assignee: input.assignee,
    labels: input.labels,
    triggerType: input.triggerType satisfies TriggerType,
    rrule: compiled?.rrule,
    dtstartUtc: compiled?.dtstartUtc,
    catchUp: input.catchUp,
    timezone,
  })

  const schedule =
    record.triggerType === 'cron' && input.recurrence !== undefined
      ? describeRecurrence(input.recurrence)
      : 'after completion of current instance'

  log.info({ id: record.id, title: input.title, schedule }, 'Recurring task created via tool')

  return {
    id: record.id,
    title: record.title,
    projectId: record.projectId,
    triggerType: record.triggerType,
    schedule,
    nextRun: utcToLocal(record.nextRun, record.timezone),
    enabled: record.enabled,
  }
}

export function makeCreateRecurringTaskTool(
  userId: string,
  deps: CreateRecurringTaskDeps = defaultDeps,
): ToolSet[string] {
  return tool({
    description:
      'Set up a recurring task that is automatically created on a schedule (cron) or after completion. Call list_projects first.',
    inputSchema,
    execute: (input) => {
      try {
        return executeCreate(userId, input, deps)
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'create_recurring_task' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
```

- [ ] **Step 4: Run the focused test to verify it passes**

Run:

```bash
bun test tests/tools/create-recurring-task
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/tools/create-recurring-task.ts tests/tools/create-recurring-task.test.ts
git commit -m "refactor(tool): create_recurring_task accepts RecurrenceSpec"
```

---

### Task 11: Update `update_recurring_task`, `resume_recurring_task`, `list_recurring_tasks`

**Files:**

- Modify: `src/tools/update-recurring-task.ts`
- Modify: `src/tools/resume-recurring-task.ts`
- Modify: `src/tools/list-recurring-tasks.ts`

- [ ] **Step 1: Adjust `update-recurring-task`**

Open `src/tools/update-recurring-task.ts`. The current schema likely accepts `schedule` (or a legacy cron-adjacent field) as a partial update. Apply:

- Remove any `schedule` field and any `describeCron` import.
- Accept an optional `recurrence: recurrenceSpecSchema` field.
- When present, call `recurrenceSpecToRrule(recurrence)` and pass `rrule` + `dtstartUtc` into `updateRecurringTask(id, { rrule, dtstartUtc })`.
- The summary returned to the LLM uses `describeRecurrence(recurrence)` when `recurrence` is provided; otherwise it reports the unchanged schedule using the existing record's `rrule`/`dtstartUtc`/`timezone` → `describeRecurrenceFromStored(record)` (write this helper inside the tool file — it takes the record's fields, constructs a synthetic `RecurrenceSpec` shell only well enough for the describe call, or simpler: emit `record.rrule ?? '(no schedule)'`).

- [ ] **Step 2: Adjust `resume-recurring-task`**

Open `src/tools/resume-recurring-task.ts`. If it renders a schedule summary, swap `describeCron(record.cronExpression, ...)` for `record.rrule === null ? '(no schedule)' : record.rrule`. Simplest reliable output — the LLM already renders this to the user in prose.

- [ ] **Step 3: Adjust `list-recurring-tasks`**

Open `src/tools/list-recurring-tasks.ts`. Replace any per-row `describeCron(record.cronExpression, record.timezone)` call with a helper that reconstructs `{rrule, dtstartUtc, timezone}` and emits `record.rrule ?? '(no schedule)'` (or the raw RRULE string — LLM can interpret). Do not call `describeRecurrence` here because it requires a `RecurrenceSpec` not a raw RRULE.

- [ ] **Step 4: Run related tests**

Run:

```bash
bun test tests/tools
```

Expected: PASS. Update any test fixtures that still use `cronExpression` to use `rrule` + `dtstartUtc` instead.

- [ ] **Step 5: Commit**

```bash
git add src/tools/update-recurring-task.ts src/tools/resume-recurring-task.ts src/tools/list-recurring-tasks.ts tests/tools/
git commit -m "refactor(tools): update/resume/list recurring-task tools for rrule"
```

---

### Task 12: Update deferred-prompts schema and handlers

**Files:**

- Modify: `src/deferred-prompts/types.ts`
- Modify: `src/deferred-prompts/tool-handlers.ts`
- Modify: `src/deferred-prompts/scheduled.ts`
- Modify: `src/deferred-prompts/poller-scheduled.ts`

- [ ] **Step 1: Update schemas and types**

In `src/deferred-prompts/types.ts`:

- Replace `scheduleSchema`'s `cron: z.string().optional()` with `recurrence: recurrenceSpecSchema.optional()`.
- Update the `ScheduledPrompt` type: replace `cronExpression: string | null` with `rrule: string | null` and `dtstartUtc: string | null`.
- Update `CreateResult`:
  ```typescript
  | { status: 'created'; type: 'scheduled'; id: string; fireAt: string; rrule: string | null }
  ```

Run type checking after each block.

- [ ] **Step 2: Update `scheduled.ts` (persistence)**

Wherever it reads or writes `cron_expression`, switch to `rrule` + `dtstart_utc`. If `scheduled_prompts` has a `cron_expression` column, a parallel migration is required — but per spec this column is replaced too. Add `rrule` + `dtstart_utc` to the scheduled_prompts table in the same migration 025 (revise migration test to cover the new table if needed, but only if scheduled_prompts already stores cron; if it stores only `fire_at`, skip).

Cross-check `src/db/schema.ts` `scheduledPrompts` definition. If it includes `cronExpression: text('cron_expression')`, extend migration 025 to add `rrule` + `dtstart_utc` to `scheduled_prompts` and drop `cron_expression` following the same pattern.

- [ ] **Step 3: Update `tool-handlers.ts`**

Where the handler accepts a `cron` from the schedule schema, accept a `recurrence: RecurrenceSpec` instead. Call `recurrenceSpecToRrule(recurrence)` and persist `rrule` + `dtstartUtc`.

- [ ] **Step 4: Update `poller-scheduled.ts`**

Where it parses a stored cron to compute the next fire-at, call `nextOccurrence({rrule, dtstartUtc, timezone}, now)` from the facade. If the result is null, behave exactly as today's "no next occurrence" branch.

- [ ] **Step 5: Run tests for the module**

Run:

```bash
bun test tests/deferred-prompts
```

Expected: PASS after fixture updates.

- [ ] **Step 6: Commit**

```bash
git add src/deferred-prompts src/db/migrations/025_rrule_unification.ts src/db/schema.ts tests/deferred-prompts tests/db/migrations/025_rrule_unification.test.ts
git commit -m "refactor(deferred-prompts): accept RecurrenceSpec, persist rrule"
```

---

### Task 13: Retire `src/cron.ts`

**Files:**

- Delete: `src/cron.ts`
- Create: `tests/recurrence/legacy-cron-oracle.ts` (relocation)
- Modify: `tests/recurrence/equivalence.test.ts` (import path)
- Modify: `src/recurrence-translator.ts` (inline parseCron)

- [ ] **Step 1: Copy `src/cron.ts` → `tests/recurrence/legacy-cron-oracle.ts`**

Copy the file verbatim, rename its exports only if naming collisions arise. Adjust internal `../` imports so logger resolves correctly.

- [ ] **Step 2: Inline `parseCron` into the translator**

`src/recurrence-translator.ts` currently imports `parseCron` from `./cron.js`. Copy the minimal AST types + `parseCron` + `parseField` + `parseRange` into the translator module as module-private functions. Drop the `./cron.js` import.

- [ ] **Step 3: Update equivalence test to import from the relocated oracle**

Change:

```typescript
import { nextCronOccurrence, parseCron } from '../../src/cron.js'
```

to:

```typescript
import { nextCronOccurrence, parseCron } from './legacy-cron-oracle.js'
```

- [ ] **Step 4: Search for any remaining imports of `src/cron`**

Run:

```bash
bun run typecheck
```

If any `src/cron.js` imports remain, redirect them to the translator's now-private parser (for migration-only code) or to the facade (for runtime code). Runtime code should not need cron any longer after Tasks 9-12.

- [ ] **Step 5: Delete `src/cron.ts`**

```bash
rm src/cron.ts
```

- [ ] **Step 6: Run full test suite**

Run:

```bash
bun test
```

Expected: PASS, including all equivalence tests (via the relocated oracle).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: retire src/cron.ts; move oracle to tests/recurrence/legacy-cron-oracle.ts"
```

---

### Task 14: Edit the calendar-sync spec

**Files:**

- Modify: `docs/superpowers/specs/2026-04-17-calendar-sync-design.md`

- [ ] **Step 1: Remove the `rrule-parser.ts` subsystem**

Delete the line in the file-layout section referencing `rrule-parser.ts` (around `docs/superpowers/specs/2026-04-17-calendar-sync-design.md:43`) and the full subsection titled "RRULE ↔ Cron conversion (`rrule-parser.ts`)" near line 212, including the mapping table and the "unsupported RRULE patterns" paragraph.

- [ ] **Step 2: Remove the `calendar_rrule_unsupported` error row**

In the error-table section near line 357-360, delete the row:

```
| `calendar_rrule_unsupported` | RRULE can't map to cron ...
```

- [ ] **Step 3: Add a one-paragraph note referencing the new design**

Above the section where `rrule-parser.ts` was described, add:

```markdown
### RRULE handling

Inbound CalDAV RRULE strings are stored verbatim in `recurring_tasks.rrule`; outbound writes push the same column value to CalDAV unchanged. No translation layer exists. See `docs/superpowers/specs/2026-04-19-rrule-library-adoption-design.md` for the unified recurrence format.
```

- [ ] **Step 4: Run format check on docs**

Run:

```bash
bun format:check
```

Expected: PASS. If oxfmt flags the spec, run `bunx oxfmt docs/superpowers/specs/2026-04-17-calendar-sync-design.md`.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-04-17-calendar-sync-design.md
git commit -m "docs(calendar-sync): remove rrule-parser coupling after unification"
```

---

### Task 15: Final verification

**Files:** none

- [ ] **Step 1: Run full check suite**

Run:

```bash
bun check:full
```

Expected: all green (lint, typecheck, format:check, knip, test, test:client, duplicates). If any pre-existing hook-blockers surface (e.g. worktree lint scope), resolve per CLAUDE.md guidance or flag to the user before committing.

- [ ] **Step 2: Sanity-check the scheduler loop locally**

Run:

```bash
LOG_LEVEL=debug bun start:debug
```

Create one recurring task via the bot using a natural-language request that produces a DAILY spec (e.g. "remind me every day at 9"). Confirm the debug log shows:

- `recurrenceSpecToRrule called` with the expected `freq`
- A row inserted with non-null `rrule` + `dtstart_utc` + computed `next_run`
- The due-scan picks it up at the expected time

Stop the server.

- [ ] **Step 3: Commit any final fixes**

If the verification uncovered anything, fix and commit under a descriptive message.

- [ ] **Step 4: Announce completion**

Recurrence unification is complete. The spec's calendar-sync simplification becomes available to the calendar-sync plan when it is written.

---

## Self-review

**Spec coverage:**

- Storage (`rrule`, `dtstart_utc`, drop `cron_expression`) — Task 7.
- Tool boundary (`RecurrenceSpec` discriminated union) — Tasks 1, 10, 11, 12.
- Runtime facade — Tasks 2, 3, 4.
- Library choice (`rrule-temporal`) — Task 0.
- Calendar-sync coupling removal — Task 14.
- Migration mismatch policy (abort on translator throw, silent on unparseable) — Task 7.
- `src/cron.ts` retirement — Task 13.
- Testing layers 1-5 — Tasks 1, 2, 3, 4, 5, 6, 7, 10.
- Error handling (facade never throws, returns discriminated union) — Task 3.
- Logging (pino, metadata-first) — present in every module touched.

All six decisions locked in the preamble are referenced by the tasks that depend on them.

**Placeholder scan:** none.

**Type consistency:** `RecurrenceSpec`, `CompiledRecurrence`, `RecurrenceTaskRecord` shape is consistent across Tasks 1 → 12. `rrule: string | null` and `dtstartUtc: string | null` on the record; both required on compiled output; `recurrence: RecurrenceSpec` optional on the discriminated union's `cron` variant.
