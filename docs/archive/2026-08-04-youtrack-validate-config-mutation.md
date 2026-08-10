<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# YouTrack `validate-config.ts` Mutation Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise the paired mutation score of `plugins/task-provider-youtrack/validate-config.ts` from 0 (0 killed / 0 survived / 32 no-coverage, 32 mutants) to ≥ 0.94 by adding a pure unit-test companion file. No source changes.

**Architecture:** One new test file, `tests/plugins/task-provider-youtrack/validate-config.test.ts` (standard companion mirror path — auto-discovered by the paired runner's test-resolver, no `overrides.json` edit). Structure mirrors the proven kaneo twin (`tests/plugins/task-provider-kaneo/validate-config.test.ts`, baseline 0.969) with one added whitespace-only case that kills the `.trim()`-removal mutant the twin leaves alive. Tests are characterization tests on existing correct code: they PASS immediately; the mutation run in Task 2 is the effectiveness oracle.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript (strict), Stryker via `bun test:mutate:file`. No fetch mocks, no DI, no store.

**Spec:** `docs/superpowers/specs/2026-08-04-youtrack-validate-config-mutation-design.md` (approved).

## Global Constraints

- Strict TypeScript; use `.js` extension in relative import paths.
- Test files must start with the SPDX license header block (enforced by the `license-headers` commit hook):
  ```ts
  // SPDX-License-Identifier: BUSL-1.1
  // Copyright (c) 2026 Dmitriy Lazarev
  // Use of this software is governed by the Business Source License 1.1.
  // See LICENSE in the project root for details.
  ```
- No comments in code beyond the license header; no lint-disable or type-ignore comments (hook-blocked).
- Assertions use `toEqual` on the full result object — this kills every `ObjectLiteral`, `BooleanLiteral`, and `StringLiteral` return mutant outright.
- Do NOT edit `scripts/mutation/baseline.json` — the CI `mutation-baseline` job re-seeds the floor on master (per-key max). The PR gate is regression-only.
- Do NOT modify `plugins/task-provider-youtrack/validate-config.ts` or any other source file.
- Commit message style follows recent history: `test(youtrack): ...` / `docs: ...` (see `git log --oneline`).

## File Structure

- Create: `tests/plugins/task-provider-youtrack/validate-config.test.ts` — the only code artifact. Holds the single `validateConfig` describe block with all seven cases from the spec.

Reference files (read-only):
- `plugins/task-provider-youtrack/validate-config.ts` — unit under test (24 lines). Sole export: `validateConfig(config: Record<string, string>): Promise<{ ok: true } | { ok: false; reason: string }>`.
- `tests/plugins/task-provider-kaneo/validate-config.test.ts` — the twin being mirrored (same describe name, same case ordering).

---

### Task 1: Companion test file with all seven validation cases

**Files:**
- Create: `tests/plugins/task-provider-youtrack/validate-config.test.ts`
- Test: `tests/plugins/task-provider-youtrack/validate-config.test.ts`

**Interfaces:**
- Consumes: `validateConfig(config: Record<string, string>): Promise<{ ok: true } | { ok: false; reason: string }>` from `plugins/task-provider-youtrack/validate-config.js`.
- Produces: the complete companion test set consumed by the paired mutation runner in Task 2 via the mirror-path resolver (`plugins/task-provider-youtrack/validate-config.ts` → `tests/plugins/task-provider-youtrack/validate-config.test.ts`).

- [ ] **Step 1: Create the test file**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { validateConfig } from '../../../plugins/task-provider-youtrack/validate-config.js'

describe('validateConfig', () => {
  test('valid https baseUrl returns ok: true', async () => {
    const result = await validateConfig({ baseUrl: 'https://youtrack.example' })
    expect(result).toEqual({ ok: true })
  })

  test('valid http localhost baseUrl returns ok: true', async () => {
    const result = await validateConfig({ baseUrl: 'http://localhost:3000' })
    expect(result).toEqual({ ok: true })
  })

  test('missing baseUrl returns ok: false with baseUrl reason', async () => {
    const result = await validateConfig({})
    expect(result).toEqual({ ok: false, reason: 'baseUrl is required' })
  })

  test('empty baseUrl returns ok: false with baseUrl reason', async () => {
    const result = await validateConfig({ baseUrl: '' })
    expect(result).toEqual({ ok: false, reason: 'baseUrl is required' })
  })

  test('whitespace-only baseUrl returns ok: false with baseUrl reason', async () => {
    const result = await validateConfig({ baseUrl: '   ' })
    expect(result).toEqual({ ok: false, reason: 'baseUrl is required' })
  })

  test('malformed baseUrl returns ok: false', async () => {
    const result = await validateConfig({ baseUrl: 'not a url' })
    expect(result).toEqual({ ok: false, reason: 'baseUrl must be a valid URL' })
  })

  test('non-http protocol returns ok: false with http reason', async () => {
    const result = await validateConfig({ baseUrl: 'ftp://host' })
    expect(result).toEqual({ ok: false, reason: 'baseUrl must use http or https' })
  })
})
```

Mutant-kill notes (from the spec's inventory): the whitespace-only case kills the L12 `MethodExpression` trim-removal (without `.trim()`, `'   '` has length 3, falls through to `new URL('   ')` → throws → wrong reason). The http-localhost case kills the `'http:'` StringLiteral and its `!==`→`===` flip, which the https case cannot distinguish. The missing-key case kills the OptionalChaining mutant (`.trim()` on `undefined` throws) and the `??`→`&&` / fallback-literal mutants (both reroute to a wrong reason or a throw).

- [ ] **Step 2: Run the new tests**

Run: `bun test tests/plugins/task-provider-youtrack/validate-config.test.ts`
Expected: PASS — 7 tests, 0 failures. (Characterization tests on existing correct code; they pass immediately by design.)

- [ ] **Step 3: Verify typecheck and lint**

Run: `bun run typecheck && bun run lint`
Expected: both exit 0, no errors in the new file.

- [ ] **Step 4: Commit**

```bash
git add tests/plugins/task-provider-youtrack/validate-config.test.ts
git commit -m "test(youtrack): cover validate-config baseUrl validation"
```

---

### Task 2: Paired mutation measurement, survivor triage, full verification

**Files:**
- Modify: `tests/plugins/task-provider-youtrack/validate-config.test.ts` (only if triage requires an additional kill test)
- Modify: `docs/superpowers/specs/2026-08-04-youtrack-validate-config-mutation-design.md` (only to sync the achieved score, per repo precedent `cb7481cad`)
- Test: `tests/plugins/task-provider-youtrack/validate-config.test.ts`

**Interfaces:**
- Consumes: the companion test file from Task 1; `scripts/mutation/paired-run.ts` CLI (`bun test:mutate:file`).
- Produces: the achieved paired score recorded in the spec; the terminal state other cycles compare against. `scripts/mutation/baseline.json` is NOT edited (CI master seed re-applies the floor per-key max).

- [ ] **Step 1: Run the official paired measurement**

Run: `bun test:mutate:file plugins/task-provider-youtrack/validate-config.ts 2>&1 | tail -5`
Expected: `killed` = 32 of 32, `noCoverage` = 0, score ≥ 0.94. Pre-analysis found no equivalent-mutant class — every mutant has a discriminating case — but the spec's floor tolerates one justified survivor.

- [ ] **Step 2: Triage any unexpected survivor**

If `killed` = 32 and score ≥ 0.94: proceed to Step 3.

Otherwise, for each surviving or no-coverage mutant, read its mutator/line from `reports/paired/plugins__task-provider-youtrack__validate-config.ts.stryker-report.json`:

Run: `bun -e "const r = await Bun.file('reports/paired/plugins__task-provider-youtrack__validate-config.ts.stryker-report.json').json(); for (const m of r.files['plugins/task-provider-youtrack/validate-config.ts'].mutants.filter((m) => m.status === 'Survived' || m.status === 'NoCoverage')) console.log(m.status, m.mutatorName, 'L' + m.location.start.line, JSON.stringify(m.replacement ?? ''))"`

Add a focused kill test to `tests/plugins/task-provider-youtrack/validate-config.test.ts` inside the existing describe block (or justify the mutant as equivalent by documenting it in the spec's `### Expected outcome` section). Re-run Step 1 until the score is ≥ 0.94 with only justified survivors.

- [ ] **Step 3: Sync the spec with the achieved score**

Update the `### Expected outcome` section of `docs/superpowers/specs/2026-08-04-youtrack-validate-config-mutation-design.md`: append an achieved line after the prediction paragraph, e.g. `Achieved (2026-08-04): killed=NN survived=SS noCoverage=0, score=0.NN.` Keep the prediction text intact above it.

- [ ] **Step 4: Full regression verification**

Run: `bun test && bun run typecheck && bun run lint`
Expected: full suite green (the new file is additive; no existing suite shares state with it — no fetch mocks, no module mocks, no globals), typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add tests/plugins/task-provider-youtrack/validate-config.test.ts docs/superpowers/specs/2026-08-04-youtrack-validate-config-mutation-design.md
git commit -m "docs: sync spec with achieved validate-config mutation score"
```

If Step 2 added no test changes and Step 3's spec edit is the only change, stage just the spec file.
