<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Tier-Aware Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every scenario-catalog record a machine-checked proving tier, so tiers 1–4 can be planned against data instead of prose.

**Architecture:** This is Deliverable 1 of `docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`, which rule 2 of that spec requires to land first and alone — no tier lane is built here. The ledger in `tests/stories/catalog/coverage.ts` gains a tier vocabulary; executable records gain a `provingTier` (all `'0'` today, via a defaulted optional field on the mapping table so 101 entries need no edit); seam-pending records gain the tier that unblocks them (all `'3'` today). Three new contracts in the existing Tier 0.1 suite enforce placement and liveness, and the runner's coverage line grows per-tier tallies. The last task reconciles the two conflicting tier taxonomies in the docs.

**Tech Stack:** TypeScript (strict, `.js` import paths), Bun test runner, oxlint/oxfmt.

## Global Constraints

- **Frozen-tree discipline (spec rule 6).** `tests/stories/**` and `scripts/story/**` are frozen compat inputs. This plan edits three of them (`tests/stories/catalog/coverage.ts`, `tests/stories/harness/catalog-coverage.test.ts`, `scripts/story/coverage-totals.ts`), so the manifest `treeHash` **will** change. That is intended and argued here — it is the one exception rule 6 anticipates. Do not treat the hash change as a failure, and do not touch runner or sandbox files beyond the three named.
- **No lint-disable or type-ignore comments** — hook policy blocks them; fix the underlying issue.
- **Use `.js` extensions in import paths.**
- Ledger numbers as of this plan: **128 total, 101 executable, 27 pending** (5 `needs-seam`, 22 `blocked`). Every count assertion below uses these.
- Story contract tests are excluded from default discovery; run them with an explicit `--path-ignore-patterns ''`.
- `bun test:stories` (full Tier 0 run) requires Docker. The contract commands in tasks 1–5 do not.

---

## File Structure

| File                                             | Responsibility                                                                | Change                                                                                               |
| ------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `tests/stories/catalog/coverage.ts`              | the ledger: scenario ids, tier vocabulary, executable mappings, audit records | Modify — add `STORY_TIERS`, `LIVE_STORY_TIERS`, `TIER_SUITE_ROOTS`, `provingTier`, `unblockedByTier` |
| `tests/stories/harness/catalog-coverage.test.ts` | Tier 0.1 contracts over the ledger                                            | Modify — add 4 contracts                                                                             |
| `scripts/story/coverage-totals.ts`               | tallies the ledger for the runner manifest line                               | Modify — per-tier tallies                                                                            |
| `tests/scripts/story-coverage-totals.test.ts`    | unit test for the tallies                                                     | Modify — expected shape and string                                                                   |
| `docs/superpowers/e2e-planning-workflow.md`      | E2E planning guidance                                                         | Modify — canonical tier table, Tier 2 re-charter, 0Q note                                            |
| `tests/CLAUDE.md`                                | testing conventions read by agents working under `tests/`                     | Modify — proving-tier and 0Q lines                                                                   |

---

### Task 1: Tier vocabulary and proving tier on executable records

**Files:**

- Modify: `tests/stories/catalog/coverage.ts:6` (after `CatalogStatus`), `:65-79` (`CatalogCoverage`), `:240-242` (`ExecutableStoryMapping`), `:948-959` (`catalogCoverage` builder)
- Test: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `STORY_TIERS: readonly ['0','1','2','3','4']`; `type StoryTier = '0'|'1'|'2'|'3'|'4'`; `LIVE_STORY_TIERS: readonly StoryTier[]`; executable `CatalogCoverage` records gain `provingTier: StoryTier`; `ExecutableStoryMapping` gains optional `provingTier?: StoryTier` defaulting to `'0'`.

- [ ] **Step 1: Write the failing test**

In `tests/stories/harness/catalog-coverage.test.ts`, extend the existing import block from `../catalog/coverage.js` with `LIVE_STORY_TIERS` (keep the existing named imports; add it in alphabetical position after `catalogCoverage`), then add this test inside the `describe('scenario catalog coverage', ...)` block, after the `tracks the executable coverage total` test:

```typescript
test('stamps every executable record with a live proving tier', () => {
  const executable = catalogCoverage.filter((coverage) => coverage.kind === 'executable')
  const offLaneTiers = executable
    .filter((coverage) => !LIVE_STORY_TIERS.includes(coverage.provingTier))
    .map(({ scenarioId, provingTier }) => `${scenarioId} -> T${provingTier}`)

  expect(executable).toHaveLength(101)
  expect(offLaneTiers).toEqual([])
  expect(new Set(executable.map((coverage) => coverage.provingTier))).toEqual(new Set(['0']))
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts`

Expected: FAIL — `LIVE_STORY_TIERS` is not exported and `provingTier` does not exist on the record type.

- [ ] **Step 3: Add the tier vocabulary**

In `tests/stories/catalog/coverage.ts`, immediately after the `CatalogStatus` type on line 6, insert:

```typescript
export const STORY_TIERS = ['0', '1', '2', '3', '4'] as const
export type StoryTier = (typeof STORY_TIERS)[number]

/**
 * Tiers with a runnable lane today. A tier joins this list in its own spec's PR,
 * never speculatively: an executable record may only claim a live tier, so a
 * planned tier can never be mistaken for coverage that exists.
 */
export const LIVE_STORY_TIERS: readonly StoryTier[] = Object.freeze(['0'])
```

- [ ] **Step 4: Add `provingTier` to the executable record**

In the same file, in the `CatalogCoverage` union, add `provingTier` to the `kind: 'executable'` variant so it reads:

```typescript
export type CatalogCoverage =
  | Readonly<{
      scenarioId: CatalogScenarioId
      catalogStatus: CatalogStatus
      kind: 'executable'
      provingTier: StoryTier
      verifiedAt: string
      storyIds: NonEmptyReadonlyTuple<string>
    }>
  | Readonly<{
      scenarioId: CatalogScenarioId
      catalogStatus: CatalogStatus
      kind: 'pending'
      verifiedAt: string
      audit: AuditRecord
    }>
```

- [ ] **Step 5: Default the mapping table to Tier 0**

Change the `ExecutableStoryMapping` type so a mapping may name a tier and otherwise means Tier 0 — this is what keeps all 101 existing entries untouched:

```typescript
type ExecutableStoryMapping = Readonly<{
  verifiedAt: string
  /** Omitted means Tier 0: the hermetic in-process lane that proved every record to date. */
  provingTier?: StoryTier
  storyIds: NonEmptyReadonlyTuple<string>
}>
```

Then in the `catalogCoverage` builder, add the field to the executable branch:

```typescript
if (mapping !== undefined) {
  return Object.freeze({
    scenarioId,
    catalogStatus: catalogStatusFor(scenarioId),
    kind: 'executable' as const,
    provingTier: mapping.provingTier ?? '0',
    verifiedAt: mapping.verifiedAt,
    storyIds: mapping.storyIds,
  })
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts`

Expected: PASS — 18 tests pass.

- [ ] **Step 7: Typecheck**

Run: `bun typecheck`

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): stamp executable catalog records with a proving tier"
```

---

### Task 2: Tier suite roots and the placement contract

**Files:**

- Modify: `tests/stories/catalog/coverage.ts` (after `LIVE_STORY_TIERS`)
- Test: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**

- Consumes: `STORY_TIERS`, `StoryTier`, `provingTier` from Task 1.
- Produces: `TIER_SUITE_ROOTS: Readonly<Record<StoryTier, string>>` — the repository-relative directory prefix every story id of a tier must start with. Tier specs 1–4 consume this when they create their lane.

- [ ] **Step 1: Write the failing test**

Add `STORY_TIERS` and `TIER_SUITE_ROOTS` to the `../catalog/coverage.js` import block in `tests/stories/harness/catalog-coverage.test.ts`, then add these two tests after the proving-tier test from Task 1:

```typescript
test('gives every tier a distinct suite root', () => {
  const roots = STORY_TIERS.map((tier) => TIER_SUITE_ROOTS[tier])

  expect(new Set(roots).size).toBe(STORY_TIERS.length)
  expect(TIER_SUITE_ROOTS['0']).toBe('tests/stories/')
  expect(TIER_SUITE_ROOTS['1']).toBe('tests/e2e/')
})

test('keeps every executable story under its own tier suite root', () => {
  const misplaced = catalogCoverage.flatMap((coverage) =>
    coverage.kind === 'executable'
      ? coverage.storyIds
          .filter((storyId) => !storyId.startsWith(TIER_SUITE_ROOTS[coverage.provingTier]))
          .map((storyId) => `T${coverage.provingTier} ${coverage.scenarioId} -> ${storyId}`)
      : [],
  )

  expect(misplaced).toEqual([])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts`

Expected: FAIL — `TIER_SUITE_ROOTS` is not exported.

- [ ] **Step 3: Add the suite-root map**

In `tests/stories/catalog/coverage.ts`, directly after the `LIVE_STORY_TIERS` declaration added in Task 1:

```typescript
/**
 * Repository-relative suite root each tier's stories live under. A record's story
 * ids must start with its tier's root, so a story can never be filed under a tier
 * whose lane does not run it.
 */
export const TIER_SUITE_ROOTS: Readonly<Record<StoryTier, string>> = Object.freeze({
  '0': 'tests/stories/',
  '1': 'tests/e2e/',
  '2': 'tests/smoke/',
  '3': 'tests/platform/',
  '4': 'tests/operational/',
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts`

Expected: PASS — 20 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): contract story placement against tier suite roots"
```

---

### Task 3: Name the tier that unblocks each seam-pending record

**Files:**

- Modify: `tests/stories/catalog/coverage.ts:36-39` (`AuditReadiness`), `:828-829` (`needs` helper), and the five `needs(...)` call sites at `:844`, `:850`, `:856`, `:861`, `:866`
- Test: `tests/stories/harness/catalog-coverage.test.ts`

**Interfaces:**

- Consumes: `StoryTier` from Task 1.
- Produces: the `needs-seam` variant of `AuditReadiness` gains `unblockedByTier: StoryTier`; the `needs` helper signature becomes `needs(family, seams, unblockedByTier, rationale)`.

- [ ] **Step 1: Write the failing test**

Add this test to `tests/stories/harness/catalog-coverage.test.ts`, after the `references only known seams` test:

```typescript
test('names the tier that unblocks every seam-pending scenario', () => {
  const seamPending = pendingCoverage.filter((coverage) => coverage.audit.readiness.state === 'needs-seam')
  const unblockingTiers = seamPending.map((coverage) => {
    const { readiness } = coverage.audit
    return readiness.state === 'needs-seam' ? readiness.unblockedByTier : 'none'
  })

  expect(sorted(seamPending.map(({ scenarioId }) => scenarioId))).toEqual([
    'SCN-fetch-chat-link',
    'SCN-http-mattermost-action',
    'SCN-interaction-discord-router-wrapped',
    'SCN-interaction-discord-standalone-fallback',
    'SCN-interaction-telegram-callback',
  ])
  expect(unblockingTiers).toEqual(['3', '3', '3', '3', '3'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts`

Expected: FAIL — `unblockedByTier` does not exist on the `needs-seam` readiness type.

- [ ] **Step 3: Extend the readiness type and its helper**

In `tests/stories/catalog/coverage.ts`, change `AuditReadiness` to:

```typescript
export type AuditReadiness =
  | Readonly<{ state: 'executable-as-is' }>
  | Readonly<{ state: 'needs-seam'; seams: NonEmptyReadonlyTuple<StorySeamId>; unblockedByTier: StoryTier }>
  | Readonly<{ state: 'blocked'; blocker: 'missing-implementation' }>
```

`blocked` deliberately carries no tier: those records are blocked on missing production code, and a tier assignment would misrepresent them as reachable by test work.

Then change the `needs` helper:

```typescript
const needs = (
  family: StoryFamily,
  seams: NonEmptyReadonlyTuple<StorySeamId>,
  unblockedByTier: StoryTier,
  rationale: string,
): AuditRecord => auditRecord({ state: 'needs-seam', seams, unblockedByTier }, family, rationale)
```

- [ ] **Step 4: Pass the tier at all five call sites**

All five need Tier 3 — real chat-adapter code must execute for any of them. Insert `'3',` as the third argument, keeping every existing rationale string byte-identical:

```typescript
  'SCN-fetch-chat-link': needs(
    'F3',
    ['capability-ids', 'platform-adapter-fakes'],
    '3',
    'fetch_chat_link resolves Mattermost permalinks through the authenticated Mattermost REST API (resolveChatLink), never assertPublicUrl (that DNS/SSRF guard is web_fetch, family F6). Needs a Mattermost REST resolver fake, not built speculatively.',
  ),
```

```typescript
  'SCN-http-mattermost-action': needs(
    'F4',
    ['mattermost-action-fixture'],
    '3',
    'Action callbacks bypass the session gate but need the test secret option wired into the world; wire verification stays forward-only.',
  ),
```

```typescript
  'SCN-interaction-discord-router-wrapped': needs(
    'F8',
    ['platform-adapter-fakes'],
    '3',
    'The harness enters at runtime.dispatchInteraction, below the platform adapter; this scenario verifies the discord.js wire above it (a raw callback decoded and routed into dispatch), which is Tier-3 platform-integrated territory, out of the roadmap scope. Needs a fake Discord client, not built speculatively.',
  ),
```

```typescript
  'SCN-interaction-discord-standalone-fallback': needs(
    'F8',
    ['platform-adapter-fakes'],
    '3',
    'The harness enters at runtime.dispatchInteraction, below the platform adapter; this scenario verifies the discord.js standalone fallback wire above it, which is Tier-3 platform-integrated territory, out of the roadmap scope. Needs a fake Discord client, not built speculatively.',
  ),
```

```typescript
  'SCN-interaction-telegram-callback': needs(
    'F8',
    ['platform-adapter-fakes'],
    '3',
    'The harness enters at runtime.dispatchInteraction, below the platform adapter; this scenario verifies the grammY callback wire above it, which is Tier-3 platform-integrated territory, out of the roadmap scope. Needs a fake Telegram API, not built speculatively.',
  ),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test --path-ignore-patterns '' tests/stories/harness/catalog-coverage.test.ts`

Expected: PASS — 21 tests pass.

- [ ] **Step 6: Typecheck**

Run: `bun typecheck`

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): record the unblocking tier on seam-pending audits"
```

---

### Task 4: Per-tier totals in the runner coverage line

**Files:**

- Modify: `scripts/story/coverage-totals.ts` (whole file)
- Test: `tests/scripts/story-coverage-totals.test.ts`

**Interfaces:**

- Consumes: `STORY_TIERS`, `StoryTier`, `provingTier`, `unblockedByTier` from Tasks 1 and 3.
- Produces: `StoryCoverageTotals` gains `executableByTier` and `pendingByUnblockingTier`, both `Readonly<Record<StoryTier, number>>`. `formatStoryCoverageTotals()` keeps its signature and returns one line with three semicolon-separated clauses. `scripts/story/test-stories.ts:188` already prints it and needs no change.

- [ ] **Step 1: Write the failing test**

Replace the body of `tests/scripts/story-coverage-totals.test.ts` below the imports with:

```typescript
describe('storyCoverageTotals', () => {
  test('tallies the catalog ledger', () => {
    expect(storyCoverageTotals()).toEqual({
      total: 128,
      executable: 101,
      pending: 27,
      readiness: { 'executable-as-is': 0, 'needs-seam': 5, blocked: 22 },
      executableByTier: { '0': 101, '1': 0, '2': 0, '3': 0, '4': 0 },
      pendingByUnblockingTier: { '0': 0, '1': 0, '2': 0, '3': 5, '4': 0 },
    })
  })

  test('formats a single summary line with per-tier tallies', () => {
    expect(formatStoryCoverageTotals()).toBe(
      'story catalog: 101/128 executable (T0 101, T1 0, T2 0, T3 0, T4 0); ' +
        'pending 27 (0 executable-as-is, 5 needs-seam, 22 blocked); ' +
        'pending unblocked by tier (T0 0, T1 0, T2 0, T3 5, T4 0)',
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/scripts/story-coverage-totals.test.ts`

Expected: FAIL — both tests fail: the returned object lacks the two tier tallies, and the formatted line lacks the tier clauses.

- [ ] **Step 3: Implement the tallies**

Replace the body of `scripts/story/coverage-totals.ts` below the licence header with:

```typescript
import { catalogCoverage, STORY_TIERS, type StoryTier } from '../../tests/stories/catalog/coverage.js'

type TierTally = Readonly<Record<StoryTier, number>>

export type StoryCoverageTotals = Readonly<{
  total: number
  executable: number
  pending: number
  readiness: Readonly<{ 'executable-as-is': number; 'needs-seam': number; blocked: number }>
  executableByTier: TierTally
  pendingByUnblockingTier: TierTally
}>

function emptyTierTally(): Record<StoryTier, number> {
  return Object.fromEntries(STORY_TIERS.map((tier) => [tier, 0])) as Record<StoryTier, number>
}

export function storyCoverageTotals(): StoryCoverageTotals {
  const readiness = { 'executable-as-is': 0, 'needs-seam': 0, blocked: 0 }
  const executableByTier = emptyTierTally()
  const pendingByUnblockingTier = emptyTierTally()
  let executable = 0
  for (const coverage of catalogCoverage) {
    if (coverage.kind === 'executable') {
      executable += 1
      executableByTier[coverage.provingTier] += 1
      continue
    }
    const { readiness: state } = coverage.audit
    readiness[state.state] += 1
    if (state.state === 'needs-seam') pendingByUnblockingTier[state.unblockedByTier] += 1
  }
  return {
    total: catalogCoverage.length,
    executable,
    pending: catalogCoverage.length - executable,
    readiness,
    executableByTier,
    pendingByUnblockingTier,
  }
}

function formatTierTally(tally: TierTally): string {
  return STORY_TIERS.map((tier) => `T${tier} ${tally[tier]}`).join(', ')
}

export function formatStoryCoverageTotals(totals: StoryCoverageTotals = storyCoverageTotals()): string {
  return [
    `story catalog: ${totals.executable}/${totals.total} executable (${formatTierTally(totals.executableByTier)})`,
    `pending ${totals.pending} (${totals.readiness['executable-as-is']} executable-as-is, ${totals.readiness['needs-seam']} needs-seam, ${totals.readiness.blocked} blocked)`,
    `pending unblocked by tier (${formatTierTally(totals.pendingByUnblockingTier)})`,
  ].join('; ')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/scripts/story-coverage-totals.test.ts`

Expected: PASS — 2 tests pass.

- [ ] **Step 5: Typecheck**

Run: `bun typecheck`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add scripts/story/coverage-totals.ts tests/scripts/story-coverage-totals.test.ts
git commit -m "test(stories): report per-tier coverage totals in the runner line"
```

---

### Task 5: Reconcile the two tier taxonomies in the docs

**Files:**

- Modify: `docs/superpowers/e2e-planning-workflow.md:40-47` (the `## Realism Tiers` section)
- Modify: `tests/CLAUDE.md` (the `## E2E Testing` bullet list)

**Interfaces:**

- Consumes: `TIER_SUITE_ROOTS` and `LIVE_STORY_TIERS` from Tasks 1–2 (referenced by name in prose).
- Produces: nothing consumed by later tasks — this is the documentation half of Deliverable 1, sections 1a and 1d of the spec.

There is no test for a docs change; the deliverable is the reviewed text.

- [ ] **Step 1: Replace the Realism Tiers section**

In `docs/superpowers/e2e-planning-workflow.md`, replace the whole `## Realism Tiers` section (heading plus its table, lines 40–47) with:

```markdown
## Realism Tiers

Canonical definition: `docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`.
This table mirrors it; the spec wins on any disagreement.

| Tier         | Meaning                                                                                                                                       | Still fakes                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| 0.1 / 0 / 0Q | Hermetic in-process stories, harness contracts, frozen-harness compatibility proof                                                            | process, provider, platform, clock, LLM |
| 1            | Provider-real: real Kaneo/YouTrack behind the normalized provider interface                                                                   | process, platform, clock, LLM           |
| 2            | Process-real smoke: the built artifact boots and serves — migrations, env validation, plugin discovery and lifecycle, route binding, shutdown | platform, clock, LLM                    |
| 3            | Platform-integrated: real grammY / discord.js / Mattermost client code against fake platform servers                                          | clock, LLM                              |
| 4            | Operational: virtual clock, schedulers, recurrence, proactive delivery, restart recovery                                                      | LLM                                     |

Tier 2 was formerly defined as "Runtime E2E — real papai runtime with controlled
chat injection and deterministic model boundary". Tier 0 does that today,
in-process and hermetically, so Tier 2 is re-chartered around the process
boundary and that former charter is retired rather than moved.

**0Q is a Tier 0 instrument only.** The frozen-harness compatibility proof depends
on byte-identical harness hashes, which Docker-, provider-, and platform-backed
tiers cannot supply. Tiers 1–4 are regression lanes, never qualification gates.

Each tier's stories live under its own suite root, declared in
`TIER_SUITE_ROOTS` in `tests/stories/catalog/coverage.ts` and enforced by the
Tier 0.1 contracts. Only tiers listed in `LIVE_STORY_TIERS` may back an
executable ledger record; the rest are planned and counted separately.
```

- [ ] **Step 2: Add the ledger lines to the testing conventions**

In `tests/CLAUDE.md`, in the `## E2E Testing` bullet list, immediately after the bullet beginning "The Docker-backed Kaneo harness is **Tier 1: Provider-Real E2E**", add these two bullets:

```markdown
- Every catalog record carries a **proving tier** — the lowest tier that can prove the behavior — in `tests/stories/catalog/coverage.ts`. Executable records may only claim a tier in `LIVE_STORY_TIERS`, and their story ids must sit under that tier's `TIER_SUITE_ROOTS` prefix. Seam-pending records name the tier that unblocks them; `blocked:missing-implementation` records name none, because no tier reaches them. The runner prints per-tier totals on every run.
- The 0Q compatibility proof is Tier 0 only. Higher tiers are regression lanes and never gate a refactor qualification. Canonical tier definitions: `docs/superpowers/specs/2026-07-23-tier-expansion-roadmap-design.md`.
```

- [ ] **Step 3: Verify formatting**

Run: `bunx prettier --check docs/superpowers/e2e-planning-workflow.md tests/CLAUDE.md`

Expected: both files pass. If either fails, run `bunx prettier --write` on it and re-check.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/e2e-planning-workflow.md tests/CLAUDE.md
git commit -m "docs(tiers): make the tier taxonomy canonical and single-sourced"
```

---

### Task 6: Full verification and intended re-baseline

**Files:**

- No source changes. This task proves the migration did not disturb Tier 0 and records the intended manifest change.

**Interfaces:**

- Consumes: everything from Tasks 1–5.
- Produces: a verified green tree and a documented `treeHash` change.

- [ ] **Step 1: Run the full Tier 0.1 contract suite**

Run: `bun test:stories:contracts`

Expected: PASS. This runs every harness unit/contract test, including the catalog contracts, inside the Docker sandbox.

- [ ] **Step 2: Run the full Tier 0 story suite**

Run: `bun test:stories`

Expected: PASS, with the last line of runner output now reading:

```
story catalog: 101/128 executable (T0 101, T1 0, T2 0, T3 0, T4 0); pending 27 (0 executable-as-is, 5 needs-seam, 22 blocked); pending unblocked by tier (T0 0, T1 0, T2 0, T3 5, T4 0)
```

- [ ] **Step 3: Run the default suite and static checks**

Run: `bun test tests/scripts/ && bun typecheck && bun lint`

Expected: all pass.

- [ ] **Step 4: Record the intended manifest change**

Run: `bun test:stories:manifest`

Expected: a manifest is written to `reports/stories/manifest.json`. Read its `treeHash` and confirm it differs from the value recorded before this plan — three frozen files changed, so it must. This is the argued exception to spec rule 6 (see Global Constraints); note the new `treeHash` in the PR description so the next refactor qualification re-baselines against this commit rather than an older one.

- [ ] **Step 5: Commit**

Nothing to commit if steps 1–4 are clean. If prettier or oxfmt rewrote anything during verification:

```bash
git add -A
git commit -m "style(stories): apply formatter output from the tier ledger migration"
```

---

## Done when

- `catalogCoverage` records all carry a proving tier; the four new contracts pass.
- The runner line shows five tier tallies.
- One canonical tier table exists; `e2e-planning-workflow.md` points at the spec.
- `bun test:stories:contracts` and `bun test:stories` are green, and the `treeHash` change is recorded as intended.

Next cycle per the spec's queue: **T1 — provider-real**, whose spec owns minting `@1` scenario ids, the `MemoryTaskProvider`-vs-Kaneo parity harness, the pinned Kaneo image, the YouTrack decision, and the measured PR wall-clock budget that rule 5 requires it to set.
