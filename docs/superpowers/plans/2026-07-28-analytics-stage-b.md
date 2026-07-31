<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Analytics Stage B Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three gating code items in the analytics runbook's Stage B entry checklist and ship the read-only Stage B evidence report CLI, all on the analytics branch pre-merge.

**Architecture:** Three small fail-closed fixes in the delivery lane (`resolveSinkForSend` lane matching, required `grantKey`, release-execution route wiring) plus a read-only operator CLI (`scripts/analytics-stage-b-report.ts` → testable library in `src/analytics/jobs/`) that collects daily window evidence and replays recorded days through the executable stage gates.

**Tech Stack:** Bun, strict TypeScript, Zod v4, `bun:sqlite`, Drizzle ORM, pino, Bun tests.

**Spec:** [`docs/superpowers/specs/2026-07-28-analytics-stage-b-design.md`](../specs/2026-07-28-analytics-stage-b-design.md)
**Binding docs:** `docs/operations/analytics-runbook.md` (Stage B entry checklist), `docs/research/analytics-metrics/09-stage-a-evidence.md` (Stage B window log)

## Global Constraints

- Work happens on branch `claude/analytics-metrics-research-plan-0q1fqk`; one commit per task, four commits total.
- TDD per repo rules: write the failing test first, run it, see it fail; then minimal implementation.
- All new imports use `.js` extensions. Strict TypeScript: no `any`, no lint-disable or type-ignore comments.
- Logging is pino metadata-first; never log secrets, endpoints, payloads, raw identifiers, or error bodies.
- Validation is Zod v4 `.strict()` at route boundaries.
- `max-lines` / `max-lines-per-function` failures are design signals: split files or extract functions.
- After each task: run the task's named test gate, `bun run typecheck`, `bun run lint`. Before each commit the write-hook pipeline runs automatically.
- Error extraction convention: `error instanceof Error ? error.message : String(error)`.

---

### Task 1: Match sink egress mode to delivery lane at send resolution

**Files:**
- Modify: `src/analytics/delivery/worker-send.ts` (`resolveSinkForSend`, currently lines 101–106)
- Modify: `src/analytics/delivery/worker.ts:136` (event lane call site) and `src/analytics/delivery/worker.ts:181` (aggregate lane call site)
- Test: `tests/analytics/delivery/worker-send.test.ts`
- Test: `tests/analytics/delivery/worker.test.ts` (one integration test)

**Interfaces:**
- Consumes: `WorkerSinkConfig.egressMode` (existing field, values `'aggregate' | 'pseudonymous'`), `SinkConfigDeps`, `SinkConfigLoader` (unchanged).
- Produces: `resolveSinkForSend(deps: SinkConfigDeps, sinkVersionId: string, lane: 'aggregate' | 'pseudonymous'): WorkerSinkConfig | null` — third parameter **required**. Task 3 relies on this signature.

- [ ] **Step 1: Write the failing tests**

Add to `tests/analytics/delivery/worker-send.test.ts` (inside the existing `resolveSinkForSend` describe block; the file already imports `resolveSinkForSend` and builds deps with a `loadSinkConfig` stub):

```ts
test('an enabled sink whose egress mode differs from the delivery lane is refused', () => {
  const deps = {
    getDrizzleDb: () => {
      throw new Error('loader stub must be used')
    },
    loadSinkConfig: () => ({
      endpoint: 'https://sinks.example.net/ingest/x',
      secret: 's',
      egressMode: 'aggregate',
      state: 'enabled',
    }),
  }
  expect(resolveSinkForSend(deps, 'sv-1', 'pseudonymous')).toBeNull()
})

test('an enabled sink matching the delivery lane resolves', () => {
  const deps = {
    getDrizzleDb: () => {
      throw new Error('loader stub must be used')
    },
    loadSinkConfig: () => ({
      endpoint: 'https://sinks.example.net/ingest/x',
      secret: 's',
      egressMode: 'aggregate',
      state: 'enabled',
    }),
  }
  expect(resolveSinkForSend(deps, 'sv-1', 'aggregate')).not.toBeNull()
})
```

Update the existing call at `tests/analytics/delivery/worker-send.test.ts:133` (the disabled-sink test) to pass a lane: `resolveSinkForSend(deps, 'sv-1', 'aggregate')`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/analytics/delivery/worker-send.test.ts`
Expected: FAIL — `resolveSinkForSend` expects 2 arguments but 3 were given (type error), and existing caller mismatch.

- [ ] **Step 3: Implement the lane check**

In `src/analytics/delivery/worker-send.ts`, add the lane type and replace `resolveSinkForSend`:

```ts
export type SinkDeliveryLane = 'aggregate' | 'pseudonymous'

export const resolveSinkForSend = (
  deps: SinkConfigDeps,
  sinkVersionId: string,
  lane: SinkDeliveryLane,
): WorkerSinkConfig | null => {
  const loader = deps.loadSinkConfig ?? createDbSinkConfigLoader(deps)
  const config = loader(sinkVersionId)
  if (config === null || config.state !== 'enabled') return null
  if (config.egressMode !== lane) {
    log.warn(
      { sinkVersionId, sinkLane: config.egressMode, deliveryLane: lane },
      'sink refused for send: egress mode does not match the delivery lane',
    )
    return null
  }
  return config
}
```

In `src/analytics/delivery/worker.ts`:
- Line 136 (`sendEventRow`): `const config = resolveSinkForSend(deps, row.sinkVersionId, 'pseudonymous')`
- Line 181 (`sendAggregateRow`): `const config = resolveSinkForSend(deps, row.sinkVersionId, 'aggregate')`

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/analytics/delivery/worker-send.test.ts tests/analytics/delivery/worker.test.ts`
Expected: PASS (existing worker tests use lane-matched sinks: event rows with `pseudonymous` sinks, aggregate rows with `aggregate` sinks).

- [ ] **Step 5: Add the crossed-lane integration test**

Add to `tests/analytics/delivery/worker.test.ts` inside the send-path describe block (the one whose `beforeEach` sets up `scripted = createScriptedTransport(...)`, `deps` with a `loadSinkConfig` stub, and the `seedEventDelivery` helper at line ~173):

```ts
test('an event delivery row whose sink resolves to the aggregate lane is never sent', async () => {
  seedEventDelivery()
  deps = {
    ...deps,
    loadSinkConfig: (): WorkerSinkConfig => ({
      endpoint: ENDPOINT,
      secret: 'sink-token',
      egressMode: 'aggregate',
      state: 'enabled',
    }),
  }
  const result = await runDeliveryWorkerTick({ nowMs: NOW }, deps)
  expect(scripted.calls).toHaveLength(0)
  expect(result).toMatchObject({ status: 'ok', leased: 1, retryable: 1 })
  expect(deliveryRow(db, 'event-1', 'sv-1')).toMatchObject({ state: 'pending', lastErrorClass: 'policy' })
})
```

All names (`seedEventDelivery`, `scripted`, `deliveryRow`, `runDeliveryWorkerTick`, `ENDPOINT`, `WorkerSinkConfig`, `deps` as `let`) exist in that describe block — verified against the file.

- [ ] **Step 6: Run the integration test, then typecheck/lint**

Run: `bun test tests/analytics/delivery/worker.test.ts && bun run typecheck && bun run lint`
Expected: PASS; clean; clean.

- [ ] **Step 7: Commit**

```bash
git add src/analytics/delivery/worker-send.ts src/analytics/delivery/worker.ts tests/analytics/delivery/worker-send.test.ts tests/analytics/delivery/worker.test.ts
git commit -m "fix(analytics): match sink egress mode to delivery lane at send resolution"
```

---

### Task 2: Require grant key in delivery classification

**Files:**
- Modify: `src/analytics/delivery/store-outcomes.ts` (`ClassifyDeliveryInput`, line 22; `classifyDelivery` guard, line 75)
- Test: `tests/analytics/delivery/store-outcomes.test.ts`

**Interfaces:**
- Consumes: `resolveGrantSendMutex(deps)` from `src/analytics/delivery/store.ts` returning a mutex with `tryAcquire(key)`, `release(key)`, `isHeld(key)`.
- Produces: `ClassifyDeliveryInput.grantKey: string` (**required**). `classifyDelivery(input, deps): ClassifyDeliveryResult` — signature otherwise unchanged. The delivery worker (`src/analytics/delivery/worker.ts:147`) already passes `grantKey: row.grant.grantKey`; no src caller changes expected.

- [ ] **Step 1: Write the failing regression test**

Add to `tests/analytics/delivery/store-outcomes.test.ts`:

```ts
test('classifying a missing row releases the caller-held grant mutex (no send_in_progress wedge)', () => {
  const mutex = resolveGrantSendMutex(deps)
  const key = 'grant-wedge-1'
  expect(mutex.tryAcquire(key)).not.toBeNull()
  const result = classifyDelivery(
    { eventId: 'evt-missing', sinkVersionId: 'sv-1', grantKey: key, nowMs: NOW, outcome: 'delivered' },
    deps,
  )
  expect(result).toBe('not_sending')
  expect(mutex.isHeld(key)).toBe(false)
})
```

Import `resolveGrantSendMutex` from `../../../../src/analytics/delivery/store.js` at the top of the test file if not already imported.

- [ ] **Step 2: Run the test to verify current behavior**

Run: `bun test tests/analytics/delivery/store-outcomes.test.ts`
Expected: the new test may already pass against current code (the guard handles an optional key). Its purpose is to pin the invariant before the type change; if it passes, keep it and proceed — the red step for this task is the typecheck failure in Step 4.

- [ ] **Step 3: Make `grantKey` required**

In `src/analytics/delivery/store-outcomes.ts`:

```ts
export type ClassifyDeliveryInput = Readonly<{
  eventId: string
  sinkVersionId: string
  nowMs: number
  outcome: 'delivered' | 'retryable' | 'ambiguous' | 'dead'
  grantKey: string
  remoteReceiptHash?: string
  errorClass?: DeliveryErrorClass
  retryAtMs?: number
}>
```

And simplify the guard in `classifyDelivery` (line 75):

```ts
      if (row === undefined || row.state !== 'sending') {
        if (row === undefined && mutex.isHeld(input.grantKey)) {
          heldGrantKey = input.grantKey
        }
        return 'not_sending'
      }
```

- [ ] **Step 4: Fix every call site surfaced by typecheck**

Run: `bun run typecheck`
Expected: FAIL listing test call sites that omit `grantKey`. Add `grantKey: '<some-key>'` to each (use the row's grant key where the fixture creates a delivery row — check the fixture's `grantKey` column value; for `not_sending` fixtures any string is fine). Do not change production callers unless one actually omits the key (`grep -rn "classifyDelivery(" src/ --include="*.ts"` to confirm only `worker.ts` calls it).

- [ ] **Step 5: Run the full delivery suites**

Run: `bun test tests/analytics/delivery/ tests/analytics/withdrawal-race.test.ts && bun run typecheck && bun run lint`
Expected: PASS; clean; clean.

- [ ] **Step 6: Commit**

```bash
git add src/analytics/delivery/store-outcomes.ts tests/analytics/delivery/
git commit -m "fix(analytics): require grant key for delivery classification"
```

---

### Task 3: Wire aggregate release execution into the admin reconcile route

**Files:**
- Modify: `src/analytics/delivery/sink-service.ts` (add `isEnabledAggregateSinkVersion`)
- Modify: `src/debug/settings/admin/analytics-routes.ts` (`ReconcileBodySchema` release block, `handleReconcile`)
- Test: `tests/debug/settings/admin/analytics-routes.test.ts`

**Interfaces:**
- Consumes: `assessReleaseRequest(input): { ok: true } | { ok: false; reason: string }` from `src/analytics/delivery/release-suppression.js`; `buildDailyAggregateRelease({ utcDay, sinkVersionId, nowMs }, deps): BuildReleaseResult` from `src/analytics/delivery/aggregate-release.js`; `sinkDepsOf(deps)` from `./analytics-view.js`; Task 1's lane rule (sink rows carry `egressMode: 'aggregate' | 'pseudonymous'`).
- Produces:
  - `isEnabledAggregateSinkVersion(sinkVersionId: string, deps: SinkServiceDeps): boolean` in `sink-service.ts`.
  - Reconcile route release block gains optional `sinkVersionId: string` and `execute: boolean` (default behavior unchanged when absent).
  - Response 200 body gains `releaseExecution: { status, releaseId, releaseHash, cellCount } | undefined`.
  - New error codes: `release_sink_required`, `release_sink_unavailable`, `release_day_incomplete`, `release_empty_day` (all 422).

- [ ] **Step 1: Write the failing route tests**

Add a describe block to `tests/debug/settings/admin/analytics-routes.test.ts`. Reuse the file's existing helpers: `call(path, init)`, `admin(true)` headers, `createSink(overrides)`, `CreatedSinkSchema`, the verify-call pattern (lines ~310–330), and `probeOk`. Fixture inserts use the pattern proven in `tests/analytics/delivery/aggregate-release.test.ts`:

```ts
const DAY = '2026-08-05'

const insertReleasableCounterCell = (over: Record<string, unknown> = {}): void => {
  db.insert(analyticsDailyCounters)
    .values({
      utcDay: DAY,
      definitionVersion: 1,
      platform: 'all',
      contextType: 'all',
      actorRole: 'all',
      taskProvider: 'all',
      appVersion: 'all',
      metric: 'turn_started',
      value: 25,
      finalized: true,
      partialDay: false,
      restartGapDetected: false,
      lateEventCount: 0,
      reconciliationStatus: 'complete_epoch',
      disclosureScope: 'local_only',
      contributorBasis: 'eligible_actor',
      contributorCount: 12,
      threshold: null,
      ...over,
    })
    .run()
}

const createEnabledAggregateSink = async (): Promise<string> => {
  const created = CreatedSinkSchema.parse(
    await (await createSink({ kind: 'webhook', egressMode: 'aggregate' })).json(),
  ).sink
  probeOk = true
  const verify = await call(`/settings/api/admin/analytics/sinks/${created.sinkVersionId}/verify`, {
    method: 'POST',
    headers: admin(true),
    body: JSON.stringify(FULL_GATE),
  })
  expect(verify.status).toBe(200)
  return created.sinkVersionId
}

const postReconcile = (release: Record<string, unknown>): Promise<Response> =>
  call('/settings/api/admin/analytics/reconcile', {
    method: 'POST',
    headers: admin(true),
    body: JSON.stringify({ release }),
  })

test('execute without sinkVersionId is refused', async () => {
  const res = await postReconcile({ utcDay: DAY, execute: true })
  expect(res.status).toBe(422)
  expect(((await res.json()) as { code: string }).code).toBe('release_sink_required')
})

test('execute with a disabled aggregate sink is refused', async () => {
  const created = CreatedSinkSchema.parse(
    await (await createSink({ kind: 'webhook', egressMode: 'aggregate' })).json(),
  ).sink
  const res = await postReconcile({ utcDay: DAY, sinkVersionId: created.sinkVersionId, execute: true })
  expect(res.status).toBe(422)
  expect(((await res.json()) as { code: string }).code).toBe('release_sink_unavailable')
})

test('execute with a pseudonymous-lane sink is refused', async () => {
  const created = CreatedSinkSchema.parse(await (await createSink()).json()).sink // default egressMode 'pseudonymous'
  const res = await postReconcile({ utcDay: DAY, sinkVersionId: created.sinkVersionId, execute: true })
  expect(res.status).toBe(422)
  expect(((await res.json()) as { code: string }).code).toBe('release_sink_unavailable')
})

test('denied release shapes stay denied with execute: true', async () => {
  const sinkVersionId = await createEnabledAggregateSink()
  const res = await postReconcile({ utcDay: DAY, sinkVersionId, execute: true, rollingWindowDays: 7 })
  expect(res.status).toBe(422)
  expect(((await res.json()) as { code: string }).code).toBe('release_denied')
})

test('execute builds and enqueues the release; re-execute is idempotent', async () => {
  const sinkVersionId = await createEnabledAggregateSink()
  insertReleasableCounterCell()
  const first = await postReconcile({ utcDay: DAY, sinkVersionId, execute: true })
  expect(first.status).toBe(200)
  const firstBody = (await first.json()) as {
    releaseExecution: { status: string; releaseId: string; cellCount: number }
  }
  expect(firstBody.releaseExecution.status).toBe('released')
  expect(firstBody.releaseExecution.cellCount).toBeGreaterThan(0)
  const second = await postReconcile({ utcDay: DAY, sinkVersionId, execute: true })
  const secondBody = (await second.json()) as { releaseExecution: { status: string; releaseId: string } }
  expect(secondBody.releaseExecution.status).toBe('already_released')
  expect(secondBody.releaseExecution.releaseId).toBe(firstBody.releaseExecution.releaseId)
})

test('execute on an incomplete day is refused', async () => {
  const sinkVersionId = await createEnabledAggregateSink()
  insertReleasableCounterCell({ finalized: false })
  const res = await postReconcile({ utcDay: DAY, sinkVersionId, execute: true })
  expect(res.status).toBe(422)
  expect(((await res.json()) as { code: string }).code).toBe('release_day_incomplete')
})

test('assessment-only (no execute) behavior is unchanged', async () => {
  const res = await postReconcile({ utcDay: DAY })
  expect(res.status).toBe(200)
  const body = (await res.json()) as { releaseAssessment?: { ok: true }; releaseExecution?: unknown }
  expect(body.releaseAssessment).toEqual({ ok: true })
  expect(body.releaseExecution).toBeUndefined()
})
```

Add imports to the test file: `analyticsDailyCounters` from `../../../../src/db/schema.js`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/debug/settings/admin/analytics-routes.test.ts`
Expected: FAIL — 422 `invalid request` (unknown keys `sinkVersionId`/`execute` in the strict schema) and missing `releaseExecution` in responses.

- [ ] **Step 3: Add `isEnabledAggregateSinkVersion` to `sink-service.ts`**

Next to `hasEnabledSink` (line ~272):

```ts
export const isEnabledAggregateSinkVersion = (sinkVersionId: string, deps: SinkServiceDeps): boolean =>
  deps
    .getDrizzleDb()
    .select({ sinkVersionId: analyticsSinks.sinkVersionId })
    .from(analyticsSinks)
    .where(
      and(
        eq(analyticsSinks.sinkVersionId, sinkVersionId),
        eq(analyticsSinks.egressMode, 'aggregate'),
        eq(analyticsSinks.state, 'enabled'),
      ),
    )
    .get() !== undefined
```

- [ ] **Step 4: Extend the reconcile route**

In `src/debug/settings/admin/analytics-routes.ts`:

a. Extend the release block of `ReconcileBodySchema` (line ~47) with two optional fields:

```ts
    release: z
      .object({
        utcDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
        endUtcDay: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/u)
          .optional(),
        rollingWindowDays: z.number().int().positive().optional(),
        dimensions: z.array(z.enum(['platform', 'contextType', 'actorRole', 'taskProvider'])).optional(),
        appVersion: z.string().optional(),
        drillThrough: z.boolean().optional(),
        sinkVersionId: z.string().min(1).optional(),
        execute: z.boolean().optional(),
      })
      .strict()
      .optional(),
```

b. Add imports:

```ts
import { buildDailyAggregateRelease } from '../../../analytics/delivery/aggregate-release.js'
import { hasEnabledSink, isEnabledAggregateSinkVersion } from '../../../analytics/delivery/sink-service.js'
```

(replace the existing `hasEnabledSink` import line).

c. In `handleReconcile`, replace the release handling (lines 151–158) and the response body:

```ts
  const nowMs = settingsRequestNowMs(req)
  let releaseAssessment: Readonly<{ ok: true }> | undefined
  let releaseExecution:
    | Readonly<{ status: string; releaseId: string; releaseHash: string; cellCount: number }>
    | undefined
  if (body.data.release !== undefined) {
    const { sinkVersionId, execute, ...assessmentInput } = body.data.release
    const assessment = assessReleaseRequest({ ...assessmentInput, nowMs })
    if (!assessment.ok) {
      return settingsJson(422, { error: 'release request denied', code: 'release_denied', reason: assessment.reason })
    }
    releaseAssessment = { ok: true }
    if (execute === true) {
      if (sinkVersionId === undefined) {
        return settingsJson(422, { error: 'sinkVersionId is required when execute is true', code: 'release_sink_required' })
      }
      if (!isEnabledAggregateSinkVersion(sinkVersionId, sinkDepsOf(deps))) {
        return settingsJson(422, { error: 'no enabled aggregate sink version', code: 'release_sink_unavailable' })
      }
      const result = buildDailyAggregateRelease(
        { utcDay: body.data.release.utcDay, sinkVersionId, nowMs },
        { getDrizzleDb: deps.getDrizzleDb },
      )
      if (result.status === 'day_not_complete') {
        return settingsJson(422, { error: 'utc day is not complete', code: 'release_day_incomplete' })
      }
      if (result.status === 'empty') {
        return settingsJson(422, { error: 'no aggregate cells for utc day', code: 'release_empty_day' })
      }
      releaseExecution = {
        status: result.status,
        releaseId: result.releaseId,
        releaseHash: result.releaseHash,
        cellCount: result.status === 'released' ? result.cellCount : 0,
      }
      log.info({ releaseId: result.releaseId, status: result.status }, 'aggregate release executed through settings')
    }
  }
```

Add `releaseExecution` to the `settingsJson(200, { ... })` payload.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bun test tests/debug/settings/admin/analytics-routes.test.ts tests/analytics/delivery/aggregate-release.test.ts tests/analytics/delivery/release-suppression.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck, lint, full settings sweep**

Run: `bun run typecheck && bun run lint && bun test tests/debug/settings tests/analytics/delivery`
Expected: clean; clean; PASS.

- [ ] **Step 7: Commit**

```bash
git add src/analytics/delivery/sink-service.ts src/debug/settings/admin/analytics-routes.ts tests/debug/settings/admin/analytics-routes.test.ts
git commit -m "feat(analytics): wire aggregate release execution to the admin reconcile route"
```

---

### Task 4: Stage B evidence report CLI + docs

**Files:**
- Create: `src/analytics/jobs/stage-b-report.ts` (types, collector, formatters, arg parser)
- Create: `src/analytics/jobs/stage-b-assess.ts` (jsonl replay + gate verdicts)
- Create: `scripts/analytics-stage-b-report.ts` (thin wrapper)
- Test: `tests/analytics/jobs/stage-b-report.test.ts`
- Test: `tests/analytics/jobs/stage-b-assess.test.ts`
- Modify: `docs/operations/analytics-runbook.md` (Stage B entry checklist + daily review bullet)
- Modify: `docs/research/analytics-metrics/09-stage-a-evidence.md` (daily log table + readiness subsection)

**Interfaces:**
- Consumes: `runReconciliation({ nowMs, apply: false }, deps): ReconciliationReport` from `./reconcile.js`; schema tables `analyticsProcessEpochs`, `analyticsNormalizationRejections`, `analyticsEpochSourceCounters`, `analyticsEvents`, `analyticsSnapshotPublications`, `analyticsDeliveries`, `analyticsAggregateDeliveries` from `../../db/schema.js`; `assessStageBWindow`, `assessStageCEntry`, `STAGE_B_REQUIRED_CONSECUTIVE_WEEKS`, `StageBDayEvidence` from `../rollout/stage-gates.js`; `getPolicy`, `assessGovernanceReadiness`, `GovernanceReadiness` from `../governance/policy-store.js`; `parseAnalyticsKeyring`, `parseGovernanceKeyring` from `../identity/keyring.js`.
- Produces:
  - `StageBDayReport` (day evidence record), `collectStageBDay({ day, nowMs }, deps): StageBDayReport`
  - `formatDaySummary(report): string`, `formatWindowLogRow(report): string`
  - `parseStageBArgs(argv): StageBCliArgs`
  - `parseStageBLog(jsonl): StageBDayReport[]` (last record per day wins, sorted by day)
  - `assessRecordedWindow(records, readiness): { consecutiveCompleteWeeks, stageBExit, stageCEntry }`

- [ ] **Step 1: Write the failing collector tests**

Create `tests/analytics/jobs/stage-b-report.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { sql } from 'drizzle-orm'

import {
  collectStageBDay,
  formatDaySummary,
  formatWindowLogRow,
  parseStageBArgs,
} from '../../../src/analytics/jobs/stage-b-report.js'
import {
  analyticsDeliveries,
  analyticsEpochSourceCounters,
  analyticsEvents,
  analyticsNormalizationRejections,
  analyticsProcessEpochs,
  analyticsSnapshotPublications,
} from '../../../src/db/schema.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const DAY = '2026-08-05'
const DAY_START_MS = Date.parse(`${DAY}T00:00:00.000Z`)
const DAY_MS = 86_400_000
const NOW_MS = DAY_START_MS + DAY_MS + 3_600_000 // one hour after day close

let db: Db

beforeEach(async () => {
  mockLogger()
  db = await setupTestDb()
})

const deps = () => ({ getDrizzleDb: () => db })

const insertStaleEpochTouchingDay = (): void => {
  db.insert(analyticsProcessEpochs)
    .values({
      epochId: 'epoch-stale-1',
      state: 'stale_open',
      startedAtMs: DAY_START_MS + 1_000,
      closedAtMs: null,
      staleMarkedAtMs: DAY_START_MS + 2_000,
    })
    .run()
}

const insertRejection = (reason: string, count: number): void => {
  db.insert(analyticsNormalizationRejections)
    .values({ utcDay: DAY, sourceEventType: 'llm', reason, count })
    .run()
}

const insertOverflowCounter = (value: number): void => {
  db.insert(analyticsEpochSourceCounters)
    .values({ epochId: 'epoch-1', utcDay: DAY, sourceFamily: 'chat', disposition: 'controlled_overflow', value })
    .run()
}

const insertExpiredEvent = (): void => {
  db.insert(analyticsEvents)
    .values({
      eventId: 'evt-expired-1',
      eventName: 'turn_started',
      occurredAtMs: DAY_START_MS + 500,
      utcDay: DAY,
      storageGeneration: 'gen-1',
      processEpochId: null,
      propsJson: '{}',
      expiresAtMs: NOW_MS - 1,
    })
    .run()
}

const insertPublication = (publishedAtMs: number): void => {
  db.insert(analyticsSnapshotPublications)
    .values({
      snapshotId: 'snap-1',
      storageGeneration: 'gen-1',
      transitionRunId: null,
      pathHash: 'ph',
      sourceHighWater: 'hw',
      state: 'published',
      publishedAt: publishedAtMs,
      invalidatedAt: null,
    })
    .run()
}

describe('collectStageBDay', () => {
  test('a clean complete day is eligible with zeroed counters', () => {
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(report.eligible).toBe(true)
    expect(report.reason).toBe('ok')
    expect(report.reconciliation).toBe('reconciled')
    expect(report.restartGap).toBe(false)
    expect(report.rejects.total).toBe(0)
    expect(report.overflow).toBe(0)
    expect(report.expiry.ok).toBe(true)
    expect(report.delivery).toEqual({ sending: 0, ambiguous: 0 })
  })

  test('a stale-open epoch intersecting the day marks it a restart gap', () => {
    insertStaleEpochTouchingDay()
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(report.eligible).toBe(false)
    expect(report.reason).toBe('restart_gap')
    expect(report.restartGap).toBe(true)
  })

  test('an incomplete (still running) day is ineligible', () => {
    const report = collectStageBDay({ day: DAY, nowMs: DAY_START_MS + 1_000 }, deps())
    expect(report.eligible).toBe(false)
    expect(report.reason).toBe('incomplete_day')
  })

  test('rejections and overflow counters are totaled by reason', () => {
    insertRejection('unknown_enum', 2)
    insertRejection('props_out_of_domain', 1)
    insertOverflowCounter(3)
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(report.rejects.total).toBe(3)
    expect(report.rejects.byReason).toEqual({ unknown_enum: 2, props_out_of_domain: 1 })
    expect(report.overflow).toBe(3)
  })

  test('an expired-but-retained event row fails the expiry check', () => {
    insertExpiredEvent()
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(report.expiry.ok).toBe(false)
    expect(report.expiry.expiredRows).toBe(1)
    expect(report.expiry.earliestDeadlineMs).toBe(NOW_MS - 1)
  })

  test('snapshot freshness honors the two-hour SLO', () => {
    insertPublication(NOW_MS - 30 * 60_000)
    expect(collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps()).snapshot.fresh).toBe(true)
  })

  test('a stale publication is not fresh', () => {
    insertPublication(NOW_MS - 5 * 3_600_000)
    expect(collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps()).snapshot.fresh).toBe(false)
  })

  test('sending and ambiguous delivery rows are counted across both ledgers', () => {
    db.insert(analyticsDeliveries)
      .values({
        eventId: 'evt-1',
        sinkVersionId: 'sv-1',
        state: 'sending',
        attempts: 1,
        nextAttemptAtMs: NOW_MS,
        payloadJson: '{}',
        payloadSchemaVersion: 1,
        grantKey: 'g1',
        grantKeyVersion: 'v1',
        grantGeneration: 'gen-1',
        createdAtMs: NOW_MS,
        leaseUntilMs: NOW_MS + 60_000,
      })
      .run()
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(report.delivery.sending).toBe(1)
    expect(report.delivery.ambiguous).toBe(0)
  })

  test('collection performs zero writes', () => {
    for (const table of ['analytics_events', 'analytics_process_epochs', 'analytics_normalization_rejections']) {
      db.$client.run(
        `CREATE TEMP TRIGGER no_write_${table} BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'write'); END`,
      )
    }
    insertRejection('unknown_enum', 1) // seed before the update/delete triggers exist
    expect(() => collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())).not.toThrow()
  })
})

describe('formatters', () => {
  test('window log row matches the evidence doc column contract', () => {
    insertRejection('unknown_enum', 2)
    const report = collectStageBDay({ day: DAY, nowMs: NOW_MS }, deps())
    expect(formatWindowLogRow(report)).toBe(
      `| ${DAY} | true | — | none | 0 | 2 (unknown_enum=2) | 0 | ok | — |`,
    )
    expect(formatDaySummary(report)).toContain(`day=${DAY} eligible=true reconciliation=reconciled`)
  })
})

describe('parseStageBArgs', () => {
  test('parses all flags', () => {
    expect(parseStageBArgs(['--day', DAY, '--db', '/tmp/x.db', '--log', '/tmp/x.jsonl'])).toEqual({
      day: DAY,
      dbPath: '/tmp/x.db',
      logPath: '/tmp/x.jsonl',
      assess: false,
    })
    expect(parseStageBArgs(['--assess', '--log', '/tmp/x.jsonl'])).toEqual({
      day: null,
      dbPath: null,
      logPath: '/tmp/x.jsonl',
      assess: true,
    })
    expect(parseStageBArgs([])).toEqual({ day: null, dbPath: null, logPath: null, assess: false })
    expect(() => parseStageBArgs(['--nope'])).toThrow('unknown argument')
  })
})
```

Notes for the implementer:
- `analyticsEvents` has more NOT NULL columns than shown (check `src/db/analytics-schema.ts`); extend `insertExpiredEvent` with every required column — copy the column list from `tests/analytics/storage-fixtures.ts` (`eventInsertInput`) if the direct insert fails on constraints.
- If the migration-seeded `analytics_active_generation` singleton is missing in the test DB, seed it in `beforeEach` via `setActiveGeneration({ generation: 'gen-1', nowMs: DAY_START_MS }, deps())` from `src/analytics/governance/generation-store.js`.
- If `setupTestDb` does not run analytics migrations, follow the pattern used by `tests/analytics/jobs/backfill-cli.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun test tests/analytics/jobs/stage-b-report.test.ts`
Expected: FAIL — module `stage-b-report.js` does not exist.

- [ ] **Step 3: Implement `src/analytics/jobs/stage-b-report.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, sql } from 'drizzle-orm'

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import {
  analyticsAggregateDeliveries,
  analyticsDeliveries,
  analyticsEpochSourceCounters,
  analyticsEvents,
  analyticsNormalizationRejections,
  analyticsProcessEpochs,
  analyticsSnapshotPublications,
} from '../../db/schema.js'
import { runReconciliation } from './reconcile.js'

const DAY_MS = 86_400_000
const SNAPSHOT_FRESHNESS_SLO_MS = 2 * 3_600_000

export type StageBDayReason = 'ok' | 'restart_gap' | 'delta' | 'incomplete_day'

export type StageBDayReport = Readonly<{
  day: string
  completeUtcDay: boolean
  eligible: boolean
  reason: StageBDayReason
  reconciliation: 'reconciled' | 'gap' | 'delta'
  unexplainedDelta: number
  restartGap: boolean
  rejects: Readonly<{ total: number; byReason: Readonly<Record<string, number>> }>
  overflow: number
  expiry: Readonly<{ ok: boolean; earliestDeadlineMs: number | null; expiredRows: number }>
  snapshot: Readonly<{ snapshotId: string | null; publishedAtMs: number | null; fresh: boolean }>
  delivery: Readonly<{ sending: number; ambiguous: number }>
}>

export type StageBReportDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb }>

type Db = ReturnType<typeof defaultGetDrizzleDb>

const dayBounds = (day: string): Readonly<{ startMs: number; endMs: number }> => {
  const startMs = Date.parse(`${day}T00:00:00.000Z`)
  return { startMs, endMs: startMs + DAY_MS }
}

const hasRestartGap = (db: Db, startMs: number, endMs: number): boolean =>
  db
    .select({ epochId: analyticsProcessEpochs.epochId })
    .from(analyticsProcessEpochs)
    .where(
      and(
        eq(analyticsProcessEpochs.state, 'stale_open'),
        sql`${analyticsProcessEpochs.startedAtMs} < ${endMs}`,
        sql`(${analyticsProcessEpochs.staleMarkedAtMs} IS NULL OR ${analyticsProcessEpochs.staleMarkedAtMs} >= ${startMs})`,
      ),
    )
    .all().length > 0

const collectRejects = (db: Db, day: string): StageBDayReport['rejects'] => {
  const rows = db
    .select({ reason: analyticsNormalizationRejections.reason, count: analyticsNormalizationRejections.count })
    .from(analyticsNormalizationRejections)
    .where(eq(analyticsNormalizationRejections.utcDay, day))
    .all()
  const byReason: Record<string, number> = {}
  let total = 0
  for (const row of rows) {
    byReason[row.reason] = (byReason[row.reason] ?? 0) + row.count
    total += row.count
  }
  return { total, byReason }
}

const collectOverflow = (db: Db, day: string): number =>
  db
    .select({ total: sql<number>`coalesce(sum(${analyticsEpochSourceCounters.value}), 0)` })
    .from(analyticsEpochSourceCounters)
    .where(
      and(
        eq(analyticsEpochSourceCounters.utcDay, day),
        eq(analyticsEpochSourceCounters.disposition, 'controlled_overflow'),
      ),
    )
    .get()?.total ?? 0

const collectExpiry = (db: Db, nowMs: number): StageBDayReport['expiry'] => {
  const row = db
    .select({
      earliest: sql<number | null>`min(${analyticsEvents.expiresAtMs})`,
      expired: sql<number>`coalesce(sum(case when ${analyticsEvents.expiresAtMs} <= ${nowMs} then 1 else 0 end), 0)`,
    })
    .from(analyticsEvents)
    .get()
  const expiredRows = row?.expired ?? 0
  return { ok: expiredRows === 0, earliestDeadlineMs: row?.earliest ?? null, expiredRows }
}

const collectSnapshot = (db: Db, nowMs: number): StageBDayReport['snapshot'] => {
  const row = db
    .select()
    .from(analyticsSnapshotPublications)
    .where(eq(analyticsSnapshotPublications.state, 'published'))
    .orderBy(sql`${analyticsSnapshotPublications.publishedAt} desc`)
    .limit(1)
    .get()
  const publishedAtMs = row?.publishedAt ?? null
  return {
    snapshotId: row?.snapshotId ?? null,
    publishedAtMs,
    fresh: publishedAtMs !== null && nowMs - publishedAtMs <= SNAPSHOT_FRESHNESS_SLO_MS,
  }
}

const countStates = (db: Db, table: typeof analyticsDeliveries | typeof analyticsAggregateDeliveries): Readonly<{ sending: number; ambiguous: number }> => {
  const rows = db
    .select({ state: table.state, n: sql<number>`count(*)` })
    .from(table)
    .where(sql`${table.state} in ('sending', 'ambiguous')`)
    .groupBy(table.state)
    .all()
  let sending = 0
  let ambiguous = 0
  for (const row of rows) {
    if (row.state === 'sending') sending += row.n
    if (row.state === 'ambiguous') ambiguous += row.n
  }
  return { sending, ambiguous }
}

const sumCounts = (a: StageBDayReport['delivery'], b: StageBDayReport['delivery']): StageBDayReport['delivery'] => ({
  sending: a.sending + b.sending,
  ambiguous: a.ambiguous + b.ambiguous,
})

export const collectStageBDay = (
  input: Readonly<{ day: string; nowMs: number }>,
  deps: StageBReportDeps = { getDrizzleDb: defaultGetDrizzleDb },
): StageBDayReport => {
  const db = deps.getDrizzleDb()
  const { startMs, endMs } = dayBounds(input.day)
  const completeUtcDay = endMs <= input.nowMs
  const restartGap = hasRestartGap(db, startMs, endMs)
  const reconciliation = runReconciliation({ nowMs: input.nowMs, apply: false }, deps)
  const reason: StageBDayReason = !completeUtcDay
    ? 'incomplete_day'
    : restartGap
      ? 'restart_gap'
      : reconciliation.status !== 'reconciled'
        ? 'delta'
        : 'ok'
  return {
    day: input.day,
    completeUtcDay,
    eligible: reason === 'ok',
    reason,
    reconciliation: reconciliation.status,
    unexplainedDelta: reconciliation.durableUsage.unexplainedDeltaTotal,
    restartGap,
    rejects: collectRejects(db, input.day),
    overflow: collectOverflow(db, input.day),
    expiry: collectExpiry(db, input.nowMs),
    snapshot: collectSnapshot(db, input.nowMs),
    delivery: sumCounts(countStates(db, analyticsDeliveries), countStates(db, analyticsAggregateDeliveries)),
  }
}

const isoMinute = (ms: number): string => new Date(ms).toISOString().slice(0, 16)

const rejectsSummary = (rejects: StageBDayReport['rejects']): string =>
  rejects.total === 0
    ? '0'
    : `${rejects.total} (${Object.entries(rejects.byReason)
        .map(([reason, count]) => `${reason}=${count}`)
        .join(', ')})`

export const formatDaySummary = (report: StageBDayReport): string =>
  [
    `day=${report.day} eligible=${report.eligible} reconciliation=${report.reconciliation} unexplained_delta=${report.unexplainedDelta}`,
    `  restart_gap=${report.restartGap} rejects=${rejectsSummary(report.rejects)} overflow_counters=${report.overflow}`,
    `  expiry_ok=${report.expiry.ok} expired_rows=${report.expiry.expiredRows} earliest_deadline=${report.expiry.earliestDeadlineMs === null ? 'none' : isoMinute(report.expiry.earliestDeadlineMs)}`,
    `  snapshot=${report.snapshot.snapshotId ?? 'none'} published=${report.snapshot.publishedAtMs === null ? 'none' : isoMinute(report.snapshot.publishedAtMs)} fresh=${report.snapshot.fresh}`,
    `  delivery sending=${report.delivery.sending} ambiguous=${report.delivery.ambiguous}`,
  ].join('\n')

export const formatWindowLogRow = (report: StageBDayReport): string =>
  `| ${report.day} | ${report.eligible} | ${report.reason === 'ok' ? '—' : report.reason} | ${report.snapshot.publishedAtMs === null ? 'none' : isoMinute(report.snapshot.publishedAtMs)} | ${report.unexplainedDelta} | ${rejectsSummary(report.rejects)} | ${report.overflow} | ${report.expiry.ok ? 'ok' : 'fail'} | — |`

export type StageBCliArgs = Readonly<{
  day: string | null
  dbPath: string | null
  logPath: string | null
  assess: boolean
}>

export const parseStageBArgs = (argv: readonly string[]): StageBCliArgs => {
  let day: string | null = null
  let dbPath: string | null = null
  let logPath: string | null = null
  let assess = false
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--assess') assess = true
    else if (flag === '--day' || flag === '--db' || flag === '--log') {
      const value = argv[index + 1]
      if (value === undefined) throw new Error(`missing value for ${flag}`)
      index += 1
      if (flag === '--day') day = value
      else if (flag === '--db') dbPath = value
      else logPath = value
    } else throw new Error(`unknown argument: ${flag}`)
  }
  return { day, dbPath, logPath, assess }
}
```

If the file exceeds the repo `max-lines` limit, move `parseStageBArgs` into `src/analytics/jobs/stage-b-args.ts` and update imports accordingly.

- [ ] **Step 4: Run the collector tests**

Run: `bun test tests/analytics/jobs/stage-b-report.test.ts`
Expected: PASS (adjust fixture column lists to the real schema constraints — see implementer notes in Step 1).

- [ ] **Step 5: Write the failing assess tests**

Create `tests/analytics/jobs/stage-b-assess.test.ts`:

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { assessRecordedWindow, parseStageBLog } from '../../../src/analytics/jobs/stage-b-assess.js'
import type { StageBDayReport } from '../../../src/analytics/jobs/stage-b-report.js'

const day = (utcDay: string, over: Partial<StageBDayReport> = {}): StageBDayReport => ({
  day: utcDay,
  completeUtcDay: true,
  eligible: true,
  reason: 'ok',
  reconciliation: 'reconciled',
  unexplainedDelta: 0,
  restartGap: false,
  rejects: { total: 0, byReason: {} },
  overflow: 0,
  expiry: { ok: true, earliestDeadlineMs: null, expiredRows: 0 },
  snapshot: { snapshotId: null, publishedAtMs: null, fresh: false },
  delivery: { sending: 0, ambiguous: 0 },
  ...over,
})

const READY = { ready: true, missing: [] } as const
const NOT_READY = { ready: false, missing: ['policy_version'] } as const

const consecutiveDays = (startUtcDay: string, count: number): StageBDayReport[] => {
  const startMs = Date.parse(`${startUtcDay}T00:00:00.000Z`)
  return Array.from({ length: count }, (_, index) => day(new Date(startMs + index * 86_400_000).toISOString().slice(0, 10)))
}

describe('parseStageBLog', () => {
  test('last record per day wins and days are sorted', () => {
    const jsonl = [
      JSON.stringify(day('2026-08-02')),
      JSON.stringify(day('2026-08-01')),
      JSON.stringify(day('2026-08-02', { eligible: false, reason: 'restart_gap', restartGap: true })),
    ].join('\n')
    const records = parseStageBLog(jsonl)
    expect(records.map((record) => record.day)).toEqual(['2026-08-01', '2026-08-02'])
    expect(records[1]?.eligible).toBe(false)
  })

  test('blank lines are ignored', () => {
    expect(parseStageBLog(`\n${JSON.stringify(day('2026-08-01'))}\n\n`)).toHaveLength(1)
  })
})

describe('assessRecordedWindow', () => {
  test('fourteen consecutive eligible days pass the window and open stage C', () => {
    const verdict = assessRecordedWindow(consecutiveDays('2026-08-01', 14), READY)
    expect(verdict.consecutiveCompleteWeeks).toBe(2)
    expect(verdict.stageBExit).toBe(true)
    expect(verdict.stageCEntry).toEqual({ allowed: true })
  })

  test('one restart-gap day breaks consecutiveness', () => {
    const records = consecutiveDays('2026-08-01', 14)
    records[6] = day('2026-08-07', { eligible: false, reason: 'restart_gap', restartGap: true })
    const verdict = assessRecordedWindow(records, READY)
    expect(verdict.consecutiveCompleteWeeks).toBe(1)
    expect(verdict.stageBExit).toBe(false)
    expect(verdict.stageCEntry).toEqual({ allowed: false, refusals: ['stage_b_window_incomplete'] })
  })

  test('governance not ready refuses stage C even with a complete window', () => {
    const verdict = assessRecordedWindow(consecutiveDays('2026-08-01', 14), NOT_READY)
    expect(verdict.stageCEntry).toEqual({ allowed: false, refusals: ['governance_incomplete'] })
  })
})
```

- [ ] **Step 6: Run the assess tests to verify they fail**

Run: `bun test tests/analytics/jobs/stage-b-assess.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement `src/analytics/jobs/stage-b-assess.ts`**

```ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { GovernanceReadiness } from '../governance/policy-store.js'
import { assessStageBWindow, assessStageCEntry, STAGE_B_REQUIRED_CONSECUTIVE_WEEKS } from '../rollout/stage-gates.js'
import type { RolloutDecision, StageBDayEvidence } from '../rollout/stage-gates.js'
import type { StageBDayReport } from './stage-b-report.js'

export const parseStageBLog = (jsonl: string): StageBDayReport[] => {
  const byDay = new Map<string, StageBDayReport>()
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const record = JSON.parse(trimmed) as StageBDayReport
    byDay.set(record.day, record)
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day))
}

const toDayEvidence = (report: StageBDayReport): StageBDayEvidence => ({
  utcDay: report.day,
  completeUtcDay: report.completeUtcDay,
  reconciliationStatus:
    report.reason === 'restart_gap' ? 'unreconciled_restart_gap' : report.eligible ? 'complete_epoch' : 'delta',
})

export const assessRecordedWindow = (
  records: readonly StageBDayReport[],
  readiness: GovernanceReadiness,
): Readonly<{ consecutiveCompleteWeeks: number; stageBExit: boolean; stageCEntry: RolloutDecision }> => {
  const days = records.map(toDayEvidence)
  const window = assessStageBWindow(days)
  return {
    consecutiveCompleteWeeks: window.consecutiveCompleteWeeks,
    stageBExit: window.consecutiveCompleteWeeks >= STAGE_B_REQUIRED_CONSECUTIVE_WEEKS,
    stageCEntry: assessStageCEntry({ governance: readiness, stageBDays: days }),
  }
}
```

- [ ] **Step 8: Run the assess tests**

Run: `bun test tests/analytics/jobs/stage-b-assess.test.ts tests/analytics/rollout-gates.test.ts`
Expected: PASS.

- [ ] **Step 9: Create the script wrapper**

Create `scripts/analytics-stage-b-report.ts`:

```ts
#!/usr/bin/env bun
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Read-only Stage B evidence report. Usage:
 *   bun run scripts/analytics-stage-b-report.ts [--day YYYY-MM-DD] [--db PATH] [--log PATH]
 *   bun run scripts/analytics-stage-b-report.ts --assess --log PATH [--db PATH]
 * Exit 0 = report produced (ineligible days are data); exit 1 = operational failure.
 */

import { appendFileSync, readFileSync } from 'node:fs'

import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'

import { assessGovernanceReadiness, getPolicy } from '../src/analytics/governance/policy-store.js'
import { parseAnalyticsKeyring, parseGovernanceKeyring } from '../src/analytics/identity/keyring.js'
import { assessRecordedWindow, parseStageBLog } from '../src/analytics/jobs/stage-b-assess.js'
import { collectStageBDay, formatDaySummary, formatWindowLogRow, parseStageBArgs } from '../src/analytics/jobs/stage-b-report.js'
import { ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV, ANALYTICS_HMAC_KEYRING_ENV } from '../src/analytics/config.js'
import * as schema from '../src/db/schema.js'

const DAY_MS = 86_400_000

const main = (): number => {
  const args = parseStageBArgs(process.argv.slice(2))
  const dbPath = args.dbPath ?? process.env['DB_PATH']
  if (dbPath === undefined) {
    console.error('error=db_path_required set --db or DB_PATH')
    return 1
  }
  let db: ReturnType<typeof drizzle<typeof schema>>
  try {
    const sqlite = new Database(dbPath, { readonly: true })
    sqlite.run('PRAGMA foreign_keys=ON')
    db = drizzle(sqlite, { schema })
  } catch (error) {
    console.error(`error=db_unreadable detail=${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
  const deps = { getDrizzleDb: (): ReturnType<typeof drizzle<typeof schema>> => db }
  const nowMs = Date.now()
  try {
    if (args.assess) {
      if (args.logPath === null) {
        console.error('error=log_required_for_assess pass --log PATH')
        return 1
      }
      const records = parseStageBLog(readFileSync(args.logPath, 'utf8'))
      const readiness = assessGovernanceReadiness({
        policy: getPolicy(deps),
        analyticsKeyring: parseAnalyticsKeyring(process.env[ANALYTICS_HMAC_KEYRING_ENV]),
        governanceKeyring: parseGovernanceKeyring(process.env[ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV]),
      })
      const verdict = assessRecordedWindow(records, readiness)
      const stageC = verdict.stageCEntry.allowed ? 'allowed' : `refused(${verdict.stageCEntry.refusals.join(',')})`
      console.log(
        `consecutive_complete_weeks=${verdict.consecutiveCompleteWeeks} stage_b_exit=${verdict.stageBExit ? 'allowed' : 'refused'} stage_c_entry=${stageC}`,
      )
      return 0
    }
    const day = args.day ?? new Date(nowMs - DAY_MS).toISOString().slice(0, 10)
    const report = collectStageBDay({ day, nowMs }, deps)
    console.log(formatDaySummary(report))
    console.log('window-log-row:')
    console.log(formatWindowLogRow(report))
    if (args.logPath !== null) appendFileSync(args.logPath, `${JSON.stringify(report)}\n`)
    return 0
  } catch (error) {
    console.error(`error=report_failed detail=${error instanceof Error ? error.message : String(error)}`)
    return 1
  }
}

process.exit(main())
```

Verify `ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV` is exported from `src/analytics/config.ts` (`grep -n "GOVERNANCE" src/analytics/config.ts`); if the constant has a different name, use the actual export.

- [ ] **Step 10: Smoke-run the script against a synthetic DB**

Run (from repo root, using a throwaway fixture DB — reuse the one from `tests/analytics/privacy-contract.test.ts` fixtures or create an empty migrated DB):

```bash
rm -f /tmp/stage-b-smoke.db
DB_PATH=/tmp/stage-b-smoke.db bun run -e "const {runMigrations}=await import('./src/db/migrate.ts'); const {Database}=await import('bun:sqlite'); const {MIGRATIONS}=await import('./src/db/index.ts'); runMigrations(new Database('/tmp/stage-b-smoke.db'), MIGRATIONS); console.log('migrated')"
DB_PATH=/tmp/stage-b-smoke.db bun run scripts/analytics-stage-b-report.ts --log /tmp/stage-b-smoke.jsonl
```

Expected: exit 0; a `day=…` summary (eligible depends on day completeness); one JSON line appended to `/tmp/stage-b-smoke.jsonl`. Then:

```bash
DB_PATH=/tmp/stage-b-smoke.db bun run scripts/analytics-stage-b-report.ts --assess --log /tmp/stage-b-smoke.jsonl
```

Expected: exit 0; prints `consecutive_complete_weeks=0 stage_b_exit=refused stage_c_entry=refused(...)`.

- [ ] **Step 11: Update the runbook**

In `docs/operations/analytics-runbook.md`:

a. In the **Stage B entry checklist** section, check all three boxes and append commit references — get them with `git log --oneline -3`:

```markdown
- [x] `resolveSinkForSend` matches the event/aggregate `egressMode` to the
  delivery lane before any external lane is enabled (fixed: lane parameter
  required at send resolution, commit <task-1-hash>).
- [x] The release path has a production caller: the reconcile route's
  `release` block accepts `sinkVersionId` + `execute` and runs
  `buildDailyAggregateRelease` after a passing assessment (commit
  <task-3-hash>).
- [x] `ClassifyDeliveryInput.grantKey` is a required field (commit
  <task-2-hash>).
```

b. In **Recurring schedule → Daily**, extend the review bullet:

```markdown
- Review: reconciliation status, rejects, restart gaps, delivery
  `sending`/`ambiguous` counts, snapshot freshness. During Stage B, collect
  the day record with
  `DB_PATH=... bun run scripts/analytics-stage-b-report.ts --log /var/lib/papai/stage-b.jsonl`
  (read-only; cron-safe; see the Stage B design spec) and paste the printed
  window-log row into the evidence doc.
```

- [ ] **Step 12: Update the evidence doc**

In `docs/research/analytics-metrics/09-stage-a-evidence.md`, section **Stage B window log (post-merge, operational)**, insert the daily log table directly under the `Restart/suppressed days` header line:

```markdown
### Daily log (report CLI rows)

| Day (UTC) | Eligible | Reason | Freshness | Recon delta | Rejects | Overflow | Expiry | Notes |
|---|---|---|---|---|---|---|---|---|
```

And append a readiness subsection at the end of the file:

```markdown
## Stage B readiness evidence (pre-merge fixes)

| Item | Gate result | Commit | Date |
|---|---|---|---|
| resolveSinkForSend egressMode matching | tests/analytics/delivery green (worker-send + worker crossed-lane) | <task-1-hash> | <date> |
| ClassifyDeliveryInput.grantKey required | tests/analytics/delivery + withdrawal-race green | <task-2-hash> | <date> |
| Release execution route | tests/debug/settings/admin/analytics-routes green (deny matrix, execute, idempotency, sink gating) | <task-3-hash> | <date> |
| Stage B report CLI | tests/analytics/jobs/stage-b-report + stage-b-assess green; zero-write proof; smoke run recorded | <task-4-hash> | <date> |
```

- [ ] **Step 13: Full gate**

Run: `bun test tests/analytics tests/debug/settings tests/scripts && bun run typecheck && bun run lint && bun security && bun run knip`
Expected: PASS; clean; clean; 0 findings; clean.

- [ ] **Step 14: Commit**

```bash
git add src/analytics/jobs/stage-b-report.ts src/analytics/jobs/stage-b-assess.ts scripts/analytics-stage-b-report.ts tests/analytics/jobs/stage-b-report.test.ts tests/analytics/jobs/stage-b-assess.test.ts docs/operations/analytics-runbook.md docs/research/analytics-metrics/09-stage-a-evidence.md
git commit -m "feat(analytics): add read-only Stage B evidence report CLI"
```

---

## Self-Review Notes

- **Spec coverage:** §1.1 → Task 1; §1.2 → Task 3; §1.3 → Task 2; §2 (CLI) + §5 (docs) → Task 4. Operations guide §3–§4 and escalation §6 are runbook/evidence-doc executions, no code.
- **Type consistency:** `SinkDeliveryLane` (Task 1) is the lane vocabulary `'aggregate' | 'pseudonymous'` used by Task 3's sink check. `StageBDayReport` (Task 4 library) is the jsonl record type consumed by `parseStageBLog`/`assessRecordedWindow`. `RolloutDecision` matches `stage-gates.ts`.
- **Fixture risks called out inline:** `analyticsEvents` NOT NULL columns (Task 4 Step 1 notes), active-generation singleton seeding, `ANALYTICS_GOVERNANCE_HMAC_KEYRING_ENV` export name. Worker test helpers in Task 1 Step 5 were verified against `tests/analytics/delivery/worker.test.ts`.
