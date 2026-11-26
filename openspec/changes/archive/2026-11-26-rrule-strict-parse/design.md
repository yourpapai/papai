# rrule-strict-parse — design

## Context

`src/recurrence/recurrence.ts` holds the only `RRuleTemporal` construction site (`parseRrule`, line 66). Every consumer — `src/recurring.ts`, `src/deferred-prompts/poller-scheduled.ts`, the recurring-task tools, `occurrencesBetween` — reaches the library through it. `src/recurrence.ts` is a facade (re-exports + human-readable description) with no library calls. The parse-failure contract already exists and is tested: `parseRrule` catches, extracts the reason per repo convention, warns, and returns `{ ok: false }`; `nextOccurrence` degrades to `null` and callers set `nextRun = null`. Both LLM-facing schemas (`src/deferred-prompts/types.ts`) and the domain schema (`src/types/recurrence.ts`) already refine `until`/`count` as mutually exclusive, so new input cannot produce COUNT+UNTIL. See proposal.md for motivation and specs/recurrence-strict-parsing/spec.md for the behavior contract.

## Goals / Non-Goals

**Goals:**
- Make the recurrence engine reject RFC 5545 violations (COUNT+UNTIL, DATE `UNTIL` vs DATE-TIME `DTSTART`) at parse time via the library's `strict: true` mode.
- Keep the change one construction-site edit plus tests; zero new dependencies, zero DB writes.
- Prove with tests that every rule shape papai currently emits still parses under strict mode.

**Non-Goals:**
- Schema, tool-input, or API changes (see proposal Non-goals).
- Data migration or normalization of persisted `recurring_tasks.rrule` rows.
- Changes to cron triggers or to `describeCompiledRecurrence` (string-level, no library involvement).

## Decisions

**D1 — `strict: true` at `parseRrule`, nowhere else.**
The library option lands on the existing options object: `new RRuleTemporal({ rruleString: buildIcs(args), strict: true })`. Single choke point means every current and future consumer inherits strict parsing automatically. Alternatives: (a) rely on Zod schemas alone — rejected: they don't cover rows persisted before the refines or non-tool write paths, and the schemas are the "first line" while this is defense-in-depth; (b) pre-scan the rule string ourselves and reject COUNT+UNTIL before construction — rejected: duplicates library logic the update ships for free and would drift from upstream's rule set.

**D2 — read-only census instead of a migration.**
Verification includes one `sqlite3`/drizzle query counting `recurring_tasks` rows whose `rrule` matches both `(^|;)COUNT=` and `(^|;)UNTIL=`. If zero (expected: migration 026 translates legacy cron to unbounded FREQ/BY rules, and tool input has been schema-refined), strict mode is behavior-preserving for all persisted data. A normalization migration (strip COUNT when UNTIL present) is deliberately deferred: silently rewriting stored rules without evidence of violators violates "smallest thing that works", and any found violators deserve their own change with explicit semantics (which of COUNT/UNTIL wins).

**D3 — tests extend the existing recurrence suites, TDD order.**
The Write/Edit TDD hook gates `src/recurrence/recurrence.ts` and `tests/recurrence/*`. Work order: add failing strict-rejection tests to `tests/recurrence/recurrence.test.ts` first (COUNT+UNTIL → `{ ok: false }`; DATE `UNTIL` → `{ ok: false }`; no-throw on `nextOccurrence`/`occurrencesBetween`), then flip the flag, then confirm the existing shape-coverage suites (`equivalence.test.ts`, `spec-schema.test.ts`, `cron-to-rrule.test.ts`, `tests/types/recurrence.test.ts`) pass unchanged — those pin the "papai's emitted shapes stay valid" requirement. `recurrence.test.ts` already imports `parseRrule`/`nextOccurrence`/`occurrencesBetween`, so the new cases join its local pattern (no `mock.module`, plain function calls).

**D4 — no tool surface or scope-model impact.**
No new tool, no `tool_prefs`/capability gating changes, no new persisted state: the rule string, its storage columns, and the keys that scope them (group-shared `config context id` via `recurring_tasks` ownership) are untouched. Nothing to state beyond the null-impact declaration.

## Risks / Trade-offs

- [A persisted row violates a strict constraint unknown to us] → Census (D2) measures the known rejections before merge; the degrade contract caps the blast radius at "task stops firing + warn log", identical to today's handling of unparseable rules.
- [Upstream adds stricter checks in a future minor] → Same bounded failure mode; the warn reason names the violation, making any new rejection diagnosable from logs alone.
- [Strict rejection of a rule that previously "worked"] → Only COUNT+UNTIL rows could have produced defined-but-nonstandard occurrences; the census plus the mutually-exclusive refines make this practically unreachable, and a stopped rule is safer than undefined semantics.

## Migration Plan

Flag flip is atomic with the release. Rollback = revert the one-line change; no data was written. The census runs pre-merge against production-shaped data and its result is recorded in the PR.

## Open Questions

None — the census in D2 is a verification step, not an unknown; if it surprises us (nonzero violators), the change pauses before merge and a normalization change is proposed instead.
