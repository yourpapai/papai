<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# CI Line-Coverage Floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the in-process test suite's production-code coverage in CI so it can never silently decline, with a floor that ratchets upward as coverage grows.

**Architecture:** Coverage is collected by piggybacking `--coverage` onto the CI-serial `test` run inside `scripts/check.sh` (no extra suite run). Bun natively enforces a static floor from `bunfig.toml`; a local `bun coverage:ratchet` command raises that floor from a green run (CI never writes the floor).

**Tech Stack:** Bun test runner (coverage + lcov reporter), TOML config, TypeScript CLI, GitHub Actions.

## Global Constraints

- Runtime is **Bun 1.3.13**; strict TypeScript; use `.js` extension in import paths.
- Every `src/`, `scripts/`, `tests/` `.ts` file requires the BUSL-1.1 license header (5-line `//` form) or `bun check:full`'s `license-headers` check fails.
- Never add lint-disable/type-ignore comments.
- Committed floor starts at `coverageThreshold = { lines = 0.90, functions = 0.90 }` (low-flake epsilon below the 92.33 / 91.20 baseline).
- Coverage measures production code only (`coverageSkipTestFiles` stays at its default `true`).
- Do NOT set `coverage = true` in bunfig — coverage stays opt-in, enabled only via `--coverage`.
- Error extraction idiom: `error instanceof Error ? error.message : String(error)`.

---

### Task 1: Ratchet library (pure functions)

Pure, side-effect-free functions for parsing lcov totals, reading/writing the bunfig threshold, and computing the next floor. No filesystem access here — that lives in the CLI (Task 2) so this stays trivially testable.

**Files:**
- Create: `scripts/coverage/ratchet-lib.ts`
- Test: `tests/scripts/coverage-ratchet.test.ts`

**Interfaces:**
- Produces:
  - `parseLcovTotals(lcov: string): { lines: CoverageMetric; functions: CoverageMetric }`
  - `type CoverageMetric = { found: number; hit: number; pct: number }` (`pct` is a 0..1 fraction; `0` when `found === 0`)
  - `parseBunfigThreshold(toml: string): { lines: number; functions: number }` (throws if the `coverageThreshold` line is absent/malformed)
  - `nextFloor(current: number, measuredPct: number, epsilon: number): number` (returns a 2-decimal fraction; never below `current`)
  - `applyThreshold(toml: string, next: { lines: number; functions: number }): string` (returns the toml with the `coverageThreshold` line rewritten)

- [ ] **Step 1: Write the failing test**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
import { describe, expect, test } from 'bun:test'
import {
  applyThreshold,
  nextFloor,
  parseBunfigThreshold,
  parseLcovTotals,
} from '../../scripts/coverage/ratchet-lib.js'

const LCOV = [
  'SF:src/a.ts',
  'FNF:4',
  'FNH:3',
  'LF:10',
  'LH:9',
  'end_of_record',
  'SF:src/b.ts',
  'FNF:6',
  'FNH:6',
  'LF:10',
  'LH:10',
  'end_of_record',
  '',
].join('\n')

describe('parseLcovTotals', () => {
  test('sums LF/LH and FNF/FNH across records', () => {
    const totals = parseLcovTotals(LCOV)
    expect(totals.lines).toEqual({ found: 20, hit: 19, pct: 0.95 })
    expect(totals.functions).toEqual({ found: 10, hit: 9, pct: 0.9 })
  })

  test('pct is 0 when nothing found', () => {
    expect(parseLcovTotals('').lines).toEqual({ found: 0, hit: 0, pct: 0 })
  })
})

describe('parseBunfigThreshold', () => {
  test('reads lines and functions from the coverageThreshold line', () => {
    const toml = 'coverageThreshold = { lines = 0.90, functions = 0.88 }\n'
    expect(parseBunfigThreshold(toml)).toEqual({ lines: 0.9, functions: 0.88 })
  })

  test('throws when the line is missing', () => {
    expect(() => parseBunfigThreshold('[test]\n')).toThrow()
  })
})

describe('nextFloor', () => {
  test('ratchets up to floor(measured - epsilon), 2 decimals', () => {
    expect(nextFloor(0.9, 0.9233, 0.005)).toBe(0.91)
  })

  test('never lowers the current floor', () => {
    expect(nextFloor(0.92, 0.9051, 0.005)).toBe(0.92)
  })

  test('is a no-op when improvement is within epsilon', () => {
    expect(nextFloor(0.9, 0.902, 0.005)).toBe(0.9)
  })
})

describe('applyThreshold', () => {
  test('rewrites only the coverageThreshold line', () => {
    const toml = '[test]\ncoverageThreshold = { lines = 0.90, functions = 0.90 }\ntimeout = 15000\n'
    const out = applyThreshold(toml, { lines: 0.91, functions: 0.9 })
    expect(out).toContain('coverageThreshold = { lines = 0.91, functions = 0.9 }')
    expect(out).toContain('timeout = 15000')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/coverage-ratchet.test.ts`
Expected: FAIL — `Cannot find module '../../scripts/coverage/ratchet-lib.js'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
export type CoverageMetric = { found: number; hit: number; pct: number }

function metric(found: number, hit: number): CoverageMetric {
  return { found, hit, pct: found === 0 ? 0 : hit / found }
}

export function parseLcovTotals(lcov: string): {
  lines: CoverageMetric
  functions: CoverageMetric
} {
  let lf = 0
  let lh = 0
  let fnf = 0
  let fnh = 0
  for (const raw of lcov.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('LF:')) lf += Number(line.slice(3))
    else if (line.startsWith('LH:')) lh += Number(line.slice(3))
    else if (line.startsWith('FNF:')) fnf += Number(line.slice(4))
    else if (line.startsWith('FNH:')) fnh += Number(line.slice(4))
  }
  return { lines: metric(lf, lh), functions: metric(fnf, fnh) }
}

export function parseBunfigThreshold(toml: string): {
  lines: number
  functions: number
} {
  const match = toml.match(
    /coverageThreshold\s*=\s*\{\s*lines\s*=\s*([0-9.]+)\s*,\s*functions\s*=\s*([0-9.]+)\s*\}/,
  )
  if (!match) throw new Error('coverageThreshold line not found in bunfig.toml')
  return { lines: Number(match[1]), functions: Number(match[2]) }
}

export function nextFloor(current: number, measuredPct: number, epsilon: number): number {
  const candidate = Math.floor((measuredPct - epsilon) * 100) / 100
  return candidate > current ? candidate : current
}

export function applyThreshold(
  toml: string,
  next: { lines: number; functions: number },
): string {
  return toml.replace(
    /coverageThreshold\s*=\s*\{[^}]*\}/,
    `coverageThreshold = { lines = ${next.lines}, functions = ${next.functions} }`,
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/coverage-ratchet.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/ratchet-lib.ts tests/scripts/coverage-ratchet.test.ts
git commit -m "feat(coverage): ratchet library for lcov totals and bunfig floor"
```

---

### Task 2: Ratchet CLI (`bun coverage:ratchet`)

Thin filesystem wrapper around Task 1: `--check` (default) fails when measured < committed floor; `--update` raises the floor in `bunfig.toml`.

**Files:**
- Create: `scripts/coverage/ratchet.ts`
- Modify: `package.json:44` (add `coverage:ratchet` script after `test:coverage`)

**Interfaces:**
- Consumes: `parseLcovTotals`, `parseBunfigThreshold`, `nextFloor`, `applyThreshold` from `ratchet-lib.js`.
- Reads `reports/coverage/lcov.info`; reads/writes `bunfig.toml`.
- Constants: `LCOV_PATH = 'reports/coverage/lcov.info'`, `BUNFIG_PATH = 'bunfig.toml'`, `EPSILON = 0.005`.

- [ ] **Step 1: Write the CLI**

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
import {
  applyThreshold,
  nextFloor,
  parseBunfigThreshold,
  parseLcovTotals,
} from './ratchet-lib.js'

const LCOV_PATH = 'reports/coverage/lcov.info'
const BUNFIG_PATH = 'bunfig.toml'
const EPSILON = 0.005

async function main(): Promise<void> {
  const update = process.argv.includes('--update')
  const lcov = await Bun.file(LCOV_PATH).text()
  const toml = await Bun.file(BUNFIG_PATH).text()
  const totals = parseLcovTotals(lcov)
  const floor = parseBunfigThreshold(toml)

  const pct = (n: number) => `${(n * 100).toFixed(2)}%`
  console.log(
    `measured: lines ${pct(totals.lines.pct)}, functions ${pct(totals.functions.pct)}`,
  )
  console.log(`floor:    lines ${pct(floor.lines)}, functions ${pct(floor.functions)}`)

  if (update) {
    const next = {
      lines: nextFloor(floor.lines, totals.lines.pct, EPSILON),
      functions: nextFloor(floor.functions, totals.functions.pct, EPSILON),
    }
    if (next.lines === floor.lines && next.functions === floor.functions) {
      console.log('no improvement beyond epsilon; floor unchanged')
      return
    }
    await Bun.write(BUNFIG_PATH, applyThreshold(toml, next))
    console.log(`floor raised to lines ${pct(next.lines)}, functions ${pct(next.functions)}`)
    return
  }

  if (totals.lines.pct < floor.lines || totals.functions.pct < floor.functions) {
    console.error('coverage below committed floor')
    process.exit(1)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
```

- [ ] **Step 2: Add the package.json script**

Modify `package.json` — add after the `test:coverage` line (line 44):

```json
    "coverage:ratchet": "bun scripts/coverage/ratchet.ts",
```

- [ ] **Step 3: Verify the CLI runs against a fixture lcov**

Run:
```bash
mkdir -p reports/coverage
printf 'SF:src/a.ts\nLF:10\nLH:10\nFNF:2\nFNH:2\nend_of_record\n' > reports/coverage/lcov.info
bun coverage:ratchet
```
Expected: prints `measured: lines 100.00%, functions 100.00%` and `floor: lines 90.00%, functions 90.00%` and exits 0 (only after Task 3 has added the `coverageThreshold` line to bunfig; if run before Task 3, expect the `coverageThreshold line not found` error — that is fine, do this step after Task 3 or with a temporary line).

- [ ] **Step 4: Clean up the fixture**

Run: `rm -f reports/coverage/lcov.info`

- [ ] **Step 5: Commit**

```bash
git add scripts/coverage/ratchet.ts package.json
git commit -m "feat(coverage): coverage:ratchet CLI (check + update floor)"
```

---

### Task 3: bunfig coverage config + wire `--coverage` into CI

Turn on the floor: add coverage config to `bunfig.toml` and collect coverage on the CI-serial `test` run only.

**Files:**
- Modify: `bunfig.toml` (add three keys under `[test]`)
- Modify: `scripts/check.sh:337` (add `--coverage` to the CI branch)

- [ ] **Step 1: Add coverage keys to bunfig.toml**

Append under the `[test]` table (after the `preload` line, line 19):

```toml

# Coverage floor (enforced only when --coverage is passed — see scripts/check.sh
# CI branch). Not `coverage = true`: coverage stays opt-in so the stories/e2e/
# smoke/client runs and local `--parallel` checks are unaffected. Raise the floor
# from a green run with `bun coverage:ratchet --update`.
coverageThreshold = { lines = 0.90, functions = 0.90 }
coverageReporter = ["text", "lcov"]
coverageDir = "reports/coverage"
```

- [ ] **Step 2: Wire `--coverage` into the CI test branch**

In `scripts/check.sh`, change line 337 from:

```bash
          bun test --timeout 15000 >"$TMPDIR/$fname.out" 2>&1 || exit_code=$?
```

to:

```bash
          bun test --coverage --timeout 15000 >"$TMPDIR/$fname.out" 2>&1 || exit_code=$?
```

Leave line 339 (the local `--parallel` branch) unchanged.

- [ ] **Step 3: Verify the gate bites (mechanism check on a subset)**

Because the full suite currently has 3 failing tests (Item 5), verify the *threshold mechanism* on a fast subset rather than the whole suite:

```bash
# Temporarily raise the floor to prove it fails:
bun test --coverage tests/scripts/coverage-ratchet.test.ts
```
Expected: exits 0 (subset is fully covered by its own test, above 0.90). Then temporarily edit `coverageThreshold` to `{ lines = 0.999, functions = 0.999 }`, rerun the same command, and confirm it exits non-zero with a coverage-threshold message. Restore `0.90 / 0.90` afterward.

- [ ] **Step 4: Verify local `check:full` is unaffected**

Run: `grep -n 'bun test --parallel --timeout 15000' scripts/check.sh`
Expected: the local branch still has NO `--coverage`. (Do not run the full `check:full` here — it is slow and currently red on Item 5's 3 tests.)

- [ ] **Step 5: Commit**

```bash
git add bunfig.toml scripts/check.sh
git commit -m "ci(coverage): enforce line/function floor on the CI test run"
```

---

### Task 4: CI artifact upload + docs

Surface the coverage report per run and document the workflow.

**Files:**
- Modify: `.github/workflows/ci.yml` (add an upload step to the `check` job, after "Run all checks", ~line 95)
- Modify: `tests/CLAUDE.md` (add a "Coverage floor" subsection)

- [ ] **Step 1: Add the artifact upload to the `check` job**

In `.github/workflows/ci.yml`, after the `Run all checks` step in the `check` job, add:

```yaml
      - name: Upload coverage report
        if: always()
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: coverage-lcov
          path: reports/coverage/lcov.info
          if-no-files-found: warn
          retention-days: 14
```

- [ ] **Step 2: Document in tests/CLAUDE.md**

Add this subsection (place it near the existing testing notes):

```markdown
### Coverage floor

The in-process suite's production-code coverage (`src/` + `plugins/`) is gated in
CI. The floor lives in `bunfig.toml` (`coverageThreshold = { lines, functions }`)
and is enforced by bun when `--coverage` is passed — which happens only on the
CI-serial `test` run inside `scripts/check.sh`. Local `check:full` (`--parallel`)
does not collect coverage. When coverage improves, raise the floor from a green
run with `bun coverage:ratchet --update` and commit the `bunfig.toml` change; the
script never lowers the floor. Running `bun test --coverage <subset>` locally
enforces the same floor against that subset (expected to "fail" on partial runs).
```

- [ ] **Step 3: Validate the workflow YAML**

Run: `bun -e "import {parse} from 'yaml'; parse(await Bun.file('.github/workflows/ci.yml').text()); console.log('yaml ok')"`
Expected: `yaml ok` (if the `yaml` package is unavailable, instead visually confirm indentation matches the sibling `stories` job's upload step).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml tests/CLAUDE.md
git commit -m "ci(coverage): upload lcov artifact; document coverage floor"
```

---

## Post-implementation (blocked on Item 5)

After the 3 failing tests are fixed and the suite is green, capture the true
baseline and lock the tightened floor:

```bash
bun test --coverage            # full green run produces reports/coverage/lcov.info
bun coverage:ratchet --update  # raises bunfig floor toward the real baseline
git add bunfig.toml && git commit -m "ci(coverage): lock floor from green baseline"
```

## Self-Review

- **Spec coverage:** bunfig config → Task 3; check.sh piggyback → Task 3; ratchet mechanism → Tasks 1–2; artifact → Task 4; docs → Task 4; Item-5 dependency → Post-implementation section. All spec sections mapped.
- **Placeholder scan:** none — every code/step is concrete.
- **Type consistency:** `parseLcovTotals`/`parseBunfigThreshold`/`nextFloor`/`applyThreshold` signatures identical across Tasks 1 and 2; `CoverageMetric.pct` is a 0..1 fraction throughout; floor values are fractions (`0.90`) everywhere.
