<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/utils/scheduler.events.ts`

**Date:** 2026-08-07
**Status:** Accepted
**Target file:** `src/utils/scheduler.events.ts`
**Measured score (before):** 0.45 (18/40 mutants killed) — target `>= 0.9`
**Measured score (after):** 0.90 (36/40 killed; 4 `NoCoverage` residuals)

## Summary

`src/utils/scheduler.events.ts` exports `createEmitters`, which wraps four private
`emit*Event` helpers (`emitTickEvent`, `emitErrorEvent`, `emitRetryEvent`,
`emitFatalErrorEvent`). Each helper iterates the matching handler `Set` in an
`EventEmitter`, invokes each handler inside a `try/catch`, and on a throw logs an
error via the module-scoped `log = logger.child({ scope: 'scheduler:events' })`.

The measured Stryker report (`reports/paired/src__utils__scheduler.events.ts.stryker-report.json`)
showed 40 mutants: 18 killed, 2 survived, 20 with `NoCoverage`. Every surviving and
uncovered mutant lived in one of two places the existing `tests/utils/*.test.ts`
suites never exercised:

1. The module-scoped `logger.child({ scope: 'scheduler:events' })` call (line 14).
2. The `catch` block body of each of the four `emit*Event` helpers (the error path).

This spec adds a dedicated companion test file (`tests/utils/scheduler.events.test.ts`)
that drives the error path of all four emitters and asserts the exact `log.error`
payloads, plus the import-time `logger.child` scope. Every new assertion uses exact
equality (`toBe`) on the full, knowable value. After the work, 36/40 mutants are
killed (score `0.90`); the remaining 4 are the `'Unknown error'` fallback string in
each catch block — a tests-only ceiling documented under **Accepted residuals**.

## Why this file

- The four `emit*Event` catch blocks are the scheduler's defensive boundary: a
  misbehaving event handler must not crash the scheduling loop. The catch block is
  currently untested — if it were silently broken (e.g. swallowed without logging, or
  logged with the wrong event tag), no test would notice.
- `createEmitters` is the only export and is consumed by `createScheduler`
  (`src/utils/scheduler.ts:146`); a regression here affects every scheduled task.
- The file is small, pure, and has no I/O — it is an ideal, cheap target for full
  mutation coverage from tests alone.

## Non-goals

- Editing `src/` (or `client/`, `plugins/`, `scripts/`). This iteration is test-only.
- Changing `scripts/mutation/baseline.json` — the runner owns it.
- Retesting the happy path (mutants already `Killed`: the function/forEach/try block
  bodies and the `createEmitters` wiring). Those are covered by the existing
  `tests/utils/scheduler*.test.ts` suites.
- The `instanceof Error ? error.message : 'Unknown error'` ternary itself — Stryker
  emitted no mutant on that expression, so it needs no dedicated test.

## Gap analysis

Grouped by mutant class (each class = one structural location shared across the four
near-identical helpers, plus the standalone scope class). Status counts are from the
measured report.

| Class | Location (lines) | Mutant ids | Status | Why it survives / is uncovered |
| --- | --- | --- | --- | --- |
| A. Logger scope | `log = logger.child({ scope: 'scheduler:events' })` (L14) | 0, 1 | Survived | No test captures the import-time `logger.child` call, so mutating the scope object (`{}`) or the scope string (`""`) is invisible. The logger is a no-op mock everywhere. |
| B. `emitTickEvent` catch | L23–26 | 5, 6, 7, 8, 9 | NoCoverage | No test registers a `tick` handler that throws, so the catch block (and its `log.error` payload) never executes. |
| C. `emitErrorEvent` catch | L37–40 | 13, 14, 15, 16, 17 | NoCoverage | Same — no throwing `error` handler. |
| D. `emitRetryEvent` catch | L51–54 | 21, 22, 23, 24, 25 | NoCoverage | Same — no throwing `retry` handler. |
| E. `emitFatalErrorEvent` catch | L65–68 | 29, 30, 31, 32, 33 | NoCoverage | Same — no throwing `fatalError` handler. |

Within each catch class (B–E) the five mutants are structurally identical across the
four helpers:

- the catch `BlockStatement` → `{}` (mutant 5/13/21/29),
- the `'Unknown error'` fallback string → `""` (6/14/22/30) — **accepted residual**,
  see below,
- the `log.error` first-arg object literal → `{}` (7/15/23/31),
- the event-tag string (`'tick'`/`'error'`/`'retry'`/`'fatalError'`) → `""` (8/16/24/32),
- the `'Event handler threw error'` message string → `""` (9/17/25/33).

## Design — tests to add

A single new companion file `tests/utils/scheduler.events.test.ts`, mapped one-to-one
onto the gap classes above (one `test()` per class). It follows the cache-busting
logger-mock pattern from `tests/history.test.ts` / `tests/tools/search-memos.test.ts`:
per-test, install a recording `logger` via `mock.module`, then `import(...scheduler.events.js?t=<uuid>)`
so the module re-evaluates and its module-scoped `log` binds to the recorder. Because
`scheduler.events.js` is already in the import graph of the `tests/mock-reset.ts`
preload (via `src/scheduler.js`), a plain static import would re-use the cached module
bound to the real logger — the cache-busting query is what forces the fresh binding.

| Test | Kills class | Mutant ids | How |
| --- | --- | --- | --- |
| `logger.child` is invoked once at import with the exact scheduler:events scope | A | 0, 1 | Capture the `child` call args; assert `childCalls.length === 1` and `scope === 'scheduler:events'` (`toBe`). Mutating the object to `{}` drops `scope` to `undefined`; mutating the string to `""` makes `scope === ""`. |
| `emitTickEvent` logs the exact error payload when a tick handler throws | B (4 of 5) | 5, 7, 8, 9 | Register one throwing `Error` handler in `events.tick`; call `createEmitters(events).emitTick(event)`. Assert `errorCalls.length === 1`, `payload.error === 'handler blew up'`, `payload.event === 'tick'`, and `message === 'Event handler threw error'` (all `toBe`). The object-literal mutant is killed because `{}` makes `payload.error`/`payload.event` `undefined`. |
| `emitErrorEvent` logs the exact error payload when an error handler throws | C (4 of 5) | 13, 15, 16, 17 | Same shape, `events.error`, `payload.event === 'error'`. |
| `emitRetryEvent` logs the exact error payload when a retry handler throws | D (4 of 5) | 21, 23, 24, 25 | Same shape, `events.retry`, `payload.event === 'retry'`. |
| `emitFatalErrorEvent` logs the exact error payload when a fatalError handler throws | E (4 of 5) | 29, 31, 32, 33 | Same shape, `events.fatalError`, `payload.event === 'fatalError'`. |

The tests throw an `Error` (not a non-Error) on purpose: the repo's oxlint config
enforces `eslint/no-throw-literal` and `typescript/only-throw-error` (both `error`),
which reject throwing any non-Error value (literal, `any`, or `unknown`). That makes
the `'Unknown error'` `else` branch (mutant 6/14/22/30) unreachable from lint-clean
tests — see **Accepted residuals**.

Assertion policy: every check is `toBe(...)` against the full, exact expected value.
Object payloads are read through a pure `isRecord` type predicate narrowed via a
`requireRecord` helper (no `as` casts — `no-unsafe-type-assertion` is enforced), and
index-signature properties are read with bracket notation (`payload['error']`) per the
repo's `TS4111` rule. No `startsWith`/`endsWith`/`toContain`/`toEqual` partial matching.

## Verification

1. `bun test tests/utils/scheduler.events.test.ts` — the new file passes in isolation (5/5).
2. `bun run typecheck` and `bun run lint` — clean (no lint-disable / type-ignore / unsafe casts).
3. `bun test tests/utils/scheduler.helpers.test.ts tests/utils/scheduler.internal.test.ts tests/utils/scheduler.test.ts` — no sibling regression (53/53).
4. `bun test:mutate:file src/utils/scheduler.events.ts` — re-measured: `killed=36
   survived=0 noCoverage=4 pending=0 score=0.9`. The non-killed set is exactly
   `{6, 14, 22, 30}` (the `'Unknown error'` strings), which the declared residuals cover 1:1.

## Accepted residuals

The four `'Unknown error'` fallback strings (mutant ids **6, 14, 22, 30** — one per
`emit*Event` catch block, at `src/utils/scheduler.events.ts:24`, `:38`, `:52`, `:66`)
are accepted residuals.

Each is the `else` branch of `error instanceof Error ? error.message : 'Unknown error'`
and is only evaluated when the caught value is **not** an `Error`. The repo's oxlint
config enforces `eslint/no-throw-literal` and `typescript/only-throw-error` (both
`error` severity), which reject throwing any non-Error value in test code (string,
object, `any`, and `unknown` were all confirmed rejected by probing the linter).
Therefore no lint-clean test can make an event handler throw a non-Error, the branch is
unreachable from tests, and mutating the literal to `""` has no observable effect
(Stryker reports them `NoCoverage`). Killing any of them would require either disabling
the lint rule or editing `src/` (e.g. typing the handler return so a non-Error throw is
impossible, or dropping the fallback) — both outside the test-only constraint. These are
the file's entire tests-only ceiling; the union of their `mutantIds` exactly equals the
runner-measured surviving set.
