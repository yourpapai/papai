<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan — Mutation Coverage for `src/reply-context.ts`

Implements the design in
`docs/superpowers/specs/2026-08-08-mutation-coverage-reply-context-design.md`.
Test-only: every change is inside `tests/reply-context.test.ts`.

## Global constraints

- No edits under `src/`, `client/`, `plugins/`, `scripts/`, or
  `scripts/mutation/baseline.json`.
- Every new assertion uses exact `toBe(...)` (or `toEqual` for the `chain`
  array, and `toBeUndefined()` where the value is provably `undefined`).
  Expected strings are assembled from captured `stagedId` / known inputs.
- Keep the existing tests and the existing `mockMessageCache()` / `mockLogger()`
  pattern for the chain/prompt describes; add a new `describe('staged-file
  context')` that also calls `await setupTestDb()`.
- The global preload (`tests/mock-reset.ts`) sets `S3_BUCKET`,
  `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` in `beforeEach` and deletes them in
  `afterEach`, so `isS3Configured()` is true by default; the one S3-off test
  deletes them itself and relies on the next `beforeEach` to restore.
- SPDX header preserved on the test file; no comments added to test bodies.

## Tasks (one checkbox per killable mutant class)

- [ ] **T1a — chain skip empty text.** Cache `A{text:''}` ← `B{text:'Hi'}`;
  assert `buildReplyContextChain('ctx1','B').chainSummary` is `toBe(undefined)`
  and `.chain` is `toEqual(['A','B'])`. Kills 13,14,21,23.
- [ ] **T1b — chain skip undefined text.** Cache `A` (no `text`) ← `B`;
  assert `.chainSummary` is `toBe(undefined)`. Kills 15,16,19.
- [ ] **T2 — chain author fallback.** Cache `A{no authorUsername, text:'Root'}`
  ← `B`; assert `.chainSummary` is `toBe('user: Root')`. Kills 25.
- [ ] **T3a — empty summaries → undefined.** Asserted via T1a's
  `toBe(undefined)` (chain length > 1, all earlier skipped). Kills 28, 30.
- [ ] **T3b — join separator.** Three-message chain `A→B→C`; assert
  `.chainSummary` is `toBe('alice: First → bob: Second')`. Kills 32.
- [ ] **T4a — replying line absent when no text.** `replyContext` with
  `quotedText` only; exact `toBe` of the prompt. Kills 69.
- [ ] **T4b — quoted line absent when no quotedText.** `replyContext` with
  `text` only; exact `toBe`. Kills 76.
- [ ] **T4c — earlier-context line absent when chainSummary undefined.** Exact
  `toBe`. Kills 87, 89, 90.
- [ ] **T4d — earlier-context line absent when chainSummary is ''.** Exact
  `toBe`. Kills 92, 94.
- [ ] **T4e — initial [] and the two '\n\n' separators.** `replyContext` with
  text+quotedText+chainSummary; exact `toBe` of the full three-line prompt.
  Kills 65, 140, 141.
- [ ] **T6a — staged block, S3-on, named sender.** `setupTestDb`; stage a file
  for `(storageContextId, replyToMessageId)` with `senderUsername:'alice'`; no
  reply context, no attachments; assert prompt is
  `toBe('[Staged file available: <stagedId> "report.pdf" from alice]\\n\\n<text>')`.
  Kills 106,107,118,123,125,126,128,130,131,132,133,134.
- [ ] **T6b — staged block, anonymous sender.** Same with
  `senderUsername:null`; assert line ends `from unknown user`. Kills 135.
- [ ] **T7 — staged-block conditionals under S3-off.** Delete the three `S3_*`
  env vars, stage a file, assert prompt is `toBe(msg.text)`. Kills 119,120,121.

## Residual declaration (do-not-kill set)

After the tasks above, the survivors must equal exactly:

`0, 1, 17, 34, 40, 42, 43, 44, 45, 46, 48, 50, 51, 52, 53, 54, 55, 56, 57, 58,
59, 61, 63, 67, 97, 98, 99, 103, 108, 110, 122, 124, 127, 129`

Rationale per class is in the spec's *Accepted residuals* and carried into
`result.json`.

## Verification gates

- [ ] `bun test tests/reply-context.test.ts` → green.
- [ ] `bun test:mutate:file src/reply-context.ts` → `killed=108`, 34 survivors,
  and survivor ids == the set above.
- [ ] Write `.review-loop/result.json` with `specPath`, `planPath`,
  `testPaths`, `residuals` (per-loc `why` + `mutantIds`), `notes`.
