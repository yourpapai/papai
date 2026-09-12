<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Phase 3 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all remaining Phase 3 gaps by promoting its last three records, covering all eleven formerly zero-coverage files, and making Tier 4 operational tests runnable.

**Architecture:** Tier 0 proves stats and product-flow adapters through the existing hermetic story harness. Tier 3 gains a file-level coverage gate around its existing platform scenarios. Tier 4 gains an explicit runner and an isolated poller lifecycle factory backed by a real scheduler. The catalog remains the sole coverage ledger and promotes each record only from its owning tier.

**Tech Stack:** Bun test runner and lcov coverage, TypeScript, SQLite/Drizzle, existing story harness, existing scheduler.

## Global Constraints

- Preserve the declared proving tier for every catalog record.
- Keep platform coverage separate from the Tier 0 story floor.
- Add Tier 4 as a live lane at `tests/operational/`; it must run only through an explicit command.
- Use observable state and `waitFor`, never fixed timing delays.
- Do not use live network access, mock global filesystem APIs, or leave scheduler timers or global state behind.
- Production refactors are limited to explicit, restorable test seams that preserve existing default behavior.
- Use strict TypeScript, `.js` import extensions, structured error extraction, and no lint/type suppressions.
- Do not commit generated coverage or story reports.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `scripts/coverage/lane-file-coverage.ts` | Parse lcov records and fail a lane when a required source file has zero covered lines. |
| `tests/scripts/lane-file-coverage.test.ts` | Unit-test lcov parsing and zero-coverage diagnostics. |
| `tests/stories/http/stats.story.test.ts` | Tier 0 route stories for stats anonymity and aggregate-window behavior. |
| `tests/stories/runtime/staged-attachments.story.test.ts` | Exercise the production staged downloader adapter within resolution flow. |
| `src/changelog-reader.ts` | Add an injected text-reader seam while retaining its current default reader. |
| `tests/stories/pure-helpers/pure-helpers.story.test.ts` | Exercise the injected changelog reader through the public announcement flow. |
| `tests/platform/run-platform.ts` | Remains the Tier 3 entrypoint; runs under a new coverage command. |
| `src/deferred-prompts/poller.ts` | Isolate scheduler-bound poller lifecycle in a factory while preserving current exports. |
| `tests/deferred-prompts/poller-lifecycle.test.ts` | Unit-test factory isolation and default lifecycle delegation. |
| `tests/operational/run-operational.ts` | Explicit Tier 4 entrypoint. |
| `tests/operational/scenarios/catalog.ts` | Registry and literal story ID for Tier 4. |
| `tests/operational/scenarios/deferred-poller-lifecycle.operational.ts` | Real-scheduler lifecycle scenario. |
| `tests/operational/catalog-crosscheck.test.ts` | Bidirectional Tier 4 catalog and marker census. |
| `tests/stories/catalog/coverage.ts` | Promote remaining Phase 3 records and declare Tier 4 live. |
| `tests/stories/harness/catalog-coverage.test.ts` | Freeze final Phase 3 and catalog totals. |
| `package.json` | Add explicit platform-coverage and operational test commands. |

## Task 1: Add File-Level Lane Coverage Gate

**Files:**
- Create: `scripts/coverage/lane-file-coverage.ts`
- Create: `tests/scripts/lane-file-coverage.test.ts`

**Interfaces:**
- Produces `coveredSourceFiles(lcov: string): ReadonlyMap<string, number>`.
- Produces `assertCoveredSourceFiles(lcov: string, required: readonly string[]): void`.
- CLI input is `<lcov-path> <required-source-file>...`; zero/missing records throw `Expected non-zero line coverage: <paths>`.

- [ ] **Step 1: Write failing parser and assertion tests**

```ts
import { describe, expect, test } from 'bun:test'
import { assertCoveredSourceFiles, coveredSourceFiles } from '../../scripts/coverage/lane-file-coverage.js'

const lcov = `SF:src/a.ts\nLF:2\nLH:1\nend_of_record\nSF:src/b.ts\nLF:3\nLH:0\nend_of_record\n`

describe('lane file coverage', () => {
  test('maps each lcov source record to covered lines', () => {
    expect(coveredSourceFiles(lcov)).toEqual(new Map([['src/a.ts', 1], ['src/b.ts', 0]]))
  })

  test('rejects both missing and zero-covered required files', () => {
    expect(() => assertCoveredSourceFiles(lcov, ['src/a.ts', 'src/b.ts', 'src/c.ts'])).toThrow(
      'Expected non-zero line coverage: src/b.ts, src/c.ts',
    )
  })
})
```

- [ ] **Step 2: Run the focused test to verify RED**

Run: `bun test tests/scripts/lane-file-coverage.test.ts`

Expected: FAIL because `lane-file-coverage.js` does not exist.

- [ ] **Step 3: Implement the pure parser and CLI**

```ts
export function coveredSourceFiles(lcov: string): ReadonlyMap<string, number> {
  const covered = new Map<string, number>()
  let source: string | undefined
  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) source = line.slice(3)
    if (source !== undefined && line.startsWith('LH:')) covered.set(source, Number(line.slice(3)))
    if (line === 'end_of_record') source = undefined
  }
  return covered
}

export function assertCoveredSourceFiles(lcov: string, required: readonly string[]): void {
  const covered = coveredSourceFiles(lcov)
  const missing = required.filter((file) => (covered.get(file) ?? 0) === 0)
  if (missing.length > 0) throw new Error(`Expected non-zero line coverage: ${missing.join(', ')}`)
}
```

At module entry, read `Bun.argv[2]` with `Bun.file`, require at least one source-file argument, invoke `assertCoveredSourceFiles`, and print the checked file count. Convert caught errors with `error instanceof Error ? error.message : String(error)`.

- [ ] **Step 4: Run parser tests and formatting checks**

Run: `bun test tests/scripts/lane-file-coverage.test.ts && bun run format:check`

Expected: PASS.

- [ ] **Step 5: Commit the lane coverage gate**

```bash
git add scripts/coverage/lane-file-coverage.ts tests/scripts/lane-file-coverage.test.ts
git commit -m "test(coverage): gate required lane source files"
```

## Task 2: Promote Stats Anonymity And Aggregate Stories

**Files:**
- Create: `tests/stories/http/stats.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts:403-484,1582-1597`
- Modify: `tests/stories/harness/catalog-coverage.test.ts:91-185,235-303,419-432,506-551`

**Interfaces:**
- Produces literal Tier 0 story IDs:
  - `SCN-stats-anonymity: stats responses omit raw subject identity`
  - `SCN-stats-aggregate-window: global stats respect requested aggregation windows`
- Consumes `given.user`, `given.dm`, `given.dashboardSession`, `when.dashboardRequest`, `world.scopedStorageContextId`, `getDrizzleDb`, `llmUsageEvents`, and `clearStatsCacheForTesting`.

- [ ] **Step 1: Write the two failing stories**

```ts
scenario('SCN-stats-anonymity: stats responses omit raw subject identity', async ({ given, when, then, world }) => {
  const privateUser = given.user('private-name')
  const dm = given.dm(privateUser)
  const storageContextId = world.scopedStorageContextId(dm)
  getDrizzleDb().insert(llmUsageEvents).values(seedUsage(storageContextId, privateUser.id, Date.now())).run()
  clearStatsCacheForTesting()

  const session = await given.dashboardSession()
  const response = await when.dashboardRequest(session, `/stats/subject/${encodeURIComponent(storageContextId)}`)
  then.responseStatus(response, 200)
  const body = await response.text()
  expect(body).not.toContain(privateUser.username)
  expect(JSON.parse(body)).toMatchObject({ storageContextId, displayName: null, contextType: 'dm' })
})

scenario('SCN-stats-aggregate-window: global stats respect requested aggregation windows', async ({ given, when, then }) => {
  const now = Date.now()
  getDrizzleDb().insert(llmUsageEvents).values([
    seedUsage('recent-stats', 'recent-user', now),
    seedUsage('expired-stats', 'expired-user', now - 8 * 24 * 60 * 60 * 1000),
  ]).run()
  clearStatsCacheForTesting()

  const session = await given.dashboardSession()
  const week = await when.dashboardRequest(session, '/stats/global?window=7d')
  const all = await when.dashboardRequest(session, '/stats/global?window=all')
  then.responseStatus(week, 200)
  then.responseStatus(all, 200)
  expect((await week.json()).llmUsage.calls).toBe(1)
  expect((await all.json()).llmUsage.calls).toBe(2)
})
```

Define `seedUsage` locally with unique event IDs, `contextType: 'dm'`, `modelRole: 'main'`, and non-null token counts. In `finally`, clear the stats cache to prevent cache state crossing scenarios.

- [ ] **Step 2: Run the stories to verify RED**

Run: `bun test:stories`

Expected: FAIL because the new literal story IDs have no catalog mappings.

- [ ] **Step 3: Promote the two Tier 0 mappings**

Add both mappings to `EXECUTABLE_STORY_MAPPINGS` with `verifiedAt: '2026-08-01'`, `provingTier: '0'`, and exact paths/titles. Remove their `AUDIT_RECORDS` entries. Update the Phase 3 contract so its promoted list includes both IDs and its pending audit projection contains only `SCN-deferred-poller-lifecycle`.

- [ ] **Step 4: Update exact ledger expectations**

Set the intermediate totals to 192 executable and 26 pending. Set audit readiness totals to one `executable-as-is`, four `needs-seam`, and 21 `blocked`: the deferred poller remains the only pending Phase 3 record, while unrelated pending records remain untouched.

- [ ] **Step 5: Run Tier 0 contracts and stories**

Run: `bun test:stories:contracts && bun test:stories`

Expected: PASS; catalog line reports 192/218 executable and 26 pending.

- [ ] **Step 6: Commit the stats stories**

```bash
git add tests/stories/http/stats.story.test.ts tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(stories): cover Phase 3 stats contracts"
```

## Task 3: Exercise Staged Downloader And Changelog Reader

**Files:**
- Modify: `tests/stories/runtime/staged-attachments.story.test.ts:10-17,84-133`
- Modify: `src/changelog-reader.ts:6-8`
- Modify: `tests/stories/pure-helpers/pure-helpers.story.test.ts:8-13,56-61`
- Test: `tests/attachments/staged-download.test.ts`
- Test: `tests/announcements/announce-new-version.test.ts`

**Interfaces:**
- Produces `type ReadChangelogText = (url: URL) => Promise<string>`.
- Changes `readChangelogFile` to `readChangelogFile(readText?: ReadChangelogText): Promise<string>`; omitted dependency preserves production `Bun.file(url).text()` behavior.

- [ ] **Step 1: Write failing staged-resolution assertions through the factory**

Replace the inline successful downloader with:

```ts
const downloads: Array<readonly [string, string, string]> = []
const downloader = createStagedDownloader({
  downloadFileFromInstance: (platformInstanceId, sourceProvider, fileId) => {
    downloads.push([platformInstanceId, sourceProvider, fileId])
    return Promise.resolve(Buffer.from('fixed-bytes'))
  },
})
const resolved = await resolveStagedFile(restaged.stagedId, contextId, downloader)
expect(downloads).toEqual([[thread.platformInstanceId, 'telegram', 'telegram-retry-me']])
```

Import `createStagedDownloader` from `src/attachments/staged-download.js`. Keep the existing terminal-failure and already-resolved assertions.

- [ ] **Step 2: Write a failing injectable-reader story**

Replace the direct `extractChangelogSection` story with a public announcement-flow assertion:

```ts
const reads: URL[] = []
const reader = () =>
  readChangelogFile((url) => {
    reads.push(url)
    return Promise.resolve(`## [${VERSION}]\nnew\n\n## [0.0.1]\nold`)
  })
await announceNewVersion(chat, 'platform', 'admin', { ...deps, readChangelogFile: reader })
expect(reads).toHaveLength(1)
expect(sent[0]).toContain('new')
expect(sent[0]).not.toContain('old')
```

Use the existing announcement dependency shape and a deterministic chat double. Retain the unmatched-version assertion by returning a changelog without `VERSION` and expecting no persisted draft or outbound message.

- [ ] **Step 3: Run the focused tests to verify RED**

Run: `bun test tests/stories/runtime/staged-attachments.story.test.ts tests/stories/pure-helpers/pure-helpers.story.test.ts tests/attachments/staged-download.test.ts tests/announcements/announce-new-version.test.ts`

Expected: FAIL because `readChangelogFile` does not accept a reader dependency and the story does not yet invoke the factory.

- [ ] **Step 4: Add the reader seam without changing defaults**

```ts
export type ReadChangelogText = (url: URL) => Promise<string>

const defaultReadText: ReadChangelogText = (url) => Bun.file(url).text()

export function readChangelogFile(readText: ReadChangelogText = defaultReadText): Promise<string> {
  return readText(new URL('../CHANGELOG.md', import.meta.url))
}
```

Do not change `defaultAnnouncementsDeps`; its existing `readChangelogFile: defaultReadChangelogFile` continues to call the default reader.

- [ ] **Step 5: Run focused tests and Tier 0 coverage**

Run: `bun test tests/attachments/staged-download.test.ts tests/announcements/announce-new-version.test.ts && bun test:stories:coverage`

Expected: PASS; lcov reports non-zero `LH` for `src/attachments/staged-download.ts` and `src/changelog-reader.ts`.

- [ ] **Step 6: Commit adapter coverage**

```bash
git add src/changelog-reader.ts tests/stories/runtime/staged-attachments.story.test.ts tests/stories/pure-helpers/pure-helpers.story.test.ts tests/attachments/staged-download.test.ts tests/announcements/announce-new-version.test.ts
git commit -m "test(stories): cover Phase 3 adapter boundaries"
```

## Task 4: Enforce Tier 3 Adapter Coverage

**Files:**
- Create: `tests/platform/run-platform-coverage.ts`
- Modify: `tests/platform/catalog-crosscheck.test.ts:14-60` to assert the five required source paths are declared by the coverage command
- Test: `tests/scripts/lane-file-coverage.test.ts`
- Modify: `package.json:53-57`

**Interfaces:**
- Consumes `assertCoveredSourceFiles` and the five Tier 3 source paths declared in Task 1.
- Produces `bun test:platform:coverage`, which fails if any required adapter source has zero covered lines.

- [ ] **Step 1: Add a failing Tier 3 required-files expectation**

```ts
expect(PLATFORM_COVERAGE_FILES).toEqual([
  'src/chat/discord/commands.ts',
  'src/chat/discord/format-chunking.ts',
  'src/chat/discord/interaction-helpers.ts',
  'src/chat/kontur-talk/reply-helpers.ts',
  'src/chat/telegram/admin-helpers.ts',
])
```

Export `PLATFORM_COVERAGE_FILES` from `tests/platform/scenarios/catalog.ts` beside `PLATFORM_STORY_IDS`, so the runner command and crosscheck have one canonical list.

- [ ] **Step 2: Run the crosscheck to verify RED**

Run: `bun test tests/platform/catalog-crosscheck.test.ts`

Expected: FAIL because `PLATFORM_COVERAGE_FILES` is not exported.

- [ ] **Step 3: Define the shared list and coverage wrapper**

Add the exact ordered tuple above to `catalog.ts`. Create `run-platform-coverage.ts`:

```ts
import { assertCoveredSourceFiles } from '../../scripts/coverage/lane-file-coverage.js'
import { PLATFORM_COVERAGE_FILES } from './scenarios/catalog.js'

const [lcovPath] = Bun.argv.slice(2)
if (lcovPath === undefined) throw new Error('Usage: bun tests/platform/run-platform-coverage.ts <lcov-path>')
assertCoveredSourceFiles(await Bun.file(lcovPath).text(), PLATFORM_COVERAGE_FILES)
```

Add this script to `package.json`:

```json
"test:platform:coverage": "rm -rf coverage/platform && bun test --coverage --coverage-reporter=lcov --coverage-dir coverage/platform ./tests/platform/run-platform.ts && bun tests/platform/run-platform-coverage.ts coverage/platform/lcov.info"
```

This keeps the source list in the registry rather than duplicating it in package JSON.

- [ ] **Step 4: Run Tier 3 coverage**

Run: `bun test:platform:coverage`

Expected: PASS; the coverage gate prints five checked source files.

- [ ] **Step 5: Commit Tier 3 coverage qualification**

```bash
git add package.json tests/platform/run-platform-coverage.ts tests/platform/scenarios/catalog.ts tests/platform/catalog-crosscheck.test.ts
git commit -m "test(platform): gate Phase 3 adapter coverage"
```

## Task 5: Isolate Poller Lifecycle From The Global Scheduler

**Files:**
- Modify: `src/deferred-prompts/poller.ts:13,108-151`
- Create: `tests/deferred-prompts/poller-lifecycle.test.ts`

**Interfaces:**
- Produces `createPollerLifecycle(scheduler: Scheduler): PollerLifecycle`.
- Produces `PollerLifecycle` with `startPollers(chat: ChatProvider, buildProviderFn: BuildProviderFn): void`, `stopPollers(): void`, and `getPollerSnapshot(): PollerSnapshot`.
- Existing `startPollers`, `stopPollers`, and `getPollerSnapshot` remain exports delegated from one production lifecycle created with the singleton scheduler.

- [ ] **Step 1: Write failing factory-isolation tests**

```ts
test('registers once and removes both pollers when stopped', async () => {
  const scheduler = createScheduler({ unrefByDefault: true })
  const lifecycle = createPollerLifecycle(scheduler)
  lifecycle.startPollers(chat, buildProvider)
  lifecycle.startPollers(chat, buildProvider)
  await waitFor(() => scheduler.getTaskState('deferred-scheduled-poll')?.running === true)
  expect(scheduler.hasTask('deferred-alert-poll')).toBe(true)

  lifecycle.stopPollers()
  await scheduler.drainAll()
  expect(scheduler.hasTask('deferred-scheduled-poll')).toBe(false)
  expect(scheduler.hasTask('deferred-alert-poll')).toBe(false)
})
```

Use a real `createScheduler`, a `createMockChat()` instance, and a minimal `BuildProviderFn` that throws if invoked while no due work is seeded. In `afterEach`, call `lifecycle.stopPollers()` and `await scheduler.drainAll()`.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `bun test tests/deferred-prompts/poller-lifecycle.test.ts`

Expected: FAIL because `createPollerLifecycle` is not exported.

- [ ] **Step 3: Extract the lifecycle factory**

Move the `isRunning` flag into `createPollerLifecycle`. Its `startPollers` registers and starts the same two names, intervals, handlers, and immediate options against the supplied scheduler. Its `stopPollers` calls `stopRegisteredPollerTask` for both names and clears only that factory's running flag. Its snapshot reports factory-local running state and the existing constants. Then delegate the public exports:

```ts
const defaultPollerLifecycle = createPollerLifecycle(scheduler)
export const startPollers = defaultPollerLifecycle.startPollers
export const stopPollers = defaultPollerLifecycle.stopPollers
export const getPollerSnapshot = defaultPollerLifecycle.getPollerSnapshot
```

- [ ] **Step 4: Run poller and scheduler regressions**

Run: `bun test tests/deferred-prompts/poller-lifecycle.test.ts tests/deferred-prompts tests/utils/scheduler`

Expected: PASS; existing production exports retain behavior.

- [ ] **Step 5: Commit the poller seam**

```bash
git add src/deferred-prompts/poller.ts tests/deferred-prompts/poller-lifecycle.test.ts
git commit -m "refactor(deferred): isolate poller scheduler lifecycle"
```

## Task 6: Add Tier 4 Operational Poller Lane And Promote Final Record

**Files:**
- Create: `tests/operational/run-operational.ts`
- Create: `tests/operational/scenarios/catalog.ts`
- Create: `tests/operational/scenarios/deferred-poller-lifecycle.operational.ts`
- Create: `tests/operational/catalog-crosscheck.test.ts`
- Modify: `tests/stories/catalog/coverage.ts:16-29,403-484,1582-1597`
- Modify: `tests/stories/harness/catalog-coverage.test.ts:169-185,235-303,419-432,506-551`
- Modify: `package.json:53-57`

**Interfaces:**
- Produces `OPERATIONAL_STORIES['SCN-deferred-poller-lifecycle']` with the literal title `starts, runs, and stops deferred pollers without residual scheduler tasks`.
- Produces `OPERATIONAL_STORY_IDS` using the same `{ file }#${title}` convention as Tier 2 and Tier 3.
- Promotes `SCN-deferred-poller-lifecycle` at proving tier `'4'`.

- [ ] **Step 1: Write the failing operational scenario**

```ts
test(title('SCN-deferred-poller-lifecycle'), async () => {
  const scheduler = createScheduler({ unrefByDefault: true })
  const lifecycle = createPollerLifecycle(scheduler)
  try {
    lifecycle.startPollers(chat, buildProvider)
    await waitFor(() => scheduler.getTaskState('deferred-scheduled-poll')?.lastRun !== null)
    expect(scheduler.getTaskState('deferred-alert-poll')?.running).toBe(true)

    lifecycle.stopPollers()
    await scheduler.drainAll()
    expect(scheduler.hasTask('deferred-scheduled-poll')).toBe(false)
    expect(scheduler.hasTask('deferred-alert-poll')).toBe(false)
  } finally {
    lifecycle.stopPollers()
    await scheduler.drainAll()
  }
})
```

Define `title(key)` from `OPERATIONAL_STORIES[key].title`, mirroring Tier 2/3. Use a minimal no-due-work database setup and deterministic chat/provider doubles; the assertion is lifecycle execution, not LLM output.

- [ ] **Step 2: Add the runner, registry, and failing catalog crosscheck**

`run-operational.ts` imports only the `.operational.ts` scenario. The crosscheck mirrors the Tier 2 implementation with `tier: '4'`, glob `tests/operational/scenarios/*.operational.ts`, and `OPERATIONAL_STORY_IDS`. Its first test expects exactly one T4 record and maps it to the registry's exact story ID.

Add these scripts to `package.json`:

```json
"test:operational": "bun test ./tests/operational/run-operational.ts ./tests/operational/catalog-crosscheck.test.ts",
"test:operational:coverage": "rm -rf coverage/operational && bun test --coverage --coverage-reporter=lcov --coverage-dir coverage/operational ./tests/operational/run-operational.ts ./tests/operational/catalog-crosscheck.test.ts && bun scripts/coverage/lane-file-coverage.ts coverage/operational/lcov.info src/deferred-prompts/poller-lifecycle.ts"
```

- [ ] **Step 3: Verify RED before catalog promotion**

Run: `bun test tests/operational/run-operational.ts tests/operational/catalog-crosscheck.test.ts`

Expected: FAIL because Tier 4 is not live, has no executable mapping, and is absent from the catalog registry.

- [ ] **Step 4: Promote Tier 4 in the ledger**

Add `'4'` to `LIVE_STORY_TIERS`; retain `tests/operational/` as `TIER_SUITE_ROOTS['4']`. Add the exact `EXECUTABLE_STORY_MAPPINGS` record with `verifiedAt: '2026-08-01'`, `provingTier: '4'`, and the operational story ID. Remove its audit record.

Update Phase 3 tests to require all 21 IDs as promoted executable records and no Phase 3 pending projection. Update final totals to 193 executable and 25 pending, with readiness totals 0 executable-as-is, 3 needs-seam, and 22 blocked. Update proving-tier expectations to include `'4'`.

- [ ] **Step 5: Run Tier 4 and its coverage gate**

Run: `bun test:operational && bun test:operational:coverage`

Expected: PASS; coverage gate reports non-zero coverage for `src/deferred-prompts/poller-lifecycle.ts`.

- [ ] **Step 6: Run catalog contracts and commit the Tier 4 lane**

Run: `bun test:stories:contracts`

Expected: PASS; catalog line reports 193/218 executable and 25 pending.

```bash
git add package.json tests/operational tests/stories/catalog/coverage.ts tests/stories/harness/catalog-coverage.test.ts
git commit -m "test(operational): cover deferred poller lifecycle"
```

## Task 7: Final Phase 3 Qualification

**Files:**
- Modify: `scripts/story/coverage-floor.json` only if a green full Tier 0 coverage run exceeds the committed floor and `bun coverage:ratchet:stories` raises it.
- Modify: `scripts/coverage/floor.json` only if the full in-process coverage ratchet raises it.

**Interfaces:**
- Consumes the lane coverage commands from Tasks 1, 4, and 6.
- Produces evidence that every specified Phase 3 behavior and source file is covered in its owning lane.

- [ ] **Step 1: Run all Phase 3 lanes**

Run: `bun test:stories:contracts && bun test:stories:coverage && bun test:platform:coverage && bun test:operational:coverage`

Expected: PASS. Confirm lcov output has non-zero covered lines for all eleven files:

```text
src/attachments/staged-download.ts
src/changelog-reader.ts
src/chat/discord/commands.ts
src/chat/discord/format-chunking.ts
src/chat/discord/interaction-helpers.ts
src/chat/kontur-talk/reply-helpers.ts
src/chat/telegram/admin-helpers.ts
src/deferred-prompts/poller-lifecycle.ts
src/plugins/deny.ts
src/utils/changelog.ts
src/utils/scheduler.executions.ts
```

- [ ] **Step 2: Run repository quality gates**

Run: `bun run typecheck && bun run lint && bun run format:check && bun test tests/deferred-prompts/poller-lifecycle.test.ts tests/scripts/lane-file-coverage.test.ts`

Expected: PASS.

- [ ] **Step 3: Run the full coverage ratchets**

Run: `bun test:coverage && bun coverage:ratchet && bun coverage:ratchet:stories`

Expected: PASS. If either ratchet reports an improved floor, update only that floor file and rerun the corresponding command before staging it.

- [ ] **Step 4: Inspect final repository state**

Run: `git status --short && git diff --check && git diff --name-only`

Expected: no generated `coverage/**` or `reports/stories/**` files are staged; only intended source, test, catalog, command, and ratchet changes remain.

- [ ] **Step 5: Commit any ratchet updates**

```bash
git add scripts/coverage/floor.json scripts/story/coverage-floor.json
git commit -m "test(coverage): ratchet Phase 3 floors"
```

Skip this commit only if neither floor changed.
