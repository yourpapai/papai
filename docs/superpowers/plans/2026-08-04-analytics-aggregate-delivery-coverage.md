<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics Aggregate Delivery Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the governed aggregate-release-through-settings path and hermetic captured-sink delivery in the Tier 0 story lane, with executable catalog records.

**Architecture:** Drive the real settings admin routes (`PATCH /settings/api/admin/analytics`, `POST /settings/api/admin/analytics/reconcile` with `release.execute`) from a hermetic story against seeded finalized aggregate cells and an enabled aggregate sink staged through the production `createSinkVersion` plus a direct state flip. Run the real `runDeliveryWorkerTick` with the captured sink's injected `PinnedTransport` and a pinned `lookupAll`, so no byte ever leaves the process. Register each scenario one-to-one in the Tier 0 catalog.

**Tech Stack:** Bun 1.3.13, TypeScript, `bun:test`, existing hermetic story sandbox (`tests/stories/harness/scenario.ts`), drizzle-orm SQLite, `src/analytics/delivery/captured-sink.testing.ts`.

## Global Constraints

- Scope is aggregate release through settings plus hermetic injected captured delivery. Do **not** touch real egress, sink verification (`verify` route or `SinkProbe`), derive/intent/backfill/rekey jobs, or snapshot paths.
- All scenario IDs, metric names, day strings computed from `Date.now()`, and fake outcomes are deterministic; never use live network endpoints, live credentials, random data, fixed-wall-clock waits, or test ordering.
- Stories run the real settings route handlers and the real delivery worker; never call `buildDailyAggregateRelease` internals as the proof of the settings path.
- Keep the Tier 0 floors at `lines: 0.71` and `functions: 0.70`; do not lower either value.
- Every new `scenario(...)` must be registered in `tests/stories/catalog/coverage.ts` in the same commit that introduces it; an uncataloged scenario fails `bun test:stories:contracts`.
- Use `.js` extensions in TypeScript imports and strict TypeScript without lint/type suppressions.
- Transient `process.env` mutations inside a scenario must be restored in-scenario; the `given.analyticsRuntime` teardown restores the keyring and kill-switch variables it owns.
- Every scenario must assert one operator-visible result (HTTP response) and one durable/system result (SQLite rows or captured requests).

---

## File Structure

| File | Responsibility |
| --- | --- |
| Create: `tests/stories/analytics/aggregate-delivery.story.test.ts` | Four Tier 0 scenarios covering settings-driven release, the denial matrix, captured delivery, and delivery governance (kill switch + retry). |
| Modify: `tests/stories/catalog/coverage.ts` | Add four `SCN-analytics-aggregate-*` ids to `CATALOG_SCENARIO_IDS`, four executable records with `provingTier: '0'`, and extend `CATALOG_SOURCE`. |

No production source files and no harness files change. Sink staging and cell seeding are story-local helpers built on production functions (`createSinkVersion`, drizzle inserts), matching the precedent in `tests/analytics/privacy-contract.test.ts:387-403`.

### Task 1: Settings-driven aggregate release story

**Files:**
- Create: `tests/stories/analytics/aggregate-delivery.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts:225-226` (id tuple region) and `:1540-1544` (record map region)

**Interfaces:**
- Consumes: `scenario`, `answer` from the story harness; `createSinkVersion` from `src/analytics/delivery/sink-service.ts`; `CAPTURED_SINK_ENDPOINT`, `SYNTHETIC_SINK_TOKEN` from `src/analytics/delivery/captured-sink.testing.ts`.
- Produces (story-local, reused by Tasks 2-4): `seedEnabledAggregateSink(nowMs: number): string` returning the enabled `sinkVersionId`; `insertFinalizedCounter(input: { utcDay: string; metric: string; value: number; contributorCount: number }): void`; `completeUtcDay(): string` returning the UTC day two days before `Date.now()`; `ReleaseExecutionSchema` for response parsing.

- [ ] **Step 1: Write the failing release story**

Create `tests/stories/analytics/aggregate-delivery.story.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { and, eq } from 'drizzle-orm'
import { z } from 'zod'

import { AnalyticsAggregateReleaseV1Schema } from '../../../src/analytics/delivery/aggregate-release.js'
import { CAPTURED_SINK_ENDPOINT, SYNTHETIC_SINK_TOKEN } from '../../../src/analytics/delivery/captured-sink.testing.js'
import { createSinkVersion } from '../../../src/analytics/delivery/sink-service.js'
import { analyticsDailyCounters } from '../../../src/db/analytics-schema.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { analyticsAggregateDeliveries, analyticsAggregateReleases, analyticsSinks } from '../../../src/db/schema.js'
import { scenario } from '../harness/scenario.js'

const DAY_MS = 86_400_000

const completeUtcDay = (): string => new Date(Date.now() - 2 * DAY_MS).toISOString().slice(0, 10)

const seedEnabledAggregateSink = (nowMs: number): string => {
  const view = createSinkVersion(
    {
      logicalSinkId: 'story-aggregate-sink',
      kind: 'webhook',
      egressMode: 'aggregate',
      endpoint: CAPTURED_SINK_ENDPOINT,
      secret: SYNTHETIC_SINK_TOKEN,
      nowMs,
    },
    { getDrizzleDb, probe: () => Promise.resolve({ ok: true }) },
  )
  getDrizzleDb()
    .update(analyticsSinks)
    .set({ state: 'enabled', verifiedAtMs: nowMs })
    .where(eq(analyticsSinks.sinkVersionId, view.sinkVersionId))
    .run()
  return view.sinkVersionId
}

const insertFinalizedCounter = (input: {
  utcDay: string
  metric: string
  value: number
  contributorCount: number
}): void => {
  getDrizzleDb()
    .insert(analyticsDailyCounters)
    .values({
      utcDay: input.utcDay,
      definitionVersion: 1,
      platform: 'all',
      contextType: 'all',
      actorRole: 'all',
      taskProvider: 'all',
      appVersion: 'all',
      metric: input.metric,
      value: input.value,
      finalized: true,
      partialDay: false,
      restartGapDetected: false,
      lateEventCount: 0,
      reconciliationStatus: 'complete_epoch',
      disclosureScope: 'local_only',
      contributorBasis: 'eligible_actor',
      contributorCount: input.contributorCount,
      threshold: null,
    })
    .run()
}

const AdminAnalyticsViewSchema = z.looseObject({
  configVersion: z.number(),
  mode: z.looseObject({ externalAggregateEnabled: z.boolean() }),
})

const ReleaseExecutionSchema = z.looseObject({
  releaseExecution: z.object({
    status: z.string(),
    releaseId: z.string(),
    releaseHash: z.string(),
    cellCount: z.number(),
  }),
})

const disclosureScopeOf = (utcDay: string, metric: string): string | null => {
  const row = getDrizzleDb()
    .select({ disclosureScope: analyticsDailyCounters.disclosureScope })
    .from(analyticsDailyCounters)
    .where(and(eq(analyticsDailyCounters.utcDay, utcDay), eq(analyticsDailyCounters.metric, metric)))
    .get()
  return row?.disclosureScope ?? null
}

scenario(
  'SCN-analytics-aggregate-release-settings: an operator enables the aggregate lane, executes a release through settings, and a re-execute is idempotent',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const admin = await given.settingsAdminSession(alice)
    given.analyticsRuntime('governed')
    const nowMs = Date.now()
    const utcDay = completeUtcDay()
    const sinkVersionId = seedEnabledAggregateSink(nowMs)
    insertFinalizedCounter({ utcDay, metric: 'turn_started', value: 250, contributorCount: 40 })
    insertFinalizedCounter({ utcDay, metric: 'message_accepted', value: 7, contributorCount: 3 })

    const view = await when.settingsRequest(admin, '/settings/api/admin/analytics')
    then.responseStatus(view, 200)
    const { configVersion } = AdminAnalyticsViewSchema.parse(await view.json())

    const patch = await when.settingsRequest(admin, '/settings/api/admin/analytics', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedConfigVersion: configVersion, externalAggregateEnabled: true }),
    })
    then.responseStatus(patch, 200)
    expect(AdminAnalyticsViewSchema.parse(await patch.json()).mode.externalAggregateEnabled).toBe(true)

    const releaseBody = JSON.stringify({ release: { utcDay, sinkVersionId, execute: true } })
    const released = await when.settingsRequest(admin, '/settings/api/admin/analytics/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: releaseBody,
    })
    then.responseStatus(released, 200)
    const execution = ReleaseExecutionSchema.parse(await released.json()).releaseExecution
    expect(execution.status).toBe('released')
    expect(execution.cellCount).toBe(1)
    expect(execution.releaseHash).toMatch(/^[0-9a-f]{64}$/u)

    const releases = getDrizzleDb().select().from(analyticsAggregateReleases).all()
    expect(releases).toHaveLength(1)
    const payload = AnalyticsAggregateReleaseV1Schema.parse(JSON.parse(releases[0]!.payloadJson))
    expect(payload.utc_day).toBe(utcDay)
    expect(payload.cells).toHaveLength(1)

    const deliveries = getDrizzleDb().select().from(analyticsAggregateDeliveries).all()
    expect(deliveries).toHaveLength(1)
    expect(deliveries[0]).toMatchObject({ releaseId: execution.releaseId, sinkVersionId, state: 'pending', attempts: 0 })

    expect(disclosureScopeOf(utcDay, 'turn_started')).toBe('external_eligible')
    expect(disclosureScopeOf(utcDay, 'message_accepted')).toBe('suppressed')

    const repeated = await when.settingsRequest(admin, '/settings/api/admin/analytics/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: releaseBody,
    })
    then.responseStatus(repeated, 200)
    const repeatExecution = ReleaseExecutionSchema.parse(await repeated.json()).releaseExecution
    expect(repeatExecution).toMatchObject({ status: 'already_released', releaseId: execution.releaseId, cellCount: 0 })
    expect(getDrizzleDb().select().from(analyticsAggregateReleases).all()).toHaveLength(1)
  },
  { testTimeoutMs: 15000 },
)
```

- [ ] **Step 2: Run the story to verify it fails the catalog census**

Run: `bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts`

Expected: the story itself PASSES against existing production behavior, but `bun test:stories:contracts` FAILS with an uncataloged-scenario census error naming `SCN-analytics-aggregate-release-settings`.

- [ ] **Step 3: Register the catalog id and record**

In `tests/stories/catalog/coverage.ts`, add `'SCN-analytics-aggregate-release-settings',` to `CATALOG_SCENARIO_IDS` immediately after `'SCN-analytics-governed-turn',` (line 226), and add the record immediately after the `'SCN-analytics-governed-turn'` record:

```ts
  'SCN-analytics-aggregate-release-settings': {
    verifiedAt: '2026-08-04',
    provingTier: '0',
    storyIds: [
      'tests/stories/analytics/aggregate-delivery.story.test.ts#SCN-analytics-aggregate-release-settings: an operator enables the aggregate lane, executes a release through settings, and a re-execute is idempotent',
    ],
  },
```

- [ ] **Step 4: Run the story and the contracts**

Run: `bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts && bun test:stories:contracts`

Expected: both exit `0`.

- [ ] **Step 5: Commit the release story**

```bash
git add tests/stories/analytics/aggregate-delivery.story.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover settings-driven aggregate release"
```

### Task 2: Release denial matrix story

**Files:**
- Modify: `tests/stories/analytics/aggregate-delivery.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

**Interfaces:**
- Consumes: `seedEnabledAggregateSink`, `insertFinalizedCounter`, `completeUtcDay`, and `AdminAnalyticsViewSchema` from Task 1.
- Produces: `ReleaseDeniedSchema` (`z.looseObject({ code: z.string() })` plus optional `reason`), reused by Task 3.

- [ ] **Step 1: Write the failing denial story**

Append to `tests/stories/analytics/aggregate-delivery.story.test.ts`:

```ts
const ReleaseDeniedSchema = z.looseObject({ code: z.string(), reason: z.string().optional() })

scenario(
  'SCN-analytics-aggregate-release-denials: release requests are denied without a sink, with an incomplete day, and for drill-through, and non-admins cannot execute',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const admin = await given.settingsAdminSession(alice)
    const memberSession = await when.settingsSession(bob)
    given.analyticsRuntime('governed')
    const nowMs = Date.now()
    const utcDay = completeUtcDay()
    const sinkVersionId = seedEnabledAggregateSink(nowMs)
    insertFinalizedCounter({ utcDay, metric: 'turn_started', value: 250, contributorCount: 40 })

    const postRelease = (session: typeof admin, body: unknown): Promise<Response> =>
      when.settingsRequest(session, '/settings/api/admin/analytics/reconcile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    const forbidden = await postRelease(memberSession, { release: { utcDay, sinkVersionId, execute: true } })
    then.responseStatus(forbidden, 403)

    const missingSink = await postRelease(admin, { release: { utcDay, execute: true } })
    then.responseStatus(missingSink, 422)
    expect(ReleaseDeniedSchema.parse(await missingSink.json()).code).toBe('release_sink_required')

    const unknownSink = await postRelease(admin, { release: { utcDay, sinkVersionId: 'story-aggregate-sink:v99', execute: true } })
    then.responseStatus(unknownSink, 422)
    expect(ReleaseDeniedSchema.parse(await unknownSink.json()).code).toBe('release_sink_unavailable')

    const today = new Date(Date.now()).toISOString().slice(0, 10)
    const incompleteDay = await postRelease(admin, { release: { utcDay: today, sinkVersionId, execute: true } })
    then.responseStatus(incompleteDay, 422)
    const incomplete = ReleaseDeniedSchema.parse(await incompleteDay.json())
    expect(incomplete).toMatchObject({ code: 'release_denied', reason: 'incomplete_day' })

    const drillThrough = await postRelease(admin, { release: { utcDay, sinkVersionId, execute: true, drillThrough: true } })
    then.responseStatus(drillThrough, 422)
    const drill = ReleaseDeniedSchema.parse(await drillThrough.json())
    expect(drill).toMatchObject({ code: 'release_denied', reason: 'drill_through' })

    const assessmentOnly = await postRelease(admin, { release: { utcDay, sinkVersionId } })
    then.responseStatus(assessmentOnly, 200)

    expect(getDrizzleDb().select().from(analyticsAggregateReleases).all()).toHaveLength(0)
    expect(getDrizzleDb().select().from(analyticsAggregateDeliveries).all()).toHaveLength(0)
  },
  { testTimeoutMs: 15000 },
)
```

The `assessmentOnly` request proves `execute` omitted runs the assessment without staging a release; the final two assertions prove no denial staged durable rows.

- [ ] **Step 2: Run the story to verify the census failure**

Run: `bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts`

Expected: the story PASSES; `bun test:stories:contracts` FAILS naming the uncataloged `SCN-analytics-aggregate-release-denials`.

- [ ] **Step 3: Register the catalog record**

Add `'SCN-analytics-aggregate-release-denials',` to `CATALOG_SCENARIO_IDS` after the Task 1 id, and the record after the Task 1 record:

```ts
  'SCN-analytics-aggregate-release-denials': {
    verifiedAt: '2026-08-04',
    provingTier: '0',
    storyIds: [
      'tests/stories/analytics/aggregate-delivery.story.test.ts#SCN-analytics-aggregate-release-denials: release requests are denied without a sink, with an incomplete day, and for drill-through, and non-admins cannot execute',
    ],
  },
```

- [ ] **Step 4: Run the story and the contracts**

Run: `bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts && bun test:stories:contracts`

Expected: both exit `0`.

- [ ] **Step 5: Commit the denial story**

```bash
git add tests/stories/analytics/aggregate-delivery.story.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover aggregate release denial matrix"
```

### Task 3: Captured delivery of a staged release

**Files:**
- Modify: `tests/stories/analytics/aggregate-delivery.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

**Interfaces:**
- Consumes: Task 1 helpers and the settings release flow.
- Produces: `stageRelease(when: ScenarioApi['when'], admin: SettingsSessionHandle, utcDay: string, sinkVersionId: string): Promise<string>` story-local helper returning the `releaseId` of a freshly staged release; `capturedLookupAll` constant used by Task 4.

- [ ] **Step 1: Write the failing captured-delivery story**

Add imports to the story file:

```ts
import { createCapturedSink, findCanaries } from '../../../src/analytics/delivery/captured-sink.testing.js'
import { runDeliveryWorkerTick } from '../../../src/analytics/delivery/worker.js'
import type { SettingsSessionHandle } from '../harness/fixtures.js'
import type { ScenarioApi } from '../harness/scenario.js'
```

Append the scenario:

```ts
const capturedLookupAll = (): Promise<readonly { address: string; family: 4 }[]> =>
  Promise.resolve([{ address: '203.0.113.10', family: 4 as const }])

const stageRelease = async (
  when: ScenarioApi['when'],
  admin: SettingsSessionHandle,
  utcDay: string,
  sinkVersionId: string,
): Promise<string> => {
  const response = await when.settingsRequest(admin, '/settings/api/admin/analytics/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ release: { utcDay, sinkVersionId, execute: true } }),
  })
  expect(response.status).toBe(200)
  return ReleaseExecutionSchema.parse(await response.json()).releaseExecution.releaseId
}

scenario(
  'SCN-analytics-aggregate-delivery-captured: the delivery worker sends a staged release to the captured sink with the payload contract and no pseudonymous fields',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const admin = await given.settingsAdminSession(alice)
    given.analyticsRuntime('governed')
    const nowMs = Date.now()
    const utcDay = completeUtcDay()
    const sinkVersionId = seedEnabledAggregateSink(nowMs)
    insertFinalizedCounter({ utcDay, metric: 'turn_started', value: 250, contributorCount: 40 })
    const releaseId = await stageRelease(when, admin, utcDay, sinkVersionId)

    const sink = createCapturedSink({ kind: 'delivered', status: 200, receiptHash: 'f'.repeat(64) })
    const tickNow = Date.now()
    const tick = await runDeliveryWorkerTick(
      { nowMs: tickNow },
      { getDrizzleDb, transport: sink.transport, lookupAll: capturedLookupAll },
    )
    expect(tick).toEqual({ status: 'ok', leased: 1, delivered: 1, retryable: 0, ambiguous: 0, dead: 0 })

    expect(sink.requests).toHaveLength(1)
    const request = sink.requests[0]!
    expect(request.url).toBe(CAPTURED_SINK_ENDPOINT)
    expect(request.pinnedAddress).toBe('203.0.113.10')
    expect(request.headers['authorization']).toBe(`Bearer ${SYNTHETIC_SINK_TOKEN}`)

    const payload = AnalyticsAggregateReleaseV1Schema.parse(JSON.parse(request.body))
    expect(payload.utc_day).toBe(utcDay)
    expect(payload.cells).toHaveLength(1)
    expect(findCanaries([request.body], ['actor_key', 'conversation_key', 'turn_key', 'session_key', alice.id])).toEqual(
      [],
    )

    const delivery = getDrizzleDb()
      .select()
      .from(analyticsAggregateDeliveries)
      .where(eq(analyticsAggregateDeliveries.releaseId, releaseId))
      .get()
    expect(delivery).toMatchObject({ state: 'delivered', attempts: 1 })
    expect(delivery?.remoteReceiptHash).toMatch(/^[0-9a-f]{64}$/u)
  },
  { testTimeoutMs: 15000 },
)
```

- [ ] **Step 2: Run the story to verify the census failure**

Run: `bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts`

Expected: all three scenarios PASS; contracts FAIL naming `SCN-analytics-aggregate-delivery-captured`.

- [ ] **Step 3: Register the catalog record**

Add `'SCN-analytics-aggregate-delivery-captured',` to `CATALOG_SCENARIO_IDS` after the Task 2 id, and the record after the Task 2 record:

```ts
  'SCN-analytics-aggregate-delivery-captured': {
    verifiedAt: '2026-08-04',
    provingTier: '0',
    storyIds: [
      'tests/stories/analytics/aggregate-delivery.story.test.ts#SCN-analytics-aggregate-delivery-captured: the delivery worker sends a staged release to the captured sink with the payload contract and no pseudonymous fields',
    ],
  },
```

- [ ] **Step 4: Run the story and the contracts**

Run: `bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts && bun test:stories:contracts`

Expected: both exit `0`.

- [ ] **Step 5: Commit the captured-delivery story**

```bash
git add tests/stories/analytics/aggregate-delivery.story.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover captured aggregate delivery"
```

### Task 4: Delivery governance: kill switch and retry classification

**Files:**
- Modify: `tests/stories/analytics/aggregate-delivery.story.test.ts`
- Modify: `tests/stories/catalog/coverage.ts`

**Interfaces:**
- Consumes: `stageRelease`, `capturedLookupAll`, `createCapturedSink`, `runDeliveryWorkerTick` from Task 3; `ANALYTICS_KILL_SWITCH_ENV` from `src/analytics/governance/policy-store.ts`; `computeRetryDelayMs` from `src/analytics/delivery/worker.ts`.
- Produces: nothing reused by later tasks.

- [ ] **Step 1: Write the failing governance story**

Add imports to the story file:

```ts
import { computeRetryDelayMs } from '../../../src/analytics/delivery/worker.js'
import { ANALYTICS_KILL_SWITCH_ENV } from '../../../src/analytics/governance/policy-store.js'
```

Append the scenario:

```ts
scenario(
  'SCN-analytics-aggregate-delivery-governance: the kill switch defers a staged release and a 5xx schedules a bounded retry before delivery succeeds',
  async ({ given, when, then }) => {
    const alice = given.user('alice')
    const admin = await given.settingsAdminSession(alice)
    given.analyticsRuntime('governed')
    const nowMs = Date.now()
    const utcDay = completeUtcDay()
    const sinkVersionId = seedEnabledAggregateSink(nowMs)
    insertFinalizedCounter({ utcDay, metric: 'turn_started', value: 250, contributorCount: 40 })
    const releaseId = await stageRelease(when, admin, utcDay, sinkVersionId)

    const sink = createCapturedSink({ kind: 'delivered', status: 200, receiptHash: 'f'.repeat(64) })
    const deliveryState = (): string | null =>
      getDrizzleDb()
        .select({ state: analyticsAggregateDeliveries.state })
        .from(analyticsAggregateDeliveries)
        .where(eq(analyticsAggregateDeliveries.releaseId, releaseId))
        .get()?.state ?? null

    process.env[ANALYTICS_KILL_SWITCH_ENV] = '1'
    try {
      const skipped = await runDeliveryWorkerTick(
        { nowMs: Date.now() },
        { getDrizzleDb, transport: sink.transport, lookupAll: capturedLookupAll },
      )
      expect(skipped).toEqual({ status: 'kill_switch', leased: 0, delivered: 0, retryable: 0, ambiguous: 0, dead: 0 })
      expect(deliveryState()).toBe('pending')
      expect(sink.requests).toHaveLength(0)
    } finally {
      Reflect.deleteProperty(process.env, ANALYTICS_KILL_SWITCH_ENV)
    }

    sink.setOutcome({ kind: 'responded', status: 503, errorClass: 'http_5xx' })
    const retryNow = Date.now()
    const retried = await runDeliveryWorkerTick(
      { nowMs: retryNow },
      { getDrizzleDb, transport: sink.transport, lookupAll: capturedLookupAll },
    )
    expect(retried).toEqual({ status: 'ok', leased: 1, delivered: 0, retryable: 1, ambiguous: 0, dead: 0 })
    const pendingRow = getDrizzleDb()
      .select()
      .from(analyticsAggregateDeliveries)
      .where(eq(analyticsAggregateDeliveries.releaseId, releaseId))
      .get()
    expect(pendingRow).toMatchObject({ state: 'pending', attempts: 1, nextAttemptAtMs: retryNow + computeRetryDelayMs(0) })

    const early = await runDeliveryWorkerTick(
      { nowMs: retryNow },
      { getDrizzleDb, transport: sink.transport, lookupAll: capturedLookupAll },
    )
    expect(early).toEqual({ status: 'ok', leased: 0, delivered: 0, retryable: 0, ambiguous: 0, dead: 0 })

    sink.setOutcome({ kind: 'delivered', status: 200, receiptHash: 'f'.repeat(64) })
    const delivered = await runDeliveryWorkerTick(
      { nowMs: retryNow + computeRetryDelayMs(0) + 1 },
      { getDrizzleDb, transport: sink.transport, lookupAll: capturedLookupAll },
    )
    expect(delivered).toEqual({ status: 'ok', leased: 1, delivered: 1, retryable: 0, ambiguous: 0, dead: 0 })
    expect(deliveryState()).toBe('delivered')
    expect(sink.requests).toHaveLength(2)
  },
  { testTimeoutMs: 15000 },
)
```

- [ ] **Step 2: Run the story to verify the census failure**

Run: `bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts`

Expected: all four scenarios PASS; contracts FAIL naming `SCN-analytics-aggregate-delivery-governance`.

- [ ] **Step 3: Register the catalog record and extend the source line**

Add `'SCN-analytics-aggregate-delivery-governance',` to `CATALOG_SCENARIO_IDS` after the Task 3 id, and the record after the Task 3 record:

```ts
  'SCN-analytics-aggregate-delivery-governance': {
    verifiedAt: '2026-08-04',
    provingTier: '0',
    storyIds: [
      'tests/stories/analytics/aggregate-delivery.story.test.ts#SCN-analytics-aggregate-delivery-governance: the kill switch defers a staged release and a 5xx schedules a bounded retry before delivery succeeds',
    ],
  },
```

Extend `CATALOG_SOURCE` by appending to the existing literal:

```ts
'; extended 2026-08-04 with 4 aggregate delivery (@0) ids (analytics-aggregate-delivery-coverage)'
```

- [ ] **Step 4: Run the story and the contracts**

Run: `bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts && bun test:stories:contracts`

Expected: both exit `0`.

- [ ] **Step 5: Commit the governance story**

```bash
git add tests/stories/analytics/aggregate-delivery.story.test.ts tests/stories/catalog/coverage.ts
git commit -m "test(stories): cover aggregate delivery kill switch and retry"
```

## Final Verification

- [ ] Run `bun test:stories --fixture tests/stories/analytics/aggregate-delivery.story.test.ts`; expected exit code `0` with four passing scenarios.
- [ ] Run `bun test:stories:contracts`; expected exit code `0`.
- [ ] Run `bun test:stories:coverage`; expected exit code `0`, with lines `>= 71.00%` and functions `>= 70.00%`.
- [ ] Run `bun run typecheck && bun run lint`; expected exit code `0`.
- [ ] Run `git status --short`; expected output shows no uncommitted changes under `tests/` or `src/`.
- [ ] Verify no story file imports `snapshot`, `verifySinkVersion`, `runDeriveJob`, `runIntentDerivation`, `runBackfillJob`, or any `src/analytics/rekey/` module.
