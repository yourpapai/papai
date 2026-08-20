<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Global Refactor Coverage Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a green Tier 0 qualification baseline and add an enforceable ledger that maps every documented implemented behavior to scenario evidence or an explicit exception.

**Architecture:** Keep the existing scenario catalog as the source of scenario-to-tier claims. Add a behavior ledger beside it that owns behavior provenance, implementation state, required coverage dimensions, and catalog links. A contract suite cross-checks the two ledgers; coverage diagnostics make a below-floor result actionable without changing the ratchet or the frozen-harness compatibility model.

**Tech Stack:** Bun 1.3.13, TypeScript, `bun:test`, existing hermetic story sandbox, JSON lcov, Git manifest compatibility checks.

## Global Constraints

- Keep the Tier 0 floors at `lines: 0.71` and `functions: 0.70`; do not lower either value.
- Treat `tests/stories/**`, `scripts/story/**`, coverage gate inputs, and test preloads as frozen compatibility inputs; establish new baselines on master before candidate refactors use them.
- Preserve Tier 0 as the only frozen compatibility proof. T1-T4 are regression lanes selected by changed runtime surfaces.
- Use `.js` extensions in TypeScript imports and strict TypeScript without lint/type suppressions.
- Add ledger entries for every implemented documented behavior. `blocked:missing-implementation` and `retired` entries never count as evidence.
- Every scenario must have a user-visible oracle and a system oracle; no retry masks flaky evidence.

---

## File Structure

- Create: `tests/stories/catalog/behaviors.ts` — typed documented-behavior ledger, source provenance, required matrix dimensions, and catalog scenario references.
- Create: `tests/stories/catalog/behavior-inventory.ts` — curated stable IDs for the documented behavior inventory, grouped by source section.
- Create: `tests/stories/harness/behavior-coverage.test.ts` — ledger contract tests and deterministic missing/invalid-entry diagnostics.
- Create: `scripts/coverage/story-coverage-report.ts` — parses scoped lcov and reports per-file uncovered line/function counts in deterministic order.
- Create: `tests/scripts/story-coverage-report.test.ts` — focused tests for the coverage report formatter and sort behavior.
- Modify: `scripts/story/coverage-gate.ts` — prints the new diagnostic report when coverage is below the existing floor.
- Modify: `tests/stories/catalog/coverage.ts` — exports the existing catalog scenario-id set for behavior-ledger validation without duplicating IDs.
- Modify: `tests/stories/harness/catalog-coverage.test.ts` — removes only assertions made redundant by the new behavior-ledger contract; retains catalog-to-story and tier-root checks.
- Modify: `docs/architecture/behaviors.md` — add stable behavior markers next to each documented behavior declaration so the ledger has durable source anchors.
- Modify: `docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md` — append actual baseline SHA/tree-hash and measured coverage after the baseline task succeeds.

## Follow-On Plan Boundaries

This plan does not add runtime stories. After this foundation lands, create separate plans in this order:

1. Tier 0 run-control and live-status behavior coverage.
2. Tier 0 identity provisioning, blocking, alerts, and participant-resolution coverage.
3. Tier 0 release-note and analytics-governance coverage.
4. T1 provider parity closure and T2 process-real matrix expansion.
5. T3 adapter behavior and T4 clock/recovery coverage.
6. Changed-surface-to-lane admission mapping and CI enforcement.

### Task 1: Add deterministic below-floor coverage diagnostics

**Files:**
- Create: `scripts/coverage/story-coverage-report.ts`
- Create: `tests/scripts/story-coverage-report.test.ts`
- Modify: `scripts/story/coverage-gate.ts:19-37`

**Interfaces:**
- Consumes: scoped lcov text produced by `scopeLcov()` and the existing `StoryCoverageEvaluation`.
- Produces: `formatStoryCoverageReport(lcov: string, limit?: number): string`, returning the highest-risk uncovered production files with missed line/function counts.
- Produces: an unchanged coverage-gate exit policy: a passing child with a below-floor evaluation exits `1`.

- [ ] **Step 1: Write the failing formatter tests**

```ts
import { describe, expect, test } from 'bun:test'

import { formatStoryCoverageReport } from '../../scripts/coverage/story-coverage-report.js'

describe('formatStoryCoverageReport', () => {
  test('orders files by missing lines, then missing functions, then path', () => {
    const lcov = [
      'SF:src/b.ts', 'FNF:2', 'FNH:1', 'DA:1,0', 'DA:2,1', 'end_of_record',
      'SF:src/a.ts', 'FNF:2', 'FNH:0', 'DA:1,0', 'DA:2,0', 'end_of_record',
    ].join('\n')

    expect(formatStoryCoverageReport(lcov)).toContain('src/a.ts lines 0/2 functions 0/2')
    expect(formatStoryCoverageReport(lcov).indexOf('src/a.ts')).toBeLessThan(formatStoryCoverageReport(lcov).indexOf('src/b.ts'))
  })

  test('returns a stable no-uncovered message when every record is covered', () => {
    const lcov = ['SF:src/a.ts', 'FNF:1', 'FNH:1', 'DA:1,1', 'end_of_record'].join('\n')
    expect(formatStoryCoverageReport(lcov)).toBe('T0 uncovered production files: none')
  })
})
```

- [ ] **Step 2: Run the formatter test to verify it fails**

Run: `bun test tests/scripts/story-coverage-report.test.ts`

Expected: FAIL because `story-coverage-report.js` does not exist.

- [ ] **Step 3: Implement the pure lcov report module**

```ts
type FileCoverage = Readonly<{ path: string; linesFound: number; linesHit: number; functionsFound: number; functionsHit: number }>

export function formatStoryCoverageReport(lcov: string, limit = 12): string {
  const files = parseFileCoverage(lcov)
    .filter((file) => file.linesHit < file.linesFound || file.functionsHit < file.functionsFound)
    .sort((left, right) => {
      const lineDifference = right.linesFound - right.linesHit - (left.linesFound - left.linesHit)
      if (lineDifference !== 0) return lineDifference
      const functionDifference = right.functionsFound - right.functionsHit - (left.functionsFound - left.functionsHit)
      return functionDifference !== 0 ? functionDifference : left.path.localeCompare(right.path)
    })
    .slice(0, limit)
  if (files.length === 0) return 'T0 uncovered production files: none'
  return ['T0 uncovered production files:', ...files.map(formatFile)].join('\n')
}

function formatFile(file: FileCoverage): string {
  return `  ${file.path} lines ${file.linesHit}/${file.linesFound} functions ${file.functionsHit}/${file.functionsFound}`
}

function parseFileCoverage(lcov: string): readonly FileCoverage[] {
  return lcov
    .split('end_of_record')
    .map((record) => record.trim())
    .filter((record) => record !== '')
    .map((record) => {
      const lines = record.split('\n')
      const path = lines.find((line) => line.startsWith('SF:'))?.slice(3)
      const functionsFound = numberField(lines, 'FNF')
      const functionsHit = numberField(lines, 'FNH')
      const data = lines.filter((line) => line.startsWith('DA:')).map((line) => Number(line.split(',')[1]))
      if (path === undefined || data.length === 0) throw new Error('Malformed lcov record: missing source or DA field')
      return Object.freeze({
        path,
        linesFound: data.length,
        linesHit: data.filter((hits) => hits > 0).length,
        functionsFound,
        functionsHit,
      })
    })
}

function numberField(lines: readonly string[], field: 'FNF' | 'FNH'): number {
  const value = lines.find((line) => line.startsWith(`${field}:`))?.slice(field.length + 1)
  if (value === undefined || !/^\d+$/.test(value)) throw new Error(`Malformed lcov record: missing ${field}`)
  return Number(value)
}
```

The parser uses Bun lcov's `DA` records for line totals and `FNF`/`FNH` for function totals. Extend the formatter tests with missing `FNF` and missing `DA` records; each must throw its exact malformed-record error. Do not use overall totals for per-file output.

- [ ] **Step 4: Print the diagnostic only for an actual below-floor result**

```ts
import { formatStoryCoverageReport } from '../coverage/story-coverage-report.js'

// In gateStoryCoverage, immediately after formatStoryCoverageEvaluation:
if (!evaluation.pass) console.log(formatStoryCoverageReport(scoped.lcov))
if (!evaluation.pass && childExitCode === 0) return 1
```

Keep child-test failures authoritative: do not replace a nonzero `childExitCode`.

- [ ] **Step 5: Run focused tests and the story coverage command**

Run: `bun test tests/scripts/story-coverage-report.test.ts && bun test:stories:coverage`

Expected: formatter tests PASS; story coverage still exits nonzero until Task 2 adds coverage, and now prints deterministic per-file misses.

- [ ] **Step 6: Commit the diagnostic seam**

```bash
git add scripts/coverage/story-coverage-report.ts tests/scripts/story-coverage-report.test.ts scripts/story/coverage-gate.ts
git commit -m "test(stories): report uncovered T0 files"
```

### Task 2: Restore the existing Tier 0 coverage floor

**Files:**
- Modify: the specific production and story files named by Task 1's report.
- Modify: `scripts/story/coverage-floor.json` only if measured coverage exceeds both existing floors after new durable coverage is added.

**Interfaces:**
- Consumes: the deterministic diagnostics from `formatStoryCoverageReport`.
- Produces: a green `bun test:stories:coverage` run with lines `>= 0.71` and functions `>= 0.70`.

- [ ] **Step 1: Capture the below-floor report as the task input**

Run: `bun test:stories:coverage 2>&1 | tee /tmp/papai-t0-coverage-before.txt`

Expected: exit code `1`, with `T0 uncovered production files:` and no changes to `scripts/story/coverage-floor.json`.

- [ ] **Step 2: Add failing behavior stories for the first uncovered runtime boundary**

For each selected production file, create or extend the closest `tests/stories/**/*.story.test.ts` file. Assert one user-visible result and one durable/system result. For example, a missing authorization branch must assert both the rejection reply and that the affected store contains no new row.

```ts
scenario('SCN-task-deny: denied create_task leaves no task behind', ({ given, when, then }) => {
  given.authorizedUser('member-1')
  given.toolPrefs({ create_task: 'deny' })
  when.message('create a task named denied task')
  then.replyTo.contains('not available')
  then.task.absent('denied task')
})
```

Use a real existing DSL assertion rather than adding a generic assertion helper. If the required system oracle is unavailable, stop this task and open the relevant Phase-2 story-family plan for a narrowly scoped fixture seam.

- [ ] **Step 3: Run each new story before production changes**

Run: `bun test:stories --fixture tests/stories/tasks/lifecycle-and-policy.story.test.ts`

Expected: FAIL against the existing production behavior if the new story exposes a real gap; otherwise PASS and retain the test as coverage evidence.

- [ ] **Step 4: Implement only production fixes proven by a failing story**

Make the smallest production change needed to satisfy the explicit user-visible and system assertions. Do not add test-only branches, reduce the coverage floor, or broaden the frozen harness in this task.

- [ ] **Step 5: Verify the ratchet is green**

Run: `bun test:stories:contracts && bun test:stories:coverage`

Expected: both commands exit `0`; coverage output reports lines at least `71.00%` and functions at least `70.00%`.

- [ ] **Step 6: Commit each cohesive coverage cluster**

```bash
git add tests/stories/tasks/lifecycle-and-policy.story.test.ts
git commit -m "test(stories): cover task policy boundary"
```

Repeat Steps 2-6 only until the existing floor is restored. A different behavior cluster belongs in its dedicated follow-on plan.

### Task 3: Introduce stable documented-behavior IDs

**Files:**
- Create: `tests/stories/catalog/behavior-inventory.ts`
- Modify: `docs/architecture/behaviors.md:18-32`
- Test: `tests/stories/harness/behavior-coverage.test.ts`

**Interfaces:**
- Produces: `DOCUMENTED_BEHAVIOR_IDS`, a readonly tuple of behavior IDs.
- Produces: `BehaviorSource`, with `documentPath` and exact `anchor` values used by the ledger.

- [ ] **Step 1: Write failing inventory/source tests**

```ts
import { expect, test } from 'bun:test'
import { DOCUMENTED_BEHAVIOR_IDS } from '../catalog/behavior-inventory.js'

test('documented behavior IDs are unique and source anchors occur exactly once', async () => {
  expect(new Set(DOCUMENTED_BEHAVIOR_IDS).size).toBe(DOCUMENTED_BEHAVIOR_IDS.length)
  const document = await Bun.file(`${import.meta.dir}/../../../docs/architecture/behaviors.md`).text()
  for (const id of DOCUMENTED_BEHAVIOR_IDS) {
    expect(document.split(`<!-- behavior:${id} -->`).length - 1).toBe(1)
  }
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test tests/stories/harness/behavior-coverage.test.ts`

Expected: FAIL because the inventory module and behavior markers do not exist.

- [ ] **Step 3: Add source markers and the inventory tuple**

Use kebab-case IDs with one marker for each documented top-level behavior, for example:

```md
<!-- behavior:scope-model -->
- **Scope model:** within a group, ...

<!-- behavior:mid-run-control -->
- **Mid-run steering & interruption (always on):** ...
```

```ts
export const DOCUMENTED_BEHAVIOR_IDS = [
  'scope-model',
  'settings-only-configuration',
  'reply-to-bot-routing',
  'identity-provisioning',
  'guest-readonly',
  'alert-edge-triggering',
  'release-announcements',
  'mid-run-control',
  'live-status',
  'chat-participant-resolution',
  'privacy-gated-analytics',
] as const

export type DocumentedBehaviorId = (typeof DOCUMENTED_BEHAVIOR_IDS)[number]
```

Continue the tuple through every marked documented behavior. Do not aggregate unrelated bullets under a vague identifier; split a marker when its independently observable behavior has a different proving tier or failure contract.

- [ ] **Step 4: Run the inventory contract**

Run: `bun test tests/stories/harness/behavior-coverage.test.ts`

Expected: PASS with one marker occurrence per inventory ID.

- [ ] **Step 5: Commit stable sources**

```bash
git add docs/architecture/behaviors.md tests/stories/catalog/behavior-inventory.ts tests/stories/harness/behavior-coverage.test.ts
git commit -m "test(stories): identify documented behavior inventory"
```

### Task 4: Add the canonical behavior ledger and catalog cross-check

**Files:**
- Create: `tests/stories/catalog/behaviors.ts`
- Modify: `tests/stories/catalog/coverage.ts:108-344,1750-1774`
- Modify: `tests/stories/harness/behavior-coverage.test.ts`

**Interfaces:**
- Consumes: `DocumentedBehaviorId`, `CATALOG_SCENARIO_IDS`, and `catalogCoverage`.
- Produces: `BEHAVIOR_COVERAGE: readonly BehaviorCoverage[]` and `coverageGaps(records): readonly string[]`.

- [ ] **Step 1: Write failing ledger contract tests**

```ts
import { expect, test } from 'bun:test'
import { BEHAVIOR_COVERAGE, coverageGaps } from '../catalog/behaviors.js'
import { DOCUMENTED_BEHAVIOR_IDS } from '../catalog/behavior-inventory.js'

test('every documented behavior has one ledger record', () => {
  expect(BEHAVIOR_COVERAGE.map(({ behaviorId }) => behaviorId).toSorted()).toEqual([...DOCUMENTED_BEHAVIOR_IDS].toSorted())
})

test('implemented behavior records name a proving tier and an executable catalog scenario', () => {
  expect(coverageGaps(BEHAVIOR_COVERAGE)).toEqual([])
})

test('partial implemented behaviors are reported as ineligible for global qualification', () => {
  expect(unqualifiedBehaviors(BEHAVIOR_COVERAGE)).toContain('live-status')
})
```

- [ ] **Step 2: Run the ledger contract to verify it fails**

Run: `bun test tests/stories/harness/behavior-coverage.test.ts`

Expected: FAIL because `behaviors.js` does not exist.

- [ ] **Step 3: Define the discriminated ledger types and validation**

```ts
export type CoverageDimension = 'primary' | 'authorization-routing' | 'failure-recovery' | 'persistence-scope' | 'external-boundary'
export type BehaviorState = 'implemented' | 'partial' | 'blocked:missing-implementation' | 'retired'

type BehaviorCoverageBase = Readonly<{
  behaviorId: DocumentedBehaviorId
  state: BehaviorState
  required: readonly CoverageDimension[]
  rationale: string
}>

export type BehaviorCoverage =
  | (BehaviorCoverageBase & Readonly<{ state: 'implemented'; provingTier: StoryTier; scenarioIds: readonly CatalogScenarioId[]; missing: readonly [] }>)
  | (BehaviorCoverageBase & Readonly<{ state: 'partial'; provingTier: StoryTier; scenarioIds: readonly CatalogScenarioId[]; missing: readonly [CoverageDimension, ...CoverageDimension[]] }>)
  | (BehaviorCoverageBase & Readonly<{ state: 'blocked:missing-implementation' | 'retired'; provingTier: null; scenarioIds: readonly []; missing: readonly [] }>)

export function coverageGaps(records: readonly BehaviorCoverage[]): readonly string[] {
  return records
    .flatMap((record) => {
      if (record.rationale.trim() === '') return [`${record.behaviorId}: blank rationale`]
      if (record.state === 'implemented' || record.state === 'partial') {
        if (!record.required.includes('primary')) return [`${record.behaviorId}: missing primary dimension`]
        if (record.scenarioIds.length === 0) return [`${record.behaviorId}: missing scenario`]
      }
      return []
    })
    .toSorted()
}

export function unqualifiedBehaviors(records: readonly BehaviorCoverage[]): readonly DocumentedBehaviorId[] {
  return records.filter((record) => record.state === 'partial').map((record) => record.behaviorId).toSorted()
}
```

For an `implemented` record, require at least one catalog scenario, `primary` in `required`, no missing dimensions, and a nonblank rationale. For `partial`, require the same evidence plus a nonempty `missing` tuple. For blocked or retired records, require `provingTier === null`, no scenario IDs, and a nonblank rationale. Validate that every referenced scenario exists and is executable at the declared tier.

- [ ] **Step 4: Populate the ledger from existing evidence before adding new scenarios**

Map existing implemented behavior IDs to their current catalog records. For known uncovered implemented behaviors such as `mid-run-control`, `live-status`, `identity-provisioning`, `alert-edge-triggering`, `chat-participant-resolution`, `release-announcements`, and `privacy-gated-analytics`, create ledger records with their required dimensions and use explicit matrix-gap entries rather than falsely claiming coverage.

Use the `partial` variant for an implemented behavior with only some matrix dimensions proven. Its type requires a proving tier, existing scenario IDs, and a nonempty missing-dimensions tuple. The structural contract stays green, while `unqualifiedBehaviors()` makes a global-refactor admission check fail until the dedicated follow-on plan changes the record to `implemented`.

- [ ] **Step 5: Run catalog and ledger contracts**

Run: `bun test tests/stories/harness/catalog-coverage.test.ts tests/stories/harness/behavior-coverage.test.ts`

Expected: PASS only after every marker has an accountable ledger record and each existing scenario reference is valid. Partial entries are reported deterministically but do not permit global-refactor qualification.

- [ ] **Step 6: Commit the ledger**

```bash
git add tests/stories/catalog/behavior-inventory.ts tests/stories/catalog/behaviors.ts tests/stories/catalog/coverage.ts tests/stories/harness/behavior-coverage.test.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): add behavior coverage ledger"
```

### Task 5: Record a valid qualification baseline and enforce the foundation gate

**Files:**
- Modify: `docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md`
- Test: `tests/stories/harness/behavior-coverage.test.ts`

**Interfaces:**
- Consumes: a master commit containing every frozen input and a green coverage run.
- Produces: a documented `baselineSha`, `treeHash`, and command evidence for future refactor branches.

- [ ] **Step 1: Verify the full foundation on the master candidate**

Run:

```bash
bun test:stories:contracts
bun test:stories:coverage
bun test:stories:manifest
```

Expected: all commands exit `0`; `reports/stories/manifest.json` contains a nonempty `treeHash`.

- [ ] **Step 2: Commit the frozen foundation before recording the baseline**

```bash
git add tests/stories scripts/story scripts/coverage bunfig.toml tests/setup.ts tests/mock-reset.ts tests/utils/test-helpers.ts tests/utils/logger-mock.ts
```

Do not stage unrelated files. If this commit changes frozen inputs, it is the baseline candidate; otherwise use the commit that last changed them.

- [ ] **Step 3: Append immutable baseline evidence to the roadmap spec**

```md
## Foundation baseline

- Baseline SHA: `$BASELINE_SHA`
- Frozen tree hash: `$TREE_HASH`
- Verified commands: `bun test:stories:contracts`, `bun test:stories:coverage`, and `bun test:stories:manifest`
```

Set `BASELINE_SHA="$(git rev-parse HEAD)"` immediately after Step 2. Set `TREE_HASH` by reading the `treeHash` field from `reports/stories/manifest.json`. Render the resulting literal values into the spec in the same commit; shell variable names must not remain in the document.

- [ ] **Step 4: Prove compatibility against the recorded baseline**

Run:

```bash
BASE_REF="$BASELINE_SHA" bun test:stories:compat --manifest-only
BASE_REF="$BASELINE_SHA" bun test:stories:compat
```

Expected: both commands exit `0`; the full command runs the frozen suite from its immutable session.

- [ ] **Step 5: Commit baseline evidence**

```bash
git add docs/superpowers/specs/2026-08-04-global-refactor-behavior-coverage-roadmap-design.md
git commit -m "docs(coverage): record qualification baseline"
```

## Final Verification

- [ ] Run `git status --short`; expected output is empty.
- [ ] Run `bun test:stories:contracts`; expected exit code `0`.
- [ ] Run `bun test:stories:coverage`; expected exit code `0`, with lines `>= 71.00%` and functions `>= 70.00%`.
- [ ] Run both compatibility commands using the recorded baseline SHA; expected exit code `0`.
- [ ] Verify each documented behavior marker has exactly one behavior-ledger record and that no `partial` record is used to qualify a global production refactor.
