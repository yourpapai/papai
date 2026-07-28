<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Story Catalog Census Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the story catalog bidirectional, so a story scenario that no catalog record claims fails a test instead of drifting silently.

**Architecture:** A pure `censusStories()` function compares each tier's observed story ids against the ids the catalog claims, in both directions. Each tier supplies its own observed set — Tier 0 from the existing AST extractor, Tier 1 from `PARITY_GROUPS`, Tiers 2/3 from a new `title()`-marker scanner over glob-discovered scenario files. All 19 existing orphans are classified before the assertions are wired, so every commit is green.

**Tech Stack:** Bun test runner (`bun:test`), TypeScript (strict), `@typescript/typescript6` for AST scanning, `Bun.Glob` for file discovery.

**Spec:** `docs/superpowers/specs/2026-07-28-story-catalog-census-design.md`

## Global Constraints

- Runtime is **Bun**. Test runner is `bun:test`. No Jest, no Vitest.
- **Use the `.js` extension in every import path**, even when importing a `.ts` file.
- **Never add lint-disable or type-ignore comments.** A hook policy blocks them; fix the underlying issue.
- Every new file needs the BUSL-1.1 license header. For `.ts` files use the `//` comment style; run `bun license:headers` to add it automatically.
- Strict TypeScript. Prefer `readonly` types and `Object.freeze` for exported constants, matching the surrounding catalog code.
- The repo formats with **oxfmt** (`bun run format`), not prettier: single quotes, no semicolons. Never run prettier here.
- A pre-commit hook runs lint, typecheck, format:check, and license-headers on staged files. A failing commit means fixing the reported issue, not bypassing the hook.
- Tests under `tests/stories/**` do **not** run in the default `bun test` lane. Run them with `bun test:stories:contracts` (harness/contract tests) or `bun test:stories` (user stories).
- Adding files under `tests/stories/**` changes the refactor-qualification frozen tree hash. That is expected; see Task 9.

## Decision Log (resolved during planning)

The spec deferred one classification to the plan. It is now resolved:

**`tests/stories/integrations/plugins/eligibility.story.test.ts` gets catalog records, not exemptions.** Both scenarios assert real production behavior through `buildProviderlessToolDescriptors` and the contribution registry — a plugin whose `requiredChatCapabilities` are unmet is not offered, and contributions do not leak across lifecycle. That is catalogable behavior, so they are minted as `SCN-plugin-context-eligibility` and `SCN-plugin-contribution-isolation`.

**Consequence: `SUPPORTING_STORIES` ships empty.** That is the intended outcome, not an oversight — the exemption list exists for future stories that genuinely prove nothing catalogable, and its contract is proven by unit tests using synthetic fixtures rather than by real entries. Do not invent entries to populate it.

## Final Counts (fix these before implementing; verify at each step)

19 orphans resolve as **16 new catalog ids covering 17 stories**, plus **2 stories attached to existing records**, plus **0 exemptions**.

| Constant                            | Before | After           |
| ----------------------------------- | ------ | --------------- |
| `CATALOG_SCENARIO_IDS` length       | 175    | **191**         |
| Executable records                  | 150    | **166**         |
| Tier 0 executable records           | 111    | **127**         |
| Pending records                     | 25     | 25 (unchanged)  |
| `SCN-settings-*` executable records | 13     | **21**          |
| `SCN-coding-acp-*` records          | 18     | **21**          |
| Tier 0 observed scenarios           | 130    | 130 (unchanged) |
| Tier 0 claimed story ids            | 111    | **130**         |

Arithmetic check: 16 new records cover 17 stories (one record holds two), plus 2 attached = 19 orphans resolved. 111 + 19 = 130 = total observed.

> **Corrected during execution — this table is Tier 0 only.** It was derived from a
> Tier-0 orphan analysis that assumed the container lanes were already clean. They were
> not: on its first run, Task 7's Tier 3 census caught a real pre-existing bypass in
> `tests/platform/scenarios/mattermost-http-action.platform.ts` — a second test titled
> with a string literal instead of the `title()` helper, so it bypassed the registry and
> no record claimed it. It was minted as `SCN-http-mattermost-action-bad-signature`
> (proving tier 3). **The true end state is `CATALOG_SCENARIO_IDS` 192, executable 167,
> Tier 3 executable 3.** Every `191` / `166` / `T3 2` below is one short; the Tier 0
> figures (127, 130) are unaffected. This is the census working as designed, not drift.

## File Structure

**Create:**

- `tests/stories/catalog/census.ts` — the pure bidirectional comparison (`censusStories`), plus the one place that assembles a tier's claim and exemption sets from the live ledger (`censusTier`). No I/O.
- `tests/stories/catalog/supporting.ts` — the exemption list, its `PendingReason` construction, and the mutual-exclusion predicate.
- `tests/stories/harness/census.test.ts` — unit tests for both modules above.
- `tests/stories/harness/catalog-census.test.ts` — Tier 0 and Tier 1 census assertions.
- `tests/smoke/harness/story-markers.ts` — AST scanner for `test(title('SCN-x'), …)` markers and helper-bypass violations. Pure: takes source text, no I/O.
- `tests/smoke/harness/story-markers.test.ts` — unit tests for the scanner.
- `tests/smoke/harness/lane-census.ts` — the I/O layer for Tiers 2/3: glob-discovers scenario files, scans them, maps markers through the lane registry, and censuses. Shared by both container-lane crosschecks.

**Modify:**

- `tests/stories/catalog/coverage.ts` — 16 new ids in `CATALOG_SCENARIO_IDS`, 16 new `EXECUTABLE_STORY_MAPPINGS` entries, 2 existing mappings gain a second `storyId`, `CATALOG_SOURCE` extended.
- `tests/stories/harness/catalog-coverage.test.ts` — hardcoded totals updated.
- `tests/scripts/story-coverage-totals.test.ts` — hardcoded totals updated.
- `tests/smoke/catalog-crosscheck.test.ts` — Tier 2 census assertions.
- `tests/platform/catalog-crosscheck.test.ts` — Tier 3 census assertions.
- `tests/CLAUDE.md` — document the census.

---

### Task 1: Census core

The comparison function. Pure, so its failing test needs no disk and no fixtures.

**Files:**

- Create: `tests/stories/catalog/census.ts`
- Test: `tests/stories/harness/census.test.ts`

**Interfaces:**

- Consumes: `StoryTier` from `tests/stories/catalog/coverage.ts` (exported type, union of `'0' | '1' | '2' | '3' | '4'`).
- Produces: `censusStories(input) => StoryCensus` and the `StoryCensus` type. Task 2 wraps this as `censusTier`; the lanes call that wrapper, not this function directly.

- [ ] **Step 1: Write the failing test**

Create `tests/stories/harness/census.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { censusStories } from '../catalog/census.js'

describe('censusStories', () => {
  test('reports an observed story that no record claims as an orphan', () => {
    const census = censusStories({
      tier: '0',
      observed: ['a.story.test.ts#claimed', 'a.story.test.ts#orphan'],
      claimed: ['a.story.test.ts#claimed'],
      supporting: [],
    })

    expect(census.orphans).toEqual(['a.story.test.ts#orphan'])
    expect(census.dangling).toEqual([])
  })

  test('reports a claimed story that no lane declares as dangling', () => {
    const census = censusStories({
      tier: '0',
      observed: ['a.story.test.ts#present'],
      claimed: ['a.story.test.ts#present', 'a.story.test.ts#vanished'],
      supporting: [],
    })

    expect(census.dangling).toEqual(['a.story.test.ts#vanished'])
    expect(census.orphans).toEqual([])
  })

  test('a supporting declaration suppresses the orphan without claiming coverage', () => {
    const census = censusStories({
      tier: '0',
      observed: ['a.story.test.ts#helper'],
      claimed: [],
      supporting: ['a.story.test.ts#helper'],
    })

    expect(census.orphans).toEqual([])
    expect(census.claimed).toBe(0)
    expect(census.supporting).toBe(1)
  })

  test('a supporting id the lane never declares is dangling too', () => {
    const census = censusStories({
      tier: '2',
      observed: [],
      claimed: [],
      supporting: ['a.smoke.ts#stale'],
    })

    expect(census.dangling).toEqual(['a.smoke.ts#stale'])
  })

  test('sorts and deduplicates orphans so failure output is stable', () => {
    const census = censusStories({
      tier: '0',
      observed: ['z.story.test.ts#b', 'a.story.test.ts#a', 'z.story.test.ts#b'],
      claimed: [],
      supporting: [],
    })

    expect(census.orphans).toEqual(['a.story.test.ts#a', 'z.story.test.ts#b'])
  })

  test('carries the tier through for failure messages', () => {
    expect(censusStories({ tier: '3', observed: [], claimed: [], supporting: [] })).toEqual({
      tier: '3',
      orphans: [],
      dangling: [],
      claimed: 0,
      supporting: 0,
    })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test:stories:contracts`

Expected: FAIL — the run cannot resolve `../catalog/census.js` because the module does not exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `tests/stories/catalog/census.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { StoryTier } from './coverage.js'

/**
 * Both directions of the catalog↔lane relationship in one result.
 *
 * `dangling` covers what the per-tier forward gates already assert (a record
 * pointing at a story that does not exist); folding it in here means a lane
 * wires up one call and cannot be left half-blind.
 */
export type StoryCensus = Readonly<{
  tier: StoryTier
  /** Observed in the lane, claimed by no record and declared by no exemption. */
  orphans: readonly string[]
  /** Claimed or exempted, but the lane declares no such story. */
  dangling: readonly string[]
  claimed: number
  supporting: number
}>

export type StoryCensusInput = Readonly<{
  tier: StoryTier
  observed: readonly string[]
  claimed: readonly string[]
  supporting: readonly string[]
}>

function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort()
}

export function censusStories(input: StoryCensusInput): StoryCensus {
  const claimed = new Set(input.claimed)
  const supporting = new Set(input.supporting)
  const observed = new Set(input.observed)

  return Object.freeze({
    tier: input.tier,
    orphans: sortedUnique(input.observed.filter((id) => !claimed.has(id) && !supporting.has(id))),
    dangling: sortedUnique([...claimed, ...supporting].filter((id) => !observed.has(id))),
    claimed: claimed.size,
    supporting: supporting.size,
  })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test:stories:contracts`

Expected: PASS — 6 new tests in `census.test.ts`, everything else unchanged.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/catalog/census.ts tests/stories/harness/census.test.ts
git commit -m "test(stories): add a bidirectional story census core"
```

---

### Task 2: Supporting-story exemption list and tier wiring

The exemption list ships **empty** (see Decision Log), so its contract is expressed as a
predicate over a passed-in map rather than as an assertion over the live constant — a test
that iterates an empty object proves nothing. `doubleBookedExemptions` is exercised by
synthetic fixtures that genuinely fail when the invariant breaks, and then applied to the
real ledger.

There is deliberately **no** assertion that rationales are non-blank: `toPendingReason`
throws at module load on a blank string, so a blank rationale cannot reach the map. The
boundary test covers that invariant where it is actually enforced.

This task also adds the tier wiring — `censusTier` — so each of the four lanes calls one
function instead of assembling `claimed` and `supporting` itself.

**Files:**

- Create: `tests/stories/catalog/supporting.ts`
- Modify: `tests/stories/catalog/census.ts` (append the tier wiring)
- Modify: `tests/stories/harness/census.test.ts` (append a second `describe` block)

**Interfaces:**

- Consumes: `toPendingReason(value: string) => PendingReason` and the `PendingReason` type, both exported from `tests/stories/catalog/coverage.ts`. `PendingReason.from` throws `'Pending reason must not be empty'` on a blank string. Also `catalogCoverage` and `TIER_SUITE_ROOTS` (`Record<StoryTier, string>`, e.g. `'0' -> 'tests/stories/'`) from the same module.
- Produces: `SUPPORTING_STORIES: Readonly<Record<string, PendingReason>>`, `doubleBookedExemptions(supporting, claimed) => readonly string[]`, and `censusTier(tier, observed) => StoryCensus`. Tasks 6 and 7 call `censusTier` and nothing else.

- [ ] **Step 1: Write the failing test**

Append to `tests/stories/harness/census.test.ts` (keep the existing `describe` block above it), adding `censusTier` to the existing `../catalog/census.js` import:

```typescript
import { catalogCoverage, toPendingReason } from '../catalog/coverage.js'
import { doubleBookedExemptions, SUPPORTING_STORIES } from '../catalog/supporting.js'

describe('exemption contract', () => {
  test('names an exemption that a catalog record already claims', () => {
    expect(
      doubleBookedExemptions({ 'a.story.test.ts#x': toPendingReason('helper') }, new Set(['a.story.test.ts#x'])),
    ).toEqual(['a.story.test.ts#x'])
  })

  test('accepts an exemption that no record claims', () => {
    expect(doubleBookedExemptions({ 'a.story.test.ts#x': toPendingReason('helper') }, new Set())).toEqual([])
  })

  test('no live exemption is double-booked against the real catalog', () => {
    const claimed = new Set(
      catalogCoverage.flatMap((coverage) => (coverage.kind === 'executable' ? [...coverage.storyIds] : [])),
    )

    expect(doubleBookedExemptions(SUPPORTING_STORIES, claimed)).toEqual([])
  })

  // The non-blank-rationale invariant is enforced by construction, not by assertion:
  // toPendingReason throws before a blank rationale can reach SUPPORTING_STORIES.
  test('rejects a blank rationale at the boundary rather than at assertion time', () => {
    expect(() => toPendingReason('  ')).toThrow('Pending reason must not be empty')
  })
})

describe('censusTier', () => {
  test('reads the live ledger rather than an empty claim set', () => {
    // Guards the wiring itself: an exemption filter that matched everything, or a claim
    // filter that matched nothing, would make every lane's census meaningless.
    expect(censusTier('0', []).claimed).toBeGreaterThan(100)
    expect(censusTier('0', []).supporting).toBe(0)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test:stories:contracts`

Expected: FAIL — cannot resolve `../catalog/supporting.js`, and `censusTier` is not exported.

- [ ] **Step 3: Write the minimal implementation**

Create `tests/stories/catalog/supporting.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toPendingReason, type PendingReason } from './coverage.js'

/**
 * Stories that legitimately prove no cataloged behavior.
 *
 * The census treats an entry here as accounted-for without claiming coverage,
 * so this is the only escape hatch from the ledger. It is deliberately empty:
 * every story in the tree at the time the census landed proved real behavior
 * and earned a catalog record. Add an entry only when a scenario genuinely has
 * no catalogable behavior behind it, and say why — a rationale that could be
 * read as "I did not want to write a catalog record" belongs in a record
 * instead.
 */
const RATIONALES: Readonly<Record<string, string>> = Object.freeze({})

export const SUPPORTING_STORIES: Readonly<Record<string, PendingReason>> = Object.freeze(
  Object.fromEntries(Object.entries(RATIONALES).map(([storyId, rationale]) => [storyId, toPendingReason(rationale)])),
)

/**
 * Exemption and coverage claim are mutually exclusive: a story cannot both prove a
 * cataloged behavior and be excused from proving one. Taking both sides as parameters
 * keeps this falsifiable while the list is empty.
 */
export function doubleBookedExemptions(
  supporting: Readonly<Record<string, PendingReason>>,
  claimed: ReadonlySet<string>,
): readonly string[] {
  return Object.keys(supporting)
    .filter((storyId) => claimed.has(storyId))
    .sort()
}
```

- [ ] **Step 4: Add the tier wiring to `tests/stories/catalog/census.ts`**

Change the type-only coverage import to a value import and append the three functions:

```typescript
import { catalogCoverage, TIER_SUITE_ROOTS, type StoryTier } from './coverage.js'
import { SUPPORTING_STORIES } from './supporting.js'
```

```typescript
function claimedStoryIds(tier: StoryTier): readonly string[] {
  return catalogCoverage.flatMap((coverage) =>
    coverage.kind === 'executable' && coverage.provingTier === tier ? [...coverage.storyIds] : [],
  )
}

function exemptedStoryIds(tier: StoryTier): readonly string[] {
  return Object.keys(SUPPORTING_STORIES).filter((storyId) => storyId.startsWith(TIER_SUITE_ROOTS[tier]))
}

/**
 * Census one tier against the live ledger. Every lane calls this, so the claim and
 * exemption sets are assembled in exactly one place.
 */
export function censusTier(tier: StoryTier, observed: readonly string[]): StoryCensus {
  return censusStories({ tier, observed, claimed: claimedStoryIds(tier), supporting: exemptedStoryIds(tier) })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun test:stories:contracts`

Expected: PASS — 5 new tests, 11 total in `census.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add tests/stories/catalog/supporting.ts tests/stories/catalog/census.ts tests/stories/harness/census.test.ts
git commit -m "test(stories): add the supporting-story exemption list and tier wiring"
```

---

### Task 3: Tier 2/3 story-marker scanner

Scans `.smoke.ts` / `.platform.ts` sources for `test(title('SCN-x'), …)` and flags any `test(…)` that bypasses the `title()` helper with a literal.

**Files:**

- Create: `tests/smoke/harness/story-markers.ts`
- Test: `tests/smoke/harness/story-markers.test.ts`

**Interfaces:**

- Consumes: `ts` from `@typescript/typescript6` (already a dependency; `scripts/story/scenarios.ts` uses the same import).
- Produces: `scanStoryMarkers(filePath: string, source: string) => StoryMarkerScan` where `StoryMarkerScan` is `Readonly<{ keys: readonly string[]; violations: readonly string[] }>`. Task 7 calls this.

- [ ] **Step 1: Write the failing test**

Create `tests/smoke/harness/story-markers.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { scanStoryMarkers } from './story-markers.js'

describe('scanStoryMarkers', () => {
  test('extracts the registry key from a title() marker', () => {
    const source = `
      describe('lane', () => {
        test(title('SCN-boot-serve-empty-db'), async () => {})
      })
    `

    expect(scanStoryMarkers('a.smoke.ts', source)).toEqual({
      keys: ['SCN-boot-serve-empty-db'],
      violations: [],
    })
  })

  test('flags a test that bypasses the title helper with a literal', () => {
    const source = `test('boots and serves', async () => {})`
    const scan = scanStoryMarkers('a.smoke.ts', source)

    expect(scan.keys).toEqual([])
    expect(scan.violations).toEqual(["a.smoke.ts: 'boots and serves'"])
  })

  test('reads markers through test modifiers and a timeout argument', () => {
    const source = `
      test.skipIf(process.env['CI'] === 'true')(title('SCN-graceful-shutdown'), async () => {}, 30_000)
      test.skip(title('SCN-required-env-admin'), async () => {})
    `

    expect(scanStoryMarkers('a.smoke.ts', source).keys).toEqual(['SCN-graceful-shutdown', 'SCN-required-env-admin'])
  })

  test('flags a title() call whose key is not a string literal', () => {
    const source = `test(title(key), async () => {})`

    expect(scanStoryMarkers('a.smoke.ts', source).violations).toEqual(['a.smoke.ts: title(key)'])
  })

  test('ignores non-test calls that take a string first argument', () => {
    const source = `
      describe('lane', () => {
        expect('x').toBe('x')
      })
    `

    expect(scanStoryMarkers('a.smoke.ts', source)).toEqual({ keys: [], violations: [] })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/smoke/harness/story-markers.test.ts`

Expected: FAIL — cannot resolve `./story-markers.js`.

- [ ] **Step 3: Write the minimal implementation**

Create `tests/smoke/harness/story-markers.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import ts from '@typescript/typescript6'

/**
 * Tier 2/3 scenario files name their tests through a local `title()` helper that
 * reads the registry, so an unregistered scenario has no title to use — unless
 * an author bypasses the helper and passes a literal. `violations` is what makes
 * that bypass fail a test instead of going unnoticed.
 */
export type StoryMarkerScan = Readonly<{ keys: readonly string[]; violations: readonly string[] }>

/** Matches `test(...)`, `test.skip(...)`, and `test.skipIf(cond)(...)`. */
function isTestCall(expression: ts.Expression): boolean {
  if (ts.isIdentifier(expression)) return expression.text === 'test'
  if (ts.isPropertyAccessExpression(expression)) return isTestCall(expression.expression)
  if (ts.isCallExpression(expression)) return isTestCall(expression.expression)
  return false
}

function markerKey(argument: ts.Expression | undefined): string | undefined {
  if (argument === undefined || !ts.isCallExpression(argument)) return undefined
  if (!ts.isIdentifier(argument.expression) || argument.expression.text !== 'title') return undefined
  const [key] = argument.arguments
  return key !== undefined && ts.isStringLiteral(key) ? key.text : undefined
}

export function scanStoryMarkers(filePath: string, source: string): StoryMarkerScan {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true)
  const keys: string[] = []
  const violations: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTestCall(node.expression)) {
      const [first] = node.arguments
      const key = markerKey(first)
      if (key === undefined) {
        violations.push(`${filePath}: ${first === undefined ? '<no title argument>' : first.getText(sourceFile)}`)
      } else {
        keys.push(key)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return Object.freeze({ keys, violations })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test tests/smoke/harness/story-markers.test.ts`

Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add tests/smoke/harness/story-markers.ts tests/smoke/harness/story-markers.test.ts
git commit -m "test(smoke): scan lane scenario files for story title markers"
```

---

### Task 4: Mint the ten ids the story titles already declare

Ten orphan scenarios carry titles already following the `SCN-<id>: <description>` convention — the author named a catalog id and never added the record. This task is mechanical: mint each declared id and point it at its story.

**Files:**

- Modify: `tests/stories/catalog/coverage.ts` (`CATALOG_SCENARIO_IDS`, `EXECUTABLE_STORY_MAPPINGS`, `CATALOG_SOURCE`)
- Modify: `tests/stories/harness/catalog-coverage.test.ts` (totals)
- Modify: `tests/scripts/story-coverage-totals.test.ts` (totals)

**Interfaces:**

- Consumes: `ExecutableStoryMapping` shape from `coverage.ts` — `Readonly<{ verifiedAt: string; provingTier?: StoryTier; storyIds: NonEmptyReadonlyTuple<string> }>`. Omitting `provingTier` means Tier 0, which is correct for every id in this task.
- Produces: 10 catalog ids consumed by the Task 6 census.

- [ ] **Step 1: Record the starting orphan count**

Run:

```bash
bun -e '
const { loadCandidateStoryFiles } = await import("./scripts/story/inputs.ts")
const { extractStoryScenarios } = await import("./scripts/story/scenarios.ts")
const { catalogCoverage } = await import("./tests/stories/catalog/coverage.ts")
const files = await loadCandidateStoryFiles(process.cwd())
const observed = files.flatMap(({ path, bytes }) => extractStoryScenarios(path, bytes).map((s) => s.id))
const claimed = new Set(catalogCoverage.flatMap((c) => (c.kind === "executable" && c.provingTier === "0" ? [...c.storyIds] : [])))
const orphans = observed.filter((id) => !claimed.has(id))
console.log("observed", observed.length, "claimed", claimed.size, "orphans", orphans.length)
for (const id of orphans.sort()) console.log("  " + id)
'
```

Expected: `observed 130 claimed 111 orphans 19`.

This snippet is the verification tool for Tasks 4 and 5. Keep it handy; it is not committed.

- [ ] **Step 2: Add the ten ids to `CATALOG_SCENARIO_IDS`**

In `tests/stories/catalog/coverage.ts`, append to the `CATALOG_SCENARIO_IDS` array, immediately before the closing `])`:

```typescript
  'SCN-http-settings-auth-validation',
  'SCN-http-dashboard-debug-gate',
  'SCN-http-debug-protected-surfaces',
  'SCN-settings-api-tools',
  'SCN-settings-api-byok',
  'SCN-settings-api-memory',
  'SCN-settings-api-plugins',
  'SCN-settings-api-mcp',
  'SCN-settings-api-group',
  'SCN-settings-api-release',
```

- [ ] **Step 3: Add the ten mappings**

In the same file, append to `EXECUTABLE_STORY_MAPPINGS`, before its closing `}`:

```typescript
  'SCN-http-settings-auth-validation': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/http/auth-claim.story.test.ts#SCN-http-settings-auth-validation: malformed exchanges and invalid logout sessions are rejected',
    ],
  },
  'SCN-http-dashboard-debug-gate': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/http/dashboard.story.test.ts#SCN-http-dashboard-debug-gate: debug paths and the legacy dashboard redirect are hidden when disabled',
    ],
  },
  'SCN-http-debug-protected-surfaces': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/http/dashboard.story.test.ts#SCN-http-debug-protected-surfaces: enabled diagnostic reads still require a dashboard session',
    ],
  },
  'SCN-settings-api-tools': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-tools: tool permissions reject untrusted writes and round-trip a domain setting',
    ],
  },
  'SCN-settings-api-byok': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-byok: BYOK writes stay in the caller context and never disclose the submitted secret',
    ],
  },
  'SCN-settings-api-memory': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-memory: invalid memory updates leave the view unchanged and valid capture writes persist',
    ],
  },
  'SCN-settings-api-plugins': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-plugins: plugin config rejects unknown keys and persists an authorized plugin selection',
    ],
  },
  'SCN-settings-api-mcp': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-mcp: endpoint validation preserves prior state and masks persisted authorization headers',
    ],
  },
  'SCN-settings-api-group': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-group: only a group administrator can update the group guest-mode setting',
    ],
  },
  'SCN-settings-api-release': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/settings/debug-settings-api.story.test.ts#SCN-settings-api-release: only a group administrator can change a group release subscription',
    ],
  },
```

- [ ] **Step 4: Extend `CATALOG_SOURCE`**

In `tests/stories/catalog/coverage.ts`, append to the `CATALOG_SOURCE` string, before the closing quote:

```
; extended 2026-07-28 with 16 previously uncataloged story ids (story-catalog-census)
```

- [ ] **Step 5: Run the verification snippet**

Run the Step 1 snippet again.

Expected: `observed 130 claimed 121 orphans 9` — the nine originals from the spec.

- [ ] **Step 6: Update the hardcoded totals**

In `tests/stories/harness/catalog-coverage.test.ts`, in the test `'classifies every catalog scenario exactly once'`, change both `175` values to `185`:

```typescript
expect(CATALOG_SCENARIO_IDS).toHaveLength(185)
expect(new Set(CATALOG_SCENARIO_IDS).size).toBe(185)
```

In `'tracks the executable coverage total'` and `'stamps every executable record with a live proving tier'`, change every `150` to `160` (three occurrences across the two tests).

In `'stamps settings catalog records with their verification date'`, the seven new `SCN-settings-api-*` ids now match its `startsWith('SCN-settings-')` filter and carry a different date. Replace the test body with:

```typescript
test('stamps settings catalog records with their verification date', () => {
  const settingsCoverage = catalogCoverage
    .filter((coverage) => coverage.kind === 'executable')
    .filter((coverage) => coverage.scenarioId.startsWith('SCN-settings-'))
  const mcpScenarioIds = new Set(['SCN-settings-admin-mcp-catalog', 'SCN-settings-admin-mcp-plugin-servers'])
  const censusScenarioIds = new Set(
    settingsCoverage
      .map(({ scenarioId }) => scenarioId)
      .filter((scenarioId) => scenarioId.startsWith('SCN-settings-api-')),
  )
  const mcpCoverage = settingsCoverage.filter((coverage) => mcpScenarioIds.has(coverage.scenarioId))
  const censusCoverage = settingsCoverage.filter((coverage) => censusScenarioIds.has(coverage.scenarioId))
  const otherCoverage = settingsCoverage.filter(
    (coverage) => !mcpScenarioIds.has(coverage.scenarioId) && !censusScenarioIds.has(coverage.scenarioId),
  )

  expect(settingsCoverage).toHaveLength(20)
  expect(censusCoverage).toHaveLength(7)
  for (const coverage of mcpCoverage) expect(coverage.verifiedAt).toBe('2026-07-22')
  for (const coverage of censusCoverage) expect(coverage.verifiedAt).toBe('2026-07-28')
  for (const coverage of otherCoverage) expect(coverage.verifiedAt).toBe('2026-07-18')
})
```

In `tests/scripts/story-coverage-totals.test.ts`, update both tests:

```typescript
expect(storyCoverageTotals()).toEqual({
  total: 185,
  executable: 160,
  pending: 25,
  readiness: { 'executable-as-is': 0, 'needs-seam': 3, blocked: 22 },
  executableByTier: { '0': 121, '1': 29, '2': 8, '3': 2, '4': 0 },
  pendingByUnblockingTier: { '0': 0, '1': 0, '2': 0, '3': 3, '4': 0 },
})
```

```typescript
expect(formatStoryCoverageTotals()).toBe(
  'story catalog: 160/185 executable (T0 121, T1 29, T2 8, T3 2, T4 0); ' +
    'pending 25 (0 executable-as-is, 3 needs-seam, 22 blocked); ' +
    'pending unblocked by tier (T0 0, T1 0, T2 0, T3 3, T4 0)',
)
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `bun test tests/scripts/story-coverage-totals.test.ts && bun test:stories:contracts`

Expected: PASS on both.

- [ ] **Step 8: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): catalog the ten stories whose titles already declared an id"
```

---

### Task 5: Classify the nine remaining orphans

Six new ids for behavior no record covers, and two stories attached to records that already describe what they prove.

**Files:**

- Modify: `tests/stories/catalog/coverage.ts`
- Modify: `tests/stories/harness/catalog-coverage.test.ts`
- Modify: `tests/scripts/story-coverage-totals.test.ts`

**Interfaces:**

- Consumes: same `ExecutableStoryMapping` shape as Task 4.
- Produces: the final catalog state the Task 6 census asserts against.

- [ ] **Step 1: Add the six ids to `CATALOG_SCENARIO_IDS`**

Append to the array, after the ten added in Task 4:

```typescript
  'SCN-coding-acp-mcp-fail-closed',
  'SCN-coding-acp-upstream-failure',
  'SCN-coding-acp-tool-eligibility',
  'SCN-settings-task-instance-assignment',
  'SCN-plugin-context-eligibility',
  'SCN-plugin-contribution-isolation',
```

- [ ] **Step 2: Add the six mappings**

Append to `EXECUTABLE_STORY_MAPPINGS`. Note the first record carries **two** story ids — both scenarios prove the same fail-closed behavior from different inputs:

```typescript
  'SCN-coding-acp-mcp-fail-closed': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts#an unresolved MCP selection fails closed before Magi session startup',
      'tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts#malformed MCP settings fail closed before Magi session startup',
    ],
  },
  'SCN-coding-acp-upstream-failure': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#configured ACP upstream failure does not persist a session or expose credentials',
    ],
  },
  'SCN-coding-acp-tool-eligibility': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/integrations/runtime-extensions/tool-eligibility.story.test.ts#runtime extension ACP tool is offered and executed only in its eligible context',
    ],
  },
  'SCN-settings-task-instance-assignment': {
    verifiedAt: '2026-07-28',
    storyIds: [
      'tests/stories/settings/task-instance-assignment.story.test.ts#settings task assignment changes the provider used by the next chat turn',
    ],
  },
  'SCN-plugin-context-eligibility': {
    verifiedAt: '2026-07-28',
    storyIds: ['tests/stories/integrations/plugins/eligibility.story.test.ts#plugin context eligibility'],
  },
  'SCN-plugin-contribution-isolation': {
    verifiedAt: '2026-07-28',
    storyIds: ['tests/stories/integrations/plugins/eligibility.story.test.ts#plugin isolation after lifecycle'],
  },
```

- [ ] **Step 3: Attach the two stories to their existing records**

Two orphans prove behavior an existing record already describes; they become second story ids rather than new records.

**Append each new id after the existing one.** The ACP test asserts `storyIds[0]` against
`ACP_CATALOG_STORY_IDS`, so reordering `SCN-coding-acp-start-fresh` would fail it.

Find the `'SCN-task-create-update'` entry in `EXECUTABLE_STORY_MAPPINGS` (its current single id
is `…/tasks/lifecycle-and-policy.story.test.ts#SCN-task-create-update: creates and renames a task
through the tool loop`) and append to its `storyIds` array:

```typescript
      'tests/stories/chat-task/create-and-read-task.story.test.ts#creates and reads a task through the real chat tool loop',
```

Find the `'SCN-coding-acp-start-fresh'` entry (its current single id is
`…/coding-sessions/module-qualification.story.test.ts#SCN-coding-acp-start-fresh: starts a
configured session through the real ACP tool loop`) and append:

```typescript
      'tests/stories/integrations/coding-sessions/start-session.story.test.ts#starts a coding session through the real capability and tool loop',
```

- [ ] **Step 4: Run the verification snippet**

Run the snippet from Task 4 Step 1.

Expected: `observed 130 claimed 130 orphans 0`.

- [ ] **Step 5: Update the hardcoded totals**

In `tests/stories/harness/catalog-coverage.test.ts`:

- `'classifies every catalog scenario exactly once'`: change both `185` values to `191`.
- `'tracks the executable coverage total'` and `'stamps every executable record with a live proving tier'`: change every `160` to `166`.
- `'stamps settings catalog records with their verification date'`: change `toHaveLength(20)` to `toHaveLength(21)` (the new `SCN-settings-task-instance-assignment` matches the prefix filter). It carries `verifiedAt: '2026-07-28'` but does **not** start with `SCN-settings-api-`, so extend the census set to match both:

```typescript
const censusScenarioIds = new Set(
  settingsCoverage
    .map(({ scenarioId }) => scenarioId)
    .filter(
      (scenarioId) =>
        scenarioId.startsWith('SCN-settings-api-') || scenarioId === 'SCN-settings-task-instance-assignment',
    ),
)
```

and change `expect(censusCoverage).toHaveLength(7)` to `toHaveLength(8)`.

- `'maps every ACP catalog record to its literal executable story'`: three new `SCN-coding-acp-*` ids now match its filter. Change both `toHaveLength(18)` calls to `toHaveLength(21)`, and add three entries to the `ACP_CATALOG_STORY_IDS` constant near the top of the file (the assertion compares `storyIds[0]`, so the two-story record lists only its first):

```typescript
  'SCN-coding-acp-mcp-fail-closed':
    'tests/stories/integrations/coding-sessions/acp-mcp.story.test.ts#an unresolved MCP selection fails closed before Magi session startup',
  'SCN-coding-acp-upstream-failure':
    'tests/stories/integrations/coding-sessions/module-qualification.story.test.ts#configured ACP upstream failure does not persist a session or expose credentials',
  'SCN-coding-acp-tool-eligibility':
    'tests/stories/integrations/runtime-extensions/tool-eligibility.story.test.ts#runtime extension ACP tool is offered and executed only in its eligible context',
```

In `tests/scripts/story-coverage-totals.test.ts`, update to the final numbers:

```typescript
expect(storyCoverageTotals()).toEqual({
  total: 191,
  executable: 166,
  pending: 25,
  readiness: { 'executable-as-is': 0, 'needs-seam': 3, blocked: 22 },
  executableByTier: { '0': 127, '1': 29, '2': 8, '3': 2, '4': 0 },
  pendingByUnblockingTier: { '0': 0, '1': 0, '2': 0, '3': 3, '4': 0 },
})
```

```typescript
expect(formatStoryCoverageTotals()).toBe(
  'story catalog: 166/191 executable (T0 127, T1 29, T2 8, T3 2, T4 0); ' +
    'pending 25 (0 executable-as-is, 3 needs-seam, 22 blocked); ' +
    'pending unblocked by tier (T0 0, T1 0, T2 0, T3 3, T4 0)',
)
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bun test tests/scripts/story-coverage-totals.test.ts && bun test:stories:contracts`

Expected: PASS on both. The catalog is now a complete census of Tier 0 — but nothing enforces that yet.

- [ ] **Step 7: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): catalog the nine remaining uncataloged stories"
```

---

### Task 6: Wire the Tier 0 and Tier 1 census

The assertions that keep the ledger honest from here on.

**Files:**

- Create: `tests/stories/harness/catalog-census.test.ts`

**Interfaces:**

- Consumes: `censusTier(tier, observed)` (Task 2), `loadCandidateStoryFiles(root)` from `scripts/story/inputs.ts` returning `Promise<readonly { path: string; bytes: Uint8Array }[]>`, `extractStoryScenarios(path, bytes)` from `scripts/story/scenarios.ts` returning `readonly { id: string; checkpoints: readonly string[] }[]`, and `PARITY_GROUPS` from `tests/stories/harness/parity/expectations.ts` (each group has `id` and `title`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the test**

Create `tests/stories/harness/catalog-census.test.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import nodePath from 'node:path'

import { loadCandidateStoryFiles } from '../../../scripts/story/inputs.js'
import { extractStoryScenarios } from '../../../scripts/story/scenarios.js'
import { censusTier } from '../catalog/census.js'
import { PARITY_GROUPS } from './parity/expectations.js'

// A story scenario that no catalog record claims is a coverage claim nobody
// made. Two legal remedies when this fails:
//   1. add the story id to the record it proves, in EXECUTABLE_STORY_MAPPINGS
//      (a record may hold several story ids), minting a new SCN id if no
//      record describes the behavior; or
//   2. declare it in SUPPORTING_STORIES with a rationale, if it genuinely
//      proves no cataloged behavior.
// Do not silence this by deleting the scenario from the census input.

// This suite also runs from a read-only snapshot whose root sits three levels
// above the harness directory, so the story root is resolved rather than assumed.
// `tests/stories/harness/catalog-coverage.test.ts` resolves it the same way.
function resolveStoryContractRoot(harnessDirectory: string): string {
  return nodePath.resolve(harnessDirectory, '../../..')
}

describe('story catalog census', () => {
  test('every Tier 0 story scenario is claimed by a record or declared supporting', async () => {
    const files = await loadCandidateStoryFiles(resolveStoryContractRoot(import.meta.dir))
    const observed = files.flatMap(({ path, bytes }) => extractStoryScenarios(path, bytes).map(({ id }) => id))

    const census = censusTier('0', observed)

    expect(census.orphans).toEqual([])
    expect(census.dangling).toEqual([])
  })

  test('every Tier 1 parity group is claimed by a record', () => {
    const observed = PARITY_GROUPS.map((group) => `tests/e2e/parity/provider-parity.test.ts#${group.title}`)

    const census = censusTier('1', observed)

    expect(census.orphans).toEqual([])
    expect(census.dangling).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `bun test:stories:contracts`

Expected: PASS. It passes on the first run because Tasks 4 and 5 already emptied the orphan set — the census mechanism itself went red-then-green under unit test in Task 1.

- [ ] **Step 3: Verify the gate actually bites**

Temporarily add a throwaway scenario to any story file, for example at the end of `tests/stories/context/thread-scope.story.test.ts`:

```typescript
scenario('census smoke check: delete me', async () => {})
```

Run: `bun test:stories:contracts`

Expected: FAIL, naming the orphan:

```
tests/stories/context/thread-scope.story.test.ts#census smoke check: delete me
```

Now **revert that edit** (`git checkout tests/stories/context/thread-scope.story.test.ts`) and re-run to confirm PASS. Do not commit the throwaway scenario.

- [ ] **Step 4: Commit**

```bash
git add tests/stories/harness/catalog-census.test.ts
git commit -m "test(stories): assert the Tier 0 and Tier 1 catalog census"
```

---

### Task 7: Wire the Tier 2 and Tier 3 census

Same comparison for the container lanes, plus the helper-bypass check that keeps their registry-derived titles trustworthy. The two lanes differ only in glob, registry, and tier, so the scan-and-compare lives in one helper and each crosscheck supplies its three parameters.

**Files:**

- Create: `tests/smoke/harness/lane-census.ts`
- Modify: `tests/smoke/catalog-crosscheck.test.ts`
- Modify: `tests/platform/catalog-crosscheck.test.ts`

**Interfaces:**

- Consumes: `scanStoryMarkers` (Task 3), `censusTier` and the `StoryCensus` type (Tasks 1-2), `repoRoot()` from `tests/smoke/harness/docker.ts` (returns an absolute path **with a trailing slash**), `SMOKE_STORY_IDS` / `PLATFORM_STORY_IDS` (`Record<string, string>` mapping scenario id to full story id).
- Produces: `censusMarkedLane(input) => Promise<MarkedLaneCensus>`, used by both crosschecks.

- [ ] **Step 1: Write the shared lane helper**

Create `tests/smoke/harness/lane-census.ts`:

```typescript
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { censusTier, type StoryCensus } from '../../stories/catalog/census.js'
import type { StoryTier } from '../../stories/catalog/coverage.js'
import { repoRoot } from './docker.js'
import { scanStoryMarkers } from './story-markers.js'

export type MarkedLaneCensus = Readonly<{
  census: StoryCensus
  /** Marker keys with no registry entry: the scenario runs, but no lane record names it. */
  unregistered: readonly string[]
  /** Tests that named themselves without going through the `title()` helper. */
  violations: readonly string[]
}>

/**
 * Discovery is by glob, not by walking the registry: a scenario file nobody
 * registered has to be visible, and iterating the registry would never see it.
 */
export async function censusMarkedLane(
  input: Readonly<{ tier: StoryTier; glob: string; registry: Readonly<Record<string, string>> }>,
): Promise<MarkedLaneCensus> {
  const observed: string[] = []
  const unregistered: string[] = []
  const violations: string[] = []

  for await (const file of new Bun.Glob(input.glob).scan({ cwd: repoRoot() })) {
    const scan = scanStoryMarkers(file, await Bun.file(`${repoRoot()}${file}`).text())
    violations.push(...scan.violations)
    for (const key of scan.keys) {
      const storyId = input.registry[key]
      if (storyId === undefined) unregistered.push(`${file}#${key}`)
      else observed.push(storyId)
    }
  }

  return Object.freeze({ census: censusTier(input.tier, observed), unregistered, violations })
}
```

- [ ] **Step 2: Add the Tier 2 census test**

Append to the `describe('@2 catalog crosscheck', …)` block in `tests/smoke/catalog-crosscheck.test.ts`:

```typescript
test('every @2 scenario marker is registered and claimed, and none bypasses title()', async () => {
  const { census, unregistered, violations } = await censusMarkedLane({
    tier: '2',
    glob: 'tests/smoke/scenarios/*.smoke.ts',
    registry: SMOKE_STORY_IDS,
  })

  // A marker with no SMOKE_STORIES entry, a test that skips the title() helper,
  // or a scenario no catalog record claims — each would be coverage nobody
  // declared. Add the registry entry and the catalog record.
  expect(unregistered).toEqual([])
  expect(violations).toEqual([])
  expect(census.orphans).toEqual([])
  expect(census.dangling).toEqual([])
})
```

Add this import at the top of the file:

```typescript
import { censusMarkedLane } from './harness/lane-census.js'
```

- [ ] **Step 3: Run the Tier 2 test to verify it passes**

Run: `bun test tests/smoke/catalog-crosscheck.test.ts`

Expected: PASS — 3 tests. This file runs in the default lane and boots no containers.

- [ ] **Step 4: Add the Tier 3 census test**

Append to the `describe('@3 catalog crosscheck', …)` block in `tests/platform/catalog-crosscheck.test.ts`:

```typescript
test('every @3 scenario marker is registered and claimed, and none bypasses title()', async () => {
  const { census, unregistered, violations } = await censusMarkedLane({
    tier: '3',
    glob: 'tests/platform/scenarios/*.platform.ts',
    registry: PLATFORM_STORY_IDS,
  })

  expect(unregistered).toEqual([])
  expect(violations).toEqual([])
  expect(census.orphans).toEqual([])
  expect(census.dangling).toEqual([])
})
```

Add this import at the top of the file:

```typescript
import { censusMarkedLane } from '../smoke/harness/lane-census.js'
```

- [ ] **Step 5: Run the Tier 3 test to verify it passes**

Run: `bun test tests/platform/catalog-crosscheck.test.ts`

Expected: PASS — 3 tests.

- [ ] **Step 6: Verify the bypass check bites**

Temporarily change one test in `tests/smoke/scenarios/container-p.smoke.ts` from `test(title('SCN-boot-serve-empty-db'), …)` to `test('boots and serves', …)`.

Run: `bun test tests/smoke/catalog-crosscheck.test.ts`

Expected: FAIL on both `violations` (the literal title) and `census.dangling` (the record whose story is no longer declared).

Revert the edit (`git checkout tests/smoke/scenarios/container-p.smoke.ts`) and re-run to confirm PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/smoke/harness/lane-census.ts tests/smoke/catalog-crosscheck.test.ts tests/platform/catalog-crosscheck.test.ts
git commit -m "test(smoke,platform): assert the Tier 2 and Tier 3 catalog census"
```

---

### Task 8: Document the census

**Files:**

- Modify: `tests/CLAUDE.md`

- [ ] **Step 1: Add the census to the E2E testing notes**

In `tests/CLAUDE.md`, find the bullet beginning "Every catalog record carries a **proving tier**" and add this bullet immediately after it:

```markdown
- The catalog is **bidirectional**. Alongside the forward check (every record points at a
  real story), a census asserts the reverse: every story scenario a lane declares is either
  claimed by a record or listed in `tests/stories/catalog/supporting.ts` with a rationale.
  Tier 0 observes `scenario(...)` calls, Tier 1 observes `PARITY_GROUPS`, and Tiers 2/3
  observe `title(...)` markers in glob-discovered `.smoke.ts` / `.platform.ts` files —
  which also fails any test that bypasses the `title()` helper. Writing a story therefore
  requires a catalog decision at authoring time; an uncataloged scenario fails
  `bun test:stories:contracts` (T0/T1) or the default `bun test` lane (T2/T3).
```

- [ ] **Step 2: Verify the docs check passes**

Run: `bun run format:check && bun run lint`

Expected: PASS on both.

- [ ] **Step 3: Commit**

```bash
git add tests/CLAUDE.md
git commit -m "docs(tests): document the bidirectional catalog census"
```

---

### Task 9: Full verification and frozen-tree rebaseline

New files under `tests/stories/**` change the refactor-qualification frozen tree hash. This task confirms the whole suite is green and records what a downstream refactor needs.

- [ ] **Step 1: Run the full local check**

Run: `bun check:full`

Expected: PASS. If the coverage ratchet complains, note that this plan adds no production code — investigate rather than lowering the floor.

- [ ] **Step 2: Run every story lane**

Run: `bun test:stories:contracts && bun test:stories`

Expected: PASS on both. The story lane should report the same scenario count as before this work (130 Tier 0 scenarios); the census adds contract tests, not stories.

- [ ] **Step 3: Confirm the per-tier totals line**

Run: `bun test tests/scripts/story-coverage-totals.test.ts`

Expected: PASS, with the formatted line reading `story catalog: 166/191 executable (T0 127, T1 29, T2 8, T3 2, T4 0); …`.

- [ ] **Step 4: Record the rebaseline requirement**

The frozen story-input tree now includes `tests/stories/catalog/census.ts`,
`tests/stories/catalog/supporting.ts`, `tests/stories/harness/census.test.ts`, and
`tests/stories/harness/catalog-census.test.ts`. Any in-flight refactor qualification must
be rebased onto a master commit containing these files, with a fresh manifest `treeHash`
and baseline SHA recorded. `scripts/story/**` is untouched, so the sandbox snapshot's
import-reachability guard (`tests/scripts/story-enforcement-imports.test.ts`) needs no
change — confirm it still passes:

Run: `bun test tests/scripts/story-enforcement-imports.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit any remaining changes**

```bash
git status --short
```

Expected: clean. If anything is outstanding, commit it with a message describing what it fixes.

---

## Notes for the implementer

**The orphan count is a moving target.** This plan fixes it at 19, measured at commit
`6f4a9ed3b`. Ten of those landed during the half-day the design was written. Run the Task 4
Step 1 snippet before starting: if it reports more than 19, new stories landed since, and
the extra orphans need classifying too — mint the id the title declares if it follows the
`SCN-<id>: <description>` convention, otherwise judge it against the story body. Update the
counts table at the top of this plan when that happens; every hardcoded total in Tasks 4
and 5 shifts by the same amount.

**Do not populate `SUPPORTING_STORIES` to make a failure go away.** It is the one escape
hatch, and a rationale that amounts to "no record described this" means the record is
missing, not that the story is supporting.
