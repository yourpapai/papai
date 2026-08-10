<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage — classify-error.ts Design

**Date:** 2026-08-06
**Status:** Proposed
**Scope:** Test-only improvements to `tests/plugins/task-provider-youtrack/classify-error.test.ts`
**Target file:** `plugins/task-provider-youtrack/classify-error.ts`

## Summary

The YouTrack error classifier (`classifyYouTrackError`) maps raw
`YouTrackApiError` / `Error` / unknown values onto a typed
`YouTrackClassifiedError` carrying a standardised `AppError`. Its companion
test suite covers the happy-path status branches but leaves the internal
helpers (`isYouTrackErrorBody`, `normalizeFieldName`, `appendFieldNames`,
`extractRequiredFields`, and the context-fallback wiring) weakly exercised.
Stryker reports **170 killed / 275 total → score 0.618**, far below the 0.9
gate. This spec adds targeted, exact-equality assertions — one logical test
per surviving mutant class — to raise the score to ≥ 0.9 without touching
production code.

## Why this file

`classify-error.ts` is the single translation layer between YouTrack's
free-form error envelopes and papai's structured `AppError` taxonomy. Every
workflow-validation field-extraction rule, every 404 resource routing
branch, and every network/auth heuristic lives here. Surviving mutants in
this file are silent: a flipped regex or a dropped `?? 'unknown'` fallback
still produces *a* classified error, just the wrong one, which then misleads
the LLM tool loop and the analytics classifier. Killing them with
behavioural assertions is high-ROI because each assertion pins a real
user-facing contract.

## Non-goals

- Refactoring `classify-error.ts` or any production file (hard constraint:
  test-only).
- Raising coverage of the Kaneo classifier (`classify-error.test.ts` under
  `task-provider-kaneo`) — out of scope.
- Killing genuinely equivalent mutants (see *Accepted residuals*); those are
  documented, not chased.
- Editing `scripts/mutation/baseline.json` (the runner owns the ratchet).

## Gap analysis

Measured with `bun test:mutate:file plugins/task-provider-youtrack/classify-error.ts`.
83 survived + 22 no-coverage mutants remain. They collapse into the classes
below. Each row names the source location band, the mutant flavour, and the
observable contract that distinguishes the mutant from the original.

| # | Mutant class (locations) | Flavour | Why it survives today | Contract that kills it |
|---|--------------------------|---------|-----------------------|------------------------|
| A | `isYouTrackErrorBody` validation — L38–L42 | `ConditionalExpression`, `LogicalOperator`, `BooleanLiteral`, `ArrayDeclaration`, `StringLiteral`, `BlockStatement` | No test feeds a body whose known key holds a non-string value, nor a `null`/non-object body; the guard therefore looks dead | A 500 error with `{ error: 123 }` must fall back to `error.message`; `null` body must not throw |
| B | `isYouTrackErrorBody` per-key loop — L40/L41 | `ConditionalExpression(true)`, includes-array mutants | No test mixes a valid known key with a *foreign* key carrying a non-string value, so "always validate every key" looks harmless | A 500 error with `{ error: 'ok', extra: 9 }` must still treat the body as valid |
| C | `extractYouTrackErrorMessage` body-undefined branch — L49/L50 | `BlockStatement`, `ConditionalExpression` | No test reaches the "body failed validation → return `error.message`" arm through an HTTP path | 500 error with invalid body yields `result.message === error.message` (mutant crashes) |
| D | `normalizeFieldName` cleaning — L59–L64 | `MethodExpression`, `Regex`, `StringLiteral`, `ConditionalExpression` | No test asserts the *exact* cleaned field name, so trim/quote/collapse/empty differences pass unseen | Workflow error with quoted/whitespace/double-space field names asserts exact `requiredFields` |
| E | `normalizeFieldName` keyword filter — L64/L65 | `MethodExpression`, `ConditionalExpression`, `LogicalOperator`, `StringLiteral` | The four stopwords (`field`, `fields`, `custom field`, `custom fields`) are never fed in, nor a mixed-case variant | Each stopword (and `Field`) yields an empty `requiredFields` |
| F | `appendFieldNames` — L69–L73 | `Regex`, `StringLiteral`, `BlockStatement`, `ConditionalExpression` | The ` and ` → `,` rewrite is never exercised | `required fields: Alpha and Beta` yields exactly `[{Alpha},{Beta}]` |
| G | `extractRequiredFields` candidate wiring — L79/L81/L82 | `ArrayDeclaration`, `OptionalChaining`, `BlockStatement`, `ConditionalExpression` | Candidates array and loop entry are only hit indirectly; empty/undefined candidates look equivalent | A workflow error whose only signal is in `error_rule_name`, plus the primary-pattern test, distinguish the mutants |
| H | `extractRequiredFields` "requires these custom fields:" regex — L84/L85 | `Regex` (4 variants), `ConditionalExpression` | The list pattern is never matched in tests | Exact capture from `requires these custom fields: URL, Name` |
| I | `extractRequiredFields` "required field(s):" regex — L89/L90 | `Regex` (4 variants), `ConditionalExpression` | Singular/plural required-fields pattern never matched | Exact capture from `required field: X` and `required fields: A, B` |
| J | `extractRequiredFields` "field X is required" regex — L94–L98 | `Regex` (8 variants), `ConditionalExpression`, `EqualityOperator` | The per-field assertion pattern never matched (unquoted + quoted) | Exact capture from `field URL is required` |
| K | Fallback quoted extraction — L102/L105/L110/L112 | `ConditionalExpression`, `OptionalChaining` | The "skip fallback when primary matched" guard and the undefined-candidate guard are untested | Primary match that ends before a quoted token must NOT absorb the quoted token |
| L | Fallback quoted extraction — L106–L114 | (covered by existing smart-quote tests + K) | — | Existing tests + K |
| M | `classifyWorkflowValidationError` context — L129 | `LogicalOperator`, `StringLiteral` | Existing workflow test passes a `projectId` but never asserts its value | Assert `projectId` preserved AND fallback `'unknown'` |
| N | `classifyApiError` 400 body access — L154 | `OptionalChaining` | No 400 error with an *invalid* body reaches the `body?.error_type` read | 400 error with `{ error_description: 123 }` classifies as `validation-failed` without throwing |
| O | `classifyNotFoundError` context fallbacks — L168/L172/L176/L180/L184 | `StringLiteral`, `OptionalChaining` | Only the `taskId` "unknown" fallback is asserted; project/comment/label/saved-query fallbacks and the no-context saved-query crash are not | Each 404 resource type without context asserts the exact `'unknown'` id (or `resourceId`) |
| P | `YouTrackClassifiedError.name` — L18 | `StringLiteral` | No test asserts `.name` | `expect(result.name).toBe('YouTrackClassifiedError')` |

## Design — tests to add

Each test below maps 1:1 onto a gap-class row above and uses exact equality
(`toBe` for scalars, `toEqual` for the full `requiredFields` array). All
inputs flow through the public `classifyYouTrackError` export so no helper
is imported directly.

- **A/C — `isYouTrackErrorBody` rejects invalid bodies (HTTP path)**
  - 500 + `{ error: 123 }` ⇒ `result.message` is the constructor message.
  - 500 + `null` body ⇒ does not throw; `result.message` is the constructor
    message; `result.appError.code` is `'unexpected'`.
- **B — foreign non-string key is ignored**
  - 500 + `{ error: 'BodyMsg', extra: 9 }` ⇒ `result.message` is `'BodyMsg'`.
- **C — invalid body short-circuits to `error.message`**
  - 500 + `{ error: 123 }` already covers the `body === undefined` arm.
- **D — `normalizeFieldName` cleaning**
  - `required field:    Spaced   ` ⇒ `[{ name: 'Spaced' }]`.
  - `required field: "Quoted"` ⇒ `[{ name: 'Quoted' }]`.
  - `required field: double  space` ⇒ `[{ name: 'double space' }]`.
- **D/E — empty-after-trim returns null**
  - `required fields: ` ⇒ `requiredFields` length `0`.
- **E — stopword filter (each keyword)**
  - `required field: field` / `: fields` / `: custom field` / `: custom fields`
    ⇒ length `0` for each.
  - `required field: Field` (mixed case, kills `toLowerCase` mutant) ⇒ length `0`.
- **F — ` and ` separator rewrite**
  - `required fields: Alpha and Beta` ⇒ `[{ name: 'Alpha' }, { name: 'Beta' }]`.
- **G — `error_rule_name` candidate**
  - body `{ error_rule_name: 'required field: FromRule', error_type: 'workflow' }`
    ⇒ `[{ name: 'FromRule' }]`.
- **H — "requires these custom fields:" pattern**
  - `requires these custom fields: URL, Name` ⇒ `[{ URL }, { Name }]`.
- **I — "required field:" / "required fields:" patterns**
  - `required field: Solo` ⇒ `[{ Solo }]`.
  - `required fields: A, B` ⇒ `[{ A }, { B }]`.
- **J — "field X is required" pattern**
  - `field URL is required` ⇒ `[{ URL }]` (unquoted, kills `["']?`→`["']`).
- **K — fallback is skipped once a primary pattern matched**
  - `requires these custom fields: Primary. Fill "Extra"` ⇒ `[{ Primary }]`
    (mutant that always runs the fallback would also add `Extra`).
- **K — fallback tolerates an undefined candidate**
  - 400 + `{ error_type: 'workflow' }` + message `fill "Msg"` ⇒ `[{ Msg }]`
    (mutant that drops the `undefined` guard crashes).
- **M — workflow context**
  - workflow error with `{ projectId: 'PROJ-9' }` ⇒ `appError.projectId`
    is `'PROJ-9'`.
  - workflow error with no context ⇒ `appError.projectId` is `'unknown'`.
- **N — 400 with invalid body**
  - 400 + `{ error_description: 123 }` ⇒ `appError.code` is
    `'validation-failed'` (does not throw).
- **O — 404 context fallbacks**
  - 404 `project not found` (no ctx) ⇒ `projectId` is `'unknown'`.
  - 404 `comment not found` (no ctx) ⇒ `commentId` is `'unknown'`.
  - 404 `tag not found` (no ctx) ⇒ `labelName` is `'unknown'`.
  - 404 `saved query not found` (no ctx) ⇒ `resourceId` is `'unknown'`
    (mutant that drops `context?.queryId` crashes).
- **P — classified-error name**
  - any classified result ⇒ `result.name` is `'YouTrackClassifiedError'`.

## Verification

1. `bun test tests/plugins/task-provider-youtrack/classify-error.test.ts`
   is green.
2. `bun test:mutate:file plugins/task-provider-youtrack/classify-error.ts`
   reports a score ≥ 0.9.
3. No file under `src/`, `client/`, `plugins/`, or `scripts/` is modified
   (diff-guard). `scripts/mutation/baseline.json` is untouched.

## Accepted residuals

Equivalent mutants that survive because of data-flow invariants or redundant
guards; each is enumerated in the plan's *Residuals* section with per-loc
reasoning. Representative examples: the `typeof body !== 'object'` guard
(L38:24) is redundant with the `body === null` short-circuit for every
primitive body (property access on a boxed primitive returns `undefined` and
falls through to the same message); `body?.X` optional-chaining inside
`extractRequiredFields` (L79/L103) is equivalent because `body` is
guaranteed defined at every call site; the `if (names.size > 0) break`
optimisation (L114) is equivalent because the two fallback candidates are
always byte-identical or one is `undefined`; `.trim()` before the
quote/whitespace strip regex (L59) is redundant. These are documented, not
pursued.
