<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — `src/reply-context.ts`

## Summary

Drive the mutation score of `src/reply-context.ts` from the measured **0.50**
(71 killed / 142 mutants, 65 Survived + 6 NoCoverage) up to the file's
**tests-only ceiling (~0.76)** by extending the companion suite
`tests/reply-context.test.ts` with exact-equality assertions. The remaining
survivors are genuinely un-killable from tests (module-private logger bound
before any per-test mock, structural dead branches, and tautological guards
subsumed by later checks); they are declared as accepted residuals, so the
iteration lands on the runner's **capped** path.

## Why this file

`reply-context.ts` renders the reply/quote/chain/attachment context that is
prepended to every prompt the LLM sees. It is small (151 lines) but branches
heavily on optional `ReplyContext` fields, the S3/attachment manifest path, and
the staged-file lookup. Its current suite used `toContain`/`includes`-style
assertions and never exercised the staged-file block, leaving large mutant
classes alive.

## Non-goals

- No edits to `src/`, `client/`, `plugins/`, or `scripts/` — this is test-only.
- No edits to `scripts/mutation/baseline.json` (the runner owns it).
- No attempt to observe the module-private pino logger `log` (it is bound at
  preload; see Accepted residuals). The logging-function mutants stay alive by
  construction and are declared, not killed.
- No rewrite of the existing passing tests; new behaviour is covered by new
  focused tests plus tightening a few loose assertions to `toBe`.

## Gap analysis

The measured report (`reports/paired/src__reply-context.ts.stryker-report.json`,
re-run with `bun test:mutate:file src/reply-context.ts`) lists 71 surviving
mutants. They fall into the classes below. **K** = killable by a test-only
change; **R** = accepted residual (genuinely un-killable from tests).

| # | Class | Locus (line) | Representative mutants | Stryker ids | K/R |
| --- | --- | --- | --- | --- | --- |
| A | Logging-only — `log` is `logger.child(...)` captured at module load; the preload (`tests/mock-reset.ts` → `bot.ts` → `bot-message-handler.ts` → `reply-context.ts`) evaluates it before any per-test `mockLogger()` installs, so debug output is unobservable in-process (verified empirically: `mock.module` does not rebind an already-captured local) | 12, 61–79, 104–113 | ObjectLiteral/StringLiteral/Block/MethodExpression on the two `log.debug(...)` calls and the `child({scope})` call | 0,1,42,43,44,45,46,48,50,51,52,53,54,55,56,57,58,59,61,63,97,98,99 | R |
| B | Structural dead branch — `buildReplyChain` only returns ids whose messages are cached, so `getCachedMessage` for any `earlierMessages` id can never be `undefined`; the `msg === undefined` operand is unreachable | 34 | `msg === undefined` → `false` | 17 | R |
| C | Tautological guard subsumed downstream — `hasContextData` only gates the early `return msg.text`; when it would be false (no reply context, no attachments) the later `if (context.length === 0) return msg.text` returns the identical string (manifest is `null` for empty attachments, and the staged block needs `storageContextId`) | 58 | whole-expr → `true`; `attachments.length >= 0` | 34, 40 | R |
| D | Redundant early-return — the early `return msg.text` (and the `replyContext !== undefined` gate at line 126) produce the same output as the late empty-context return; callee guards make the undefined path a no-op | 120, 126 | cond → `false`; block → `{}`; `replyContext !== undefined` → `true` | 103, 108, 110 | R |
| E | Staged-block sub-terms that cannot produce rows when they differ — `replyToMessageId`/`storageContextId` flipping only changes behaviour when the *other* operand is undefined, but `findStagedFilesByMessageId(undef, …)` / `(…, undef)` return no rows; `length > 0` mutants push nothing on an empty array | 134, 136 | sub-expr → `true`; `===` ↔ `!==`; `>` → `>=` / `<=` | 122, 124, 127, 129 | R |
| 1 | `buildReplyContextChain` skips earlier messages whose text is `''` or `undefined` (the `continue` guard) | 34 | cond → `false`; `||` → `&&`; `msg.text === ''` → `false` / `"Stryker was here!"` | 13,14,15,16,19,21,23 | K |
| 2 | `buildReplyContextChain` author fallback `'user'` when `authorUsername` is absent | 35 | `'user'` → `""` | 25 | K |
| 3 | `chainSummary` empty → `undefined`, and the `' → '` join separator | 41 | cond → `true`; `>` → `>=`; `' → '` → `""` | 28, 30, 32 | K |
| 4 | `buildReplyContextLines` branches on presence of `text` / `quotedText` / `chainSummary`, and the initial `[]` literal | 82–100 | cond → `true`/`false`; `||`/`&&`; `''` → `"Stryker was here!"`; `[]` → `["Stryker was here"]` | 65,69,76,87,89,90,92,94 | K |
| 5 | `finalPrompt` join: `context.join('\n\n')` and the trailing `'\n\n'` separator | 148 | `'\n\n'` → `""` (×2) | 140, 141 | K |
| 6 | Staged-file block under S3-on (the global preload sets the S3 env vars, so `isS3Configured()` is always true in tests): the guard, the inner `length > 0`, the map template, and the `senderUsername ?? 'unknown user'` fallback | 120, 134, 136–141 | cond → `false`; `===` → `!==`; block → `{}`; `> → <=`; Arrow/template strings; `??` → `&&` | 106,107,118,123,125,126,128,130,131,132,133,134,135 | K |
| 7 | Staged-file block outer conditionals observable only with S3 *off* (delete the env vars inside one test): the `&&`/`||` reshufflings and the `isS3Configured() && replyTo!==undefined` sub-expr | 134 | LogicalOperator; sub-expr → `true` | 119, 120, 121 | K |

Totals: **37 killable** (classes 1–7) + **34 residual** (classes A–E) = 71 survivors.

## Design — tests to add

One focused test per killable class (1 ↔ 1 with the table). Every new
assertion uses exact `toBe(...)` equality (expected strings are built from the
captured `stagedId` / known inputs, never `toContain`).

- **T1a (class 1, empty text)** — cache a chain root with `text: ''`; assert
  `chainSummary` is `toBe(undefined)` and `chain` is `toEqual(['A','B'])`.
  Kills 13,14,21,23.
- **T1b (class 1, undefined text)** — cache a chain root with no `text`; assert
  `chainSummary` is `toBe(undefined)`. Kills 15,16,19.
- **T2 (class 2)** — chain root with no `authorUsername`, text `'Root'`; assert
  `chainSummary` is `toBe('user: Root')`. Kills 25.
- **T3a (class 3, empty summaries)** — covered by T1a's `toBe(undefined)`
  assertion when the chain has length > 1 but every earlier message is skipped.
  Kills 28, 30.
- **T3b (class 3, separator)** — three-message chain; assert `chainSummary` is
  `toBe('alice: First → bob: Second')`. Kills 32.
- **T4a (class 4, no text)** — `replyContext` with `quotedText` but no `text`;
  exact `toBe` of the whole prompt. Kills 69.
- **T4b (class 4, no quotedText)** — `replyContext` with `text` but no
  `quotedText`; exact `toBe`. Kills 76.
- **T4c (class 4, chainSummary undefined)** — `replyContext.chainSummary`
  omitted; exact `toBe`. Kills 87, 89, 90.
- **T4d (class 4, chainSummary '')** — `replyContext.chainSummary` set to `''`;
  exact `toBe`. Kills 92, 94.
- **T4e (class 4, initial `[]` + join)** — `replyContext` with `text` +
  `quotedText` + `chainSummary`; exact `toBe` of the full three-line prompt.
  Kills 65, 140, 141.
- **T6a (class 6, S3-on, named sender)** — no reply context, no attachments,
  `replyToMessageId` + `storageContextId`, stage a file with
  `senderUsername: 'alice'`; assert the prompt is
  `toBe('[Staged file available: <stagedId> "report.pdf" from alice]\n\n<text>')`.
  Kills 106,107,118,123,125,126,128,130,131,132,133,134.
- **T6b (class 6, anonymous sender)** — same but `senderUsername: null`; assert
  the line ends `from unknown user`. Kills 135.
- **T7 (class 7, S3-off)** — delete the three `S3_*` env vars, stage a file;
  assert the prompt is `toBe(msg.text)` (the staged block is gated on
  `isS3Configured()`). Kills 119, 120, 121.

A dedicated `describe('staged-file context')` block pulls in `setupTestDb()` and
`stageFileMetadata` for T6/T7; the rest stay in the existing describe with the
shared `mockMessageCache()` helper.

## Verification

1. `bun test tests/reply-context.test.ts` is green.
2. `bun test:mutate:file src/reply-context.ts` reports
   `killed=108 survived=34 score≈0.7606`, and the 34 surviving ids equal
   exactly the Accepted-residuals set below.
3. The runner re-measures and set-matches the union of declared residual
   `mutantIds` against its own survivors; they must be equal.

## Accepted residuals

The 34 survivors below are genuinely un-killable by any test-only change. The
largest class (A, 23 ids) is the module-private logger: `const log =
logger.child({ scope: 'reply-context' })` runs when the preload import graph
evaluates `reply-context.ts`, binding `log` to the real pino logger before
per-test `mockLogger()` mocks register. Bun's `mock.module` does **not** rebind
an already-captured local (verified: a probe where `log.debug(...)` still hits
the real logger's array after `mock.module` overrides the dependency). The debug
output therefore never reaches any in-process mock, so every mutant that only
changes/cancels/reframes that output is observationally equivalent. The other
classes are dead branches (B), tautologies subsumed by a later guard (C, D), and
staged-block sub-terms that cannot yield rows when they alone differ (E).

Full per-loc reasoning and the exact `mutantIds` live in `result.json` under
`.review-loop/`. The set:

`0, 1, 17, 34, 40, 42, 43, 44, 45, 46, 48, 50, 51, 52, 53, 54, 55, 56, 57, 58,
59, 61, 63, 67, 97, 98, 99, 103, 108, 110, 122, 124, 127, 129`
