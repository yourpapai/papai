<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `src/deferred-prompts/tool-handlers.ts`

Date: 2026-08-04
Status: approved

## Goal

Raise the mutation score of `src/deferred-prompts/tool-handlers.ts` — paired
score **0.58** (155 killed / 85 survived / 27 no-coverage, 267 mutants), the
largest open-mutant pool in `scripts/mutation/baseline.json` — to **≥ 0.95**
with pure unit tests. Approved exception to "no source changes":
`src/deferred-prompts/alerts.ts` gained an empty-set guard in
`updateAlertPrompt` (mirroring `updateScheduledPrompt`) because the
characterization tests exposed that an alert update with only an invalid
`execution` payload threw `No values to set` from drizzle.

## Background and findings

### Target selection (baseline triage, 2026-08-04)

Ranked every baseline entry by open mutants (survived + no-coverage) using the
cached per-file Stryker reports in `reports/paired/`:

| File | Baseline | Mutants | Open (S+NC) | Verdict |
| --- | --- | --- | --- | --- |
| **`src/deferred-prompts/tool-handlers.ts`** | 0.58 | 267 | **112 (85+27)** | **Selected.** Largest pool; existing test harness; survivors map to concrete untested behavior. |
| `src/tools/tools-builder.ts` | 0.745 | 302 | 77 (73+4) | Second pool; large assembly module, heavier setup. Deferred. |
| `src/message-queue/queue.ts` | 0.582 | 146 | 61 (61+0) | Queue infra, timing-sensitive oracles. Deferred. |
| `src/tools/memory.ts` | 0.47 | 117 | 62 (51+11) | Deferred. |
| kaneo zero-score wrappers (~15 files) | 0 | ~10–40 each | small | Thin delegation wrappers; low individual value. Deferred. |

### Why this file

- **Largest open pool:** 112 open mutants, ~40 more than the next candidate.
- **Harness already exists:** `tests/deferred-prompts/tool-handlers.test.ts`
  (304 lines) covers happy paths with `setupTestDb()`, `setConfig()`,
  `collectEvents()` — new tests reuse the same fixtures.
- **Real behavior gaps, not noise:** survivors cluster on untested error
  paths (invalid alert condition on create *and* update, alert cancellation,
  not-found branches, both/neither schedule+condition guards), unasserted
  error strings, event-emission gating, and log metadata.
- **Consumer impact:** these handlers back the `create_reminder`,
  `create_alert`, `update_reminder`, `cancel_reminder`, `get_reminder`,
  `list_reminders` LLM tools; surviving mutants would silently drop
  validation errors or emit lifecycle events for failed operations.

### Mutant inventory (cached paired report)

267 mutants: 155 killed, 85 survived, 27 no-coverage. Open mutants by line:

| Lines | Count | Cluster |
| --- | --- | --- |
| L40, 120, 145, 156, 179, 183, 188, 212, 238, 243, 258, 260, 265 | 30 | **Logging** — `logger.child` args, `log.info`/`log.debug` metadata objects + message strings |
| L77 | 3 | Invalid-`fire_at` NaN guard — **dead code** (see residuals) |
| L78 | 2 | Past-`fire_at` error string; `<=` vs `<` boundary (1 residual) |
| L92 | 1 | Timezone-error passthrough |
| L104 | 1 | rrule `startDate === undefined` → midnight vs explicit local dtstart |
| L113 | 3 | rrule with no future occurrence → error |
| L116 | 1 | Neither `fire_at` nor `rrule` error string |
| L123 | 4 | `utcToLocal` null/undefined fallback — **unreachable** (see residuals) |
| L142 | 3 | Invalid alert condition on create |
| L157–160 | 4 | Both / neither schedule+condition guards, error strings |
| L170, 174 | 11 | `deferred:created` emission gating (scheduled + alert paths) |
| L193 | 1 | `executeGet` not-found string |
| L198–208 | 4 | `updateScheduledFields`: condition-rejection, prompt-only, execution parse |
| L211, 237 | 6 | Update-store returns null — needs store mock (see below) |
| L218–234 | 18 | `updateAlertFields`: schedule-rejection, prompt, condition valid+invalid, cooldown, execution |
| L247–253 | 13 | `executeUpdate` alert path: not-found, event gating |
| L264–269 (excl. L265) | 7 | `executeCancel` alert path + not-found |

## Design

Two test files, no source changes.

### 1. Behavioral tests — extend `tests/deferred-prompts/tool-handlers.test.ts`

Public-API tests through `executeCreate` / `executeGet` / `executeUpdate` /
`executeCancel` / `executeList`, reusing the existing harness
(`setupTestDb()`, `setConfig()`, `collectEvents()`):

- **create guards:** schedule+condition together → `'Provide either a schedule
  or a condition, not both.'`; neither → `'Provide either a schedule (for
  time-based) or a condition (for event-based).'`; neither emits
  `deferred:created`.
- **fire_at validation:** past date → `'fire_at must be a future date and
  time.'`; valid future date still creates (pins the comparison direction).
- **timezone passthrough:** `setConfig(USER_ID, 'timezone', 'Not/AZone')` →
  returns the invalid-timezone error object verbatim (kills L92).
- **rrule dtstart:** explicit `startDate` + `startTime` produce a
  `dtstartUtc` matching that local wall-clock, not midnight (kills L104);
  `freq: 'DAILY', count: 1` with midnight-today dtstart → `'Could not compute
  next occurrence for the given rrule spec.'` (kills L113).
- **alert create:** invalid condition → `'Invalid condition: …'`; success
  emits `deferred:created` with the alert id; invalid input emits nothing.
- **get:** unknown id → `'Reminder or alert not found.'`.
- **update scheduled:** `condition` field → `'Cannot apply a condition to a
  scheduled prompt. Use schedule fields instead.'`; prompt-only update is
  persisted; valid `execution` replaces stored metadata, invalid `execution`
  is ignored (old metadata kept).
- **update alert:** `schedule` field → `'Cannot apply a schedule to an alert
  prompt. Use condition fields instead.'`; prompt / valid condition /
  `cooldown_minutes` / valid execution all persisted; invalid condition →
  `'Invalid condition: …'`; unknown id → not-found error; success emits
  `deferred:updated`, error result emits nothing.
- **cancel:** cancel an alert → `{ status: 'cancelled', id }` +
  `deferred:cancelled` event (currently zero alert-cancel coverage, L264–267);
  unknown id → `'Reminder or alert not found.'`.

### 2. Logging + store-null tests — new file `tests/deferred-prompts/tool-handlers-logging.test.ts`

Follows the documented module-eval-timing pattern from
`tests/coding-credentials/redaction-log.test.ts`: install
`createTrackedLoggerMock()` via `mock.module('../../src/logger.js', …)`, then
import the module under test through a cache-busting query
(`await import('.../tool-handlers.js?test=<uuid>')`) so its module-level
`const log = logger.child({ scope: 'deferred:tools' })` binds the tracked
mock.

- Assert `logger.child` called with `{ scope: 'deferred:tools' }` (L40).
- Assert `info` calls for create (scheduled + alert), update (both types),
  and cancel (both types) carry their exact metadata objects and message
  strings; assert `debug` entry-log payloads (kills the 30 log mutants).
- Separately, `mock.module` the `scheduled.js` / `alerts.js` store boundary
  with a controllable `updateScheduledPrompt` / `updateAlertPrompt` returning
  `null` while `get*Prompt` succeeds → covers the update-returns-null
  branches (L211, L237, 6 mutants). Mock boundary stays narrow per
  `tests/AGENTS.md`; delayed import keeps it local to this suite.
- Add the new file to `scripts/mutation/overrides.json` for
  `src/deferred-prompts/tool-handlers.ts` alongside the existing behavioral
  file so the paired runner always pairs both.

### 3. Documented residual mutants (12)

| Location | Mutants | Reason |
| --- | --- | --- |
| L77 (`validateFutureFireAt` NaN guard) | 3 | Dead code: `localDatetimeToUtc` either returns a valid ISO string or throws — `new Date(utcStr)` can never be NaN. |
| L123 (`utcToLocal` null fallback) | 4 | `result.fireAt` is always a valid string in the create flow, so `localizedFireAt` is never null/undefined. |
| L78 (`<=` vs `<`) | 1 | Requires `fireDate.getTime() === Date.now()` exactly; impractical without freezing the clock, and the repo bans wall-clock timing assertions. |

Additional equivalent mutants:

| Location | Mutants | Reason |
| --- | --- | --- |
| L170, L174 (`result !== undefined` in the create emit gates) | 2 | Equivalent: `createScheduled`/`createAlert` are typed `CreateResult` and never return `undefined`; the guard is dead defensive code. |
| L206, L232 (`input.execution !== undefined` → true) | 2 | Equivalent: with the guard forced true, `executionMetadataSchema.safeParse(undefined)` fails and the block is a no-op; store payload identical either way. |

Ceiling: (267 − 12) / 267 = **0.9551** — achieved exactly.

## Verification

1. `bun test tests/deferred-prompts/tool-handlers.test.ts
   tests/deferred-prompts/tool-handlers-logging.test.ts` — green.
2. `bun test:mutate:file src/deferred-prompts/tool-handlers.ts` — score
   ≥ 0.95; surviving set contains only the documented residuals (plus any
   explicitly waived in the implementation plan).
3. Update `scripts/mutation/baseline.json` for
   `src/deferred-prompts/tool-handlers.ts` to the measured score (monotonic
   ratchet).
