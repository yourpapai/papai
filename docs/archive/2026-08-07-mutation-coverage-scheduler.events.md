<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage Plan — `src/utils/scheduler.events.ts`

**Date:** 2026-08-07
**Spec:** `docs/superpowers/specs/2026-08-07-mutation-coverage-scheduler.events-design.md`
**Target:** raise mutation score from `0.45` (18/40) to `>= 0.9`; achieved `0.90` (36/40).

## Goal

Add one test-only companion file `tests/utils/scheduler.events.test.ts` that kills 18
of the 22 currently non-killed mutants (2 survived + 20 `NoCoverage`), leaving only the
4 `'Unknown error'` fallback strings (ids 6, 14, 22, 30) as declared residuals. No edits
to `src/`, `client/`, `plugins/`, `scripts/`, or `baseline.json`.

## Global constraints

- Test-only: create `tests/utils/scheduler.events.test.ts` only (plus this plan/spec/result.json).
- Follow the **cache-busting logger-mock pattern** from `tests/history.test.ts` /
  `tests/tools/search-memos.test.ts`: per-test, install a recording `logger` via
  `mock.module('../../src/logger.js', …)` then
  `import(\`../../src/utils/scheduler.events.js?t=${crypto.randomUUID()}\`)`. The query
  forces a fresh module evaluation (the module is already cached from the
  `tests/mock-reset.ts` preload via `src/scheduler.js`), so the module-scoped
  `log = logger.child(…)` binds to the recorder.
- The recorder uses **plain functions** (not `mock()`) returning a child logger whose
  `error(payload, message)` records to per-test arrays. A fresh recorder is created per
  load, so no cross-test state leaks.
- Throw an **`Error`** (not a non-Error) in each throwing handler: `no-throw-literal` +
  `only-throw-error` (both `error`) reject throwing any non-Error value. This makes the
  `'Unknown error'` `else` branch unreachable from tests → mutants 6/14/22/30 are
  residuals (see T9).
- Narrow captured payloads via a pure `isRecord` type predicate + `requireRecord`
  helper (no `as` — `no-unsafe-type-assertion` is `error`); read index-signature
  properties with bracket notation (`payload['error']`) per `TS4111`. No conditionals
  inside test bodies (`no-conditional-in-test`) — the narrowing `if` lives in
  `requireRecord` at module scope.
- Every assertion is `toBe(...)` against the full exact value. No `startsWith` /
  `endsWith` / `toContain` / `toEqual` partial matching.
- One `test()` per mutant class (5 tests total), matching the spec's Design table 1:1.
- SPDX header on the new file; no comments in the test body.

## Tasks

- [x] **T0 — scaffold.** `tests/utils/scheduler.events.test.ts`: SPDX header,
      `bun:test` imports, type-only imports of `EventEmitter` + the four handler/payload
      types, the `isRecord`/`requireRecord` narrowing helpers, and the
      `loadSchedulerEventsModule()` loader (recorder + cache-busting import).
- [x] **T1 — class A (scope).** `logger.child` invoked once at import with exact scope.
      Assert `childCalls.length === 1` and `scope['scope'] === 'scheduler:events'` (`toBe`).
      Covers mutant ids **0, 1**.
- [x] **T2 — class B (emitTickEvent catch, 4 of 5).** One throwing `Error` `tick` handler;
      assert `errorCalls.length === 1`, `payload['error'] === 'handler blew up'`,
      `payload['event'] === 'tick'`, `message === 'Event handler threw error'` (all `toBe`).
      Covers ids **5, 7, 8, 9** (id 6 is a residual).
- [x] **T3 — class C (emitErrorEvent catch, 4 of 5).** Same shape, `events.error`,
      `payload['event'] === 'error'`. Covers ids **13, 15, 16, 17** (id 14 residual).
- [x] **T4 — class D (emitRetryEvent catch, 4 of 5).** Same shape, `events.retry`,
      `payload['event'] === 'retry'`. Covers ids **21, 23, 24, 25** (id 22 residual).
- [x] **T5 — class E (emitFatalErrorEvent catch, 4 of 5).** Same shape, `events.fatalError`,
      `payload['event'] === 'fatalError'`. Covers ids **29, 31, 32, 33** (id 30 residual).
- [x] **T6 — verify isolation.** `bun test tests/utils/scheduler.events.test.ts` green (5/5).
- [x] **T7 — verify no sibling regression.** helpers + internal + scheduler suites green (53/53).
- [x] **T8 — re-measure.** `bun test:mutate:file src/utils/scheduler.events.ts`:
      `killed=36 survived=0 noCoverage=4 score=0.9`; non-killed ids exactly `{6, 14, 22, 30}`.
- [x] **T9 — residuals.** Declare the 4 `'Unknown error'` fallback strings (ids 6, 14, 22,
      30; locs `:24`, `:38`, `:52`, `:66`) as residuals in `result.json`. They are the
      `else` branch of `error instanceof Error ? error.message : 'Unknown error'`, only
      reachable via a non-Error throw — which `no-throw-literal`/`only-throw-error` forbid
      in test code. Their `mutantIds` union exactly equals the runner-measured surviving set.

## Risk / notes

- The cache-busting query import is load-bearing: a plain `await import` returns the
  cached module (pre-evaluated by the `tests/mock-reset.ts` preload via `src/scheduler.js`)
  with `log` bound to the real pino logger, so none of the recording assertions would fire.
  Confirmed empirically — without the `?t=<uuid>` suffix, all 5 tests failed with empty
  recorder arrays; with it, all pass.
- Per-class coverage is 4 of 5, not 5 of 5, by design: the `'Unknown error'` string is the
  file's tests-only ceiling. Score `0.90 = 36/40` clears the `>= 0.9` target; under the
  default `threshold: 0.95` the iteration instead merges as `capped`, which requires the
  declared residuals to set-equal the surviving ids (gate.ts `coversAllSurvivors`) — they do.
