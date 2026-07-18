<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Enable Functional-TypeScript Lint Rules By Default — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the three `papai-policy` functional-TypeScript rules (`no-optional-type-syntax`, `no-default-value-syntax`, `no-fallback-expressions`) from the advisory `.oxlintrc.agent-strict.json` into the default `.oxlintrc.json` so they run on every `bun lint`, then gradually fix all existing violations until the codebase is fully clean.

**Architecture:** The default config enables all three rules at `"error"` globally but carries a generated **exemption baseline** (`overrides` blocks that set the three rules to `"off"` for currently-dirty paths) so `bun lint` stays green from day one. Burndown removes exemption globs one area at a time after that area's violations are fixed. The kept `.oxlintrc.agent-strict.json` is reworked so it `extends` the default config and **re-asserts** the three rules over every file via a final override — this both keeps the targeted `bun lint:agent-strict` tool enforcing everywhere with zero exemptions, and lets engineers catch violations in still-exempt areas on touched files during the burndown.

**Tech Stack:** oxlint 1.65.0 (Oxc), custom JS plugin `lint-plugins/papai-policy.js`, Bun test runner (`bun:test`).

---

## Background & Verified Findings

All numbers below were measured against the working tree at plan time (oxlint 1.65.0, 1574 linted files).

- **Current state:** `bun lint` (`.oxlintrc.json`) is clean — 0 errors. The three rules are `"off"` in `.oxlintrc.json` and `"error"` only in `.oxlintrc.agent-strict.json`, which is run on-demand on touched files via `bun lint:agent-strict -- <paths>` (`scripts/lint-agent-strict.sh`). It is **advisory, not a gate**.
- **Impact of naive enable:** flipping the three rules to `"error"` in `.oxlintrc.json` adds **2396 errors** across **505 files**:
  - `papai-policy/no-optional-type-syntax` → **1404**
  - `papai-policy/no-fallback-expressions` → **752**
  - `papai-policy/no-default-value-syntax` → **240**
- **`"warn"` is NOT a safe interim.** `.oxlintrc.json` sets `"options": { "denyWarnings": true }`, so warn-level violations also exit `1` (verified). Therefore the only gate-safe interim is `"error"` + a path-scoped exemption baseline.
- **oxlint override precedence (verified empirically):** later `overrides` entries win, and a child config's `overrides` win over a parent's inherited `overrides`. Proven: a parent exempting `src/providers/**` reports 0 errors on `src/providers/resolver.ts`; a child that `extends` it and re-enables the rule via a trailing `["**/*.ts"]` override reports 4 errors on the same file. This is what makes the strict-tool re-assert work.
- **Established-pattern conflict (intentional):** the codebase's gate-passing pattern _uses_ exactly what these rules ban (optional params like `sensitive?: boolean`, default params like `deps = defaultDeps`). See `docs/archive/2026-05-25-task-provider-as-plugin-phase-2.md`. This plan changes that policy deliberately and burns the existing usages down.

### Violation distribution by area (task-sizing reference)

| Area glob                                                            | Violations |
| -------------------------------------------------------------------- | ---------- |
| `plugins/**`                                                         | 500        |
| `tests/**`                                                           | 621        |
| `src/providers/**`                                                   | 242        |
| `scripts/**`                                                         | 144        |
| `src/chat/**`                                                        | 141        |
| `src/tools/**`                                                       | 115        |
| `src/debug/**`                                                       | 82         |
| `src/plugins/**`                                                     | 71         |
| `src/deferred-prompts/**`                                            | 56         |
| `client/**`                                                          | 56         |
| `src/web/**`                                                         | 49         |
| `src/stats/**`                                                       | 35         |
| `src/mcp/**`                                                         | 35         |
| `src/utils/**`                                                       | 26         |
| `src/instances/**`                                                   | 17         |
| `src/usage/**`                                                       | 16         |
| `review-loop/**`                                                     | 16         |
| `src/message-cache/**`                                               | 14         |
| `src/message-queue/**`                                               | 12         |
| `src/identity/**`                                                    | 12         |
| `src/dashboard-auth/**`                                              | 12         |
| `src/types/**`                                                       | 10         |
| `src/settings/**`                                                    | 9          |
| `src/commands/**`                                                    | 8          |
| `src/attachments/**`                                                 | 7          |
| `src/*.ts` (src root files)                                          | ~85        |
| small `src/<mod>/**` (recurrence, config-editor, group-settings, db) | ~5 total   |

These are a moving target — shared-type edits ripple. Always re-measure per task with the probe command below; never trust a stale count.

---

## Fix-Pattern Cookbook (read before any burndown task)

The three rules are defined in `lint-plugins/papai-policy.js`. Fixes are mechanical in shape but **semantically load-bearing** — never blanket-apply a regex. After every edit, the targeted test suite for that file must still pass (the TDD write-hook enforces this) and `bun typecheck` must stay green.

### Rule 1 — `no-optional-type-syntax` (1404)

Flags optional **parameters**, optional **class properties**, optional **interface/type properties**, and optional **method signatures** (anything with `?`).

```ts
// BEFORE
interface Opts {
  label?: string
}
function describe(name?: string): string {
  return String(name)
}
class Box {
  value?: number
}
interface Api {
  close?(): void
}

// AFTER — model absence explicitly with `| undefined`
interface Opts {
  label: string | undefined
}
function describe(name: string | undefined): string {
  return String(name)
}
class Box {
  value: number | undefined
}
interface Api {
  close: (() => void) | undefined
}
```

**Caution (ripple):** `x?: T` permits the key to be _absent_; `x: T | undefined` requires the key to be _present_ with value `undefined`. Every object literal / call site that previously omitted the key now fails `bun typecheck` (TS2741) — even in still-exempt areas, because the exemption only suppresses `papai-policy` rules, not TypeScript type errors. **When you de-optionalize a property on a widely-consumed type, update all consumers in the same commit and run `bun typecheck` before committing.** For function parameters, prefer giving callers an explicit value; only fall back to `T | undefined` when truly optional.

### Rule 2 — `no-default-value-syntax` (240)

Flags every `AssignmentPattern`: default parameters, destructuring defaults, and array-destructuring defaults.

```ts
// BEFORE
function render(mode = 'safe'): string {
  return mode
}
const { limit = 10 } = opts
function f({ retries = 3 }: Cfg): void {}

// AFTER — branch deliberately
function render(mode: string): string {
  return mode
} // require caller to pass it
const limit = opts.limit === undefined ? 10 : opts.limit
function f(cfg: Cfg): void {
  const retries = cfg.retries === undefined ? 3 : cfg.retries
}
```

For dependency-injection defaults (`deps = defaultDeps`), make the parameter required and have production call sites pass `defaultDeps` explicitly; tests already pass their own `deps`.

### Rule 3 — `no-fallback-expressions` (752) — highest semantic risk

Flags `||=`, `??=`, every `??`, and value-position `||` (but **allows** `||`/`&&` inside an `if`/`while`/`for`/`do-while`/ternary **test** — those are control-flow conditions). `&&` in value position is **not** flagged.

**CRITICAL — do NOT use an inline ternary for the `??` rewrite.** `typescript/prefer-nullish-coalescing` is active under the default config (pedantic + typeAware) and flags `x === undefined || x === null ? y : x` as "prefer `??`" — but `??` is exactly what we just banned. The two rules deadlock on the ternary form. Use **early-return `if` blocks** (or a small named helper) instead, which both rules accept. Verified: the ternary form errors with `typescript(prefer-nullish-coalescing)`; the `if`-block form is clean.

```ts
// BEFORE
const name = input ?? 'anonymous' // nullish: only null/undefined
const label = title || 'untitled' // falsy: '', 0, false, null, undefined
config.tags ??= []

// AFTER — branch with `if` (NOT a ternary), preserving the ORIGINAL operator's semantics
function resolveName(input: string | undefined): string {
  if (input === undefined || input === null) {
    return 'anonymous' // ?? → nullish check only
  }
  return input
}

let label: string
if (title) {
  label = title // || → truthiness check
} else {
  label = 'untitled'
}

if (config.tags === undefined || config.tags === null) {
  config.tags = []
}
```

**Do not rewrite `??` as `||` or vice-versa** — they differ on `''`, `0`, `false`. `if (a || b)` and `cond ? a || b : x` (a `||` that _is_ the test) stay as-is; the rule already allows them. Where a value is used once, inline the `if` at the use site; where it is reused, assign a `let` in branches or extract a helper. **Never** reach for an inline ternary that re-expresses a nullish check — it will trip `prefer-nullish-coalescing`.

---

## Phase 1 — Gate-Safe Infrastructure

Outcome: the three rules live in `.oxlintrc.json` at `"error"`; `bun lint` stays green via a generated exemption baseline; `.oxlintrc.agent-strict.json` still enforces everywhere; a guard test locks the invariant; a progress script reports remaining baseline size.

### Task 1: Generate the exemption baseline and enable the rules in the default config

**Files:**

- Modify: `.oxlintrc.json` (rules block + `overrides`)
- Create (transient, not committed): `scripts/gen-lint-baseline.mjs`

- [ ] **Step 1: Add the baseline generator script**

Create `scripts/gen-lint-baseline.mjs`:

```js
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const RULES = [
  'papai-policy/no-optional-type-syntax',
  'papai-policy/no-default-value-syntax',
  'papai-policy/no-fallback-expressions',
]

// Build a probe config = default config with the three rules forced to error.
const base = JSON.parse(fs.readFileSync('.oxlintrc.json', 'utf8'))
for (const rule of RULES) base.rules[rule] = 'error'
fs.writeFileSync('.oxlintrc.baseline-probe.json', JSON.stringify(base, null, 2))

let output = ''
try {
  execFileSync(
    './node_modules/.bin/oxlint',
    ['--config', '.oxlintrc.baseline-probe.json', '--ignore-path', '.oxlintignore', '.'],
    {
      encoding: 'utf8',
    },
  )
} catch (error) {
  output = `${error.stdout ?? ''}${error.stderr ?? ''}`
} finally {
  fs.rmSync('.oxlintrc.baseline-probe.json', { force: true })
}

// Extract dirty directories from the ,-[path:line:col] frames; one non-recursive glob per dirty dir.
const dirs = new Set()
for (const match of output.matchAll(/\[((?:[^\][]+)\.(?:ts|tsx|svelte)):\d+:\d+\]/g)) {
  const file = match[1].replace(/^\.\//u, '')
  const slash = file.lastIndexOf('/')
  dirs.add(slash === -1 ? '.' : file.slice(0, slash))
}

const globs = [...dirs].sort().map((dir) => (dir === '.' ? '*.ts' : `${dir}/*.{ts,tsx,svelte}`))

const off = Object.fromEntries(RULES.map((rule) => [rule, 'off']))
const override = { files: globs, rules: off }
process.stdout.write(`${JSON.stringify(override, null, 2)}\n`)
console.error(`baseline covers ${globs.length} directories`)
```

- [ ] **Step 2: Run the generator and capture the exemption override**

Run: `bun scripts/gen-lint-baseline.mjs > /tmp/lint-baseline-override.json`
Expected: stderr prints `baseline covers N directories` (N ≈ 94); the JSON is a single override object `{ "files": [ ... ], "rules": { <3 rules>: "off" } }`.

- [ ] **Step 3: Edit `.oxlintrc.json` — flip the three rules to error**

In the `"rules"` block, change these three lines from `"off"` to `"error"`:

```json
    "papai-policy/no-optional-type-syntax": "error",
    "papai-policy/no-default-value-syntax": "error",
    "papai-policy/no-fallback-expressions": "error",
```

- [ ] **Step 4: Edit `.oxlintrc.json` — append the exemption baseline override**

Paste the override object from `/tmp/lint-baseline-override.json` as a **new last entry** in the existing `"overrides"` array (after the `tests/**` entry). Add a marker comment-free key the burndown tasks can find. The array becomes:

```json
  "overrides": [
    {
      "files": ["tests/**/*.ts"],
      "rules": {
        "max-lines-per-function": "off",
        "max-lines": "off",
        "no-await-in-loop": "off",
        "typescript/no-confusing-void-expression": "off",
        "typescript/await-thenable": "off",
        "eslint/no-empty-function": "off"
      }
    },
    {
      "files": [ /* <-- generated baseline globs from Step 2 go here */ ],
      "rules": {
        "papai-policy/no-optional-type-syntax": "off",
        "papai-policy/no-default-value-syntax": "off",
        "papai-policy/no-fallback-expressions": "off"
      }
    }
  ]
```

- [ ] **Step 5: Verify the gate is green**

Run: `bun lint`
Expected: `Found 0 warnings and 0 errors.` If any `papai-policy(...)` error leaks, a dirty file's directory was not covered — re-run Step 2 (the generator is deterministic and complete) and re-paste; do not hand-edit globs.

- [ ] **Step 6: Verify the rules are actually live on clean code**

Pick any already-clean file outside the baseline and temporarily add `const x = a ?? b`; run `bun lint` and confirm it now errors with `papai-policy(no-fallback-expressions)`. Revert the edit.
Expected: error appears, proving the rule runs by default. (This is a manual smoke check, not a commit.)

- [ ] **Step 7: Remove the generator and commit**

```bash
rm scripts/gen-lint-baseline.mjs
git add .oxlintrc.json
git commit -m "build(lint): enable papai-policy functional rules by default with exemption baseline"
```

### Task 2: Rework `.oxlintrc.agent-strict.json` to enforce everywhere despite the baseline

The strict config currently re-sets the three rules at top level. Because it `extends` the default config, it now inherits the default's exemption **override**, which (being path-specific) wins over a top-level rule — so on exempt files the strict tool would go silent. Fix it by re-asserting via a trailing override, which wins over the inherited one (verified).

**Files:**

- Modify: `.oxlintrc.agent-strict.json`

- [ ] **Step 1: Replace the strict config body**

Overwrite `.oxlintrc.agent-strict.json` with:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "extends": ["./.oxlintrc.json"],
  "overrides": [
    {
      "files": ["**/*.{ts,tsx,svelte}"],
      "rules": {
        "papai-policy/no-optional-type-syntax": "error",
        "papai-policy/no-default-value-syntax": "error",
        "papai-policy/no-fallback-expressions": "error"
      }
    }
  ]
}
```

- [ ] **Step 2: Verify strict still flags a baseline-exempt file**

Run: `bun lint:agent-strict -- src/providers/resolver.ts`
Expected: non-zero exit reporting `papai-policy(no-fallback-expressions)` (and likely the other two) — proving the trailing override defeats the inherited exemption. If it reports 0 errors, the override order is wrong; the `**/*.{ts,tsx,svelte}` override must be the last-applied entry.

- [ ] **Step 3: Verify strict passes on an already-clean file**

Run: `bun lint:agent-strict -- lint-plugins/papai-policy.js` is not applicable (jsPlugin); instead pick a clean `src` file with no violations (find one via the probe). Confirm exit 0.

- [ ] **Step 4: Commit**

```bash
git add .oxlintrc.agent-strict.json
git commit -m "build(lint): keep agent-strict enforcing functional rules over the baseline"
```

### Task 3: Lock the invariant with a guard test and add a progress script

**Files:**

- Modify: `tests/utils/papai-policy-lint.test.ts`
- Modify: `package.json` (scripts)
- Test: `tests/utils/papai-policy-lint.test.ts`

- [ ] **Step 1: Write the failing guard test**

Append inside the existing `describe('papai policy oxlint plugin', ...)` block in `tests/utils/papai-policy-lint.test.ts`. It runs the real strict config against a file written under an exempt path and asserts it still flags the rule. Reuse the file's existing imports (`fs`, `os`, `path`, `REPO_ROOT`).

```ts
test('agent-strict config enforces functional rules even under the default baseline', () => {
  const source = [
    '// SPDX-License-Identifier: BUSL-1.1',
    `// Copyright (c) ${currentYear} Dmitriy Lazarev`,
    '// Use of this software is governed by the Business Source License 1.1.',
    '// See LICENSE in the project root for details.',
    '',
    'export function pick(value: string | undefined): string {',
    "  return value ?? 'fallback'",
    '}',
  ].join('\n')

  // Write into a directory that the default config's baseline exempts (src/providers).
  const targetDir = path.join(REPO_ROOT, 'src/providers')
  const targetFile = path.join(targetDir, '__baseline_guard__.ts')
  fs.writeFileSync(targetFile, source)
  try {
    const proc = Bun.spawnSync(
      [
        process.execPath,
        'x',
        'oxlint',
        '--config',
        '.oxlintrc.agent-strict.json',
        'src/providers/__baseline_guard__.ts',
      ],
      { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const output = `${proc.stdout.toString()}${proc.stderr.toString()}`
    expect(proc.exitCode).toBe(1)
    expect(output).toContain('papai-policy(no-fallback-expressions)')
  } finally {
    fs.rmSync(targetFile, { force: true })
  }
})
```

- [ ] **Step 2: Run the test to verify it passes against the new configs**

Run: `bun test tests/utils/papai-policy-lint.test.ts`
Expected: all tests PASS, including the new one. (This test only passes once Tasks 1–2 are committed; if run before, it fails because the baseline guard relies on the new strict config.)

- [ ] **Step 3: Add a burndown progress script to `package.json`**

In `package.json` `"scripts"`, after `"lint:agent-strict"`, add:

```json
    "lint:baseline-count": "oxlint --config .oxlintrc.agent-strict.json --ignore-path .oxlintignore . 2>&1 | grep -oE 'and [0-9]+ errors' || true",
```

This reports total remaining functional-rule violations across the repo (strict config = no exemptions), letting you track the burndown.

- [ ] **Step 4: Verify the progress script runs**

Run: `bun lint:baseline-count`
Expected: prints `and 2396 errors` (the current full count), or whatever remains.

- [ ] **Step 5: Commit**

```bash
git add tests/utils/papai-policy-lint.test.ts package.json
git commit -m "test(lint): guard agent-strict enforcement and add burndown progress script"
```

---

## Phase 2 — Burndown (one task per area)

**This is a repeatable recipe applied per area, in the order below.** Each area task removes that area's exemption globs from `.oxlintrc.json` and fixes the now-surfaced violations. Ordering is leaf-first (low ripple) → shared-types-last (high ripple) so that de-optionalized shared types are fixed once their consumers are already strict.

### The per-area recipe (follow for every Task 2.x)

- [ ] **Step A: List this area's current violations**

Run: `bun lint:agent-strict -- <area paths...>`
(e.g. `bun lint:agent-strict -- review-loop/`). This enumerates exact files/lines/rules to fix, ignoring the baseline.

- [ ] **Step B: Remove this area's exemption globs from `.oxlintrc.json`**

In the baseline `overrides` entry's `files` array, delete every glob belonging to this area (e.g. all `review-loop/...` entries). Leave other areas' globs intact.

- [ ] **Step C: Confirm `bun lint` now fails for this area only**

Run: `bun lint`
Expected: errors, all under this area's paths. If errors appear outside the area, a shared file was touched — keep them in scope for this commit or stop and reassess.

- [ ] **Step D: Fix each violation using the Cookbook**

Apply the correct rewrite per rule (see Fix-Pattern Cookbook). For `no-optional-type-syntax` on exported/shared types, update all consumers in the same change. Never add suppression comments — the write-hook blocks them.

- [ ] **Step E: Keep tests and types green**

Run: `bun typecheck` and the area's test suite (e.g. `bun test tests/web tests/...`). The TDD write-hook already runs targeted tests per edited file; this is the area-wide confirmation. Both must pass.

- [ ] **Step F: Confirm the gate is fully green again**

Run: `bun lint`
Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step G: Commit**

```bash
git add -A
git commit -m "refactor(<area>): adopt functional-typescript rules; drop lint baseline exemption"
```

### Ordered backlog (apply the recipe to each)

Order chosen so isolated/leaf code (no downstream consumers) goes first and the most widely-imported shared types go last, minimizing `typecheck` ripple from de-optionalization.

- [ ] **Task 2.1 — `review-loop/**`\*\* (16) — standalone workspace, zero src consumers.
- [ ] **Task 2.2 — `scripts/**`** (144) — tooling; not imported by `src`.
- [ ] **Task 2.3 — `client/**`\*\* (56) — browser SPA; isolated from server.
- [ ] **Task 2.4 — `tests/**`(split into sub-tasks if large)** (621) — tests import`src`but nothing imports tests, so fixing them never ripples outward. Split by subtree to keep commits reviewable:`tests/tools`, `tests/plugins`, `tests/web`, `tests/chat`, `tests/client`, then the remainder. Note: tests under `tests/**` already have a *separate* override (max-lines etc.); only remove their entries from the **baseline\*\* override, not the pre-existing one.
- [ ] **Task 2.5 — `src/web/**`\*\* (49) — leaf module.
- [ ] **Task 2.6 — `src/mcp/**`\*\* (35) — leaf-ish adapter.
- [ ] **Task 2.7 — `src/stats/**`\*\* (35).
- [ ] **Task 2.8 — `src/usage/**`\*\* (16).
- [ ] **Task 2.9 — `src/dashboard-auth/**`\*\* (12).
- [ ] **Task 2.10 — `src/identity/**`\*\* (12).
- [ ] **Task 2.11 — `src/message-cache/**`+`src/message-queue/**`** (26).
- [ ] **Task 2.12 — `src/deferred-prompts/**`\*\* (56).
- [ ] **Task 2.13 — `src/instances/**`\*\* (17).
- [ ] **Task 2.14 — `src/settings/**`+`src/commands/**`+`src/attachments/**`+ small`src/<mod>/**` (recurrence/config-editor/group-settings/db)** (~30).
- [ ] **Task 2.15 — `src/debug/**`\*\* (82).
- [ ] **Task 2.16 — `src/tools/**`\*\* (115).
- [ ] **Task 2.17 — `src/chat/**`\*\* (141).
- [ ] **Task 2.18 — `src/plugins/**`** (71) — touches the plugin context facade; expect ripple into `plugins/\*\*` types.
- [ ] **Task 2.19 — `plugins/**`** (500) — split by plugin: `plugins/task-provider-youtrack`, `plugins/task-provider-kaneo`, `plugins/synthetic-web-search`. Coordinate with `src/providers` types (next task) — fix provider-facing optionals here only if self-contained.
- [ ] **Task 2.20 — `src/utils/**`\*\* (26) — shared helpers; medium ripple.
- [ ] **Task 2.21 — `src/types/**`+`src/\*.ts`root files** (~95) — most widely-imported domain types. De-optionalizing here ripples broadly, but every consumer area is now strict, so`bun typecheck` surfaces gaps immediately. Do this **last**.
- [ ] **Task 2.22 — `src/providers/**`** (242) — normalized provider interface consumed by tools + plugins; highest fan-out. Do after `src/types` so shared primitives are already settled.

> Re-measure each area with `bun lint:agent-strict -- <paths>` at task start. Counts drift as earlier tasks edit shared types.

---

## Phase 3 — Finalization

### Task 3.1: Remove the now-empty baseline and confirm full enforcement

**Files:**

- Modify: `.oxlintrc.json`
- Modify: `README.md` (the `bun lint:agent-strict` mention, line ~481)

- [ ] **Step 1: Confirm zero remaining violations**

Run: `bun lint:baseline-count`
Expected: prints nothing or `and 0 errors` — the whole repo is clean under the no-exemption strict config.

- [ ] **Step 2: Delete the baseline exemption override from `.oxlintrc.json`**

Remove the entire generated baseline override entry (the one whose `rules` set the three `papai-policy` rules to `"off"`). Leave the pre-existing `tests/**` override and everything else intact. The three rules remain `"error"` at the top level — now enforced everywhere with no carve-out.

- [ ] **Step 3: Verify both configs are green with no exemptions**

Run: `bun lint` then `bun lint:agent-strict -- src tests plugins scripts client review-loop`
Expected: both `Found 0 warnings and 0 errors.`

- [ ] **Step 4: Verify the guard test still passes**

Run: `bun test tests/utils/papai-policy-lint.test.ts`
Expected: PASS. (The guard test writes its own violating fixture, so it still detects enforcement.)

- [ ] **Step 5: Update docs**

In `README.md`, update the `bun lint:agent-strict` description to note the three functional rules are now enforced by default in `bun lint`; `bun lint:agent-strict` remains as an identical-policy targeted runner (kept per decision). Update `CLAUDE.md` if it references these rules as advisory.

- [ ] **Step 6: Commit**

```bash
git add .oxlintrc.json README.md CLAUDE.md
git commit -m "build(lint): remove functional-rule baseline; rules now enforced everywhere"
```

---

## Self-Review

**Spec coverage:**

- "Move rules to main config / used by default" → Phase 1 Task 1 (rules at `"error"` in `.oxlintrc.json`, verified live by Step 6 smoke check).
- "Gradually fix all violations" → Phase 2 area-by-area burndown recipe + ordered backlog covering all 2396 across all 505 files; Phase 3 confirms zero remain.
- "Keep both configs" → `.oxlintrc.agent-strict.json` and `bun lint:agent-strict` retained and reworked (Phase 1 Task 2), kept through Phase 3.
- Gate must never break → exemption baseline (Task 1) + per-area `bun lint` green check (recipe Step F) + denyWarnings handled by using `"error"`+exemption rather than `"warn"`.

**Placeholder scan:** Burndown fixes are necessarily templated (2396 sites cannot be enumerated statically and would be stale on the first commit). Mitigated by: a concrete generator (Task 1), a concrete fix-pattern cookbook with before/after for all three rules, exact per-area measurement commands, and exact verify/commit steps. No `TODO`/`TBD` left.

**Type consistency:** Config keys (`papai-policy/no-optional-type-syntax`, `-no-default-value-syntax`, `-no-fallback-expressions`), script names (`lint:agent-strict`, `lint:baseline-count`), and the override-precedence mechanism are used identically across all tasks. The strict config re-assert (`**/*.{ts,tsx,svelte}` trailing override) matches the empirically verified precedence rule.

**Known risks called out in-plan:** (1) de-optionalization ripples through `bun typecheck` even in exempt areas — handled by leaf-first ordering and "update consumers in same commit"; (2) `??` vs `||` semantic divergence — cookbook forbids cross-rewriting; (3) over-exemption of clean files within a coarse area glob — mitigated because `bun lint:agent-strict` still catches violations on any touched file during burndown.
