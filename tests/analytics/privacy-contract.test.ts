// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'

import { PRIVACY_CONTRACT } from '../../scripts/analytics/privacy-contract-table.js'
import {
  createCapturedSink,
  findCanaries,
  SYNTHETIC_SINK_TOKEN,
} from '../../src/analytics/delivery/captured-sink.testing.js'
import type { CapturedEgressRequest } from '../../src/analytics/delivery/captured-sink.testing.js'
import { createTrackedLoggerMock, setupTestDb } from '../utils/test-helpers.js'
import type { TrackedLoggerMock } from '../utils/test-helpers.js'

const REPO_ROOT = join(import.meta.dir, '..', '..')

describe('privacy-contract control matrix', () => {
  test('the table covers exactly the 17 release-blocking controls with existing proof fixtures', () => {
    expect(PRIVACY_CONTRACT).toHaveLength(17)
    expect(PRIVACY_CONTRACT.map((row) => row.control)).toEqual(Array.from({ length: 17 }, (_, index) => index + 1))
    for (const row of PRIVACY_CONTRACT) {
      expect(row.proofPoints.length).toBeGreaterThan(0)
      expect(row.fixtures.length).toBeGreaterThan(0)
      for (const fixture of row.fixtures) {
        expect(existsSync(join(REPO_ROOT, fixture))).toBe(true)
      }
    }
  })

  // Whether those fixtures actually PASS is proved by `bun run analytics:privacy-contract`,
  // which reads the report of the run being gated. This file used to prove it by spawning
  // `bun test <fixture>` for each of the 57 — 110s of a 371s suite spent re-running work
  // the same invocation had just done. The gate is both cheaper and a stronger claim: it
  // certifies the fixtures were green in the gating run, not in some other process.
})

// The synthetic captured-request sweep scans logs, so it mocks src/logger.js
// before any module under test is imported (delayed-import pattern: the
// analytics modules call logger.child at module evaluation).
/**
 * Upper bound for the canary sweep, which drives a real delivery through SQLite, a
 * snapshot, the log stream and a captured request. It inherited the 10-minute bound the
 * nested fixture runs needed; two minutes is generous for what is left while still
 * failing a genuine hang rather than running unbounded.
 */
const CANARY_SWEEP_TIMEOUT_MS = 120_000

const tracked: TrackedLoggerMock = createTrackedLoggerMock()

type Db = Awaited<ReturnType<typeof setupTestDb>>

const NOW = 1_800_000_000_000
const UTC_DAY = new Date(NOW - 86_400_000).toISOString().slice(0, 10)

const CANARIES = [
  'raw-user-778899',
  'raw-chat-445566',
  'raw-task-11223',
  'raw-turn-99887',
  'raw-instance-1',
  'PROMPT-CANARY-7f3a9d',
  'USERNAME-CANARY-zx21',
  'TOKEN-CANARY-qw99',
  'RRULE-CANARY-rr5',
  'ERROR-CANARY-ee4',
  'HOSTNAME-CANARY-hh7.example.org',
  'FILENAME-CANARY-ff3.pdf',
] as const

const SYNTHETIC_KEY = Uint8Array.from({ length: 32 }, (_, index) => index)

const requireFirstRequest = (requests: readonly CapturedEgressRequest[]): CapturedEgressRequest => {
  const first = requests[0]
  if (first === undefined) throw new Error('expected a captured request')
  return first
}

const listScreenshotPaths = (): readonly string[] => {
  const shotsRoot = join(REPO_ROOT, '.storybook-shots')
  if (!existsSync(shotsRoot)) return []
  const entries = readdirSync(shotsRoot, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((entry) => join(entry.parentPath, entry.name))
}

const importModules = async (): Promise<{
  release: typeof import('../../src/analytics/delivery/aggregate-release.js')
  worker: typeof import('../../src/analytics/delivery/worker.js')
  schema: typeof import('../../src/db/schema.js')
  sinkService: typeof import('../../src/analytics/delivery/sink-service.js')
  snapshotJob: typeof import('../../src/analytics/jobs/snapshot.js')
  fenceModule: typeof import('../../src/analytics/rekey/cutover-fence.js')
  pseudonym: typeof import('../../src/analytics/identity/pseudonym.js')
}> => {
  const release = await import('../../src/analytics/delivery/aggregate-release.js')
  const worker = await import('../../src/analytics/delivery/worker.js')
  const schema = await import('../../src/db/schema.js')
  const sinkService = await import('../../src/analytics/delivery/sink-service.js')
  const snapshotJob = await import('../../src/analytics/jobs/snapshot.js')
  const fenceModule = await import('../../src/analytics/rekey/cutover-fence.js')
  const pseudonym = await import('../../src/analytics/identity/pseudonym.js')
  return { release, worker, schema, sinkService, snapshotJob, fenceModule, pseudonym }
}

describe('synthetic captured-request canary sweep', () => {
  let db: Db
  let workDir = ''

  beforeEach(async () => {
    process.env['INSTANCE_CONFIG_KEY'] = '9'.repeat(64)
    void mock.module('../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))
    tracked.clearCalls()
    db = await setupTestDb()
    workDir = mkdtempSync(join(tmpdir(), 'papai-privacy-contract-'))
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  test(
    'one synthetic captured request: zero prohibited canaries across SQLite, snapshot, logs, request capture, delivery state, and screenshots',
    async () => {
      const { release, worker, schema, sinkService, snapshotJob, fenceModule, pseudonym } = await importModules()
      const sink = createCapturedSink({ kind: 'delivered', status: 200, receiptHash: 'f'.repeat(64) })

      const view = sinkService.createSinkVersion(
        {
          logicalSinkId: 'contract-agg',
          kind: 'webhook',
          egressMode: 'aggregate',
          endpoint: 'https://captured-sink.example.net/ingest',
          secret: SYNTHETIC_SINK_TOKEN,
          nowMs: NOW,
        },
        { getDrizzleDb: (): Db => db, probe: () => Promise.resolve({ ok: true }) },
      )
      db.update(schema.analyticsSinks)
        .set({ state: 'enabled', verifiedAtMs: NOW })
        .where(eq(schema.analyticsSinks.sinkVersionId, view.sinkVersionId))
        .run()

      // Canonical storage holds only purpose-keyed pseudonyms derived from the
      // raw canary identifiers — the raw forms never enter any surface.
      const keyOf = { key: SYNTHETIC_KEY, keyVersion: 'v1' }
      const actorKey = pseudonym.createPseudonym({
        ...keyOf,
        domain: 'actor',
        components: ['telegram', 'raw-instance-1', 'raw-user-778899'],
      })
      const contextKey = pseudonym.createPseudonym({
        ...keyOf,
        domain: 'context',
        components: ['telegram', 'raw-instance-1', 'raw-chat-445566'],
      })
      const conversationKey = pseudonym.createPseudonym({
        ...keyOf,
        domain: 'conversation',
        components: ['telegram', 'raw-instance-1', 'raw-chat-445566', 'none'],
      })
      const turnKey = pseudonym.createPseudonym({ ...keyOf, domain: 'turn', components: ['raw-turn-99887'] })

      db.insert(schema.analyticsProcessEpochs)
        .values({ epochId: 'epoch-contract', state: 'open', startedAtMs: NOW })
        .run()
      db.insert(schema.analyticsEvents)
        .values({
          eventId: 'event-contract',
          storageGeneration: 'gen-1',
          processEpochId: 'epoch-contract',
          sourceRefKey: turnKey,
          sourceKind: 'live',
          schemaVersion: 1,
          eventName: 'turn_started',
          eventVersion: 1,
          occurredAtMs: NOW - 1000,
          ingestedAtMs: NOW,
          source: 'live',
          attributionQuality: 'native',
          appVersion: '6.10.0',
          deploymentKey: 'deploy-contract',
          keyVersion: 'v1',
          platform: 'telegram',
          platformInstanceKey: pseudonym.createPseudonym({
            ...keyOf,
            domain: 'instance',
            components: ['raw-instance-1'],
          }),
          actorKey,
          contextKey,
          conversationKey,
          taskInstanceKey: pseudonym.createPseudonym({ ...keyOf, domain: 'task', components: ['raw-task-11223'] }),
          contextType: 'dm',
          actorRole: 'member',
          taskProvider: 'none',
          invocationMode: 'normal',
          turnKey,
          policyVersion: 1,
          eligibility: 'allowed',
          maxClass: 'C0',
          propsJson: '{}',
          expiresAtMs: NOW + 86_400_000,
        })
        .run()

      const insertCounter = (metric: string, value: number, contributors: number): void => {
        db.insert(schema.analyticsDailyCounters)
          .values({
            utcDay: UTC_DAY,
            definitionVersion: 1,
            platform: 'all',
            contextType: 'all',
            actorRole: 'all',
            taskProvider: 'all',
            appVersion: 'all',
            metric,
            value,
            finalized: true,
            partialDay: false,
            restartGapDetected: false,
            lateEventCount: 0,
            reconciliationStatus: 'complete_epoch',
            disclosureScope: 'local_only',
            contributorBasis: 'eligible_actor',
            contributorCount: contributors,
            threshold: null,
          })
          .run()
      }
      insertCounter('turn_started', 250, 40)

      const built = release.buildDailyAggregateRelease(
        { utcDay: UTC_DAY, sinkVersionId: view.sinkVersionId, nowMs: NOW },
        { getDrizzleDb: (): Db => db },
      )
      expect(built.status).toBe('released')

      const tick = await worker.runDeliveryWorkerTick(
        { nowMs: NOW },
        {
          getDrizzleDb: (): Db => db,
          transport: sink.transport,
          lookupAll: () => Promise.resolve([{ address: '203.0.113.10', family: 4 as const }]),
        },
      )
      expect(tick).toMatchObject({ status: 'ok', leased: 1, delivered: 1 })
      expect(sink.requests).toHaveLength(1)

      // A dead-letter row in the ledger, so dead state is scanned as well.
      db.insert(schema.analyticsAggregateReleases)
        .values({
          releaseId: 'agg-release:contract-dead-letter',
          releaseHash: 'e'.repeat(64),
          payloadJson: `{"utc_day":"${UTC_DAY}","cells":[]}`,
          payloadSchemaVersion: 1,
          createdAtMs: NOW,
        })
        .run()
      db.insert(schema.analyticsAggregateDeliveries)
        .values({
          releaseId: 'agg-release:contract-dead-letter',
          sinkVersionId: view.sinkVersionId,
          state: 'dead',
          attempts: 8,
          nextAttemptAtMs: NOW,
          lastErrorClass: 'http_4xx',
          payloadSchemaVersion: 1,
        })
        .run()

      const snapshotPath = join(workDir, 'snapshot.db')
      const published = snapshotJob.publishAnalyticsSnapshot(
        { outputPath: snapshotPath },
        {
          getDrizzleDb: (): Db => db,
          fence: fenceModule.createRekeyCutoverFence({ getDrizzleDb: (): Db => db }),
          nowMs: (): number => NOW,
        },
      )
      expect(published.storageGeneration).toBe('gen-1')

      const request = requireFirstRequest(sink.requests)
      expect(request.headers['authorization']).toBe(`Bearer ${SYNTHETIC_SINK_TOKEN}`)
      const nonAuthHeaders = Object.entries(request.headers)
        .filter(([name]) => name.toLowerCase() !== 'authorization')
        .map(([name, value]) => `${name}: ${value}`)

      const analyticsTables = db.$client
        .query<{ name: string }, []>(
          `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'analytics%' ORDER BY name`,
        )
        .all()
      const sqliteDump = analyticsTables.map((table) =>
        JSON.stringify(db.$client.query(`SELECT * FROM "${table.name}"`).all()),
      )
      const logs = tracked.getCalls().map((call) => JSON.stringify(call.args))
      const snapshotBytes = readFileSync(snapshotPath).toString('latin1')
      const screenshotBytes = listScreenshotPaths().map((path) => readFileSync(path).toString('latin1'))

      const haystacks = [
        request.url,
        request.hostname,
        ...nonAuthHeaders,
        request.body,
        ...logs,
        ...sqliteDump,
        snapshotBytes,
        ...screenshotBytes,
      ]
      expect(findCanaries(haystacks, [...CANARIES])).toEqual([])

      // The stored surfaces carry the pseudonyms, never the raw identifiers.
      const canonicalDump = JSON.stringify(db.select().from(schema.analyticsEvents).all())
      expect(canonicalDump).toContain(actorKey)
      expect(canonicalDump).not.toContain('raw-')

      const deliveries = db.select().from(schema.analyticsAggregateDeliveries).all()
      const delivered = deliveries.find((row) => row.state === 'delivered')
      expect(delivered?.remoteReceiptHash).toMatch(/^[0-9a-f]{64}$/u)
      expect(request.body).not.toContain('raw-')
      expect(request.body).not.toContain('CANARY')
    },
    CANARY_SWEEP_TIMEOUT_MS,
  )
})
