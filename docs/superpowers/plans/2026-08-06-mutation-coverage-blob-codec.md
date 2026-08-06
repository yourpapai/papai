<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage Strengthening — `byok-llm/blob-codec.ts` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the mutation score of `src/byok-llm/blob-codec.ts` from **0.6944** (killed=50, survived=18, noCoverage=4, total=72) to **≥ 0.9** by adding exact-equality characterization tests that kill the 22 surviving/uncovred mutants, grouped into 9 classes (A–I).

**Architecture:** Test-only. No production source changes. Each task adds one `toBe`/`toEqual`-equality test to the existing `tests/byok-llm/blob-codec.test.ts` describe block, mapping one-to-one onto the surviving-mutant classes (A–I) identified in the spec's gap analysis. These are characterization tests — they pass immediately against correct code; the verification gate is the mutation score, not a red→green transition.

**Tech Stack:** Bun runtime, `bun:test` (`describe`/`test`/`expect`), Stryker via the repo's paired runner (`bun test:mutate:file`).

## Global Constraints

- **MUST NOT modify any file under `src/`.** The implementation under test is correct; this plan strengthens tests only.
- **Only file modified:** `tests/byok-llm/blob-codec.test.ts` (extend the existing `describe('byok blob codec', …)` block). No other code file.
- **Every new assertion uses exact equality** — `toBe(...)` for scalars and full strings, `toEqual(...)` for full object shapes. No `startsWith`, no `endsWith`, no `toContain` for any value whose full form is knowable. This is the entire lever; a partial matcher re-opens the leak it was meant to close.
- **Runtime:** Bun; tests use `import { describe, expect, test } from 'bun:test'`.
- **Score target:** ≥ 0.9, measured by `bun test:mutate:file src/byok-llm/blob-codec.ts`. Current recorded baseline: **0.6944**.
- **Do NOT manually edit `scripts/mutation/baseline.json` on the PR.** The ratchet is regression-only on PRs; CI's master `mutation-baseline` job re-seeds the raised floor via `seedMerge` after merge.
- **SPDX license headers** already present on the test file — do not remove or alter.
- **No comments** added to the test file.

---

## Interfaces

- **Consumes (the functions under test):** `decodeByokBlob(raw: unknown): ByokBlobV2` and `encodeByokBlob(blob: ByokBlobV2): ByokBlobV2` — exported from `src/byok-llm/blob-codec.ts`.
- **Produces:** strengthened test suite only. No new exports, no new files.

Reference: the relevant source contracts (verbatim from `src/byok-llm/blob-codec.ts`):

- `isV2`: `typeof value === 'object' && value !== null && 'v' in value && value.v === 2`.
- `isLegacy`: `typeof value === 'object' && value !== null && 'llm_apikey' in value`.
- `emptyVerification()`: `{ status: 'unverified', error: null, at: null, models: [], modelsFetchedAt: null }`.
- `fromLegacy`: provider `{ id: 'prov_legacy', label: 'Migrated BYOK provider', providerType: 'custom', baseUrl: legacy['llm_baseurl'] ?? '', apiKey: legacy['llm_apikey'] ?? '', verification: emptyVerification() }`; roles `{ main: { providerId: 'prov_legacy', model: legacy['main_model'] ?? '' }, small: <null|binding>, embedding: <null|binding> }`.
- `decodeByokBlob` default: `{ v: 2, providers: [], roles: { main: { providerId: '', model: '' }, small: null, embedding: null } }`.

---

## Task 1: Shared fixture + class A (non-object type guards) and class I (default blob)

**Files:**
- Modify: `tests/byok-llm/blob-codec.test.ts`

**Kills (Class A):** `isV2`/`isLegacy` `typeof value === 'object'` guard mutants — ids 8 (L27), 22 (L30). A primitive reaches both guards; the mutants drop the guard, `'v' in`/`'llm_apikey' in` execute on a primitive and throw, so the expected default return fails.
**Kills (Class I):** default-blob roles object/main-binding/both `''` literals — ids 67, 68, 69, 70 (L64).

- [ ] **Step 1: Add a shared full-legacy fixture and the class-A + class-I tests**

Add inside the `describe('byok blob codec', …)` block (before the first existing test is fine, or after the existing tests):

```ts
  const legacyFull = {
    llm_apikey: 'sk-x',
    llm_baseurl: 'https://x/v1',
    main_model: 'main-m',
    small_model: 'small-m',
    embedding_model: 'emb-m',
  }

  test('a non-object input falls through to the default blob (isV2/isLegacy type guards)', () => {
    expect(decodeByokBlob(42)).toEqual({
      v: 2,
      providers: [],
      roles: { main: { providerId: '', model: '' }, small: null, embedding: null },
    })
  })

  test('a non-v2, non-legacy object decodes to the exact default blob', () => {
    expect(decodeByokBlob({ foo: 'bar' })).toEqual({
      v: 2,
      providers: [],
      roles: { main: { providerId: '', model: '' }, small: null, embedding: null },
    })
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/byok-llm/blob-codec.test.ts
```
Expected: PASS (all). Characterization tests against correct code.

- [ ] **Step 3: Commit**

```bash
git add tests/byok-llm/blob-codec.test.ts
git commit -m "test: pin byok blob-codec default-blob and type-guard paths"
```

---

## Task 2: class B (version-value guard)

**Files:**
- Modify: `tests/byok-llm/blob-codec.test.ts`

**Kills (Class B):** `isV2` `value.v === 2` match mutant — id 14 (L27). `{ v: 1 }` is neither v2 nor legacy, so it decodes to the default (`v: 2`); the mutant drops the match and returns the raw `{ v: 1 }`.

- [ ] **Step 1: Add the version-rejection test**

Add inside `describe('byok blob codec', …)`:

```ts
  test('isV2 rejects an object whose v is not 2', () => {
    expect(decodeByokBlob({ v: 1 }).v).toBe(2)
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/byok-llm/blob-codec.test.ts
```
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add tests/byok-llm/blob-codec.test.ts
git commit -m "test: pin byok blob-codec v2 version-value guard"
```

---

## Task 3: class C (emptyVerification shape)

**Files:**
- Modify: `tests/byok-llm/blob-codec.test.ts`

**Kills (Class C):** the whole `emptyVerification` body — ArrowFunction (id 28), ObjectLiteral (id 29), status StringLiteral (id 30), models ArrayDeclaration (id 31) — all at L32–38.

- [ ] **Step 1: Add the verification-shape test**

Add inside `describe('byok blob codec', …)`:

```ts
  test('a legacy blob migrates emptyVerification verbatim', () => {
    expect(decodeByokBlob(legacyFull).providers[0]?.verification).toEqual({
      status: 'unverified',
      error: null,
      at: null,
      models: [],
      modelsFetchedAt: null,
    })
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/byok-llm/blob-codec.test.ts
```
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add tests/byok-llm/blob-codec.test.ts
git commit -m "test: pin byok blob-codec migrated verification shape"
```

---

## Task 4: class D (migrated provider literals)

**Files:**
- Modify: `tests/byok-llm/blob-codec.test.ts`

**Kills (Class D):** `fromLegacy` provider literals — `id` (id 33, L41), `label` (id 35, L44), `providerType` (id 36, L45).

- [ ] **Step 1: Add the provider-literals test**

Add inside `describe('byok blob codec', …)`:

```ts
  test('a legacy blob migrates the provider id, label, and providerType literals', () => {
    const provider = decodeByokBlob(legacyFull).providers[0]
    expect(provider?.id).toBe('prov_legacy')
    expect(provider?.label).toBe('Migrated BYOK provider')
    expect(provider?.providerType).toBe('custom')
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/byok-llm/blob-codec.test.ts
```
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add tests/byok-llm/blob-codec.test.ts
git commit -m "test: pin byok blob-codec migrated provider literals"
```

---

## Task 5: class E (baseUrl extraction, present + absent)

**Files:**
- Modify: `tests/byok-llm/blob-codec.test.ts`

**Kills (Class E):** `baseUrl` extraction — LogicalOperator `??` (id 37, L46), `'llm_baseurl'` key StringLiteral (id 38, L46), and the `''` fallback StringLiteral (id 39, L46 — currently NoCoverage).

- [ ] **Step 1: Add the baseUrl test (present + absent)**

Add inside `describe('byok blob codec', …)`:

```ts
  test('a legacy blob maps llm_baseurl to baseUrl and falls back to empty when absent', () => {
    expect(decodeByokBlob(legacyFull).providers[0]?.baseUrl).toBe('https://x/v1')
    expect(decodeByokBlob({ llm_apikey: 'k' }).providers[0]?.baseUrl).toBe('')
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/byok-llm/blob-codec.test.ts
```
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add tests/byok-llm/blob-codec.test.ts
git commit -m "test: pin byok blob-codec baseUrl extraction and fallback"
```

---

## Task 6: class F (apiKey nullish fallback)

**Files:**
- Modify: `tests/byok-llm/blob-codec.test.ts`

**Kills (Class F):** `apiKey` `''` fallback — id 42 (L47 — currently NoCoverage). `{ llm_apikey: null }` is structurally legacy (the key is present) and the nullish value takes the fallback.

- [ ] **Step 1: Add the apiKey-fallback test**

Add inside `describe('byok blob codec', …)`:

```ts
  test('a legacy blob falls back to an empty apiKey when the value is nullish', () => {
    expect(decodeByokBlob({ llm_apikey: null }).providers[0]?.apiKey).toBe('')
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/byok-llm/blob-codec.test.ts
```
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add tests/byok-llm/blob-codec.test.ts
git commit -m "test: pin byok blob-codec apiKey nullish fallback"
```

---

## Task 7: class G (embedding role binding)

**Files:**
- Modify: `tests/byok-llm/blob-codec.test.ts`

**Kills (Class G):** `embedding_model` binding — key StringLiteral (id 44, L51), `=== undefined` ConditionalExpression (id 49, L53), object literal (id 52, L53 — currently NoCoverage).

- [ ] **Step 1: Add the embedding-binding test**

Add inside `describe('byok blob codec', …)`:

```ts
  test('a legacy blob binds embedding_model onto the embedding role', () => {
    expect(decodeByokBlob(legacyFull).roles.embedding).toEqual({
      providerId: 'prov_legacy',
      model: 'emb-m',
    })
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/byok-llm/blob-codec.test.ts
```
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add tests/byok-llm/blob-codec.test.ts
git commit -m "test: pin byok blob-codec embedding role binding"
```

---

## Task 8: class H (main model fallback)

**Files:**
- Modify: `tests/byok-llm/blob-codec.test.ts`

**Kills (Class H):** `main_model` `''` fallback — id 59 (L57 — currently NoCoverage).

- [ ] **Step 1: Add the main-model-fallback test**

Add inside `describe('byok blob codec', …)`:

```ts
  test('a legacy blob without main_model falls back to an empty main model', () => {
    expect(decodeByokBlob({ llm_apikey: 'k' }).roles.main).toEqual({
      providerId: 'prov_legacy',
      model: '',
    })
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/byok-llm/blob-codec.test.ts
```
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add tests/byok-llm/blob-codec.test.ts
git commit -m "test: pin byok blob-codec main model fallback"
```

---

## Task 9: Final mutation verification and residual record

**Files:**
- No code changes. Verification only.

**Acceptance gate:** mutation score ≥ 0.9 for `src/byok-llm/blob-codec.ts`.

- [ ] **Step 1: Run the full mutation pass on the file**

Run:
```bash
bun test:mutate:file src/byok-llm/blob-codec.ts
```
Expected: per-file score **≥ 0.9**. Compare against the baseline recorded above (0.6944). The design targets all 22 non-killed mutants (→ 1.0); accept any verified-equivalent survivors per Step 2.

- [ ] **Step 2: Inspect surviving mutants and confirm accepted residuals**

Open the Stryker JSON report under `reports/paired/` for `src/byok-llm/blob-codec.ts` (`src__byok-llm__blob-codec.ts.stryker-report.json`; `files["src/byok-llm/blob-codec.ts"].mutants`, filter `status === "Survived"` or `"NoCoverage"`). Any remaining non-killed mutant must be observably equivalent for every reachable input. Pre-execution analysis predicts the residual set is **empty** — each class has a discriminating input; no mutant is equivalent. Record any survivor that does remain in the result JSON's `residuals` with a per-loc `why`.

If a **behavioural** mutant survives (anything that changes the decoded output for some input), do not accept it — add a targeted exact-equality test and re-run Step 1.

- [ ] **Step 3: Confirm no production code changed**

Run:
```bash
git diff --stat origin/master -- src/
```
Expected: empty (no `src/` diffs). All commits on this branch should touch only `tests/byok-llm/blob-codec.test.ts` (plus the committed spec/plan docs).

- [ ] **Step 4: Record the verified result**

No edit to `scripts/mutation/baseline.json` — CI's master `mutation-baseline` job re-seeds it after merge.

---

## Self-Review (completed)

**Spec coverage:** every gap class A–I from the spec's gap-analysis table maps to exactly one task:
- A + I → Task 1; B → Task 2; C → Task 3; D → Task 4; E → Task 5; F → Task 6; G → Task 7; H → Task 8; verification (≥ 0.9, no-src-diff, CI-seeded baseline) → Task 9. All 22 non-killed mutant ids (8, 14, 22, 28, 29, 30, 31, 33, 35, 36, 37, 38, 39, 42, 44, 49, 52, 59, 67, 68, 69, 70) are assigned to a task.

**Placeholder scan:** none — every code step contains the full test code; every command is exact with expected output.

**Exact-equality discipline:** every assertion is `toBe(...)` (scalars/strings) or `toEqual(...)` (full object shapes); no partial matchers.

**Value consistency:** all expected values verified against the source contracts in `src/byok-llm/blob-codec.ts` (L26–67) and the `Verification`/`LlmProviderAccount`/`RoleBinding` types in `src/llm-providers/types.ts`.
