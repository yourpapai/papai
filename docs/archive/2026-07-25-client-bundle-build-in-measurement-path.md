<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Client-bundle build in the measurement path — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local coverage/check measurement path build the client bundles first (guarded, no-op when present) so the 3 environmentally-failing `tests/debug/` tests pass and local coverage becomes trustworthy.

**Architecture:** A single presence-guarded build guard (`scripts/ensure-client-built.ts`) is invoked by the local measurement entry points (`scripts/check.sh`'s full-check path and the `test:coverage` npm script). It is DI-shaped so the decision logic is unit-testable without a slow real build. It no-ops when the bundles already exist (including CI, where `public/` arrives as a downloaded artifact) and runs `bun build:client` exactly once when they are missing. The debug suites keep their strict `beforeAll` fail-fast unchanged; one separable teardown-hygiene fix removes a confusing cascade error on the bundle-less path.

**Tech Stack:** Bun 1.3.13 test runner (`bun:test`), TypeScript (strict), Bash (`scripts/check.sh`), Node `fs`/`os`/`path`, `Bun.spawnSync`.

## Global Constraints

- Runtime **Bun 1.3.13**; strict TypeScript; **`.js` import extensions** in all TS import paths.
- BUSL-1.1 license header on every new/edited `.ts` (4-line `//` form) and this `.md` (HTML comment form) — else `bun check:full`'s `license-headers` check fails.
- No lint-disable / type-ignore comments. `oxc/no-optional-chaining`, `typescript/explicit-function-return-type`, and `typescript/no-explicit-any` are **error** rules — annotate every function return type, narrow `unknown`, and use explicit `if (x !== undefined)` guards, never `?.`.
- There is **no** `no-console` lint rule; scripts use `console.*` freely (matches `run-semgrep.ts`, `detect-duplicates.ts`). `console.error` is the guard's logging channel.
- Do **not** edit any refactor-frozen input: `tests/setup.ts`, `tests/mock-reset.ts`, `tests/utils/test-helpers.ts`, `tests/utils/logger-mock.ts`, `bunfig.toml`, `tests/stories/**`, `scripts/story/**`. (`scripts/check.sh` and `package.json` are **not** frozen — safe to edit.)
- Do **not** weaken the debug suites' `ensurePublicBuilt()` fail-fast.
- **No `ci.yml` change.** The `build` job → `public/` artifact → `check`/`stories` download flow already places bundles before any measurement; the guard is a no-op there. This is a deliberate non-change — do not "fix" CI.

---

## File Structure

- **Create** `scripts/ensure-client-built.ts` — the presence-guarded build guard. Exports `REQUIRED_BUNDLES`, `missingBundles`, `EnsureDeps`, `ensureClientBuilt`; runs `main()` when invoked directly.
- **Create** `tests/scripts/ensure-client-built.test.ts` — unit tests for `missingBundles` (temp dir) and `ensureClientBuilt` (fake deps).
- **Modify** `scripts/check.sh` — inject the guard into the full-check (`else`) branch, before the parallel fan-out, when the active `checks` array contains `test`.
- **Modify** `package.json` — make `test:coverage` run the guard first.
- **Modify** `tests/debug/debug-smoke.test.ts` — teardown hardening (Component 4): `let db: Database | undefined` + guarded `db.close()`.

---

## Task 1: The presence-guarded build guard (`scripts/ensure-client-built.ts`)

**Files:**
- Create: `scripts/ensure-client-built.ts`
- Test: `tests/scripts/ensure-client-built.test.ts`

**Interfaces:**
- Consumes: `PUBLIC_DIR` (string, absolute path to repo `public/`) from `scripts/build-client.js`.
- Produces:
  - `REQUIRED_BUNDLES: readonly string[]` — the 9 bundle basenames both debug suites assert on.
  - `missingBundles(publicDir: string, required: readonly string[]): string[]` — pure fs presence check; returns the subset of `required` not present in `publicDir` (in `required` order). A missing `publicDir` yields all of `required`.
  - `type EnsureDeps = { publicDir: string; required: readonly string[]; missing: (publicDir: string, required: readonly string[]) => string[]; build: () => void; log: (message: string) => void }`
  - `ensureClientBuilt(deps: EnsureDeps): 'present' | 'built'` — no-op+log+`'present'` when nothing missing; else log the missing set, call `deps.build()` once, return `'built'`.

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/ensure-client-built.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  REQUIRED_BUNDLES,
  ensureClientBuilt,
  missingBundles,
} from '../../scripts/ensure-client-built.js'
import type { EnsureDeps } from '../../scripts/ensure-client-built.js'

describe('missingBundles', () => {
  test('returns all required names when the dir does not exist', () => {
    const absent = path.join(os.tmpdir(), 'ensure-client-nope-does-not-exist')
    expect(missingBundles(absent, REQUIRED_BUNDLES)).toEqual([...REQUIRED_BUNDLES])
  })

  test('returns empty when every required file is present', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-client-all-'))
    try {
      for (const name of REQUIRED_BUNDLES) {
        fs.writeFileSync(path.join(dir, name), 'x')
      }
      expect(missingBundles(dir, REQUIRED_BUNDLES)).toEqual([])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  test('returns only the missing subset, in required order', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ensure-client-some-'))
    try {
      // Present: debug.js and admin.css; everything else missing.
      fs.writeFileSync(path.join(dir, 'debug.js'), 'x')
      fs.writeFileSync(path.join(dir, 'admin.css'), 'x')
      const expected = REQUIRED_BUNDLES.filter(
        (name) => name !== 'debug.js' && name !== 'admin.css',
      )
      expect(missingBundles(dir, REQUIRED_BUNDLES)).toEqual(expected)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('ensureClientBuilt', () => {
  function makeDeps(missingResult: string[]): {
    deps: EnsureDeps
    buildCalls: number
    logs: string[]
  } {
    const logs: string[] = []
    let buildCalls = 0
    const deps: EnsureDeps = {
      publicDir: '/fake/public',
      required: REQUIRED_BUNDLES,
      missing: () => missingResult,
      build: () => {
        buildCalls += 1
      },
      log: (message: string) => {
        logs.push(message)
      },
    }
    return {
      deps,
      get buildCalls(): number {
        return buildCalls
      },
      logs,
    }
  }

  test('returns "present" and does not build when nothing is missing', () => {
    const harness = makeDeps([])
    const result = ensureClientBuilt(harness.deps)
    expect(result).toBe('present')
    expect(harness.buildCalls).toBe(0)
  })

  test('returns "built", builds once, and logs the missing names', () => {
    const harness = makeDeps(['debug.js', 'settings.html'])
    const result = ensureClientBuilt(harness.deps)
    expect(result).toBe('built')
    expect(harness.buildCalls).toBe(1)
    expect(harness.logs.join('\n')).toContain('debug.js')
    expect(harness.logs.join('\n')).toContain('settings.html')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/ensure-client-built.test.ts`
Expected: FAIL — cannot resolve `../../scripts/ensure-client-built.js` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/ensure-client-built.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { PUBLIC_DIR } from './build-client.js'

/**
 * Bundle basenames both debug suites (`tests/debug/server.test.ts`,
 * `tests/debug/debug-smoke.test.ts`) assert on in their `ensurePublicBuilt()`
 * preconditions. Presence of all nine means the debug routes can be served.
 */
export const REQUIRED_BUNDLES: readonly string[] = [
  'debug.js',
  'debug.html',
  'debug.css',
  'admin.js',
  'admin.html',
  'admin.css',
  'settings.js',
  'settings.html',
  'settings.css',
]

/**
 * Pure presence check. Returns the subset of `required` not found in
 * `publicDir`, preserving `required` order. A missing `publicDir` yields the
 * whole `required` list (the common "never built" case), never a throw.
 */
export function missingBundles(publicDir: string, required: readonly string[]): string[] {
  return required.filter((name) => !fs.existsSync(path.join(publicDir, name)))
}

/**
 * Injected collaborators for `ensureClientBuilt`, so the decision logic is
 * unit-testable without running a real (slow) client build.
 */
export type EnsureDeps = {
  publicDir: string
  required: readonly string[]
  missing: (publicDir: string, required: readonly string[]) => string[]
  build: () => void
  log: (message: string) => void
}

/**
 * Ensure the client bundles exist. No-op (returns `'present'`) when all
 * required bundles are already present; otherwise logs the missing set, runs
 * `deps.build()` exactly once, and returns `'built'`.
 */
export function ensureClientBuilt(deps: EnsureDeps): 'present' | 'built' {
  const missing = deps.missing(deps.publicDir, deps.required)
  if (missing.length === 0) {
    deps.log(`Client bundles present in ${deps.publicDir}, skipping build`)
    return 'present'
  }
  deps.log(`Missing client bundles (${missing.join(', ')}); running bun build:client`)
  deps.build()
  return 'built'
}

/**
 * Wire real collaborators and run the guard. `build` spawns `bun build:client`
 * synchronously with inherited stdio; a non-zero exit throws so a broken client
 * build fails the measurement run loudly instead of proceeding to a misleading
 * "3 failing tests" state.
 */
function main(): void {
  ensureClientBuilt({
    publicDir: PUBLIC_DIR,
    required: REQUIRED_BUNDLES,
    missing: missingBundles,
    build: (): void => {
      const proc = Bun.spawnSync(['bun', 'scripts/build-client.ts'], {
        cwd: path.resolve(import.meta.dir, '..'),
        stdio: ['ignore', 'inherit', 'inherit'],
      })
      if (proc.exitCode !== 0) {
        throw new Error(`bun build:client failed with exit code ${proc.exitCode}`)
      }
    },
    log: (message: string): void => {
      console.error(message)
    },
  })
}

if (import.meta.main) {
  main()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/ensure-client-built.test.ts`
Expected: PASS — 5 tests (3 `missingBundles`, 2 `ensureClientBuilt`).

- [ ] **Step 5: Verify the real guard against present + absent bundles**

Run (bundles currently absent → should build once):
`bun scripts/ensure-client-built.ts`
Expected: prints `Missing client bundles (...)` then a `bun build:client` run; exits 0; `public/debug.js` now exists.

Run again (now present → should no-op):
`bun scripts/ensure-client-built.ts`
Expected: prints `Client bundles present in .../public, skipping build`; no build; exits 0.

- [ ] **Step 6: Lint + typecheck the new files**

Run: `bun run lint scripts/ensure-client-built.ts tests/scripts/ensure-client-built.test.ts && bun run typecheck`
Expected: PASS (no explicit-return-type, no-optional-chaining, or import/extension violations).

- [ ] **Step 7: Commit**

```bash
git add scripts/ensure-client-built.ts tests/scripts/ensure-client-built.test.ts
git commit -m "feat(scripts): add presence-guarded client-bundle build guard"
```

---

## Task 2: Wire the guard into the measurement path (`check.sh` + `package.json`)

**Files:**
- Modify: `scripts/check.sh:308` (after the `SKIP_TESTS` filter block, before `failed=0`)
- Modify: `package.json` (the `test:coverage` script)

**Interfaces:**
- Consumes: `scripts/ensure-client-built.ts` from Task 1 (run via `bun scripts/ensure-client-built.ts`).
- Produces: nothing importable — behavioral wiring only.

- [ ] **Step 1: Add the guard to `scripts/check.sh`**

The full-check (`else`) branch finalizes the `checks` array at line 307 (`checks=("${filtered_checks[@]}")`) inside the `if [ "$SKIP_TESTS" = true ]` block, which closes at line 308 (`fi`). Line 309 is `failed=0`. Insert the guard between them.

Find (lines 307–309):

```bash
    checks=("${filtered_checks[@]}")
  fi
  failed=0
```

Replace with:

```bash
    checks=("${filtered_checks[@]}")
  fi

  # Build client bundles before the parallel fan-out when the `test` check is
  # active and the bundles are missing. The `tests/debug/` suites fail fast in
  # beforeAll without them. The guard script no-ops when bundles already exist
  # (repeat local runs, and CI where public/ arrives as a downloaded artifact),
  # so this is cheap except on the first bundle-less run.
  for check in "${checks[@]}"; do
    if [ "$check" = "test" ]; then
      bun scripts/ensure-client-built.ts || exit 1
      break
    fi
  done

  failed=0
```

Note: the guard is inside the `else` branch only. The `STAGED_MODE` branch runs `checks=("lint" "typecheck" "format:check" "license-headers")` and never includes `test`, so it needs no guard. In `--skip-tests` runs the `test` check is already filtered out, so the loop finds nothing and skips the build.

- [ ] **Step 2: Verify `check.sh` still parses**

Run: `bash -n scripts/check.sh`
Expected: no output, exit 0 (syntax valid).

- [ ] **Step 3: Update `package.json` `test:coverage`**

Find:

```json
    "test:coverage": "bun test --coverage",
```

Replace with:

```json
    "test:coverage": "bun scripts/ensure-client-built.ts && bun test --coverage",
```

- [ ] **Step 4: Verify the debug suites now pass through the measurement path**

First remove the bundles to prove the guard rebuilds them:
`rm -f public/debug.* public/admin.* public/settings.*`

Then run:
`bun test:coverage`
Expected: the guard prints a `Missing client bundles (...)` build line, `bun build:client` runs, then the full coverage suite runs with **0 failures in `tests/debug/`** (`debug-smoke.test.ts` and `server.test.ts` both pass). Coverage output is printed.

- [ ] **Step 5: Verify the guard no-ops on a second run**

Run: `bun test:coverage` again.
Expected: guard prints `Client bundles present ... skipping build` (no rebuild); suite still green.

- [ ] **Step 6: Commit**

```bash
git add scripts/check.sh package.json
git commit -m "build(check): build client bundles in the coverage/check measurement path"
```

---

## Task 3: Teardown hardening for `debug-smoke.test.ts` (Component 4)

**Files:**
- Modify: `tests/debug/debug-smoke.test.ts:38` (the `db` declaration) and `tests/debug/debug-smoke.test.ts:56` (the `afterAll` `db.close()`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: nothing importable — test-file hygiene only.

**Rationale:** `beforeAll` assigns `db = new Database(':memory:')` (line 44) only after `ensurePublicBuilt()`. On a bundle-less ad-hoc `bun test` run (outside the measurement path), `ensurePublicBuilt()` throws first, so `db` is never assigned and `afterAll`'s `db.close()` throws a second, confusing `TypeError`. This makes the declaration `undefined`-typed and guards the close. With bundles present (the measurement path) there is no behavior change. Use an explicit `if (db !== undefined)` guard, **not** `?.` — `oxc/no-optional-chaining` is an error rule.

- [ ] **Step 1: Confirm the current failing behavior (bundle-less cascade)**

Run (with bundles removed): `rm -f public/debug.* && bun test tests/debug/debug-smoke.test.ts`
Expected: TWO errors — the `ensurePublicBuilt()` "Missing client bundles" failure **and** a cascade `TypeError: undefined is not an object (evaluating 'db.close')` from `afterAll`. This is the state Task 3 collapses to one clear message. (Restore bundles afterward with `bun scripts/ensure-client-built.ts`.)

- [ ] **Step 2: Widen the `db` declaration type**

In `tests/debug/debug-smoke.test.ts`, find (line 38):

```typescript
  let db: Database
```

Replace with:

```typescript
  let db: Database | undefined
```

- [ ] **Step 3: Guard the teardown close**

In the same file, find (line 56, inside `afterAll`):

```typescript
    db.close()
```

Replace with:

```typescript
    if (db !== undefined) db.close()
```

- [ ] **Step 4: Verify the cascade is gone on the bundle-less path**

Run (with bundles removed): `rm -f public/debug.* && bun test tests/debug/debug-smoke.test.ts`
Expected: only the single `ensurePublicBuilt()` "Missing client bundles" failure remains — **no** `db.close` `TypeError`. Then restore: `bun scripts/ensure-client-built.ts`.

- [ ] **Step 5: Verify no regression with bundles present**

Run: `bun test tests/debug/debug-smoke.test.ts`
Expected: PASS (bundles present → `beforeAll` assigns `db`, `afterAll` closes it).

- [ ] **Step 6: Lint the edited file**

Run: `bun run lint tests/debug/debug-smoke.test.ts`
Expected: PASS (no optional-chaining rule triggered by the explicit `!== undefined` guard).

- [ ] **Step 7: Commit**

```bash
git add tests/debug/debug-smoke.test.ts
git commit -m "test(debug): guard debug-smoke teardown against unassigned db"
```

---

## Final verification (after all tasks)

- [ ] Remove bundles, then run the full check to confirm the whole measurement path is green end-to-end:
  `rm -f public/debug.* public/admin.* public/settings.* && bun check:full`
  Expected: the `test` check builds bundles via the guard, all checks pass, no `tests/debug/` failures.

---

## Self-Review

**Spec coverage:**
- Component 1 (`scripts/ensure-client-built.ts`: `REQUIRED_BUNDLES`, `missingBundles`, `EnsureDeps`, `ensureClientBuilt`, `main`, presence-only) → Task 1. ✔
- Component 2 wiring (`check.sh` guard before fan-out gated on `test` in `checks`; `package.json` `test:coverage`; **no** `ci.yml` change) → Task 2 + Global Constraints. ✔
- Component 3 (debug suites stay strict; `ensurePublicBuilt()` untouched) → honored by omission; no task edits `ensurePublicBuilt`, and Global Constraints forbids weakening it. ✔
- Component 4 (teardown hardening: `let db: Database | undefined`, `if (db !== undefined) db.close()`) → Task 3. ✔
- Testing (unit `missingBundles` temp-dir none/some/all; `ensureClientBuilt` fake deps present/missing; real build exercised by running check.sh/test:coverage) → Task 1 Steps 1/4/5, Task 2 Step 4. ✔
- Error handling (build throws on non-zero exit; missing dir = all missing, no throw) → `main()` build spawn + `missingBundles` filter; covered by Task 1 test "all required when dir does not exist". ✔

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". All code blocks are complete and self-contained. ✔

**Type consistency:** `REQUIRED_BUNDLES`, `missingBundles(publicDir, required)`, `EnsureDeps` (fields `publicDir`/`required`/`missing`/`build`/`log`), and `ensureClientBuilt(deps): 'present' | 'built'` are named and typed identically across the implementation (Task 1 Step 3) and the test (Task 1 Step 1). `PUBLIC_DIR` import matches the existing export in `scripts/build-client.ts:26`. ✔
