<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3 Pure-Helper Stories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote only the three approved Phase 3 pure-helper catalog records with literal, hermetic Tier-0 stories.

**Architecture:** Add one `tests/stories/pure-helpers/` story file with three direct exported-helper scenarios. Update the frozen catalog ledger and its contract in the same change: each new literal scenario maps to exactly one of the three records, while the other Phase 3 records remain pending gaps.

**Tech Stack:** Bun, `bun:test`, TypeScript, Tier-0 `scenario(...)` harness, frozen story catalog.

## Global Constraints

- Modify only the new story file, `tests/stories/catalog/coverage.ts`, and `tests/stories/harness/catalog-coverage.test.ts`; do not change production code, fixtures, or existing unit tests.
- Create exactly three literal Tier-0 scenarios, one for each approved catalog ID, and map each ID to only its own literal story ID.
- Invoke the exported helpers directly with in-memory values; do not add a clock, filesystem, database, network, timer, environment, or dependency-injection seam.
- `SCN-memory-tool-pairing` proves only retention normalization; `SCN-scheduler-execution-tracking` proves only active-set cleanup; `SCN-changelog-version-section` proves only text extraction.
- Keep `src/changelog-reader.ts`, scheduler loops, and announcement flows out of scope.
- The story and catalog are frozen Tier-0 inputs: run the contracts and story lanes, then follow the established post-merge baseline/compatibility procedure.
- Do not add lint/type suppressions. Use `.js` in all TypeScript import paths.

---

### Task 1: Make the three-record promotion an explicit failing catalog contract

**Files:**
- Modify: `tests/stories/harness/catalog-coverage.test.ts:130-344, 462-471, 548-597`

**Interfaces:**
- Consumes: `catalogCoverage`, `PHASE3_UNCATALOGUED_CLUSTER_IDS`, and the literal story-ID format extracted from `scenario(...)` calls.
- Produces: a contract that distinguishes the three promoted Tier-0 records from the remaining 18 pending Phase 3 gaps, asserts their exact mapping, and sets totals to 172 executable / 43 pending / 12 executable-as-is.

- [ ] **Step 1: Change the Phase 3 contract to describe the approved split**

Add this constant beside `ACP_CATALOG_STORY_IDS`:

```ts
const PURE_HELPER_CATALOG_STORY_IDS = {
  'SCN-memory-tool-pairing':
    'tests/stories/pure-helpers/pure-helpers.story.test.ts#SCN-memory-tool-pairing: retained history keeps tool exchanges whole',
  'SCN-scheduler-execution-tracking':
    'tests/stories/pure-helpers/pure-helpers.story.test.ts#SCN-scheduler-execution-tracking: active execution tracking clears fulfilled and rejected work',
  'SCN-changelog-version-section':
    'tests/stories/pure-helpers/pure-helpers.story.test.ts#SCN-changelog-version-section: version lookup returns only the requested changelog section',
} as const
```

Replace the assertion that every Phase 3 record is pending with assertions that:

```ts
const phase3Coverage = catalogCoverage.filter(({ scenarioId }) => phase3UncataloguedClusterIdSet.has(scenarioId))
const promoted = phase3Coverage.filter(
  (coverage): coverage is Extract<(typeof catalogCoverage)[number], { kind: 'executable' }> =>
    coverage.kind === 'executable',
)
const pending = phase3Coverage.filter(
  (coverage): coverage is Extract<(typeof catalogCoverage)[number], { kind: 'pending' }> => coverage.kind === 'pending',
)

expect(phase3Coverage).toHaveLength(21)
expect(Object.fromEntries(promoted.map(({ scenarioId, storyIds }) => [scenarioId, storyIds[0]]))).toEqual(
  PURE_HELPER_CATALOG_STORY_IDS,
)
expect(promoted.map(({ provingTier }) => provingTier)).toEqual(['0', '0', '0'])
expect(pending).toHaveLength(18)
expect(pending.every(({ catalogStatus }) => catalogStatus === 'gap')).toBe(true)
expect(pending.every(({ kind }) => kind === 'pending')).toBe(true)
```

Remove the three promoted entries from `PHASE3_AUDIT_PROJECTION`. Update the global assertions to `172` executable records, `43` pending records, and `12` `executable-as-is` pending records; retain the `9` seam-pending and `22` blocked totals.

- [ ] **Step 2: Run the contract suite to verify RED**

Run: `bun test:stories:contracts`

Expected: FAIL because all three records are still pending and no matching literal story file exists. The failure must name the Phase 3 promotion assertion, the executable total, or the literal-story census; do not edit frozen harness behavior to bypass it.

- [ ] **Step 3: Commit the failing contract checkpoint**

```bash
git add tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): specify pure helper story coverage"
```

### Task 2: Add the hermetic stories and promote exactly their three ledger records

**Files:**
- Create: `tests/stories/pure-helpers/pure-helpers.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts:360-374, 394-1423, 1429-1526`
- Verify: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**
- Consumes: `resolveTrimmedIndices(history, keepIndices, trimMin, trimMax)`, `normalizeToolPairs(history, selected, trimMax)`, `isValidToolSequence(messages)`, `trackSchedulerExecution(execution, activeExecutions)`, and `extractChangelogSection(version, content)`.
- Produces: literal story IDs named in `PURE_HELPER_CATALOG_STORY_IDS`, and three executable Tier-0 catalog entries with `verifiedAt: '2026-07-29'`.

- [ ] **Step 1: Add the direct-helper story file**

Create the complete file below. Its local builders construct a user message, assistant `tool-call`, and tool `tool-result` with matching `toolCallId` values; it uses no scenario fixtures.

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import type { ModelMessage } from 'ai'

import { isValidToolSequence, normalizeToolPairs, resolveTrimmedIndices } from '../../../src/memory-tool-pairing.js'
import { extractChangelogSection } from '../../../src/utils/changelog.js'
import { trackSchedulerExecution } from '../../../src/utils/scheduler.executions.js'
import { scenario } from '../harness/scenario.js'

const user = (content: string): ModelMessage => ({ role: 'user', content })
const call = (toolCallId: string): ModelMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId, toolName: 'get_task', input: {} }],
})
const result = (toolCallId: string): ModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId, toolName: 'get_task', output: { type: 'json', value: {} } }],
})

scenario('SCN-memory-tool-pairing: retained history keeps tool exchanges whole', () => {
  const history = [user('before'), call('a'), result('a'), call('b'), result('b'), user('after')]
  const selected = resolveTrimmedIndices(history, [2, 3, 5], 1, 3)
  const retained = selected.map((index) => history[index]!)

  expect(selected).toEqual([3, 4, 5])
  expect(retained[0]?.role).not.toBe('tool')
  expect(isValidToolSequence(retained)).toBe(true)
  expect(normalizeToolPairs(history, [2, 5], 10)).toEqual([1, 2, 5])

  const malformed = [result('orphan'), user('plain'), call('truncated')]
  expect(normalizeToolPairs(malformed, [0, 1, 2], 10)).toEqual([1])
})

scenario('SCN-scheduler-execution-tracking: active execution tracking clears fulfilled and rejected work', async () => {
  const active = new Set<Promise<void>>()
  const fulfilled = Promise.withResolvers<void>()
  const trackedFulfilled = trackSchedulerExecution(fulfilled.promise, active)
  expect(trackedFulfilled).toBe(fulfilled.promise)
  expect(active.has(fulfilled.promise)).toBe(true)
  fulfilled.resolve()
  await trackedFulfilled
  expect(active.has(fulfilled.promise)).toBe(false)

  const rejected = Promise.withResolvers<void>()
  const trackedRejected = trackSchedulerExecution(rejected.promise, active)
  rejected.reject(new Error('expected rejection'))
  await expect(trackedRejected).rejects.toThrow('expected rejection')
  expect(active.has(rejected.promise)).toBe(false)
})

scenario('SCN-changelog-version-section: version lookup returns only the requested changelog section', () => {
  const content = '## [2.0.0]\\nnew\\n\\n## [1.0.0]\\nold'
  expect(extractChangelogSection('2.0.0', content)).toBe('new')
  expect(extractChangelogSection('1.0.0', content)).toBe('old')
  expect(extractChangelogSection('3.0.0', content)).toBeNull()
})
```

Keep the helper builders and imports typed with the real `ModelMessage` shape. The story must not call `readChangelogFile`, construct an announcement, create a scheduler task, or rely on scenario `given`, `when`, or `then` fixtures.

- [ ] **Step 2: Promote only the three matching catalog records**

In `coverage.ts`, define a private three-ID tuple before `GAP_SCENARIO_IDS`:

```ts
const PURE_HELPER_SCENARIO_IDS = new Set<CatalogScenarioId>([
  'SCN-memory-tool-pairing',
  'SCN-scheduler-execution-tracking',
  'SCN-changelog-version-section',
])
```

Keep `PHASE3_UNCATALOGUED_CLUSTER_IDS` unchanged, but exclude `PURE_HELPER_SCENARIO_IDS` when spreading its remaining values into `GAP_SCENARIO_IDS`:

```ts
...PHASE3_UNCATALOGUED_CLUSTER_IDS.filter((scenarioId) => !PURE_HELPER_SCENARIO_IDS.has(scenarioId)),
```

Add these mappings to `EXECUTABLE_STORY_MAPPINGS`:

```ts
'SCN-memory-tool-pairing': {
  verifiedAt: '2026-07-29',
  storyIds: ['tests/stories/pure-helpers/pure-helpers.story.test.ts#SCN-memory-tool-pairing: retained history keeps tool exchanges whole'],
},
'SCN-scheduler-execution-tracking': {
  verifiedAt: '2026-07-29',
  storyIds: ['tests/stories/pure-helpers/pure-helpers.story.test.ts#SCN-scheduler-execution-tracking: active execution tracking clears fulfilled and rejected work'],
},
'SCN-changelog-version-section': {
  verifiedAt: '2026-07-29',
  storyIds: ['tests/stories/pure-helpers/pure-helpers.story.test.ts#SCN-changelog-version-section: version lookup returns only the requested changelog section'],
},
```

Delete only those three records from `AUDIT_RECORDS`; retain every other Phase 3 audit record and all other catalog entries unchanged.

- [ ] **Step 3: Run focused story and catalog verification to verify GREEN**

Run:

```bash
bun test tests/stories/pure-helpers/pure-helpers.story.test.ts
bun test:stories:contracts
```

Expected: both commands PASS. The focused story run proves the three direct helper contracts, and the contracts suite finds all three literal story IDs, reports 172 executable / 43 pending, and verifies only 18 Phase 3 records still have pending audit entries.

- [ ] **Step 4: Run the complete Tier-0 regression lane**

Run: `bun test:stories`

Expected: PASS. The sandboxed Tier-0 lane discovers the three new scenarios without an uncatalogued-story census failure. No unrelated catalog record changes status.

- [ ] **Step 5: Commit the implementation slice**

```bash
git add tests/stories/pure-helpers/pure-helpers.story.test.ts tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): cover Phase 3 pure helper behavior"
```

### Task 3: Record frozen-story compatibility evidence after merge

**Files:**
- Modify: none.
- Generated, ignored: `reports/stories/manifest.json`, `reports/stories/junit.xml`.

**Interfaces:**
- Consumes: the merged catalog and story files plus Docker's pinned Bun image.
- Produces: a master baseline SHA and manifest `treeHash` that qualify the intentional frozen-input change.

- [ ] **Step 1: Establish the master baseline after merge**

Run on the merged master commit:

```bash
PAPAI_BASELINE_SHA="$(git rev-parse HEAD)"
bun test:stories:contracts
bun test:stories
bun test:stories:manifest
BASE_REF="$PAPAI_BASELINE_SHA" bun test:stories:compat --manifest-only
BASE_REF="$PAPAI_BASELINE_SHA" bun test:stories:compat
```

Expected: every command PASS. Record `PAPAI_BASELINE_SHA` and `treeHash` from `reports/stories/manifest.json` in the PR handoff; do not commit `reports/stories/**`.
