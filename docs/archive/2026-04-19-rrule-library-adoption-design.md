# RRULE Library Adoption — Unify Recurrence on RFC 5545

- Date: 2026-04-19
- Status: Draft — pending review
- Scope: replace cron-based recurrence storage with RFC 5545 RRULE, adopt a recurrence library, simplify calendar-sync interop

## Background

Today papai stores recurring-task schedules as 5-field cron expressions in `recurring_tasks.cron_expression` and evaluates them via an internal engine at `src/cron.ts`. The planned calendar-sync feature (`docs/superpowers/specs/2026-04-17-calendar-sync-design.md`) introduces a lossy RRULE↔cron translator (`rrule-parser.ts`) because CalDAV speaks RRULE and papai speaks cron. That translator explicitly rejects common RRULE patterns (`BYSETPOS`, etc.) and surfaces a `calendar_rrule_unsupported` error to the user.

This spec proposes unifying on RRULE for both read and write paths, eliminating the translator layer and the capability gap it creates.

## Goals

- Single canonical recurrence format (RRULE) used by internal scheduling and CalDAV interop.
- LLM-facing tool API stays structured and Zod-validated — the model never emits raw RFC 5545 strings.
- Per-user timezone handling is correct across DST transitions.
- No dependency on an unmaintained library for a storage-format concern.

## Non-goals

- RDATE/EXDATE set support at the tool boundary (CalDAV-inbound only).
- VEVENT parsing (handled by the calendar-sync spec, out of scope here).
- Natural-language recurrence input.
- Human-readable recurrence text generation beyond a simple `describeRecurrence` summary used in bot replies.

## Target architecture

### Storage

`recurring_tasks` table gains:

- `rrule TEXT NULL` — pure RRULE property value, no `RRULE:` prefix, no embedded `DTSTART`/`TZID`. Example: `FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0`.
- `dtstart_utc TEXT NULL` — ISO 8601 instant, RFC 5545 anchor.

`cron_expression` is dropped in the same migration.

`timezone` (IANA) and `trigger_type` are unchanged. `on_complete` rows keep `rrule = NULL`.

### Tool boundary

`create_recurring_task` and `update_recurring_task` accept a Zod-validated `RecurrenceSpec`. `create_deferred_prompt` accepts `RecurrenceSpec | null` — `null` preserves the current one-shot `fireAt` behaviour.

The shared `RecurrenceSpec` type:

```ts
type RecurrenceSpec = {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'
  interval?: number
  byDay?: Array<'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'>
  byMonthDay?: number[]
  byMonth?: number[]
  byHour?: number[]
  byMinute?: number[]
  until?: string // ISO 8601
  count?: number
  dtstart: string // ISO 8601
  timezone: string // IANA
}
```

papai serialises `RecurrenceSpec` to an RRULE string for storage via `recurrenceSpecToRrule` in the facade. The LLM never sees RFC 5545 syntax.

Note — two distinct translators exist:

- `recurrenceSpecToRrule` (facade, runtime): structured spec from the tool boundary → RRULE string. Total function over the validated `RecurrenceSpec` surface.
- `cronToRrule` (`src/recurrence-translator.ts`, migration-only): legacy cron string → RRULE string. Used exclusively by the backfill pass. Deleted once `src/cron.ts` retires.

### Runtime facade (`src/recurrence.ts`)

Single module; the only place `rrule-temporal` is imported.

```ts
export const recurrenceSpecToRrule = (spec: RecurrenceSpec):
  { rrule: string; dtstartUtc: string; timezone: string }

export const parseRrule = (args: { rrule: string; dtstartUtc: string; timezone: string }):
  { ok: true; iter: RRuleTemporal } | { ok: false; reason: string }

export const nextOccurrence = (args, after?: Date): Date | null

export const occurrencesBetween = (args, after: Date, before: Date, limit?: number): Date[]

export const describeRecurrence = (spec: RecurrenceSpec): string
```

### Calendar-sync coupling

`rrule-parser.ts` in the calendar-sync design is **removed**. Inbound CalDAV RRULE strings are stored verbatim into `recurring_tasks.rrule`; outbound writes push `recurring_tasks.rrule` verbatim to CalDAV. The `calendar_rrule_unsupported` error class in the calendar-sync error table is removed along with the lossy mapping table.

### Out of scope

Provider adapters, chat-provider code, file relay, memo, LLM orchestrator, web fetch. Containment is deliberate.

## Library selection

### Candidates considered

| Library                    | Last release     | Weekly DLs | Maintenance     | Notes                                                    |
| -------------------------- | ---------------- | ---------- | --------------- | -------------------------------------------------------- |
| `rrule-temporal` (ggaabe)  | v1.5.2, Apr 2026 | 84.1K      | active          | TC39 Temporal, cross-TZ correct                          |
| `@markwhen/rrule` (fork)   | v2.8.2, Apr 2025 | low        | fork-maintained | Inherits upstream DST quirks                             |
| `rrule` (jkbrzt, upstream) | v2.8.1, Jun 2024 | ~2M        | dormant         | Maintainership open since Jan 2024; `.after()` null bugs |
| `rschedule`                | 2020             | 204        | dead            | Dropped                                                  |
| `rrule-rust`               | active           | ~5K        | active          | Native binding; no perf need for papai                   |

### Decision: `rrule-temporal`

Three reasons specific to papai:

1. **Timezone correctness.** papai's recurring tasks are explicitly per-user-timezone. Temporal's `ZonedDateTime` handles DST as a first-class concern. Date-based libraries carry a documented backlog of DST defects (see `jkbrzt/rrule#640`).
2. **Storage-format dependency risk.** Once the `rrule` column exists, swapping libraries is risky — the RRULE string is portable but nullable-edge-case behaviour isn't. Active release cadence matters here.
3. **CalDAV parity.** Output is still RFC 5545 RRULE, so calendar-sync pass-through is unchanged vs. any other choice.

### Costs accepted

- Transitive `temporal-polyfill` dependency. Runtime on Bun is fine; if papai adds a browser bundle path, track `oven-sh/bun#22598` (tree-shaking gotcha for `temporal-polyfill/global`).
- Library API surface is still evolving. Mitigated by the `src/recurrence.ts` facade — consumers depend on our API, not the library's.

## Migration

### Schema migration

Single migration:

1. `ALTER TABLE recurring_tasks ADD COLUMN rrule TEXT`.
2. `ALTER TABLE recurring_tasks ADD COLUMN dtstart_utc TEXT`.
3. Backfill pass: for each row with non-null `cron_expression`, call `cronToRrule(cronExpression, timezone)`. Set `rrule` + `dtstart_utc` on success; leave both NULL on unparseable legacy cron.
4. `ALTER TABLE recurring_tasks DROP COLUMN cron_expression`.

### Mismatch policy

No runtime mismatch handling. Translator correctness is a test-suite responsibility:

- Rows where `parseCron(cron_expression)` returns null (already-broken data) get `rrule = NULL` silently; they weren't firing anyway.
- Rows where cron parses but the translator throws indicate a translator bug that tests should have caught. Migration aborts with a structured error including the failing cron AST. Fix the translator and re-run.

### `src/cron.ts` retirement

`src/cron.ts` is deleted from `src/` once consumers migrate to `src/recurrence.ts`. Its test oracle responsibility (see Testing) moves to `tests/recurrence/legacy-cron-oracle.ts` until semantic-equivalence tests are removed.

## Testing strategy

### Layer 1 — Translator unit tests (`tests/recurrence/cron-to-rrule.test.ts`)

Table-driven coverage of every pattern `src/cron.ts` currently accepts:

| Pattern class | Example cron       | Expected RRULE                                                                 |
| ------------- | ------------------ | ------------------------------------------------------------------------------ |
| Fixed time    | `0 9 * * *`        | `FREQ=DAILY;BYHOUR=9;BYMINUTE=0`                                               |
| Weekday list  | `30 14 * * 1,3,5`  | `FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=14;BYMINUTE=30`                             |
| Day-of-month  | `0 8 15 * *`       | `FREQ=MONTHLY;BYMONTHDAY=15;BYHOUR=8;BYMINUTE=0`                               |
| Step minute   | `*/15 * * * *`     | `FREQ=HOURLY;BYMINUTE=0,15,30,45`                                              |
| Step hour     | `0 */3 * * *`      | `FREQ=DAILY;BYHOUR=0,3,6,9,12,15,18,21;BYMINUTE=0`                             |
| Month list    | `0 9 1 1,4,7,10 *` | `FREQ=YEARLY;BYMONTH=1,4,7,10;BYMONTHDAY=1;BYHOUR=9;BYMINUTE=0`                |
| Range         | `0 9-17 * * 1-5`   | `FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9,10,11,12,13,14,15,16,17;BYMINUTE=0` |
| Invalid input | garbage            | translator returns `null`                                                      |

### Layer 2 — Semantic-equivalence tests (oracle)

For each pattern class, generate the next 10 occurrences via the legacy cron oracle and via `nextOccurrence` through `src/recurrence.ts`. Assert equality to the second, in a non-UTC timezone (`America/Los_Angeles`) crossing a DST boundary. This is the test that actually proves "no behavioural drift"; the translator's RRULE output is a byproduct.

### Layer 3 — Facade unit tests (`tests/recurrence/recurrence.test.ts`)

- `nextOccurrence` and `occurrencesBetween` across DST spring-forward (`America/New_York`, March) and fall-back (November).
- Leap-Feb-29 yearly rule.
- `BYSETPOS` inbound (CalDAV-only — we don't generate it, but we store and iterate it).
- `describeRecurrence` human summaries.
- `parseRrule` returns structured failure on invalid inputs; never throws.

### Layer 4 — Tool schema tests (`tests/tools/`)

- Zod `RecurrenceSpec` validation: reject conflicting `until` + `count`; reject invalid `byDay`; accept the full supported surface.
- Golden-path end-to-end per recurring-task tool: create → `nextRun` persisted → due-scan picks it up.

### Layer 5 — Migration test (`tests/db/migrations/`)

In-memory SQLite populated with representative legacy rows (one per translator-table pattern plus NULL cron and garbage cron). Run the migration, assert post-state:

- Rows with translatable cron have non-null `rrule` + `dtstart_utc`.
- Rows with NULL/garbage cron have NULL `rrule` + `dtstart_utc`, no error raised.
- `cron_expression` column is gone.

## Error handling

- **Facade never throws to callers.** `nextOccurrence` returns `Date | null`. `parseRrule` returns a discriminated union (`{ok, iter}` / `{ok: false, reason}`). Callers' existing null checks (see `src/recurring.ts:56`) survive unchanged.
- **Invalid stored RRULE** (only reachable via CalDAV inbound, since our writes are Zod-validated): scheduler logs `warn` with `{recurringTaskId, reason}`, treats row as paused, surfaces via existing admin listing. Same pattern as today's cron-parse-null path.
- **Tool-boundary validation failure**: Zod error → structured failure result to the LLM via the standard `src/tools/` wrapping.
- **Library breaking change across versions**: isolated to `src/recurrence.ts`; facade tests catch any diff.

## Logging (pino, per `CLAUDE.md`)

- `debug` — facade entry with `{rrule, dtstartUtc, timezone}`. No user PII.
- `info` — migration success with `{migratedCount, skippedNullCount}`.
- `warn` — inbound RRULE fails to parse, with `{recurringTaskId, reason}`.
- `error` — translator throws during migration, with the offending cron AST. Re-raises.

## Affected files

- `src/db/schema.ts` — schema change.
- `src/db/migrations/NNNN_rrule_unification.sql` (new) — migration + backfill.
- `src/recurrence.ts` (new) — facade module, ~150 lines.
- `src/recurrence-translator.ts` (new, test-referenced) — cron AST → RRULE translator.
- `src/types/recurring.ts` — `RecurringTaskRecord` gains `rrule`, `dtstartUtc`; `cronExpression` removed.
- `src/recurring.ts` — `computeNextRun`, `computeMissedDates`, `skipNextOccurrence` switch from `./cron.js` to `./recurrence.js`.
- `src/tools/recurring-tasks.ts` (and similar) — tool schemas swap `cronExpression` for `RecurrenceSpec`.
- `src/deferred-prompts/types.ts` and tool handlers — `cronExpression` field becomes `RecurrenceSpec | null`; null-case (one-shot `fireAt`) behaviour preserved.
- `src/cron.ts` — deleted after migration lands.
- `docs/superpowers/specs/2026-04-17-calendar-sync-design.md` — `rrule-parser.ts` section and `calendar_rrule_unsupported` error class removed.
- `tests/recurrence/*` (new) — per Testing section.

## Open risks

- **Temporal polyfill footprint.** `rrule-temporal` pulls in `temporal-polyfill`. Runtime cost acceptable on Bun server. Revisit if papai ever ships a browser bundle.
- **Single-module facade drift.** If future consumers import `rrule-temporal` directly, the insulation breaks. Mitigation: oxlint policy rule `no-direct-rrule-temporal-import` scoped to everything outside `src/recurrence.ts` (can be added later if needed).
- **CalDAV RRULEs in the wild.** Real-world feeds contain quirks beyond RFC 5545. The facade's "never throws, returns structured failure" design contains blast radius; edge cases accumulate as warn-logged skipped rows rather than outages.
