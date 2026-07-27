<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# T0 Story Coverage Denominator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the T0 story coverage gate measure product code — scoped to `src/` and `plugins/`, with never-imported files counted as 0% — so the figure can be ratcheted toward a target.

**Architecture:** A new pure module `scripts/coverage/story-scope.ts` filters lcov records to in-scope product files and appends synthetic zero records for files no story imported. Its pure core (`isScopedSourceFile`, `scopeLcov`) takes a file list as an argument; its IO edge (`discoverScopedSourceFiles`) globs the working tree and is injected by callers. Both story-side consumers — `scripts/story/coverage-gate.ts` and `scripts/coverage/ratchet-stories.ts` — read through it. `parseLcovTotals`, `scripts/coverage/story-coverage-gate.ts`, and `scripts/coverage/ratchet.ts` are not modified.

**Tech Stack:** Bun (runtime, `Bun.Glob`, `Bun.Transpiler`, `bun:test`), strict TypeScript, lcov text format.

**Spec:** `docs/superpowers/specs/2026-07-27-story-coverage-denominator-design.md`

## Global Constraints

- Runtime is **Bun**. Import paths use the **`.js` extension** even for `.ts` sources.
- Every new file needs the BUSL-1.1 header. `.ts` uses the `//` form; `.md` uses the HTML-comment form. `bun license:headers` adds them.
- **Never** add lint-disable or type-ignore comments. A hook policy blocks them.
- Error extraction is always `error instanceof Error ? error.message : String(error)`.
- `bun run test` excludes everything under `tests/stories/**`. The new tests live in `tests/scripts/` and run under it.
- `scripts/story/**` is a **frozen story-manifest input**. Any relative import it makes must resolve to a captured path or `tests/scripts/story-enforcement-imports.test.ts` fails. Task 3 exists solely to satisfy this and **must land before Task 4**.
- `bun test:stories:coverage` requires a running Docker daemon and the pinned `oven/bun` image. It fails closed otherwise. Only Task 4 needs it.
- Coverage floors are 0..1 fractions, validated by a Zod schema with `.min(0).max(1)`.

---

### Task 1: Pure scoping core

Creates the module with its two pure functions. Nothing imports it yet, so the repo stays green.

**Files:**
- Create: `scripts/coverage/story-scope.ts`
- Test: `tests/scripts/story-coverage-scope.test.ts`

**Interfaces:**
- Consumes: `parseLcovTotals` from `scripts/coverage/ratchet-lib.js` (test-only, to assert the seeding arithmetic).
- Produces:
  - `STORY_SCOPE_ROOTS: readonly string[]` — `['src', 'plugins']`
  - `isScopedSourceFile(filePath: string): boolean`
  - `type ScopedLcov = Readonly<{ lcov: string; measured: readonly string[]; seeded: readonly string[] }>`
  - `scopeLcov(lcov: string, sourceFiles: readonly string[]): ScopedLcov`
  - `formatStoryCoverageScope(scoped: ScopedLcov): string`

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/story-coverage-scope.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { parseLcovTotals } from '../../scripts/coverage/ratchet-lib.js'
import { formatStoryCoverageScope, isScopedSourceFile, scopeLcov } from '../../scripts/coverage/story-scope.js'

function record(file: string, found: number, hit: number): string {
  return [`SF:${file}`, `FNF:${found}`, `FNH:${hit}`, `LF:${found}`, `LH:${hit}`, 'end_of_record'].join('\n')
}

// One in-scope record plus the three kinds of noise the story lcov actually
// carries: test-harness files, enforcement scripts, and a leaked temp fixture.
const MIXED_LCOV = [
  record('src/a.ts', 4, 2),
  record('tests/stories/harness/chat.ts', 4, 4),
  record('scripts/story/cli.ts', 4, 4),
  record('../tmp/papai-scenario-settings-plugin-UPLZMT/index.mjs', 1, 1),
  '',
].join('\n')

describe('isScopedSourceFile', () => {
  it('accepts .ts files under the scope roots', () => {
    expect(isScopedSourceFile('src/a.ts')).toBe(true)
    expect(isScopedSourceFile('plugins/acp/index.ts')).toBe(true)
  })

  it('rejects files outside the scope roots', () => {
    expect(isScopedSourceFile('tests/stories/harness/chat.ts')).toBe(false)
    expect(isScopedSourceFile('scripts/coverage/ratchet.ts')).toBe(false)
    expect(isScopedSourceFile('../tmp/papai-scenario-settings-plugin-UPLZMT/index.mjs')).toBe(false)
  })

  it('rejects .testing.ts doubles, which are test support that lives under src/', () => {
    expect(isScopedSourceFile('src/cache.testing.ts')).toBe(false)
    expect(isScopedSourceFile('plugins/acp/client.testing.ts')).toBe(false)
  })

  it('rejects non-TypeScript files under a scope root', () => {
    expect(isScopedSourceFile('src/a.json')).toBe(false)
  })
})

describe('scopeLcov', () => {
  it('drops every record outside the scope roots', () => {
    const scoped = scopeLcov(MIXED_LCOV, [])

    expect(scoped.lcov).toContain('SF:src/a.ts')
    expect(scoped.lcov).not.toContain('tests/stories/harness/chat.ts')
    expect(scoped.lcov).not.toContain('scripts/story/cli.ts')
    expect(scoped.lcov).not.toContain('papai-scenario-settings-plugin')
    expect(scoped.measured).toEqual(['src/a.ts'])
  })

  it('seeds unloaded files as zero records so they count against the mean', () => {
    const scoped = scopeLcov(MIXED_LCOV, ['src/a.ts', 'src/b.ts', 'plugins/demo/index.ts'])

    expect(scoped.seeded).toEqual(['plugins/demo/index.ts', 'src/b.ts'])
    // src/a.ts is 2/4; the two seeds contribute 0 each. Mean = 0.5 / 3.
    expect(parseLcovTotals(scoped.lcov).lines.pct).toBeCloseTo(0.5 / 3, 10)
  })

  it('does not seed a file that already has a record', () => {
    const scoped = scopeLcov(MIXED_LCOV, ['src/a.ts'])

    expect(scoped.seeded).toEqual([])
    expect(scoped.lcov.match(/^SF:src\/a\.ts$/gmu)).toHaveLength(1)
  })

  it('ignores out-of-scope entries in the source list', () => {
    const scoped = scopeLcov(MIXED_LCOV, ['tests/helper.ts', 'src/b.testing.ts'])

    expect(scoped.seeded).toEqual([])
  })

  it('orders seeded files deterministically regardless of input order', () => {
    const forward = scopeLcov(MIXED_LCOV, ['src/b.ts', 'src/c.ts'])
    const reversed = scopeLcov(MIXED_LCOV, ['src/c.ts', 'src/b.ts'])

    expect(forward.seeded).toEqual(['src/b.ts', 'src/c.ts'])
    expect(reversed.seeded).toEqual(forward.seeded)
  })

  it('keeps an in-scope record whose file is no longer on disk', () => {
    // The run that produced the lcov executed it, so it is evidence. The
    // source list is the seeding input, not a whitelist for kept records.
    const scoped = scopeLcov(MIXED_LCOV, ['src/b.ts'])

    expect(scoped.measured).toEqual(['src/a.ts'])
  })

  it('reports 0% when nothing was loaded', () => {
    const scoped = scopeLcov('', ['src/a.ts', 'src/b.ts'])

    expect(scoped.measured).toEqual([])
    expect(scoped.seeded).toEqual(['src/a.ts', 'src/b.ts'])
    expect(parseLcovTotals(scoped.lcov).lines.pct).toBe(0)
  })
})

describe('formatStoryCoverageScope', () => {
  it('reports the denominator so a falling figure is explainable', () => {
    const text = formatStoryCoverageScope(scopeLcov(MIXED_LCOV, ['src/a.ts', 'src/b.ts']))

    expect(text).toBe('  scope: 1 measured, 1 unloaded seeded as 0%, 2 files')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/story-coverage-scope.test.ts`

Expected: FAIL — `Cannot find module '../../scripts/coverage/story-scope.js'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/coverage/story-scope.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const STORY_SCOPE_ROOTS: readonly string[] = ['src', 'plugins']

const TESTING_DOUBLE_SUFFIX = '.testing.ts'

/**
 * In scope: TypeScript under a scope root, excluding `*.testing.ts` doubles.
 * Those are test support that lives under `src/` only for import-path
 * convenience, so counting them while excluding `tests/**` would be incoherent.
 */
export function isScopedSourceFile(filePath: string): boolean {
  if (!filePath.endsWith('.ts') || filePath.endsWith(TESTING_DOUBLE_SUFFIX)) return false
  return STORY_SCOPE_ROOTS.some((root) => filePath.startsWith(`${root}/`))
}

export type ScopedLcov = Readonly<{
  lcov: string
  measured: readonly string[]
  seeded: readonly string[]
}>

/**
 * A seeded file contributes exactly 0 to the per-file mean regardless of its
 * real line count, and `pct` is the only field the gate, the ratchet, and the
 * formatter read. The pooled `found`/`hit` totals therefore under-report
 * unloaded files — preferred over inventing counts the coverage tool never
 * produced.
 */
const SEEDED_RECORD_BODY: readonly string[] = ['FNF:1', 'FNH:0', 'LF:1', 'LH:0', 'end_of_record']

function splitRecords(lcov: string): readonly string[] {
  const records: string[] = []
  let current: string[] = []
  for (const line of lcov.split('\n')) {
    current.push(line)
    if (line.trim() === 'end_of_record') {
      records.push(current.join('\n'))
      current = []
    }
  }
  return records
}

function recordSourceFile(record: string): string | undefined {
  for (const raw of record.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('SF:')) return line.slice('SF:'.length)
  }
  return undefined
}

/**
 * Pure. Drops out-of-scope records and appends a zero record for every
 * in-scope source file the run never loaded, so never-imported code counts as
 * 0% instead of vanishing from the mean.
 */
export function scopeLcov(lcov: string, sourceFiles: readonly string[]): ScopedLcov {
  const kept: string[] = []
  const measured: string[] = []
  for (const record of splitRecords(lcov)) {
    const file = recordSourceFile(record)
    if (file === undefined || !isScopedSourceFile(file)) continue
    kept.push(record)
    measured.push(file)
  }
  const loaded = new Set(measured)
  const seeded = sourceFiles.filter((file) => isScopedSourceFile(file) && !loaded.has(file)).toSorted()
  for (const file of seeded) kept.push([`SF:${file}`, ...SEEDED_RECORD_BODY].join('\n'))
  return { lcov: kept.length === 0 ? '' : `${kept.join('\n')}\n`, measured, seeded }
}

export function formatStoryCoverageScope(scoped: ScopedLcov): string {
  const total = scoped.measured.length + scoped.seeded.length
  return `  scope: ${scoped.measured.length} measured, ${scoped.seeded.length} unloaded seeded as 0%, ${total} files`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/story-coverage-scope.test.ts`

Expected: PASS, 12 tests.

- [ ] **Step 5: Verify nothing else regressed**

Run: `bun test tests/scripts/`

Expected: PASS. `parseLcovTotals` is untouched, so `coverage-ratchet.test.ts` still passes.

- [ ] **Step 6: Commit**

```bash
git add scripts/coverage/story-scope.ts tests/scripts/story-coverage-scope.test.ts
git commit -m "feat(coverage): add pure lcov scoping and seeding for T0 story coverage"
```

---

### Task 2: Source-file discovery

Adds the IO edge. Still unwired.

**Files:**
- Modify: `scripts/coverage/story-scope.ts`
- Test: `tests/scripts/story-coverage-scope.test.ts`

**Interfaces:**
- Consumes: `isScopedSourceFile`, `STORY_SCOPE_ROOTS` from Task 1.
- Produces: `discoverScopedSourceFiles(cwd: string): Promise<readonly string[]>` — returns repo-relative POSIX paths, sorted, excluding files that transpile to nothing.

The dangerous failure here is silent: an empty result makes seeding a no-op and the gate reverts to the old inflated figure while still printing a pass. Both the missing-root and empty-root cases therefore throw.

- [ ] **Step 1: Write the failing test**

Append to `tests/scripts/story-coverage-scope.test.ts` (and extend the existing import from `story-scope.js` to include `discoverScopedSourceFiles`):

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'story-scope-'))
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true })
  await mkdir(path.join(root, 'plugins', 'demo'), { recursive: true })
  await writeFile(path.join(root, 'src', 'runtime.ts'), 'export const value = 1\n')
  await writeFile(path.join(root, 'src', 'nested', 'types.ts'), 'export type Thing = { id: string }\n')
  await writeFile(path.join(root, 'src', 'runtime.testing.ts'), 'export const double = 2\n')
  await writeFile(path.join(root, 'plugins', 'demo', 'index.ts'), 'export function run(): number {\n  return 1\n}\n')
  return root
}

describe('discoverScopedSourceFiles', () => {
  it('returns in-scope files and excludes doubles and type-only modules', async () => {
    const root = await fixtureRoot()
    try {
      // src/nested/types.ts transpiles to nothing, so it has no coverable
      // lines and must not enter the denominator: meanMetric already drops
      // zero-found records for files that were loaded.
      expect(await discoverScopedSourceFiles(root)).toEqual(['plugins/demo/index.ts', 'src/runtime.ts'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('throws when a scope root is missing rather than silently seeding nothing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'story-scope-'))
    try {
      await mkdir(path.join(root, 'src'), { recursive: true })
      await writeFile(path.join(root, 'src', 'runtime.ts'), 'export const value = 1\n')

      expect(discoverScopedSourceFiles(root)).rejects.toThrow('plugins')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('throws when a scope root yields no in-scope files', async () => {
    const root = await fixtureRoot()
    try {
      await rm(path.join(root, 'plugins', 'demo', 'index.ts'))

      expect(discoverScopedSourceFiles(root)).rejects.toThrow('plugins')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('throws when a file cannot be transpiled instead of treating it as type-only', async () => {
    const root = await fixtureRoot()
    try {
      await writeFile(path.join(root, 'src', 'broken.ts'), 'export const = \n')

      expect(discoverScopedSourceFiles(root)).rejects.toThrow('src/broken.ts')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/story-coverage-scope.test.ts`

Expected: FAIL — `discoverScopedSourceFiles` is not exported.

- [ ] **Step 3: Write the implementation**

Add to the top of `scripts/coverage/story-scope.ts`, below the license header:

```ts
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { Glob, Transpiler } from 'bun'
```

Append to the end of the file:

```ts
const SOURCE_GLOB = '**/*.ts'

// Bun's transpiler strips types and comments, so empty output proves the file
// has no coverable lines. This is a decision procedure, not a heuristic.
const transpiler = new Transpiler({ loader: 'ts' })

function hasRuntimeCode(source: string, relativePath: string): boolean {
  try {
    return transpiler.transformSync(source).trim().length > 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to transpile scoped source file ${relativePath}: ${message}`, { cause: error })
  }
}

async function discoverRoot(cwd: string, root: string): Promise<readonly string[]> {
  const entries: string[] = []
  try {
    for await (const entry of new Glob(SOURCE_GLOB).scan({ cwd: path.join(cwd, root) })) {
      entries.push(`${root}/${entry.split(path.sep).join('/')}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to scan story coverage scope root ${root}: ${message}`, { cause: error })
  }
  const scoped = entries.filter(isScopedSourceFile)
  const files: string[] = []
  for (const relative of scoped) {
    const source = await readFile(path.join(cwd, relative), 'utf8')
    if (hasRuntimeCode(source, relative)) files.push(relative)
  }
  // An empty root would make seeding a silent no-op and the gate would report
  // the old, inflated figure while still passing.
  if (files.length === 0) throw new Error(`Story coverage scope root ${root} yielded no source files`)
  return files
}

/**
 * IO edge. Injected into callers so `scopeLcov` stays pure and testable
 * against a literal file list.
 */
export async function discoverScopedSourceFiles(cwd: string): Promise<readonly string[]> {
  const perRoot = await Promise.all(STORY_SCOPE_ROOTS.map((root) => discoverRoot(cwd, root)))
  return perRoot.flat().toSorted()
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/story-coverage-scope.test.ts`

Expected: PASS, 16 tests.

- [ ] **Step 5: Sanity-check against the real tree**

Run: `bun -e 'import { discoverScopedSourceFiles } from "./scripts/coverage/story-scope.js"; console.log((await discoverScopedSourceFiles(process.cwd())).length)'`

Expected: `846`. If it differs, files were added or removed since the spec was measured — that is fine, but note the number, because Task 4 re-measures anyway.

- [ ] **Step 6: Commit**

```bash
git add scripts/coverage/story-scope.ts tests/scripts/story-coverage-scope.test.ts
git commit -m "feat(coverage): discover in-scope story coverage source files"
```

---

### Task 3: Register the module as a frozen story input

`scripts/story/coverage-gate.ts` is a frozen enforcement input. In Task 4 it will import `story-scope.js`, and `tests/scripts/story-enforcement-imports.test.ts` fails on any relative import that resolves outside the captured set. This task makes that import legal. **It must land before Task 4.**

**Files:**
- Modify: `scripts/story/inputs.ts:27-31`
- Test: `tests/scripts/story-enforcement-imports.test.ts:41-46`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `scripts/coverage/story-scope.ts` satisfies `isFrozenCoverageSupportPath` and `isCapturedStoryInputPath`.

- [ ] **Step 1: Write the failing test**

In `tests/scripts/story-enforcement-imports.test.ts`, replace the body of the `'the coverage modules the runner imports are frozen inputs'` test with:

```ts
  test('the coverage modules the runner imports are frozen inputs', () => {
    expect(isFrozenCoverageSupportPath('scripts/coverage/normalize-lcov.ts')).toBe(true)
    expect(isFrozenCoverageSupportPath('scripts/coverage/story-coverage-gate.ts')).toBe(true)
    expect(isFrozenCoverageSupportPath('scripts/coverage/ratchet-lib.ts')).toBe(true)
    expect(isFrozenCoverageSupportPath('scripts/coverage/story-scope.ts')).toBe(true)
    expect(isFrozenCoverageSupportPath('scripts/coverage/ratchet.ts')).toBe(false)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/story-enforcement-imports.test.ts`

Expected: FAIL — `expect(false).toBe(true)` for `story-scope.ts`.

- [ ] **Step 3: Write the implementation**

In `scripts/coverage/story-scope.ts`, the module must remain loadable from the story session snapshot, which carries only the frozen set. It imports nothing from the repo, so no further change is needed there.

In `scripts/story/inputs.ts`, extend the frozen list (entries stay alphabetically sorted):

```ts
// coverage modules the frozen enforcement tree imports; the snapshot must carry them or the runner cannot load.
export const FROZEN_COVERAGE_SUPPORT: readonly string[] = [
  'scripts/coverage/normalize-lcov.ts',
  'scripts/coverage/ratchet-lib.ts',
  'scripts/coverage/story-coverage-gate.ts',
  'scripts/coverage/story-scope.ts',
]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun test tests/scripts/story-enforcement-imports.test.ts tests/scripts/story-manifest.test.ts tests/scripts/story-frozen-inputs.helpers.ts`

Expected: PASS. `tests/scripts/story-frozen-inputs.helpers.ts` stages every `FROZEN_COVERAGE_SUPPORT` entry into its fixtures, so the new path must exist on disk — it does, from Task 1.

- [ ] **Step 5: Run the full script suite**

Run: `bun test tests/scripts/`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/story/inputs.ts tests/scripts/story-enforcement-imports.test.ts
git commit -m "build(stories): freeze story-scope as a captured coverage input"
```

---

### Task 4: Wire both consumers and re-baseline the floor

The gate and the ratchet must be wired in the **same commit** as the floor edit. Wiring alone leaves the gate measuring ~43% against a 0.50 floor, which is red. Wiring only the gate and not the ratchet is worse: the next green ratchet run would raise the floor above what the gate can produce, and the gate would fail permanently.

**Files:**
- Modify: `scripts/story/coverage-gate.ts:15-35`
- Modify: `scripts/coverage/ratchet-stories.ts:8-31`
- Modify: `scripts/story/coverage-floor.json`
- Modify: `tests/scripts/story-coverage-ratchet.test.ts`
- Modify: `tests/CLAUDE.md:178`

**Interfaces:**
- Consumes: `discoverScopedSourceFiles`, `formatStoryCoverageScope`, `scopeLcov`, `type ScopedLcov` from Tasks 1–2.
- Produces: `computeRatchetedFloor(lcov: string, sourceFiles: readonly string[], current: CoverageFloor, epsilon: number): CoverageFloor` — note the **new second parameter**.

- [ ] **Step 1: Write the failing test**

Replace the body of `tests/scripts/story-coverage-ratchet.test.ts` below the license header with:

```ts
import { describe, expect, it } from 'bun:test'

import { computeRatchetedFloor } from '../../scripts/coverage/ratchet-stories.js'

const LCOV = ['SF:src/a.ts', 'FNF:1', 'FNH:1', 'DA:1,1', 'DA:2,1', 'LF:2', 'LH:2', 'end_of_record'].join('\n')

describe('computeRatchetedFloor', () => {
  it('raises the floor toward measured coverage minus epsilon', () => {
    const next = computeRatchetedFloor(LCOV, ['src/a.ts'], { lines: 0.5, functions: 0.5 }, 0.005)

    expect(next.lines).toBeGreaterThan(0.5)
    expect(next.functions).toBeGreaterThan(0.5)
  })

  it('never lowers an existing floor', () => {
    const next = computeRatchetedFloor(LCOV, ['src/a.ts'], { lines: 0.99, functions: 0.99 }, 0.005)

    expect(next.lines).toBe(0.99)
    expect(next.functions).toBe(0.99)
  })

  it('scopes and seeds before measuring, so it cannot outrun the gate', () => {
    // src/a.ts is fully covered; src/b.ts was never loaded. Mean = 0.5, so the
    // floor must not move above the gate's own scoped measurement.
    const next = computeRatchetedFloor(LCOV, ['src/a.ts', 'src/b.ts'], { lines: 0.1, functions: 0.1 }, 0.005)

    expect(next.lines).toBe(0.49)
    expect(next.functions).toBe(0.49)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/scripts/story-coverage-ratchet.test.ts`

Expected: FAIL — the third argument is currently the epsilon number, so `computeRatchetedFloor` reads the array as the floor and the assertions do not hold.

- [ ] **Step 3: Wire the ratchet**

In `scripts/coverage/ratchet-stories.ts`, replace the imports, `computeRatchetedFloor`, and `main` with:

```ts
import { readFile, writeFile } from 'node:fs/promises'

import { STORY_COVERAGE_LCOV_PATH } from '../story/reports.js'
import { nextFloor, parseLcovTotals, serializeFloor } from './ratchet-lib.js'
import { type CoverageFloor, readCoverageFloor, STORY_COVERAGE_FLOOR_PATH } from './story-coverage-gate.js'
import { discoverScopedSourceFiles, scopeLcov } from './story-scope.js'

const EPSILON = 0.005

export function computeRatchetedFloor(
  lcov: string,
  sourceFiles: readonly string[],
  current: CoverageFloor,
  epsilon: number,
): CoverageFloor {
  // Must scope identically to the gate: a floor raised from an unscoped
  // measurement would sit above anything the gate can ever report.
  const totals = parseLcovTotals(scopeLcov(lcov, sourceFiles).lcov)
  return {
    lines: nextFloor(current.lines, totals.lines.pct, epsilon),
    functions: nextFloor(current.functions, totals.functions.pct, epsilon),
  }
}

async function main(): Promise<void> {
  const lcov = await readFile(STORY_COVERAGE_LCOV_PATH, 'utf8')
  const sourceFiles = await discoverScopedSourceFiles(process.cwd())
  const current = await readCoverageFloor(STORY_COVERAGE_FLOOR_PATH)
  const next = computeRatchetedFloor(lcov, sourceFiles, current, EPSILON)
  if (next.lines === current.lines && next.functions === current.functions) {
    console.log('T0 coverage floor unchanged.')
    return
  }
  await writeFile(STORY_COVERAGE_FLOOR_PATH, serializeFloor(next))
  console.log(`T0 coverage floor raised to lines ${next.lines}, functions ${next.functions}. Commit the change.`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/scripts/story-coverage-ratchet.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Wire the gate**

In `scripts/story/coverage-gate.ts`, add the import and scope the lcov before evaluating:

```ts
import {
  evaluateStoryCoverage,
  formatStoryCoverageEvaluation,
  readCoverageFloor,
  STORY_COVERAGE_FLOOR_PATH,
} from '../coverage/story-coverage-gate.js'
import { discoverScopedSourceFiles, formatStoryCoverageScope, scopeLcov } from '../coverage/story-scope.js'
import { STORY_COVERAGE_LCOV_PATH } from './reports.js'
import type { StoryRunnerSession } from './session.js'

export async function gateStoryCoverage(
  dependencies: Readonly<{ cwd: string }>,
  session: StoryRunnerSession,
  childExitCode: number,
): Promise<number> {
  const copied = await session.copyCoverage()
  if (!copied) {
    console.warn('T0 coverage requested but no lcov was produced by the child run')
    return childExitCode
  }
  const lcov = await readFile(path.join(dependencies.cwd, STORY_COVERAGE_LCOV_PATH), 'utf8')
  const sourceFiles = await discoverScopedSourceFiles(dependencies.cwd)
  const scoped = scopeLcov(lcov, sourceFiles)
  const floor = await readCoverageFloor(path.join(dependencies.cwd, STORY_COVERAGE_FLOOR_PATH))
  const evaluation = evaluateStoryCoverage(scoped.lcov, floor)
  console.log(formatStoryCoverageEvaluation(evaluation))
  console.log(formatStoryCoverageScope(scoped))
  if (!evaluation.pass && childExitCode === 0) return 1
  return childExitCode
}
```

- [ ] **Step 6: Verify the enforcement snapshot still self-contains**

Run: `bun test tests/scripts/story-enforcement-imports.test.ts`

Expected: PASS. The new `../coverage/story-scope.js` import resolves to a path Task 3 froze.

- [ ] **Step 7: Run the whole script suite and the checks**

Run: `bun test tests/scripts/ && bun run lint && bun run typecheck`

Expected: PASS.

- [ ] **Step 8: Measure the real baseline**

Requires Docker running with the pinned image.

Run: `bun test:stories:coverage`

Expected: the run completes and the gate prints two lines, then **fails** because the scoped figure is far below the committed 0.50 floor:

```
T0 story coverage: lines 43.__% (floor 50.00%), functions 37.__% (floor 50.00%)
  scope: 68_ measured, 160 unloaded seeded as 0%, 84_ files
  BELOW FLOOR: lines ... ; functions ...
```

Record the two measured percentages. This is the authoritative baseline; the spec's 43.37% / 37.06% were estimates from a stale artifact.

- [ ] **Step 9: Re-baseline the floor by hand**

`nextFloor` is monotonic-up and cannot lower a floor, so this edit is deliberate and manual. Apply the same rule it uses: `floor((measured - 0.005) * 100) / 100`.

For a measured 0.4337 lines / 0.3706 functions that gives:

```json
{
  "lines": 0.42,
  "functions": 0.36
}
```

Write the values computed from **Step 8's actual output**, not these. Then confirm the gate passes:

Run: `bun test:stories:coverage`

Expected: PASS, with the `— OK` suffix on the coverage line.

- [ ] **Step 10: Update the floor's documentation**

In `tests/CLAUDE.md`, under `### T0 story-lane line coverage`, replace this exact text:

```markdown
drops below the committed floor in `scripts/story/coverage-floor.json` (starts
at `0.50/0.50`, unmeasured). This is the refactor-resilient tier's own
```

with:

```markdown
drops below the committed floor in `scripts/story/coverage-floor.json`. The
metric excludes `tests/**` and `*.testing.ts` doubles, and counts files no
story imports as 0% rather than omitting them, so it reads lower than a
conventional coverage percentage and falls when new uncovered modules land.
This is the refactor-resilient tier's own
```

The surrounding claim that the metric is "production-code (`src/` + `plugins/`)" was aspirational before this change and becomes true with it; leave that wording alone.

- [ ] **Step 11: Commit**

```bash
git add scripts/story/coverage-gate.ts scripts/coverage/ratchet-stories.ts \
        scripts/story/coverage-floor.json tests/scripts/story-coverage-ratchet.test.ts tests/CLAUDE.md
git commit -m "feat(coverage): scope T0 story coverage to product code and seed unloaded files

The gate averaged every lcov record, including tests/**, and never saw files
no story imports, so it measured coverage of already-loaded code. Scope the
metric to src/+plugins/ and seed the 160 never-imported files as 0%.

The floor drops from 0.50 because the metric definition changed, not because
coverage regressed. Both the gate and the ratchet read through scopeLcov; if
only the gate did, the next ratchet run would raise the floor above anything
the gate could report."
```

---

## Verification

- [ ] `bun test tests/scripts/` passes.
- [ ] `bun run test` passes.
- [ ] `bun check:full` passes.
- [ ] `bun test:stories:coverage` passes and prints the scope line.
- [ ] `bun coverage:ratchet:stories` reports "unchanged" immediately after the re-baseline (the floor is already at `measured - epsilon`, rounded down).
- [ ] `bun coverage:ratchet` — the main gate — still reports 92.45% and passes, confirming `ratchet.ts` was untouched.

## Follow-ups, deliberately out of scope

- New `scripts/` files enter the mutation-testing per-file ratchet. `bun test:mutate:changed` will flag `scripts/coverage/story-scope.ts`; ratchet `scripts/mutation/baseline.json` as normal.
- Story-manifest `treeHash` changes because a frozen input was added and a frozen enforcement file edited. Any compat baseline must be re-recorded on master per `docs/architecture/commands.md`.
- Adopting `scopeLcov` in `ratchet.ts` for one repo-wide coverage definition. That moves the main gate 92.45% → 92.50% and needs `floor.json` re-baselined to 0.92.
