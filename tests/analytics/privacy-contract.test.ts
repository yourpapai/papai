// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'

import {
  createCapturedSink,
  findCanaries,
  SYNTHETIC_SINK_TOKEN,
} from '../../src/analytics/delivery/captured-sink.testing.js'
import type { CapturedEgressRequest } from '../../src/analytics/delivery/captured-sink.testing.js'
import { createTrackedLoggerMock, setupTestDb } from '../utils/test-helpers.js'
import type { TrackedLoggerMock } from '../utils/test-helpers.js'

const REPO_ROOT = join(import.meta.dir, '..', '..')
const FIXTURE_TIMEOUT_MS = 600_000

type ContractRow = Readonly<{
  control: number
  name: string
  proofPoints: readonly string[]
  fixtures: readonly string[]
}>

const PRIVACY_CONTRACT: readonly ContractRow[] = [
  {
    control: 1,
    name: 'registry closure',
    proofPoints: ['registry closure across contracts/registry/metric map', 'feature uniqueness'],
    fixtures: ['tests/analytics/registry-closure.test.ts', 'tests/analytics/feature-opportunity.test.ts'],
  },
  {
    control: 2,
    name: 'strict schema fuzz',
    proofPoints: [
      'strict envelope acceptance',
      'rejection fuzz: unknown event/props/version/enum, nested data, non-finite or negative durations, oversized arrays, free-form strings',
    ],
    fixtures: ['tests/analytics/contracts.test.ts', 'tests/analytics/event-props-behavior.test.ts'],
  },
  {
    control: 3,
    name: 'C3 canaries',
    proofPoints: [
      'text/username/prompt/args/result/error/URL/hostname/filename/project/status/tag/RRULE/token/raw-ID canary scans over normalized JSON',
    ],
    fixtures: ['tests/analytics/normalizer.test.ts'],
  },
  {
    control: 4,
    name: 'identity matrix',
    proofPoints: [
      'frozen HMAC byte/digest vectors',
      'namespace/session/Discord effective conversation/guest matrix',
      'two-actor cached-descriptor/shared-pool attribution',
    ],
    fixtures: [
      'tests/analytics/keyring.test.ts',
      'tests/analytics/pseudonym.test.ts',
      'tests/analytics/scope.test.ts',
      'tests/analytics/install-id.test.ts',
      'tests/llm-orchestrator-tools.test.ts',
    ],
  },
  {
    control: 5,
    name: 'raw-ID absence',
    proofPoints: [
      'raw-ID canary scans: only purpose-keyed pseudonyms survive in canonical JSON',
      'captured-egress proof over poisoned source facts',
      'request-scoped provider overlap/cache isolation and log canaries',
    ],
    fixtures: [
      'tests/analytics/captured-egress.test.ts',
      'tests/analytics/delivery/captured-sink.testing.test.ts',
      'tests/analytics/provider-request-scope.test.ts',
      'tests/analytics/provider-request-scope-setup-paths.test.ts',
    ],
  },
  {
    control: 6,
    name: 'semantic outcome',
    proofPoints: [
      'exactly-one terminal classification',
      'post-classification tool terminal per idempotent source ID',
      'command production DI',
      'SDK-success structured failure never maps to semantic success',
    ],
    fixtures: [
      'tests/llm-orchestrator-tool-events.test.ts',
      'tests/llm-orchestrator-tool-terminal.test.ts',
      'tests/analytics/llm-tool-integration.test.ts',
      'tests/analytics/tool-classification.test.ts',
      'tests/runtime/production-deps-analytics.test.ts',
    ],
  },
  {
    control: 7,
    name: 'consent matrix',
    proofPoints: [
      '38,880-cell exact-decision mode x basis x preference x role matrix',
      'live observer fail-closed eligibility',
    ],
    fixtures: ['tests/analytics/governance/eligibility.test.ts', 'tests/analytics/eligibility-matrix.test.ts'],
  },
  {
    control: 8,
    name: 'withdrawal race',
    proofPoints: [
      'collection-writer races: deny-before-writer inserts nothing, writer-before-deny deleted before ack',
      'delivery-grant races at enqueue/lease/send-start with per-grant send mutex',
      'one-transaction withdrawal with in-tx cancel',
    ],
    fixtures: ['tests/analytics/collection-writer-race.test.ts', 'tests/analytics/withdrawal-race.test.ts'],
  },
  {
    control: 9,
    name: 'outbox/sink',
    proofPoints: [
      'nine-state closed ledger with single-enabled-sink partial unique index',
      'send-start crash states: never-started lease retries, uncertain cases become non-retried ambiguous',
      'sink lifecycle/ambiguous/SSRF pinning',
      'restrictive event FK and minimal independent receipts',
    ],
    fixtures: [
      'tests/analytics/delivery/store.test.ts',
      'tests/analytics/delivery/sink.test.ts',
      'tests/analytics/delivery/sink-service.test.ts',
      'tests/analytics/delivery/pinned-transport.test.ts',
      'tests/analytics/delivery/worker.test.ts',
      'tests/analytics/delivery/delivery-lifecycle.test.ts',
      'tests/analytics/delivery/settlement.test.ts',
      'tests/analytics/sink-gate.test.ts',
      'tests/analytics/sink-lifecycle.test.ts',
      'tests/analytics/delivery-store.test.ts',
    ],
  },
  {
    control: 10,
    name: 'session fixtures',
    proofPoints: [
      'sessionization boundaries 29:59/30:00/30:00.001',
      'out-of-order/midnight-UTC/two-actors-one-thread/sibling-thread/Discord-null-thread fixtures',
      'guests produce no session rows',
    ],
    fixtures: ['tests/analytics/derive/sessionizer.test.ts', 'tests/analytics/sessionizer.test.ts'],
  },
  {
    control: 11,
    name: 'cohort/censor fixtures',
    proofPoints: [
      'immature attempts censored never abandoned',
      'withdrawal/deletion right-censoring with censor-interval materialization',
      'clarification_abandoned deny-after-scan and writer-before-deny races',
    ],
    fixtures: ['tests/analytics/outcomes.test.ts'],
  },
  {
    control: 12,
    name: 'rephrase persistence audit',
    proofPoints: [
      'transient in-memory lifecycle: capture discards raw text, 30-minute TTL, max 3 sets',
      'post-auth canary never survives capture or derivation',
    ],
    fixtures: [
      'tests/analytics/rephrase/state.test.ts',
      'tests/analytics/rephrase/matching.test.ts',
      'tests/analytics/rephrase/outcome.test.ts',
      'tests/analytics/rephrase/handoff.test.ts',
      'tests/analytics/rephrase-handoff.test.ts',
      'tests/analytics/intent-persistence-audit.test.ts',
    ],
  },
  {
    control: 13,
    name: 'classifier contract',
    proofPoints: [
      'sealed-corpus hybrid parity with the frozen PoC values',
      'derived intent_classified envelope with deterministic intent-output:v1 ids',
      'no PoC/small-model import in the runtime module graph',
    ],
    fixtures: ['tests/analytics/intent-classifier.test.ts', 'tests/analytics/intent-derivation.test.ts'],
  },
  {
    control: 14,
    name: 'backfill/provenance/reconciliation',
    proofPoints: [
      'one controlled decision per durable row with HMAC source references',
      'provenance rerun zero-change and interrupt/resume identical decisions',
      'first-create rollback maps',
      'recoverability matrix',
      'process-epoch associations and the durable source equation with zero unexplained delta',
      'restart gap receives no numeric plug',
    ],
    fixtures: ['tests/analytics/backfill.test.ts', 'tests/analytics/reconciliation.test.ts'],
  },
  {
    control: 15,
    name: 'external thresholding',
    proofPoints: [
      'frozen one-way release lattice: total plus one-way children only',
      'primary thresholds and complementary suppression',
      'deterministic content-hash releaseId with idempotent rebuild',
      'restart-gap publication blocks',
    ],
    fixtures: [
      'tests/analytics/delivery/release-suppression.test.ts',
      'tests/analytics/delivery/aggregate-release.test.ts',
    ],
  },
  {
    control: 16,
    name: 'DSAR/delete/rekey/snapshot',
    proofPoints: [
      'authenticated DSAR export and deletion workflow across all retained key versions',
      'encrypted deletion targets destroyed only after local/snapshot/remote completion',
      'post-high-water dual-write rekey with retirement gating',
      'Metabase inode close/remount verification',
      'snapshot staging cleanup on success and failure',
    ],
    fixtures: [
      'tests/analytics/governance/subject-export.test.ts',
      'tests/analytics/governance/subject-deletion.test.ts',
      'tests/analytics/governance/deletion-target-store.test.ts',
      'tests/analytics/rekey.test.ts',
      'tests/analytics/rekey-cutover.test.ts',
      'tests/analytics/snapshot.test.ts',
    ],
  },
  {
    control: 17,
    name: 'performance/expiry clocks',
    proofPoints: [
      'monotonic TTFT/first-visible-feedback clocks with not-applicable/negative/implausible rejection',
      'deadline expiry guard at every read/derive/export/snapshot/lease/send boundary',
      'startup purge barrier and earliest-deadline wake',
    ],
    fixtures: [
      'tests/analytics/performance-clocks.test.ts',
      'tests/analytics/retention.test.ts',
      'tests/analytics/derive/store.test.ts',
    ],
  },
]

type FixtureResult = Readonly<{ exitCode: number; output: string }>

const fixtureResults = new Map<string, FixtureResult>()

const runFixture = (relativePath: string): FixtureResult => {
  const cached = fixtureResults.get(relativePath)
  if (cached !== undefined) return cached
  const proc = Bun.spawnSync({
    cmd: ['bun', 'test', relativePath],
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })
  const result: FixtureResult = {
    exitCode: proc.exitCode,
    output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
  }
  fixtureResults.set(relativePath, result)
  return result
}

const expectFixtureGreen = (relativePath: string): void => {
  const result = runFixture(relativePath)
  if (result.exitCode !== 0) console.error(result.output.split('\n').slice(-40).join('\n'))
  expect(result.exitCode).toBe(0)
  expect(result.output).not.toContain('(fail)')
}

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

  for (const row of PRIVACY_CONTRACT) {
    test(
      `control ${row.control} — ${row.name}: every proof fixture passes`,
      () => {
        for (const fixture of row.fixtures) expectFixtureGreen(fixture)
      },
      FIXTURE_TIMEOUT_MS,
    )
  }
})

// The synthetic captured-request sweep scans logs, so it mocks src/logger.js
// before any module under test is imported (delayed-import pattern: the
// analytics modules call logger.child at module evaluation).
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
    FIXTURE_TIMEOUT_MS,
  )
})
