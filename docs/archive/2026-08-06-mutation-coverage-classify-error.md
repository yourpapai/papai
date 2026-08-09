<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Plan — Mutation Coverage for classify-error.ts

**Date:** 2026-08-06
**Spec:** `docs/superpowers/specs/2026-08-06-mutation-coverage-classify-error-design.md`
**Target file:** `plugins/task-provider-youtrack/classify-error.ts`
**Companion test:** `tests/plugins/task-provider-youtrack/classify-error.test.ts`
**Starting score:** 0.618 · **Target:** ≥ 0.9

## Global constraints

- **Test-only.** Edit only the companion test file and the docs/spec/result
  JSON. No edits under `src/`, `client/`, `plugins/`, or `scripts/`.
- Do not touch `scripts/mutation/baseline.json` (runner-owned ratchet).
- Every new assertion uses exact equality: `toBe(...)` for scalars/strings,
  `toEqual(...)` for the full `requiredFields` array. No
  `startsWith` / `endsWith` / `toContain` where a full value is knowable.
- All inputs flow through the public `classifyYouTrackError` export; no
  private helper is imported.
- Each new test targets exactly one mutant class from the spec's gap table.
- SPDX header preserved/added on any new file; emoji copied verbatim from
  source (none introduced here).

## Tasks (one per mutant class)

- [ ] **A — `isYouTrackErrorBody` invalid-body guards (L38/L41/L42).**
  Add tests asserting a 500 error with `{ error: 123 }` and with `null`
  falls back to the constructor message without throwing.
- [ ] **B — foreign-key loop (L40/L41).** Add a test with
  `{ error: 'ok', extra: 9 }` asserting the body stays valid.
- [ ] **C — `extractYouTrackErrorMessage` undefined-body arm (L49/L50).**
  Covered by task A's `{ error: 123 }` case; add an explicit comment-free
  assertion that `result.message` equals the constructor message.
- [ ] **D — `normalizeFieldName` cleaning (L59–L62).** Add tests for
  whitespace-trim, quote-strip, and double-space collapse, asserting exact
  `requiredFields` arrays.
- [ ] **D/E — empty-after-trim (L63).** Add a test where the captured name
  trims to empty and assert `requiredFields.length` is `0`.
- [ ] **E — stopword filter (L64/L65).** Add four tests (one per stopword)
  plus one mixed-case `Field` test, each asserting length `0`.
- [ ] **F — ` and ` rewrite (L70).** Add `Alpha and Beta` test asserting
  exactly two distinct names.
- [ ] **G — candidate wiring (L79/L81/L82).** Add `error_rule_name`-only
  workflow test asserting the rule-name candidate is harvested.
- [ ] **H — "requires these custom fields:" regex (L84/L85).** Add test
  asserting `[{ URL }, { Name }]`.
- [ ] **I — "required field(s):" regex (L89/L90).** Add singular and plural
  tests.
- [ ] **J — "field X is required" regex (L94–L98).** Add unquoted
  `field URL is required` test.
- [ ] **K — fallback skip + undefined guard (L102/L105/L110/L112).** Add the
  `Primary. Fill "Extra"` test and the no-`error_description` quoted test.
- [ ] **M — workflow `projectId` (L129).** Assert preserved value and
  `'unknown'` fallback.
- [ ] **N — 400 invalid body (L154).** Assert `validation-failed` without
  throwing.
- [ ] **O — 404 context fallbacks (L168/L172/L176/L180/L184).** Assert
  `'unknown'` for project/comment/label/saved-query ids.
- [ ] **P — `YouTrackClassifiedError.name` (L18).** Assert `.name`.

## Residuals (equivalent mutants — documented, not killed)

Final measured set after the test pass (14 survivors, score 0.9491). Each is
a true equivalent given the data-flow invariants of the module:

- [x] **L38:24** `ConditionalExpression => false` (`typeof body !== 'object'`
      guard). Redundant with the `body === null` short-circuit: every
      non-null primitive body proceeds to `Object.entries`, whose property
      access on a boxed primitive returns `undefined` and falls through to the
      same extracted message.
- [x] **L59:19** `MethodExpression => rawName` (`.trim()` removed). The
      immediately-following regex `/^["'\s]+|["'\s]+$/gu` already strips all
      leading/trailing whitespace, so the prior `.trim()` is a no-op.
- [x] **L79:23 / L79:48 / L79:61** `OptionalChaining` on
      `body?.error_description|error|error_rule_name`.
      `extractRequiredFields` is only called from
      `classifyWorkflowValidationError`, which is only reached when
      `body?.error_type === 'workflow'` — i.e. `body` is guaranteed defined,
      so `body?.X` ≡ `body.X`.
- [x] **L94:44** `Regex` `\s+` → `\s` (both whitespace groups in the
      `field … is required` pattern). Any extra space absorbed by the
      single-`\s` mutant lands at the start/end of the capture group and is
      removed by `normalizeFieldName`'s trim/strip, so the cleaned name is
      identical.
- [x] **L96:11 / L110:11** `ConditionalExpression => false` on
      `if (fieldName === undefined) continue`. The capturing groups
      `([^"':.;]+?)` and `([^"…"]+)` require ≥1 char, so `match[1]` is never
      `undefined` when a match exists; the guard is dead code.
- [x] **L103:28** `OptionalChaining` on `body?.error_description`. Same
      invariant as L79: `body` is always defined in this scope.
- [x] **L114:11** `ConditionalExpression => true|false` and
      `EqualityOperator` (`names.size >= 0` / `<= 0`) on
      `if (names.size > 0) break`. In the fallback scope the two candidates
      are `body?.error_description` and `message`, and
      `message === body?.error_description` whenever the description is
      present (it wins the `??` chain in `extractYouTrackErrorMessage`);
      when it is absent the first candidate is `undefined` and skipped.
      Either way the second candidate cannot add names the first did not, so
      the early-break is a no-op.

## Verification steps

1. `bun test tests/plugins/task-provider-youtrack/classify-error.test.ts`
   → green.
2. `bun test:mutate:file plugins/task-provider-youtrack/classify-error.ts`
   → score ≥ 0.9 (residuals enumerated above).
3. `git diff --name-only` shows only `tests/`, `docs/superpowers/`, and the
   result JSON.
