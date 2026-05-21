<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# ADR-0098: Adopt RFC 5545 RRULE for Recurrence Storage and Runtime

## Status

Accepted

## Date

2026-04-19

## Context

papai's recurring task system (`src/cron.ts`) stores and evaluates schedules using 5-field cron expressions in `recurring_tasks.cron_expression`. A per-user timezone string is applied at evaluation time. The upcoming calendar-sync feature (ADR-TBD) needs to exchange RRULE strings with CalDAV servers. With cron as the canonical storage format, a lossy cron↔RRULE translation layer (`rrule-parser.ts`) would be required, explicitly rejecting common RRULE patterns (`BYSETPOS`, etc.) and surfacing a `calendar_rrule_unsupported` error to users.

Additionally, the internal cron engine (`src/cron.ts`) is standalone, un-versioned, and lacks first-class DST handling — it evaluates minute-by-minute in local time for up to 366 days. This is fragile for timezone-aware recurring tasks.

## Decision Drivers

- **Calendar interoperability**: CalDAV speaks RRULE natively. Storing cron and translating to RRULE loses information.
- **DST correctness**: Per-user timezone recurring tasks must handle spring-forward and fall-back correctly.
- **Library vs bespoke**: Maintaining a bespoke cron evaluator for a core feature is riskier than adopting a maintained library with defined semantics.
- **Single canonical format**: One format for internal runtime, tool boundary, and external calendar sync.

## Considered Options

### Option 1: Keep cron storage, add lossy RRULE translator

- **Pros**: Zero migration to existing rows; `src/cron.ts` remains.
- **Cons**: Requires `rrule-parser.ts` that rejects legitimate CalDAV RRULEs; ongoing maintenance of two formats plus a translator; DST edge cases in cron engine remain unaddressed.
- **Verdict**: Rejected. Creates a permanent capability gap with CalDAV.

### Option 2: Store RRULE, keep cron engine (dual evaluation)

- **Pros**: Storage format is CalDAV-compatible.
- **Cons**: Still maintaining the bespoke cron engine; need to parse RRULE back into something the cron engine understands, which is effectively a full RRULE evaluator anyway.
- **Verdict**: Rejected. Does not solve the evaluation risk.

### Option 3: Migrate to RRULE storage + adopt `rrule-temporal` (Chosen)

- **Pros**: Single canonical format; CalDAV pass-through is verbatim; evaluation handles DST via TC39 Temporal; active library maintenance.
- **Cons**: Schema migration required; `rrule-temporal` pulls in `temporal-polyfill`; library API still evolving.
- **Verdict**: Accepted.

## Library Selection

| Library           | Last Release     | Weekly DLs | Maintenance     | Notes                             |
| ----------------- | ---------------- | ---------- | --------------- | --------------------------------- |
| `rrule-temporal`  | v1.5.2, Apr 2026 | 84.1K      | Active          | TC39 Temporal, cross-TZ correct   |
| `rrule` (jkbrzt)  | v2.8.1, Jun 2024 | ~2M        | Dormant         | `.after()` null bugs; DST backlog |
| `@markwhen/rrule` | v2.8.2, Apr 2025 | Low        | Fork-maintained | Inherits upstream DST quirks      |
| `rschedule`       | 2020             | 204        | Dead            | —                                 |
| `rrule-rust`      | Active           | ~5K        | Active          | Native binding; no perf need here |

### Selection: `rrule-temporal`

Three reasons specific to papai:

1. **Timezone correctness**: Temporal's `ZonedDateTime` handles DST as a first-class concern. The cron engine and `jkbrzt/rrule` carry documented DST defect backlogs.
2. **Active maintenance**: Once the `rrule` column exists, library-swapping is risky because nullable-edge-case behaviour differs across implementations. Active release cadence matters for a storage-format dependency.
3. **CalDAV parity**: Output is standard RFC 5545 RRULE, so calendar-sync passthrough is unchanged vs. any other choice.

### Costs Accepted

- `temporal-polyfill` transitive dependency. Runtime cost acceptable on Bun server.
- Evolving library API. Mitigated by the `src/recurrence.ts` facade — consumers depend on our API, not the library's.

## Decision

We will:

1. Replace `recurring_tasks.cron_expression` with `rrule TEXT` + `dtstart_utc TEXT`.
2. Replace the cron evaluation engine at `src/cron.ts` with a facade at `src/recurrence.ts` backed by `rrule-temporal`.
3. Accept `RecurrenceSpec` (structured object) at the LLM tool boundary and serialize to RRULE internally; the LLM never emits raw RFC 5545 strings.
4. Pass RRULE strings verbatim to/from CalDAV without translation once calendar sync is built.

## Architecture

### Storage

`recurring_tasks` table:

- `rrule TEXT NULL` — pure RRULE property value, no `RRULE:` prefix, no embedded `DTSTART`. Example: `FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=9;BYMINUTE=0`.
- `dtstart_utc TEXT NULL` — ISO 8601 instant, RFC 5545 DTSTART anchor.
- `cron_expression` dropped.
- `timezone` (IANA) unchanged. `on_complete` rows keep `rrule = NULL`.
- `next_run` preserved with its index for polling.

`scheduled_prompts` table:

- Same `rrule` + `dtstart_utc` columns added, `cron_expression` dropped.

### Facade (`src/recurrence.ts`)

Single module; the only place `rrule-temporal` is imported. Exports:

- `recurrenceSpecToRrule(spec: RecurrenceSpec): CompiledRecurrence`
- `parseRrule(args: CompiledRecurrence): {ok: true, iter: RRuleTemporal} | {ok: false, reason: string}`
- `nextOccurrence(args: CompiledRecurrence, after: Date): Date | null`
- `occurrencesBetween(args: CompiledRecurrence, after: Date, before: Date, limit?: number): Date[]`
- `describeCompiledRecurrence(compiled: CompiledRecurrence): string`

### Tool Boundary

`create_recurring_task`, `update_recurring_task`, and `create_deferred_prompt` accept `rruleInputSchema` (a structured `RecurrenceSpec`-like object). The tool layer serializes via `recurrenceSpecToRrule` before persisting. This is the same schema already used by deferred prompts (ADR-0080).

### Calendar Sync Coupling

Inbound CalDAV RRULE strings stored verbatim in `recurring_tasks.rrule`. Outbound writes push the same column value to CalDAV unchanged. No translation layer.

## Migration

Migration `026_rrule_unification`:

1. `ALTER TABLE` add `rrule` + `dtstart_utc` to `recurring_tasks` and `scheduled_prompts`.
2. Backfill: for each non-null `cron_expression`, call `cronToRrule(expression, timezone, createdAt)`. On success set `rrule` + `dtstart_utc`; on null/unparseable leave both NULL.
3. Rebuild tables without `cron_expression` column (create-copy-drop-rename pattern for SQLite compatibility).
4. Recreate indexes.

`cronToRrule` lives in `src/recurrence-translator.ts` and is inlined into the migration only; it is not imported at runtime.

`src/cron.ts` retired from `src/` and relocated to `tests/recurrence/legacy-cron-oracle.ts` for continued semantic-equivalence testing.

## Error Handling

- **Facade never throws** — `nextOccurrence` returns `Date | null`; `parseRrule` returns a discriminated union.
- **Invalid stored RRULE** (reachable via CalDAV inbound): scheduler logs `warn` with `{recurringTaskId, reason}`, treats row as inert.
- **Migration translator throw**: aborts with structured error including the offending cron expression; fix translator and re-run.

## Consequences

### Positive

- Single canonical recurrence format across internal storage, LLM tools, and CalDAV.
- Correct DST handling via TC39 Temporal.
- Library maintenance outsourced from bespoke cron engine.
- LLM tool boundary remains structured and type-safe (Zod-validated `RecurrenceSpec`).

### Negative

- Schema migration requires one-time ALTER + backfill + table rebuild.
- `temporal-polyfill` transitive dependency.
- Library API evolution risk (mitigated by facade).

### Risks

- CalDAV RRULE quirks beyond RFC 5545: facade returns structured failure rather than throwing, containing blast radius.
- Direct `rrule-temporal` imports outside the facade: should be enforced by code review (oxlint rule possible but not implemented yet).

## Implementation Notes

- Two translators exist intentionally:
  - `recurrenceSpecToRrule` (facade, runtime): validated `RecurrenceSpec` → RRULE. Total function.
  - `cronToRrule` (`src/recurrence-translator.ts`): legacy cron string → RRULE. Migration-only.
- `dtstart` is injected synthetically at tool call time: either from `startDate`/`startTime` input, or from existing `dtstartUtc`, or from current UTC midnight.
- `describeCompiledRecurrence` parses RRULE string parts for human-readable summaries rather than requiring a full `RecurrenceSpec` reconstruction.

## Related Decisions

- **ADR-0080**: Unify Recurring Task and Deferred Prompt Recurrence Schemas — describes the tool-schema unification that preceded this broader storage and library migration.
- **ADR-0030**: Deferred Prompts System — original deferred prompt recurrence design.

## References

- `src/recurrence.ts` (facade exports) / `src/recurrence/recurrence.ts` (implementation)
- `src/recurrence-translator.ts` (migration-only cron→RRULE translator)
- `src/types/recurrence.ts` (Zod schemas)
- `src/db/migrations/026_rrule_unification.ts`
- `tests/recurrence/` (unit, equivalence, and schema tests)
- `docs/superpowers/specs/2026-04-19-rrule-library-adoption-design.md`
- `docs/superpowers/plans/2026-04-19-rrule-library-adoption-implementation.md`
