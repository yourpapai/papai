# rrule-strict-parse

## Why

rrule-temporal 2.2.1 (landed in the bun-dependencies group update, PR #398) added RFC 5545 strict-mode enforcement — most notably rejecting `COUNT` combined with `UNTIL`, which papai's schemas already declare mutually exclusive at the Zod boundary (`src/deferred-prompts/types.ts:113`, `src/types/recurrence.ts:40`) but which persisted rows created before those refines, or any future code path that bypasses schema validation, could still produce. Parsing those leniently today gives undefined upstream semantics; strict mode turns them into the documented degrade-to-null failure contract instead.

## What Changes

- `parseRrule` (`src/recurrence/recurrence.ts`) constructs `RRuleTemporal` with `strict: true`, making malformed or RFC-violating rrule strings fail parse instead of being silently accepted.
- Parse failures keep the existing degrade contract: `parseRrule` → `{ ok: false, reason }` + warn log; `nextOccurrence`/`occurrencesBetween` return `null`/`[]`; a recurring task whose rule no longer parses gets `nextRun = null` and stops firing — no throw, no crash.
- Add regression tests pinning COUNT+UNTIL rejection and DATE-valued `UNTIL` rejection against DATE-TIME `DTSTART`, plus confirmation that all currently-valid rule shapes papai emits still parse under strict mode.
- Run a read-only census over `recurring_tasks.rrule` to confirm no persisted row combines COUNT+UNTIL (no data migration in this change).

## Capabilities

### New Capabilities

- `recurrence-strict-parsing`: the recurrence engine (`src/recurrence/recurrence.ts`, re-exported by `src/recurrence.ts`) parses recurrence rules under RFC 5545 strict constraints; violations surface only through the established parse-failure degrade contract, never as thrown errors. No spec exists today — this capability is new, owned by the existing `recurrence/recurrence.ts` module (all consumers — `src/recurring.ts`, `src/deferred-prompts/poller-scheduled.ts`, recurring-task tools — go through `parseRrule`; the single `RRuleTemporal` construction site keeps the change one line plus tests). Without it, RFC-violating rules parse leniently with undefined occurrence semantics and only the Zod boundary stands between an LLM (or a legacy row) and a mis-scheduling rule.

### Modified Capabilities

(none — no existing spec covers recurrence)

## Impact

- Platform-agnostic: affects recurring tasks and scheduled deferred prompts on every chat platform instance. Recurrence rules are durable, group-shared assets stored on `recurring_tasks` (`rrule`, `dtstart_utc`, `timezone` columns); live conversation state is untouched.
- Code: `src/recurrence/recurrence.ts` (one construction site); tests under `tests/recurrence/`.
- Behavior risk is bounded and one-directional: a rule that strict mode rejects was already producing undefined occurrences; it now degrades to non-firing with a warn log naming the reason.
- Mutation gate applies (`src/` product code): re-measure `src/recurrence/recurrence.ts` via `bun test:mutate:changed`.
- Docs: no `docs/architecture/*.md` documents recurrence parsing; runtime behavior notes in `docs/architecture/behaviors.md` are unaffected.

## Non-goals

- No changes to `rruleInputSchema` / `recurrenceSpecSchema` — the Zod boundary already rejects COUNT+UNTIL for new LLM-driven input; strict mode is defense-in-depth behind it.
- No DB migration or normalization of legacy `recurring_tasks.rrule` rows — the census is read-only; if it ever finds violators, that is a separate change.
- No adoption of other rrule-temporal 2.2.x behavior changes (maxIterations tuning, option-object construction style).
- No cron-trigger (`triggerType: 'cron'`) behavior changes; cron-translated rules (migration 026) are unbounded FREQ/BY rules and strict-safe.
