<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation coverage: `src/announcements/humanize.ts`

## Summary

Raise the Stryker mutation score of `src/announcements/humanize.ts` from the
measured **0.338** (killed=23, survived=40, noCoverage=5 out of 68 mutants) to
**>= 0.9** using test-only changes. The work adds exact-equality assertions to
the companion test file `tests/announcements/humanize.test.ts` that pin the two
LLM system-prompt constants, the empty-release sentinel, the not-configured and
failure log warnings, the logger child scope, and the default-deps wiring. Six
mutants are declared as accepted residuals (one true equivalent, five at the
test-only ceiling).

## Why this file

`humanize.ts` is the changelog humanizer: it classifies raw changelog lines via
a structured LLM pass, drops entries that do not matter to end users, and turns
the survivors into a friendly announcement via a second LLM pass. Its behavior is
gated entirely by dependency-injected callbacks (`HumanizeChangelogDeps`), so the
existing DI tests already cover the happy/error paths of `humanizeChangelog` —
but they only assert *return values* and use loose `toContain` checks on the
prompts. Almost every surviving mutant is a prompt string literal or a log call
that a loose/absent assertion cannot distinguish.

## Non-goals

- Editing `src/` (or `client/`, `plugins/`, `scripts/`). This is test-only.
- Changing `scripts/mutation/baseline.json` (the runner owns it).
- Refactoring the production prompts or log messages.
- Rewriting the existing DI-first tests; they stay, new assertions are added
  alongside them.

## Gap analysis

Measured survivors (45 total = 40 Survived + 5 NoCoverage) group into eight
classes. `mutantIds` are the Stryker ids from
`reports/paired/src__announcements__humanize.ts.stryker-report.json`.

| # | Class (location) | Mutants | mutator(s) | Why it survives |
| --- | --- | --- | --- | --- |
| A | `CLASSIFY_SYSTEM_PROMPT` array + join (L27–35) | 9 | `8` ArrayDeclaration, `9`–`15` StringLiteral, `16` StringLiteral (join `'\n'`) | No test asserts the *exact* classify `system` prompt passed to `generateStructured`; only `prompt` is loosely checked. |
| B | `SYSTEM_PROMPT` array + join (L39–58) | 17 | `19`–`22`,`24`–`25`,`27`–`37` StringLiteral (elements + join) | Existing test uses `toContain` on three substrings of the write `system`; every other element/separator mutates unseen. |
| C | `EMPTY_RELEASE_NOTE` literal (L37) | 1 | `17` StringLiteral | Existing test asserts `toBe(EMPTY_RELEASE_NOTE)` — comparing the constant to itself masks any value change. |
| D | `logger.child({ scope })` (L14) | 2 | `0` ObjectLiteral, `1` StringLiteral | The child-scope argument is set at module load and never observed. |
| E | not-configured guard + `log.warn` (L86–94) | 8 | `47`/`48` guard skipped, `49` ObjectLiteral, `50`/`51` ConditionalExpression, `52` EqualityOperator, `53`/`54` StringLiteral | Guard is masked by the downstream `catch` (skipping it still yields `null` via a thrown `config.main` access), and the warn metadata/message are never asserted. |
| F | `defaultDeps` object + arrow bodies (L67–77) | 6 | `38` ObjectLiteral, `39`/`41` BlockStatement (NoCov), `40`/`42`/`43` ObjectLiteral (NoCov) | `defaultDeps` is never exercised — every test injects `deps(...)`. |
| G | failure `log.warn` (L109) | 2 | `66` ObjectLiteral, `67` StringLiteral | The catch-path warn metadata/message are never asserted. |

(E = 8 mutants: `47,48,49,50,51,52,53,54`. F = 6 mutants: `38,39,40,41,42,43`.)

## Design — tests to add

Each added test maps one-to-one onto a gap class and uses exact equality
(`toBe` for scalars/strings; `toEqual` for the one fully-knowable metadata
object/array, which is exact deep equality — never `toContain`/`startsWith`).

| Test | Kills (class) | How |
| --- | --- | --- |
| `passes the exact classify system prompt to the structured pass` | A (`8`–`16`) | Capture `opts.system` on `generateStructured`; assert `toBe(CLASSIFY_SYSTEM_PROMPT_TEXT)` — the verbatim joined constant. |
| `passes the exact write system prompt to the announcement pass` | B (`19`–`37`) | Capture `opts.system` on `generate`; assert `toBe(SYSTEM_PROMPT_TEXT)`. |
| `returns the literal empty-release note text when nothing survives` | C (`17`) | Assert `toBe(<literal>)` against the hardcoded string, not the re-imported constant. |
| `logs the not-configured warning with the child scope, exact metadata, and message` | D + E except `50` (`0`,`1`,`47`,`48`,`49`,`51`,`52`,`53`,`54`) | Capture the emitted warn via the logger's multistream; assert `scope` `toBe('announcements:humanize')` (kills the child-scope object/string mutants `0`/`1`), the exact metadata fields, and `msg` `toBe('Central LLM not configured; skipping changelog humanization')`. Skipping the guard (`47`/`48`) omits this warn entirely; mutating the ternary/operators (`51`/`52`/`53`) or the metadata object (`49`) or the message (`54`) breaks the exact match. |
| `logs the humanization-failed warning with the child scope, error, and message` | G (`66`,`67`) | Reject in `generateStructured`; assert the captured warn's `error` `toBe('boom')`, `scope` `toBe('announcements:humanize')`, and `msg` `toBe('Changelog humanization failed')`. |
| `uses the real default-deps wiring when none are passed` | F-`38` only | Call `humanizeChangelog('raw')` with no deps (over a migrated test DB); real `defaultDeps` resolves to an unconfigured central LLM and returns `null`, whereas mutating `defaultDeps` to `{}` makes `resolveConfig` undefined and the call rejects. |

The companion file keeps ordinary static imports. Because `humanize.ts` is
transitively preloaded by the global `tests/mock-reset.ts` (via
`src/announcements.ts`), it is already cached with the real logger before any
per-file `mock.module` could apply, and `tests/setup.ts` pins `LOG_LEVEL=silent`
before that load — so the child logger emits nothing by default. The logging
tests therefore observe output through pino's public `logMultistream.add()`
extension point (a trace-level capture stream) after raising
`logger.level = 'trace'` (pino children inherit the root level dynamically).
`setupTestDb()` runs in `beforeEach` so the default-deps path's real
`resolveAdminLlmConfig` sees a migrated (empty) `llm_admin_roles` table and
returns not-configured instead of throwing. The existing DI tests are unchanged
in behavior.

## Verification

- `bun test tests/announcements/humanize.test.ts` is green.
- `bun test:mutate:file src/announcements/humanize.ts` reports
  killed=62 survived=1 noCoverage=5 → score **0.9118** (>= 0.9), with exactly
  the six residual ids `{39, 40, 41, 42, 43, 50}` surviving.

## Accepted residuals

Six survivors remain; the runner-measured surviving set must equal this union.

| loc | why | mutantIds |
| --- | --- | --- |
| L91 `missing: config.type === 'missing' ? config.missing : undefined` (mutant `50`, ConditionalExpression → always-true) | True equivalent. `config.missing` is only present on `LlmConfigMissing` (where `type === 'missing'`); for every valid `LlmConfigResult` the always-true branch yields the same value as the original ternary. Distinguishing it requires a type-inconsistent config object (impossible input). | `["50"]` |
| L70–73 `defaultDeps.generate` arrow body (mutants `39`,`40`) | Test-only ceiling. Only reachable through `defaultDeps`, which every consumer overrides via DI. `defaultDeps.resolveConfig`/`buildModel` are import-time snapshots of the real `resolveAdminLlmConfig`/`buildChatModel`; reaching `generate` requires a DB-seeded admin LLM config plus an `ai`-SDK `generateText` mock — the body merely forwards `result.text`, i.e. it re-tests the SDK contract, not papai logic. | `["39","40"]` |
| L74–77 `defaultDeps.generateStructured` arrow body + `Output.object` config (mutants `41`,`42`,`43`) | Test-only ceiling. Same reachability constraint as above; additionally `42`/`43` mutate the structured-output config object (`Output.object({ schema })`) which is opaque to papai — only the external `ai` SDK reads it, so no papai return value can distinguish the mutation without asserting on what the mocked `generateText` received. | `["41","42","43"]` |
