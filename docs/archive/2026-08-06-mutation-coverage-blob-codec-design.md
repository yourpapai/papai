<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage Strengthening — `byok-llm/blob-codec.ts`

**Date:** 2026-08-06
**Status:** Verified — score 0.6944 → target ≥ 0.9 (target met; see Verification); test-only, no `src/` changes.
**Type:** Test-only — no production source changes

## Summary

`src/byok-llm/blob-codec.ts` is the pure codec that decodes an opaque,
storage-shaped BYOK blob into the normalized `ByokBlobV2` shape consumed by the
rest of the LLM layer: it recognizes a v2 blob, migrates a legacy flat
(`llm_apikey`/`llm_baseurl`/`*_model`) blob into a single synthetic provider, and
returns an empty default blob for anything else. Its current mutation score is
**0.6944** (killed=50, survived=18, noCoverage=4 of 72 total). The file is pure,
stateless, has zero external dependencies or I/O, an existing companion test file
to extend, and every surviving mutant maps to an observable defect (wrong type
guard, wrong version match, dropped provider fields, wrong fallback, missing role
binding). This spec adds targeted, exact-equality characterization tests — one per
mutant class — and lifts the score to **≥ 0.9**.

## Why this file

Selection criterion: **best score ROI** — the largest reliable mutation-score
gain per unit of test effort, with the smallest blast radius.

`blob-codec.ts` is an ideal target:

- Pure functions, no DI, no async, no I/O — every branch is reachable from a
  direct `decodeByokBlob(...)` call.
- The existing suite proves three happy paths (v2 round-trip, full legacy
  migration, partial legacy migration) but asserts only a handful of fields, so
  18 mutants survive on un-asserted literals and 4 sites are never even covered.
- Each survivor is killable with a single exact-equality assertion on a value
  whose full form is knowable from the source.

## Non-goals

- No changes to `src/byok-llm/blob-codec.ts` or any other production file. The
  implementation is correct; this is test strengthening only.
- No manual edit to `scripts/mutation/baseline.json` on the PR — the ratchet is
  regression-only on PRs; the raised floor is seeded by CI's master
  `mutation-baseline` job after merge.
- No refactoring of `isV2`/`isLegacy` to fold the type guards into the `in`
  checks. Killing the guard mutants via characterization tests is the intended
  pattern; the guards stay as written for clarity and to short-circuit before the
  throwing `in` operator on primitives.

## Gap analysis — surviving mutant classes

The current suite (`tests/byok-llm/blob-codec.test.ts`) leaks precision because
it never asserts: the migrated provider's `id`/`label`/`providerType`, its
`verification` shape, `baseUrl`, a set `embedding_model`, an absent `main_model`,
a non-object input, a wrong `v`, or the full default blob. The 22 non-killed
mutants group into 9 classes:

| # | Mutant class | Mutant ids (locus) | Why it survives |
|---|---|---|---|
| A | `isV2`/`isLegacy` `typeof value === 'object'` guard dropped → primitives throw instead of falling through | 8 (L27), 22 (L30) | No test passes a non-object value to `decodeByokBlob`; only objects reach both guards |
| B | `isV2` version match `value.v === 2` dropped → `{v: <≠2>}` wrongly accepted | 14 (L27) | No test passes an object carrying `v` with a value other than 2 |
| C | `emptyVerification` body (status literal, models array, whole object, whole function) | 28, 29, 30, 31 (L32–38) | The migrated provider's `verification` is never asserted; only the round-trip blob carries one |
| D | `fromLegacy` provider literals (`id`, `label`, `providerType`) | 33, 35, 36 (L41, L44, L45) | None of the three migrated-provider string literals is ever asserted |
| E | `baseUrl` extraction: `??` operator, the `'llm_baseurl'` key, and the `''` fallback | 37, 38, 39 (L46) | `baseUrl` is never asserted (present) and the fallback is never hit (absent) |
| F | `apiKey` `''` fallback (nullish `llm_apikey`) | 42 (L47) | Every legacy fixture supplies a non-null `llm_apikey`, so the fallback is uncovered |
| G | `embedding_model` role binding: the key, the `=== undefined` conditional, the object literal | 44, 49, 52 (L51, L53) | No fixture sets `embedding_model`; embedding is only ever observed as `null` |
| H | `main_model` `''` fallback in the main role binding | 59 (L57) | Every legacy fixture supplies `main_model`, so the fallback is uncovered |
| I | Default-blob roles object: whole roles object, main binding, both `''` literals | 67, 68, 69, 70 (L64) | No fixture reaches the default-return branch (all inputs are v2 or legacy) |

(All 22 non-killed mutants are accounted for: A=2, B=1, C=4, D=3, E=3, F=1, G=3,
H=1, I=4. Killing ≥ 15 of them reaches the 0.9 target; the design below kills all
22.)

## Design — tests to add

All new cases extend the existing `describe('byok blob codec', …)` block in
`tests/byok-llm/blob-codec.test.ts`. **Every assertion uses exact equality** —
`toBe(...)` for scalars/strings whose full value is knowable, `toEqual(...)` for
the full object shapes. No `startsWith` / `endsWith` / `toContain`. These are
characterization tests against correct code; they pass immediately and the
verification gate is the mutation score.

Mapping one-to-one onto the gap classes:

- **A — non-object input → default blob.** `decodeByokBlob(42)` (a primitive)
  returns the exact empty default blob. Under mutant 8 or 22 the dropped guard
  lets `'v' in` / `'llm_apikey' in` execute on a primitive and throw, so the
  expected default return fails. Asserting the full default shape also pins the
  default roles (bonus coverage for class I).
- **B — wrong-version rejection.** `decodeByokBlob({ v: 1 }).v` is `2` (it is
  neither v2 nor legacy, so it decodes to the default whose `v` is 2). Under
  mutant 14 the version match is dropped and the raw `{ v: 1 }` is returned
  verbatim.
- **C — emptyVerification shape.** A full legacy fixture's
  `providers[0].verification` `toEqual({ status: 'unverified', error: null, at:
  null, models: [], modelsFetchedAt: null })`. Pins the whole object, the
  `'unverified'` literal, the `models: []` array, and the function body.
- **D — migrated provider literals.** Assert `providers[0].id` `toBe('prov_legacy')`,
  `.label` `toBe('Migrated BYOK provider')`, `.providerType` `toBe('custom')`.
- **E — baseUrl present + absent.** A fixture with `llm_baseurl` set asserts
  `.baseUrl` `toBe` that value (kills the `??` and key mutants); a fixture
  without `llm_baseurl` asserts `.baseUrl` `toBe('')` (covers and kills the
  fallback).
- **F — apiKey nullish fallback.** `{ llm_apikey: null }` is structurally legacy
  (the key is present) and asserts `.apiKey` `toBe('')` (covers and kills the
  fallback, which the mutant rewrites to a sentinel).
- **G — embedding role binding.** A fixture with `embedding_model` set asserts
  `roles.embedding` `toEqual({ providerId: 'prov_legacy', model: <value> })`.
  Pins the key, the conditional, and the constructed object literal.
- **H — main model fallback.** `{ llm_apikey: 'k' }` (no `main_model`) asserts
  `roles.main` `toEqual({ providerId: 'prov_legacy', model: '' })`, covering and
  killing the `''` fallback.
- **I — default blob roles.** `decodeByokBlob({ foo: 'bar' })` — an object that is
  neither v2 nor legacy — `toEqual` the full default blob, pinning the roles
  object, the main binding, and both `''` literals at L64.

## Verification

1. **Baseline before** — `bun test:mutate:file src/byok-llm/blob-codec.ts` →
   recorded score **0.6944** (killed=50, survived=18, noCoverage=4, total=72).
2. **Unit green** — `bun test tests/byok-llm/blob-codec.test.ts` stays green.
3. **Mutation target** — re-run `bun test:mutate:file src/byok-llm/blob-codec.ts`;
   target **≥ 0.9**. Inspect the Stryker report; any remaining survivors must be
   the accepted equivalent residual(s) below, not behavioural.
4. **No production diff** — `git diff` must be empty under `src/`.
5. **Baseline ratchet** — no manual baseline edit on the PR; CI's master
   `mutation-baseline` job re-seeds `scripts/mutation/baseline.json` after merge
   via `seedMerge`.

## Accepted residuals

Determined at execution time from the post-run Stryker report. The design's
intent is to kill all 22 non-killed mutants (score → 1.0); any that survive are
accepted only if observably equivalent for every reachable input. See the plan's
final task for the verified residual list. (Pre-execution, no mutant is predicted
to be equivalent — each class has a discriminating input — so the expected
residual set is empty; the canonical example of a *would-be* residual, the
`apiKey`/`baseUrl`/`main_model` `?? ''` fallbacks, is killed here by exercising
the nullish branch directly.)

## Risk & notes

- **TDD write hook:** only `tests/` (and these docs) are touched; `src/` is
  unchanged, so no red-green source gate applies. Adding characterization tests
  to already-correct code is the intended pattern (see `tests/CLAUDE.md`).
- **Exact-equality discipline** is the whole lever — any new test using a partial
  matcher re-opens the leak it was meant to close. The plan calls this out at the
  top of the test additions.
- **Primitives throw under the guard mutants.** The class-A test deliberately
  feeds a primitive; the mutants throw and the assertion (expecting a returned
  value) fails. That is the kill, not a test of thrown behavior.
