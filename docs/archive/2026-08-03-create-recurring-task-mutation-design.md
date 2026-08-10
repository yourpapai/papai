<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `src/tools/create-recurring-task.ts`

Date: 2026-08-03
Status: approved

## Goal

Raise the mutation score of `src/tools/create-recurring-task.ts` — baseline
`0.165` in `scripts/mutation/baseline.json`, the weakest user-facing tool file
in `src/` — to ~0.80 by killing the surviving behavioral mutants with focused
tests. No source changes.

## Background and findings

### Why this file

Selected from `scripts/mutation/baseline.json` as the most valuable target:

- Baseline `0.165` — among `src/` files only `compaction/constants.ts` (0,
  constants-only), `update-sprint.ts` (0.12, 48-line narrow agile tool) and
  `provider-independent-tools-builder.ts` (0.131, assembly wiring) score lower;
  all three have far fewer mutants or far less behavioral depth.
- User-facing LLM tool on the core recurring-task path: it validates the
  schedule/trigger combination, compiles the recurrence in the user's
  timezone, and shapes the result the LLM reads back. Surviving mutants here
  are real behavioral risks (validation bypass, wrong DTSTART anchor, wrong
  schedule description), not wording.
- Already DI-friendly (`CreateRecurringTaskDeps`), so the repo's preferred
  DI-first test pattern applies with no refactor.

Alternatives considered: `update-sprint.ts` (lower score but ~25 mutants,
narrow feature), `src/recurring.ts` (295-line core store at 0.458 but already
has 785 lines of tests; less headroom), `provider-independent-tools-builder.ts`
(composition wiring, low value per mutant). Zero-score plugin files are thin
CRUD wrappers.

### Mutant inventory (`bun test:mutate:file src/tools/create-recurring-task.ts`, 2026-08-03)

104 mutants: **50 killed, 54 survived, 0 no-coverage** — current paired score
0.481 (the 0.165 baseline entry was seeded with a weaker test set; the
existing 113-line companion covers only DTSTART anchoring).

Survivors, mapped to source lines:

- **L49 / L56 — superRefine validation rules: 6 ConditionalExpression + 2
  LogicalOperator + 2 ObjectLiteral + 2 ArrayDeclaration + 6 StringLiteral.**
  `triggerType === 'cron' && schedule === undefined` and
  `triggerType === 'on_complete' && schedule !== undefined`, plus the issue
  objects (`message`, `path: ['schedule']`). No test exercises rejection.
- **L73 — compile branch: 2 ConditionalExpression + 1 LogicalOperator.**
  `input.triggerType === 'cron' && input.schedule !== undefined` gates rrule
  compilation in `executeCreate`. No `on_complete` execution test exists.
- **L113 — schedule-description fallback: 4 ConditionalExpression + 2
  LogicalOperator.** `record.triggerType === 'cron' && record.rrule !== null
  && record.dtstartUtc !== null` selects `describeCompiledRecurrence(...)` vs
  the `'after completion of current instance'` fallback. Result mapping is
  untested.
- **L36 / L41 — enum declarations: 2 ArrayDeclaration + 7 StringLiteral.**
  `priority` enum (5 values) and `triggerType` enum (2 values); membership is
  never validated.
- **Accepted survivors (18), out of scope per approved design:** `.describe()`
  prose plus the logger scope string (11 StringLiteral across L29–L46), and
  log message/metadata strings and objects (4 StringLiteral + 3 ObjectLiteral
  at L68, L99, L144, L29).

## Design

Extend `tests/tools/create-recurring-task.test.ts` (keep the existing 3
DTSTART tests unchanged) with four describe blocks, following the file's
existing DI-first pattern (`CreateRecurringTaskDeps`,
`setCachedConfig('user-1', 'timezone', ...)`, `mockLogger()`), plus
`schemaValidates()` / `getToolExecutor()` from `tests/utils/test-helpers.ts`
where they fit.

### 1. Schema validation (kills the L49/L56 + enum clusters)

Using the tool's `inputSchema` — `schemaValidates(tool, data)` for plain
accept/reject booleans, and direct `inputSchema.safeParse(data)` where issue
`message`/`path` are asserted (the helper returns only a boolean):

- `cron` without `schedule` → rejected; issue message
  `"schedule is required when triggerType is 'cron'"`, path `['schedule']`.
- `cron` with `schedule` → accepted (kills boundary-flip mutants).
- `on_complete` with `schedule` → rejected; issue message
  `"schedule must not be provided when triggerType is 'on_complete'"`, path
  `['schedule']`.
- `on_complete` without `schedule` → accepted.
- Each of the five `priority` enum values accepted; an invalid priority
  rejected (kills the L36 array mutant and the five enum string mutants).
- An invalid `triggerType` rejected (kills the L41 array mutant and its enum
  string mutants).

The message/path assertions also kill the L50/L57 issue ObjectLiteral mutants
and the L53/L60 path array/string mutants.

### 2. Compile branch (kills L73)

- `on_complete` execution → injected `createRecurringTask` receives
  `rrule: undefined` and `dtstartUtc: undefined` (no compilation attempted;
  under the `true`/`||` mutants the branch destructures `undefined` and
  throws, so the assertion fails).
- `cron` execution → compiled `rrule`/`dtstartUtc` are passed through (the
  existing DTSTART tests already cover the cron side; this adds the explicit
  rrule-presence assertion).

### 3. Result mapping (kills L113)

Drive `execute` with injected records and assert the returned object:

- cron record with `rrule` + `dtstartUtc` set → `schedule` equals
  `describeCompiledRecurrence(...)` output, not the fallback string.
- cron record with `rrule: null` → `schedule` is
  `'after completion of current instance'`.
- `on_complete` record → `schedule` is the fallback string.
- `nextRun: '2026-06-01T12:00:00.000Z'` with `timezone: 'Europe/Berlin'` →
  `'2026-06-01T14:00:00'` (naive local, CEST); `nextRun: null` passes through
  as `null`.
- `id`, `title`, `projectId`, `triggerType`, `enabled` are mapped through.

### 4. Failure path (behavioral lock)

- Injected `createRecurringTask` throws → `execute` rethrows. Locks the
  catch/rethrow contract (no listed survivor maps here; the test prevents
  regressions in the error path at trivial cost).

### Expected outcome

~36 of the 54 survivors killed (all 17 ConditionalExpression/LogicalOperator,
4 ArrayDeclaration, 2 ObjectLiteral, ~13 StringLiteral) → score ≈
(50 + 36) / 104 ≈ **0.83**; accept anything ≥ 0.78. Remaining survivors are
the accepted describe/log/analytics strings.

## Measurement and ratchet

1. `bun test tests/tools/create-recurring-task.test.ts` — new tests pass.
2. `bun test:mutate:file src/tools/create-recurring-task.ts` — confirm the
   survivor count drops as predicted; investigate and kill or justify any
   unexpected survivor in the behavioral clusters.
3. No `baseline.json` edit in the PR: the CI `mutation-baseline` job re-seeds
   the floor on master (per-key max) from the changed-files run. The PR gate
   is regression-only, so the improved score can only raise the floor.
4. Regression checks: repo lint/typecheck per `package.json` scripts; the
   mutation run's own dry run validates the rest of the paired test set.

## Trade-offs and risks

- **Validation-message coupling.** Asserting exact superRefine messages ties
  tests to wording. Accepted: these messages are the LLM-facing contract the
  model reads when recovery is needed, and the mutation gate counts the
  string mutants.
- **Timezone-sensitive assertion.** The `Europe/Berlin` expectation relies on
  ICU data in the Bun runtime; June is always CEST (UTC+2), no DST edge.
- **Probe vs future paired divergence.** The recorded floor comes from the
  official paired runner on master; the local paired number in this spec is
  the prediction, not the guarantee.

## Alternatives considered

- **Maximal kill (assert `.describe()`/log prose too).** Rejected per design
  approval: pushes toward ~0.95 but couples tests to wording tweaks with low
  real value.
- **Refactor-then-test.** Rejected: the file is already DI-friendly; no
  structural change is needed to reach the target score.
