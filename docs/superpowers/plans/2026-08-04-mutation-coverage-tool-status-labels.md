<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Mutation Coverage Strengthening — `tool-status-labels` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lift the mutation score of `src/live-status/tool-status-labels.ts` from 0.46 to ≥ 0.95 by adding exact-equality characterization tests that kill the surviving mutant classes.

**Architecture:** Test-only. No production source changes. Each task adds a small set of `toBe(...)`-equality tests to the existing `tests/live-status/tool-status-labels.test.ts` describe block, mapping one-to-one onto the surviving-mutant classes (A–I) identified in the spec's gap analysis. These are characterization tests — they pass immediately against correct code; the verification gate is the mutation score, not a red→green transition.

**Tech Stack:** Bun runtime, `bun:test` (`describe`/`test`/`expect`), Stryker via the repo's paired runner (`bun test:mutate:file`).

## Global Constraints

- **MUST NOT modify any file under `src/`.** The implementation under test is correct; this plan strengthens tests only.
- **Only file modified:** `tests/live-status/tool-status-labels.test.ts` (extend the existing `describe('formatToolStatus', …)` block and, where noted, the `describe('reminder/alert live-status labels', …)` block).
- **Every new assertion uses exact equality (`toBe`)** — no `startsWith`, no `endsWith`, no `toContain` for any string whose full value is knowable. This is the entire lever; a partial matcher re-opens the leak it was meant to close.
- **Runtime:** Bun; tests use `import { describe, expect, test } from 'bun:test'`.
- **Score target:** ≥ 0.95, measured by `bun test:mutate:file src/live-status/tool-status-labels.ts`. Current recorded baseline: **0.46**.
- **Do NOT manually edit `scripts/mutation/baseline.json` on the PR.** The ratchet is regression-only on PRs; CI's master `mutation-baseline` job re-seeds the raised floor via `seedMerge` after merge.
- **SPDX license headers** already present on the test file — do not remove or alter.
- **Emoji are significant bytes.** Copy emoji verbatim from the source REGISTRY (e.g. `🗑️` and `✏️` carry variation selectors). Do not re-type them.

---

## Interfaces

- **Consumes (the function under test):** `formatToolStatus(toolName: string, input: unknown): string` — exported from `src/live-status/tool-status-labels.ts`. Returns the full status line including a trailing `…`.
- **Produces:** strengthened test suite only. No new exports, no new files.

Reference: the relevant source contracts (verbatim from `src/live-status/tool-status-labels.ts`):

- `sanitizeArg`: `collapsed = value.replace(/\s+/gu, ' ').trim()`; `collapsed.length > MAX_ARG_LENGTH ? collapsed.slice(0, MAX_ARG_LENGTH) + '…' : collapsed`; `MAX_ARG_LENGTH = 40`.
- `getStringField(input, keys)`: returns the **first** key whose value is `typeof === 'string'` **and** `value.trim() !== ''`; else `undefined`.
- `hostOf`: `new URL(url).host` (keeps the port), fall back to raw `url` on throw.
- `asRecord`: returns `undefined` when `typeof input !== 'object'`, `=== null`, or `Array.isArray`.
- `humanizeToolName`: if name `includes('__')` → `slice(lastIndexOf('__') + 2)`, else strip `^(?:mcp|plugin)_`; then `replace(/[_-]+/gu, ' ')`, `.trim()`, `.toLowerCase()`.
- `formatToolStatus`: unmapped tool → `⚙️ Running ${humanizeToolName(toolName)}…`; mapped tool with no/empty arg → `${emoji} ${label}…`; else `middle = quote === false ? \` ${arg}\` : \` : "${arg}"\``, returns `${emoji} ${label}${middle}…`.

---

## Task 1: Capture baseline score and replace the loose truncation test (Class A)

**Files:**
- Modify: `tests/live-status/tool-status-labels.test.ts` (replace the test at current lines 31-36)

**Kills (Class A):** `MAX_ARG_LENGTH` constant (40↔39/41), `>` ↔ `>=`, `slice(0, MAX_ARG_LENGTH)` endpoint mutants, ellipsis char mutants, `replace(/\s+/gu, ' ')` mutants, `.trim()` mutants.

- [ ] **Step 1: Capture the "before" mutation score**

Run:
```bash
bun test:mutate:file src/live-status/tool-status-labels.ts
```
Expected: completes and prints a per-file mutation score line. Record the number (expected ~0.46). This is the baseline the rest of the plan improves on.

- [ ] **Step 2: Replace the loose truncation test with three exact-equality tests**

In `tests/live-status/tool-status-labels.test.ts`, remove this existing test (the two loose `expect(...startsWith/endsWith)` assertions):

```ts
  test('collapses whitespace and truncates long arguments to 40 chars', () => {
    const long = 'a'.repeat(50)
    const result = formatToolStatus('search_memory', { query: `  multi\nline   ${long}` })
    expect(result.startsWith('🔍 Searching memory: "multi line ')).toBe(true)
    expect(result.endsWith('…"…')).toBe(true)
  })
```

Replace it with these three tests (add them inside the `describe('formatToolStatus', …)` block, where the old test was):

```ts
  test('collapses whitespace and truncates long arguments to 40 chars', () => {
    const result = formatToolStatus('search_memory', { query: `  multi\nline   ${'a'.repeat(50)}` })
    expect(result).toBe(`🔍 Searching memory: "multi line ${'a'.repeat(29)}…"…`)
  })

  test('a 40-char argument is not truncated (boundary: length > MAX_ARG_LENGTH is false at 40)', () => {
    expect(formatToolStatus('search_memory', { query: 'a'.repeat(40) })).toBe(
      `🔍 Searching memory: "${'a'.repeat(40)}"…`,
    )
  })

  test('a 41-char argument truncates to 40 chars plus ellipsis (boundary)', () => {
    expect(formatToolStatus('search_memory', { query: 'a'.repeat(41) })).toBe(
      `🔍 Searching memory: "${'a'.repeat(40)}…"…`,
    )
  })
```

- [ ] **Step 3: Run the test file — verify green**

Run:
```bash
bun test tests/live-status/tool-status-labels.test.ts
```
Expected: PASS (all tests, including the three new ones). These are characterization tests against correct behavior, so they pass immediately.

- [ ] **Step 4: Commit**

```bash
git add tests/live-status/tool-status-labels.test.ts
git commit -m "test: pin tool-status-labels truncation boundary with exact equality"
```

---

## Task 2: `getStringField` precision (Classes B, C, G)

**Files:**
- Modify: `tests/live-status/tool-status-labels.test.ts` (add tests inside `describe('formatToolStatus', …)`)

**Kills (Class B):** `getStringField` first-key-wins loop mutants (e.g. returning the last key, or skipping the loop order).
**Kills (Class C):** the `typeof value === 'string'` guard and the `value.trim() !== ''` empty-skip inside the loop.
**Kills (Class G):** whitespace-only arg reaching the no-arg label path (via `getStringField`'s trim check).

- [ ] **Step 1: Add four precedence/skip tests**

Add inside `describe('formatToolStatus', …)`:

```ts
  test('getStringField prefers the first listed key when both are present', () => {
    expect(formatToolStatus('create_task', { title: 'A', name: 'B' })).toBe('📝 Creating task: "A"…')
  })

  test('getStringField skips an empty first key and falls back to the next', () => {
    expect(formatToolStatus('create_task', { title: '', name: 'B' })).toBe('📝 Creating task: "B"…')
  })

  test('getStringField skips a non-string first key and falls back to the next', () => {
    expect(formatToolStatus('create_task', { title: 5, name: 'B' })).toBe('📝 Creating task: "B"…')
  })

  test('a whitespace-only argument is omitted like a missing argument', () => {
    expect(formatToolStatus('search_memory', { query: '   ' })).toBe('🔍 Searching memory…')
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/live-status/tool-status-labels.test.ts
```
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add tests/live-status/tool-status-labels.test.ts
git commit -m "test: pin getStringField key precedence and skip rules"
```

---

## Task 3: `hostOf` and `asRecord` precision (Classes D, E)

**Files:**
- Modify: `tests/live-status/tool-status-labels.test.ts` (add tests inside `describe('formatToolStatus', …)`)

**Kills (Class D):** `.host` ↔ `.hostname` (port preservation).
**Kills (Class E):** the three `asRecord` guards — `typeof input !== 'object'`, `input === null`, `Array.isArray(input)`.

- [ ] **Step 1: Add the port-preservation test**

Add inside `describe('formatToolStatus', …)`:

```ts
  test('web_fetch keeps the port in the host (host, not hostname)', () => {
    expect(formatToolStatus('web_fetch', { url: 'https://host.example:8080/x' })).toBe(
      '🌐 Fetching host.example:8080…',
    )
  })
```

- [ ] **Step 2: Add the non-record rejection tests**

Add inside `describe('formatToolStatus', …)` (the existing `'never returns the argument when input is not a record'` test only covers the string case; these cover array, null, and number):

```ts
  test('asRecord rejects an array and yields the no-arg label', () => {
    expect(formatToolStatus('search_memory', ['query'])).toBe('🔍 Searching memory…')
  })

  test('asRecord rejects null and yields the no-arg label', () => {
    expect(formatToolStatus('search_memory', null)).toBe('🔍 Searching memory…')
  })

  test('asRecord rejects a number and yields the no-arg label', () => {
    expect(formatToolStatus('search_memory', 42)).toBe('🔍 Searching memory…')
  })
```

- [ ] **Step 3: Run the test file — verify green**

Run:
```bash
bun test tests/live-status/tool-status-labels.test.ts
```
Expected: PASS (all).

- [ ] **Step 4: Commit**

```bash
git add tests/live-status/tool-status-labels.test.ts
git commit -m "test: pin hostOf port preservation and asRecord rejection guards"
```

---

## Task 4: no-arg tools and registry pinning (Classes F, I)

**Files:**
- Modify: `tests/live-status/tool-status-labels.test.ts` (add tests inside `describe('formatToolStatus', …)`)

**Kills (Class F):** the `entry.arg === undefined ? undefined : entry.arg(input)` branch — tools whose REGISTRY entry has no `arg` extractor.
**Kills (Class I):** registry table-cell mutants (emoji/label/quote) for under-pinned entries (`fetch_chat_link`, `update_task`, `delete_task`, `list_memory`).

- [ ] **Step 1: Add no-arg-tool and registry-pinning tests**

Add inside `describe('formatToolStatus', …)`:

```ts
  test('a mapped tool with no arg extractor renders only the emoji and label', () => {
    expect(formatToolStatus('list_memory', {})).toBe('🧠 Recalling memory…')
  })

  test('fetch_chat_link renders the quote:false host form (second hostOf entry)', () => {
    expect(formatToolStatus('fetch_chat_link', { url: 'https://example.com/x' })).toBe(
      '🔗 Reading link example.com…',
    )
  })

  test('update_task renders the updating label with no arg', () => {
    expect(formatToolStatus('update_task', {})).toBe('✏️ Updating task…')
  })

  test('delete_task renders the deleting label with no arg', () => {
    expect(formatToolStatus('delete_task', {})).toBe('🗑️ Deleting task…')
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/live-status/tool-status-labels.test.ts
```
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add tests/live-status/tool-status-labels.test.ts
git commit -m "test: pin no-arg tool path and fetch_chat_link/update_task/delete_task labels"
```

---

## Task 5: `humanizeToolName` edge cases (Class H)

**Files:**
- Modify: `tests/live-status/tool-status-labels.test.ts` (add tests inside `describe('formatToolStatus', …)`)

**Kills (Class H):** `replace(/[_-]+/gu, ' ')` hyphen handling; `.toLowerCase()`; `lastIndexOf` ↔ `indexOf` (multi-`__` names); the `^(?:mcp|plugin)_` prefix strip on names without `__`.

- [ ] **Step 1: Add four humanize edge-case tests**

Add inside `describe('formatToolStatus', …)`:

```ts
  test('humanizeToolName converts hyphens to spaces', () => {
    expect(formatToolStatus('mcp_s__audio-transcribe', {})).toBe('⚙️ Running audio transcribe…')
  })

  test('humanizeToolName lowercases the segments', () => {
    expect(formatToolStatus('mcp_s__CamelCase', {})).toBe('⚙️ Running camelcase…')
  })

  test('humanizeToolName uses the last __ segment (lastIndexOf, not indexOf)', () => {
    expect(formatToolStatus('plugin_a__b__c', {})).toBe('⚙️ Running c…')
  })

  test('humanizeToolName strips a leading mcp_ prefix when there is no __ segment', () => {
    expect(formatToolStatus('mcp_standalone', {})).toBe('⚙️ Running standalone…')
  })
```

- [ ] **Step 2: Run the test file — verify green**

Run:
```bash
bun test tests/live-status/tool-status-labels.test.ts
```
Expected: PASS (all).

- [ ] **Step 3: Commit**

```bash
git add tests/live-status/tool-status-labels.test.ts
git commit -m "test: pin humanizeToolName hyphen, case, multi-__ and prefix-strip behavior"
```

---

## Task 6: Final mutation verification and residual record

**Files:**
- No code changes. Verification only.

**Acceptance gate:** mutation score ≥ 0.95 for `src/live-status/tool-status-labels.ts`.

- [ ] **Step 1: Run the full mutation pass on the file**

Run:
```bash
bun test:mutate:file src/live-status/tool-status-labels.ts
```
Expected: per-file score **≥ 0.95**. Compare against the number recorded in Task 1 Step 1 (was ~0.46).

- [ ] **Step 2: Inspect surviving mutants and confirm they are accepted residuals**

Open the Stryker JSON report under `reports/paired/` for `src/live-status/tool-status-labels.ts`. Any surviving mutant must be in the accepted-residual list:

- `asRecord`'s `Object.fromEntries(Object.entries(input))` round-trip — behaviorally identity for plain records (equivalent mutant, unkillable without contorting correct code).

If a **behavioural** mutant survives (anything that changes the rendered output for some input), do not accept it — add a targeted exact-equality test in the relevant task above and re-run Step 1.

- [ ] **Step 3: Confirm no production code changed**

Run:
```bash
git diff --stat origin/master -- src/
```
Expected: empty (no `src/` diffs). All commits on this branch should touch only `tests/live-status/tool-status-labels.test.ts` (plus the committed spec/plan docs).

- [ ] **Step 4: Record the verified result**

Append a one-line summary to the commit message of the final commit on this branch (or add a short note to the spec's "Status" line if the team prefers), e.g.:

```
test: record tool-status-labels mutation score <X.XX> (was 0.46); only residual is asRecord identity round-trip
```

No edit to `scripts/mutation/baseline.json` — CI's master `mutation-baseline` job re-seeds it after merge.

---

## Self-Review (completed)

**Spec coverage:** every gap class A–I from the spec's gap-analysis table maps to at least one task:
- A → Task 1; B, C, G → Task 2; D, E → Task 3; F, I → Task 4; H → Task 5. Verification (≥ 0.95, no-src-diff, CI-seeded baseline) → Task 6. The accepted residual (`asRecord` identity round-trip) → Task 6 Step 2.

**Placeholder scan:** none — every code step contains the full test code; every command is exact with expected output.

**Type/value consistency:** all expected strings verified against the source contracts and spot-checked with a Node REPL run (`humanizeToolName` outputs and `slice(0, 40)` truncation math). Emoji copied verbatim from the REGISTRY, including `🗑️` / `✏️` / `⚙️` variation selectors.
